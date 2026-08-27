"""Request dependencies: authentication, rate limiting, error mapping."""
from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional

from fastapi import Depends, Header, HTTPException, Request

from ..audit import record as audit_record
from ..config import Settings, get_settings
from ..security import AuthError, Principal, extract_bearer, resolve_principal
from ..store import Forbidden, NotFound, get_store, require_owned

_buckets: Dict[str, Deque[float]] = defaultdict(deque)


def settings_dep() -> Settings:
    return get_settings()


def rate_limit(key: str, limit_per_minute: int) -> None:
    now = time.time()
    bucket = _buckets[key]
    while bucket and now - bucket[0] > 60:
        bucket.popleft()
    if len(bucket) >= limit_per_minute:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "RATE_LIMITED",
                "message": "Too many requests. Wait a moment and try again.",
            },
        )
    bucket.append(now)


async def current_admin(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    settings: Settings = Depends(settings_dep),
) -> Principal:
    try:
        token = extract_bearer(authorization)
        principal = resolve_principal(token, settings)
    except AuthError as exc:
        raise HTTPException(
            status_code=exc.status,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    rate_limit(f"admin:{principal.id}", settings.rate_limit_per_minute)
    request.state.principal = principal
    return principal


def owned_project(project_id: str, admin: Principal) -> dict:
    """Server-side ownership check. Never trusts a client-supplied owner_id."""
    try:
        return require_owned(get_store(), "projects", project_id, admin.id)
    except NotFound as exc:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Project not found."}) from exc
    except Forbidden as exc:
        raise HTTPException(
            status_code=403,
            detail={"code": "FORBIDDEN", "message": "You do not have access to this project."},
        ) from exc


def owned_run(run_id: str, admin: Principal) -> dict:
    store = get_store()
    run = store.get("analysis_runs", run_id)
    if run is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Analysis run not found."})
    owned_project(str(run.get("project_id")), admin)
    return run


def owned_artifact(artifact_id: str, admin: Principal) -> dict:
    store = get_store()
    artifact = store.get("artifacts", artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Artifact not found."})
    owned_project(str(artifact.get("project_id")), admin)
    return artifact
