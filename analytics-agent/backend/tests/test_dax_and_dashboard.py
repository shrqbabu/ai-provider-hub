"""DAX generation/validation and dashboard PNG value-fidelity tests."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.engine import dax as dax_engine
from app.engine import modeling, quality
from app.engine.context import build_context
from app.engine.dashboard import render_dashboard
from app.engine.ingest import TableData, profile_table
from app.engine.insights import generate as generate_insights
from app.engine.metrics import MetricRegistry
from app.engine.skills.customer import CustomerSkill
from app.engine.skills.sales import SalesSkill
from app.engine.validator import validate_all


@pytest.fixture
def prepared(sales_frame):
    frames = {"orders": sales_frame.copy()}
    profiles = {}
    for name, frame in frames.items():
        table = TableData(name=name, frame=frame)
        profiles[name] = profile_table(table)
        frames[name] = table.frame
    model = modeling.build_model(frames, profiles)
    q = quality.assess(frames, profiles, model.get("relationships", []))
    ctx = build_context(
        "Analyse revenue by category and region, customer retention and top products.",
        frames, profiles, model, q,
    )
    ctx.plan = {"skills": {"selected": [{"key": "sales", "title": "Sales Analysis"}], "rejected": []},
                "sections": ["Executive Summary", "KPIs"], "unsupported_requests": []}
    registry = MetricRegistry()
    SalesSkill().run(ctx, registry)
    CustomerSkill().run(ctx, registry)
    return ctx, registry


# ---------------------------------------------------------------------------
# DAX
# ---------------------------------------------------------------------------
def test_expected_measures_are_generated(prepared):
    ctx, registry = prepared
    bundle = dax_engine.generate(ctx, registry)
    names = {m["name"] for m in bundle["measures"]}
    for expected in ("Total Revenue", "Total Orders", "Average Order Value", "Unique Customers", "Revenue YoY %"):
        assert expected in names
    assert "Base Measures" in bundle["groups"]
    assert bundle["date_table"] == "DateTable"


def test_generated_dax_only_references_real_columns(prepared):
    ctx, registry = prepared
    bundle = dax_engine.validate(ctx, dax_engine.generate(ctx, registry))
    assert bundle["validation"]["failed"] == 0, [
        m["validation_errors"] for m in bundle["measures"] if m["validation_status"] == "failed"
    ]
    assert bundle["validation"]["passed"] is True


def test_invalid_column_reference_is_detected(prepared):
    ctx, registry = prepared
    bundle = dax_engine.generate(ctx, registry)
    bundle["measures"].append(
        {
            "name": "Bogus Measure",
            "dax_code": "Bogus Measure = SUM(orders[does_not_exist])",
            "purpose": "invalid",
            "group": "Advanced Measures",
            "kind": "measure",
            "dependencies": [],
            "metric_id": None,
            "validation_status": "unverified",
            "validation_errors": [],
            "generator": "llm",
        }
    )
    bundle["grouped"].setdefault("Advanced Measures", []).append(bundle["measures"][-1])
    validated = dax_engine.validate(ctx, bundle)
    bogus = next(m for m in validated["measures"] if m["name"] == "Bogus Measure")
    assert bogus["validation_status"] == "failed"
    assert any("does_not_exist" in e for e in bogus["validation_errors"])


def test_invalid_table_reference_is_detected(prepared):
    ctx, registry = prepared
    bundle = dax_engine.generate(ctx, registry)
    bundle["measures"] = [
        {
            "name": "Ghost",
            "dax_code": "Ghost = SUM(GhostTable[amount])",
            "purpose": "", "group": "Advanced Measures", "kind": "measure",
            "dependencies": [], "metric_id": None, "validation_status": "unverified",
            "validation_errors": [], "generator": "llm",
        }
    ]
    bundle["grouped"] = {"Advanced Measures": bundle["measures"]}
    bundle["groups"] = ["Advanced Measures"]
    validated = dax_engine.validate(ctx, bundle)
    assert validated["measures"][0]["validation_status"] == "failed"
    assert any("Unknown table" in e for e in validated["measures"][0]["validation_errors"])


def test_undefined_measure_dependency_is_detected(prepared):
    ctx, registry = prepared
    bundle = dax_engine.generate(ctx, registry)
    bundle["measures"] = [
        {
            "name": "Derived", "dax_code": "Derived = DIVIDE([Nonexistent Measure], [Total Revenue])",
            "purpose": "", "group": "Advanced Measures", "kind": "measure",
            "dependencies": ["Nonexistent Measure"], "metric_id": None,
            "validation_status": "unverified", "validation_errors": [], "generator": "llm",
        }
    ]
    bundle["grouped"] = {"Advanced Measures": bundle["measures"]}
    bundle["groups"] = ["Advanced Measures"]
    validated = dax_engine.validate(ctx, bundle)
    errors = validated["measures"][0]["validation_errors"]
    assert any("Nonexistent Measure" in e for e in errors)


def test_unbalanced_syntax_is_detected(prepared):
    ctx, registry = prepared
    bundle = dax_engine.generate(ctx, registry)
    bundle["measures"] = [
        {
            "name": "Broken", "dax_code": "Broken = SUM(orders[revenue]",
            "purpose": "", "group": "Base Measures", "kind": "measure", "dependencies": [],
            "metric_id": None, "validation_status": "unverified", "validation_errors": [], "generator": "llm",
        }
    ]
    bundle["grouped"] = {"Base Measures": bundle["measures"]}
    bundle["groups"] = ["Base Measures"]
    validated = dax_engine.validate(ctx, bundle)
    assert "Unbalanced parentheses." in validated["measures"][0]["validation_errors"]


def test_time_intelligence_requires_date_table(prepared):
    ctx, registry = prepared
    bundle = dax_engine.generate(ctx, registry)
    bundle["measures"] = [
        {
            "name": "Bad YTD", "dax_code": "Bad YTD = TOTALYTD(SUM(orders[revenue]), orders[order_date])",
            "purpose": "", "group": "Time Intelligence", "kind": "measure", "dependencies": [],
            "metric_id": None, "validation_status": "unverified", "validation_errors": [], "generator": "llm",
        }
    ]
    bundle["grouped"] = {"Time Intelligence": bundle["measures"]}
    bundle["groups"] = ["Time Intelligence"]
    validated = dax_engine.validate(ctx, bundle)
    assert any("date table" in e.lower() for e in validated["measures"][0]["validation_errors"])


def test_dax_text_export_is_downloadable(prepared):
    ctx, registry = prepared
    bundle = dax_engine.validate(ctx, dax_engine.generate(ctx, registry))
    text = dax_engine.to_text(bundle)
    assert "Total Revenue = SUM(orders[revenue])" in text
    assert "// ---------- Base Measures ----------" in text
    assert "PBIX" not in text.upper() and "PBIT" not in text.upper()


def test_no_powerbi_files_are_produced(prepared):
    ctx, registry = prepared
    bundle = dax_engine.generate(ctx, registry)
    blob = str(bundle).lower()
    assert "pbix" not in blob and "pbit" not in blob


# ---------------------------------------------------------------------------
# Dashboard PNG
# ---------------------------------------------------------------------------
def test_png_is_high_resolution_and_valid(prepared):
    ctx, registry = prepared
    insights = generate_insights(ctx, registry)
    result = render_dashboard(ctx, registry, insights, title="Test Dashboard")
    assert result.png_bytes[:8] == b"\x89PNG\r\n\x1a\n"
    assert result.width >= 1920 and result.height >= 1000
    assert len(result.png_bytes) > 50_000


def test_png_values_match_the_registry(prepared):
    ctx, registry = prepared
    insights = generate_insights(ctx, registry)
    result = render_dashboard(ctx, registry, insights)
    kpis = [v for v in result.rendered_values if v["element"] == "kpi_card"]
    assert kpis
    for item in kpis:
        metric = registry.require(item["metric_id"])
        assert item["displayed"] == metric.display_value


def test_png_has_no_unbacked_numbers(prepared):
    ctx, registry = prepared
    insights = generate_insights(ctx, registry)
    result = render_dashboard(ctx, registry, insights)
    unbacked = [
        v for v in result.rendered_values
        if v["metric_id"] is None and v["element"] not in {"quality_score", "date_range"}
    ]
    assert unbacked == []


def test_png_layout_follows_the_prompt(sales_frame):
    """A prompt asking about inventory/regions must change what is drawn."""
    frames = {"orders": sales_frame.copy()}
    profiles = {}
    for name, frame in frames.items():
        table = TableData(name=name, frame=frame)
        profiles[name] = profile_table(table)
        frames[name] = table.frame
    model = modeling.build_model(frames, profiles)
    q = quality.assess(frames, profiles, model.get("relationships", []))

    def build(prompt):
        ctx = build_context(prompt, dict(frames), profiles, model, q)
        ctx.plan = {"skills": {"selected": [], "rejected": []}, "unsupported_requests": []}
        registry = MetricRegistry()
        SalesSkill().run(ctx, registry)
        CustomerSkill().run(ctx, registry)
        return render_dashboard(ctx, registry, generate_insights(ctx, registry))

    region_labels = {v["label"] for v in build("Break revenue down by region only.").rendered_values}
    customer_labels = {v["label"] for v in build("Show me our top customers by revenue.").rendered_values}
    assert any("Region" in l for l in region_labels)
    assert any("Customer" in l for l in customer_labels)


def test_png_date_range_matches_data(prepared):
    ctx, registry = prepared
    result = render_dashboard(ctx, registry, [])
    assert result.date_range
    trend = registry.get("revenue_trend")
    if trend and trend.period:
        assert result.date_range == trend.period


def test_validator_catches_a_falsified_dashboard_value(prepared):
    ctx, registry = prepared
    insights = generate_insights(ctx, registry)
    bundle = dax_engine.validate(ctx, dax_engine.generate(ctx, registry))
    dashboard = render_dashboard(ctx, registry, insights)

    for item in dashboard.rendered_values:
        if item["element"] == "kpi_card":
            item["displayed"] = "999.9M"  # simulate a renderer/report divergence
            break

    report = validate_all(ctx, registry, insights, bundle, dashboard)
    assert report["passed"] is False
    assert any("registry holds" in i["message"] for i in report["issues"])


def test_validator_passes_on_a_clean_run(prepared):
    ctx, registry = prepared
    insights = generate_insights(ctx, registry)
    bundle = dax_engine.validate(ctx, dax_engine.generate(ctx, registry))
    dashboard = render_dashboard(ctx, registry, insights)
    report = validate_all(ctx, registry, insights, bundle, dashboard)
    assert report["passed"] is True, report["issues"]
    assert report["checks_passed"] == report["checks_total"]


def test_validator_rejects_causal_and_external_claims(prepared):
    ctx, registry = prepared
    bundle = dax_engine.validate(ctx, dax_engine.generate(ctx, registry))
    dashboard = render_dashboard(ctx, registry, [])
    fabricated = [
        {
            "title": "Causal claim", "finding": "Revenue rose because of the new campaign.",
            "evidence": {"metric_ids": ["total_revenue"], "values": []},
            "interpretation": "", "business_impact": "", "recommendation": "",
            "confidence": "high", "priority": "high",
        },
        {
            "title": "External claim", "finding": "We are above the industry average for margin.",
            "evidence": {"metric_ids": ["total_revenue"], "values": []},
            "interpretation": "", "business_impact": "", "recommendation": "",
            "confidence": "high", "priority": "high",
        },
        {
            "title": "Invented metric", "finding": "NPS reached 62.",
            "evidence": {"metric_ids": ["nps_score"], "values": []},
            "interpretation": "", "business_impact": "", "recommendation": "",
            "confidence": "high", "priority": "high",
        },
    ]
    report = validate_all(ctx, registry, fabricated, bundle, dashboard)
    assert fabricated[0]["validation_status"] == "causal_language"
    assert fabricated[1]["validation_status"] == "external_claim"
    assert fabricated[2]["validation_status"] == "invalid_evidence"
    assert report["passed"] is False


def test_validator_recomputes_metrics_independently(prepared):
    ctx, registry = prepared
    registry.require("total_revenue").value = 1.0  # tamper
    bundle = dax_engine.validate(ctx, dax_engine.generate(ctx, registry))
    report = validate_all(ctx, registry, [], bundle, None)
    assert report["passed"] is False
    assert any("recomputation" in i["message"] for i in report["issues"])
