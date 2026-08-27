"""Analysis planning.

Two responsibilities:

1. **Skill selection** — deterministic. A skill runs when the *data supports
   it* and either the prompt asks for it or the detected domain implies it.
2. **Report outline** — driven by the user's prompt. The prompt is the
   authoritative specification; the default outline is used only when the
   prompt does not imply its own structure.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from ..llm.client import LlmClient
from .context import AnalysisContext
from .skills import ALL_SKILLS, SKILLS_BY_KEY

DEFAULT_SECTIONS = [
    "Executive Summary",
    "Key Findings",
    "KPIs",
    "Analysis",
    "Risks",
    "Opportunities",
    "Recommendations",
    "Data Quality",
    "Methodology",
    "Limitations",
]

SECTION_HINTS = [
    (r"executive summary|summary for (the )?(ceo|board|exec)", "Executive Summary"),
    (r"key findings|highlights|what stands out", "Key Findings"),
    (r"kpi|metric|scorecard", "KPIs"),
    (r"trend|over time|monthly|quarterly|seasonal", "Trends"),
    (r"segment|breakdown|by (region|category|channel|product|customer)", "Segmentation"),
    (r"compar|versus|vs\.?|benchmark against|year[- ]over[- ]year|yoy|mom", "Comparisons"),
    (r"forecast|project|next (month|quarter|year)|outlook", "Forecast"),
    (r"risk|threat|concern|exposure", "Risks"),
    (r"opportunit|upside|growth lever", "Opportunities"),
    (r"recommend|action|next steps|what should we do", "Recommendations"),
    (r"retention|churn|cohort|loyalty", "Customer Retention"),
    (r"inventory|stock|reorder", "Inventory Position"),
    (r"margin|profit|cost", "Profitability"),
    (r"data quality|completeness|missing", "Data Quality"),
]

# Report items the agent is commonly asked for but that need specific evidence.
DEMANDING_REQUESTS = [
    (r"\bchurn\b", "customer churn"),
    (r"\bltv\b|lifetime value|\bclv\b", "customer lifetime value"),
    (r"\bcac\b|acquisition cost", "customer acquisition cost"),
    (r"\bnps\b|satisfaction", "customer satisfaction / NPS"),
    (r"market share", "market share"),
    (r"competitor|competitive benchmark", "competitor benchmarking"),
    (r"\broi\b|return on (ad )?spend|\broas\b", "marketing ROI / ROAS"),
    (r"\bebitda\b|operating income", "EBITDA / operating income"),
    (r"forecast|project", "forward forecast"),
]

PLANNER_SYSTEM = """You are the analysis planner for an enterprise data-analytics agent.
You are given: the admin's report prompt, the REAL dataset schema, and the list of skills whose data prerequisites are already satisfied.
Return JSON only:
{"sections": ["..."], "focus_metrics": ["..."], "requested_dimensions": ["..."], "requested_skills": ["..."], "notes": "..."}
Rules:
- "sections" must reflect what the prompt actually asks for, in the order the prompt implies.
- "requested_skills" must be a subset of the supported skill keys given to you.
- "requested_dimensions" must be column names that literally exist in the schema.
- Never invent tables, columns, metrics or business facts."""


def keyword_score(prompt: str, keywords) -> float:
    if not keywords:
        return 0.0
    text = prompt.lower()
    hits = sum(1 for kw in keywords if kw in text)
    return min(1.0, hits / 2.0)


def select_skills(ctx: AnalysisContext) -> Dict[str, Any]:
    """Deterministic skill selection: data support × prompt × domain."""
    prompt = (ctx.prompt or "").lower()
    domains = ctx.model.get("domains", {})
    selected: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []

    for skill in ALL_SKILLS:
        app = skill.applicability(ctx)
        prompt_hit = keyword_score(prompt, skill.keywords)
        domain_hit = max((domains.get(d, 0.0) for d in skill.domains), default=0.0)
        entry = {
            "key": skill.key,
            "title": skill.title,
            "prompt_relevance": round(prompt_hit, 3),
            "domain_relevance": round(domain_hit, 3),
            "data_supported": app.supported,
            "reason": app.reason,
            "alternative": app.alternative,
        }
        if not app.supported:
            rejected.append(entry)
            continue
        # Statistics is always useful when data supports it; others need a signal.
        relevance = max(prompt_hit, domain_hit)
        if skill.key == "statistics":
            relevance = max(relevance, 0.35)
        if skill.key == "sales" and domains.get("sales", 0) > 0:
            relevance = max(relevance, 0.6)
        entry["relevance"] = round(relevance, 3)
        if relevance >= 0.2 or prompt_hit > 0:
            selected.append(entry)
        else:
            entry["reason"] = "Not requested in the prompt and not indicated by the detected business domain."
            rejected.append(entry)

    if not selected:
        # Always produce something defensible when the data supports anything.
        for skill in ALL_SKILLS:
            app = skill.applicability(ctx)
            if app.supported:
                selected.append(
                    {
                        "key": skill.key,
                        "title": skill.title,
                        "relevance": 0.2,
                        "prompt_relevance": 0.0,
                        "domain_relevance": 0.0,
                        "data_supported": True,
                        "reason": "Selected as fallback: prompt gave no strong signal.",
                    }
                )
                break

    selected.sort(key=lambda s: -s["relevance"])
    return {"selected": selected, "rejected": rejected}


def detect_unsupported_requests(ctx: AnalysisContext, supported_keys: List[str]) -> List[Dict[str, str]]:
    """Flag things the prompt asks for that the data cannot deliver."""
    prompt = (ctx.prompt or "").lower()
    cm = ctx.primary_columns
    present = cm.present()
    findings: List[Dict[str, str]] = []

    for pattern, label in DEMANDING_REQUESTS:
        if not re.search(pattern, prompt):
            continue
        if label == "customer churn":
            has_status = bool(cm.status)
            if not has_status:
                findings.append(
                    {
                        "requested": "Customer churn",
                        "reason": "The dataset has no subscription, cancellation or account-status column, so contractual churn cannot be calculated.",
                        "alternative": "Customer inactivity rate (customers with no transaction in the recent window) is reported as a proxy.",
                    }
                )
        elif label == "customer lifetime value":
            if not (cm.customer_id and cm.revenue and cm.date):
                findings.append(
                    {
                        "requested": "Customer lifetime value",
                        "reason": "CLV needs customer id, revenue and transaction dates; at least one is missing.",
                        "alternative": "Observed revenue per customer over the loaded period is reported instead.",
                    }
                )
            else:
                findings.append(
                    {
                        "requested": "Customer lifetime value (projected)",
                        "reason": "Projected CLV requires a retention/margin assumption that is not present in the data.",
                        "alternative": "Observed historical revenue per customer is reported; no projection is fabricated.",
                    }
                )
        elif label == "customer acquisition cost":
            findings.append(
                {
                    "requested": "Customer acquisition cost",
                    "reason": "No marketing spend column exists in the uploaded data.",
                    "alternative": "Upload campaign/marketing spend joined to customers to enable CAC.",
                }
            )
        elif label in {"market share", "competitor benchmarking"}:
            findings.append(
                {
                    "requested": label.title(),
                    "reason": "This requires external market or competitor data, which is not part of the uploaded dataset. The agent will not use assumed industry figures.",
                    "alternative": "Internal share of revenue by category/region is reported instead.",
                }
            )
        elif label == "customer satisfaction / NPS":
            findings.append(
                {
                    "requested": "Customer satisfaction / NPS",
                    "reason": "No survey, rating or NPS column exists in the dataset.",
                    "alternative": "Behavioural proxies (repeat purchase rate, inactivity) are reported instead.",
                }
            )
        elif label in {"marketing ROI / ROAS"}:
            findings.append(
                {
                    "requested": "Marketing ROI / ROAS",
                    "reason": "No marketing spend column is present.",
                    "alternative": "Revenue by channel is reported where a channel column exists.",
                }
            )
        elif label == "EBITDA / operating income":
            if not (cm.cost or cm.profit):
                findings.append(
                    {
                        "requested": "EBITDA / operating income",
                        "reason": "The dataset contains no cost, expense or profit columns.",
                        "alternative": "Revenue-side metrics only.",
                    }
                )
        elif label == "forward forecast" and "forecasting" not in supported_keys:
            reason = next(
                (s.get("reason") for s in ctx.plan.get("skills", {}).get("rejected", []) if s["key"] == "forecasting"),
                "Insufficient time history for a defensible forecast.",
            )
            findings.append(
                {
                    "requested": "Forward forecast",
                    "reason": reason,
                    "alternative": "Historical trend and growth are reported without extrapolation.",
                }
            )
    return findings


def plan_sections(prompt: str) -> List[str]:
    """Derive the report outline from the prompt (deterministic fallback)."""
    text = (prompt or "").strip()
    if not text:
        return list(DEFAULT_SECTIONS)

    explicit = _explicit_sections(text)
    if len(explicit) >= 3:
        return explicit

    sections: List[str] = ["Executive Summary"]
    lowered = text.lower()
    for pattern, section in SECTION_HINTS:
        if re.search(pattern, lowered) and section not in sections:
            sections.append(section)
    for required in ("Key Findings", "KPIs", "Recommendations", "Data Quality", "Methodology", "Limitations"):
        if required not in sections:
            sections.append(required)
    return sections


def _explicit_sections(text: str) -> List[str]:
    """Pick up numbered/bulleted section lists written by the admin."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    found: List[str] = []
    for line in lines:
        m = re.match(r"^(?:\d+[\.\)]|[-*•])\s+(.{3,80})$", line)
        if m:
            title = m.group(1).strip().rstrip(":.").strip()
            if 3 <= len(title) <= 80:
                found.append(title[:1].upper() + title[1:])
    return found


