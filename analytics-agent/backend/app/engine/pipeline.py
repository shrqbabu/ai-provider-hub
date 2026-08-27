"""Analysis pipeline orchestrator.

Executes the fixed stage sequence, reporting progress after every stage so the
Android client can render a live progress bar. Any stage failure is captured
with a specific, actionable message — never "something went wrong".
"""
from __future__ import annotations

import logging
import time
import traceback
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

import pandas as pd

from ..llm.client import LlmClient
from . import dax as dax_engine
from . import insights as insight_engine
from . import modeling, planning, quality, report as report_engine
from .context import AnalysisContext, build_context
from .dashboard import render_dashboard
from .ingest import profile_table
from .metrics import MetricRegistry
from .skills import SKILLS_BY_KEY
from .validator import validate_all

log = logging.getLogger(__name__)

# stage key -> (label, cumulative progress on completion, coarse stage bucket)
STAGES: List[tuple] = [
    ("VALIDATING_INPUT", "Validating input", 5, "profiling"),
    ("PROFILING", "Profiling dataset", 12, "profiling"),
    ("DATA_QUALITY", "Assessing data quality", 20, "quality"),
    ("SCHEMA_MODELING", "Modelling schema and relationships", 27, "modeling"),
    ("ANALYSIS_PLANNING", "Planning the analysis from your prompt", 34, "modeling"),
    ("DETERMINISTIC_CALCULATIONS", "Computing metrics", 46, "analysis"),
    ("BUSINESS_ANALYSIS", "Running business analysis skills", 56, "analysis"),
    ("STATISTICS", "Running statistical analysis", 63, "statistics"),
    ("FORECASTING", "Forecasting", 70, "forecast"),
    ("INSIGHT_GENERATION", "Generating insights", 78, "insights"),
    ("DAX_GENERATION", "Generating DAX measures", 84, "dax"),
    ("DAX_VALIDATION", "Validating DAX measures", 88, "dax"),
    ("REPORT_GENERATION", "Writing the report", 92, "insights"),
    ("DASHBOARD_PNG_GENERATION", "Rendering dashboard PNG", 96, "dashboard"),
    ("FINAL_VALIDATION", "Final validation", 99, "validation"),
    ("COMPLETED", "Completed", 100, "validation"),
]

STAGE_INDEX = {s[0]: i for i, s in enumerate(STAGES)}

ProgressFn = Callable[[str, str, int, str], None]


class PipelineError(RuntimeError):
    def __init__(self, stage: str, message: str, *, recoverable: bool = True, detail: str = "") -> None:
        super().__init__(message)
        self.stage = stage
        self.message = message
        self.recoverable = recoverable
        self.detail = detail

    def as_dict(self) -> Dict[str, Any]:
        return {
            "stage": self.stage,
            "message": self.message,
            "recoverable": self.recoverable,
            "detail": self.detail[:2000],
        }


@dataclass
class PipelineResult:
    status: str
    stage: str
    registry: MetricRegistry
    context: AnalysisContext
    plan: Dict[str, Any] = field(default_factory=dict)
    quality: Dict[str, Any] = field(default_factory=dict)
    insights: List[Dict[str, Any]] = field(default_factory=list)
    dax: Dict[str, Any] = field(default_factory=dict)
    report: Dict[str, Any] = field(default_factory=dict)
    dashboard: Any = None
    validation: Dict[str, Any] = field(default_factory=dict)
    stage_timings: List[Dict[str, Any]] = field(default_factory=list)
    llm_usage: Dict[str, Any] = field(default_factory=dict)
    skill_outputs: Dict[str, Any] = field(default_factory=dict)
    error: Optional[Dict[str, Any]] = None


