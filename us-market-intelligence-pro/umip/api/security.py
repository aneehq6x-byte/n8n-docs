"""RBAC and rate limiting for the admin API.

Keys are configured (UMIP_ADMIN_API_KEYS) as ``{"sha256:<hex>": "<role>"}`` so the
configuration never holds a usable key; plaintext entries are accepted only outside
production. Generate a key with ``python -m umip.main new-admin-key``.

Role hierarchy: admin > analyst > support. The actor recorded in audit logs is
``admin:<role>:<first 8 hex of the key hash>`` — never part of the key itself.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

from fastapi import Depends, Header, HTTPException, Request, status

from umip.ratelimit import Limit

RANK = {"support": 1, "analyst": 2, "admin": 3}
HASH_PREFIX = "sha256:"
AUTH_FAIL_LIMIT = Limit(10, 600)  # 10 failed keys per client per 10 minutes


def hash_key(key: str) -> str:
    return HASH_PREFIX + hashlib.sha256(key.encode()).hexdigest()


def new_key() -> tuple[str, str]:
    key = "umip_" + secrets.token_urlsafe(32)
    return key, hash_key(key)


def is_hashed(entry: str) -> bool:
    return entry.startswith(HASH_PREFIX) and len(entry) == len(HASH_PREFIX) + 64


def lookup(keys: dict[str, str], presented: str) -> tuple[str, str] | None:
    """Return (role, key_id) for a presented key, comparing hashes in constant time."""
    digest = hash_key(presented)
    found = None
    for entry, role in keys.items():
        candidate = entry if is_hashed(entry) else hash_key(entry)
        if hmac.compare_digest(candidate.encode(), digest.encode()):
            found = (role, digest[len(HASH_PREFIX):][:8])
    return found


def client_ip(request: Request) -> str:
    settings = request.app.state.settings
    if settings.trust_forwarded_for:
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"


def require_role(min_role: str):
    async def dep(request: Request, x_api_key: str = Header(default="")) -> str:
        limiter = request.app.state.limiter
        bucket = f"authfail:{client_ip(request)}"
        v = await limiter.peek(bucket, AUTH_FAIL_LIMIT)
        if not v.allowed:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "too many failed attempts",
                                headers={"Retry-After": str(v.retry_after)})
        keys: dict[str, str] = request.app.state.settings.admin_api_keys
        hit = lookup(keys, x_api_key) if x_api_key else None
        if hit is None:
            await limiter.hit(bucket, AUTH_FAIL_LIMIT)
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid api key")
        role, key_id = hit
        if RANK.get(role, 0) < RANK[min_role]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")
        return f"admin:{role}:{key_id}"

    return Depends(dep)
