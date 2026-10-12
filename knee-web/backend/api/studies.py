"""Study and series-metadata API routes."""

from __future__ import annotations

import json
from typing import Any

import pydicom
from fastapi import APIRouter, Depends, HTTPException

from backend.dicom_metadata import acquisition_metadata_from_dataset


def _series_representative_paths(services: Any, study_id: str) -> list[dict[str, Any]]:
    """Return one DICOM header path per series for lightweight metadata reads."""
    if services.cloud_mode():
        store = services.metadata_store()
        representatives = []
        for series in store.list_series(study_id):
            instances = store.list_instances(series["id"])
            if instances:
                representatives.append({"series": series, "path": instances[0]["path"]})
        return representatives

    with services.db() as connection:
        rows = connection.execute(
            "SELECT s.id, s.description, s.plane, s.slice_count, "
            "(SELECT i.path FROM instances i WHERE i.series_id = s.id "
            "ORDER BY i.rowid LIMIT 1) AS path "
            "FROM series s WHERE s.study_id = ? ORDER BY s.rowid",
            (study_id,),
        ).fetchall()
    return [{"series": dict(row), "path": row["path"]} for row in rows if row["path"]]

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

    @router.get("/api/studies/{study_id}/acquisition")
    def get_study_acquisition(
        study_id: str, session: services.AnonymousSession = Depends(services.get_current_session)
    ) -> dict[str, Any]:
        services.require_study_access(study_id, session)
        scanner_values: dict[str, set[str]] = {
            "modality": set(),
            "manufacturer": set(),
            "manufacturer_model": set(),
            "field_strength_t": set(),
        }
        result_series: list[dict[str, Any]] = []
        for item in _series_representative_paths(services, study_id):
            series = item["series"]
            try:
                path = services.local_dicom_path(item["path"])
                dataset = pydicom.dcmread(path, stop_before_pixels=True, force=False)
                acquisition = acquisition_metadata_from_dataset(dataset)
            except (OSError, pydicom.errors.InvalidDicomError, ValueError):
                acquisition = None

            if acquisition:
                for key in scanner_values:
                    value = acquisition.get(key)
                    if value is not None:
                        scanner_values[key].add(str(value))
            result_series.append(
                {
                    "id": series["id"],
                    "description": series.get("description") or "DICOM series",
                    "plane": series.get("plane") or "UNKNOWN",
                    "image_count": series.get("slice_count", 0),
                    "metadata_available": acquisition is not None,
                    "settings": {
                        key: value
                        for key, value in (acquisition or {}).items()
                        if key not in scanner_values
                    },
                }
            )
        scanner = {key: sorted(values) for key, values in scanner_values.items() if values}
        return {"study_id": study_id, "scanner": scanner, "series": result_series}

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

