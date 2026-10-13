from __future__ import annotations

import hmac
import logging
import os
import shutil
import sqlite3
import sys
import time
import uuid
from collections.abc import Iterable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import Cookie, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from backend.api.analysis import build_router as build_analysis_router
from backend.api.series import build_router as build_series_router
from backend.api.sessions import build_router as build_session_router
from backend.api.studies import build_router as build_studies_router
from backend.api.system import build_router as build_system_router
from backend.api.uploads import build_router as build_uploads_router
from backend.dicom_metadata import (
    parse_metadata,  # noqa: F401 - injected into example and geometry services
    parse_metadata_path,  # noqa: F401 - route modules receive this service from main
    validate_series_geometry,  # noqa: F401 - injected into the geometry backfill service
)
from backend.dicom_rendering import render_preview  # noqa: F401
from backend.example_study import seed_example, seed_example_archive
from backend.geometry_backfill import refresh_geometry_records as backfill_geometry_records
from backend.ingest import MAX_SESSION_BYTES, UploadLimitExceeded, stage_and_validate_uploads  # noqa: F401
from backend.session_token import AnonymousSession, format_timestamp, hash_session_token, new_session_record, utc_now
from backend.study_catalog import StudyCatalog
from backend.volume_geometry import volume_eligibility  # noqa: F401

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data"))
DB_PATH = DATA_DIR / "knee.sqlite3"
STORAGE_DIR = DATA_DIR / "studies"
EXAMPLES_DIR = Path(os.getenv("EXAMPLES_DIR", ROOT.parent / "dicom-viewer" / "files"))
STATIC_DIR = ROOT / "frontend" / "dist"

DATA_DIR.mkdir(parents=True, exist_ok=True)
STORAGE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Knee Review API", version="0.1.0")
logger = logging.getLogger("knee_review.cleanup")
allowed_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Knee-Session"],
)


@app.middleware("http")
async def protect_staging_api(request: Request, call_next: Any) -> Response:
    expected_token = os.getenv("STAGING_GATE_TOKEN", "")
    if (
        expected_token
        and request.url.path.startswith("/api/")
        and request.url.path != "/api/health"
        and not hmac.compare_digest(request.headers.get("x-knee-staging-gate", ""), expected_token)
    ):
        return JSONResponse({"detail": "Staging access is restricted"}, status_code=403)
    return await call_next(request)


@app.middleware("http")
async def protect_cloud_mutations(request: Request, call_next: Any) -> Response:
    if cloud_mode() and request.method in {"POST", "DELETE"} and request.url.path.startswith("/api/"):
        origin = request.headers.get("origin")
        if origin not in allowed_origins:
            return JSONResponse({"detail": "Request origin is not allowed"}, status_code=403)
    return await call_next(request)


SESSION_IDLE_TTL_MINUTES = max(1, int(os.getenv("SESSION_IDLE_TTL_MINUTES", "60")))
SESSION_MAX_TTL_HOURS = max(1, int(os.getenv("SESSION_MAX_TTL_HOURS", "4")))
MAX_UPLOAD_BYTES = max(1, int(os.getenv("MAX_UPLOAD_MIB", "600"))) * 1024 * 1024
METADATA_BACKEND = os.getenv("METADATA_BACKEND", "sqlite").strip().lower()
if METADATA_BACKEND not in {"sqlite", "firestore"}:
    raise RuntimeError("METADATA_BACKEND must be either 'sqlite' or 'firestore'")
_firestore_metadata: Any | None = None
_object_store: Any | None = None
_last_cloud_cleanup = 0.0


def cloud_mode() -> bool:
    return METADATA_BACKEND == "firestore"


def metadata_store() -> Any:
    global _firestore_metadata
    if _firestore_metadata is None:
        from backend.firestore_metadata import FirestoreMetadata

        _firestore_metadata = FirestoreMetadata()
    return _firestore_metadata


def object_store() -> Any:
    global _object_store
    if _object_store is None:
        from backend.cloud_storage import DicomObjectStore

        _object_store = DicomObjectStore()
    return _object_store


def api_url(path: str) -> str:
    public_api_url = os.getenv("PUBLIC_API_BASE_URL", "").rstrip("/")
    return f"{public_api_url}{path}" if public_api_url else path


