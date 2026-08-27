"""Project, dataset, run, artifact and SQL endpoints."""
from __future__ import annotations

import io
import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from .. import audit, jobs
from ..config import Settings, get_settings
from ..engine.ingest import IngestError, load_bytes, profile_dataset, validate_upload
from ..security import Principal
from ..store import get_store, now_iso, storage_key
from .deps import current_admin, owned_artifact, owned_project, owned_run, settings_dep

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1")


# ---------------------------------------------------------------------------
# schemas
# ---------------------------------------------------------------------------
class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    source_type: str = Field(default="csv")

    @field_validator("source_type")
    @classmethod
    def _source(cls, value: str) -> str:
        allowed = {"csv", "excel", "sql"}
        v = (value or "csv").lower()
        if v not in allowed:
            raise ValueError(f"source_type must be one of {sorted(allowed)}")
        return v

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Project name cannot be empty.")
        return cleaned


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)


class RunCreate(BaseModel):
    prompt: str = Field(min_length=10, max_length=8000)

    @field_validator("prompt")
    @classmethod
    def _prompt(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 10:
            raise ValueError("The report prompt must describe what to analyse (at least 10 characters).")
        return cleaned


class SqlDatasetCreate(BaseModel):
    connection_id: str
    schema_name: Optional[str] = None
    tables: List[str] = Field(default_factory=list, max_length=12)


def _error(status: int, code: str, message: str, **extra: Any) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, **extra})


# ---------------------------------------------------------------------------
# meta
# ---------------------------------------------------------------------------
@router.get("/config")
def public_config(settings: Settings = Depends(settings_dep)) -> Dict[str, Any]:
    """Values that are safe for the Android client. Contains no secrets."""
    return settings.public_config()


@router.get("/me")
def me(admin: Principal = Depends(current_admin)) -> Dict[str, Any]:
    audit.record(audit.LOGIN, admin_id=admin.id, metadata={"email": admin.email})
    return {"id": admin.id, "email": admin.email, "role": admin.role}


# ---------------------------------------------------------------------------
# projects
# ---------------------------------------------------------------------------
@router.get("/projects")
def list_projects(
    admin: Principal = Depends(current_admin),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Dict[str, Any]:
    store = get_store()
    projects = store.select(
        "projects", filters={"owner_id": admin.id}, order_by="updated_at", desc=True, limit=limit, offset=offset
    )
    for project in projects:
        datasets = store.select("datasets", filters={"project_id": project["id"]})
        runs = store.select("analysis_runs", filters={"project_id": project["id"]}, limit=1)
        project["dataset_count"] = len(datasets)
        project["run_count"] = len(store.select("analysis_runs", filters={"project_id": project["id"]}))
        project["latest_run"] = runs[0] if runs else None
    return {"projects": projects, "limit": limit, "offset": offset}


@router.post("/projects", status_code=201)
def create_project(payload: ProjectCreate, admin: Principal = Depends(current_admin),
                   settings: Settings = Depends(settings_dep)) -> Dict[str, Any]:
    if payload.source_type == "sql" and not settings.sql_connectors_enabled:
        raise _error(400, "SQL_DISABLED",
                     "SQL sources are not configured on this deployment. Use CSV or Excel upload.")
    store = get_store()
    project = store.insert(
        "projects",
        {
            "owner_id": admin.id,  # from the verified token, never from the request body
            "name": payload.name,
            "description": payload.description,
            "source_type": payload.source_type,
            "status": "draft",
            "updated_at": now_iso(),
        },
    )
    audit.record(audit.PROJECT_CREATED, admin_id=admin.id, project_id=project["id"],
                 metadata={"source_type": payload.source_type})
    return project


@router.get("/projects/{project_id}")
def get_project(project_id: str, admin: Principal = Depends(current_admin)) -> Dict[str, Any]:
    project = owned_project(project_id, admin)
    store = get_store()
    datasets = store.select("datasets", filters={"project_id": project_id}, order_by="created_at", desc=True)
    runs = store.select("analysis_runs", filters={"project_id": project_id}, order_by="created_at", desc=True, limit=25)
    return {
        "project": project,
        "datasets": datasets,
        "runs": [_run_summary(r) for r in runs],
        "prompt_history": [
            {"run_id": r["id"], "prompt": r.get("user_prompt", ""), "created_at": r.get("created_at"),
             "status": r.get("status")}
            for r in runs
        ],
    }


@router.patch("/projects/{project_id}")
def update_project(project_id: str, payload: ProjectUpdate, admin: Principal = Depends(current_admin)) -> Dict[str, Any]:
    owned_project(project_id, admin)
    patch: Dict[str, Any] = {"updated_at": now_iso()}
    if payload.name is not None and payload.name.strip():
        patch["name"] = payload.name.strip()
    if payload.description is not None:
        patch["description"] = payload.description
    return get_store().update("projects", project_id, patch)


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, admin: Principal = Depends(current_admin),
                   settings: Settings = Depends(settings_dep)) -> Dict[str, Any]:
    owned_project(project_id, admin)
    store = get_store()
    runs = store.select("analysis_runs", filters={"project_id": project_id})
    removed = {"metrics": 0, "insights": 0, "dax_measures": 0, "data_quality": 0, "artifacts": 0}
    for run in runs:
        for table in ("metrics", "insights", "dax_measures", "data_quality"):
            removed[table] += store.delete(table, filters={"analysis_run_id": run["id"]})
    removed["artifacts"] = store.delete("artifacts", filters={"project_id": project_id})
    store.delete("analysis_runs", filters={"project_id": project_id})
    store.delete("datasets", filters={"project_id": project_id})

    prefix = storage_key(admin.id, project_id)
    files_removed = 0
    for bucket in (settings.bucket_inputs, settings.bucket_artifacts, settings.bucket_dashboards, settings.bucket_reports):
        try:
            files_removed += store.remove_prefix(bucket, prefix)
        except Exception as exc:  # noqa: BLE001
            log.warning("storage cleanup failed for %s/%s: %s", bucket, prefix, exc)

    store.delete("projects", filters={"id": project_id})
    audit.record(audit.PROJECT_DELETED, admin_id=admin.id, project_id=project_id,
                 metadata={"runs": len(runs), "files": files_removed, **removed})
    return {"deleted": True, "runs": len(runs), "files_removed": files_removed, "rows_removed": removed}


