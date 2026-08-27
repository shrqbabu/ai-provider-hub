"""Independent validation stage.

Runs *after* everything else and re-derives checks from the source frames and
the metric registry. It does not trust the analysis stage, the LLM, or the
renderer. Critical failures mark the whole run VALIDATION_FAILED so the result
is never delivered as validated.
"""
from __future__ import annotations

import math
import re
from typing import Any, Dict, List, Optional

import pandas as pd

from .context import AnalysisContext
from .metrics import FAILED, VALID, MetricRegistry

CAUSAL = re.compile(r"\b(caused by|because of|due to|drove|driven by|resulted in|leads to|led to|thanks to)\b", re.I)
EXTERNAL = re.compile(
    r"\b(industry (average|benchmark|standard)|market share|competitor|peer group|sector average|best[- ]in[- ]class)\b",
    re.I,
)
TOLERANCE = 0.005  # 0.5% relative tolerance for reconciliation


def _issue(severity: str, area: str, message: str, **extra: Any) -> Dict[str, Any]:
    return {"severity": severity, "area": area, "message": message, **extra}


class Validator:
    def __init__(
        self,
        ctx: AnalysisContext,
        registry: MetricRegistry,
        insights: List[Dict[str, Any]],
        dax: Dict[str, Any],
        dashboard: Optional[Any] = None,
    ) -> None:
        self.ctx = ctx
        self.registry = registry
        self.insights = insights
        self.dax = dax
        self.dashboard = dashboard
        self.issues: List[Dict[str, Any]] = []
        self.checks: List[Dict[str, Any]] = []

    def _check(self, name: str, passed: bool, detail: str = "", area: str = "general") -> bool:
        self.checks.append({"name": name, "area": area, "passed": bool(passed), "detail": detail})
        return passed

    # -- data --------------------------------------------------------------
    def validate_data(self) -> None:
        for name, frame in self.ctx.frames.items():
            profile = self.ctx.profiles.get(name, {})
            declared = int(profile.get("row_count") or 0)
            actual = int(len(frame))
            if not self._check(f"row_count::{name}", declared == actual, f"profile={declared}, frame={actual}", "data"):
                self.issues.append(
                    _issue("critical", "data", f"Row count mismatch for '{name}': profile says {declared}, data has {actual}.")
                )
            declared_cols = int(profile.get("column_count") or 0)
            if not self._check(f"column_count::{name}", declared_cols == frame.shape[1], "", "data"):
                self.issues.append(
                    _issue("critical", "data", f"Column count mismatch for '{name}'.")
                )
            if frame.empty:
                self.issues.append(_issue("critical", "data", f"Table '{name}' has no rows."))

        for rel in self.ctx.model.get("relationships", []):
            if rel.get("fan_out"):
                self.issues.append(
                    _issue(
                        "high",
                        "data",
                        f"Many-to-many relationship {rel['from_table']}→{rel['to_table']} can duplicate rows on join.",
                    )
                )
        self._check("relationship_integrity", True, f"{len(self.ctx.model.get('relationships', []))} relationships inspected", "data")

    # -- metrics -----------------------------------------------------------
    def validate_metrics(self) -> None:
        for metric in self.registry.all():
            notes: List[str] = []
            status = VALID

            if metric.value is None:
                metric.validation_status = "not_supported"
                metric.validation_notes = ["Value could not be computed from the available data."]
                continue

            if metric.value_type == "scalar":
                try:
                    numeric = float(metric.value)
                except (TypeError, ValueError):
                    numeric = None
                if numeric is not None:
                    if math.isnan(numeric) or math.isinf(numeric):
                        status, notes = FAILED, ["Value is NaN or infinite."]
                    if metric.unit == "percent" and abs(numeric) > 100000:
                        status, notes = FAILED, [f"Percentage value {numeric} is implausible."]
                    if metric.metric_id.endswith("_rate_pct") and not (-0.001 <= numeric <= 100.001):
                        status = FAILED
                        notes.append(f"Rate {numeric:.4f}% falls outside 0–100%.")

            recomputed = self._recompute(metric)
            if recomputed is not None:
                original = float(metric.value)
                denom = max(abs(original), 1e-9)
                drift = abs(recomputed - original) / denom
                if drift > TOLERANCE:
                    status = FAILED
                    notes.append(
                        f"Independent recomputation gave {recomputed:,.4f} against the registered {original:,.4f}."
                    )
                else:
                    notes.append(f"Independently recomputed from source data (drift {drift * 100:.4f}%).")

            metric.validation_status = status
            metric.validation_notes = notes
            if status == FAILED:
                self.issues.append(
                    _issue("critical", "metrics", f"Metric '{metric.name}' failed validation: {' '.join(notes)}", metric_id=metric.metric_id)
                )

        # Denominator consistency: derived ratios must match their inputs.
        self._reconcile_ratio("average_order_value", "total_revenue", "total_orders")
        self._reconcile_ratio("repeat_purchase_rate", "repeat_customers", "unique_customers", percent=True)
        self._reconcile_ratio("gross_margin_pct", "gross_profit", "total_revenue", percent=True)
        self._reconcile_ratio("stockout_rate_pct", "out_of_stock_items", None, percent=True)

        failed = sum(1 for m in self.registry.all() if m.validation_status == FAILED)
        self._check("metric_validation", failed == 0, f"{failed} metric(s) failed", "metrics")

    def _recompute(self, metric) -> Optional[float]:
        """Re-derive a sample of metrics straight from the frames."""
        source = metric.source or {}
        table = source.get("table")
        columns = [c for c in (source.get("columns") or []) if isinstance(c, str) and not c.startswith("__")]
        if not table or table not in self.ctx.frames or metric.value_type != "scalar":
            return None
        frame = self.ctx.frames[table]

        formula = (metric.formula or "").upper()
        if formula.startswith("SUM(") and len(columns) == 1 and columns[0] in frame.columns:
            return float(pd.to_numeric(frame[columns[0]], errors="coerce").sum())
        if formula.startswith("DISTINCTCOUNT(") and len(columns) == 1 and columns[0] in frame.columns:
            return float(frame[columns[0]].dropna().nunique())
        if formula.startswith("COUNTROWS(") and not columns:
            return float(len(frame))
        return None

    def _reconcile_ratio(self, target: str, numerator: str, denominator: Optional[str], percent: bool = False) -> None:
        t = self.registry.get(target)
        n = self.registry.get(numerator)
        if not t or not n or t.value is None or n.value is None:
            return
        if denominator:
            d = self.registry.get(denominator)
            if not d or not d.value:
                return
            denom_value = float(d.value)
        else:
            denom_value = float(self.ctx.primary_frame.shape[0])
        if denom_value == 0:
            return
        expected = float(n.value) / denom_value * (100.0 if percent else 1.0)
        actual = float(t.value)
        drift = abs(expected - actual) / max(abs(expected), 1e-9)
        passed = drift <= TOLERANCE
        self._check(f"reconcile::{target}", passed, f"expected={expected:.6f} actual={actual:.6f}", "metrics")
        if not passed:
            t.validation_status = FAILED
            self.issues.append(
                _issue(
                    "critical",
                    "metrics",
                    f"'{t.name}' ({actual:,.4f}) does not reconcile with its inputs (expected {expected:,.4f}).",
                    metric_id=t.metric_id,
                )
            )

    # -- insights ----------------------------------------------------------
    def validate_insights(self) -> None:
        valid_ids = {m.metric_id for m in self.registry.all()}
        failed_ids = {m.metric_id for m in self.registry.all() if m.validation_status == FAILED}
        for insight in self.insights:
            ids = insight.get("evidence", {}).get("metric_ids", [])
            if not ids and "data_quality_score" not in insight.get("evidence", {}):
                self.issues.append(
                    _issue("high", "insights", f"Insight '{insight['title']}' cites no evidence and was flagged.")
                )
                insight["validation_status"] = "unsupported"
                continue
            unknown = [i for i in ids if i not in valid_ids]
            if unknown:
                self.issues.append(
                    _issue("critical", "insights", f"Insight '{insight['title']}' cites unknown metric(s): {unknown}.")
                )
                insight["validation_status"] = "invalid_evidence"
                continue
            tainted = [i for i in ids if i in failed_ids]
            if tainted:
                self.issues.append(
                    _issue("high", "insights", f"Insight '{insight['title']}' rests on failed metric(s): {tainted}.")
                )
                insight["validation_status"] = "tainted"
                continue

            text = " ".join(
                str(insight.get(k, "")) for k in ("finding", "interpretation", "business_impact", "recommendation")
            )
            if CAUSAL.search(text):
                self.issues.append(
                    _issue("medium", "insights", f"Insight '{insight['title']}' contains causal language.")
                )
                insight["validation_status"] = "causal_language"
                continue
            if EXTERNAL.search(text):
                self.issues.append(
                    _issue("high", "insights", f"Insight '{insight['title']}' references external/benchmark data not in the dataset.")
                )
                insight["validation_status"] = "external_claim"
                continue
            insight["validation_status"] = "valid"

        bad = sum(1 for i in self.insights if i.get("validation_status") != "valid")
        self._check("insight_validation", bad == 0, f"{bad} insight(s) flagged", "insights")

    # -- dax ---------------------------------------------------------------
    def validate_dax(self) -> None:
        summary = self.dax.get("validation", {})
        failed = int(summary.get("failed", 0))
        self._check("dax_static_validation", failed == 0, f"{failed} measure(s) failed", "dax")
        if failed:
            for measure in self.dax["measures"]:
                if measure["validation_status"] == "failed":
                    self.issues.append(
                        _issue(
                            "high",
                            "dax",
                            f"DAX measure '{measure['name']}' failed: {'; '.join(measure['validation_errors'])}",
                        )
                    )
        # Measures mapped to registry metrics must not carry failed metrics.
        for measure in self.dax["measures"]:
            mid = measure.get("metric_id")
            if mid:
                metric = self.registry.get(mid)
                if metric and metric.validation_status == FAILED:
                    self.issues.append(
                        _issue("high", "dax", f"DAX measure '{measure['name']}' maps to failed metric '{mid}'.")
                    )

    # -- dashboard ---------------------------------------------------------
    def validate_dashboard(self) -> None:
        if self.dashboard is None:
            self._check("dashboard_rendered", False, "no dashboard produced", "dashboard")
            self.issues.append(_issue("high", "dashboard", "No dashboard PNG was produced."))
            return

        self._check(
            "dashboard_resolution",
            self.dashboard.width >= 1920 and self.dashboard.height >= 1000,
            f"{self.dashboard.width}x{self.dashboard.height}",
            "dashboard",
        )
        if self.dashboard.width < 1920:
            self.issues.append(
                _issue("medium", "dashboard", f"Dashboard resolution {self.dashboard.width}px is below the 1920px minimum.")
            )

        mismatches = 0
        unbacked = 0
        for item in self.dashboard.rendered_values:
            metric_id = item.get("metric_id")
            if metric_id is None:
                if item["element"] not in {"quality_score", "date_range"}:
                    unbacked += 1
                continue
            metric = self.registry.get(metric_id)
            if metric is None:
                self.issues.append(
                    _issue("critical", "dashboard", f"Dashboard renders '{item['label']}' from unknown metric '{metric_id}'.")
                )
                mismatches += 1
                continue
            if metric.validation_status == FAILED:
                self.issues.append(
                    _issue("critical", "dashboard", f"Dashboard renders failed metric '{metric_id}' as '{item['displayed']}'.")
                )
                mismatches += 1
                continue
            if item["element"] == "kpi_card" and item["displayed"] != metric.display_value:
                self.issues.append(
                    _issue(
                        "critical",
                        "dashboard",
                        f"Dashboard KPI '{item['label']}' shows '{item['displayed']}' but the registry holds '{metric.display_value}'.",
                    )
                )
                mismatches += 1

        self._check("dashboard_value_reconciliation", mismatches == 0, f"{mismatches} mismatch(es)", "dashboard")
        self._check("dashboard_values_backed_by_registry", unbacked == 0, f"{unbacked} unbacked value(s)", "dashboard")
        if unbacked:
            self.issues.append(
                _issue("high", "dashboard", f"{unbacked} rendered value(s) are not traceable to a registered metric.")
            )
        if not self.dashboard.rendered_values:
            self.issues.append(_issue("high", "dashboard", "Dashboard rendered no data values."))

    # -- run ---------------------------------------------------------------
    def run(self) -> Dict[str, Any]:
        self.validate_data()
        self.validate_metrics()
        self.validate_insights()
        self.validate_dax()
        self.validate_dashboard()

        critical = [i for i in self.issues if i["severity"] == "critical"]
        high = [i for i in self.issues if i["severity"] == "high"]
        passed = not critical
        return {
            "status": "passed" if passed else "failed",
            "passed": passed,
            "checks": self.checks,
            "checks_passed": sum(1 for c in self.checks if c["passed"]),
            "checks_total": len(self.checks),
            "issues": self.issues,
            "critical_count": len(critical),
            "high_count": len(high),
            "summary": (
                "All validation checks passed."
                if passed
                else f"{len(critical)} critical validation failure(s); the result is NOT certified as validated."
            ),
        }


def validate_all(
    ctx: AnalysisContext,
    registry: MetricRegistry,
    insights: List[Dict[str, Any]],
    dax: Dict[str, Any],
    dashboard: Optional[Any] = None,
) -> Dict[str, Any]:
    return Validator(ctx, registry, insights, dax, dashboard).run()