def run_pipeline(
    *,
    prompt: str,
    frames: Dict[str, pd.DataFrame],
    profiles: Optional[Dict[str, Dict[str, Any]]] = None,
    dashboard_title: str = "Analytics Dashboard",
    dashboard_subtitle: str = "",
    llm: Optional[LlmClient] = None,
    progress: Optional[ProgressFn] = None,
    cancelled: Optional[Callable[[], bool]] = None,
) -> PipelineResult:
    llm = llm or LlmClient()
    timings: List[Dict[str, Any]] = []
    registry = MetricRegistry()
    ctx: Optional[AnalysisContext] = None
    current = "VALIDATING_INPUT"

    def emit(stage_key: str) -> None:
        label, pct, bucket = next((s[1], s[2], s[3]) for s in STAGES if s[0] == stage_key)
        if progress:
            progress(stage_key, label, pct, bucket)

    def timed(stage_key: str, fn: Callable[[], Any]) -> Any:
        nonlocal current
        current = stage_key
        if cancelled and cancelled():
            raise PipelineError(stage_key, "Analysis was cancelled.", recoverable=True)
        started = time.time()
        try:
            value = fn()
        except PipelineError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise PipelineError(
                stage_key,
                _stage_error_message(stage_key, exc),
                detail=traceback.format_exc(limit=6),
            ) from exc
        duration = int((time.time() - started) * 1000)
        timings.append({"stage": stage_key, "duration_ms": duration})
        emit(stage_key)
        return value

    try:
        # 1. VALIDATING_INPUT
        def _validate_input():
            if not frames:
                raise PipelineError("VALIDATING_INPUT", "No dataset tables were available to analyse.", recoverable=False)
            empty = [name for name, f in frames.items() if f is None or f.empty]
            if len(empty) == len(frames):
                raise PipelineError(
                    "VALIDATING_INPUT",
                    "Every table in the dataset is empty. Re-upload a file that contains data rows.",
                    recoverable=False,
                )
            if not (prompt or "").strip():
                raise PipelineError(
                    "VALIDATING_INPUT",
                    "A report prompt is required — it defines what the analysis must produce.",
                    recoverable=False,
                )
            return {name: f for name, f in frames.items() if f is not None and not f.empty}

        working_frames = timed("VALIDATING_INPUT", _validate_input)

        # 2. PROFILING
        def _profile():
            if profiles:
                return dict(profiles)
            from .ingest import TableData

            out: Dict[str, Dict[str, Any]] = {}
            for name, frame in working_frames.items():
                table = TableData(name=name, frame=frame)
                out[name] = profile_table(table)
                working_frames[name] = table.frame  # date coercion applied
            return out

        table_profiles = timed("PROFILING", _profile)

        # 3. SCHEMA_MODELING happens before quality so relationships can be scored
        model = modeling.build_model(working_frames, table_profiles)

        # 4. DATA_QUALITY
        quality_result = timed(
            "DATA_QUALITY",
            lambda: quality.assess(working_frames, table_profiles, model.get("relationships", [])),
        )

        timed("SCHEMA_MODELING", lambda: model)

        ctx = build_context(prompt, working_frames, table_profiles, model, quality_result)

        # 5. ANALYSIS_PLANNING
        plan = timed("ANALYSIS_PLANNING", lambda: planning.build_plan(ctx, llm))

        # 6-9. Skills
        skill_outputs: Dict[str, Any] = {}
        selected = [s["key"] for s in plan["skills"]["selected"]]

        def _run_skills(keys: List[str]) -> Dict[str, Any]:
            out: Dict[str, Any] = {}
            for key in keys:
                skill = SKILLS_BY_KEY.get(key)
                if not skill:
                    continue
                started = time.time()
                try:
                    out[key] = skill.run(ctx, registry)
                    out[key] = {**(out[key] or {}), "duration_ms": int((time.time() - started) * 1000)}
                except Exception as exc:  # noqa: BLE001 - one skill must not kill the run
                    log.exception("skill %s failed", key)
                    out[key] = {"error": f"{type(exc).__name__}: {exc}"[:400], "status": "failed"}
                    ctx.notes.append(f"Skill '{skill.title}' failed and was skipped: {exc}")
            return out

        core_keys = [k for k in selected if k in {"sales", "customer", "product", "inventory"}]
        skill_outputs.update(timed("DETERMINISTIC_CALCULATIONS", lambda: _run_skills(core_keys[:1])))
        skill_outputs.update(timed("BUSINESS_ANALYSIS", lambda: _run_skills(core_keys[1:])))
        skill_outputs.update(timed("STATISTICS", lambda: _run_skills([k for k in selected if k == "statistics"])))
        skill_outputs.update(timed("FORECASTING", lambda: _run_skills([k for k in selected if k == "forecasting"])))

        for item in plan.get("unsupported_requests", []):
            registry.mark_unsupported(item["requested"], item["reason"], item.get("alternative", ""))

        # 10. INSIGHTS
        generated_insights = timed("INSIGHT_GENERATION", lambda: insight_engine.generate(ctx, registry, llm))

        # 11-12. DAX
        dax_bundle = timed("DAX_GENERATION", lambda: dax_engine.generate(ctx, registry, llm))
        dax_bundle = timed("DAX_VALIDATION", lambda: dax_engine.validate(ctx, dax_bundle))

        # 13. REPORT
        report = timed(
            "REPORT_GENERATION",
            lambda: report_engine.build(ctx, registry, generated_insights, dax_bundle, llm),
        )

        # 14. DASHBOARD
        dashboard = timed(
            "DASHBOARD_PNG_GENERATION",
            lambda: render_dashboard(
                ctx, registry, generated_insights, title=dashboard_title, subtitle=dashboard_subtitle
            ),
        )

        # 15. FINAL VALIDATION
        validation = timed(
            "FINAL_VALIDATION",
            lambda: validate_all(ctx, registry, generated_insights, dax_bundle, dashboard),
        )

        status = "completed" if validation["passed"] else "validation_failed"
        current = "COMPLETED" if validation["passed"] else "FINAL_VALIDATION"
        if validation["passed"]:
            emit("COMPLETED")

        return PipelineResult(
            status=status,
            stage=current,
            registry=registry,
            context=ctx,
            plan=plan,
            quality=quality_result,
            insights=generated_insights,
            dax=dax_bundle,
            report=report,
            dashboard=dashboard,
            validation=validation,
            stage_timings=timings,
            llm_usage=llm.usage.as_dict(),
            skill_outputs=skill_outputs,
        )

    except PipelineError as exc:
        log.warning("pipeline failed at %s: %s", exc.stage, exc.message)
        return PipelineResult(
            status="failed",
            stage=exc.stage,
            registry=registry,
            context=ctx if ctx else build_context(prompt, frames, profiles or {}, {}, {}),
            stage_timings=timings,
            llm_usage=llm.usage.as_dict(),
            error=exc.as_dict(),
        )


