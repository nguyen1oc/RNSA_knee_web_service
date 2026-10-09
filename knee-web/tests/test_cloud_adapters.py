from __future__ import annotations

import sys
import types
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest

from backend.cloud_storage import DicomObjectStore
from backend.firestore_metadata import FirestoreMetadata


class FakeSnapshot:
    def __init__(self, document_id: str, data: dict[str, Any] | None) -> None:
        self.id = document_id
        self._data = data
        self.exists = data is not None

    def to_dict(self) -> dict[str, Any] | None:
        return self._data


class FakeDocument:
    def __init__(self, collection: FakeCollection, document_id: str) -> None:
        self.collection = collection
        self.id = document_id

    def get(self) -> FakeSnapshot:
        return FakeSnapshot(self.id, self.collection.rows.get(self.id))

    def create(self, data: dict[str, Any]) -> None:
        if self.id in self.collection.rows:
            raise ValueError("document already exists")
        self.collection.rows[self.id] = data

    def update(self, data: dict[str, Any]) -> None:
        self.collection.rows[self.id].update(data)

    def delete(self) -> None:
        self.collection.rows.pop(self.id, None)


class FakeQuery:
    def __init__(self, collection: FakeCollection, filters: tuple[tuple[str, str, Any], ...] = (), limit: int | None = None) -> None:
        self.collection = collection
        self.filters = filters
        self.row_limit = limit

    def where(self, field: str, operator: str, value: Any) -> FakeQuery:
        return FakeQuery(self.collection, (*self.filters, (field, operator, value)), self.row_limit)

    def limit(self, count: int) -> FakeQuery:
        return FakeQuery(self.collection, self.filters, count)

    def stream(self) -> list[FakeSnapshot]:
        snapshots = []
        for document_id, data in self.collection.rows.items():
            if all(
                (
                    data.get(field) == expected
                    if operator == "=="
                    else field in data and data[field] <= expected
                )
                for field, operator, expected in self.filters
            ):
                snapshots.append(FakeSnapshot(document_id, data))
        return snapshots[: self.row_limit]


class FakeCollection(FakeQuery):
    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}
        super().__init__(self)

    def document(self, document_id: str) -> FakeDocument:
        return FakeDocument(self, document_id)


class FakeBatch:
    def __init__(self) -> None:
        self.operations: list[tuple[str, FakeDocument, dict[str, Any] | None]] = []

    def set(self, document: FakeDocument, data: dict[str, Any]) -> None:
        self.operations.append(("set", document, data))

    def delete(self, document: FakeDocument) -> None:
        self.operations.append(("delete", document, None))

    def commit(self) -> None:
        for operation, document, data in self.operations:
            if operation == "set":
                document.collection.rows[document.id] = data or {}
            else:
                document.delete()


class FakeFirestore:
    def __init__(self) -> None:
        self.collections: dict[str, FakeCollection] = {}
        self.rate_counters: dict[str, int] = {}

    def collection(self, name: str) -> FakeCollection:
        return self.collections.setdefault(name, FakeCollection())

    def batch(self) -> FakeBatch:
        return FakeBatch()

    def consume_rate_limit(self, counter_id: str, limit: int, expires_at: Any) -> bool:
        count = self.rate_counters.get(counter_id, 0)
        if count >= limit:
            return False
        self.rate_counters[counter_id] = count + 1
        return True


class FakeBlob:
    def __init__(self, object_name: str, objects: dict[str, bytes]) -> None:
        self.object_name = object_name
        self.objects = objects
        self.size: int | None = None

    def upload_from_filename(self, filename: str, content_type: str) -> None:
        self.objects[self.object_name] = Path(filename).read_bytes()

    def download_to_filename(self, filename: str) -> None:
        Path(filename).write_bytes(self.objects[self.object_name])

    def delete(self, if_generation_match: int | None = None) -> None:
        self.objects.pop(self.object_name, None)

    def reload(self) -> None:
        self.size = len(self.objects[self.object_name])


