"""Study and series-metadata API routes."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException


def build_router(services: Any) -> APIRouter:
    router = APIRouter()

    @router.get("/api/studies")
    def list_studies(
        session: services.AnonymousSession = Depends(services.get_current_session),
    ) -> list[dict[str, Any]]:
        if services.cloud_mode():
            rows = services.metadata_store().list_studies(session.session_id)
            rows.sort(key=lambda row: (row.get("source") != "sample", row.get("created_at", "")))
            return [services.study_payload(row) for row in rows]
        with services.db() as connection:
            rows = connection.execute(
                "SELECT * FROM studies WHERE source = 'sample' OR owner_session_id = ? ORDER BY source DESC, created_at DESC",
                (session.session_id,),
            ).fetchall()
        return [services.study_payload(row) for row in rows]

    @router.get("/api/studies/{study_id}")
    def get_study(
        study_id: str, session: services.AnonymousSession = Depends(services.get_current_session)
    ) -> dict[str, Any]:
        row = services.require_study_access(study_id, session)
        return services.study_payload(row)

    @router.get("/api/studies/{study_id}/pipeline")
    def get_study_pipeline(
        study_id: str, session: services.AnonymousSession = Depends(services.get_current_session)
    ) -> dict[str, Any]:
        row = services.require_study_access(study_id, session)
        return {"study_id": study_id, **services.study_payload(row)["pipeline"]}

    @router.get("/api/series/{series_id}/geometry")
    def get_series_geometry(
        series_id: str, session: services.AnonymousSession = Depends(services.get_current_session)
    ) -> dict[str, Any]:
        services.require_series_access(series_id, session)
        if services.cloud_mode():
            row = services.metadata_store().get_series(series_id)
            if not row:
                raise HTTPException(404, "Series not found")
            try:
                geometry = json.loads(row.get("geometry_json") or "{}")
            except json.JSONDecodeError:
                geometry = {}
            geometry.setdefault("status", row.get("geometry_status") or "unknown")
            geometry.setdefault("mapping_ready", False)
            return {"series_id": row["id"], **geometry}
        with services.db() as connection:
            row = connection.execute(
                "SELECT id, geometry_status, geometry_json FROM series WHERE id = ?", (series_id,)
            ).fetchone()
        if not row:
            raise HTTPException(404, "Series not found")
        try:
            geometry = json.loads(row["geometry_json"] or "{}")
        except json.JSONDecodeError:
            geometry = {}
        geometry.setdefault("status", row["geometry_status"] or "unknown")
        geometry.setdefault("mapping_ready", False)
        return {"series_id": row["id"], **geometry}

    @router.delete("/api/studies/{study_id}")
    def delete_study(
        study_id: str, session: services.AnonymousSession = Depends(services.get_current_session)
    ) -> dict[str, str]:
        if services.cloud_mode():
            store = services.metadata_store()
            row = store.get_study(study_id)
            if not row:
                raise HTTPException(404, "Study not found")
            if row["source"] == "sample":
                raise HTTPException(409, "The example study is read-only")
            if row.get("owner_session_id") != session.session_id:
                raise HTTPException(404, "Study not found")
            try:
                services.delete_cloud_study_data(study_id)
            except Exception as exc:
                raise HTTPException(503, "Could not fully delete this study. Retry the delete action.") from exc
            return {"status": "deleted", "study_id": study_id}
        with services.db() as connection:
            row = connection.execute("SELECT * FROM studies WHERE id = ?", (study_id,)).fetchone()
            if not row:
                raise HTTPException(404, "Study not found")
            if row["source"] == "sample":
                raise HTTPException(409, "The example study is read-only")
            if row["owner_session_id"] != session.session_id:
                raise HTTPException(404, "Study not found")
            paths = connection.execute(
                "SELECT path FROM instances WHERE series_id IN (SELECT id FROM series WHERE study_id = ?)",
                (study_id,),
            ).fetchall()
            connection.execute("DELETE FROM studies WHERE id = ?", (study_id,))
        services.remove_upload_roots([path["path"] for path in paths])
        return {"status": "deleted", "study_id": study_id}

    return router

