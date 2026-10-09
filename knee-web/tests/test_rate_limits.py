from __future__ import annotations

from typing import Any

import pytest
from fastapi import HTTPException

from backend.rate_limits import enforce_fixed_window


class InMemoryRateStore:
    def __init__(self) -> None:
        self.counts: dict[str, int] = {}

    def consume_rate_limit(self, counter_id: str, limit: int, expires_at: Any) -> bool:
        count = self.counts.get(counter_id, 0)
        if count >= limit:
            return False
        self.counts[counter_id] = count + 1
        return True


def test_fixed_window_allows_limit_then_returns_429_with_retry_after() -> None:
    store = InMemoryRateStore()
    for _ in range(2):
        enforce_fixed_window(
            store,
            scope="test",
            actor_id="session-a",
            limit=2,
            window_seconds=60,
            now_epoch=121,
        )

    with pytest.raises(HTTPException) as error:
        enforce_fixed_window(
            store,
            scope="test",
            actor_id="session-a",
            limit=2,
            window_seconds=60,
            now_epoch=121,
        )

    assert error.value.status_code == 429
    assert error.value.headers["Retry-After"] == "59"


def test_fixed_window_separates_actor_and_window() -> None:
    store = InMemoryRateStore()
    for actor, stamp in (("session-a", 121), ("session-b", 121), ("session-a", 181)):
        enforce_fixed_window(
            store,
            scope="test",
            actor_id=actor,
            limit=1,
            window_seconds=60,
            now_epoch=stamp,
        )
