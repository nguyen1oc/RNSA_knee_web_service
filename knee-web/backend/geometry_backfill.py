"""Backfill stored per-series geometry metadata for local studies."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def refresh_geometry_records(services: Any) -> None:
    """Backfill geometry for rows created before the geometry manifest existed."""
    if services.cloud_mode():
        return
    with services.db() as connection:
        series_rows = connection.execute("SELECT * FROM series ORDER BY rowid").fetchall()
        for series_row in series_rows:
            instance_rows = connection.execute(
                "SELECT * FROM instances WHERE series_id = ? ORDER BY rowid", (series_row["id"],)
            ).fetchall()
            parsed: list[tuple[dict[str, Any], Path]] = []
            for instance_row in instance_rows:
                path = Path(instance_row["path"])
                if not path.is_file():
                    continue
                try:
                    metadata = services.parse_metadata(path.read_bytes())
                except Exception:
                    continue
                parsed.append((metadata, path))
                connection.execute(
                    "UPDATE instances SET sop_uid = ?, instance_number = ?, position = ?, rows = ?, cols = ?, spacing = ? WHERE id = ?",
                    (
                        metadata["sop_uid"],
                        metadata["instance_number"],
                        metadata["position"],
                        metadata["rows"],
                        metadata["cols"],
                        ",".join(map(str, metadata["spacing"])),
                        instance_row["id"],
                    ),
                )
            if not parsed:
                continue
            first = parsed[0][0]
            geometry = services.validate_series_geometry(parsed)
            sort_method = (
                "physical_position"
                if all(metadata["position"] is not None for metadata, _ in parsed)
                else "instance_number"
            )
            connection.execute(
                "UPDATE series SET plane = ?, rows = ?, cols = ?, spacing = ?, sort_method = ?, geometry_status = ?, geometry_json = ?, slice_count = ? WHERE id = ?",
                (
                    first["plane"],
                    first["rows"],
                    first["cols"],
                    ",".join(map(str, first["spacing"])),
                    sort_method,
                    geometry["status"],
                    json.dumps(geometry, separators=(",", ":")),
                    len(instance_rows),
                    series_row["id"],
                ),
            )

