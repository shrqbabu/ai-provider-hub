"""Insight generation.

The LLM only ever sees *computed* metric values, never raw records, and every
insight must cite `metric_id`s that exist in the registry. Insights citing
unknown metrics are dropped before they reach the user. A deterministic
generator produces the same shape when no LLM is configured.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

from ..llm.client import LlmClient
from .context import AnalysisContext
from .metrics import MetricRegistry

CAUSAL_PATTERNS = re.compile(
    r"\b(caused by|because of|due to|drove|driven by|resulted in|leads to|led to|as a result of)\b", re.I
)

INSIGHT_SYSTEM = """You are the insight engine of an enterprise analytics agent.

You receive metrics that have ALREADY been computed deterministically. You must not
recompute, restate differently, round differently, or invent any number.

Return JSON only:
{"insights": [{
  "title": "...",
  "finding": "one sentence stating what the data shows, quoting the metric display value verbatim",
  "evidence_metric_ids": ["metric_id", ...],
  "interpretation": "what it means for the business, hedged appropriately",
  "business_impact": "concrete consequence",
  "recommendation": "one specific action",
  "confidence": "high|medium|low",
  "priority": "critical|high|medium|low"
}]}

Hard rules:
- Every insight MUST cite at least one evidence_metric_id from the provided list.
- Never claim causation. Use "is associated with", "coincides with".
- Never reference benchmarks, competitors, industry averages or any external fact.
- Never mention a table or column that is not in the provided schema.
- If the metrics do not support an interesting finding, return fewer insights.
Produce between 4 and 8 insights, ordered by priority."""


def generate(
    ctx: AnalysisContext,
    registry: MetricRegistry,
    llm: Optional[LlmClient] = None,
    limit: int = 8,
) -> List[Dict[str, Any]]:
    deterministic = _deterministic_insights(ctx, registry, limit)
    if not (llm and llm.available):
        return deterministic

    payload = {
        "report_prompt": ctx.prompt,
        "schema": ctx.schema_summary(),
        "metrics": registry.to_context(),
        "series_metrics": [
            {"metric_id": m.metric_id, "name": m.name, "points": m.value[:24] if isinstance(m.value, list) else None}
            for m in registry.all()
            if m.value_type in {"series", "table"}
        ],
        "data_quality": {
            "score": ctx.quality.get("score"),
            "top_issues": [i["message"] for i in ctx.quality.get("issues", [])[:8]],
        },
        "unsupported_requests": ctx.plan.get("unsupported_requests", []),
    }
    result = llm.complete_json(INSIGHT_SYSTEM, json.dumps(payload, default=str)[:80000], fallback=None)
    if not isinstance(result, dict):
        return deterministic

    raw = result.get("insights")
    if not isinstance(raw, list) or not raw:
        return deterministic

    valid_ids = {m.metric_id for m in registry.all()}
    cleaned: List[Dict[str, Any]] = []
    for item in raw[:limit]:
        if not isinstance(item, dict):
            continue
        ids = [str(i) for i in (item.get("evidence_metric_ids") or []) if str(i) in valid_ids]
        if not ids:
            continue  # unsupported claim -> dropped
        finding = str(item.get("finding") or "").strip()
        interpretation = str(item.get("interpretation") or "").strip()
        if not finding:
            continue
        if CAUSAL_PATTERNS.search(finding):
            finding = CAUSAL_PATTERNS.sub("is associated with", finding)
        if CAUSAL_PATTERNS.search(interpretation):
            interpretation = CAUSAL_PATTERNS.sub("is associated with", interpretation)
        cleaned.append(
            {
                "title": str(item.get("title") or "Finding")[:140],
                "finding": finding[:600],
                "evidence": {
                    "metric_ids": ids,
                    "values": [
                        {
                            "metric_id": mid,
                            "name": registry.require(mid).name,
                            "display": registry.require(mid).display_value,
                            "value": registry.require(mid).value if registry.require(mid).value_type == "scalar" else None,
                        }
                        for mid in ids
                    ],
                },
                "interpretation": interpretation[:600],
                "business_impact": str(item.get("business_impact") or "")[:600],
                "recommendation": str(item.get("recommendation") or "")[:600],
                "confidence": _enum(item.get("confidence"), {"high", "medium", "low"}, "medium"),
                "priority": _enum(item.get("priority"), {"critical", "high", "medium", "low"}, "medium"),
                "generator": "llm",
            }
        )

    if not cleaned:
        return deterministic

    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    cleaned.sort(key=lambda i: order.get(i["priority"], 9))
    return cleaned


def _enum(value: Any, allowed: set, default: str) -> str:
    v = str(value or "").strip().lower()
    return v if v in allowed else default


def _evidence(registry: MetricRegistry, *metric_ids: str) -> Dict[str, Any]:
    ids = [m for m in metric_ids if registry.get(m)]
    return {
        "metric_ids": ids,
        "values": [
            {
                "metric_id": mid,
                "name": registry.require(mid).name,
                "display": registry.require(mid).display_value,
                "value": registry.require(mid).value if registry.require(mid).value_type == "scalar" else None,
            }
            for mid in ids
        ],
    }


def _deterministic_insights(ctx: AnalysisContext, registry: MetricRegistry, limit: int) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []

    growth = registry.get("revenue_growth_pct")
    revenue = registry.get("total_revenue")
    if growth and growth.value is not None and revenue:
        direction = "increased" if growth.value >= 0 else "declined"
        priority = "high" if abs(growth.value) >= 10 else "medium"
        out.append(
            {
                "title": f"Revenue {direction} {abs(growth.value):.1f}% period-over-period",
                "finding": (
                    f"Revenue {direction} by {abs(growth.value):.1f}% in the latest period "
                    f"({growth.source.get('periods', ['prior', 'latest'])[-1]}), against a total of {revenue.display_value} "
                    "across the loaded window."
                ),
                "evidence": _evidence(registry, "revenue_growth_pct", "total_revenue", "revenue_latest_period"),
                "interpretation": (
                    "The most recent complete period is moving "
                    + ("ahead of" if growth.value >= 0 else "behind")
                    + " the prior one. This is an observed change in the data, not an explanation of why it happened."
                ),
                "business_impact": (
                    "Sustained at this rate the trajectory materially changes the next-period revenue base."
                ),
                "recommendation": (
                    "Break the change down by category, region and channel before acting, to locate where the movement originates."
                ),
                "confidence": "high",
                "priority": priority,
                "generator": "deterministic",
            }
        )

    conc = registry.get("customer_revenue_concentration_pct") or registry.get("product_concentration_pct")
    if conc and conc.value is not None:
        risky = conc.value >= 70
        out.append(
            {
                "title": ("High revenue concentration" if risky else "Revenue concentration within normal range"),
                "finding": f"{conc.name} is {conc.display_value}.",
                "evidence": _evidence(registry, conc.metric_id),
                "interpretation": (
                    "A small share of contributors accounts for most of the measured value."
                    if risky
                    else "Value is reasonably distributed across contributors."
                ),
                "business_impact": (
                    "Loss of a top contributor would remove a disproportionate share of revenue."
                    if risky
                    else "Dependency risk on any single contributor is limited."
                ),
                "recommendation": (
                    "Put retention cover on the top contributors and build a diversification target."
                    if risky
                    else "Maintain current coverage and monitor the concentration ratio each period."
                ),
                "confidence": "high",
                "priority": "high" if risky else "low",
                "generator": "deterministic",
            }
        )

    repeat = registry.get("repeat_purchase_rate")
    if repeat and repeat.value is not None:
        low = repeat.value < 30
        out.append(
            {
                "title": f"Repeat purchase rate is {repeat.display_value}",
                "finding": f"{repeat.display_value} of customers transacted more than once in the loaded window.",
                "evidence": _evidence(registry, "repeat_purchase_rate", "unique_customers", "repeat_customers"),
                "interpretation": (
                    "Most customers appear only once in this window, so revenue depends on new acquisition."
                    if low
                    else "A meaningful share of customers returns within the window."
                ),
                "business_impact": (
                    "Acquisition-dependent revenue is more expensive and more volatile."
                    if low
                    else "Returning customers provide a more predictable revenue base."
                ),
                "recommendation": (
                    "Test a post-purchase reactivation sequence on first-time buyers and measure repeat rate next period."
                    if low
                    else "Protect the returning cohort and track the rate as a standing KPI."
                ),
                "confidence": "medium",
                "priority": "high" if low else "medium",
                "generator": "deterministic",
            }
        )

    inactivity = registry.get("inactivity_rate_pct")
    if inactivity and inactivity.value is not None:
        out.append(
            {
                "title": f"Customer inactivity proxy at {inactivity.display_value}",
                "finding": f"{inactivity.display_value} of customers have not transacted within the inactivity window.",
                "evidence": _evidence(registry, "inactivity_rate_pct", "inactive_customers", "avg_recency_days"),
                "interpretation": (
                    "This is an inactivity proxy, not contractual churn — the dataset has no cancellation status."
                ),
                "business_impact": "Dormant customers represent recoverable revenue if reactivation works.",
                "recommendation": "Target the dormant segment with a measurable win-back test before writing it off.",
                "confidence": "medium",
                "priority": "medium",
                "generator": "deterministic",
            }
        )

    stockout = registry.get("stockout_rate_pct")
    if stockout and stockout.value is not None:
        out.append(
            {
                "title": f"Stockout rate at {stockout.display_value}",
                "finding": f"{registry.require('out_of_stock_items').display_value} item rows are at or below zero on hand ({stockout.display_value}).",
                "evidence": _evidence(registry, "stockout_rate_pct", "out_of_stock_items", "days_of_cover"),
                "interpretation": "Availability gaps are present in the current inventory snapshot.",
                "business_impact": "Unavailable items cannot convert demand, so the loss is unrecorded in sales data.",
                "recommendation": "Prioritise replenishment on the out-of-stock lines with the strongest historical demand.",
                "confidence": "high",
                "priority": "high" if stockout.value > 5 else "medium",
                "generator": "deterministic",
            }
        )

    forecast = registry.get("forecast_vs_recent_pct")
    if forecast and forecast.value is not None:
        out.append(
            {
                "title": f"Forecast implies {forecast.display_value} versus recent actuals",
                "finding": (
                    f"The projection totals {registry.require('forecast_total').display_value}, "
                    f"a change of {forecast.display_value} against the equivalent recent actual window."
                ),
                "evidence": _evidence(registry, "forecast_vs_recent_pct", "forecast_total"),
                "interpretation": (
                    f"Produced by {registry.require('forecast_series').source.get('method', 'a statistical model')} "
                    "fitted on the observed history only."
                ),
                "business_impact": "Sets the planning baseline for the next periods.",
                "recommendation": "Review the projection against committed pipeline before using it for targets.",
                "confidence": "medium",
                "priority": "medium",
                "generator": "deterministic",
            }
        )

    corr = registry.get("correlations")
    if corr and isinstance(corr.value, list) and corr.value:
        top = corr.value[0]
        if abs(top.get("r", 0)) >= 0.4:
            out.append(
                {
                    "title": f"{top['a']} and {top['b']} move together (r={top['r']:.2f})",
                    "finding": (
                        f"'{top['a']}' and '{top['b']}' show a {top['strength']} correlation of r={top['r']:.2f} "
                        f"across {top['n']:,} complete cases."
                    ),
                    "evidence": _evidence(registry, "correlations"),
                    "interpretation": "Association only — this does not establish that one drives the other.",
                    "business_impact": "The relationship can be used for estimation, not for attribution.",
                    "recommendation": "Validate with a controlled test before treating either variable as a lever.",
                    "confidence": "medium" if top.get("significant_at_05") else "low",
                    "priority": "low",
                    "generator": "deterministic",
                }
            )

    quality_score = ctx.quality.get("score")
    if quality_score is not None and quality_score < 85:
        issues = ctx.quality.get("issues", [])[:3]
        out.append(
            {
                "title": f"Data quality score is {quality_score:.0f}/100",
                "finding": "; ".join(i["message"] for i in issues) or "Data quality issues were detected.",
                "evidence": {"metric_ids": [], "values": [], "data_quality_score": quality_score},
                "interpretation": "Findings above inherit the limitations of the underlying data.",
                "business_impact": "Decisions taken on affected fields carry additional uncertainty.",
                "recommendation": "Remediate the flagged fields at source and re-run the analysis.",
                "confidence": "high",
                "priority": "high" if quality_score < 70 else "medium",
                "generator": "deterministic",
            }
        )

    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    out.sort(key=lambda i: order.get(i["priority"], 9))
    return out[:limit]
