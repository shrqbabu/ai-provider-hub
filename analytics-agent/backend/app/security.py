"""Authentication & authorization.

Trust chain:

    Supabase Auth issues the JWT
        -> we verify the signature (HS256 project secret) or, if no secret is
           configured, we validate the token against Supabase `/auth/v1/user`
        -> we look the user up in `profiles` **server-side**
        -> access requires `profiles.role = 'admin'`

Authorization never reads `user_metadata` / `app_metadata` role claims, because
those can be influenced by client-side signup flows. The `profiles` table is
writable only by the service role (see the migrations), so it is the single
server-controlled authority.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx

from .config import Settings, get_settings
from .store import get_store

log = logging.getLogger(__name__)

ADMIN_ROLE = "admin"


class AuthError(Exception):
    def __init__(self, message: str, status: int = 401, code: str = "UNAUTHENTICATED") -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


@dataclass(frozen=True)
class Principal:
    id: str
    email: str
    role: str

    @property
    def is_admin(self) -> bool:
        return self.role == ADMIN_ROLE


def _b64url_decode(segment: str) -> bytes:
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


def decode_jwt_hs256(token: str, secret: str, *, verify_exp: bool = True) -> Dict[str, Any]:
    parts = token.split(".")
    if len(parts) != 3:
        raise AuthError("Malformed token")
    header_b64, payload_b64, signature_b64 = parts
    try:
        header = json.loads(_b64url_decode(header_b64))
        payload = json.loads(_b64url_decode(payload_b64))
        signature = _b64url_decode(signature_b64)
    except Exception as exc:  # noqa: BLE001
        raise AuthError("Malformed token") from exc

    if header.get("alg") != "HS256":
        raise AuthError(f"Unsupported token algorithm: {header.get('alg')}")

    expected = hmac.new(
        secret.encode("utf-8"), f"{header_b64}.{payload_b64}".encode("utf-8"), hashlib.sha256
    ).digest()
    if not hmac.compare_digest(expected, signature):
        raise AuthError("Invalid token signature")

    exp = payload.get("exp")
    if verify_exp and exp is not None and float(exp) < time.time():
        raise AuthError("Session expired", code="SESSION_EXPIRED")
    return payload


def _verify_remote(token: str, settings: Settings) -> Dict[str, Any]:
    """Fallback verification: ask Supabase who this token belongs to."""
    if not settings.supabase_url:
        raise AuthError("Auth backend not configured", status=503, code="AUTH_UNAVAILABLE")
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                f"{settings.supabase_url.rstrip('/')}/auth/v1/user",
                headers={
                    "Authorization": f"Bearer {token}",
                    "apikey": settings.supabase_publishable_key or settings.supabase_service_role_key,
                },
            )
    except httpx.HTTPError as exc:
        raise AuthError("Auth backend unreachable", status=503, code="AUTH_UNAVAILABLE") from exc
    if resp.status_code == 401:
        raise AuthError("Session expired or invalid", code="SESSION_EXPIRED")
    if resp.status_code >= 400:
        raise AuthError("Token verification failed")
    body = resp.json()
    return {"sub": body.get("id"), "email": body.get("email")}


def extract_bearer(authorization: Optional[str]) -> str:
    if not authorization:
        raise AuthError("Missing Authorization header")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise AuthError("Expected 'Bearer <token>' authorization")
    return token.strip()


def resolve_principal(token: str, settings: Optional[Settings] = None) -> Principal:
    """Verify the token and resolve the server-controlled admin record."""
    settings = settings or get_settings()

    if settings.dev_mode and token.startswith("dev."):
        # Local/CI only. Never enabled in production images.
        user_id = token[4:] or "00000000-0000-0000-0000-000000000001"
        return _load_profile(user_id, settings.dev_admin_email, settings, autocreate=True)

    if settings.supabase_jwt_secret:
        claims = decode_jwt_hs256(token, settings.supabase_jwt_secret)
    elif not settings.supabase_url:
        # No verification backend at all: the only acceptable token is a dev token,
        # which was handled above. Anything else is rejected outright.
        raise AuthError("Invalid or unverifiable token.")
    else:
        claims = _verify_remote(token, settings)

    user_id = claims.get("sub")
    if not user_id:
        raise AuthError("Token has no subject")
    email = claims.get("email") or ""
    return _load_profile(str(user_id), str(email), settings, autocreate=False)


def _load_profile(user_id: str, email: str, settings: Settings, *, autocreate: bool) -> Principal:
    store = get_store()
    rows = store.select("profiles", filters={"id": user_id}, limit=1, order_by="created_at")
    profile = rows[0] if rows else None

    if profile is None and autocreate:
        profile = store.insert(
            "profiles",
            {"id": user_id, "email": email or settings.dev_admin_email, "role": ADMIN_ROLE},
        )

    if profile is None:
        raise AuthError("This account is not authorized for the analytics workspace.", status=403, code="NOT_AUTHORIZED")

    role = str(profile.get("role") or "").lower()
    if role != ADMIN_ROLE:
        raise AuthError("This account is not authorized for the analytics workspace.", status=403, code="NOT_AUTHORIZED")

    return Principal(id=str(profile["id"]), email=str(profile.get("email") or email), role=role)
