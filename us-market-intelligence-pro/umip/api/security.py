"""RBAC for the admin API. API keys are configured via env, mapped to roles.

Role hierarchy: admin > analyst > support. Production should put the admin API
behind SSO/VPN as well (see docs/SECURITY.md).
"""

from __future__ import annotations

import hmac

from fastapi import Depends, Header, HTTPException, Request, status

RANK = {"support": 1, "analyst": 2, "admin": 3}


def _lookup(keys: dict[str, str], presented: str) -> str | None:
    for key, role in keys.items():
        if hmac.compare_digest(key.encode(), presented.encode()):
            return role
    return None


def require_role(min_role: str):
    async def dep(request: Request, x_api_key: str = Header(default="")) -> str:
        keys: dict[str, str] = request.app.state.settings.admin_api_keys
        role = _lookup(keys, x_api_key) if x_api_key else None
        if role is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid api key")
        if RANK.get(role, 0) < RANK[min_role]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")
        return f"admin:{role}:{x_api_key[-4:]}"

    return Depends(dep)
