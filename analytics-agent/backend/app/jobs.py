"""Asynchronous analysis job runner.

Analysis is long-running, so the API never executes it inline: a job is queued,
the client gets the ``analysis_run`` id immediately and polls progress. Runs are
immutable — a new execution always creates a new ``analysis_runs`` row.
"""
from __future__ import annotations

import hashlib
import io
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

import pandas as pd

from . import audit
from .config import get_settings
from .engine.dax import to_text as dax_to_text
from .engine.ingest import TableData, load_bytes, profile_table
from .engine.pipeline import run_pipeline
from .llm.client import LlmClient
from .store import get_store, now_iso, storage_key

log = logging.getLogger(__name__)

_settings = get_settings()
_executor = ThreadPoolExecutor(max_workers=max(1, _settings.job_workers), thread_name_prefix="analysis")
_cancelled: Dict[str, bool] = {}
_lock = threading.Lock()


def request_cancel(run_id: str) -> None:
    with _lock:
        _cancelled[run_id] = True


def is_cancelled(run_id: str) -> bool:
    with _lock:
        return _cancelled.get(run_id, False)


def _clear_cancel(run_id: str) -> None:
    with _lock:
        _cancelled.pop(run_id, None)


def submit(run_id: str, owner_id: str, project_id: str) -> None:
    _executor.submit(_guarded_execute, run_id, owner_id, project_id)


def _guarded_execute(run_id: str, owner_id: str, project_id: str) -> None:
    try:
        execute(run_id, owner_id, project_id)
    except Exception as exc:  # noqa: BLE001 - a worker crash must be recorded, not silent
        log.exception("analysis run %s crashed", run_id)
        try:
            get_store().update(
                "analysis_runs",
                run_id,
                {
                    "status": "failed",
                    "error": {
                        "stage": "WORKER",
                        "message": (
                            "The analysis worker stopped unexpectedly. Your uploaded data and previous "
                            f"analysis runs are saved — retry the run. ({type(exc).__name__})"
                        ),
                        "recoverable": True,
                    },
                    "completed_at": now_iso(),
                },
            )
            audit.record(audit.ANALYSIS_FAILED, admin_id=owner_id, project_id=project_id, analysis_run_id=run_id,
                         metadata={"stage": "WORKER"})
        except Exception:  # noqa: BLE001
            log.exception("could not persist failure for run %s", run_id)
    finally:
        _clear_cancel(run_id)


def _load_dataset(store, dataset: Dict[str, Any]) -> tuple[Dict[str, pd.DataFrame], Dict[str, Any]]:
    """Rehydrate frames from storage (worker side, never on the device)."""
    settings = get_settings()
    source_type = dataset.get("source_type")
    if source_type == "sql":
        from .sql.connector import materialise_sql_dataset

        return materialise_sql_dataset(dataset)

    content = store.download(settings.bucket_inputs, dataset["storage_path"])
    kind = "excel" if source_type == "excel" else "csv"
    result = load_bytes(dataset.get("name") or "dataset", content, kind)
    frames = {t.name: t.frame for t in result.tables}
    profiles: Dict[str, Any] = {}
    for table in result.tables:
        profiles[table.name] = profile_table(table)
        frames[table.name] = table.frame
    return frames, profiles


