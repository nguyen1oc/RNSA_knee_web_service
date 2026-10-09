from __future__ import annotations

import io
import json
import os
import shutil
import sqlite3
import uuid
import zipfile
from collections.abc import Iterable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pydicom
from fastapi import Cookie, Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image

from backend.ingest import MAX_SESSION_BYTES, UploadLimitExceeded, stage_and_validate_uploads
from backend.session_token import AnonymousSession, format_timestamp, hash_session_token, new_session_record, utc_now
from backend.volume_geometry import volume_eligibility

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data"))
DB_PATH = DATA_DIR / "knee.sqlite3"
STORAGE_DIR = DATA_DIR / "studies"
EXAMPLES_DIR = Path(os.getenv("EXAMPLES_DIR", ROOT.parent / "dicom-viewer" / "files"))
STATIC_DIR = ROOT / "frontend" / "dist"

DATA_DIR.mkdir(parents=True, exist_ok=True)
STORAGE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Knee Review API", version="0.1.0")
allowed_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Knee-Session"],
)

GEOMETRY_TOLERANCE = 1e-3
SESSION_IDLE_TTL_MINUTES = max(1, int(os.getenv("SESSION_IDLE_TTL_MINUTES", "60")))
SESSION_MAX_TTL_HOURS = max(1, int(os.getenv("SESSION_MAX_TTL_HOURS", "4")))


