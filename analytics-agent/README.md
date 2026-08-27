# Data Analytics AI Agent

An admin-only enterprise analytics workspace for Android.

**CSV / Excel / SQL → data analysis → user-defined report → insights → DAX → dashboard PNG**, saved as projects.

This is not a chatbot. There is no conversation, no public sign-up and no interactive Power BI
artifact. An administrator creates a project, attaches data, writes one description of the report
they want, and the agent runs a fixed, validated pipeline that produces a report, verified metrics,
insights, DAX measures and a high-resolution dashboard image.

---

## Contents

| Path | What it is |
| --- | --- |
| `backend/` | FastAPI analytics service: deterministic engine (Pandas/NumPy/SciPy/statsmodels/scikit-learn), skills, DAX generator, matplotlib dashboard renderer, independent validator |
| `android/` | Kotlin + Jetpack Compose (Material 3) admin app |
| `supabase/` | Version-controlled SQL migrations: schema, RLS policies, private storage buckets, admin provisioning |
| `docs/` | Architecture, API contract, security model, deployment, testing |

Documentation index: [`docs/README.md`](docs/README.md).

---

## What the agent produces

For each analysis run:

1. **Data quality report** — completeness, validity, consistency, uniqueness, relationships, scored 0–100 with concrete issues.
2. **Metric registry** — every number the system will ever show, computed once by the deterministic engine, each with an id, definition, formula and source.
3. **Written report** — only the sections the admin asked for, populated with registry values.
4. **Insights** — finding, interpretation, business impact, recommendation, each tied to metric ids as evidence.
5. **DAX** — measures, calculated columns and date-table DAX, grouped, individually validated.
6. **Dashboard PNG** — a single high-resolution image whose every printed value is reconciled against the registry.

Everything downstream reads from the same metric registry, so the report, the DAX and the image cannot disagree.

## What it will never do

- Generate a `.pbix` or `.pbit` file, or publish anything to Power BI.
- Invent a metric, a column, a benchmark, an industry average or a causal claim.
- Let a non-admin in. There is no registration, no social login and no guest mode.
- Run a write statement against a SQL source. SQL access is read-only and server-side only.
- Ship a service-role key, a database credential or an AI provider key inside the APK.

When a request cannot be honoured by the data, the run reports it as `NOT_SUPPORTED` with the reason
and a workable alternative, rather than guessing.

---

## Quick start

### Backend

```bash
cd analytics-agent/backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
pytest tests/ -q                       # 82 tests
cp .env.example .env                   # fill in Supabase + LLM values
DEV_MODE=true LLM_PROVIDER=deterministic uvicorn app.main:app --host 0.0.0.0 --port 8080
```

The service runs fully offline with `LLM_PROVIDER=deterministic`. Point it at an
OpenAI-compatible endpoint or Gemini AI Studio when you want narrative polish — arithmetic is
never delegated to a model either way.

### Android

```bash
cd analytics-agent/android
cp local.defaults.properties.example local.defaults.properties   # git-ignored
# fill in SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, ANALYTICS_API_URL
./gradlew testDebugUnitTest assembleDebug
```

CI does the same on every push: [`ci/analytics-agent.yml`](ci/analytics-agent.yml)
runs the backend suite, the Android unit tests, `assembleDebug`, and a scan that fails the build if a
privileged credential name or a PBIX/PBIT reference ever appears in the shipped sources.

### Database

```bash
supabase db push          # applies supabase/migrations in order
```

Then provision the first administrator with the function in `20260827000400_admin_provisioning.sql`.
Admin authority lives in `public.profiles.role`, which users cannot edit — never in JWT user metadata.

---

## Pipeline

```
VALIDATING_INPUT → PROFILING → DATA_QUALITY → SCHEMA_MODELING → ANALYSIS_PLANNING
→ DETERMINISTIC_CALCULATIONS → BUSINESS_ANALYSIS → STATISTICS → FORECASTING
→ INSIGHT_GENERATION → DAX_GENERATION → DAX_VALIDATION → REPORT_GENERATION
→ DASHBOARD_PNG_GENERATION → FINAL_VALIDATION → COMPLETED
```

Runs are asynchronous (`queued / running / completed / failed / cancelled`) and report their stage and
percentage to the app throughout. A critical failure in the final validator ends the run as
`VALIDATION_FAILED`; nothing is presented to the admin as validated when it is not.

## Skills

Sales, Customer, Product, Inventory, Forecasting, Statistical, DAX and Dashboard skills are selected
automatically from the shape of the data, the admin's prompt and the project's domain. A skill that
the data cannot feed is declined rather than approximated.
