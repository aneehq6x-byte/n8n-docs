from __future__ import annotations

import httpx
import pytest
from pydantic import SecretStr

from umip.api.app import create_app
from umip.api.security import AUTH_FAIL_LIMIT, hash_key, is_hashed, lookup, new_key
from umip.config import Settings
from umip.ratelimit import Limit, MemoryRateLimiter


def test_keys_are_stored_as_hashes_and_matched():
    key, digest = new_key()
    assert key.startswith("umip_") and len(key) > 40 and is_hashed(digest)
    keys = {digest: "admin", "plain-dev-key": "support"}
    role, key_id = lookup(keys, key)
    assert role == "admin" and key_id == digest[7:15]
    assert lookup(keys, "plain-dev-key")[0] == "support"
    assert lookup(keys, key[:-1]) is None and lookup(keys, digest) is None  # the hash itself is not a key


def test_production_rejects_plaintext_keys_and_missing_redis():
    s = Settings(env="prod", admin_api_keys={"plain": "admin"})
    problems = s.require_production_safety()
    assert any("sha256" in p for p in problems) and any("REDIS" in p for p in problems)
    _, digest = new_key()
    ok = Settings(env="prod", admin_api_keys={digest: "admin"}, redis_url="redis://x")
    assert not any("sha256" in p or "REDIS" in p for p in ok.require_production_safety())


async def test_memory_limiter_fixed_window():
    t = [1000.0]
    lim = MemoryRateLimiter(clock=lambda: t[0])
    limit = Limit(3, 60)
    assert [(await lim.hit("k", limit)).allowed for _ in range(4)] == [True, True, True, False]
    v = await lim.peek("k", limit)
    assert not v.allowed and 0 < v.retry_after <= 61
    t[0] += 60
    assert (await lim.hit("k", limit)).allowed


def _app(maker, **kw):
    settings = Settings(env="test", admin_api_keys={hash_key("good-key-123456"): "admin"},
                        telegram_webhook_secret=SecretStr("whsec"), **kw)
    return create_app(settings, maker=maker, limiter=MemoryRateLimiter())


async def test_failed_key_attempts_are_locked_out(maker):
    app = _app(maker)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        for _ in range(AUTH_FAIL_LIMIT.count):
            assert (await c.get("/admin/me", headers={"X-API-Key": "guess"})).status_code == 401
        r = await c.get("/admin/me", headers={"X-API-Key": "guess"})
        assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0
        # even the right key is refused from a locked-out client until the window passes
        assert (await c.get("/admin/me", headers={"X-API-Key": "good-key-123456"})).status_code == 429


async def test_general_admin_and_webhook_rate_limits(maker):
    app = _app(maker, admin_rate_per_minute=3, webhook_rate_per_minute=2)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        codes = [(await c.get("/admin/me", headers={"X-API-Key": "good-key-123456"})).status_code for _ in range(4)]
        assert codes == [200, 200, 200, 429]
        hooks = [(await c.post("/telegram/webhook", json={})).status_code for _ in range(3)]
        assert hooks[-1] == 429
        assert (await c.get("/health")).status_code == 200  # health is not limited


async def test_admins_sharing_one_ip_have_separate_limits(maker):
    settings = Settings(env="test", admin_api_keys={hash_key("key-a-123456"): "admin", hash_key("key-b-123456"): "admin"},
                        admin_rate_per_minute=2)
    app = create_app(settings, maker=maker, limiter=MemoryRateLimiter())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        a = [(await c.get("/admin/me", headers={"X-API-Key": "key-a-123456"})).status_code for _ in range(3)]
        b = (await c.get("/admin/me", headers={"X-API-Key": "key-b-123456"})).status_code
        assert a == [200, 200, 429] and b == 200


async def test_forwarded_for_is_ignored_unless_trusted(maker):
    # failed-key lockout is per client IP: a spoofed header must not reset it
    app = _app(maker)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        for i in range(AUTH_FAIL_LIMIT.count):
            await c.get("/admin/me", headers={"X-API-Key": f"guess{i}", "X-Forwarded-For": f"10.0.0.{i}"})
        r = await c.get("/admin/me", headers={"X-API-Key": "guess", "X-Forwarded-For": "10.9.9.9"})
        assert r.status_code == 429
    trusted = _app(maker, trust_forwarded_for=True)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=trusted), base_url="http://t") as c:
        for i in range(AUTH_FAIL_LIMIT.count):
            await c.get("/admin/me", headers={"X-API-Key": "guess", "X-Forwarded-For": "10.0.0.1"})
        locked = await c.get("/admin/me", headers={"X-API-Key": "good-key-123456", "X-Forwarded-For": "10.0.0.1"})
        other = await c.get("/admin/me", headers={"X-API-Key": "good-key-123456", "X-Forwarded-For": "10.0.0.2"})
        assert locked.status_code == 429 and other.status_code == 200


async def test_redis_limiter_shares_state_across_instances():
    import os
    import secrets

    from umip.ratelimit import RedisRateLimiter
    url = os.environ.get("UMIP_TEST_REDIS_URL", "redis://127.0.0.1:6379/15")
    a, b = RedisRateLimiter(url), RedisRateLimiter(url)
    try:
        await a._r.ping()
    except Exception:
        pytest.skip("no redis available")
    bucket, limit = f"t-{secrets.token_hex(4)}", Limit(2, 60)
    assert (await a.hit(bucket, limit)).allowed and (await b.hit(bucket, limit)).allowed
    assert not (await a.hit(bucket, limit)).allowed  # second instance saw the first one's hits
    assert not (await b.peek(bucket, limit)).allowed
