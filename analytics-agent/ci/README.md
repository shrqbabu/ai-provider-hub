# CI workflow

`analytics-agent.yml` is the GitHub Actions workflow for this subtree.

It is kept here rather than in `.github/workflows/` because the integration that pushed this branch
does not hold the GitHub `workflows` permission and the push is rejected when a workflow file is
added or changed. Install it with a single command:

```bash
mkdir -p .github/workflows
cp analytics-agent/ci/analytics-agent.yml .github/workflows/analytics-agent.yml
git add .github/workflows/analytics-agent.yml && git commit -m "Add analytics-agent CI"
```

## What it runs

Triggered on push, pull request (paths under `analytics-agent/`) and manual dispatch.

| Job | Steps |
| --- | --- |
| **backend** | Python 3.11, install `requirements.txt` + `requirements-dev.txt`, `pytest tests/ -q` |
| **android** | JDK 17, Gradle 8.11.1, write `local.defaults.properties` from repository variables, `testDebugUnitTest`, `lintDebug`, `assembleDebug`, upload the APK and the unit-test report |
| **secret-scan** | Fails if `SERVICE_ROLE`, `service_role`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `SUPABASE_JWT_SECRET`, `POSTGRES_PASSWORD` or `DATABASE_URL` appears in `analytics-agent/android/app/src/main`, or if a `.pbix` / `.pbit` reference appears in the backend or the app |

## Configuration

Set these as repository **variables** (they are public values, not secrets):

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `ANALYTICS_API_URL`

The workflow never needs a service-role key, a database credential or an AI provider key — none of
them belong in a client build.
