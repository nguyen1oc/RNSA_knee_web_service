from __future__ import annotations

import os
from collections.abc import Iterable
from typing import Any


class FirestoreMetadata:
    """Firestore document repository for temporary anonymous viewer workspaces."""

    def __init__(self, client: Any | None = None) -> None:
        if client is None:
            from google.cloud import firestore

            client = firestore.Client(project=os.getenv("GOOGLE_CLOUD_PROJECT") or None)
        self.client = client
        self.sessions = self.client.collection("anonymous_sessions")
        self.studies = self.client.collection("studies")
        self.series = self.client.collection("series")
        self.instances = self.client.collection("instances")
        self.pending_uploads = self.client.collection("pending_uploads")

    def create_session(self, session_id: str, data: dict[str, Any]) -> None:
        self.sessions.document(session_id).create(data)

    def session_by_token_hash(self, token_hash: str) -> dict[str, Any] | None:
        rows = self.sessions.where("token_hash", "==", token_hash).limit(1).stream()
        document = next(iter(rows), None)
        return self._data(document)

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        return self._data(self.sessions.document(session_id).get())

    def touch_session(self, session_id: str, last_seen_at: str, idle_expires_at: str) -> None:
        self.sessions.document(session_id).update({"last_seen_at": last_seen_at, "idle_expires_at": idle_expires_at})

    def expired_sessions(self, stamp: str) -> list[dict[str, Any]]:
        expired: dict[str, dict[str, Any]] = {}
        for field in ("idle_expires_at", "absolute_expires_at"):
            for document in self.sessions.where(field, "<=", stamp).stream():
                data = self._data(document)
                if data:
                    expired[document.id] = data
        return list(expired.values())

    def delete_session(self, session_id: str) -> None:
        self.sessions.document(session_id).delete()

    def put_study(self, study: dict[str, Any], series_rows: list[dict[str, Any]], instance_rows: list[dict[str, Any]]) -> None:
        writes: list[tuple[Any, dict[str, Any]]] = [(self.studies.document(study["id"]), study)]
        writes.extend((self.series.document(row["id"]), row) for row in series_rows)
        writes.extend((self.instances.document(row["id"]), row) for row in instance_rows)
        self._write_documents(writes)

    def get_study(self, study_id: str) -> dict[str, Any] | None:
        return self._data(self.studies.document(study_id).get())

    def list_studies(self, session_id: str) -> list[dict[str, Any]]:
        rows: dict[str, dict[str, Any]] = {}
        queries = (
            self.studies.where("source", "==", "sample"),
            self.studies.where("owner_session_id", "==", session_id),
        )
        for query in queries:
            for document in query.stream():
                data = self._data(document)
                if data:
                    rows[document.id] = data
        return sorted(rows.values(), key=lambda row: (row.get("source") != "sample", row.get("created_at", "")), reverse=False)

    def get_series(self, series_id: str) -> dict[str, Any] | None:
        return self._data(self.series.document(series_id).get())

    def list_series(self, study_id: str) -> list[dict[str, Any]]:
        rows = (self._data(doc) for doc in self.series.where("study_id", "==", study_id).stream())
        return [row for row in rows if row is not None]

    def get_instance(self, instance_id: str) -> dict[str, Any] | None:
        return self._data(self.instances.document(instance_id).get())

    def list_instances(self, series_id: str) -> list[dict[str, Any]]:
        candidates = (self._data(doc) for doc in self.instances.where("series_id", "==", series_id).stream())
        rows = [row for row in candidates if row is not None]
        return sorted(rows, key=lambda row: (row.get("position") is None, row.get("position") or 0, row.get("instance_number") or 0, row.get("filename", "")))

    def update_instance(self, instance_id: str, data: dict[str, Any]) -> None:
        self.instances.document(instance_id).update(data)

    def update_series(self, series_id: str, data: dict[str, Any]) -> None:
        self.series.document(series_id).update(data)

    def delete_study(self, study_id: str) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
        study = self.get_study(study_id)
        if not study:
            return None, []
        instances: list[dict[str, Any]] = []
        series_rows = self.list_series(study_id)
        for series in series_rows:
            instances.extend(self.list_instances(series["id"]))
        refs = [self.instances.document(row["id"]) for row in instances]
        refs.extend(self.series.document(row["id"]) for row in series_rows)
        refs.append(self.studies.document(study_id))
        self._delete_documents(refs)
        return study, instances

    def session_studies(self, session_id: str) -> list[dict[str, Any]]:
        rows = (self._data(doc) for doc in self.studies.where("owner_session_id", "==", session_id).stream())
        return [row for row in rows if row is not None]

    def session_pending_uploads(self, session_id: str) -> list[dict[str, Any]]:
        rows = (self._data(doc) for doc in self.pending_uploads.where("owner_session_id", "==", session_id).stream())
        return [row for row in rows if row is not None]

    def create_pending_upload(self, upload_id: str, data: dict[str, Any]) -> None:
        self.pending_uploads.document(upload_id).create(data)

    def get_pending_upload(self, upload_id: str) -> dict[str, Any] | None:
        return self._data(self.pending_uploads.document(upload_id).get())

    def delete_pending_upload(self, upload_id: str) -> None:
        self.pending_uploads.document(upload_id).delete()

    @staticmethod
    def _data(document: Any) -> dict[str, Any] | None:
        return document.to_dict() if document is not None and document.exists else None

    def _write_documents(self, writes: Iterable[tuple[Any, dict[str, Any]]]) -> None:
        self._batch_documents(writes, delete=False)

    def _delete_documents(self, references: Iterable[Any]) -> None:
        self._batch_documents(((reference, {}) for reference in references), delete=True)

    def _batch_documents(self, rows: Iterable[tuple[Any, dict[str, Any]]], *, delete: bool) -> None:
        batch = self.client.batch()
        count = 0
        for reference, data in rows:
            if delete:
                batch.delete(reference)
            else:
                batch.set(reference, data)
            count += 1
            if count == 450:
                batch.commit()
                batch = self.client.batch()
                count = 0
        if count:
            batch.commit()