def db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
    with db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS anonymous_sessions (
                id TEXT PRIMARY KEY,
                token_hash TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                idle_expires_at TEXT NOT NULL,
                absolute_expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS studies (
                id TEXT PRIMARY KEY,
                study_uid TEXT NOT NULL,
                display_name TEXT NOT NULL,
                source TEXT NOT NULL CHECK(source IN ('sample', 'upload')),
                created_at TEXT NOT NULL,
                owner_uid TEXT,
                owner_session_id TEXT REFERENCES anonymous_sessions(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS series (
                id TEXT PRIMARY KEY,
                study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
                series_uid TEXT NOT NULL,
                description TEXT,
                plane TEXT NOT NULL,
                slice_count INTEGER NOT NULL DEFAULT 0,
                rows INTEGER,
                cols INTEGER,
                spacing TEXT,
                sort_method TEXT NOT NULL DEFAULT 'instance_number',
                geometry_status TEXT NOT NULL DEFAULT 'unknown',
                geometry_json TEXT NOT NULL DEFAULT '{}',
                preview_status TEXT NOT NULL DEFAULT 'lazy',
                UNIQUE(study_id, series_uid)
            );
            CREATE TABLE IF NOT EXISTS instances (
                id TEXT PRIMARY KEY,
                series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
                filename TEXT NOT NULL,
                path TEXT NOT NULL,
                sop_uid TEXT,
                instance_number INTEGER,
                position REAL,
                rows INTEGER,
                cols INTEGER,
                spacing TEXT
            );
            """
        )
        existing = {row[1] for row in connection.execute("PRAGMA table_info(series)").fetchall()}
        migrations = {
            "sort_method": "ALTER TABLE series ADD COLUMN sort_method TEXT NOT NULL DEFAULT 'instance_number'",
            "geometry_status": "ALTER TABLE series ADD COLUMN geometry_status TEXT NOT NULL DEFAULT 'unknown'",
            "geometry_json": "ALTER TABLE series ADD COLUMN geometry_json TEXT NOT NULL DEFAULT '{}'",
            "preview_status": "ALTER TABLE series ADD COLUMN preview_status TEXT NOT NULL DEFAULT 'lazy'",
        }
        for column, statement in migrations.items():
            if column not in existing:
                connection.execute(statement)
        study_columns = {row[1] for row in connection.execute("PRAGMA table_info(studies)").fetchall()}
        if "owner_uid" not in study_columns:
            connection.execute("ALTER TABLE studies ADD COLUMN owner_uid TEXT")
        if "owner_session_id" not in study_columns:
            connection.execute("ALTER TABLE studies ADD COLUMN owner_session_id TEXT REFERENCES anonymous_sessions(id) ON DELETE CASCADE")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_studies_session_created ON studies(owner_session_id, created_at)")


def remove_upload_roots(paths: list[str]) -> None:
    roots = {Path(path).parents[2] for path in paths if path}
    for root in roots:
        if root.name.startswith("upload-") and root.is_dir():
            shutil.rmtree(root, ignore_errors=True)


def cleanup_expired_sessions() -> int:
    stamp = format_timestamp(utc_now())
    with db() as connection:
        expired = connection.execute(
            "SELECT id FROM anonymous_sessions WHERE idle_expires_at <= ? OR absolute_expires_at <= ?",
            (stamp, stamp),
        ).fetchall()
        session_ids = [row["id"] for row in expired]
        if not session_ids:
            return 0
        placeholders = ",".join("?" for _ in session_ids)
        paths = connection.execute(
            f"SELECT instances.path FROM instances JOIN series ON series.id = instances.series_id "
            f"JOIN studies ON studies.id = series.study_id WHERE studies.owner_session_id IN ({placeholders})",
            session_ids,
        ).fetchall()
        connection.execute(f"DELETE FROM anonymous_sessions WHERE id IN ({placeholders})", session_ids)
    remove_upload_roots([row["path"] for row in paths])
    return len(session_ids)


def create_anonymous_session() -> dict[str, str]:
    session_id, token, created_at, idle_expires_at, absolute_expires_at = new_session_record(
        SESSION_IDLE_TTL_MINUTES,
        SESSION_MAX_TTL_HOURS,
    )
    with db() as connection:
        connection.execute(
            "INSERT INTO anonymous_sessions(id, token_hash, created_at, last_seen_at, idle_expires_at, absolute_expires_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (session_id, hash_session_token(token), created_at, created_at, idle_expires_at, absolute_expires_at),
        )
    return {"session_token": token, "idle_expires_at": idle_expires_at, "absolute_expires_at": absolute_expires_at}


def get_current_session(
    session_token: str | None = Cookie(default=None, alias="knee_session"),
) -> AnonymousSession:
    cleanup_expired_sessions()
    if not session_token or len(session_token) > 256:
        raise HTTPException(401, "Temporary session required")
    now_dt = utc_now()
    now_stamp = format_timestamp(now_dt)
    with db() as connection:
        row = connection.execute(
            "SELECT id, idle_expires_at, absolute_expires_at FROM anonymous_sessions WHERE token_hash = ?",
            (hash_session_token(session_token),),
        ).fetchone()
        if not row or row["idle_expires_at"] <= now_stamp or row["absolute_expires_at"] <= now_stamp:
            raise HTTPException(401, "Temporary session expired; start a new session")
        absolute_expiration = datetime.fromisoformat(row["absolute_expires_at"])
        idle_expiration = min(now_dt + timedelta(minutes=SESSION_IDLE_TTL_MINUTES), absolute_expiration)
        connection.execute(
            "UPDATE anonymous_sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id = ?",
            (now_stamp, format_timestamp(idle_expiration), row["id"]),
        )
    return AnonymousSession(session_id=row["id"], absolute_expires_at=row["absolute_expires_at"])


def require_study_access(study_id: str, session: AnonymousSession) -> sqlite3.Row:
    with db() as connection:
        row = connection.execute("SELECT * FROM studies WHERE id = ?", (study_id,)).fetchone()
    if not row or (row["source"] != "sample" and row["owner_session_id"] != session.session_id):
        raise HTTPException(404, "Study not found")
    return row


def require_series_access(series_id: str, session: AnonymousSession) -> sqlite3.Row:
    with db() as connection:
        row = connection.execute(
            "SELECT series.id, studies.id AS study_id, studies.source, studies.owner_session_id "
            "FROM series JOIN studies ON studies.id = series.study_id WHERE series.id = ?",
            (series_id,),
        ).fetchone()
    if not row or (row["source"] != "sample" and row["owner_session_id"] != session.session_id):
        raise HTTPException(404, "Series not found")
    return row


def require_instance_access(instance_id: str, session: AnonymousSession) -> sqlite3.Row:
    with db() as connection:
        row = connection.execute(
            "SELECT instances.*, studies.source, studies.owner_session_id "
            "FROM instances JOIN series ON series.id = instances.series_id "
            "JOIN studies ON studies.id = series.study_id WHERE instances.id = ?",
            (instance_id,),
        ).fetchone()
    if not row or (row["source"] != "sample" and row["owner_session_id"] != session.session_id):
        raise HTTPException(404, "DICOM instance not found")
    return row


def clean(value: Any) -> str:
    if value is None:
        return ""
    return str(value).replace("\x00", "").strip()


def dicom_number(value: Any, default: float = 0.0) -> float:
    """Read a numeric DICOM value, including pydicom multi-value fields."""
    candidate: Any = value
    if isinstance(value, Iterable) and not isinstance(value, (str, bytes)):
        candidate = next(iter(value), default)
    try:
        return float(candidate)
    except (TypeError, ValueError):
        return default


def as_float_list(value: Any) -> list[float]:
    try:
        return [float(x) for x in value]
    except (TypeError, ValueError):
        return []


def cross(a: list[float], b: list[float]) -> list[float]:
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def unit_vector(values: list[float]) -> list[float] | None:
    if len(values) != 3:
        return None
    norm = float(np.linalg.norm(np.array(values, dtype=float)))
    if norm <= GEOMETRY_TOLERANCE:
        return None
    return [float(value / norm) for value in values]


def close_vector(left: list[float] | None, right: list[float] | None) -> bool:
    return bool(left and right and len(left) == len(right) and np.allclose(left, right, atol=GEOMETRY_TOLERANCE, rtol=0))


def geometry_from_dataset(ds: Any) -> dict[str, Any]:
    iop = as_float_list(getattr(ds, "ImageOrientationPatient", []))
    ipp = as_float_list(getattr(ds, "ImagePositionPatient", []))
    spacing = as_float_list(getattr(ds, "PixelSpacing", []))
    frame_uid = clean(getattr(ds, "FrameOfReferenceUID", "")) or None
    rows = int(getattr(ds, "Rows", 0) or 0)
    cols = int(getattr(ds, "Columns", 0) or 0)
    row_direction = unit_vector(iop[:3]) if len(iop) == 6 else None
    column_direction = unit_vector(iop[3:]) if len(iop) == 6 else None
    normal = unit_vector(cross(row_direction, column_direction)) if row_direction and column_direction else None
    issues: list[str] = []
    if len(iop) != 6 or not row_direction or not column_direction or abs(float(np.dot(row_direction, column_direction))) > 0.02:
        issues.append("invalid_orientation")
    if len(ipp) != 3:
        issues.append("missing_image_position")
    if len(spacing) != 2 or any(value <= 0 for value in spacing):
        issues.append("missing_pixel_spacing")
    if not rows or not cols:
        issues.append("missing_dimensions")
    has_core_geometry = bool(normal and len(ipp) == 3 and len(spacing) == 2 and all(value > 0 for value in spacing) and rows and cols)
    has_any_geometry = bool(iop or ipp or spacing)
    status = "valid" if has_core_geometry and not [issue for issue in issues if issue != "missing_frame_of_reference"] else "partial" if has_any_geometry else "unknown"
    if not frame_uid:
        issues.append("missing_frame_of_reference")
    position = float(np.dot(np.array(ipp, dtype=float), np.array(normal, dtype=float))) if len(ipp) == 3 and normal else None
    return {
        "status": status,
        "frame_of_reference_uid": frame_uid,
        "image_orientation_patient": iop if len(iop) == 6 else None,
        "image_position_patient": ipp if len(ipp) == 3 else None,
        "row_direction": row_direction,
        "column_direction": column_direction,
        "normal": normal,
        "pixel_spacing": spacing if len(spacing) == 2 else None,
        "slice_thickness": float(getattr(ds, "SliceThickness", 0) or 0) or None,
        "spacing_between_slices": float(getattr(ds, "SpacingBetweenSlices", 0) or 0) or None,
        "position": position,
        "issues": sorted(set(issues)),
    }


def plane_for(ds: Any) -> str:
    iop = as_float_list(getattr(ds, "ImageOrientationPatient", []))
    if len(iop) != 6:
        return "UNKNOWN"
    normal = cross(iop[:3], iop[3:])
    axis = int(np.argmax(np.abs(normal)))
    return ["SAG", "COR", "AX"][axis]


def physical_position(ds: Any) -> float | None:
    ipp = as_float_list(getattr(ds, "ImagePositionPatient", []))
    iop = as_float_list(getattr(ds, "ImageOrientationPatient", []))
    if len(ipp) != 3 or len(iop) != 6:
        return None
    normal = cross(iop[:3], iop[3:])
    return float(np.dot(np.array(ipp), np.array(normal)))


def parse_metadata(raw: bytes) -> dict[str, Any]:
    return metadata_from_dataset(pydicom.dcmread(io.BytesIO(raw), stop_before_pixels=True, force=False))


def parse_metadata_path(path: Path) -> dict[str, Any]:
    return metadata_from_dataset(pydicom.dcmread(path, stop_before_pixels=True, force=False))


def metadata_from_dataset(ds: Any) -> dict[str, Any]:
    study_uid = clean(getattr(ds, "StudyInstanceUID", ""))
    series_uid = clean(getattr(ds, "SeriesInstanceUID", ""))
    if not study_uid or not series_uid:
        raise ValueError("Missing StudyInstanceUID or SeriesInstanceUID")
    geometry = geometry_from_dataset(ds)
    return {
        "study_uid": study_uid,
        "series_uid": series_uid,
        "sop_uid": clean(getattr(ds, "SOPInstanceUID", "")),
        "description": clean(getattr(ds, "SeriesDescription", "")),
        "plane": plane_for(ds),
        "position": geometry["position"],
        "instance_number": int(getattr(ds, "InstanceNumber", 0) or 0),
        "rows": int(getattr(ds, "Rows", 0) or 0),
        "cols": int(getattr(ds, "Columns", 0) or 0),
        "spacing": geometry["pixel_spacing"] or [],
        "geometry": geometry,
        "geometry_status": geometry["status"],
    }


def validate_series_geometry(items: list[tuple[dict[str, Any], Path]]) -> dict[str, Any]:
    geometries = [metadata["geometry"] for metadata, _ in items]
    known = [geometry for geometry in geometries if geometry["status"] != "unknown"]
    if not known:
        return {"status": "unknown", "mapping_ready": False, "warnings": ["geometry_unavailable"]}

    warnings = sorted({issue for geometry in geometries for issue in geometry["issues"]})
    complete = all(geometry["status"] == "valid" for geometry in geometries)
    first = next((geometry for geometry in geometries if geometry["status"] == "valid"), known[0])
    conflicts: list[str] = []
    frame_uids = {geometry["frame_of_reference_uid"] for geometry in geometries if geometry["frame_of_reference_uid"]}
    planes = {metadata["plane"] for metadata, _ in items if metadata["plane"] != "UNKNOWN"}
    dimensions = {(metadata["rows"], metadata["cols"]) for metadata, _ in items if metadata["rows"] and metadata["cols"]}
    orientations = [geometry["image_orientation_patient"] for geometry in geometries if geometry["image_orientation_patient"]]
    spacings = [geometry["pixel_spacing"] for geometry in geometries if geometry["pixel_spacing"]]
    if len(frame_uids) > 1:
        conflicts.append("frame_of_reference_mismatch")
    if len(planes) > 1:
        conflicts.append("plane_mismatch")
    if len(dimensions) > 1:
        conflicts.append("dimension_mismatch")
    if orientations and any(not close_vector(orientation, orientations[0]) for orientation in orientations[1:]):
        conflicts.append("orientation_mismatch")
    if spacings and any(not close_vector(spacing, spacings[0]) for spacing in spacings[1:]):
        conflicts.append("pixel_spacing_mismatch")
    positions = sorted(geometry["position"] for geometry in geometries if geometry["position"] is not None)
    if len(positions) > 1:
        position_diffs = np.diff(np.array(positions, dtype=float))
        if any(abs(float(diff)) <= GEOMETRY_TOLERANCE for diff in position_diffs):
            conflicts.append("duplicate_slice_position")
        positive_diffs = [abs(float(diff)) for diff in position_diffs if abs(float(diff)) > GEOMETRY_TOLERANCE]
        slice_spacing = float(np.median(positive_diffs)) if positive_diffs else None
    else:
        slice_spacing = None
    status = "incompatible" if conflicts else "valid" if complete else "partial"
    warnings = sorted(set(warnings + conflicts))
    series_geometry_ready = status == "valid"
    if status == "valid" and not frame_uids:
        warnings.append("missing_frame_of_reference")
    return {
        "status": status,
        "series_geometry_ready": series_geometry_ready,
        "mapping_ready": False,
        "frame_of_reference_uid": next(iter(frame_uids), None),
        "image_orientation_patient": first["image_orientation_patient"],
        "normal": first["normal"],
        "position_range": [positions[0], positions[-1]] if positions else None,
        "slice_spacing": slice_spacing,
        "warnings": sorted(set(warnings)),
    }


def summarize_study_geometry(series: list[dict[str, Any]]) -> dict[str, Any]:
    geometries = [series_item.get("geometry", {}) for series_item in series]
    valid = [geometry for geometry in geometries if geometry.get("status") == "valid"]
    frame_uids = {geometry.get("frame_of_reference_uid") for geometry in valid if geometry.get("frame_of_reference_uid")}
    warnings: list[str] = []
    if not valid:
        status = "unknown"
        warnings.append("no_series_with_valid_geometry")
    elif len(valid) != len(geometries):
        status = "partial"
        warnings.append("some_series_geometry_unavailable")
    elif len(frame_uids) > 1:
        status = "incompatible"
        warnings.append("frame_of_reference_mismatch")
    else:
        status = "valid"
    mapping_ready = status == "valid" and len(valid) >= 2 and len(frame_uids) == 1
    if status == "valid" and not mapping_ready:
        warnings.append("cross_series_mapping_requires_shared_frame_of_reference")
    return {
        "status": status,
        "mapping_ready": mapping_ready,
        "valid_series_count": len(valid),
        "series_count": len(geometries),
        "frame_of_reference_uids": sorted(frame_uids),
        "warnings": sorted(set(warnings)),
    }


def study_name(ds_meta: dict[str, Any], source: str) -> str:
    if source == "sample":
        return "Example Knee Study"
    return f"Imported Study · {ds_meta['study_uid'][-8:]}"


def insert_study(
    *,
    study_uid: str,
    display_name: str,
    source: str,
    files: list[tuple[dict[str, Any], Path]],
    study_id: str | None = None,
    owner_session_id: str | None = None,
) -> str:
    study_id = study_id or f"study-{uuid.uuid4().hex[:12]}"
    grouped: dict[str, list[tuple[dict[str, Any], Path]]] = {}
    for metadata, path in files:
        grouped.setdefault(metadata["series_uid"], []).append((metadata, path))
    with db() as connection:
        connection.execute(
            "INSERT OR REPLACE INTO studies(id, study_uid, display_name, source, created_at, owner_session_id) VALUES (?, ?, ?, ?, ?, ?)",
            (study_id, study_uid, display_name, source, now(), owner_session_id),
        )
        for series_uid, items in grouped.items():
            first = items[0][0]
            series_id = f"series-{uuid.uuid4().hex[:12]}"
            series_geometry = validate_series_geometry(items)
            has_positions = all(item[0]["position"] is not None for item in items)
            sort_method = "physical_position" if has_positions else "instance_number"
            geometry_status = series_geometry["status"]
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
                    sort_method,
                    geometry_status,
                    json.dumps(series_geometry, separators=(",", ":")),
                    "lazy",
                ),
            )
            ordered = sorted(items, key=lambda item: (item[0]["position"] is None, item[0]["position"] or 0, item[0]["instance_number"]))
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


def study_payload(study_row: sqlite3.Row) -> dict[str, Any]:
    with db() as connection:
        series_rows = connection.execute("SELECT * FROM series WHERE study_id = ? ORDER BY rowid", (study_row["id"],)).fetchall()
        result_series = []
        for series_row in series_rows:
            count = connection.execute("SELECT COUNT(*) AS count FROM instances WHERE series_id = ?", (series_row["id"],)).fetchone()["count"]
            try:
                geometry = json.loads(series_row["geometry_json"] or "{}")
            except json.JSONDecodeError:
                geometry = {}
            geometry.setdefault("status", series_row["geometry_status"] or "unknown")
            geometry.setdefault("mapping_ready", False)
            result_series.append(
                {
                    "id": series_row["id"],
                    "series_uid": series_row["series_uid"],
                    "description": series_row["description"] or "DICOM series",
                    "plane": series_row["plane"],
                    "slice_count": count,
                    "rows": series_row["rows"],
                    "cols": series_row["cols"],
                    "spacing": [float(x) for x in (series_row["spacing"] or "").split(",") if x],
                    "sort_method": series_row["sort_method"] or "instance_number",
                    "geometry_status": geometry["status"],
                    "geometry": geometry,
                    "preview_status": series_row["preview_status"] or "lazy",
                }
            )
        study_geometry = summarize_study_geometry(result_series)
        return {
            "id": study_row["id"],
            "study_uid": study_row["study_uid"],
            "display_name": study_row["display_name"],
            "source": study_row["source"],
            "created_at": study_row["created_at"],
            "series": result_series,
            "total_slices": sum(series["slice_count"] for series in result_series),
            "geometry": study_geometry,
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


def seed_sample() -> None:
    if not EXAMPLES_DIR.exists():
        return
    archive = next(
        (
            candidate
            for candidate in [EXAMPLES_DIR / "results.zip", EXAMPLES_DIR / "result.zip"]
            if candidate.is_file()
        ),
        None,
    )
    with db() as connection:
        sample_row = connection.execute("SELECT id FROM studies WHERE source = 'sample' LIMIT 1").fetchone()
        if sample_row:
            sample_paths = connection.execute(
                "SELECT path FROM instances WHERE series_id IN (SELECT id FROM series WHERE study_id = ?)",
                (sample_row["id"],),
            ).fetchall()
            if sample_paths and all(Path(row["path"]).is_file() for row in sample_paths):
                return
            if archive is None:
                return
            connection.execute("DELETE FROM studies WHERE id = ?", (sample_row["id"],))
    if archive is not None:
        seed_sample_archive(archive)
        return
    dicom_files = sorted(EXAMPLES_DIR.rglob("*.dcm"))
    if not dicom_files:
        return
    parsed: list[tuple[dict[str, Any], Path]] = []
    for path in dicom_files:
        try:
            parsed.append((parse_metadata(path.read_bytes()), path.resolve()))
        except Exception:
            continue
    if not parsed:
        return
    study_uids = {item[0]["study_uid"] for item in parsed}
    if len(study_uids) != 1:
        return
    insert_study(study_uid=next(iter(study_uids)), display_name="Example Knee Study", source="sample", files=parsed, study_id="sample-knee")


def seed_sample_archive(archive: Path) -> None:
    sample_root = STORAGE_DIR / "sample-archive"
    shutil.rmtree(sample_root, ignore_errors=True)
    sample_root.mkdir(parents=True, exist_ok=True)
    parsed: list[tuple[dict[str, Any], Path]] = []
    try:
        with zipfile.ZipFile(archive) as source:
            members = [member for member in source.infolist() if not member.is_dir() and member.filename.lower().endswith(".dcm")]
            for index, member in enumerate(members):
                raw = source.read(member)
                try:
                    metadata = parse_metadata(raw)
                except Exception:
                    continue
                target = sample_root / f"slice-{index:05d}.dcm"
                target.write_bytes(raw)
                parsed.append((metadata, target.resolve()))
    except (zipfile.BadZipFile, OSError, RuntimeError):
        shutil.rmtree(sample_root, ignore_errors=True)
        return
    if not parsed or len({item[0]["study_uid"] for item in parsed}) != 1:
        shutil.rmtree(sample_root, ignore_errors=True)
        return
    insert_study(study_uid=parsed[0][0]["study_uid"], display_name="Example Knee Study", source="sample", files=parsed, study_id="sample-knee")


def refresh_geometry_records() -> None:
    """Backfill geometry for rows created before the geometry manifest existed."""
    with db() as connection:
        series_rows = connection.execute("SELECT * FROM series ORDER BY rowid").fetchall()
        for series_row in series_rows:
            instance_rows = connection.execute("SELECT * FROM instances WHERE series_id = ? ORDER BY rowid", (series_row["id"],)).fetchall()
            parsed: list[tuple[dict[str, Any], Path]] = []
            for instance_row in instance_rows:
                path = Path(instance_row["path"])
                if not path.is_file():
                    continue
                try:
                    metadata = parse_metadata(path.read_bytes())
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
            geometry = validate_series_geometry(parsed)
            sort_method = "physical_position" if all(metadata["position"] is not None for metadata, _ in parsed) else "instance_number"
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


@app.on_event("startup")
def startup() -> None:
    init_db()
    cleanup_expired_sessions()
    seed_sample()
    refresh_geometry_records()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "knee-review"}


@app.post("/api/sessions")
def start_session(response: Response, request: Request) -> dict[str, str]:
    cleanup_expired_sessions()
    session_data = create_anonymous_session()
    response.set_cookie(
        "knee_session",
        session_data.pop("session_token"),
        httponly=True,
        secure=request.url.scheme == "https" or os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true",
        samesite="lax",
        path="/api",
    )
    return session_data


@app.get("/api/sessions/current")
def current_session(session: AnonymousSession = Depends(get_current_session)) -> dict[str, str]:
    with db() as connection:
        row = connection.execute(
            "SELECT idle_expires_at FROM anonymous_sessions WHERE id = ?",
            (session.session_id,),
        ).fetchone()
    if not row:
        raise HTTPException(401, "Temporary session expired; start a new session")
    return {"idle_expires_at": row["idle_expires_at"], "absolute_expires_at": session.absolute_expires_at}


@app.delete("/api/sessions/current", status_code=204)
def clear_current_session(request: Request, session: AnonymousSession = Depends(get_current_session)) -> Response:
    with db() as connection:
        paths = connection.execute(
            "SELECT instances.path FROM instances JOIN series ON series.id = instances.series_id "
            "JOIN studies ON studies.id = series.study_id WHERE studies.owner_session_id = ?",
            (session.session_id,),
        ).fetchall()
        connection.execute("DELETE FROM anonymous_sessions WHERE id = ?", (session.session_id,))
    remove_upload_roots([row["path"] for row in paths])
    response = Response(status_code=204)
    response.delete_cookie(
        "knee_session",
        path="/api",
        secure=request.url.scheme == "https" or os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true",
        httponly=True,
        samesite="lax",
    )
    return response


@app.get("/api/studies")
def list_studies(session: AnonymousSession = Depends(get_current_session)) -> list[dict[str, Any]]:
    with db() as connection:
        rows = connection.execute(
            "SELECT * FROM studies WHERE source = 'sample' OR owner_session_id = ? ORDER BY source DESC, created_at DESC",
            (session.session_id,),
        ).fetchall()
    return [study_payload(row) for row in rows]


@app.get("/api/studies/{study_id}")
def get_study(study_id: str, session: AnonymousSession = Depends(get_current_session)) -> dict[str, Any]:
    row = require_study_access(study_id, session)
    return study_payload(row)


@app.get("/api/studies/{study_id}/pipeline")
def get_study_pipeline(study_id: str, session: AnonymousSession = Depends(get_current_session)) -> dict[str, Any]:
    row = require_study_access(study_id, session)
    return {"study_id": study_id, **study_payload(row)["pipeline"]}


@app.get("/api/series/{series_id}/geometry")
def get_series_geometry(series_id: str, session: AnonymousSession = Depends(get_current_session)) -> dict[str, Any]:
    require_series_access(series_id, session)
    with db() as connection:
        row = connection.execute("SELECT id, geometry_status, geometry_json FROM series WHERE id = ?", (series_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Series not found")
    try:
        geometry = json.loads(row["geometry_json"] or "{}")
    except json.JSONDecodeError:
        geometry = {}
    geometry.setdefault("status", row["geometry_status"] or "unknown")
    geometry.setdefault("mapping_ready", False)
    return {"series_id": row["id"], **geometry}


def session_upload_bytes(session_id: str) -> int:
    with db() as connection:
        paths = connection.execute(
            "SELECT instances.path FROM instances JOIN series ON series.id = instances.series_id "
            "JOIN studies ON studies.id = series.study_id WHERE studies.owner_session_id = ?",
            (session_id,),
        ).fetchall()
    unique_paths = {row["path"] for row in paths}
    return sum(Path(path).stat().st_size for path in unique_paths if Path(path).is_file())


@app.post("/api/studies/upload")
async def upload_study(
    files: list[UploadFile] = File(...),
    session: AnonymousSession = Depends(get_current_session),
) -> dict[str, Any]:
    upload_root = STORAGE_DIR / f"upload-{uuid.uuid4().hex[:12]}"
    try:
        accepted, rejected = await stage_and_validate_uploads(files, upload_root, parse_metadata_path)
        if not accepted:
            raise HTTPException(400, {"message": "No valid DICOM files were found", "rejected": rejected})
        accepted_bytes = sum(path.stat().st_size for _, path in accepted if path.is_file())
        if session_upload_bytes(session.session_id) + accepted_bytes > MAX_SESSION_BYTES:
            raise UploadLimitExceeded(f"Temporary session is limited to {MAX_SESSION_BYTES // (1024 * 1024)} MiB total")

        created: list[str] = []
        for study_uid in sorted({item[0]["study_uid"] for item in accepted}):
            group = [item for item in accepted if item[0]["study_uid"] == study_uid]
            created.append(
                insert_study(
                    study_uid=study_uid,
                    display_name=study_name(group[0][0], "upload"),
                    source="upload",
                    files=group,
                    owner_session_id=session.session_id,
                )
            )
        return {"study_ids": created, "accepted_files": len(accepted), "rejected": rejected}
    except UploadLimitExceeded as exc:
        shutil.rmtree(upload_root, ignore_errors=True)
        raise HTTPException(413, str(exc)) from exc
    except HTTPException:
        shutil.rmtree(upload_root, ignore_errors=True)
        raise
    except Exception:
        shutil.rmtree(upload_root, ignore_errors=True)
        raise


@app.delete("/api/studies/{study_id}")
def delete_study(study_id: str, session: AnonymousSession = Depends(get_current_session)) -> dict[str, str]:
    with db() as connection:
        row = connection.execute("SELECT * FROM studies WHERE id = ?", (study_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Study not found")
        if row["source"] == "sample":
            raise HTTPException(409, "The example study is read-only")
        if row["owner_session_id"] != session.session_id:
            raise HTTPException(404, "Study not found")
        paths = connection.execute("SELECT path FROM instances WHERE series_id IN (SELECT id FROM series WHERE study_id = ?)", (study_id,)).fetchall()
        connection.execute("DELETE FROM studies WHERE id = ?", (study_id,))
    remove_upload_roots([path["path"] for path in paths])
    return {"status": "deleted", "study_id": study_id}


@app.get("/api/series/{series_id}/slices")
def list_slices(series_id: str, session: AnonymousSession = Depends(get_current_session)) -> list[dict[str, Any]]:
    require_series_access(series_id, session)
    with db() as connection:
        rows = connection.execute("SELECT * FROM instances WHERE series_id = ? ORDER BY position IS NULL, position, instance_number, filename", (series_id,)).fetchall()
    if not rows:
        raise HTTPException(404, "Series not found")
    return [
        {
            "index": index,
            "id": row["id"],
            "filename": row["filename"],
            "instance_number": row["instance_number"],
            "position": row["position"],
            "image_url": f"/api/instances/{row['id']}/image",
            "dicom_url": f"/api/instances/{row['id']}/dicom",
        }
        for index, row in enumerate(rows)
    ]


@app.get("/api/series/{series_id}/volume")
def series_volume(series_id: str, session: AnonymousSession = Depends(get_current_session)) -> dict[str, Any]:
    require_series_access(series_id, session)
    with db() as connection:
        rows = connection.execute(
            "SELECT id, path FROM instances WHERE series_id = ? ORDER BY position IS NULL, position, instance_number, filename",
            (series_id,),
        ).fetchall()
    if not rows:
        raise HTTPException(404, "Series not found")
    try:
        headers = [pydicom.dcmread(row["path"], stop_before_pixels=True) for row in rows]
        result = volume_eligibility(headers)
    except (OSError, pydicom.errors.InvalidDicomError):
        result = {"eligible": False, "reasons": ["One or more DICOM files are unavailable."]}
    return {"series_id": series_id, **result,
            "dicom_urls": [f"/api/instances/{row['id']}/dicom" for row in rows] if result["eligible"] else []}


@app.get("/api/instances/{instance_id}/dicom")
def instance_dicom(instance_id: str, session: AnonymousSession = Depends(get_current_session)) -> FileResponse:
    row = require_instance_access(instance_id, session)
    if not row or not Path(row["path"]).is_file():
        raise HTTPException(404, "DICOM file not found")
    return FileResponse(row["path"], media_type="application/dicom", headers={"Cache-Control": "private, max-age=3600"})


@app.get("/api/instances/{instance_id}/image")
def instance_image(instance_id: str, session: AnonymousSession = Depends(get_current_session)) -> Response:
    row = require_instance_access(instance_id, session)
    path = Path(row["path"])
    if not path.is_file():
        raise HTTPException(404, "DICOM file is no longer available")
    try:
        ds = pydicom.dcmread(path)
        pixels = ds.pixel_array.astype(np.float32)
        if pixels.ndim > 2:
            pixels = pixels[0]
        pixels = pixels * float(getattr(ds, "RescaleSlope", 1) or 1) + float(getattr(ds, "RescaleIntercept", 0) or 0)
        finite = pixels[np.isfinite(pixels)]
        window_center = getattr(ds, "WindowCenter", None)
        window_width = getattr(ds, "WindowWidth", None)
        center = dicom_number(window_center)
        width = dicom_number(window_width)
        if width > 0:
            low, high = center - width / 2, center + width / 2
        else:
            percentiles = np.asarray(np.percentile(finite, [1, 99]), dtype=float)
            low, high = float(percentiles[0]), float(percentiles[1])
        if high <= low:
            low, high = float(np.min(pixels)), float(np.max(pixels) or 1)
        pixels = np.clip((pixels - low) / max(high - low, 1e-6), 0, 1)
        if clean(getattr(ds, "PhotometricInterpretation", "")) == "MONOCHROME1":
            pixels = 1 - pixels
        image = Image.fromarray((pixels * 255).astype(np.uint8), mode="L")
        output = io.BytesIO()
        image.save(output, format="PNG", optimize=True)
        return Response(output.getvalue(), media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})
    except Exception as exc:
        raise HTTPException(422, f"Unable to render DICOM image: {exc}")


if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
