# Deployment

## 1. Database

```bash
supabase link --project-ref <ref>
supabase db push
```

Migrations, applied in order:

| File | Contents |
| --- | --- |
| `20260827000100_core_schema.sql` | `profiles`, `projects`, `datasets`, `dataset_tables`, `analysis_runs`, `metrics`, `insights`, `dax_measures`, `artifacts`, `data_quality`, audit log |
| `20260827000200_rls_policies.sql` | RLS enabled and owner+admin policies on every exposed table |
| `20260827000300_storage_buckets.sql` | The four private buckets and their access policies |
| `20260827000400_admin_provisioning.sql` | Helper for promoting an existing auth user to `admin` |

Create the first administrator by inviting the user in Supabase Auth, then running the provisioning
function from migration `…0400` against their user id. Admin role lives in `profiles` and is not
user-editable.

## 2. Analytics service

```bash
cd analytics-agent/backend
docker build -t analytics-agent-api .
docker run --rm -p 8080:8080 --env-file .env analytics-agent-api
```

The image is `python:3.11-slim`, runs as a non-root user (uid 10001), sets `MPLBACKEND=Agg`, ships
DejaVu fonts for deterministic rendering, exposes `8080`, health-checks `/health` and serves with two
uvicorn workers.

### Environment

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side database and storage access |
| `SUPABASE_JWT_SECRET` | Local verification of access tokens |
| `SUPABASE_PUBLISHABLE_KEY` | Echoed to clients through `/v1/config` |
| `LLM_PROVIDER` | `openai`, `gemini` or `deterministic` |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | Any OpenAI-compatible endpoint |
| `GEMINI_API_KEY` / `GEMINI_BASE_URL` / `GEMINI_MODEL` | Gemini AI Studio |
| `BUCKET_INPUTS` / `BUCKET_ARTIFACTS` / `BUCKET_DASHBOARDS` / `BUCKET_REPORTS` | Storage bucket names |
| `MAX_UPLOAD_MB` | Upload ceiling (default 128) |
| `MAX_ANALYSIS_ROWS` | Row ceiling per run |
| `SIGNED_URL_TTL_SECONDS` | Signed URL lifetime |
| `RATE_LIMIT_PER_MINUTE` | Per-principal request limit |
| `JOB_WORKERS` | Concurrent analysis jobs |
| `CORS_ORIGINS` | Allowed origins |
| `LOG_LEVEL` | Log verbosity |
| `SQL_CONNECTORS_ENABLED` / `SQL_ALLOWED_DRIVERS` / `SQL_CONNECTIONS` | Read-only SQL sources |
| `LOCAL_DATA_DIR` | Local filesystem store (development only) |
| `DEV_MODE` | Enables `/docs` and `Bearer dev.<uuid>` tokens — **never** in production |

`.env.example` documents every value. Provider resolution: explicit `LLM_PROVIDER` → OpenAI key →
Gemini key → `deterministic`. With no keys at all, the service still completes a full run.

SQL drivers are optional: `pip install -r requirements-sql.txt`.

## 3. Android app

```bash
cd analytics-agent/android
cp local.defaults.properties.example local.defaults.properties
```

```properties
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable key>
ANALYTICS_API_URL=https://analytics.example.com
```

The file is git-ignored; the same three values can be supplied as environment variables instead.

```bash
./gradlew testDebugUnitTest      # JVM unit tests
./gradlew assembleDebug          # debug APK
./gradlew assembleRelease        # minified + resource-shrunk
```

Release builds need signing configuration added to `app/build.gradle.kts` or supplied by your
signing pipeline.

## 4. CI

`ci/analytics-agent.yml` (copy it to `.github/workflows/` — see `ci/README.md`) runs on every push and pull request that touches
`analytics-agent/`:

1. **backend** — Python 3.11, install requirements, `pytest tests/ -q`.
2. **android** — JDK 17, Gradle 8.11.1, `testDebugUnitTest`, `lintDebug`, `assembleDebug`,
   uploading the APK and the test report as artifacts.
3. **secret-scan** — fails if a privileged credential name appears in the shipped Android sources, or
   if a `.pbix` / `.pbit` reference appears anywhere in the backend or app.

Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `ANALYTICS_API_URL` as repository **variables**
(not secrets — they are public values) for CI builds to be pointed at a real deployment.

## Operational notes

- Scale the service horizontally; jobs are per-instance, so run a single instance per project's
  active job or move the queue to shared infrastructure before scaling out.
- `MPLBACKEND=Agg` is mandatory — the renderer is headless.
- Monitor `/health` for `status`, `store` and `llm_provider`.
- Rotate the service-role key and the AI provider keys on the service only; no client rebuild is
  needed, because none of them are ever shipped to a device.