# ---------------------------------------------------------------------------
# datasets
# ---------------------------------------------------------------------------
@router.post("/projects/{project_id}/datasets", status_code=201)
async def upload_dataset(
    project_id: str,
    file: UploadFile = File(...),
    declared_size: Optional[int] = Form(default=None),
    admin: Principal = Depends(current_admin),
    settings: Settings = Depends(settings_dep),
) -> Dict[str, Any]:
    """Upload → validate → parse → profile → schema → quality-ready dataset."""
    owned_project(project_id, admin)

    content = await file.read()
    size = len(content)
    try:
        kind = validate_upload(file.filename or "", file.content_type or "", size, settings.max_upload_bytes)
    except IngestError as exc:
        raise _error(400, exc.code, exc.message, hint=exc.hint) from exc

    if declared_size is not None and abs(int(declared_size) - size) > 1024:
        raise _error(400, "SIZE_MISMATCH",
                     "The uploaded byte count does not match the declared file size. The upload may have been interrupted — retry.")

    try:
        result = load_bytes(file.filename or "dataset", content, kind)
        profile = profile_dataset(result)
    except IngestError as exc:
        raise _error(400, exc.code, exc.message, hint=exc.hint) from exc
    except Exception as exc:  # noqa: BLE001
        raise _error(400, "PARSE_FAILED",
                     f"The file could not be parsed: {type(exc).__name__}: {exc}"[:300]) from exc

    if profile["total_rows"] > settings.max_analysis_rows:
        raise _error(413, "TOO_MANY_ROWS",
                     f"The dataset has {profile['total_rows']:,} rows which exceeds the configured limit of {settings.max_analysis_rows:,}.")

    store = get_store()
    key = storage_key(admin.id, project_id, "inputs", file.filename or "dataset")
    store.upload(settings.bucket_inputs, key, content, file.content_type or "application/octet-stream")

    dataset = store.insert(
        "datasets",
        {
            "project_id": project_id,
            "name": file.filename,
            "source_type": kind,
            "storage_path": key,  # rebuilt server-side; the client cannot choose it
            "file_size": size,
            "mime_type": file.content_type,
            "row_count": profile["total_rows"],
            "column_count": profile["total_columns"],
            "schema": profile,
            "checksum": profile.get("checksum"),
        },
    )
    for table in profile["tables"]:
        store.insert(
            "dataset_tables",
            {
                "dataset_id": dataset["id"],
                "table_name": table["table_name"],
                "grain": "",
                "row_count": table["row_count"],
                "schema": {k: v for k, v in table.items() if k != "sample_rows"},
            },
        )
    store.update("projects", project_id, {"status": "ready", "updated_at": now_iso(), "source_type": kind})
    audit.record(audit.FILE_UPLOADED, admin_id=admin.id, project_id=project_id,
                 metadata={"file_name": file.filename, "size": size, "rows": profile["total_rows"], "kind": kind})
    audit.record(audit.DATASET_PROFILED, admin_id=admin.id, project_id=project_id,
                 metadata={"tables": profile["table_count"]})
    return {"dataset": dataset, "profile": profile}


