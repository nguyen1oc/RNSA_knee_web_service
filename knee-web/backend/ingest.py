from __future__ import annotations

import os
import shutil
import uuid
import zipfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import UploadFile

MAX_UPLOAD_BYTES = max(1, int(os.getenv("MAX_UPLOAD_MIB", "600"))) * 1024 * 1024
MAX_EXPANDED_BYTES = max(1, int(os.getenv("MAX_EXPANDED_MIB", "800"))) * 1024 * 1024
MAX_SESSION_BYTES = max(1, int(os.getenv("MAX_SESSION_MIB", "800"))) * 1024 * 1024
MAX_DICOM_FILE_BYTES = max(1, int(os.getenv("MAX_DICOM_FILE_MIB", "200"))) * 1024 * 1024
MAX_DICOM_FILES = max(1, int(os.getenv("MAX_DICOM_FILES", "500")))
UPLOAD_CHUNK_BYTES = 1024 * 1024


class UploadLimitExceeded(Exception):
    pass


def upload_file_size(upload: UploadFile) -> int:
    if upload.size is not None:
        return int(upload.size)
    upload.file.seek(0, os.SEEK_END)
    size = int(upload.file.tell())
    upload.file.seek(0)
    return size


def copy_upload_stream(source: Any, destination: Path, limit: int) -> int:
    written = 0
    with destination.open("wb") as target:
        while chunk := source.read(UPLOAD_CHUNK_BYTES):
            written += len(chunk)
            if written > limit:
                raise UploadLimitExceeded("Upload exceeds the configured expanded data limit")
            target.write(chunk)
    return written


async def stage_and_validate_uploads(
    files: list[UploadFile],
    upload_root: Path,
    parse_metadata_path: Callable[[Path], dict[str, Any]],
) -> tuple[list[tuple[dict[str, Any], Path]], list[dict[str, str]]]:
    rejected: list[dict[str, str]] = []
    accepted: list[tuple[dict[str, Any], Path]] = []
    staging_dir = upload_root / "_staging"
    staging_dir.mkdir(parents=True, exist_ok=True)
    candidates: list[tuple[str, Path]] = []
    compressed_bytes = 0
    expanded_bytes = 0

    for upload in files:
        filename = Path(upload.filename or "").name
        file_size = upload_file_size(upload)
        compressed_bytes += file_size
        if compressed_bytes > MAX_UPLOAD_BYTES:
            raise UploadLimitExceeded(f"Upload is over the {MAX_UPLOAD_BYTES // (1024 * 1024)} MiB request limit")
        if file_size == 0:
            rejected.append({"filename": filename, "reason": "Empty file"})
            continue

        if filename.lower().endswith(".zip"):
            start_index = len(candidates)
            start_expanded = expanded_bytes
            try:
                upload.file.seek(0)
                with zipfile.ZipFile(upload.file) as archive:
                    members = [member for member in archive.infolist() if not member.is_dir() and member.filename.lower().endswith(".dcm")]
                    if not members:
                        rejected.append({"filename": filename, "reason": "ZIP contains no .dcm files"})
                        continue
                    if len(candidates) + len(members) > MAX_DICOM_FILES:
                        raise UploadLimitExceeded(f"Study exceeds the {MAX_DICOM_FILES} DICOM file limit")
                    declared_bytes = sum(member.file_size for member in members)
                    if expanded_bytes + declared_bytes > MAX_EXPANDED_BYTES:
                        raise UploadLimitExceeded(f"ZIP exceeds the {MAX_EXPANDED_BYTES // (1024 * 1024)} MiB expanded data limit")
                    for member in members:
                        if member.file_size > MAX_DICOM_FILE_BYTES:
                            raise UploadLimitExceeded(
                                f"A DICOM file exceeds the {MAX_DICOM_FILE_BYTES // (1024 * 1024)} MiB per-file limit"
                            )
                        staged_path = staging_dir / f"{uuid.uuid4().hex}.dcm"
                        remaining = min(MAX_DICOM_FILE_BYTES, MAX_EXPANDED_BYTES - expanded_bytes)
                        with archive.open(member) as source:
                            extracted = copy_upload_stream(source, staged_path, remaining)
                        if extracted != member.file_size:
                            raise zipfile.BadZipFile("DICOM member size does not match the ZIP directory")
                        expanded_bytes += extracted
                        member_name = Path(member.filename).name or f"slice-{uuid.uuid4().hex[:8]}.dcm"
                        candidates.append((member_name, staged_path))
            except UploadLimitExceeded:
                raise
            except (zipfile.BadZipFile, OSError, RuntimeError) as exc:
                for _, staged_path in candidates[start_index:]:
                    staged_path.unlink(missing_ok=True)
                del candidates[start_index:]
                expanded_bytes = start_expanded
                rejected.append({"filename": filename, "reason": f"Invalid ZIP archive: {exc}"})
            continue

        if not filename.lower().endswith(".dcm"):
            rejected.append({"filename": filename or "unnamed", "reason": "Only .dcm files or .zip archives are supported"})
            continue
        if len(candidates) >= MAX_DICOM_FILES:
            raise UploadLimitExceeded(f"Study exceeds the {MAX_DICOM_FILES} DICOM file limit")
        if file_size > MAX_DICOM_FILE_BYTES or expanded_bytes + file_size > MAX_EXPANDED_BYTES:
            raise UploadLimitExceeded("DICOM file or total expanded study exceeds the configured size limit")
        staged_path = staging_dir / f"{uuid.uuid4().hex}.dcm"
        upload.file.seek(0)
        copied = copy_upload_stream(upload.file, staged_path, min(MAX_DICOM_FILE_BYTES, MAX_EXPANDED_BYTES - expanded_bytes))
        expanded_bytes += copied
        candidates.append((filename, staged_path))

    for filename, staged_path in candidates:
        try:
            metadata = parse_metadata_path(staged_path)
        except Exception as exc:
            staged_path.unlink(missing_ok=True)
            rejected.append({"filename": filename, "reason": f"Invalid DICOM: {exc}"})
            continue
        target_dir = upload_root / metadata["study_uid"] / metadata["series_uid"]
        target_dir.mkdir(parents=True, exist_ok=True)
        safe_filename = Path(filename).name or f"slice-{uuid.uuid4().hex[:8]}.dcm"
        target = target_dir / safe_filename
        if target.exists():
            target = target_dir / f"{uuid.uuid4().hex[:8]}-{safe_filename}"
        staged_path.replace(target)
        accepted.append((metadata, target.resolve()))

    shutil.rmtree(staging_dir, ignore_errors=True)
    return accepted, rejected
