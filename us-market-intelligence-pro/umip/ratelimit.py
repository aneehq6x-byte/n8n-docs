"""Fixed-window rate limiting with a Redis backend (shared across instances) or an
in-memory fallback (single instance / tests)."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Limit:
    count: int
    window_s: int


@dataclass(frozen=True)
class Verdict:
    allowed: bool
    remaining: int
    retry_after: int


class RateLimiter(Protocol):
    async def hit(self, bucket: str, limit: Limit) -> Verdict: ...
    async def peek(self, bucket: str, limit: Limit) -> Verdict: ...


class MemoryRateLimiter:
    def __init__(self, clock=time.time):
        self._clock = clock
        self._counts: dict[str, tuple[int, int]] = {}  # bucket -> (window index, count)

    def _verdict(self, used: int, limit: Limit, now: float) -> Verdict:
        retry = int(limit.window_s - (now % limit.window_s)) + 1
        return Verdict(used <= limit.count, max(0, limit.count - used), 0 if used <= limit.count else retry)

    async def hit(self, bucket: str, limit: Limit) -> Verdict:
        now = self._clock()
        win = int(now // limit.window_s)
        w, c = self._counts.get(bucket, (win, 0))
        c = c + 1 if w == win else 1
        self._counts[bucket] = (win, c)
        if len(self._counts) > 50_000:  # bounded memory: drop stale windows
            self._counts = {k: v for k, v in self._counts.items() if v[0] >= win - 1}
        return self._verdict(c, limit, now)

    async def peek(self, bucket: str, limit: Limit) -> Verdict:
        now = self._clock()
        w, c = self._counts.get(bucket, (int(now // limit.window_s), 0))
        used = c if w == int(now // limit.window_s) else 0
        # peek reports whether one more request would still be allowed
        return Verdict(used < limit.count, max(0, limit.count - used),
                       0 if used < limit.count else int(limit.window_s - (now % limit.window_s)) + 1)


class RedisRateLimiter:
    def __init__(self, url: str, prefix: str = "umip:rl:"):
        from redis.asyncio import Redis

        self._r = Redis.from_url(url)
        self._p = prefix

    def _key(self, bucket: str, limit: Limit) -> tuple[str, int]:
        now = time.time()
        return f"{self._p}{bucket}:{int(now // limit.window_s)}", int(limit.window_s - (now % limit.window_s)) + 1

    async def hit(self, bucket: str, limit: Limit) -> Verdict:
        key, retry = self._key(bucket, limit)
        async with self._r.pipeline(transaction=True) as p:
            used, _ = await p.incr(key).expire(key, limit.window_s + 1).execute()
        return Verdict(used <= limit.count, max(0, limit.count - used), 0 if used <= limit.count else retry)

    async def peek(self, bucket: str, limit: Limit) -> Verdict:
        key, retry = self._key(bucket, limit)
        used = int(await self._r.get(key) or 0)
        return Verdict(used < limit.count, max(0, limit.count - used), 0 if used < limit.count else retry)


def build_limiter(redis_url: str | None) -> RateLimiter:
    return RedisRateLimiter(redis_url) if redis_url else MemoryRateLimiter()
