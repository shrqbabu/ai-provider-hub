# Android app

Kotlin · Jetpack Compose · Material 3 · ViewModel + StateFlow · Navigation Compose · Coroutines.

`minSdk 26`, `compileSdk`/`targetSdk 35`, JVM target 17, AGP 8.7.3, Kotlin 2.0.21.

## Source layout

```
com.analytics.agent
├── AnalyticsApp.kt              manual dependency graph (three public BuildConfig values)
├── MainActivity.kt              edge-to-edge host, window size class
├── data
│   ├── SessionStore.kt          EncryptedSharedPreferences token storage
│   ├── model/Models.kt          wire DTOs, tolerant of unknown fields
│   ├── remote
│   │   ├── Http.kt              shared OkHttp client, JSON config, error parsing
│   │   ├── AppError.kt          every failure the UI can show, with an actionable message
│   │   ├── SupabaseAuth.kt      password sign-in / refresh / sign-out only
│   │   └── AnalyticsApi.kt      typed client for the analytics service
│   └── repository/AnalyticsRepository.kt
└── ui
    ├── UiState.kt               Loading | Success(stale) | Empty | Failure
    ├── theme/Theme.kt           light + dark palettes, semantic status colours, type scale
    ├── components/Common.kt     cards, chips, score bars, loading/empty/error states
    ├── navigation/              Route definitions and the NavHost
    └── screens/                 one package per screen: ViewModel + Composable
```

## Screens

| Screen | Purpose |
| --- | --- |
| **Login** | The only authentication surface. Email + password. No sign-up, no social, no guest. Authorization is confirmed server-side via `GET /v1/me` — a valid account that is not an admin is signed straight back out. |
| **Projects** | Cached, searchable list. Adaptive grid: one column on a phone, adaptive multi-column on a tablet. Shows dataset/run counts and the latest run status. |
| **New Project** | Name, description, source type (CSV/TSV, Excel, or SQL when the deployment enables it). |
| **Dataset** | Streamed upload with progress and cancel, then the parsed profile: tables, row/column counts, per-column semantic type and null percentage, detected date range. |
| **Data Quality** | 0–100 score, the five dimension scores, and every issue with severity, dimension and location. |
| **Report Prompt** | The user-defined report. Free text with a character floor, five starting-point suggestions, and the project's prompt history with one-tap reuse. |
| **Analysis Progress** | Live stage label, description, percentage, elapsed time and the full sixteen-stage timeline. Cancel while running. Tolerates connection loss without losing state. |
| **Analysis Results** | Seven tabs — Overview, Insights, Metrics, Report, DAX, Dashboard, Data quality. Each section loads in parallel; one failing section never blanks the others. |
| **DAX** | Grouped library (Base, Sales, Customer, Product, Inventory, Time Intelligence, Growth, Advanced) with search, per-measure copy, copy-all, `.dax` export and validation status. |
| **Dashboard PNG** | The full-resolution image with pinch zoom, drag pan, double-tap zoom and save-to-gallery. The exact bytes the backend rendered are written — never re-encoded. |
| **Project Settings** | Rename/describe, dataset and immutable run history, and a delete flow that requires typing the project name and states exactly what will be destroyed. |

## State handling

Every screen renders exactly one of four states:

```kotlin
sealed interface UiState<out T> {
    data object Loading
    data class Success<T>(val data: T, val stale: Boolean = false)
    data class Empty(val title: String, val message: String)
    data class Failure(val error: AppError)
}
```

`stale = true` marks data served from cache while offline, which the Projects screen surfaces with a
banner rather than an error.

## Offline and network behaviour

- The project list is cached in the repository and shown, with an offline banner, when a refresh fails.
- Run polling tolerates up to twenty consecutive failures before surfacing an error, so a lift or a
  tunnel does not abandon a running analysis.
- Access tokens refresh transparently behind a mutex; only a genuinely unusable refresh token clears
  the session.
- Every failure has a specific message that says what happened and what is still safe. Examples:
  *"The upload was interrupted before it completed. No partial file was saved — retry the upload."*,
  *"Your session expired. Sign in again — your projects and analysis runs are saved."*

## Large files

Uploads use a custom `RequestBody` that reads from the content resolver and writes to the socket in
128 KB chunks, reporting progress as it goes. The file is never materialised as a byte array, so a
200 MB CSV uploads with a flat memory profile. Client-side pre-checks (extension, zero bytes, size
limit) exist only to avoid a doomed upload; the backend re-validates everything.

## Accessibility

- Content descriptions on every icon button, status chip, progress bar and score bar
  (*"Analysis 46 percent complete"*, *"Data quality: 92 out of 100"*).
- Pipeline rows announce done / in progress / pending rather than relying on colour.
- Status is always conveyed by text as well as colour.
- Material 3 dynamic type throughout; no hard-coded pixel text sizes outside the type scale.
- Full light and dark palettes, both contrast-checked against the surface colours they sit on.

## Build configuration

Only three values are compiled into the APK, all public:

```
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
ANALYTICS_API_URL
```

They are read from environment variables or a git-ignored `local.defaults.properties`
(see `local.defaults.properties.example`). Cleartext traffic is disabled; backup and device-transfer
rules exclude all preferences and files, so a session token cannot leave the device in a backup.

## Tests

`app/src/test/` runs on the JVM, no emulator required:

- `AppErrorTest` — HTTP status and backend error code mapping; every message is specific and actionable.
- `UtilTest` — file validation (valid CSV/XLSX, empty, wrong extension, no extension, oversized),
  formatting, and the pipeline stage contract (order, monotonic progress, graceful unknown stages).
- `AnalyticsApiTest` — MockWebServer: auth header, request paths and query parameters, tolerant
  decoding of unknown fields, both error-envelope shapes, non-JSON error bodies, fail-fast on a
  missing token or missing configuration.
- `AuthAndDaxTest` — Supabase password grant sends only the publishable key, credential and refresh
  failures map correctly; DAX grouping order, search, group filter, copy-all output, and an assertion
  that no PBIX/PBIT surface exists.

```bash
./gradlew testDebugUnitTest
```
