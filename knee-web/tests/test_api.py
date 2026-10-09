from __future__ import annotations

import importlib
import io
import sys
import zipfile
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, MRImageStorage, generate_uid

from backend import ingest as ingest_module


def dicom_bytes(study_uid: str, series_uid: str, instance_number: int) -> bytes:
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = MRImageStorage
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    meta.ImplementationClassUID = generate_uid()

    dataset = FileDataset(
        f"slice-{instance_number}.dcm",
        {},
        file_meta=meta,
        preamble=b"\0" * 128,
    )
    dataset.is_little_endian = True
    dataset.is_implicit_VR = False
    dataset.StudyInstanceUID = study_uid
    dataset.SeriesInstanceUID = series_uid
    dataset.SOPClassUID = MRImageStorage
    dataset.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    dataset.Modality = "MR"
    dataset.SeriesDescription = "pytest series"
    dataset.InstanceNumber = instance_number
    dataset.Rows = 2
    dataset.Columns = 2
    dataset.SamplesPerPixel = 1
    dataset.PhotometricInterpretation = "MONOCHROME2"
    dataset.BitsAllocated = 8
    dataset.BitsStored = 8
    dataset.HighBit = 7
    dataset.PixelRepresentation = 0
    dataset.PixelData = bytes([instance_number, 1, 2, 3])

    buffer = io.BytesIO()
    dataset.save_as(buffer, write_like_original=False)
    return buffer.getvalue()


