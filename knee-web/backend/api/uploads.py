"""Local and resumable cloud DICOM upload routes."""

from __future__ import annotations

import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool


def build_router(services: Any) -> APIRouter:
    router = APIRouter()

    def session_upload_bytes(session_id: str) -> int:
        if services.cloud_mode():
            total = 0
            for study in services.metadata_store().session_studies(session_id):
                for series in services.metadata_store().list_series(study["id"]):
                    for instance in services.metadata_store().list_instances(series["id"]):
                        total += int(instance.get("size_bytes", 0))
            return total
        with services.db() as connection:
            paths = connection.execute(
                "SELECT instances.path FROM instances JOIN series ON series.id = instances.series_id "
                "JOIN studies ON studies.id = series.study_id WHERE studies.owner_session_id = ?",
                (session_id,),
            ).fetchall()
        unique_paths = {row["path"] for row in paths}
        return sum(Path(path).stat().st_size for path in unique_paths if Path(path).is_file())

    @router.post("/api/uploads/resumable")
    def create_resumable_upload(
        body: services.ResumableUploadRequest,
        request: Request,
        session: services.AnonymousSession = Depends(services.get_current_session),
    ) -> dict[str, str]:
        if not services.cloud_mode():
            raise HTTPException(404, "Resumable upload is available only on the Cloud Storage deployment")
        services.enforce_upload_limits(services.metadata_store(), session.session_id)
        filename = Path(body.filename).name
        if not filename.lower().endswith((".dcm", ".zip")):
            raise HTTPException(400, "Only .dcm files or .zip archives are supported")
        pending = services.metadata_store().session_pending_uploads(session.session_id)
        pending_bytes = sum(int(item.get("size", 0)) for item in pending)
        active_uploads = [item for item in pending if item.get("status", "uploading") == "uploading"]
        if len(active_uploads) >= 3:
            raise HTTPException(
                429, "Finish or cancel a pending upload before starting another", headers={"Retry-After": "60"}
            )
        if pending_bytes + body.size > services.MAX_SESSION_BYTES:
            raise HTTPException(413, "Temporary session upload limit reached")
        if session_upload_bytes(session.session_id) + pending_bytes + body.size > services.MAX_SESSION_BYTES:
            raise HTTPException(
                413, f"Temporary session is limited to {services.MAX_SESSION_BYTES // (1024 * 1024)} MiB total"
            )

        upload_id = uuid.uuid4().hex
        extension = ".zip" if filename.lower().endswith(".zip") else ".dcm"
        object_name = f"incoming/{session.session_id}/{upload_id}{extension}"
        stored_filename = f"upload-{upload_id}{extension}"
        content_type = "application/zip" if filename.lower().endswith(".zip") else "application/dicom"
        try:
            upload_url = services.object_store().create_resumable_upload(
                object_name,
                content_type=content_type,
                origin=request.headers.get("origin"),
                size=body.size,
            )
        except Exception as exc:
            raise HTTPException(503, "Could not start secure Cloud Storage upload") from exc
        services.metadata_store().create_pending_upload(
            upload_id,
            {
                "id": upload_id,
                "owner_session_id": session.session_id,
                "object_name": object_name,
                "filename": stored_filename,
                "size": body.size,
                "status": "uploading",
                "created_at": services.now(),
            },
        )
        return {"upload_id": upload_id, "upload_url": upload_url, "content_type": content_type}

    @router.post("/api/uploads/{upload_id}/complete")
    def complete_resumable_upload(
        upload_id: str,
        session: services.AnonymousSession = Depends(services.get_current_session),
    ) -> dict[str, str]:
        if not services.cloud_mode():
            raise HTTPException(404, "Resumable upload is available only on the Cloud Storage deployment")
        store = services.metadata_store()
        row = store.get_pending_upload(upload_id)
        if not row or row.get("owner_session_id") != session.session_id:
            raise HTTPException(404, "Upload session not found or expired")
        object_uri = f"gs://{services.object_store().bucket_name}/{row['object_name']}"
        try:
            actual_size = services.object_store().size_uri(object_uri)
        except Exception as exc:
            raise HTTPException(400, "Uploaded object is not complete") from exc
        if actual_size != int(row["size"]):
            raise HTTPException(400, "Uploaded file size mismatch")
        store.update_pending_upload(upload_id, {"status": "uploaded", "uploaded_at": services.now()})
        return {"upload_id": upload_id, "status": "uploaded"}

    @router.post("/api/studies/finalize-upload")
    def finalize_resumable_uploads(
        body: services.FinalizeUploadsRequest,
        session: services.AnonymousSession = Depends(services.get_current_session),
    ) -> dict[str, Any]:
        if not services.cloud_mode():
            raise HTTPException(404, "Resumable upload is available only on the Cloud Storage deployment")
        if len(set(body.upload_ids)) != len(body.upload_ids):
            raise HTTPException(400, "Duplicate upload IDs are not allowed")
        services.enforce_finalize_limits(services.metadata_store(), session.session_id)

        pending_rows: list[dict[str, Any]] = []
        for upload_id in body.upload_ids:
            row = services.metadata_store().get_pending_upload(upload_id)
            if not row or row.get("owner_session_id") != session.session_id:
                raise HTTPException(404, "Upload session not found or expired")
            if row.get("status") != "uploaded":
                raise HTTPException(409, "Upload must finish before it can be finalized")
            pending_rows.append(row)

        upload_root = services.STORAGE_DIR / f"upload-{uuid.uuid4().hex[:12]}"
        staged_uploads: list[UploadFile] = []
        try:
            with tempfile.TemporaryDirectory(prefix="knee-incoming-") as temporary_directory:
                temp_root = Path(temporary_directory)
                for index, row in enumerate(pending_rows):
                    object_uri = f"gs://{services.object_store().bucket_name}/{row['object_name']}"
                    try:
                        actual_size = services.object_store().size_uri(object_uri)
                    except Exception as exc:
                        raise HTTPException(400, f"Uploaded object is unavailable: {row['filename']}") from exc
                    if actual_size != int(row["size"]):
                        raise HTTPException(400, f"Uploaded file size mismatch: {row['filename']}")
                    extension = Path(row["filename"]).suffix.lower()
                    safe_filename = f"upload-{index:04d}{extension}"
                    local = services.object_store().download_file(object_uri, temp_root / safe_filename)
                    staged_uploads.append(UploadFile(filename=safe_filename, file=local.open("rb")))

                accepted, rejected = services.stage_and_validate_uploads(
                    staged_uploads, upload_root, services.parse_metadata_path
                )
                if not accepted:
                    raise HTTPException(400, {"message": "No valid DICOM files were found", "rejected": rejected})
                accepted_bytes = sum(path.stat().st_size for _, path in accepted if path.is_file())
                if session_upload_bytes(session.session_id) + accepted_bytes > services.MAX_SESSION_BYTES:
                    raise HTTPException(
                        413, f"Temporary session is limited to {services.MAX_SESSION_BYTES // (1024 * 1024)} MiB total"
                    )

                created: list[str] = []
                for study_uid in sorted({item[0]["study_uid"] for item in accepted}):
                    group = [item for item in accepted if item[0]["study_uid"] == study_uid]
                    created.append(
                        services.insert_study(
                            study_uid=study_uid,
                            display_name=services.study_name(group[0][0], "upload"),
                            source="upload",
                            files=group,
                            owner_session_id=session.session_id,
                        )
                    )
                return {"study_ids": created, "accepted_files": len(accepted), "rejected": rejected}
        except services.UploadLimitExceeded as exc:
            raise HTTPException(413, str(exc)) from exc
        finally:
            for upload in staged_uploads:
                upload.file.close()
            shutil.rmtree(upload_root, ignore_errors=True)
            for row in pending_rows:
                object_uri = f"gs://{services.object_store().bucket_name}/{row['object_name']}"
                try:
                    services.object_store().delete_uri(object_uri)
                    services.metadata_store().delete_pending_upload(row["id"])
                except Exception:
                    services.logger.exception(
                        "Failed to clean up a finalized-upload object; metadata retained for retry"
                    )

    @router.post("/api/studies/upload")
    async def upload_study(
        files: list[UploadFile] = File(...),
        session: services.AnonymousSession = Depends(services.get_current_session),
    ) -> dict[str, Any]:
        if services.cloud_mode():
            raise HTTPException(413, "Use the resumable Cloud Storage upload flow for cloud studies")
        upload_root = services.STORAGE_DIR / f"upload-{uuid.uuid4().hex[:12]}"
        try:
            accepted, rejected = await run_in_threadpool(
                services.stage_and_validate_uploads,
                files,
                upload_root,
                services.parse_metadata_path,
            )
            if not accepted:
                raise HTTPException(400, {"message": "No valid DICOM files were found", "rejected": rejected})
            accepted_bytes = sum(path.stat().st_size for _, path in accepted if path.is_file())
            if session_upload_bytes(session.session_id) + accepted_bytes > services.MAX_SESSION_BYTES:
                raise services.UploadLimitExceeded(
                    f"Temporary session is limited to {services.MAX_SESSION_BYTES // (1024 * 1024)} MiB total"
                )

            created: list[str] = []
            for study_uid in sorted({item[0]["study_uid"] for item in accepted}):
                group = [item for item in accepted if item[0]["study_uid"] == study_uid]
                created.append(
                    services.insert_study(
                        study_uid=study_uid,
                        display_name=services.study_name(group[0][0], "upload"),
                        source="upload",
                        files=group,
                        owner_session_id=session.session_id,
                    )
                )
            return {"study_ids": created, "accepted_files": len(accepted), "rejected": rejected}
        except services.UploadLimitExceeded as exc:
            shutil.rmtree(upload_root, ignore_errors=True)
            raise HTTPException(413, str(exc)) from exc
        except HTTPException:
            shutil.rmtree(upload_root, ignore_errors=True)
            raise
        except Exception:
            shutil.rmtree(upload_root, ignore_errors=True)
            raise

    return router

