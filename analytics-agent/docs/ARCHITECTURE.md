# Architecture

## Components

```
┌──────────────────────────┐
│  Android app (Kotlin)    │  Compose · Material 3 · ViewModel + StateFlow
│  UI → ViewModel →        │  Holds: publishable key + the admin's access token
│  Repository → network    │  Holds no service-role key, DB credential or AI key
└────────────┬─────────────┘
             │ HTTPS, Bearer <supabase access token>
   ┌─────────┴──────────┐                     ┌────────────────────────────┐
   │ Supabase           │                     │ Analytics service (FastAPI)│
   │  Auth (password)   │◄── verifies JWT ────│  deterministic engine       │
   │  Postgres + RLS    │◄── owner-scoped ────│  skills · DAX · renderer    │
   │  Private Storage   │◄── signed URLs ─────│  independent validator      │
   └────────────────────┘                     └─────────────┬───────────────┘
                                                            │ optional, narrative only
                                                  ┌─────────┴──────────┐
                                                  │ LLM provider       │
                                                  │ OpenAI-compatible  │
                                                  │ or Gemini AI Studio│
                                                  │ or deterministic   │
                                                  └────────────────────┘
```

The Android app is a client of the analytics service and of Supabase Auth, nothing more. It never
parses a spreadsheet, never computes a metric, never renders a chart and never talks to a model
provider.

## Layering inside the app

```
Composable screen  →  ViewModel (StateFlow<UiState<T>>)  →  AnalyticsRepository
                                                              ├─ SupabaseAuth   (sign in / refresh)
                                                              ├─ AnalyticsApi   (OkHttp + kotlinx.serialization)
                                                              └─ SessionStore   (EncryptedSharedPreferences)
```

Screens are pure functions of state and callbacks; every ViewModel exposes exactly one state flow.
That makes the screens previewable and the logic unit-testable without an emulator.

## The analysis pipeline

Sixteen stages, executed server-side as an asynchronous job. The app polls run state and shows the
stage label, description and cumulative percentage.

| Stage | % | Purpose |
| --- | --- | --- |
| `VALIDATING_INPUT` | 5 | Dataset present, prompt usable, row/size limits respected |
| `PROFILING` | 12 | Types, ranges, cardinality, semantic roles per column |
| `DATA_QUALITY` | 20 | Completeness, validity, consistency, uniqueness, relationships |
| `SCHEMA_MODELING` | 27 | Keys, relationships, date table, grain |
| `ANALYSIS_PLANNING` | 34 | Map the prompt onto skills the data can actually support |
| `DETERMINISTIC_CALCULATIONS` | 46 | Every arithmetic result, once, into the metric registry |
| `BUSINESS_ANALYSIS` | 56 | Sales / customer / product / inventory skills |
| `STATISTICS` | 63 | Distributions, correlations, outliers, significance |
| `FORECASTING` | 70 | Holt-Winters where ≥ 6 periods of history exist |
| `INSIGHT_GENERATION` | 78 | Findings, each bound to registry metric ids |
| `DAX_GENERATION` | 84 | Measures, calculated columns, date-table DAX |
| `DAX_VALIDATION` | 88 | Syntax plus every table/column/measure reference |
| `REPORT_GENERATION` | 92 | Only the sections the admin asked for |
| `DASHBOARD_PNG_GENERATION` | 96 | High-resolution image from validated values |
| `FINAL_VALIDATION` | 99 | Independent re-derivation and reconciliation |
| `COMPLETED` | 100 | Delivered |

Terminal states: `completed`, `validation_failed`, `failed`, `cancelled`.

## The metric registry

The registry is the single source of truth. A metric entry carries:

```
metric_id · name · definition · formula · value (typed + display string) · source · validation_status
```

The report, the DAX generator and the dashboard renderer all read from the registry. None of them
recomputes anything. This is why the headline number in the report, the measure in the DAX file and
the value printed on the PNG are always identical — there is only one place a number can come from.

## Deterministic engine vs. the LLM

| Concern | Owner |
| --- | --- |
| Every sum, average, growth rate, correlation, forecast | Deterministic engine (Pandas/NumPy/SciPy/statsmodels/scikit-learn) |
| Choice of which analyses the data supports | Deterministic planner, optionally advised by the LLM |
| Wording of narrative sections and insight prose | LLM, constrained; deterministic fallback always available |
| Any numeric value appearing anywhere | Deterministic engine, always |

The LLM is a writer, never a calculator. Its output is filtered:

- An insight is dropped unless it cites metric ids that exist in the registry.
- Generated DAX is rejected if it references a table, column or measure that does not exist.
- Narrative is limited to the requested sections and must reuse the registry's display strings verbatim.

Provider selection resolves in order: explicit `LLM_PROVIDER` → OpenAI key present → Gemini key
present → `deterministic`. With no keys configured the whole system still runs end to end.

## Anti-hallucination rules

- Column roles are resolved only from columns that exist; nothing is assumed from a name alone.
- Churn, turnover, margin and forecast requests degrade to `NOT_SUPPORTED` when the supporting fields
  are absent, with an explanation and an alternative.
- Correlation is always described as association, never causation.
- Forecasting requires at least six periods of history.
- No external benchmark, industry average or market claim is ever introduced.

## Independent validation

The validator is a separate stage that does not trust any earlier stage. It:

1. Re-derives metrics from the source frames and compares within a 0.5 % tolerance.
2. Checks each insight's evidence against the registry, flagging `causal_language`, `external_claim`
   or `invalid_evidence`.
3. Re-parses every DAX measure against the modelled schema.
4. Reads the values rendered onto the PNG and reconciles each against the registry.

Output: `{status, passed, checks[], checks_passed, checks_total, issues[{severity, area, message}],
critical_count, high_count, summary}`. Any critical failure ends the run as `VALIDATION_FAILED`.

## Storage and immutability

Four private buckets — `project-inputs`, `project-artifacts`, `dashboard-images`, `reports` — with
paths namespaced `owner_id/project_id/...` and access only through short-lived signed URLs.

Analysis runs are immutable. Re-running produces a new run; the prompt that produced each historical
result stays attached to it. Deleting a project cascades both the database rows and every stored
object.