def local_dicom_path(path: str) -> Path:
    if not path.startswith("gs://"):
        return Path(path)
    cache_root = Path(os.getenv("DICOM_CACHE_DIR", "/tmp/knee-dicom-cache"))
    cache_path = cache_root / f"{uuid.uuid5(uuid.NAMESPACE_URL, path).hex}.dcm"
    if not cache_path.is_file():
        object_store().download_file(path, cache_path)
    return cache_path


def delete_stored_paths(paths: Iterable[str]) -> None:
    for stored_path in paths:
        if stored_path.startswith("gs://"):
            try:
                object_store().delete_uri(stored_path)
            except Exception:
                # Object lifecycle is a backstop for objects whose delete races expiry.
                pass
        else:
            Path(stored_path).unlink(missing_ok=True)


def delete_cloud_study_data(study_id: str) -> int:
    """Delete GCS objects first, then metadata, so failed object deletion is retryable."""
    store = metadata_store()
    study = store.get_study(study_id)
    if not study:
        return 0
    series_rows, instances = store.study_artifacts(study_id)
    for instance in instances:
        object_store().delete_uri(instance["path"])
    store.delete_study_metadata(study_id, series_rows, instances)
    return len(instances)


def delete_cloud_pending_upload(upload: dict[str, Any]) -> None:
    store = metadata_store()
    object_store().delete_uri(f"gs://{object_store().bucket_name}/{upload['object_name']}")
    store.delete_pending_upload(upload["id"])


def db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
    if cloud_mode():
        return
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
            connection.execute(
                "ALTER TABLE studies ADD COLUMN owner_session_id TEXT REFERENCES anonymous_sessions(id) ON DELETE CASCADE"
            )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_studies_session_created ON studies(owner_session_id, created_at)"
        )


def remove_upload_roots(paths: list[str]) -> None:
    cloud_paths = [path for path in paths if path.startswith("gs://")]
    delete_stored_paths(cloud_paths)
    paths = [path for path in paths if not path.startswith("gs://")]
    roots = {Path(path).parents[2] for path in paths if path}
    for root in roots:
        if root.name.startswith("upload-") and root.is_dir():
            shutil.rmtree(root, ignore_errors=True)


def cleanup_expired_sessions(force: bool = False, limit: int = 20) -> dict[str, int]:
    global _last_cloud_cleanup
    if cloud_mode():
        current = time.monotonic()
        if not force and current - _last_cloud_cleanup < 300:
            return {"sessions_deleted": 0, "objects_deleted": 0, "failures": 0}
        _last_cloud_cleanup = current
    stamp = format_timestamp(utc_now())
    if cloud_mode():
        store = metadata_store()
        expired = store.expired_sessions(stamp, limit=limit)
        sessions_deleted = 0
        objects_deleted = 0
        failures = 0
        for session in expired:
            session_id = session.get("id", "")
            if not session_id:
                failures += 1
                continue
            try:
                for study in store.session_studies(session_id):
                    objects_deleted += delete_cloud_study_data(study["id"])
                for upload in store.session_pending_uploads(session_id):
                    delete_cloud_pending_upload(upload)
                    objects_deleted += 1
                store.delete_session(session_id)
                sessions_deleted += 1
            except Exception:
                logger.exception("Expired session cleanup failed for hashed session id")
                failures += 1
        return {"sessions_deleted": sessions_deleted, "objects_deleted": objects_deleted, "failures": failures}
    with db() as connection:
        expired = connection.execute(
            "SELECT id FROM anonymous_sessions WHERE idle_expires_at <= ? OR absolute_expires_at <= ?",
            (stamp, stamp),
        ).fetchall()
        session_ids = [row["id"] for row in expired]
        if not session_ids:
            return {"sessions_deleted": 0, "objects_deleted": 0, "failures": 0}
        placeholders = ",".join("?" for _ in session_ids)
        path_rows = connection.execute(
            f"SELECT instances.path FROM instances JOIN series ON series.id = instances.series_id "
            f"JOIN studies ON studies.id = series.study_id WHERE studies.owner_session_id IN ({placeholders})",
            session_ids,
        ).fetchall()
        connection.execute(f"DELETE FROM anonymous_sessions WHERE id IN ({placeholders})", session_ids)
    remove_upload_roots([row["path"] for row in path_rows])
    return {"sessions_deleted": len(session_ids), "objects_deleted": len(path_rows), "failures": 0}


