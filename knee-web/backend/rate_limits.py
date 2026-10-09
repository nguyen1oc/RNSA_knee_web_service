from __future__ import annotations

import hashlib
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException


def enforce_fixed_window(
    store: Any,
    *,
    scope: str,
    actor_id: str,
    limit: int,
    window_seconds: int,
    now_epoch: int | None = None,
) -> None:
    """Enforce a distributed fixed-window limit using the configured metadata store."""
    current_epoch = int(time.time()) if now_epoch is None else now_epoch
    window_start = current_epoch // window_seconds * window_seconds
    retry_after = max(1, window_start + window_seconds - current_epoch)
    raw_key = f"{scope}:{actor_id}:{window_start}"
    counter_id = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()
    expires_at = datetime.fromtimestamp(window_start + window_seconds + 2 * 86400, timezone.utc)

    if not store.consume_rate_limit(counter_id, limit, expires_at):
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please wait and try again.",
            headers={"Retry-After": str(retry_after)},
        )


def enforce_upload_limits(store: Any, session_id: str, now_epoch: int | None = None) -> None:
    enforce_fixed_window(
        store,
        scope="upload-init-minute",
        actor_id=session_id,
        limit=5,
        window_seconds=60,
        now_epoch=now_epoch,
    )
    enforce_fixed_window(
        store,
        scope="upload-init-hour",
        actor_id=session_id,
        limit=30,
        window_seconds=3600,
        now_epoch=now_epoch,
    )


def enforce_finalize_limits(store: Any, session_id: str, now_epoch: int | None = None) -> None:
    enforce_fixed_window(
        store,
        scope="finalize-ten-minutes",
        actor_id=session_id,
        limit=3,
        window_seconds=600,
        now_epoch=now_epoch,
    )
