from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


@dataclass(frozen=True)
class AnonymousSession:
    session_id: str
    absolute_expires_at: str


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def format_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_session_record(idle_minutes: int, max_hours: int) -> tuple[str, str, str, str, str]:
    now = utc_now()
    session_id = str(uuid.uuid4())
    token = new_session_token()
    created_at = format_timestamp(now)
    idle_expires_at = format_timestamp(now + timedelta(minutes=idle_minutes))
    absolute_expires_at = format_timestamp(now + timedelta(hours=max_hours))
    return session_id, token, created_at, idle_expires_at, absolute_expires_at