@router.get("/projects/{project_id}/datasets")
def list_datasets(project_id: str, admin: Principal = Depends(current_admin)) -> Dict[str, Any]:
    owned_project(project_id, admin)
    return {"datasets": get_store().select("datasets", filters={"project_id": project_id})}


@router.get("/datasets/{dataset_id}")
def get_dataset(dataset_id: str, admin: Principal = Depends(current_admin)) -> Dict[str, Any]:
    store = get_store()
    dataset = store.get("datasets", dataset_id)
    if dataset is None:
        raise _error(404, "NOT_FOUND", "Dataset not found.")
    owned_project(str(dataset["project_id"]), admin)
    tables = store.select("dataset_tables", filters={"dataset_id": dataset_id})
    return {"dataset": dataset, "tables": tables}


@router.get("/datasets/{dataset_id}/quality")
def dataset_quality(dataset_id: str, admin: Principal = Depends(current_admin),
                    settings: Settings = Depends(settings_dep)) -> Dict[str, Any]:
    """On-demand data-quality pass over the stored dataset (worker-side)."""
    from ..engine import modeling, quality as quality_engine
    from ..engine.ingest import TableData, profile_table

    store = get_store()
    dataset = store.get("datasets", dataset_id)
    if dataset is None:
        raise _error(404, "NOT_FOUND", "Dataset not found.")
    owned_project(str(dataset["project_id"]), admin)

    if dataset.get("source_type") == "sql":
        from ..sql.connector import materialise_sql_dataset

        frames, profiles = materialise_sql_dataset(dataset)
    else:
        content = store.download(settings.bucket_inputs, dataset["storage_path"])
        result = load_bytes(dataset.get("name") or "dataset", content,
                            "excel" if dataset.get("source_type") == "excel" else "csv")
        frames, profiles = {}, {}
        for table in result.tables:
            profiles[table.name] = profile_table(table)
            frames[table.name] = table.frame

    model = modeling.build_model(frames, profiles)
    report = quality_engine.assess(frames, profiles, model.get("relationships", []))
    return {"quality": report, "model": model}


# ---------------------------------------------------------------------------
# analysis runs
# ---------------------------------------------------------------------------
def _run_summary(run: Dict[str, Any]) -> Dict[str, Any]:
    keep = (
        "id", "project_id", "status", "stage", "stage_key", "stage_label", "progress", "user_prompt",
        "started_at", "completed_at", "created_at", "error", "metric_count", "insight_count",
        "dax_summary", "duration_ms",
    )
    summary = {k: run.get(k) for k in keep}
    validation = run.get("validation") or {}
    summary["validation_status"] = validation.get("status")
    summary["validation_summary"] = validation.get("summary")
    return summary


@router.post("/projects/{project_id}/runs", status_code=202)
def start_run(project_id: str, payload: RunCreate, admin: Principal = Depends(current_admin)) -> Dict[str, Any]:
    owned_project(project_id, admin)
    store = get_store()

    datasets = store.select("datasets", filters={"project_id": project_id}, limit=1)
    if not datasets:
        raise _error(400, "NO_DATASET",
                     "Upload a CSV/Excel file or connect a SQL source before running an analysis.")

    active = [
        r for r in store.select("analysis_runs", filters={"project_id": project_id})
        if r.get("status") in {"queued", "running"}
    ]
    if active:
        raise _error(409, "RUN_IN_PROGRESS",
                     "An analysis is already running for this project. Wait for it to finish or cancel it.",
                     run_id=active[0]["id"])

    run = store.insert(
        "analysis_runs",
        {
            "project_id": project_id,
            "status": "queued",
            "stage": "profiling",
            "stage_key": "VALIDATING_INPUT",
            "stage_label": "Queued",
            "progress": 0,
            "user_prompt": payload.prompt,
        },
    )
    store.update("projects", project_id, {"status": "running", "updated_at": now_iso()})
    audit.record(audit.ANALYSIS_STARTED, admin_id=admin.id, project_id=project_id, analysis_run_id=run["id"],
                 metadata={"prompt_length": len(payload.prompt)})
    jobs.submit(run["id"], admin.id, project_id)
    return _run_summary(run)


