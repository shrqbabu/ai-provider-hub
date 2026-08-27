# API contract

Base path `/v1`. All responses are JSON. Every endpoint except `GET /v1/config` and `GET /health`
requires `Authorization: Bearer <supabase access token>` **and** an `admin` row in `public.profiles`.

Errors are returned as:

```json
{ "code": "RUN_IN_PROGRESS", "message": "An analysis is already running for this project.", "hint": "", "request_id": "…" }
```

(also accepted wrapped as `{"detail": { … }}` — the Android client parses both).

## Meta

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Liveness. Returns exactly `status`, `store`, `llm_provider`, `supabase_configured`, `sql_connectors_enabled`. Never leaks a key or a URL. |
| `GET` | `/v1/config` | Public client config: `max_upload_mb`, `sql_connectors_enabled`, `supported_sources`, `llm_provider`. |
| `GET` | `/v1/me` | The authenticated admin profile. Authorization is re-read from `profiles` on every call. |

## Projects

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/v1/projects` | `{ "projects": [...] }`, owner-scoped. |
| `POST` | `/v1/projects` | `{name, description, source_type}` → `201` with the project. `owner_id` is taken from the token, never the body. |
| `GET` | `/v1/projects/{id}` | Project, datasets, runs and prompt history. |
| `PATCH` | `/v1/projects/{id}` | `{name, description}`. |
| `DELETE` | `/v1/projects/{id}` | Cascades database rows and every stored object. |

## Datasets

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/v1/projects/{id}/datasets` | `multipart/form-data` with `file` and `declared_size`. Returns `{dataset, profile}`. |
| `GET` | `/v1/projects/{id}/datasets` | Datasets in the project. |
| `GET` | `/v1/datasets/{id}` | `{dataset}` including its parsed schema profile. |
| `GET` | `/v1/datasets/{id}/quality` | `{quality}` — score, grade, dimension scores, issues. |

Upload error codes: `UNSUPPORTED_EXTENSION`, `EMPTY_FILE`, `INVALID_FILE`, `FILE_TOO_LARGE`,
`SIZE_MISMATCH`, `PARSE_FAILED`, `TOO_MANY_ROWS`.

## Analysis runs

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/v1/projects/{id}/runs` | `{prompt}` → `202` with a queued run. `409 RUN_IN_PROGRESS` if one is active; `422` if the prompt is too short; `NO_DATASET` if nothing is attached. |
| `GET` | `/v1/runs/{id}` | Status, `stage_key`, `stage_label`, `progress`, counts, `duration_ms`, validation summary, error. |
| `POST` | `/v1/runs/{id}/cancel` | Cancels a queued or running job. |
| `GET` | `/v1/runs/{id}/results?section=…` | `overview`, `insights`, `metrics`, `report`, `dax`, `dashboard`, `quality`. `limit` / `offset` supported on `insights` and `metrics`. |
| `GET` | `/v1/runs/{id}/artifacts` | `{ "artifacts": [...] }`. |

`section=overview` returns the run, the validation report, the plan (selected skills and
`unsupported_requests`), headline metrics and artifacts.

## Artifacts

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/v1/artifacts/{id}/url` | Short-lived signed URL. |
| `GET` | `/v1/artifacts/{id}/content` | Streams the bytes through the authorized service. |

Artifact types: `data_quality`, `dashboard_png`, `dax`, `report`.

## SQL sources

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/v1/sql/connections` | `{enabled, connections[]}` — server-configured connections only; no credentials are returned. |
| `GET` | `/v1/sql/connections/{id}/schema` | Readable schemas and tables. |
| `POST` | `/v1/projects/{id}/sql-dataset` | `{connection_id, schema_name, tables[]}` → a dataset materialised by a read-only query. |

The client never sends SQL. Statements are constructed server-side, executed read-only, and rejected
by an allow-list before execution: `SQL_DISABLED`, `SQL_NOT_READ_ONLY`, `SQL_BLOCKED_KEYWORD`
(`DROP`, `DELETE`, `UPDATE`, `INSERT`, `TRUNCATE`, `ALTER`, `CREATE`).

## Audit

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/v1/audit` | Owner-scoped audit trail: who did what, to which resource, when. |

## Error codes

`RATE_LIMITED`, `NOT_FOUND`, `FORBIDDEN`, `NO_DATASET`, `RUN_IN_PROGRESS`, `TOO_MANY_ROWS`,
`SIZE_MISMATCH`, `PARSE_FAILED`, `UNSUPPORTED_EXTENSION`, `EMPTY_FILE`, `INVALID_FILE`,
`FILE_TOO_LARGE`, `SQL_DISABLED`, `SQL_NOT_READ_ONLY`, `SQL_BLOCKED_KEYWORD`, `AUTH_UNAVAILABLE`.
