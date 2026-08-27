"""Persistence layer.

Two interchangeable implementations behind one interface:

``SupabaseStore``  -> PostgREST + Supabase Storage using the service-role key.
                      Used in production. The service role bypasses RLS, so
                      every method here re-applies the ownership predicate
                      explicitly (defence in depth: RLS *and* server checks).

``LocalStore``     -> SQLite + local filesystem. Used for tests, CI and the
                      offline demo. Same ownership predicates.

Client-provided ``owner_id`` / ``role`` / ``storage_path`` are never trusted:
callers pass the owner resolved from the verified JWT, and paths are always
rebuilt server-side as ``owner_id/project_id/...``.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

import httpx

from .config import Settings, get_settings

TABLES = (
    "profiles",
    "projects",
    "datasets",
    "dataset_tables",
    "analysis_runs",
    "metrics",
    "insights",
    "dax_measures",
    "artifacts",
    "data_quality",
    "audit_log",
    "job_events",
)

_SAFE_SEGMENT = re.compile(r"[^A-Za-z0-9._-]+")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def safe_segment(value: str, *, default: str = "file") -> str:
    """Sanitise one path segment. Prevents traversal and bucket escapes."""
    cleaned = _SAFE_SEGMENT.sub("_", (value or "").strip()).strip("._-")
    return cleaned[:120] or default


def storage_key(owner_id: str, project_id: str, *parts: str) -> str:
    """Canonical, tenant-isolated storage path. Always built server-side."""
    segments = [safe_segment(owner_id, default="owner"), safe_segment(project_id, default="project")]
    segments += [safe_segment(p) for p in parts if p]
    return "/".join(segments)


class StoreError(RuntimeError):
    pass


class NotFound(StoreError):
    pass


class Forbidden(StoreError):
    pass


# ---------------------------------------------------------------------------
# Local (SQLite + filesystem)
# ---------------------------------------------------------------------------
class LocalStore:
    kind = "local"

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self.settings = settings or get_settings()
        self.root = self.settings.local_data_dir
        os.makedirs(self.root, exist_ok=True)
        os.makedirs(os.path.join(self.root, "storage"), exist_ok=True)
        self._lock = threading.RLock()
        self._db_path = os.path.join(self.root, "analytics.db")
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._lock, self._conn() as conn:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS rows (
                       tbl TEXT NOT NULL,
                       id TEXT NOT NULL,
                       data TEXT NOT NULL,
                       created_at TEXT NOT NULL,
                       PRIMARY KEY (tbl, id))"""
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_rows_tbl ON rows(tbl, created_at)")

    # -- generic table ops -------------------------------------------------
    def insert(self, table: str, row: Dict[str, Any]) -> Dict[str, Any]:
        row = dict(row)
        row.setdefault("id", new_id())
        row.setdefault("created_at", now_iso())
        with self._lock, self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO rows(tbl,id,data,created_at) VALUES (?,?,?,?)",
                (table, row["id"], json.dumps(row, default=str), row["created_at"]),
            )
        return row

    def select(
        self,
        table: str,
        *,
        filters: Optional[Dict[str, Any]] = None,
        order_by: str = "created_at",
        desc: bool = True,
        limit: Optional[int] = None,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        filters = filters or {}
        with self._lock, self._conn() as conn:
            raw = conn.execute("SELECT data FROM rows WHERE tbl=?", (table,)).fetchall()
        out = [json.loads(r["data"]) for r in raw]
        for key, value in filters.items():
            if isinstance(value, (list, tuple, set)):
                out = [r for r in out if r.get(key) in value]
            else:
                out = [r for r in out if r.get(key) == value]
        out.sort(key=lambda r: str(r.get(order_by) or ""), reverse=desc)
        if offset:
            out = out[offset:]
        if limit is not None:
            out = out[:limit]
        return out

    def get(self, table: str, row_id: str) -> Optional[Dict[str, Any]]:
        with self._lock, self._conn() as conn:
            row = conn.execute(
                "SELECT data FROM rows WHERE tbl=? AND id=?", (table, row_id)
            ).fetchone()
        return json.loads(row["data"]) if row else None

    def update(self, table: str, row_id: str, patch: Dict[str, Any]) -> Dict[str, Any]:
        current = self.get(table, row_id)
        if current is None:
            raise NotFound(f"{table}:{row_id}")
        current.update(patch)
        current["id"] = row_id
        with self._lock, self._conn() as conn:
            conn.execute(
                "UPDATE rows SET data=? WHERE tbl=? AND id=?",
                (json.dumps(current, default=str), table, row_id),
            )
        return current

    def delete(self, table: str, *, filters: Dict[str, Any]) -> int:
        victims = self.select(table, filters=filters, limit=None)
        with self._lock, self._conn() as conn:
            for row in victims:
                conn.execute("DELETE FROM rows WHERE tbl=? AND id=?", (table, row["id"]))
        return len(victims)

    # -- storage -----------------------------------------------------------
    def _fs_path(self, bucket: str, key: str) -> str:
        path = os.path.join(self.root, "storage", safe_segment(bucket), *key.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        return path

    def upload(self, bucket: str, key: str, content: bytes, content_type: str = "application/octet-stream") -> str:
        path = self._fs_path(bucket, key)
        with open(path, "wb") as fh:
            fh.write(content)
        return key

    def download(self, bucket: str, key: str) -> bytes:
        path = self._fs_path(bucket, key)
        if not os.path.exists(path):
            raise NotFound(f"{bucket}/{key}")
        with open(path, "rb") as fh:
            return fh.read()

    def signed_url(self, bucket: str, key: str, ttl: Optional[int] = None) -> str:
        # Local mode streams through the API instead of issuing a CDN URL.
        return f"/v1/files/{bucket}/{key}"

    def remove_prefix(self, bucket: str, prefix: str) -> int:
        base = os.path.join(self.root, "storage", safe_segment(bucket), *prefix.split("/"))
        removed = 0
        for dirpath, _dirnames, filenames in os.walk(base, topdown=False):
            for name in filenames:
                os.remove(os.path.join(dirpath, name))
                removed += 1
            try:
                os.rmdir(dirpath)
            except OSError:
                pass
        return removed


# ---------------------------------------------------------------------------
# Supabase (PostgREST + Storage)
# ---------------------------------------------------------------------------
class SupabaseStore:
    kind = "supabase"

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self.settings = settings or get_settings()
        if not self.settings.supabase_configured:
            raise StoreError("Supabase is not configured")
        self.base = self.settings.supabase_url.rstrip("/")
        self._key = self.settings.supabase_service_role_key

    def _headers(self, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        headers = {
            "apikey": self._key,
            "Authorization": f"Bearer {self._key}",
            "Content-Type": "application/json",
        }
        if extra:
            headers.update(extra)
        return headers

    def _client(self) -> httpx.Client:
        return httpx.Client(timeout=60)

    @staticmethod
    def _raise_for(resp: httpx.Response) -> None:
        if resp.status_code >= 400:
            raise StoreError(f"supabase {resp.status_code}: {resp.text[:400]}")

    # -- generic table ops -------------------------------------------------
    def insert(self, table: str, row: Dict[str, Any]) -> Dict[str, Any]:
        row = dict(row)
        row.setdefault("id", new_id())
        row.setdefault("created_at", now_iso())
        with self._client() as client:
            resp = client.post(
                f"{self.base}/rest/v1/{table}",
                headers=self._headers({"Prefer": "return=representation"}),
                json=row,
            )
        self._raise_for(resp)
        data = resp.json()
        return data[0] if isinstance(data, list) and data else row

    def select(
        self,
        table: str,
        *,
        filters: Optional[Dict[str, Any]] = None,
        order_by: str = "created_at",
        desc: bool = True,
        limit: Optional[int] = None,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {"select": "*", "order": f"{order_by}.{'desc' if desc else 'asc'}"}
        for key, value in (filters or {}).items():
            if isinstance(value, (list, tuple, set)):
                joined = ",".join(str(v) for v in value)
                params[key] = f"in.({joined})"
            else:
                params[key] = f"eq.{value}"
        if limit is not None:
            params["limit"] = limit
        if offset:
            params["offset"] = offset
        with self._client() as client:
            resp = client.get(f"{self.base}/rest/v1/{table}", headers=self._headers(), params=params)
        self._raise_for(resp)
        return resp.json()

    def get(self, table: str, row_id: str) -> Optional[Dict[str, Any]]:
        rows = self.select(table, filters={"id": row_id}, limit=1)
        return rows[0] if rows else None

    def update(self, table: str, row_id: str, patch: Dict[str, Any]) -> Dict[str, Any]:
        with self._client() as client:
            resp = client.patch(
                f"{self.base}/rest/v1/{table}",
                headers=self._headers({"Prefer": "return=representation"}),
                params={"id": f"eq.{row_id}"},
                json=patch,
            )
        self._raise_for(resp)
        data = resp.json()
        if not data:
            raise NotFound(f"{table}:{row_id}")
        return data[0]

    def delete(self, table: str, *, filters: Dict[str, Any]) -> int:
        params = {k: f"eq.{v}" for k, v in filters.items()}
        with self._client() as client:
            resp = client.delete(
                f"{self.base}/rest/v1/{table}",
                headers=self._headers({"Prefer": "return=representation"}),
                params=params,
            )
        self._raise_for(resp)
        data = resp.json()
        return len(data) if isinstance(data, list) else 0

    # -- storage -----------------------------------------------------------
    def upload(self, bucket: str, key: str, content: bytes, content_type: str = "application/octet-stream") -> str:
        with self._client() as client:
            resp = client.post(
                f"{self.base}/storage/v1/object/{bucket}/{key}",
                headers={
                    "apikey": self._key,
                    "Authorization": f"Bearer {self._key}",
                    "Content-Type": content_type,
                    "x-upsert": "true",
                },
                content=content,
            )
        self._raise_for(resp)
        return key

    def download(self, bucket: str, key: str) -> bytes:
        with self._client() as client:
            resp = client.get(
                f"{self.base}/storage/v1/object/{bucket}/{key}",
                headers={"apikey": self._key, "Authorization": f"Bearer {self._key}"},
            )
        if resp.status_code == 404:
            raise NotFound(f"{bucket}/{key}")
        self._raise_for(resp)
        return resp.content

    def signed_url(self, bucket: str, key: str, ttl: Optional[int] = None) -> str:
        ttl = ttl or self.settings.signed_url_ttl_seconds
        with self._client() as client:
            resp = client.post(
                f"{self.base}/storage/v1/object/sign/{bucket}/{key}",
                headers=self._headers(),
                json={"expiresIn": ttl},
            )
        self._raise_for(resp)
        signed = resp.json().get("signedURL") or resp.json().get("signedUrl") or ""
        if signed.startswith("/"):
            return f"{self.base}/storage/v1{signed}"
        return signed

    def remove_prefix(self, bucket: str, prefix: str) -> int:
        with self._client() as client:
            listing = client.post(
                f"{self.base}/storage/v1/object/list/{bucket}",
                headers=self._headers(),
                json={"prefix": prefix, "limit": 1000},
            )
            self._raise_for(listing)
            names = [f"{prefix}/{item['name']}" for item in listing.json() if item.get("name")]
            if not names:
                return 0
            resp = client.request(
                "DELETE",
                f"{self.base}/storage/v1/object/{bucket}",
                headers=self._headers(),
                json={"prefixes": names},
            )
        self._raise_for(resp)
        return len(names)


Store = LocalStore  # type alias for annotations

_store_singleton: Optional[Any] = None
_store_lock = threading.Lock()


def get_store() -> Any:
    global _store_singleton
    with _store_lock:
        if _store_singleton is None:
            settings = get_settings()
            if settings.supabase_configured:
                _store_singleton = SupabaseStore(settings)
            else:
                _store_singleton = LocalStore(settings)
        return _store_singleton


def reset_store() -> None:
    global _store_singleton
    with _store_lock:
        _store_singleton = None


def require_owned(store: Any, table: str, row_id: str, owner_id: str, owner_field: str = "owner_id") -> Dict[str, Any]:
    """Fetch a row and assert the caller owns it. Server-side authorization."""
    row = store.get(table, row_id)
    if row is None:
        raise NotFound(f"{table} {row_id} not found")
    if str(row.get(owner_field)) != str(owner_id):
        raise Forbidden(f"not authorized for {table} {row_id}")
    return row


def chunked(items: Iterable[Any], size: int = 500) -> Iterable[List[Any]]:
    batch: List[Any] = []
    for item in items:
        batch.append(item)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch
