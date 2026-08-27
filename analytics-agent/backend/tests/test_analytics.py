"""Analytics correctness: known KPIs, joins, growth, dates, missing data."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.engine import modeling, quality
from app.engine.context import build_context, resolve_columns
from app.engine.ingest import TableData, profile_table
from app.engine.metrics import MetricRegistry
from app.engine.skills.customer import CustomerSkill
from app.engine.skills.forecasting import ForecastingSkill
from app.engine.skills.inventory import InventorySkill
from app.engine.skills.sales import SalesSkill


def make_ctx(frames: dict, prompt: str = "Analyse everything."):
    profiles = {}
    for name, frame in frames.items():
        table = TableData(name=name, frame=frame)
        profiles[name] = profile_table(table)
        frames[name] = table.frame
    model = modeling.build_model(frames, profiles)
    q = quality.assess(frames, profiles, model.get("relationships", []))
    ctx = build_context(prompt, frames, profiles, model, q)
    ctx.plan = {"skills": {"selected": [], "rejected": []}, "unsupported_requests": []}
    return ctx


# ---------------------------------------------------------------------------
# known ground-truth KPIs
# ---------------------------------------------------------------------------
def test_known_kpis_are_exact():
    frame = pd.DataFrame(
        {
            "order_id": ["O1", "O2", "O3", "O4"],
            "order_date": pd.to_datetime(["2024-01-15", "2024-01-20", "2024-02-10", "2024-02-25"]),
            "customer_id": ["C1", "C1", "C2", "C3"],
            "revenue": [100.0, 200.0, 300.0, 400.0],
            "cost": [60.0, 120.0, 150.0, 200.0],
            "quantity": [1, 2, 3, 4],
        }
    )
    ctx = make_ctx({"orders": frame})
    registry = MetricRegistry()
    SalesSkill().run(ctx, registry)

    assert registry.require("total_revenue").value == 1000.0
    assert registry.require("total_orders").value == 4
    assert registry.require("average_order_value").value == 250.0
    assert registry.require("total_units").value == 10
    assert registry.require("gross_profit").value == 470.0
    assert registry.require("gross_margin_pct").value == pytest.approx(47.0)
    assert registry.require("average_selling_price").value == pytest.approx(100.0)


def test_growth_calculation_is_correct():
    dates = pd.to_datetime(
        ["2024-01-10"] * 2 + ["2024-02-10"] * 2 + ["2024-03-10"] * 2 + ["2024-04-30"] * 2
    )
    frame = pd.DataFrame(
        {
            "order_id": [f"O{i}" for i in range(8)],
            "order_date": dates,
            "revenue": [50.0, 50.0, 100.0, 100.0, 200.0, 200.0, 250.0, 250.0],
        }
    )
    ctx = make_ctx({"orders": frame})
    registry = MetricRegistry()
    SalesSkill().run(ctx, registry)
    # April is complete (last observation is 2024-04-30), so growth is 500 -> 400? No:
    # Mar = 400, Apr = 500 -> +25%
    series = registry.require("revenue_trend").value
    assert [p["value"] for p in series] == [100.0, 200.0, 400.0, 500.0]
    assert registry.require("revenue_growth_pct").value == pytest.approx(25.0)


def test_incomplete_trailing_period_is_excluded():
    """A partial final month must not appear as a collapse in the trend."""
    rows = []
    for month in range(1, 7):
        for day in (5, 15, 25):
            rows.append({"order_id": f"O{month}{day}", "order_date": f"2024-0{month}-{day:02d}", "revenue": 100.0})
    rows.append({"order_id": "OX", "order_date": "2024-07-01", "revenue": 100.0})  # partial July
    frame = pd.DataFrame(rows)
    frame["order_date"] = pd.to_datetime(frame["order_date"])
    ctx = make_ctx({"orders": frame})
    registry = MetricRegistry()
    SalesSkill().run(ctx, registry)
    periods = [p["period"] for p in registry.require("revenue_trend").value]
    assert not periods[-1].startswith("2024-07")
    assert registry.require("revenue_growth_pct").value == pytest.approx(0.0)


def test_percentages_stay_within_bounds():
    frame = pd.DataFrame(
        {
            "customer_id": ["C1", "C1", "C2", "C3", "C4"],
            "order_id": ["O1", "O2", "O3", "O4", "O5"],
            "order_date": pd.to_datetime(["2024-01-01"] * 5),
            "revenue": [10.0, 20.0, 30.0, 40.0, 50.0],
        }
    )
    ctx = make_ctx({"orders": frame})
    registry = MetricRegistry()
    CustomerSkill().run(ctx, registry)
    rate = registry.require("repeat_purchase_rate").value
    assert 0 <= rate <= 100
    assert rate == pytest.approx(25.0)  # 1 of 4 customers repeats


def test_missing_values_do_not_corrupt_totals():
    frame = pd.DataFrame(
        {
            "order_id": ["O1", "O2", "O3"],
            "order_date": pd.to_datetime(["2024-01-01", "2024-02-01", "2024-03-01"]),
            "revenue": [100.0, np.nan, 300.0],
        }
    )
    ctx = make_ctx({"orders": frame})
    registry = MetricRegistry()
    SalesSkill().run(ctx, registry)
    assert registry.require("total_revenue").value == 400.0


def test_join_duplication_is_detected():
    orders = pd.DataFrame({"order_id": ["O1", "O2"], "customer_id": ["C1", "C1"], "revenue": [100.0, 200.0]})
    contacts = pd.DataFrame({"customer_id": ["C1", "C1"], "email": ["a@x.com", "b@x.com"]})
    profiles = {}
    frames = {"orders": orders, "contacts": contacts}
    for name, frame in frames.items():
        table = TableData(name=name, frame=frame)
        profiles[name] = profile_table(table)
    model = modeling.build_model(frames, profiles)
    rels = model["relationships"]
    assert rels, "expected a detected relationship on customer_id"
    assert any(r["cardinality"] == "many-to-many" and r["fan_out"] for r in rels)
    q = quality.assess(frames, profiles, rels)
    assert any("many-to-many" in i["message"] for i in q["issues"])


def test_duplicate_rows_flagged_by_quality():
    frame = pd.DataFrame({"a": [1, 1, 2], "b": ["x", "x", "y"]})
    ctx = make_ctx({"t": frame})
    assert ctx.quality["uniqueness"]["tables"]["t"]["duplicate_rows"] == 1
    assert any(i["dimension"] == "uniqueness" for i in ctx.quality["issues"])


def test_completeness_score_reflects_missing_data():
    frame = pd.DataFrame({"a": [1, None, 3, None], "b": ["x", "y", "z", "w"]})
    ctx = make_ctx({"t": frame})
    assert ctx.quality["completeness"]["score"] == pytest.approx(75.0)
    assert any("50" in i["message"] for i in ctx.quality["issues"])


def test_date_columns_are_coerced_and_ranged():
    frame = pd.DataFrame({"order_date": ["2024-01-01", "2024-06-15", "2024-12-31"], "revenue": [1.0, 2.0, 3.0]})
    ctx = make_ctx({"t": frame})
    profile = ctx.profile("t")
    assert profile["date_columns"] == ["order_date"]
    assert profile["date_range"]["min"].startswith("2024-01-01")


def test_column_role_resolution_never_invents():
    frame = pd.DataFrame({"foo": [1, 2], "bar": ["a", "b"]})
    ctx = make_ctx({"t": frame})
    cm = ctx.primary_columns
    assert cm.customer_id is None
    assert cm.stock is None
    for value in cm.present().values():
        assert value in frame.columns


def test_sales_skill_not_supported_without_money():
    frame = pd.DataFrame({"name": ["a", "b"], "note": ["x", "y"]})
    ctx = make_ctx({"t": frame})
    app = SalesSkill().applicability(ctx)
    assert not app.supported
    assert "revenue" in app.reason.lower()
    assert app.alternative


def test_forecast_requires_minimum_history():
    frame = pd.DataFrame(
        {
            "order_date": pd.to_datetime(["2024-01-01", "2024-02-01", "2024-03-01"]),
            "revenue": [100.0, 110.0, 120.0],
        }
    )
    ctx = make_ctx({"t": frame})
    app = ForecastingSkill().applicability(ctx)
    assert not app.supported
    assert "month" in app.reason.lower()


def test_forecast_runs_with_enough_history():
    dates = pd.date_range("2022-01-01", periods=36, freq="MS")
    frame = pd.DataFrame({"order_date": dates, "revenue": np.linspace(100, 500, 36)})
    ctx = make_ctx({"t": frame})
    assert ForecastingSkill().applicability(ctx).supported
    registry = MetricRegistry()
    ForecastingSkill().run(ctx, registry)
    forecast = registry.require("forecast_series")
    assert len(forecast.value) == 6
    assert all(p["value"] is not None for p in forecast.value)
    assert registry.require("forecast_total").value > 0


def test_churn_reported_as_proxy_when_no_status_column():
    dates = pd.date_range("2024-01-01", periods=200, freq="D")
    frame = pd.DataFrame(
        {
            "customer_id": [f"C{i % 40}" for i in range(200)],
            "order_id": [f"O{i}" for i in range(200)],
            "order_date": dates,
            "revenue": np.linspace(10, 200, 200),
        }
    )
    ctx = make_ctx({"t": frame})
    registry = MetricRegistry()
    CustomerSkill().run(ctx, registry)
    assert registry.get("inactivity_rate_pct") is not None
    assert registry.get("churn_rate_pct") is None
    assert any("churn" in u["requested"].lower() for u in registry.unsupported)


def test_inventory_metrics_and_unsupported_reorder():
    frame = pd.DataFrame(
        {"sku": ["A", "B", "C", "D"], "stock_on_hand": [0, 5, 20, -2], "category": ["x", "x", "y", "y"]}
    )
    ctx = make_ctx({"inv": frame})
    registry = MetricRegistry()
    InventorySkill().run(ctx, registry)
    assert registry.require("total_stock_on_hand").value == 23
    assert registry.require("out_of_stock_items").value == 2
    assert registry.require("stockout_rate_pct").value == pytest.approx(50.0)
    assert any("reorder" in u["requested"].lower() for u in registry.unsupported)


def test_metric_registry_is_single_source_of_truth():
    registry = MetricRegistry()
    m = registry.register("Total Revenue", 1234.5, definition="d", formula="f", source={"table": "t"}, unit="currency")
    assert m.display_value == "1.2K"
    duplicate = registry.register("Total Revenue", 999, definition="d", formula="f", source={})
    assert duplicate.metric_id != m.metric_id  # no silent overwrite
    assert registry.require("total_revenue").value == 1234.5
