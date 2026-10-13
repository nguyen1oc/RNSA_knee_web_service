"""Series navigation and DICOM/preview image routes."""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

import pydicom
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response

logger = logging.getLogger("knee_review.volume")


def build_router(services: Any) -> APIRouter:
    router = APIRouter()

    @router.get("/api/series/{series_id}/slices")
    def list_slices(
        series_id: str,
        session: services.AnonymousSession = Depends(services.get_current_session),
    ) -> list[dict[str, Any]]:
        services.require_series_access(series_id, session)
        if services.cloud_mode():
            rows = services.metadata_store().list_instances(series_id)
            if not rows:
                raise HTTPException(404, "Series not found")
            return [
                {
                    "index": index,
                    "id": row["id"],
                    "filename": row["filename"],
                    "instance_number": row.get("instance_number"),
                    "position": row.get("position"),
                    "image_url": services.api_url(f"/api/instances/{row['id']}/image"),
                    "dicom_url": services.api_url(f"/api/instances/{row['id']}/dicom"),
                }
                for index, row in enumerate(rows)
            ]
        with services.db() as connection:
            rows = connection.execute(
                "SELECT * FROM instances WHERE series_id = ? "
                "ORDER BY position IS NULL, position, instance_number, filename",
                (series_id,),
            ).fetchall()
        if not rows:
            raise HTTPException(404, "Series not found")
        return [
            {
                "index": index,
                "id": row["id"],
                "filename": row["filename"],
                "instance_number": row["instance_number"],
                "position": row["position"],
                "image_url": services.api_url(f"/api/instances/{row['id']}/image"),
                "dicom_url": services.api_url(f"/api/instances/{row['id']}/dicom"),
            }
            for index, row in enumerate(rows)
        ]

    @router.get("/api/series/{series_id}/volume")
    def series_volume(
        series_id: str,
        session: services.AnonymousSession = Depends(services.get_current_session),
    ) -> dict[str, Any]:
        series_access = services.require_series_access(series_id, session)
        started = time.perf_counter()
        if services.cloud_mode():
            rows = services.metadata_store().list_instances(series_id)
            if not rows:
                raise HTTPException(404, "Series not found")
            cache_hit = False
            try:
                geometry = json.loads(series_access.get("geometry_json") or "{}")
                result = geometry.get("volume_eligibility")
                cache_hit = result is not None
                if result is None:
                    headers = [
                        pydicom.dcmread(services.local_dicom_path(row["path"]), stop_before_pixels=True)
                        for row in rows
                    ]
                    result = services.volume_eligibility(headers)
                    geometry["volume_eligibility"] = result
                    services.metadata_store().update_series(series_id, {"geometry_json": json.dumps(geometry, separators=(",", ":"))})
            except (OSError, pydicom.errors.InvalidDicomError):
                result = {"eligible": False, "reasons": ["One or more DICOM files are unavailable."]}
            delivery = "proxy"
            dicom_urls = [services.api_url(f"/api/instances/{row['id']}/dicom") for row in rows] if result["eligible"] else []
            if result["eligible"] and os.getenv("DIRECT_GCS_DICOM_READS", "false").lower() == "true":
                try:
                    dicom_urls = services.object_store().signed_read_urls([row["path"] for row in rows])
                    delivery = "gcs_signed_url"
                except Exception:
                    logger.exception("volume_signed_urls_failed; falling back to authenticated API proxy")
            logger.info(
                "volume_timing mode=cloud series_id=%s cache_hit=%s delivery=%s slices=%s duration_ms=%s",
                series_id,
                cache_hit,
                delivery,
                len(rows),
                round((time.perf_counter() - started) * 1000),
            )
            return {
                "series_id": series_id,
                **result,
                "dicom_urls": dicom_urls,
                "dicom_delivery": delivery,
            }
        with services.db() as connection:
            rows = connection.execute(
                "SELECT id, path FROM instances WHERE series_id = ? "
                "ORDER BY position IS NULL, position, instance_number, filename",
                (series_id,),
            ).fetchall()
        if not rows:
            raise HTTPException(404, "Series not found")
        cache_hit = False
        try:
            with services.db() as connection:
                series_row = connection.execute("SELECT geometry_json FROM series WHERE id = ?", (series_id,)).fetchone()
            geometry = json.loads(series_row["geometry_json"] or "{}") if series_row else {}
            result = geometry.get("volume_eligibility")
            cache_hit = result is not None
            if result is None:
                headers = [pydicom.dcmread(row["path"], stop_before_pixels=True) for row in rows]
                result = services.volume_eligibility(headers)
                geometry["volume_eligibility"] = result
                with services.db() as connection:
                    connection.execute(
                        "UPDATE series SET geometry_json = ? WHERE id = ?",
                        (json.dumps(geometry, separators=(",", ":")), series_id),
                    )
        except (OSError, pydicom.errors.InvalidDicomError):
            result = {"eligible": False, "reasons": ["One or more DICOM files are unavailable."]}
        logger.info(
            "volume_timing mode=local cache_hit=%s slices=%s duration_ms=%s",
            cache_hit,
            len(rows),
            round((time.perf_counter() - started) * 1000),
        )
        return {
            "series_id": series_id,
            **result,
            "dicom_urls": [f"/api/instances/{row['id']}/dicom" for row in rows] if result["eligible"] else [],
        }

    @router.get("/api/instances/{instance_id}/dicom")
    def instance_dicom(
        instance_id: str,
        session: services.AnonymousSession = Depends(services.get_current_session),
    ) -> FileResponse:
        row = services.require_instance_access(instance_id, session)
        path = services.local_dicom_path(row["path"])
        if not row or not path.is_file():
            raise HTTPException(404, "DICOM file not found")
        return FileResponse(path, media_type="application/dicom", headers={"Cache-Control": "private, max-age=3600"})

    @router.get("/api/instances/{instance_id}/image")
    def instance_image(
        instance_id: str,
        session: services.AnonymousSession = Depends(services.get_current_session),
    ) -> Response:
        row = services.require_instance_access(instance_id, session)
        path = services.local_dicom_path(row["path"])
        if not path.is_file():
            raise HTTPException(404, "DICOM file is no longer available")
        try:
            preview = services.render_preview(path)
            return Response(preview, media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})
        except Exception as exc:
            raise HTTPException(422, f"Unable to render DICOM image: {exc}") from exc

    return router

