"""Study persistence and API payload construction for SQLite and Cloud stores."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from backend.dicom_metadata import summarize_study_geometry, validate_series_geometry


class StudyCatalog:
    """Coordinate study/series persistence using the application's configured stores."""

    def __init__(self, runtime: Any) -> None:
        # Runtime is the API module; resolving its dependencies at call time keeps
        # tests and local configuration overrides working without global state here.
        self.runtime = runtime

    def insert_study(
        self,
        *,
        study_uid: str,
        display_name: str,
        source: str,
        files: list[tuple[dict[str, Any], Path]],
        study_id: str | None = None,
        owner_session_id: str | None = None,
    ) -> str:
        runtime = self.runtime
        study_id = study_id or f"study-{uuid.uuid4().hex[:12]}"
        grouped: dict[str, list[tuple[dict[str, Any], Path]]] = {}
        for metadata, path in files:
            grouped.setdefault(metadata["series_uid"], []).append((metadata, path))
        if runtime.cloud_mode():
            series_rows: list[dict[str, Any]] = []
            instance_rows: list[dict[str, Any]] = []
            store = runtime.object_store()
            for series_uid, items in grouped.items():
                first = items[0][0]
                series_id = f"series-{uuid.uuid4().hex[:12]}"
                series_geometry = validate_series_geometry(items)
                has_positions = all(item[0]["position"] is not None for item in items)
                series_rows.append(
                    {
                        "id": series_id,
                        "study_id": study_id,
                        "series_uid": series_uid,
                        "description": first["description"],
                        "plane": first["plane"],
                        "slice_count": len(items),
                        "rows": first["rows"],
                        "cols": first["cols"],
                        "spacing": ",".join(map(str, first["spacing"])),
                        "sort_method": "physical_position" if has_positions else "instance_number",
                        "geometry_status": series_geometry["status"],
                        "geometry_json": json.dumps(series_geometry, separators=(",", ":")),
                        "preview_status": "lazy",
                    }
                )
                ordered = sorted(
                    items,
                    key=lambda item: (
                        item[0]["position"] is None,
                        item[0]["position"] or 0,
                        item[0]["instance_number"],
                    ),
                )
                for metadata, local_path in ordered:
                    instance_id = f"instance-{uuid.uuid4().hex[:12]}"
                    object_name = (
                        f"sessions/{owner_session_id or 'examples'}/studies/{study_id}/{series_id}/{instance_id}.dcm"
                    )
                    stored_path = store.upload_file(local_path, object_name)
                    instance_rows.append(
                        {
                            "id": instance_id,
                            "series_id": series_id,
                            "filename": local_path.name,
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
            runtime.metadata_store().put_study(
                {
                    "id": study_id,
                    "study_uid": study_uid,
                    "display_name": display_name,
                    "source": source,
                    "created_at": runtime.now(),
                    "owner_uid": None,
                    "owner_session_id": owner_session_id,
                },
                series_rows,
                instance_rows,
            )
            return study_id

        with runtime.db() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO studies(id, study_uid, display_name, source, created_at, owner_session_id) VALUES (?, ?, ?, ?, ?, ?)",
                (study_id, study_uid, display_name, source, runtime.now(), owner_session_id),
            )
            for series_uid, items in grouped.items():
                first = items[0][0]
                series_id = f"series-{uuid.uuid4().hex[:12]}"
                series_geometry = validate_series_geometry(items)
                has_positions = all(item[0]["position"] is not None for item in items)
                connection.execute(
                    "INSERT INTO series(id, study_id, series_uid, description, plane, slice_count, rows, cols, spacing, sort_method, geometry_status, geometry_json, preview_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        series_id,
                        study_id,
                        series_uid,
                        first["description"],
                        first["plane"],
                        len(items),
                        first["rows"],
                        first["cols"],
                        ",".join(map(str, first["spacing"])),
                        "physical_position" if has_positions else "instance_number",
                        series_geometry["status"],
                        json.dumps(series_geometry, separators=(",", ":")),
                        "lazy",
                    ),
                )
                ordered = sorted(
                    items,
                    key=lambda item: (
                        item[0]["position"] is None,
                        item[0]["position"] or 0,
                        item[0]["instance_number"],
                    ),
                )
                for metadata, path in ordered:
                    connection.execute(
                        "INSERT INTO instances(id, series_id, filename, path, sop_uid, instance_number, position, rows, cols, spacing) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            f"instance-{uuid.uuid4().hex[:12]}",
                            series_id,
                            path.name,
                            str(path),
                            metadata["sop_uid"],
                            metadata["instance_number"],
                            metadata["position"],
                            metadata["rows"],
                            metadata["cols"],
                            ",".join(map(str, metadata["spacing"])),
                        ),
                    )
        return study_id

    def payload(self, study_row: Any) -> dict[str, Any]:
        runtime = self.runtime
        if runtime.cloud_mode():
            series_rows = runtime.metadata_store().list_series(study_row["id"])
            result_series = []
            for series_row in series_rows:
                instance_rows = runtime.metadata_store().list_instances(series_row["id"])
                try:
                    geometry = json.loads(series_row.get("geometry_json") or "{}")
                except json.JSONDecodeError:
                    geometry = {}
                geometry.setdefault("status", series_row.get("geometry_status") or "unknown")
                geometry.setdefault("mapping_ready", False)
                result_series.append(self._series_payload(series_row, geometry, len(instance_rows)))
        else:
            with runtime.db() as connection:
                series_rows = connection.execute(
                    "SELECT * FROM series WHERE study_id = ? ORDER BY rowid", (study_row["id"],)
                ).fetchall()
                result_series = []
                for series_row in series_rows:
                    count = connection.execute(
                        "SELECT COUNT(*) AS count FROM instances WHERE series_id = ?", (series_row["id"],)
                    ).fetchone()["count"]
                    try:
                        geometry = json.loads(series_row["geometry_json"] or "{}")
                    except json.JSONDecodeError:
                        geometry = {}
                    geometry.setdefault("status", series_row["geometry_status"] or "unknown")
                    geometry.setdefault("mapping_ready", False)
                    result_series.append(self._series_payload(series_row, geometry, count))

        return {
            "id": study_row["id"],
            "study_uid": study_row["study_uid"],
            "display_name": study_row["display_name"],
            "source": study_row["source"],
            "created_at": study_row["created_at"],
            "series": result_series,
            "total_slices": sum(series["slice_count"] for series in result_series),
            "geometry": summarize_study_geometry(result_series),
            "pipeline": {
                "status": "READY",
                "stages": [
                    {"key": "validate", "label": "DICOM validation", "status": "complete"},
                    {"key": "metadata", "label": "Metadata extraction", "status": "complete"},
                    {"key": "group", "label": "Study / Series grouping", "status": "complete"},
                    {"key": "sort", "label": "Geometry-aware slice sort", "status": "complete"},
                    {"key": "preview", "label": "Pixel preview rendering", "status": "on_demand"},
                ],
            },
        }

    @staticmethod
    def _series_payload(series_row: Any, geometry: dict[str, Any], count: int) -> dict[str, Any]:
        spacing_value = series_row.get("spacing") if isinstance(series_row, dict) else series_row["spacing"]
        return {
            "id": series_row["id"],
            "series_uid": series_row["series_uid"],
            "description": (
                series_row.get("description") if isinstance(series_row, dict) else series_row["description"]
            )
            or "DICOM series",
            "plane": series_row["plane"],
            "slice_count": count,
            "rows": series_row.get("rows") if isinstance(series_row, dict) else series_row["rows"],
            "cols": series_row.get("cols") if isinstance(series_row, dict) else series_row["cols"],
            "spacing": [float(value) for value in (spacing_value or "").split(",") if value],
            "sort_method": (
                series_row.get("sort_method") if isinstance(series_row, dict) else series_row["sort_method"]
            )
            or "instance_number",
            "geometry_status": geometry["status"],
            "geometry": geometry,
            "preview_status": (
                series_row.get("preview_status") if isinstance(series_row, dict) else series_row["preview_status"]
            )
            or "lazy",
        }