def zip_bytes(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for filename, raw in files.items():
            archive.writestr(filename, raw)
    return buffer.getvalue()


@pytest.fixture()
def main_module(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("EXAMPLES_DIR", str(tmp_path / "examples"))
    sys.modules.pop("backend.main", None)
    module = importlib.import_module("backend.main")
    yield module
    sys.modules.pop("backend.main", None)


@pytest.fixture()
def client(main_module: Any) -> TestClient:
    with TestClient(main_module.app) as test_client:
        session = test_client.post("/api/sessions")
        assert session.status_code == 200, session.text
        yield test_client


def upload_zip(
    client: TestClient,
    raw_zip: bytes,
    filename: str = "study.zip",
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    response = client.post(
        "/api/studies/upload",
        files={"files": (filename, raw_zip, "application/zip")},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_upload_valid_zip_groups_dicom_files(client: TestClient) -> None:
    study_uid = generate_uid()
    series_uid = generate_uid()
    payload = upload_zip(
        client,
        zip_bytes(
            {
                "nested/series_1/one.dcm": dicom_bytes(study_uid, series_uid, 1),
                "nested/series_1/two.dcm": dicom_bytes(study_uid, series_uid, 2),
            }
        ),
    )

    assert payload["accepted_files"] == 2
    assert payload["rejected"] == []
    study = client.get(f"/api/studies/{payload['study_ids'][0]}").json()
    assert study["source"] == "upload"
    assert study["total_slices"] == 2
    assert study["series"][0]["slice_count"] == 2


def test_upload_zip_without_dicom_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/studies/upload",
        files={"files": ("empty.zip", zip_bytes({"README.txt": b"not DICOM"}), "application/zip")},
    )

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["message"] == "No valid DICOM files were found"
    assert detail["rejected"][0]["reason"] == "ZIP contains no .dcm files"


def test_native_dicom_is_byte_exact_and_missing_ids_are_404(client: TestClient) -> None:
    raw = dicom_bytes(generate_uid(), generate_uid(), 1)
    payload = upload_zip(client, zip_bytes({"one.dcm": raw}))
    study = client.get(f"/api/studies/{payload['study_ids'][0]}").json()
    series_id = study["series"][0]["id"]
    slices = client.get(f"/api/series/{series_id}/slices").json()
    response = client.get(slices[0]["dicom_url"])
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/dicom"
    assert response.content == raw
    assert client.get("/api/instances/not-found/dicom").status_code == 404
    assert client.get("/api/series/not-found/volume").status_code == 404
    geometry = client.get(f"/api/series/{series_id}/volume").json()
    assert not geometry["eligible"]
    assert geometry["dicom_urls"] == []


def test_volume_endpoint_allows_one_regular_acquisition(client: TestClient) -> None:
    import pydicom

    study_uid, series_uid, frame_uid = generate_uid(), generate_uid(), generate_uid()
    files = {}
    for index in range(3):
        ds = pydicom.dcmread(io.BytesIO(dicom_bytes(study_uid, series_uid, index)))
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.ImagePositionPatient = [0, 0, index * 2]
        ds.PixelSpacing = [0.5, 0.5]
        ds.FrameOfReferenceUID = frame_uid
        buffer = io.BytesIO()
        ds.save_as(buffer, enforce_file_format=True)
        files[f"slice-{index}.dcm"] = buffer.getvalue()
    payload = upload_zip(client, zip_bytes(files))
    study = client.get(f"/api/studies/{payload['study_ids'][0]}").json()
    response = client.get(f"/api/series/{study['series'][0]['id']}/volume")
    assert response.status_code == 200
    result = response.json()
    assert result["eligible"]
    assert result["slice_count"] == 3
    assert len(result["dicom_urls"]) == 3


def test_invalid_zip_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/studies/upload",
        files={"files": ("broken.zip", b"not a zip", "application/zip")},
    )

    assert response.status_code == 400
    reason = response.json()["detail"]["rejected"][0]["reason"]
    assert reason.startswith("Invalid ZIP archive:")


def test_seed_example_is_idempotent(main_module: Any) -> None:
    examples_dir = main_module.EXAMPLES_DIR
    examples_dir.mkdir(parents=True, exist_ok=True)
    study_uid = generate_uid()
    series_uid = generate_uid()
    archive = zip_bytes(
        {
            "long/path/one.dcm": dicom_bytes(study_uid, series_uid, 1),
            "long/path/two.dcm": dicom_bytes(study_uid, series_uid, 2),
        }
    )
    (examples_dir / "results.zip").write_bytes(archive)

    main_module.init_db()
    main_module.seed_sample()
    main_module.seed_sample()

    with main_module.db() as connection:
        studies = connection.execute("SELECT * FROM studies WHERE source = 'sample'").fetchall()
        instances = connection.execute(
            "SELECT instances.path FROM instances JOIN series ON series.id = instances.series_id WHERE series.study_id = 'sample-knee'"
        ).fetchall()

    assert len(studies) == 1
    assert len(instances) == 2
    assert all(Path(row["path"]).name.startswith("slice-") for row in instances)


def test_example_study_is_read_only(main_module: Any) -> None:
    main_module.init_db()
    with main_module.db() as connection:
        connection.execute(
            "INSERT INTO studies(id, study_uid, display_name, source, created_at) VALUES (?, ?, ?, ?, ?)",
            ("sample-knee", generate_uid(), "Example Knee Study", "sample", main_module.now()),
        )

    with TestClient(main_module.app) as client:
        assert client.post("/api/sessions").status_code == 200
        response = client.delete("/api/studies/sample-knee")

    assert response.status_code == 409
    assert response.json()["detail"] == "The example study is read-only"


def test_delete_uploaded_study_removes_raw_files(client: TestClient, main_module: Any) -> None:
    study_uid = generate_uid()
    series_uid = generate_uid()
    payload = upload_zip(client, zip_bytes({"one.dcm": dicom_bytes(study_uid, series_uid, 1)}))
    study_id = payload["study_ids"][0]

    with main_module.db() as connection:
        path = connection.execute(
            "SELECT instances.path FROM instances JOIN series ON series.id = instances.series_id WHERE series.study_id = ?",
            (study_id,),
        ).fetchone()["path"]
    upload_root = Path(path).parents[2]
    assert upload_root.is_dir()

    response = client.delete(f"/api/studies/{study_id}")

    assert response.status_code == 200
    assert not upload_root.exists()
    assert client.get(f"/api/studies/{study_id}").status_code == 404


def test_anonymous_session_is_required_and_study_assets_are_isolated(
    client: TestClient,
    main_module: Any,
) -> None:
    with TestClient(main_module.app) as other_client:
        assert other_client.get("/api/studies").status_code == 401
        assert other_client.post("/api/sessions").status_code == 200
    study_uid, series_uid = generate_uid(), generate_uid()
    payload = upload_zip(
        client,
        zip_bytes({"one.dcm": dicom_bytes(study_uid, series_uid, 1)}),
    )
    study_id = payload["study_ids"][0]
    alice_study = client.get(f"/api/studies/{study_id}")
    assert alice_study.status_code == 200
    series_id = alice_study.json()["series"][0]["id"]
    slice_response = client.get(f"/api/series/{series_id}/slices")
    assert slice_response.status_code == 200
    instance_id = slice_response.json()[0]["id"]

    with TestClient(main_module.app) as other_client:
        assert other_client.post("/api/sessions").status_code == 200
        assert all(row["id"] != study_id for row in other_client.get("/api/studies").json())
        assert other_client.get(f"/api/studies/{study_id}").status_code == 404
        assert other_client.get(f"/api/studies/{study_id}/pipeline").status_code == 404
        assert other_client.get(f"/api/series/{series_id}/geometry").status_code == 404
        assert other_client.get(f"/api/series/{series_id}/slices").status_code == 404
        assert other_client.get(f"/api/series/{series_id}/volume").status_code == 404
        assert other_client.get(f"/api/instances/{instance_id}/dicom").status_code == 404
        assert other_client.get(f"/api/instances/{instance_id}/image").status_code == 404
        assert other_client.delete(f"/api/studies/{study_id}").status_code == 404

    with main_module.db() as connection:
        owner = connection.execute("SELECT owner_session_id FROM studies WHERE id = ?", (study_id,)).fetchone()["owner_session_id"]
        path = connection.execute(
            "SELECT instances.path FROM instances JOIN series ON series.id = instances.series_id WHERE series.study_id = ?",
            (study_id,),
        ).fetchone()["path"]
    assert owner
    assert Path(path).is_file()
    assert client.delete(f"/api/studies/{study_id}").status_code == 200
    assert not Path(path).exists()


def test_clear_session_deletes_uploads_and_rotates_session(client: TestClient, main_module: Any) -> None:
    payload = upload_zip(client, zip_bytes({"one.dcm": dicom_bytes(generate_uid(), generate_uid(), 1)}))
    study_id = payload["study_ids"][0]
    with main_module.db() as connection:
        path = connection.execute(
            "SELECT instances.path FROM instances JOIN series ON series.id = instances.series_id "
            "WHERE series.study_id = ?", (study_id,),
        ).fetchone()["path"]

    cleared = client.delete("/api/sessions/current")
    assert cleared.status_code == 204
    assert not Path(path).exists()
    assert client.get(f"/api/studies/{study_id}").status_code == 401
    assert client.post("/api/sessions").status_code == 200
    assert all(row["id"] != study_id for row in client.get("/api/studies").json())


def test_expired_session_is_rejected_and_upload_files_are_purged(client: TestClient, main_module: Any) -> None:
    payload = upload_zip(client, zip_bytes({"one.dcm": dicom_bytes(generate_uid(), generate_uid(), 1)}))
    study_id = payload["study_ids"][0]
    with main_module.db() as connection:
        path = connection.execute(
            "SELECT instances.path FROM instances JOIN series ON series.id = instances.series_id "
            "WHERE series.study_id = ?", (study_id,),
        ).fetchone()["path"]
        connection.execute("UPDATE anonymous_sessions SET idle_expires_at = '2000-01-01T00:00:00+00:00'")

    assert client.get("/api/studies").status_code == 401
    assert not Path(path).exists()


def test_upload_and_expanded_zip_limits_return_413(client: TestClient, main_module: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    valid_zip = zip_bytes({"one.dcm": dicom_bytes(generate_uid(), generate_uid(), 1)})
    monkeypatch.setattr(ingest_module, "MAX_UPLOAD_BYTES", 10)
    too_large = client.post("/api/studies/upload", files={"files": ("big.zip", valid_zip, "application/zip")})
    assert too_large.status_code == 413

    monkeypatch.setattr(ingest_module, "MAX_UPLOAD_BYTES", 1024 * 1024)
    monkeypatch.setattr(ingest_module, "MAX_EXPANDED_BYTES", 10)
    expanded_too_large = client.post("/api/studies/upload", files={"files": ("study.zip", valid_zip, "application/zip")})
    assert expanded_too_large.status_code == 413


def test_cloud_study_deletion_removes_objects_before_metadata(main_module: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    operations: list[str] = []

    class Metadata:
        def get_study(self, study_id: str) -> dict[str, str]:
            return {"id": study_id}

        def study_artifacts(self, study_id: str) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
            return ([{"id": "series-1"}], [{"id": "instance-1", "path": "gs://private/slice.dcm"}])

        def delete_study_metadata(self, study_id: str, series: list[Any], instances: list[Any]) -> None:
            operations.append("metadata")

    class ObjectStore:
        bucket_name = "private"

        def delete_uri(self, uri: str) -> None:
            operations.append(f"object:{uri}")

    monkeypatch.setattr(main_module, "metadata_store", Metadata)
    monkeypatch.setattr(main_module, "object_store", ObjectStore)

    assert main_module.delete_cloud_study_data("study-1") == 1
    assert operations == ["object:gs://private/slice.dcm", "metadata"]


def test_cloud_study_deletion_keeps_metadata_when_object_delete_fails(main_module: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    operations: list[str] = []

    class Metadata:
        def get_study(self, study_id: str) -> dict[str, str]:
            return {"id": study_id}

        def study_artifacts(self, study_id: str) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
            return ([{"id": "series-1"}], [{"id": "instance-1", "path": "gs://private/slice.dcm"}])

        def delete_study_metadata(self, study_id: str, series: list[Any], instances: list[Any]) -> None:
            operations.append("metadata")

    class ObjectStore:
        bucket_name = "private"

        def delete_uri(self, uri: str) -> None:
            operations.append(f"object:{uri}")
            raise RuntimeError("simulated GCS delete failure")

    monkeypatch.setattr(main_module, "metadata_store", Metadata)
    monkeypatch.setattr(main_module, "object_store", ObjectStore)

    with pytest.raises(RuntimeError, match="simulated GCS delete failure"):
        main_module.delete_cloud_study_data("study-1")
    assert operations == ["object:gs://private/slice.dcm"]