def execute(run_id: str, owner_id: str, project_id: str) -> None:
    store = get_store()
    settings = get_settings()
    started = time.time()

    run = store.get("analysis_runs", run_id)
    if run is None:
        log.warning("run %s vanished before execution", run_id)
        return

    store.update(
        "analysis_runs",
        run_id,
        {"status": "running", "stage": "profiling", "progress": 1, "started_at": now_iso()},
    )

    datasets = store.select("datasets", filters={"project_id": project_id}, order_by="created_at", desc=True, limit=1)
    if not datasets:
        _fail(store, run_id, owner_id, project_id, "VALIDATING_INPUT",
              "This project has no dataset. Upload a CSV/Excel file or connect a SQL source before running an analysis.")
        return

    dataset = datasets[0]
    project = store.get("projects", project_id) or {}

    try:
        frames, profiles = _load_dataset(store, dataset)
    except Exception as exc:  # noqa: BLE001
        _fail(
            store, run_id, owner_id, project_id, "VALIDATING_INPUT",
            f"The dataset could not be loaded from secure storage. Your project is saved — retry the run. ({type(exc).__name__}: {exc})"[:500],
        )
        return

    def progress(stage_key: str, label: str, pct: int, bucket: str) -> None:
        try:
            store.update(
                "analysis_runs",
                run_id,
                {"stage": bucket, "stage_key": stage_key, "stage_label": label, "progress": int(pct)},
            )
        except Exception:  # noqa: BLE001 - progress must never break a run
            log.debug("progress write failed for %s", run_id)

    result = run_pipeline(
        prompt=run.get("user_prompt") or "",
        frames=frames,
        profiles=profiles,
        dashboard_title=(project.get("name") or "Analytics Dashboard")[:70],
        dashboard_subtitle=(run.get("user_prompt") or "")[:130],
        llm=LlmClient(settings),
        progress=progress,
        cancelled=lambda: is_cancelled(run_id),
    )

    for timing in result.stage_timings:
        audit.job_event(run_id, timing["stage"], duration_ms=timing["duration_ms"])

    if result.status == "failed":
        error = result.error or {"stage": result.stage, "message": "Analysis failed."}
        _fail(store, run_id, owner_id, project_id, error.get("stage", result.stage), error.get("message", ""),
              extra=error)
        return

    # ---- persist artefacts ------------------------------------------------
    artifacts: List[Dict[str, Any]] = []

    def _store_artifact(kind: str, bucket: str, filename: str, content: bytes, mime: str) -> Dict[str, Any]:
        key = storage_key(owner_id, project_id, "runs", run_id, filename)
        store.upload(bucket, key, content, mime)
        row = store.insert(
            "artifacts",
            {
                "project_id": project_id,
                "analysis_run_id": run_id,
                "artifact_type": kind,
                "bucket": bucket,
                "storage_path": key,
                "file_name": filename,
                "mime_type": mime,
                "file_size": len(content),
                "checksum": hashlib.sha256(content).hexdigest(),
            },
        )
        artifacts.append(row)
        return row

    registry = result.registry
    for metric in registry.all():
        store.insert("metrics", {**metric.as_row(), "analysis_run_id": run_id})

    for insight in result.insights:
        store.insert(
            "insights",
            {
                "analysis_run_id": run_id,
                "title": insight["title"],
                "finding": insight["finding"],
                "evidence": insight["evidence"],
                "interpretation": insight.get("interpretation", ""),
                "business_impact": insight.get("business_impact", ""),
                "recommendation": insight.get("recommendation", ""),
                "confidence": insight.get("confidence", "medium"),
                "priority": insight.get("priority", "medium"),
                "validation_status": insight.get("validation_status", "unverified"),
            },
        )

    for measure in result.dax["measures"]:
        store.insert(
            "dax_measures",
            {
                "analysis_run_id": run_id,
                "name": measure["name"],
                "dax_code": measure["dax_code"],
                "purpose": measure["purpose"],
                "group_name": measure["group"],
                "kind": measure.get("kind", "measure"),
                "dependencies": measure.get("dependencies", []),
                "validation_status": measure["validation_status"],
                "validation_errors": measure.get("validation_errors", []),
            },
        )
        if measure["validation_status"] != "failed":
            pass

    quality = result.quality
    store.insert(
        "data_quality",
        {
            "analysis_run_id": run_id,
            "score": quality.get("score"),
            "completeness": quality.get("completeness"),
            "validity": quality.get("validity"),
            "consistency": quality.get("consistency"),
            "uniqueness": quality.get("uniqueness"),
            "relationships": quality.get("relationships"),
            "issues": quality.get("issues"),
        },
    )

    _store_artifact("report", settings.bucket_reports, "analysis-report.md",
                    result.report["markdown"].encode("utf-8"), "text/markdown")
    _store_artifact("dax", settings.bucket_artifacts, "measures.dax",
                    dax_to_text(result.dax).encode("utf-8"), "text/plain")
    _store_artifact("dashboard_png", settings.bucket_dashboards, "dashboard.png",
                    result.dashboard.png_bytes, "image/png")
    audit.record(audit.DASHBOARD_GENERATED, admin_id=owner_id, project_id=project_id, analysis_run_id=run_id,
                 metadata={"width": result.dashboard.width, "height": result.dashboard.height})
    audit.record(audit.DAX_GENERATED, admin_id=owner_id, project_id=project_id, analysis_run_id=run_id,
                 metadata={"measures": result.dax["validation"]["total"]})

    import json as _json

    quality_report = _json.dumps(
        {"score": quality.get("score"), "grade": quality.get("grade"), "issues": quality.get("issues", [])},
        indent=2, default=str,
    )
    _store_artifact("data_quality", settings.bucket_reports, "data-quality.json",
                    quality_report.encode("utf-8"), "application/json")

    status = "completed" if result.validation["passed"] else "validation_failed"
    duration_ms = int((time.time() - started) * 1000)

    store.update(
        "analysis_runs",
        run_id,
        {
            "status": status,
            "stage": "validation",
            "stage_key": "COMPLETED" if status == "completed" else "FINAL_VALIDATION",
            "stage_label": "Completed" if status == "completed" else "Validation failed",
            "progress": 100,
            "completed_at": now_iso(),
            "duration_ms": duration_ms,
            "validation": result.validation,
            "plan": result.plan,
            "report": result.report,
            "metric_count": len(registry),
            "insight_count": len(result.insights),
            "dax_summary": result.dax["validation"],
            "unsupported": registry.unsupported,
            "llm_usage": result.llm_usage,
            "stage_timings": result.stage_timings,
            "error": None if status == "completed" else {
                "stage": "FINAL_VALIDATION",
                "message": result.validation["summary"],
                "recoverable": True,
            },
        },
    )
    store.update("projects", project_id, {"status": status, "last_run_at": now_iso(), "updated_at": now_iso()})

    if status == "completed":
        audit.record(audit.ANALYSIS_COMPLETED, admin_id=owner_id, project_id=project_id, analysis_run_id=run_id,
                     metadata={"duration_ms": duration_ms, "metrics": len(registry)})
    else:
        audit.record(audit.VALIDATION_FAILED, admin_id=owner_id, project_id=project_id, analysis_run_id=run_id,
                     metadata={"critical": result.validation["critical_count"]})


def _fail(store, run_id: str, owner_id: str, project_id: str, stage: str, message: str,
          extra: Optional[Dict[str, Any]] = None) -> None:
    store.update(
        "analysis_runs",
        run_id,
        {
            "status": "failed",
            "stage_key": stage,
            "completed_at": now_iso(),
            "error": {"stage": stage, "message": message, "recoverable": True, **(extra or {})},
        },
    )
    store.update("projects", project_id, {"status": "failed", "updated_at": now_iso()})
    audit.record(audit.ANALYSIS_FAILED, admin_id=owner_id, project_id=project_id, analysis_run_id=run_id,
                 metadata={"stage": stage})
