"""Read-only SQL connector.

The Android client never talks to a company database. It asks this backend to
introspect a **pre-registered** connection whose credentials live only in
server-side environment variables. Nothing about the connection string ever
crosses the wire to the device.

Enforcement:
  * only ``SELECT`` / ``WITH`` statements are accepted;
  * every DDL/DML keyword is blocked before the statement reaches the driver;
  * the session itself is opened read-only where the driver supports it;
  * a row cap is always applied.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from ..config import get_settings

BLOCKED_KEYWORDS = (
    "DROP", "DELETE", "UPDATE", "INSERT", "TRUNCATE", "ALTER", "CREATE", "GRANT", "REVOKE",
    "MERGE", "REPLACE", "CALL", "EXEC", "EXECUTE", "COPY", "VACUUM", "REINDEX", "CLUSTER",
    "COMMIT", "ROLLBACK", "SET", "LOCK", "ATTACH", "DETACH", "PRAGMA",
)
_KEYWORD_RE = re.compile(r"\b(" + "|".join(BLOCKED_KEYWORDS) + r")\b", re.I)
_COMMENT_RE = re.compile(r"(--[^\n]*|/\*.*?\*/)", re.S)


class SqlError(RuntimeError):
    def __init__(self, message: str, code: str = "SQL_ERROR") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def assert_read_only(sql: str) -> str:
    """Reject anything that is not a single read-only statement."""
    if not sql or not sql.strip():
        raise SqlError("Empty SQL statement.", "SQL_EMPTY")
    stripped = _COMMENT_RE.sub(" ", sql).strip().rstrip(";")
    if ";" in stripped:
        raise SqlError("Multiple statements are not allowed.", "SQL_MULTI_STATEMENT")
    first = stripped.lstrip("( \n\t").split(None, 1)[0].upper() if stripped.split() else ""
    if first not in {"SELECT", "WITH"}:
        raise SqlError(
            f"Only read-only SELECT queries are permitted; '{first or 'statement'}' was rejected.",
            "SQL_NOT_READ_ONLY",
        )
    blocked = _KEYWORD_RE.search(stripped)
    if blocked:
        raise SqlError(
            f"The keyword '{blocked.group(1).upper()}' is blocked. This analytics agent has read-only access.",
            "SQL_BLOCKED_KEYWORD",
        )
    return stripped


def list_connections() -> List[Dict[str, Any]]:
    """Connections registered server-side via SQL_CONNECTIONS (JSON).

    Format (server env only):
      [{"id":"warehouse","label":"Analytics warehouse","driver":"postgresql",
        "dsn_env":"WAREHOUSE_DSN","default_schema":"public"}]
    The DSN itself is read from ``dsn_env`` and never returned to any client.
    """
    settings = get_settings()
    if not settings.sql_connectors_enabled:
        return []
    raw = os.getenv("SQL_CONNECTIONS", "").strip()
    if not raw:
        return []
    try:
        entries = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SqlError(f"SQL_CONNECTIONS is not valid JSON: {exc}", "SQL_CONFIG_INVALID") from exc
    out: List[Dict[str, Any]] = []
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict) or not entry.get("id"):
            continue
        driver = str(entry.get("driver", "postgresql")).lower()
        if driver not in settings.sql_allowed_drivers:
            continue
        out.append(
            {
                "id": str(entry["id"]),
                "label": str(entry.get("label") or entry["id"]),
                "driver": driver,
                "default_schema": str(entry.get("default_schema") or "public"),
                "configured": bool(os.getenv(str(entry.get("dsn_env") or ""))),
                "access": "read_only",
            }
        )
    return out


def _resolve_dsn(connection_id: str) -> Tuple[str, Dict[str, Any]]:
    raw = os.getenv("SQL_CONNECTIONS", "").strip()
    entries = json.loads(raw) if raw else []
    for entry in entries if isinstance(entries, list) else []:
        if str(entry.get("id")) == connection_id:
            dsn = os.getenv(str(entry.get("dsn_env") or ""), "")
            if not dsn:
                raise SqlError(
                    f"Connection '{connection_id}' is registered but its credentials are not configured on the server.",
                    "SQL_NOT_CONFIGURED",
                )
            return dsn, entry
    raise SqlError(f"Unknown SQL connection '{connection_id}'.", "SQL_UNKNOWN_CONNECTION")


def _engine(connection_id: str):
    try:
        from sqlalchemy import create_engine
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise SqlError(
            "SQL support requires the optional 'sqlalchemy' dependency on the analytics backend.",
            "SQL_DRIVER_MISSING",
        ) from exc
    dsn, entry = _resolve_dsn(connection_id)
    engine = create_engine(dsn, pool_pre_ping=True, connect_args=_connect_args(entry))
    return engine, entry


def _connect_args(entry: Dict[str, Any]) -> Dict[str, Any]:
    driver = str(entry.get("driver", "postgresql")).lower()
    if driver.startswith("postgres"):
        # Server-side read-only enforcement in addition to statement filtering.
        return {"options": "-c default_transaction_read_only=on -c statement_timeout=60000"}
    return {}


def introspect(connection_id: str, schema: Optional[str] = None) -> Dict[str, Any]:
    """Read-only schema introspection: tables, columns, keys, relationships."""
    from sqlalchemy import inspect as sa_inspect

    engine, entry = _engine(connection_id)
    schema = schema or entry.get("default_schema") or None
    inspector = sa_inspect(engine)

    tables: List[Dict[str, Any]] = []
    relationships: List[Dict[str, Any]] = []
    for table_name in inspector.get_table_names(schema=schema):
        columns = [
            {"name": c["name"], "type": str(c["type"]), "nullable": bool(c.get("nullable", True))}
            for c in inspector.get_columns(table_name, schema=schema)
        ]
        pk = (inspector.get_pk_constraint(table_name, schema=schema) or {}).get("constrained_columns", [])
        indexes = [
            {"name": i.get("name"), "columns": i.get("column_names", []), "unique": bool(i.get("unique"))}
            for i in inspector.get_indexes(table_name, schema=schema)
        ]
        tables.append(
            {"table_name": table_name, "schema": schema, "columns": columns, "primary_key": pk, "indexes": indexes}
        )
        for fk in inspector.get_foreign_keys(table_name, schema=schema):
            if fk.get("referred_table"):
                relationships.append(
                    {
                        "from_table": table_name,
                        "from_column": (fk.get("constrained_columns") or [None])[0],
                        "to_table": fk["referred_table"],
                        "to_column": (fk.get("referred_columns") or [None])[0],
                        "cardinality": "many-to-one",
                        "match_pct": 100.0,
                        "safe_to_join": True,
                        "source": "foreign_key",
                    }
                )
    engine.dispose()
    return {
        "connection_id": connection_id,
        "schema": schema,
        "access": "read_only",
        "table_count": len(tables),
        "tables": tables,
        "relationships": relationships,
    }


def read_table(connection_id: str, table_name: str, schema: Optional[str] = None, limit: int = 200_000) -> pd.DataFrame:
    from sqlalchemy import text

    safe_table = re.sub(r"[^A-Za-z0-9_]", "", table_name)
    if safe_table != table_name:
        raise SqlError(f"Illegal table name '{table_name}'.", "SQL_ILLEGAL_IDENTIFIER")
    safe_schema = re.sub(r"[^A-Za-z0-9_]", "", schema or "") or None
    qualified = f'"{safe_schema}"."{safe_table}"' if safe_schema else f'"{safe_table}"'
    query = assert_read_only(f"SELECT * FROM {qualified} LIMIT {int(limit)}")

    engine, _entry = _engine(connection_id)
    try:
        with engine.connect() as conn:
            frame = pd.read_sql(text(query), conn)
    finally:
        engine.dispose()
    return frame


def materialise_sql_dataset(dataset: Dict[str, Any]) -> Tuple[Dict[str, pd.DataFrame], Dict[str, Any]]:
    """Load the selected SQL tables into frames for the analysis pipeline."""
    from ..engine.ingest import TableData, profile_table

    config = dataset.get("sql_config") or {}
    connection_id = config.get("connection_id")
    if not connection_id:
        raise SqlError("This dataset has no SQL connection reference.", "SQL_UNKNOWN_CONNECTION")
    schema = config.get("schema")
    table_names = config.get("tables") or []
    if not table_names:
        raise SqlError("No tables were selected for this SQL dataset.", "SQL_NO_TABLES")

    frames: Dict[str, pd.DataFrame] = {}
    profiles: Dict[str, Any] = {}
    for name in table_names[:12]:
        frame = read_table(connection_id, name, schema)
        table = TableData(name=re.sub(r"[^A-Za-z0-9_]+", "_", name), frame=frame)
        profiles[table.name] = profile_table(table)
        frames[table.name] = table.frame
    return frames, profiles
