"""Server-side configuration.

Every secret lives here, read from the process environment. Nothing in this
module is ever shipped to the Android client.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from typing import List


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name) or default)
    except ValueError:
        return default


def _env_bool(name: str, default: bool = False) -> bool:
    raw = _env(name).lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    # ---- Supabase (server side) -------------------------------------------
    supabase_url: str = field(default_factory=lambda: _env("SUPABASE_URL"))
    supabase_service_role_key: str = field(
        default_factory=lambda: _env("SUPABASE_SERVICE_ROLE_KEY")
    )
    supabase_jwt_secret: str = field(default_factory=lambda: _env("SUPABASE_JWT_SECRET"))
    supabase_publishable_key: str = field(
        default_factory=lambda: _env("SUPABASE_PUBLISHABLE_KEY")
    )

    # ---- LLM providers ----------------------------------------------------
    # Provider selection order: explicit LLM_PROVIDER, else first configured.
    llm_provider: str = field(default_factory=lambda: _env("LLM_PROVIDER", "auto"))
    openai_api_key: str = field(default_factory=lambda: _env("OPENAI_API_KEY"))
    openai_base_url: str = field(
        default_factory=lambda: _env("OPENAI_BASE_URL", "https://api.openai.com/v1")
    )
    openai_model: str = field(default_factory=lambda: _env("OPENAI_MODEL", "gpt-4o-mini"))
    gemini_api_key: str = field(default_factory=lambda: _env("GEMINI_API_KEY"))
    gemini_base_url: str = field(
        default_factory=lambda: _env(
            "GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"
        )
    )
    gemini_model: str = field(
        default_factory=lambda: _env("GEMINI_MODEL", "gemini-2.0-flash")
    )
    llm_timeout_seconds: int = field(default_factory=lambda: _env_int("LLM_TIMEOUT_SECONDS", 90))
    llm_max_output_tokens: int = field(
        default_factory=lambda: _env_int("LLM_MAX_OUTPUT_TOKENS", 4096)
    )

    # ---- Storage / limits -------------------------------------------------
    bucket_inputs: str = field(default_factory=lambda: _env("BUCKET_INPUTS", "project-inputs"))
    bucket_artifacts: str = field(
        default_factory=lambda: _env("BUCKET_ARTIFACTS", "project-artifacts")
    )
    bucket_dashboards: str = field(
        default_factory=lambda: _env("BUCKET_DASHBOARDS", "dashboard-images")
    )
    bucket_reports: str = field(default_factory=lambda: _env("BUCKET_REPORTS", "reports"))
    max_upload_mb: int = field(default_factory=lambda: _env_int("MAX_UPLOAD_MB", 256))
    max_analysis_rows: int = field(
        default_factory=lambda: _env_int("MAX_ANALYSIS_ROWS", 5_000_000)
    )
    signed_url_ttl_seconds: int = field(
        default_factory=lambda: _env_int("SIGNED_URL_TTL_SECONDS", 900)
    )

    # ---- Local / dev fallback --------------------------------------------
    # When Supabase is not configured the service runs against a local
    # SQLite + filesystem store. Intended for CI, tests and local demos only.
    local_data_dir: str = field(
        default_factory=lambda: _env("LOCAL_DATA_DIR", os.path.abspath("./.analytics-data"))
    )
    dev_mode: bool = field(default_factory=lambda: _env_bool("DEV_MODE", False))
    dev_admin_email: str = field(
        default_factory=lambda: _env("DEV_ADMIN_EMAIL", "admin@localhost")
    )

    # ---- Runtime ----------------------------------------------------------
    cors_origins: List[str] = field(
        default_factory=lambda: [
            o.strip() for o in _env("CORS_ORIGINS", "*").split(",") if o.strip()
        ]
    )
    rate_limit_per_minute: int = field(
        default_factory=lambda: _env_int("RATE_LIMIT_PER_MINUTE", 120)
    )
    job_workers: int = field(default_factory=lambda: _env_int("JOB_WORKERS", 2))
    sql_connectors_enabled: bool = field(
        default_factory=lambda: _env_bool("SQL_CONNECTORS_ENABLED", False)
    )
    sql_allowed_drivers: List[str] = field(
        default_factory=lambda: [
            d.strip().lower()
            for d in _env("SQL_ALLOWED_DRIVERS", "postgresql").split(",")
            if d.strip()
        ]
    )

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    def resolved_llm_provider(self) -> str:
        """Return the provider actually usable right now."""
        choice = (self.llm_provider or "auto").lower()
        if choice == "openai":
            return "openai" if self.openai_api_key else "deterministic"
        if choice == "gemini":
            return "gemini" if self.gemini_api_key else "deterministic"
        if choice == "deterministic":
            return "deterministic"
        # auto
        if self.openai_api_key:
            return "openai"
        if self.gemini_api_key:
            return "gemini"
        return "deterministic"

    def public_config(self) -> dict:
        """Only values that are safe to hand to the Android client."""
        return {
            "supabase_url": self.supabase_url,
            "supabase_publishable_key": self.supabase_publishable_key,
            "max_upload_mb": self.max_upload_mb,
            "sql_connectors_enabled": self.sql_connectors_enabled,
            "supported_sources": ["csv", "excel"]
            + (["sql"] if self.sql_connectors_enabled else []),
            "llm_provider": self.resolved_llm_provider(),
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def reload_settings() -> Settings:
    get_settings.cache_clear()
    return get_settings()