class FakeBucket:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def blob(self, object_name: str) -> FakeBlob:
        return FakeBlob(object_name, self.objects)


class FakeStorageClient:
    def __init__(self) -> None:
        self.bucket_instance = FakeBucket()

    def bucket(self, bucket_name: str) -> FakeBucket:
        return self.bucket_instance


def test_firestore_metadata_session_owner_queries_and_delete() -> None:
    repository = FirestoreMetadata(client=FakeFirestore())
    repository.create_session("session-a", {"token_hash": "hash-a", "idle_expires_at": "2030-01-01"})
    repository.create_session("session-b", {"token_hash": "hash-b", "idle_expires_at": "2020-01-01"})

    assert repository.session_by_token_hash("hash-a")["token_hash"] == "hash-a"
    assert [row["token_hash"] for row in repository.expired_sessions("2025-01-01")] == ["hash-b"]
    repository.touch_session("session-a", "2024-01-01", "2024-01-02")
    assert repository.get_session("session-a")["idle_expires_at"] == "2024-01-02"

    repository.put_study(
        {"id": "study-a", "owner_session_id": "session-a", "source": "upload"},
        [{"id": "series-a", "study_id": "study-a"}],
        [{"id": "instance-a", "series_id": "series-a", "path": "gs://bucket/a.dcm"}],
    )
    assert repository.list_studies("session-a")[0]["id"] == "study-a"
    study, instances = repository.delete_study("study-a")
    assert study["id"] == "study-a"
    assert [row["id"] for row in instances] == ["instance-a"]
    assert repository.get_study("study-a") is None
    assert repository.list_series("study-a") == []
    assert repository.get_instance("instance-a") is None


def test_firestore_metadata_uses_configured_database(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_client(**kwargs: Any) -> FakeFirestore:
        captured.update(kwargs)
        return FakeFirestore()

    fake_google = types.ModuleType("google")
    fake_google.__path__ = []
    fake_cloud = types.ModuleType("google.cloud")
    fake_firestore = types.ModuleType("google.cloud.firestore")
    fake_firestore.Client = fake_client
    fake_cloud.firestore = fake_firestore
    monkeypatch.setitem(sys.modules, "google", fake_google)
    monkeypatch.setitem(sys.modules, "google.cloud", fake_cloud)
    monkeypatch.setitem(sys.modules, "google.cloud.firestore", fake_firestore)

    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-project")
    monkeypatch.setenv("FIRESTORE_DATABASE", "knee-review-staging")

    FirestoreMetadata()

    assert captured == {"project": "test-project", "database": "knee-review-staging"}


def test_firestore_fixed_window_counter_uses_atomic_store_contract() -> None:
    client = FakeFirestore()
    repository = FirestoreMetadata(client=client)
    expiry = datetime.now(timezone.utc)

    assert repository.consume_rate_limit("counter-a", 2, expiry)
    assert repository.consume_rate_limit("counter-a", 2, expiry)
    assert not repository.consume_rate_limit("counter-a", 2, expiry)


def test_cloud_storage_round_trip_and_rejects_foreign_bucket(tmp_path: Path) -> None:
    client = FakeStorageClient()
    object_store = DicomObjectStore(bucket_name="private-dicom", client=client)
    source = tmp_path / "slice.dcm"
    source.write_bytes(b"dicom-data")

    uri = object_store.upload_file(source, "sessions/s1/slice.dcm")
    target = tmp_path / "download" / "slice.dcm"
    assert object_store.size_uri(uri) == 10
    assert object_store.download_file(uri, target) == target
    assert target.read_bytes() == b"dicom-data"
    object_store.delete_uri(uri)
    assert client.bucket_instance.objects == {}

    with pytest.raises(ValueError, match="Invalid DICOM object URI"):
        object_store.size_uri("gs://another-bucket/secret.dcm")


def test_cloud_storage_requires_bucket_name() -> None:
    with pytest.raises(Exception, match="DICOM_BUCKET must be set"):
        DicomObjectStore(bucket_name="")