def _stage_error_message(stage: str, exc: Exception) -> str:
    """Specific, user-actionable failure messages per stage."""
    base = f"{type(exc).__name__}: {exc}"[:200]
    messages = {
        "PROFILING": (
            "Analysis failed while profiling the dataset. Your uploaded file is saved. "
            f"Check for corrupt rows or mixed column types. ({base})"
        ),
        "DATA_QUALITY": (
            "Analysis failed during the data-quality assessment. Your uploaded data is saved; "
            f"retry the run or re-upload the file. ({base})"
        ),
        "SCHEMA_MODELING": (
            f"Analysis failed while modelling the schema and relationships. Your data is saved. ({base})"
        ),
        "ANALYSIS_PLANNING": (
            "Analysis failed while planning from your report prompt. Your prompt and data are saved — "
            f"edit the prompt and retry. ({base})"
        ),
        "DETERMINISTIC_CALCULATIONS": (
            "Analysis failed during metric computation. Your uploaded data and previous runs are saved. "
            f"({base})"
        ),
        "BUSINESS_ANALYSIS": f"Analysis failed during business analysis. Previous runs are unaffected. ({base})",
        "STATISTICS": f"Analysis failed during statistical analysis. Previous runs are unaffected. ({base})",
        "FORECASTING": f"Analysis failed during forecasting. Previous runs are unaffected. ({base})",
        "INSIGHT_GENERATION": (
            "Analysis failed while generating insights. Metrics were computed successfully — retry to "
            f"regenerate insights only. ({base})"
        ),
        "DAX_GENERATION": f"Analysis failed while generating DAX measures. Your analysis data is saved. ({base})",
        "DAX_VALIDATION": (
            "Analysis failed during DAX validation. Your uploaded data and previous analysis run are saved. "
            f"Retry validation or start a new run. ({base})"
        ),
        "REPORT_GENERATION": f"Analysis failed while assembling the report. Metrics and DAX are saved. ({base})",
        "DASHBOARD_PNG_GENERATION": (
            "Analysis failed while rendering the dashboard PNG. The report, metrics and DAX are saved — "
            f"retry to regenerate the image. ({base})"
        ),
        "FINAL_VALIDATION": f"Analysis failed during final validation. Nothing was delivered as validated. ({base})",
    }
    return messages.get(stage, f"Analysis failed during {stage.lower().replace('_', ' ')}. ({base})")