def build_plan(ctx: AnalysisContext, llm: Optional[LlmClient] = None) -> Dict[str, Any]:
    skills = select_skills(ctx)
    supported_keys = [s["key"] for s in skills["selected"]]
    ctx.plan = {"skills": skills}

    sections = plan_sections(ctx.prompt)
    focus_metrics: List[str] = []
    requested_dimensions: List[str] = []
    notes = ""

    if llm and llm.available:
        schema = ctx.schema_summary()
        payload = {
            "report_prompt": ctx.prompt,
            "schema": schema,
            "supported_skills": [{"key": s["key"], "title": s["title"]} for s in skills["selected"]],
            "unsupported_skills": [{"key": s["key"], "reason": s["reason"]} for s in skills["rejected"]],
        }
        result = llm.complete_json(
            PLANNER_SYSTEM,
            _json(payload),
            fallback={"sections": sections, "focus_metrics": [], "requested_dimensions": [], "requested_skills": supported_keys},
        )
        if isinstance(result, dict):
            llm_sections = [str(s)[:80] for s in (result.get("sections") or []) if str(s).strip()]
            if len(llm_sections) >= 3:
                sections = llm_sections[:14]
            focus_metrics = [str(m)[:80] for m in (result.get("focus_metrics") or [])][:20]
            valid_columns = {c["name"] for prof in ctx.profiles.values() for c in prof.get("columns", [])}
            requested_dimensions = [d for d in (result.get("requested_dimensions") or []) if d in valid_columns][:10]
            requested = [k for k in (result.get("requested_skills") or []) if k in SKILLS_BY_KEY]
            if requested:
                # LLM may narrow the set, never widen it beyond data-supported skills.
                keep = set(requested) & set(supported_keys)
                if keep:
                    skills["selected"] = [s for s in skills["selected"] if s["key"] in keep]
                    supported_keys = [s["key"] for s in skills["selected"]]
            notes = str(result.get("notes") or "")[:500]

    unsupported = detect_unsupported_requests(ctx, supported_keys)

    plan = {
        "sections": sections,
        "skills": skills,
        "selected_skill_keys": supported_keys,
        "focus_metrics": focus_metrics,
        "requested_dimensions": requested_dimensions,
        "unsupported_requests": unsupported,
        "planner": "llm" if (llm and llm.available) else "deterministic",
        "notes": notes,
    }
    ctx.plan = plan
    return plan


def _json(payload: Dict[str, Any]) -> str:
    import json

    return json.dumps(payload, default=str)[:60000]
