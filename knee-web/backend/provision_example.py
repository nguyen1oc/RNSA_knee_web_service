"""One-time, idempotent provisioning of the reviewed example study to GCS/Firestore.

Run from ``knee-web`` with Application Default Credentials that can write to the
staging bucket and Firestore database. This is deliberately not called at app
startup: deployment revisions must never upload sample DICOM implicitly.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any

os.environ["METADATA_BACKEND"] = "firestore"

from backend.cloud_storage import DicomObjectStore  # noqa: E402
from backend.firestore_metadata import FirestoreMetadata  # noqa: E402
from backend.ingest import MAX_DICOM_FILE_BYTES, MAX_DICOM_FILES, MAX_EXPANDED_BYTES  # noqa: E402
from backend.main import now, parse_metadata_path, validate_series_geometry  # noqa: E402

STUDY_ID = "sample-knee"
SAMPLE_PREFIX = f"examples/{STUDY_ID}/"


def stable_id(kind: str, dicom_uid: str) -> str:
    digest = hashlib.sha256(dicom_uid.encode("utf-8")).hexdigest()[:20]
    return f"example-{kind}-{digest}"


def archive_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_archive(path: Path, temp_dir: Path) -> list[tuple[dict[str, Any], Path, str]]:
    if not zipfile.is_zipfile(path):
        raise ValueError(f"Not a valid ZIP archive: {path.name}")

    parsed: list[tuple[dict[str, Any], Path, str]] = []
    expanded_bytes = 0
    with zipfile.ZipFile(path) as archive:
        members = sorted(
            (member for member in archive.infolist() if not member.is_dir() and member.filename.lower().endswith(".dcm")),
            key=lambda member: member.filename.casefold(),
        )
        if not members:
            raise ValueError("The ZIP archive contains no .dcm files")
        if len(members) > MAX_DICOM_FILES:
            raise ValueError(f"Archive exceeds the configured {MAX_DICOM_FILES}-DICOM limit")

        for index, member in enumerate(members):
            if member.file_size <= 0 or member.file_size > MAX_DICOM_FILE_BYTES:
                raise ValueError("Archive contains an empty or oversized DICOM file")
            expanded_bytes += member.file_size
            if expanded_bytes > MAX_EXPANDED_BYTES:
                raise ValueError("Archive exceeds the configured expanded-size limit")

            local_path = temp_dir / f"slice-{index:05d}.dcm"
            written = 0
            with archive.open(member) as source, local_path.open("wb") as target:
                while chunk := source.read(1024 * 1024):
                    written += len(chunk)
                    if written > member.file_size or expanded_bytes > MAX_EXPANDED_BYTES:
                        raise ValueError("DICOM member size does not match the ZIP directory")
                    target.write(chunk)
            if written != member.file_size:
                raise ValueError("DICOM member size does not match the ZIP directory")

            metadata = parse_metadata_path(local_path)
            if not metadata.get("sop_uid"):
                raise ValueError("A DICOM file is missing SOPInstanceUID")
            parsed.append((metadata, local_path, Path(member.filename).name or local_path.name))

    study_uids = {item[0]["study_uid"] for item in parsed}
    sop_uids = [item[0]["sop_uid"] for item in parsed]
    if len(study_uids) != 1:
        raise ValueError("Example ZIP must contain exactly one StudyInstanceUID")
    if len(set(sop_uids)) != len(sop_uids):
        raise ValueError("Example ZIP contains duplicate SOPInstanceUID values")
    return parsed


def provision(path: Path, *, project: str, database: str, bucket_name: str) -> dict[str, Any]:
    os.environ["METADATA_BACKEND"] = "firestore"
    os.environ["GOOGLE_CLOUD_PROJECT"] = project
    os.environ["FIRESTORE_DATABASE"] = database
    os.environ["DICOM_BUCKET"] = bucket_name

    # Import after environment setup so backend.main selects cloud metadata.
    from backend import main as backend_main

    if not backend_main.cloud_mode():
        raise RuntimeError("Cloud metadata mode was not selected")

    digest = archive_sha256(path)
    metadata_store = FirestoreMetadata()
    object_store = DicomObjectStore(bucket_name=bucket_name)
    with tempfile.TemporaryDirectory(prefix="knee-example-seed-") as temp_name:
        parsed = parse_archive(path, Path(temp_name))
        existing = metadata_store.get_study(STUDY_ID)
        if existing:
            if existing.get("source") != "sample" or existing.get("example_archive_sha256") != digest:
                raise RuntimeError(
                    f"Firestore already has a different study at {STUDY_ID!r}; refusing to overwrite it"
                )

        groups: dict[str, list[tuple[dict[str, Any], Path, str]]] = defaultdict(list)
        for item in parsed:
            groups[item[0]["series_uid"]].append(item)

        expected_objects: dict[str, int] = {}
        expected_instance_ids: set[str] = set()
        expected_series_ids: set[str] = set()
        for series_uid, items in groups.items():
            series_id = stable_id("series", series_uid)
            expected_series_ids.add(series_id)
            for metadata, local_path, _ in items:
                instance_id = stable_id("instance", metadata["sop_uid"])
                expected_instance_ids.add(instance_id)
                expected_objects[f"{SAMPLE_PREFIX}{series_id}/{instance_id}.dcm"] = local_path.stat().st_size

        if existing and existing.get("example_archive_sha256") == digest:
            old_series, old_instances = metadata_store.study_artifacts(STUDY_ID)
            current_blobs = {
                blob.name: int(blob.size or 0)
                for blob in object_store.bucket.list_blobs(prefix=SAMPLE_PREFIX)
            }
            if (
                {row["id"] for row in old_series} == expected_series_ids
                and {row["id"] for row in old_instances} == expected_instance_ids
                and current_blobs == expected_objects
            ):
                return {
                    "study_id": STUDY_ID,
                    "series_count": len(old_series),
                    "dicom_count": len(old_instances),
                    "bucket": bucket_name,
                    "prefix": SAMPLE_PREFIX,
                    "archive_sha256": digest,
                    "already_provisioned": True,
                }

        series_rows: list[dict[str, Any]] = []
        instance_rows: list[dict[str, Any]] = []
        for series_uid, items in sorted(groups.items()):
            series_id = stable_id("series", series_uid)
            ordered = sorted(
                items,
                key=lambda item: (
                    item[0]["position"] is None,
                    item[0]["position"] if item[0]["position"] is not None else 0,
                    item[0]["instance_number"],
                    item[2].casefold(),
                ),
            )
            first = ordered[0][0]
            series_geometry = validate_series_geometry([(meta, local) for meta, local, _ in ordered])
            has_positions = all(item[0]["position"] is not None for item in ordered)
            series_rows.append(
                {
                    "id": series_id,
                    "study_id": STUDY_ID,
                    "series_uid": series_uid,
                    "description": first["description"],
                    "plane": first["plane"],
                    "slice_count": len(ordered),
                    "rows": first["rows"],
                    "cols": first["cols"],
                    "spacing": ",".join(map(str, first["spacing"])),
                    "sort_method": "physical_position" if has_positions else "instance_number",
                    "geometry_status": series_geometry["status"],
                    "geometry_json": json.dumps(series_geometry, separators=(",", ":")),
                    "preview_status": "lazy",
                }
            )

            for metadata, local_path, filename in ordered:
                instance_id = stable_id("instance", metadata["sop_uid"])
                object_name = f"{SAMPLE_PREFIX}{series_id}/{instance_id}.dcm"
                stored_path = object_store.upload_file(local_path, object_name)
                expected_objects[object_name] = local_path.stat().st_size
                instance_rows.append(
                    {
                        "id": instance_id,
                        "series_id": series_id,
                        "filename": filename,
                        "path": stored_path,
                        "size_bytes": local_path.stat().st_size,
                        "sop_uid": metadata["sop_uid"],
                        "instance_number": metadata["instance_number"],
                        "position": metadata["position"],
                        "rows": metadata["rows"],
                        "cols": metadata["cols"],
                        "spacing": ",".join(map(str, metadata["spacing"])),
                    }
                )

        # If a previous attempt uploaded blobs but failed before Firestore commit,
        # stable object/document IDs make rerunning this command safe.
        metadata_store.put_study(
            {
                "id": STUDY_ID,
                "study_uid": parsed[0][0]["study_uid"],
                "display_name": "Example Knee Study",
                "source": "sample",
                "created_at": existing.get("created_at", now()) if existing else now(),
                "owner_uid": None,
                "owner_session_id": None,
                "example_archive_sha256": digest,
                "example_file_count": len(instance_rows),
            },
            series_rows,
            instance_rows,
        )

        # Remove only stale objects from this dedicated example prefix; session
        # uploads and other examples live under different prefixes.
        for blob in object_store.bucket.list_blobs(prefix=SAMPLE_PREFIX):
            if blob.name not in expected_objects:
                blob.delete()

    return {
        "study_id": STUDY_ID,
        "series_count": len(series_rows),
        "dicom_count": len(instance_rows),
        "bucket": bucket_name,
        "prefix": SAMPLE_PREFIX,
        "archive_sha256": digest,
    }


def main() -> None:
    default_archive = Path(__file__).resolve().parents[2] / "dicom-viewer" / "files" / "results.zip"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=default_archive)
    parser.add_argument("--project", default=os.getenv("GOOGLE_CLOUD_PROJECT", "rsna-knee-511004"))
    parser.add_argument("--database", default=os.getenv("FIRESTORE_DATABASE", "(default)"))
    parser.add_argument("--bucket", default=os.getenv("DICOM_BUCKET", "rsna-knee-dicom-preview-511004"))
    args = parser.parse_args()

    if not args.archive.is_file():
        parser.error(f"Example archive not found: {args.archive}")
    result = provision(args.archive, project=args.project, database=args.database, bucket_name=args.bucket)
    print(
        "Provisioned shared example: "
        f"{result['study_id']} · {result['series_count']} series · {result['dicom_count']} DICOM · "
        f"gs://{result['bucket']}/{result['prefix']}"
    )


if __name__ == "__main__":
    main()
