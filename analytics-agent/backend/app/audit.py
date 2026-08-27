"""Audit logging and observability events.

Never records secrets, credentials, tokens or raw PII rows — only identifiers,
action names, and small scalar metadata.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional

from .store import get_store, now_iso

log = logging.getLogger("audit")

# Actions
LOGIN = "LOGIN"
PROJECT_CREATED = "PROJECT_CREATED"
PROJECT_DELETED = "PROJECT_DELETED"
FILE_UPLOADED = "FILE_UPLOADED"
DATASET_PROFILED = "DATASET_PROFILED"
SQL_CONNECTED = "SQL_CONNECTED"
ANALYSIS_STARTED = "ANALYSIS_STARTED"
ANALYSIS_COMPLETED = "ANALYSIS_COMPLETED"
ANALYSIS_FAILED = "ANALYSIS_FAILED"
ANALYSIS_CANCELLED = "ANALYSIS_CANCELLED"
DAX_GENERATED = "DAX_GENERATED"
DASHBOARD_GENERATED = "DASHBOARD_GENERATED"
ARTIFACT_DOWNLOADED = "ARTIFACT_DOWNLOADED"
VALIDATION_FAILED = "VALIDATION_FAILED"

_SECRET_KEYS = re.compile(
    r"(pass(word)?|secret|token|api[_-]?key|authorization|credential|dsn|conn(ection)?_string)",
    re.I,
)
_SECRET_VALUE = re.compile(r"(postgres(ql)?://|mysql://|sk-[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_\-]{8,})", re.I)


def scrub(metadata: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Drop anything that looks like a secret before persisting."""
    if not metadata:
        return {}
    clean: Dict[str, Any] = {}
    for key, value in metadata.items():
        if _SECRET_KEYS.search(str(key)):
            clean[key] = "[redacted]"
            continue
        if isinstance(value, str):
            if _SECRET_VALUE.search(value):
                clean[key] = "[redacted]"
            else:
                clean[key] = value[:500]
        elif isinstance(value, dict):
            clean[key] = scrub(value)
        elif isinstance(value, (list, tuple)):
            clean[key] = [scrub(v) if isinstance(v, dict) else str(v)[:200] for v in list(value)[:25]]
        elif isinstance(value, (int, float, bool)) or value is None:
            clean[key] = value
        else:
            clean[key] = str(value)[:200]
    return clean


def record(
    action: str,
    *,
    admin_id: Optional[str] = None,
    project_id: Optional[str] = None,
    analysis_run_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    entry = {
        "admin_id": admin_id,
        "action": action,
        "project_id": project_id,
        "analysis_run_id": analysis_run_id,
        "metadata": scrub(metadata),
        "created_at": now_iso(),
    }
    try:
        get_store().insert("audit_log", entry)
    except Exception as exc:  # noqa: BLE001 - auditing must never break a request
        log.warning("audit write failed for %s: %s", action, exc)
    log.info("audit %s admin=%s project=%s", action, admin_id, project_id)


def job_event(
    analysis_run_id: str,
    stage: str,
    *,
    status: str = "completed",
    duration_ms: Optional[int] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Per-stage observability record (duration, retries, failures)."""
    try:
        get_store().insert(
            "job_events",
            {
                "analysis_run_id": analysis_run_id,
                "stage": stage,
                "status": status,
                "duration_ms": duration_ms,
                "metadata": scrub(metadata),
                "created_at": now_iso(),
            },
        )
    except Exception as exc:  # noqa: BLE001
        log.debug("job event write failed: %s", exc)
