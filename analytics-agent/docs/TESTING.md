# Testing

## Backend — 82 tests

```bash
cd analytics-agent/backend
pytest tests/ -q
```

| File | Covers |
| --- | --- |
| `test_auth_and_rls.py` | Valid and invalid credentials, missing and malformed tokens, non-admin rejection, cross-owner isolation on every resource, tampered `owner_id` / `project_id` in request bodies |
| `test_file_processing.py` | Valid CSV, malformed CSV, XLSX with multiple sheets, empty file, wrong extension, oversized file, declared-size mismatch, encoding and delimiter detection |
| `test_analytics.py` | Metric correctness against hand-computed expectations, growth calculation, aggregation grain, statistical outputs, forecasting preconditions, quality scoring |
| `test_dax_and_dashboard.py` | DAX generation and validation (unknown column, unknown table, unknown measure, unbalanced parentheses, time-intelligence forms), `.dax` text export, no-PBIX assertions, PNG resolution, value fidelity against the registry, prompt-driven layout, date-range labelling, validator falsification, rejection of causal, external and invented-metric claims, independent recomputation |
| `test_end_to_end.py` | Full journey (create → upload → prompt → run → results → artifacts), Excel journey, unsupported-metric declaration, `NO_DATASET`, short-prompt `422`, concurrent-run `409`, every upload error code, SQL disabled, destructive-SQL block list, read-only allow-list, `/health` leaks no secrets |

The suite runs entirely offline with `LLM_PROVIDER=deterministic`.

## Android

```bash
cd analytics-agent/android
./gradlew testDebugUnitTest
```

JVM only — no emulator or device required.

| File | Covers |
| --- | --- |
| `AppErrorTest` | HTTP status → typed error mapping (401/403/409/413/429/5xx), backend codes preserved, request id retained, every message specific and actionable |
| `UtilTest` | File validation (valid CSV and XLSX, empty, wrong extension, missing extension, oversized with the limit named), MIME mapping, byte/duration/relative-time formatting, unparseable timestamps, and the pipeline stage contract — exact order, monotonic progress ending at 100, graceful handling of unknown stages |
| `AnalyticsApiTest` | MockWebServer: bearer header, request paths and `section=` query parameters, tolerant decoding of unknown response fields, both error-envelope shapes, non-JSON error bodies, fail-fast on a missing token (no network call made) and on missing configuration, unauthenticated `/v1/config` |
| `AuthAndDaxTest` | Supabase password grant sends only the publishable key and never a privileged one, invalid credentials and refresh failure mapping, configuration detection; DAX canonical group ordering with unknown groups appended, search by name and by code, group filtering, copy-all output with group headers, and an assertion that no PBIX/PBIT surface exists |

## CI

Every push and pull request touching `analytics-agent/` runs the backend suite, the Android unit
tests, `lintDebug`, `assembleDebug` (APK uploaded as an artifact) and the secret/scope scan. See
`analytics-agent/ci/analytics-agent.yml` and `analytics-agent/ci/README.md`.

The workflow ships outside `.github/workflows/` because the agent integration that wrote it has no
GitHub App `workflows` permission. Install it once with `./analytics-agent/ci/install-ci.sh`.

## Manual verification performed

A live end-to-end run against a 6,000-row × 12-column synthetic retail dataset
(`backend/sample/retail_sales.csv`):

- Upload detected 6,000 rows, 12 columns and `order_date` as the date column.
- The run completed at 100 % with validation **passed, 12 of 12 checks**.
- Skills selected: customer, product, forecasting, sales, statistics.
- Unsupported request correctly declined: *"Contractual customer churn rate"*.
- Artifacts produced: `data-quality.json`, `dashboard.png` (515,967 bytes), `measures.dax`
  (5,362 bytes), `analysis-report.md` (6,079 bytes).
- Headline figures: Total Revenue 4.66M · Total Orders 6,000 · Unique Customers 898 ·
  Average Order Value 776.69 · Revenue Growth (MoM) −14.7 %. Data quality 100/100.
- Forecast fitted with Holt-Winters (additive trend, 12-month seasonality) over 33 months.

## Kotlin verification without an Android toolchain

The authoring sandbox cannot build an APK: `dl.google.com`, `maven.google.com`,
`repo1.maven.org`, `services.gradle.org` and `api.adoptium.net` are all network-blocked, so the
Android SDK, the Android Gradle Plugin and every AndroidX/Compose artifact are unreachable. CI is
therefore the first real compile, and the first APK comes from the `android` job.

To narrow the risk of a first-run failure, the sources were checked as far as is possible offline.
A JDK (`jdk4py`) and the Kotlin K2 CLI compiler (bundled inside `kotlin-jupyter-kernel`) are both
reachable from PyPI, which allowed running the real compiler rather than only inspecting text.

**Parse check — the whole app.** All 39 main sources plus the 4 test sources were fed to the K2
compiler. Every error was `unresolved reference` or a type-inference failure downstream of one;
there was **not a single parse or syntax error**. The handful of unusual-looking diagnostics were
each traced to a missing dependency rather than a defect:

| Diagnostic | Cause |
| --- | --- |
| `annotation argument must be a compile-time constant` | `@OptIn(ExperimentalMaterial3WindowSizeClassApi::class)` — the annotation class is in the missing Material3 artifact |
| `no value passed for parameter 'block'` (SessionStore) | `prefs.edit()` is unresolved, so `.apply()` binds to the stdlib `apply { }` extension instead of `SharedPreferences.Editor.apply()` |
| `no value passed for parameter 'p1'` (Common.kt) | the `@Composable () -> Unit` parameter type is unresolved |
| `one type argument expected … UiState.Success<*>` | bare-type inference needs the subject type, which was an error type here |

The last one was confirmed harmless by compiling and **running** a standalone reproduction of
`UiState` and the exact `(state as? UiState.Success)?.data` cast: it compiles clean and prints the
expected value. The same pattern is used in five places and only the one with a broken subject type
was flagged.

**Full type-check — the dependency-free subset.** `Models.kt`, `AppError.kt`, `Route.kt`,
`Formatters.kt` and `PipelineStage.kt` import nothing from Android or AndroidX, so they were
compiled for real against kotlin-stdlib and kotlinx-serialization: **zero errors, zero warnings,
76 class files**.

**Structural cross-check.** Every `@Composable` call site in `AnalyticsNavHost` was matched against
its declaration (missing and unknown named arguments), every ViewModel constructor arity against
its `VmFactory` site, and every `Icons.<style>.<name>` against its import: no mismatches. Two
genuinely unused imports were found and removed.

None of this substitutes for a compile against the real AndroidX artifacts — only the CI `android`
job can do that, which is why both Gradle steps run with `--stacktrace`.
