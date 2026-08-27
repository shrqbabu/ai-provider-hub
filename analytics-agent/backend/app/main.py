"""FastAPI application for the analytics backend.

Runs the heavy work (parsing, profiling, computation, rendering) so the Android
client never has to. Holds every secret; the device only ever receives the
public config, project metadata and signed/streamed artifacts.
"""
from __future__ import annotations

import logging
import os
import time
import uuid
from typing import Any, Dict

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from .config import get_settings
from .routes.api import router as api_router
from .store import NotFound, get_store

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("analytics")

settings = get_settings()

app = FastAPI(
    title="Data Analytics AI Agent — Backend",
    description=(
        "Admin-only analytics workspace backend. CSV/Excel/SQL → analysis → user-defined report "
        "→ insights → DAX → dashboard PNG. Does not produce PBIX/PBIT and is not a chatbot."
    ),
    version="1.0.0",
    docs_url="/docs" if settings.dev_mode else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins or ["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def observability(request: Request, call_next):
    request_id = str(uuid.uuid4())
    started = time.time()
    try:
        response = await call_next(request)
    except Exception:  # noqa: BLE001
        log.exception("unhandled error on %s %s (request_id=%s)", request.method, request.url.path, request_id)
        return JSONResponse(
            status_code=500,
            content={
                "code": "INTERNAL_ERROR",
                "message": (
                    "The analytics backend hit an unexpected error. Your project data is saved — retry the action."
                ),
                "request_id": request_id,
            },
        )
    duration_ms = int((time.time() - started) * 1000)
    response.headers["x-request-id"] = request_id
    response.headers["x-response-time-ms"] = str(duration_ms)
    if not request.url.path.startswith("/v1/runs"):
        log.info("%s %s -> %s in %dms", request.method, request.url.path, response.status_code, duration_ms)
    return response


@app.get("/", include_in_schema=False)
def root() -> Dict[str, Any]:
    """Service descriptor. Deliberately free of any configuration values."""
    return {
        "service": "data-analytics-ai-agent",
        "description": (
            "Admin-only analytics service. CSV/Excel/SQL -> analysis -> user-defined report "
            "-> insights -> DAX -> dashboard PNG."
        ),
        "api_base": "/v1",
        "health": "/health",
        "docs": "/docs" if settings.dev_mode else None,
        "client": "Android (Kotlin, Jetpack Compose)",
    }


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "store": get_store().kind,
        "llm_provider": settings.resolved_llm_provider(),
        "supabase_configured": settings.supabase_configured,
        "sql_connectors_enabled": settings.sql_connectors_enabled,
    }


app.include_router(api_router)


@app.get("/v1/files/{bucket}/{path:path}", include_in_schema=False)
def local_file(bucket: str, path: str):
    """Local-store signed-URL equivalent. Disabled when Supabase is configured."""
    import io

    if settings.supabase_configured:
        return JSONResponse(status_code=404, content={"code": "NOT_FOUND", "message": "Not available."})
    try:
        data = get_store().download(bucket, path)
    except NotFound:
        return JSONResponse(status_code=404, content={"code": "NOT_FOUND", "message": "File not found."})
    media = "image/png" if path.endswith(".png") else "application/octet-stream"
    return StreamingResponse(io.BytesIO(data), media_type=media)
