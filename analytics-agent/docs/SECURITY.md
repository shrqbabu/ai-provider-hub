# Security model

## Authentication

One login page, email and password, backed by Supabase Auth. There is no sign-up endpoint, no magic
link, no OAuth provider and no anonymous session in the app. Accounts are provisioned out of band.

## Authorization

Admin authority is a row in `public.profiles` with `role = 'admin'`. It is **never** read from JWT
user metadata, which a user can influence. The analytics service re-reads `profiles` on every
authenticated request, so revoking admin takes effect immediately rather than at the next token
refresh.

The Android client treats the result of `GET /v1/me` as the only authority. A valid Supabase account
that is not an admin is signed out immediately after login with an explanatory message.

## Row Level Security

RLS is enabled on every exposed table: `profiles`, `projects`, `datasets`, `dataset_tables`,
`analysis_runs`, `metrics`, `insights`, `dax_measures`, `artifacts`, `data_quality` and the audit
log. Policies scope every row to its owner and require the admin role. The service re-applies
`require_owned` even when it holds the service role, so a bug in a policy is not a single point of
failure.

`owner_id`, `role`, `project_id` and `storage_path` are always derived server-side. A value for any
of them in a request body is ignored.

## Storage

Four **private** buckets: `project-inputs`, `project-artifacts`, `dashboard-images`, `reports`.

- Object paths are namespaced `owner_id/project_id/...`, so one admin's path can never address
  another's object.
- No bucket is public. Access is only ever through a short-lived signed URL or a streamed download
  through the authorized service.
- Deleting a project removes its objects along with its rows.

## SQL access

Read-only, server-side, and only against connections an operator configured in `SQL_CONNECTIONS`.
The client cannot supply a connection string or a query. Every generated statement passes a
read-only allow-list; `DROP`, `DELETE`, `UPDATE`, `INSERT`, `TRUNCATE`, `ALTER` and `CREATE` are
blocked before execution. Connectors are disabled entirely unless `SQL_CONNECTORS_ENABLED=true`.

## Secrets

| Secret | Where it lives |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Analytics service only |
| `SUPABASE_JWT_SECRET` | Analytics service only |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` | Analytics service only |
| SQL connection credentials | Analytics service only |
| `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `ANALYTICS_API_URL` | Compiled into the app — all public by design |

The CI pipeline fails the build if any of `SERVICE_ROLE`, `service_role`, `OPENAI_API_KEY`,
`GEMINI_API_KEY`, `SUPABASE_JWT_SECRET`, `POSTGRES_PASSWORD` or `DATABASE_URL` ever appears in
`android/app/src/main`.

On the device, tokens are held in `EncryptedSharedPreferences` (AES-256-GCM, hardware-backed key
where available) and excluded from backup and device transfer. Cleartext HTTP is disabled.

## Input validation

- File type, extension, declared size versus actual size, empty file, and a configurable
  `MAX_UPLOAD_MB` ceiling.
- `MAX_ANALYSIS_ROWS` bounds the work a single run can schedule.
- Prompt length is bounded at both ends.
- All identifiers are validated as UUIDs before they reach a query.

## Rate limiting and abuse

`RATE_LIMIT_PER_MINUTE` is enforced per authenticated principal; exceeding it returns
`429 RATE_LIMITED`. Only one analysis may be active per project (`409 RUN_IN_PROGRESS`).

## Audit logging

Every mutating action — sign-in, project create/rename/delete, dataset upload, run start and cancel,
artifact access — is written to the audit table with the actor, the resource, the action and a
timestamp, readable through `GET /v1/audit`.

## Observability

Structured logs carry a request id, job and stage durations, model call counts, token usage, errors
and retries. Secrets, credentials, tokens and raw row data are never logged. `/health` deliberately
exposes only whether things are configured, never what they are configured with.