def create_anonymous_session() -> dict[str, str]:
    session_id, token, created_at, idle_expires_at, absolute_expires_at = new_session_record(
        SESSION_IDLE_TTL_MINUTES,
        SESSION_MAX_TTL_HOURS,
    )
    if cloud_mode():
        metadata_store().create_session(
            session_id,
            {
                "id": session_id,
                "token_hash": hash_session_token(token),
                "created_at": created_at,
                "last_seen_at": created_at,
                "idle_expires_at": idle_expires_at,
                "absolute_expires_at": absolute_expires_at,
            },
        )
        return {"session_token": token, "idle_expires_at": idle_expires_at, "absolute_expires_at": absolute_expires_at}
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
    if cloud_mode():
        row = metadata_store().session_by_token_hash(hash_session_token(session_token))
        if not row or row["idle_expires_at"] <= now_stamp or row["absolute_expires_at"] <= now_stamp:
            raise HTTPException(401, "Temporary session expired; start a new session")
        absolute_expiration = datetime.fromisoformat(row["absolute_expires_at"])
        idle_expiration = min(now_dt + timedelta(minutes=SESSION_IDLE_TTL_MINUTES), absolute_expiration)
        metadata_store().touch_session(row["id"], now_stamp, format_timestamp(idle_expiration))
        return AnonymousSession(session_id=row["id"], absolute_expires_at=row["absolute_expires_at"])
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


def require_study_access(study_id: str, session: AnonymousSession) -> Any:
    if cloud_mode():
        row = metadata_store().get_study(study_id)
        if not row or (row["source"] != "sample" and row.get("owner_session_id") != session.session_id):
            raise HTTPException(404, "Study not found")
        return row
    with db() as connection:
        row = connection.execute("SELECT * FROM studies WHERE id = ?", (study_id,)).fetchone()
    if not row or (row["source"] != "sample" and row["owner_session_id"] != session.session_id):
        raise HTTPException(404, "Study not found")
    return row


def require_series_access(series_id: str, session: AnonymousSession) -> Any:
    if cloud_mode():
        row = metadata_store().get_series(series_id)
        study = metadata_store().get_study(row["study_id"]) if row else None
        if (
            not row
            or not study
            or (study["source"] != "sample" and study.get("owner_session_id") != session.session_id)
        ):
            raise HTTPException(404, "Series not found")
        return {**row, "source": study["source"], "owner_session_id": study.get("owner_session_id")}
    with db() as connection:
        row = connection.execute(
            "SELECT series.id, studies.id AS study_id, studies.source, studies.owner_session_id "
            "FROM series JOIN studies ON studies.id = series.study_id WHERE series.id = ?",
            (series_id,),
        ).fetchone()
    if not row or (row["source"] != "sample" and row["owner_session_id"] != session.session_id):
        raise HTTPException(404, "Series not found")
    return row


def require_instance_access(instance_id: str, session: AnonymousSession) -> Any:
    if cloud_mode():
        row = metadata_store().get_instance(instance_id)
        series = metadata_store().get_series(row["series_id"]) if row else None
        study = metadata_store().get_study(series["study_id"]) if series else None
        if (
            not row
            or not study
            or (study["source"] != "sample" and study.get("owner_session_id") != session.session_id)
        ):
            raise HTTPException(404, "DICOM instance not found")
        return {**row, "source": study["source"], "owner_session_id": study.get("owner_session_id")}
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


def study_name(ds_meta: dict[str, Any], source: str) -> str:
    if source == "sample":
        return "Example Knee Study"
    return f"Imported Study · {ds_meta['study_uid'][-8:]}"


def _catalog() -> StudyCatalog:
    return StudyCatalog(sys.modules[__name__])


def insert_study(**kwargs: Any) -> str:
    return _catalog().insert_study(**kwargs)


def study_payload(study_row: Any) -> dict[str, Any]:
    return _catalog().payload(study_row)


def seed_sample() -> None:
    seed_example(sys.modules[__name__])


def seed_sample_archive(archive: Path) -> None:
    seed_example_archive(sys.modules[__name__], archive)


def refresh_geometry_records() -> None:
    backfill_geometry_records(sys.modules[__name__])


@app.on_event("startup")
def startup() -> None:
    init_db()
    cleanup_expired_sessions()
    seed_sample()
    refresh_geometry_records()


app.include_router(build_system_router(sys.modules[__name__]))
app.include_router(build_session_router(sys.modules[__name__]))
app.include_router(build_analysis_router(sys.modules[__name__]))
app.include_router(build_studies_router(sys.modules[__name__]))
app.include_router(build_uploads_router(sys.modules[__name__]))
app.include_router(build_series_router(sys.modules[__name__]))


if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
