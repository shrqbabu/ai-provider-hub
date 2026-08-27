"""Report assembly.

Section structure comes from the user's prompt (via the plan). Numbers are
injected from the metric registry only — the narrative layer may describe a
value but never produce one.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from ..llm.client import LlmClient
from .context import AnalysisContext
from .metrics import MetricRegistry, format_value

NARRATIVE_SYSTEM = """You write the narrative of an enterprise analytics report.

You receive: the admin's report prompt, the required section list, computed metrics, validated insights and data-quality results.

Return JSON only: {"sections": [{"title": "<exactly one of the requested titles>", "body": "markdown body"}]}

Hard rules:
- Produce one entry for EVERY requested section title, in the given order, using the exact titles.
- Quote numbers exactly as they appear in the metric "display" field. Never compute, re-round or estimate a number.
- Never mention a metric, table or column that is not supplied to you.
- Never state causation, benchmarks, market share, competitors or any external fact.
- Where the admin asked for something listed under unsupported_requests, say plainly that it is NOT SUPPORTED and state the reason and the alternative offered.
- Keep each section tight: 80-220 words. Use markdown bullets where it aids scanning.
- Write for an executive reader: direct, specific, no filler."""


def build(
    ctx: AnalysisContext,
    registry: MetricRegistry,
    insights: List[Dict[str, Any]],
    dax: Dict[str, Any],
    llm: Optional[LlmClient] = None,
) -> Dict[str, Any]:
    sections_wanted: List[str] = ctx.plan.get("sections") or ["Executive Summary", "Key Findings", "KPIs"]
    bodies = _deterministic_sections(ctx, registry, insights, dax, sections_wanted)

    if llm and llm.available:
        payload = {
            "report_prompt": ctx.prompt,
            "requested_sections": sections_wanted,
            "metrics": registry.to_context(),
            "series": [
                {"metric_id": m.metric_id, "name": m.name, "points": m.value[:18]}
                for m in registry.all()
                if m.value_type == "series" and isinstance(m.value, list)
            ],
            "insights": [
                {
                    "title": i["title"],
                    "finding": i["finding"],
                    "recommendation": i["recommendation"],
                    "priority": i["priority"],
                    "evidence_metric_ids": i["evidence"].get("metric_ids", []),
                }
                for i in insights
            ],
            "data_quality": {
                "score": ctx.quality.get("score"),
                "grade": ctx.quality.get("grade"),
                "issues": [i["message"] for i in ctx.quality.get("issues", [])[:10]],
            },
            "unsupported_requests": ctx.plan.get("unsupported_requests", []),
            "methodology": _methodology_facts(ctx, registry, dax),
        }
        result = llm.complete_json(NARRATIVE_SYSTEM, json.dumps(payload, default=str)[:90000], fallback=None)
        if isinstance(result, dict) and isinstance(result.get("sections"), list):
            produced = {
                str(s.get("title", "")).strip(): str(s.get("body", "")).strip()
                for s in result["sections"]
                if isinstance(s, dict) and str(s.get("body", "")).strip()
            }
            for title in sections_wanted:
                if title in produced:
                    bodies[title] = produced[title]

    ordered = [{"title": t, "body": bodies.get(t, "")} for t in sections_wanted if bodies.get(t)]
    markdown = _to_markdown(ctx, ordered)
    return {
        "sections": ordered,
        "markdown": markdown,
        "generator": "llm" if (llm and llm.available) else "deterministic",
        "prompt": ctx.prompt,
    }


def _to_markdown(ctx: AnalysisContext, sections: List[Dict[str, str]]) -> str:
    lines = ["# Analysis Report", ""]
    lines.append(f"> **Report prompt:** {ctx.prompt.strip()}")
    lines.append("")
    for section in sections:
        lines.append(f"## {section['title']}")
        lines.append("")
        lines.append(section["body"].strip())
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def _kpi_lines(registry: MetricRegistry, limit: int = 10) -> List[str]:
    return [
        f"- **{m.name}**: {m.display_value} — {m.definition}"
        for m in registry.scalars()[:limit]
    ]


def _methodology_facts(ctx: AnalysisContext, registry: MetricRegistry, dax: Dict[str, Any]) -> Dict[str, Any]:
    forecast = registry.get("forecast_series")
    return {
        "tables_analysed": [
            {"table": name, "rows": prof.get("row_count"), "columns": prof.get("column_count")}
            for name, prof in ctx.profiles.items()
        ],
        "skills_applied": [s["title"] for s in ctx.plan.get("skills", {}).get("selected", [])],
        "skills_not_applied": [
            {"skill": s["title"], "reason": s.get("reason")}
            for s in ctx.plan.get("skills", {}).get("rejected", [])
        ],
        "computation": "pandas / numpy / scipy / statsmodels deterministic computation; no model-generated arithmetic",
        "forecast_method": forecast.source.get("method") if forecast else None,
        "metric_count": len(registry),
        "dax_measures": dax.get("validation", {}).get("total"),
        "relationships": ctx.model.get("relationships", []),
    }


def _deterministic_sections(
    ctx: AnalysisContext,
    registry: MetricRegistry,
    insights: List[Dict[str, Any]],
    dax: Dict[str, Any],
    wanted: List[str],
) -> Dict[str, str]:
    quality = ctx.quality
    unsupported = ctx.plan.get("unsupported_requests", [])
    headline = registry.headline(5)
    bodies: Dict[str, str] = {}

    exec_bits: List[str] = []
    if headline:
        exec_bits.append(
            "Headline position: " + "; ".join(f"{m.name} {m.display_value}" for m in headline) + "."
        )
    growth = registry.get("revenue_growth_pct")
    if growth and growth.value is not None:
        exec_bits.append(
            f"The latest period moved {growth.display_value} against the prior period."
        )
    if quality.get("score") is not None:
        exec_bits.append(
            f"Data quality scored {quality['score']:.0f}/100 ({quality.get('grade', 'n/a')}), "
            f"with {quality.get('high_issue_count', 0)} high-severity issue(s)."
        )
    if insights:
        exec_bits.append(f"{len(insights)} validated findings are detailed below.")
    bodies["Executive Summary"] = " ".join(exec_bits) or "Analysis completed; see the sections below."

    if insights:
        bodies["Key Findings"] = "\n".join(
            f"**{i['title']}** ({i['priority']} priority)\n\n{i['finding']}\n" for i in insights[:6]
        )
    bodies["KPIs"] = "\n".join(_kpi_lines(registry)) or "No scalar KPIs could be computed from this dataset."

    analysis_bits: List[str] = []
    for skill in ctx.plan.get("skills", {}).get("selected", []):
        metrics = registry.by_skill(skill["key"])
        scalars = [m for m in metrics if m.value_type == "scalar" and m.value is not None]
        if not scalars:
            continue
        analysis_bits.append(
            f"**{skill['title']}** — " + ", ".join(f"{m.name} {m.display_value}" for m in scalars[:6]) + "."
        )
    bodies["Analysis"] = "\n\n".join(analysis_bits) or "No skill produced computable results for this dataset."

    risks = [i for i in insights if i["priority"] in {"critical", "high"}]
    bodies["Risks"] = (
        "\n".join(f"- **{i['title']}**: {i['business_impact']}" for i in risks)
        or "No high-severity risks were identified from the available data."
    )
    opportunities = [i for i in insights if i["priority"] in {"medium", "low"}]
    bodies["Opportunities"] = (
        "\n".join(f"- **{i['title']}**: {i['recommendation']}" for i in opportunities)
        or "No additional opportunities were surfaced by the current metric set."
    )
    bodies["Recommendations"] = (
        "\n".join(f"{n}. {i['recommendation']} _(from: {i['title']})_" for n, i in enumerate(insights[:8], 1))
        or "No recommendations: the dataset did not support actionable findings."
    )

    dq_lines = [
        f"Overall score: **{quality.get('score', 0):.0f}/100** ({quality.get('grade', 'n/a')}).",
        "",
        f"- Completeness: {quality.get('completeness', {}).get('score', 0):.0f}",
        f"- Validity: {quality.get('validity', {}).get('score', 0):.0f}",
        f"- Consistency: {quality.get('consistency', {}).get('score', 0):.0f}",
        f"- Uniqueness: {quality.get('uniqueness', {}).get('score', 0):.0f}",
        f"- Relationships: {quality.get('relationships', {}).get('score', 0):.0f}",
    ]
    issues = quality.get("issues", [])[:8]
    if issues:
        dq_lines += ["", "**Issues detected:**"] + [f"- [{i['severity']}] {i['message']}" for i in issues]
    bodies["Data Quality"] = "\n".join(dq_lines)

    facts = _methodology_facts(ctx, registry, dax)
    meth = [
        "All numbers in this report are computed deterministically with pandas/numpy/scipy/statsmodels. "
        "No value in this report was produced by a language model.",
        "",
        "**Data analysed:**",
    ]
    meth += [f"- {t['table']}: {t['rows']:,} rows × {t['columns']} columns" for t in facts["tables_analysed"]]
    meth += ["", "**Skills applied:** " + (", ".join(facts["skills_applied"]) or "none")]
    if facts.get("forecast_method"):
        meth.append(f"**Forecast method:** {facts['forecast_method']}")
    meth.append(f"**Metric registry:** {facts['metric_count']} registered metrics feeding report, DAX and dashboard.")
    if facts.get("dax_measures"):
        meth.append(f"**DAX measures generated:** {facts['dax_measures']}, statically validated against the real schema.")
    bodies["Methodology"] = "\n".join(meth)

    lim = [
        "- Findings describe only the uploaded data and the period it covers. No external, market or competitor data was used.",
        "- Correlations indicate association, not causation.",
    ]
    for skill in ctx.plan.get("skills", {}).get("rejected", []):
        if skill.get("reason"):
            lim.append(f"- {skill['title']} was not run: {skill['reason']}")
    for item in unsupported:
        lim.append(f"- **NOT SUPPORTED — {item['requested']}**: {item['reason']} Alternative: {item['alternative']}")
    bodies["Limitations"] = "\n".join(lim)

    # Any custom section the prompt asked for that has no deterministic body.
    for title in wanted:
        if title in bodies:
            continue
        bodies[title] = _custom_section_body(title, ctx, registry, insights)
    return bodies


# Section title keywords -> metric ids that answer them.
SECTION_METRIC_HINTS: Dict[str, List[str]] = {
    "segment": ["revenue_by_category", "revenue_by_region", "revenue_by_channel", "category_performance",
                "customer_segments_rfm"],
    "breakdown": ["revenue_by_category", "revenue_by_region", "revenue_by_channel"],
    "region": ["revenue_by_region"],
    "geograph": ["revenue_by_region"],
    "channel": ["revenue_by_channel"],
    "categor": ["revenue_by_category", "category_performance"],
    "trend": ["revenue_trend", "revenue_growth_pct", "revenue_yoy_pct", "trend_slope"],
    "growth": ["revenue_growth_pct", "revenue_yoy_pct"],
    "compar": ["revenue_growth_pct", "revenue_yoy_pct", "revenue_latest_period"],
    "forecast": ["forecast_series", "forecast_total", "forecast_vs_recent_pct"],
    "outlook": ["forecast_total", "forecast_vs_recent_pct"],
    "retention": ["repeat_purchase_rate", "repeat_customers", "inactivity_rate_pct", "avg_recency_days",
                  "avg_orders_per_customer"],
    "churn": ["inactivity_rate_pct", "inactive_customers"],
    "loyalt": ["repeat_purchase_rate", "customer_segments_rfm"],
    "cohort": ["customer_segments_rfm", "avg_recency_days"],
    "customer": ["unique_customers", "revenue_per_customer", "top_customers", "repeat_purchase_rate"],
    "product": ["top_products", "bottom_products", "distinct_products", "product_concentration_pct"],
    "inventory": ["total_stock_on_hand", "stockout_rate_pct", "days_of_cover", "lowest_stock_items"],
    "stock": ["total_stock_on_hand", "stockout_rate_pct", "lowest_stock_items"],
    "margin": ["gross_margin_pct", "gross_profit", "product_margin_pct"],
    "profit": ["gross_profit", "gross_margin_pct", "total_cost"],
    "price": ["average_selling_price", "average_order_value"],
    "concentration": ["customer_revenue_concentration_pct", "product_concentration_pct", "top_product_share_pct"],
    "correlat": ["correlations"],
    "distribution": ["numeric_distributions", "highest_cv_pct"],
    "kpi": [],
}


def _custom_section_body(
    title: str, ctx: AnalysisContext, registry: MetricRegistry, insights: List[Dict[str, Any]]
) -> str:
    lowered = title.lower()

    hinted: List[Any] = []
    for keyword, metric_ids in SECTION_METRIC_HINTS.items():
        if keyword in lowered:
            for metric_id in metric_ids:
                metric = registry.get(metric_id)
                if metric is not None and metric not in hinted:
                    hinted.append(metric)
    if hinted:
        lines: List[str] = []
        for metric in hinted[:6]:
            if metric.value_type == "scalar":
                lines.append(f"- **{metric.name}**: {metric.display_value} — {metric.definition}")
            elif isinstance(metric.value, list) and metric.value:
                top = metric.value[:5]
                rendered = ", ".join(
                    f"{p.get('label', p.get('period', '?'))} {format_value(p.get('value'), metric.unit)}"
                    for p in top
                    if isinstance(p, dict)
                )
                lines.append(f"- **{metric.name}**: {rendered}")
        if lines:
            return "\n".join(lines)

    relevant = [
        m for m in registry.all()
        if any(tok in m.name.lower() or tok in m.definition.lower() for tok in lowered.split() if len(tok) > 3)
    ]
    if relevant:
        return "\n".join(
            f"- **{m.name}**: {m.display_value} — {m.definition}" for m in relevant[:8]
        )
    related_insights = [i for i in insights if any(tok in i["title"].lower() for tok in lowered.split() if len(tok) > 3)]
    if related_insights:
        return "\n".join(f"- **{i['title']}**: {i['finding']}" for i in related_insights)
    return (
        f"_The uploaded dataset does not contain the fields required to report on '{title}'. "
        "No values are shown here rather than presenting unsupported figures._"
    )
