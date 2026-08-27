# CI workflow

`analytics-agent.yml` is the GitHub Actions workflow for this subtree. It builds the Android app,
runs both test suites, and scans for leaked credentials.

## Install it (one command)

```bash
./analytics-agent/ci/install-ci.sh
```

Run it from the repository root. It copies the workflow to `.github/workflows/`, commits it and
pushes. Use `--no-push` if you want to review the commit first.

Prefer the web UI? Open **Actions → New workflow → set up a workflow yourself**, paste the contents
of `analytics-agent.yml`, and commit it as `.github/workflows/analytics-agent.yml`.

### Why it isn't already installed

The agent integration that wrote this code does not hold the GitHub App `workflows` permission, so
GitHub rejects any push that creates or edits a file under `.github/workflows/`:

```
! [remote rejected] refusing to allow a GitHub App to create or update workflow
  `.github/workflows/analytics-agent.yml` without `workflows` permission
```

The REST Contents API is blocked for the same reason (`403 Resource not accessible by integration`).
Your account has the permission the App lacks, which is why the install step has to happen from your
side. Granting the App `workflows` write access in the GitHub App settings would also solve it
permanently.

## What it runs

Triggered on push, pull request (paths under `analytics-agent/`) and manual dispatch.
The three jobs are independent, so an Android failure never hides a backend failure.

| Job | Steps |
| --- | --- |
| **backend** | Python 3.11, pip cache, install `requirements.txt` + `requirements-dev.txt`, `pytest tests/ -q` |
| **android** | JDK 17 (Temurin), Gradle 8.11.1 with build caching, write `local.defaults.properties` from repository variables, `testDebugUnitTest`, `lintDebug` (non-blocking), `assembleDebug` — both Gradle builds run with `--stacktrace` so a first-compile failure is diagnosable — then upload the debug APK and the unit-test HTML report as artifacts |
| **secret-scan** | Fails the build if `SERVICE_ROLE`, `service_role`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `SUPABASE_JWT_SECRET`, `POSTGRES_PASSWORD` or `DATABASE_URL` appears anywhere in `analytics-agent/android/app/src/main`, or if a `.pbix` / `.pbit` reference appears in the backend or the app |

## Configuration

Set these as repository **variables** — Settings → Secrets and variables → Actions → Variables.
They are public values, not secrets, and the build succeeds without them (the APK is simply built
against an empty configuration):

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `ANALYTICS_API_URL`

The workflow never needs a service-role key, a database credential or an AI provider key. None of
them belong in a client build, and the secret-scan job enforces that.

## Where the artifacts land

After a run, open the workflow summary:

- **analytics-agent-debug-apk** — the installable debug APK
- **android-unit-test-report** — the JVM unit-test HTML report (uploaded even when the build fails)

## Note on the first run

The Android app has never been compiled — the authoring environment had no JDK, Gradle or Android
SDK, so CI is the first real compile. Expect the possibility of a small number of import-level
fixes on that first run; `--stacktrace` is enabled to make them obvious.