@router.get("/runs/{run_id}")
def get_run(run_id: str, admin: Principal = Depends(current_admin)) -> Dict[str, Any]:
    run = owned_run(run_id, admin)
    return _run_summary(run)


@router.post("/runs/{run_id}/cancel")
def cancel_run(run_id: str, admin: Principal = Depends(current_admin)) -> Dict[str, Any]:
    run = owned_run(run_id, admin)
    if run.get("status") not in {"queued", "running"}:
        raise _error(409, "NOT_CANCELLABLE", f"This run is already {run.get('status')}.")
    jobs.request_cancel(run_id)
    updated = get_store().update("analysis_runs", run_id,
                                 {"status": "cancelled", "completed_at": now_iso(), "stage_label": "Cancelled"})
    audit.record(audit.ANALYSIS_CANCELLED, admin_id=admin.id, project_id=run["project_id"], analysis_run_id=run_id)
    return _run_summary(updated)


@router.get("/runs/{run_id}/results")
def run_results(
    run_id: str,
    admin: Principal = Depends(current_admin),
    section: str = Query(default="overview",
                         pattern="^(overview|insights|metrics|report|dax|dashboard|quality)$"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> Dict[str, Any]:
    """Paginated result sections so the client never loads a whole run at once."""
    run = owned_run(run_id, admin)
    store = get_store()

    if section == "overview":
        return {
            "run": _run_summary(run),
            "validation": run.get("validation"),
            "plan": run.get("plan"),
            "unsupported": run.get("unsupported", []),
            "headline_metrics": store.select("metrics", filters={"analysis_run_id": run_id}, limit=6,
                                             order_by="created_at", desc=False),
            "artifacts": store.select("artifacts", filters={"analysis_run_id": run_id}),
        }
    if section == "insights":
        return {"insights": store.select("insights", filters={"analysis_run_id": run_id}, order_by="created_at",
                                         desc=False, limit=limit, offset=offset)}
    if section == "metrics":
        return {"metrics": store.select("metrics", filters={"analysis_run_id": run_id}, order_by="created_at",
                                        desc=False, limit=limit, offset=offset)}
    if section == "report":
        report = run.get("report") or {}
        return {"report": report}
    if section == "dax":
        measures = store.select("dax_measures", filters={"analysis_run_id": run_id}, order_by="created_at",
                                desc=False, limit=limit, offset=offset)
        groups: Dict[str, List[Dict[str, Any]]] = {}
        for m in measures:
            groups.setdefault(m.get("group_name") or "Advanced Measures", []).append(m)
        return {"measures": measures, "groups": groups, "summary": run.get("dax_summary")}
    if section == "dashboard":
        artifacts = [a for a in store.select("artifacts", filters={"analysis_run_id": run_id})
                     if a.get("artifact_type") == "dashboard_png"]
        return {"dashboard": artifacts[0] if artifacts else None}
    quality = store.select("data_quality", filters={"analysis_run_id": run_id}, limit=1)
    return {"data_quality": quality[0] if quality else None}


# ---------------------------------------------------------------------------
# artifacts
# ---------------------------------------------------------------------------
@router.get("/runs/{run_id}/artifacts")
def list_artifacts(run_id: str, admin: Principal = Depends(current_admin)) -> Dict[str, Any]:
    owned_run(run_id, admin)
    return {"artifacts": get_store().select("artifacts", filters={"analysis_run_id": run_id})}


@router.get("/artifacts/{artifact_id}/url")
def artifact_url(artifact_id: str, admin: Principal = Depends(current_admin),
                 settings: Settings = Depends(settings_dep)) -> Dict[str, Any]:
    artifact = owned_artifact(artifact_id, admin)
    store = get_store()
    url = store.signed_url(artifact.get("bucket") or settings.bucket_artifacts, artifact["storage_path"])
    audit.record(audit.ARTIFACT_DOWNLOADED, admin_id=admin.id, project_id=artifact["project_id"],
                 analysis_run_id=artifact.get("analysis_run_id"),
                 metadata={"artifact_type": artifact.get("artifact_type")})
    return {"url": url, "expires_in": settings.signed_url_ttl_seconds, "artifact": artifact}


@router.get("/artifacts/{artifact_id}/content")
def artifact_content(artifact_id: str, admin: Principal = Depends(current_admin),
                     settings: Settings = Depends(settings_dep)) -> Response:
    artifact = owned_artifact(artifact_id, admin)
    store = get_store()
    data = store.download(artifact.get("bucket") or settings.bucket_artifacts, artifact["storage_path"])
    audit.record(audit.ARTIFACT_DOWNLOADED, admin_id=admin.id, project_id=artifact["project_id"],
                 analysis_run_id=artifact.get("analysis_run_id"),
                 metadata={"artifact_type": artifact.get("artifact_type"), "mode": "stream"})
    return StreamingResponse(
        io.BytesIO(data),
        media_type=artifact.get("mime_type") or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{artifact.get("file_name", "artifact")}"'},
    )


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------
@router.get("/sql/connections")
def sql_connections(admin: Principal = Depends(current_admin),
                    settings: Settings = Depends(settings_dep)) -> Dict[str, Any]:
    from ..sql.connector import list_connections

    if not settings.sql_connectors_enabled:
        return {"enabled": False, "connections": [], "access": "read_only"}
    return {"enabled": True, "connections": list_connections(), "access": "read_only"}


@router.get("/sql/connections/{connection_id}/schema")
def sql_schema(connection_id: str, schema: Optional[str] = None,
               admin: Principal = Depends(current_admin),
               settings: Settings = Depends(settings_dep)) -> Dict[str, Any]:
    from ..sql.connector import SqlError, introspect

    if not settings.sql_connectors_enabled:
        raise _error(400, "SQL_DISABLED", "SQL sources are not configured on this deployment.")
    try:
        return introspect(connection_id, schema)
    except SqlError as exc:
        raise _error(400, exc.code, exc.message) from exc


@router.post("/projects/{project_id}/sql-dataset", status_code=201)
def create_sql_dataset(project_id: str, payload: SqlDatasetCreate,
                       admin: Principal = Depends(current_admin),
                       settings: Settings = Depends(settings_dep)) -> Dict[str, Any]:
    from ..sql.connector import SqlError, introspect

    owned_project(project_id, admin)
    if not settings.sql_connectors_enabled:
        raise _error(400, "SQL_DISABLED", "SQL sources are not configured on this deployment.")
    if not payload.tables:
        raise _error(400, "SQL_NO_TABLES", "Select at least one table to analyse.")
    try:
        schema_info = introspect(payload.connection_id, payload.schema_name)
    except SqlError as exc:
        raise _error(400, exc.code, exc.message) from exc

    known = {t["table_name"] for t in schema_info["tables"]}
    unknown = [t for t in payload.tables if t not in known]
    if unknown:
        raise _error(400, "SQL_UNKNOWN_TABLE", f"These tables do not exist in the connection: {unknown}")

    store = get_store()
    dataset = store.insert(
        "datasets",
        {
            "project_id": project_id,
            "name": f"{payload.connection_id}:{','.join(payload.tables[:3])}",
            "source_type": "sql",
            "storage_path": "",
            "file_size": 0,
            "mime_type": "application/sql",
            "row_count": 0,
            "column_count": sum(len(t["columns"]) for t in schema_info["tables"] if t["table_name"] in payload.tables),
            "schema": schema_info,
            "sql_config": {
                "connection_id": payload.connection_id,
                "schema": payload.schema_name,
                "tables": payload.tables,
                "access": "read_only",
            },
        },
    )
    store.update("projects", project_id, {"status": "ready", "source_type": "sql", "updated_at": now_iso()})
    audit.record(audit.SQL_CONNECTED, admin_id=admin.id, project_id=project_id,
                 metadata={"connection_id": payload.connection_id, "tables": len(payload.tables)})
    return {"dataset": dataset}


# ---------------------------------------------------------------------------
# audit (admin visibility)
# ---------------------------------------------------------------------------
@router.get("/audit")
def audit_log(admin: Principal = Depends(current_admin),
              limit: int = Query(default=100, ge=1, le=500)) -> Dict[str, Any]:
    return {"entries": get_store().select("audit_log", filters={"admin_id": admin.id}, limit=limit)}
