from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


class CloudStorageNotConfigured(RuntimeError):
    pass


class DicomObjectStore:
    """Private GCS object operations used by the Cloud Run deployment.

    Local development continues to use the filesystem. Object names are generated
    by the backend; a client-supplied filename is never used as a bucket path.
    """

    def __init__(self, bucket_name: str | None = None, client: Any | None = None) -> None:
        self.bucket_name = bucket_name or os.getenv("DICOM_BUCKET", "").strip()
        if not self.bucket_name:
            raise CloudStorageNotConfigured("DICOM_BUCKET must be set to enable Cloud Storage")
        if client is None:
            from google.cloud import storage

            client = storage.Client()
        self.client = client
        self.bucket = self.client.bucket(self.bucket_name)

    def create_resumable_upload(
        self,
        object_name: str,
        content_type: str = "application/octet-stream",
        origin: str | None = None,
        size: int | None = None,
    ) -> str:
        blob = self.bucket.blob(object_name)
        return blob.create_resumable_upload_session(content_type=content_type, origin=origin, size=size)

    def upload_file(self, local_path: Path, object_name: str) -> str:
        blob = self.bucket.blob(object_name)
        blob.upload_from_filename(str(local_path), content_type="application/dicom")
        return f"gs://{self.bucket_name}/{object_name}"

    def download_file(self, object_uri: str, destination: Path) -> Path:
        blob = self._blob_from_uri(object_uri)
        destination.parent.mkdir(parents=True, exist_ok=True)
        blob.download_to_filename(str(destination))
        return destination

    def delete_uri(self, object_uri: str) -> None:
        self._blob_from_uri(object_uri).delete(if_generation_match=None)

    def size_uri(self, object_uri: str) -> int:
        blob = self._blob_from_uri(object_uri)
        blob.reload()
        return int(blob.size or 0)

    def _blob_from_uri(self, object_uri: str) -> Any:
        parsed = urlparse(object_uri)
        if parsed.scheme != "gs" or parsed.netloc != self.bucket_name or not parsed.path.strip("/"):
            raise ValueError("Invalid DICOM object URI")
        return self.bucket.blob(parsed.path.lstrip("/"))
