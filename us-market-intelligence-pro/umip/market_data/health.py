"""Feed health tracking. A failing feed blocks signals that depend on it."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from umip.timeutil import utcnow


@dataclass
class FeedHealth:
    failure_threshold: int = 3
    heartbeat_timeout: timedelta = timedelta(seconds=30)
    _failures: dict[str, int] = field(default_factory=dict)
    _last_ok: dict[str, datetime] = field(default_factory=dict)

    def ok(self, source: str, at: datetime | None = None) -> None:
        self._failures[source] = 0
        self._last_ok[source] = at or utcnow()

    def fail(self, source: str) -> None:
        self._failures[source] = self._failures.get(source, 0) + 1

    def is_healthy(self, source: str, now: datetime | None = None) -> bool:
        now = now or utcnow()
        if self._failures.get(source, 0) >= self.failure_threshold:
            return False
        last = self._last_ok.get(source)
        return last is not None and now - last <= self.heartbeat_timeout

    def snapshot(self, now: datetime | None = None) -> dict[str, dict]:
        now = now or utcnow()
        return {s: {"healthy": self.is_healthy(s, now), "failures": self._failures.get(s, 0),
                    "last_ok": self._last_ok[s].isoformat() if s in self._last_ok else None}
                for s in set(self._failures) | set(self._last_ok)}
