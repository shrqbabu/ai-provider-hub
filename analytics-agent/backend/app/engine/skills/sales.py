"""Sales analysis skill — revenue, orders, AOV, margin, trend, mix, growth."""
from __future__ import annotations

from typing import Any, Dict, List

import pandas as pd

from ..context import AnalysisContext
from ..metrics import MetricRegistry
from .base import (
    Applicability,
    Skill,
    choose_freq,
    concentration,
    growth_pct,
    pct,
    period_series,
    safe_float,
    split_periods,
    top_n,
)


class SalesSkill(Skill):
    key = "sales"
    title = "Sales Analysis"
    keywords = ("sales", "revenue", "orders", "aov", "growth", "turnover", "bookings", "margin", "top line")
    domains = ("sales", "finance")

    def applicability(self, ctx: AnalysisContext) -> Applicability:
        cm = ctx.primary_columns
        if cm.revenue:
            return Applicability(True)
        if cm.quantity and cm.price:
            return Applicability(True, confidence=0.8)
        return Applicability(
            False,
            reason="No revenue/sales amount column was found in the uploaded data.",
            alternative=(
                "Provide a monetary column (revenue, sales amount, order total) or both unit price and quantity."
            ),
        )

    def run(self, ctx: AnalysisContext, registry: MetricRegistry) -> Dict[str, Any]:
        table = ctx.primary_table
        frame = ctx.primary_frame.copy()
        cm = ctx.primary_columns
        rows = len(frame)
        derived: List[str] = []

        revenue_col = cm.revenue
        if not revenue_col and cm.quantity and cm.price:
            revenue_col = "__revenue_derived"
            frame[revenue_col] = pd.to_numeric(frame[cm.quantity], errors="coerce") * pd.to_numeric(
                frame[cm.price], errors="coerce"
            )
            derived.append(f"revenue = {cm.quantity} × {cm.price}")

        revenue = safe_float(pd.to_numeric(frame[revenue_col], errors="coerce").sum())
        registry.register(
            "Total Revenue",
            revenue,
            metric_id="total_revenue",
            definition=f"Sum of {revenue_col} across all {rows:,} rows of {table}.",
            formula=f"SUM({table}[{revenue_col}])",
            source=self.source(table, [revenue_col], rows, {"derived": derived}),
            unit="currency",
            grain=ctx.model.get("tables", [{}])[0].get("grain", ""),
            skill=self.key,
        )

        # Orders
        if cm.order_id:
            order_count = int(frame[cm.order_id].dropna().nunique())
            formula = f"DISTINCTCOUNT({table}[{cm.order_id}])"
            definition = f"Distinct {cm.order_id} values in {table}."
        else:
            order_count = rows
            formula = f"COUNTROWS({table})"
            definition = f"Row count of {table} (no order identifier column present, each row treated as one transaction)."
        registry.register(
            "Total Orders",
            order_count,
            metric_id="total_orders",
            definition=definition,
            formula=formula,
            source=self.source(table, [cm.order_id], rows),
            unit="number",
            skill=self.key,
        )

        aov = (revenue / order_count) if revenue is not None and order_count else None
        registry.register(
            "Average Order Value",
            aov,
            metric_id="average_order_value",
            definition="Total Revenue divided by Total Orders.",
            formula="DIVIDE([Total Revenue], [Total Orders])",
            source=self.source(table, [revenue_col, cm.order_id], rows, {"depends_on": ["total_revenue", "total_orders"]}),
            unit="currency",
            skill=self.key,
        )

        if cm.quantity:
            qty = safe_float(pd.to_numeric(frame[cm.quantity], errors="coerce").sum())
            registry.register(
                "Total Units Sold",
                qty,
                metric_id="total_units",
                definition=f"Sum of {cm.quantity} in {table}.",
                formula=f"SUM({table}[{cm.quantity}])",
                source=self.source(table, [cm.quantity], rows),
                unit="number",
                skill=self.key,
            )
            if revenue and qty:
                registry.register(
                    "Average Selling Price",
                    revenue / qty,
                    metric_id="average_selling_price",
                    definition="Total Revenue divided by Total Units Sold.",
                    formula="DIVIDE([Total Revenue], [Total Units Sold])",
                    source=self.source(table, [revenue_col, cm.quantity], rows),
                    unit="currency",
                    skill=self.key,
                )

        # Margin
        profit_value = None
        if cm.profit:
            profit_value = safe_float(pd.to_numeric(frame[cm.profit], errors="coerce").sum())
            profit_formula = f"SUM({table}[{cm.profit}])"
            profit_def = f"Sum of {cm.profit} in {table}."
            profit_cols = [cm.profit]
        elif cm.cost:
            cost_total = safe_float(pd.to_numeric(frame[cm.cost], errors="coerce").sum())
            if revenue is not None and cost_total is not None:
                profit_value = revenue - cost_total
                registry.register(
                    "Total Cost",
                    cost_total,
                    metric_id="total_cost",
                    definition=f"Sum of {cm.cost} in {table}.",
                    formula=f"SUM({table}[{cm.cost}])",
                    source=self.source(table, [cm.cost], rows),
                    unit="currency",
                    skill=self.key,
                )
            profit_formula = "[Total Revenue] - [Total Cost]"
            profit_def = "Total Revenue minus Total Cost."
            profit_cols = [revenue_col, cm.cost]
        else:
            profit_formula = profit_def = ""
            profit_cols = []
            registry.mark_unsupported(
                "Gross margin / profitability",
                "The dataset has no cost or profit column, so margin cannot be computed.",
                "Upload a cost of goods (COGS) or profit column to enable margin analysis.",
            )

        if profit_value is not None:
            registry.register(
                "Gross Profit",
                profit_value,
                metric_id="gross_profit",
                definition=profit_def,
                formula=profit_formula,
                source=self.source(table, profit_cols, rows),
                unit="currency",
                skill=self.key,
            )
            registry.register(
                "Gross Margin %",
                pct(profit_value, revenue),
                metric_id="gross_margin_pct",
                definition="Gross Profit as a percentage of Total Revenue.",
                formula="DIVIDE([Gross Profit], [Total Revenue])",
                source=self.source(table, profit_cols + [revenue_col], rows),
                unit="percent",
                skill=self.key,
            )

        if cm.discount:
            disc = safe_float(pd.to_numeric(frame[cm.discount], errors="coerce").sum())
            registry.register(
                "Total Discount",
                disc,
                metric_id="total_discount",
                definition=f"Sum of {cm.discount} in {table}.",
                formula=f"SUM({table}[{cm.discount}])",
                source=self.source(table, [cm.discount], rows),
                unit="currency",
                skill=self.key,
            )

        # Trend + growth
        trend_meta: Dict[str, Any] = {}
        if cm.date:
            freq, label = choose_freq(frame, cm.date)
            series = period_series(frame, cm.date, revenue_col, freq=freq)
            if series:
                registry.register(
                    f"Revenue by {label.title()}",
                    series,
                    metric_id="revenue_trend",
                    definition=f"{revenue_col} summed per {label} using {cm.date}.",
                    formula=f"SUM({table}[{revenue_col}]) by {cm.date} ({label})",
                    source=self.source(table, [revenue_col, cm.date], rows, {"freq": freq}),
                    unit="currency",
                    value_type="series",
                    period=f"{series[0]['period']} → {series[-1]['period']}",
                    skill=self.key,
                )
                current, previous = split_periods(series)
                registry.register(
                    f"Revenue — Latest {label.title()}",
                    current,
                    metric_id="revenue_latest_period",
                    definition=f"Revenue in the most recent complete {label} ({series[-1]['period']}).",
                    formula=f"CALCULATE([Total Revenue], LASTDATE({table}[{cm.date}]) period)",
                    source=self.source(table, [revenue_col, cm.date], rows),
                    unit="currency",
                    period=series[-1]["period"],
                    skill=self.key,
                )
                g = growth_pct(current, previous)
                if g is not None:
                    registry.register(
                        f"Revenue Growth % ({label}-over-{label})",
                        g,
                        metric_id="revenue_growth_pct",
                        definition=(
                            f"Percentage change in revenue from {series[-2]['period']} to {series[-1]['period']}."
                        ),
                        formula="DIVIDE([Revenue] - [Revenue Previous Period], [Revenue Previous Period])",
                        source=self.source(
                            table, [revenue_col, cm.date], rows,
                            {"current": current, "previous": previous, "periods": [series[-2]["period"], series[-1]["period"]]},
                        ),
                        unit="percent",
                        skill=self.key,
                    )
                dates = pd.to_datetime(frame[cm.date], errors="coerce").dropna()
                trend_meta = {
                    "freq": freq,
                    "label": label,
                    "points": len(series),
                    "date_min": str(dates.min().date()) if not dates.empty else None,
                    "date_max": str(dates.max().date()) if not dates.empty else None,
                }
                if len(series) >= 24:
                    yoy = growth_pct(series[-1]["value"], series[-13]["value"]) if freq == "ME" else None
                    if yoy is not None:
                        registry.register(
                            "Revenue YoY %",
                            yoy,
                            metric_id="revenue_yoy_pct",
                            definition=(
                                f"Revenue in {series[-1]['period']} versus the same month a year earlier "
                                f"({series[-13]['period']})."
                            ),
                            formula="DIVIDE([Total Revenue] - [Revenue PY], [Revenue PY])",
                            source=self.source(table, [revenue_col, cm.date], rows),
                            unit="percent",
                            skill=self.key,
                        )
        else:
            registry.mark_unsupported(
                "Time-based growth / trend",
                "No date column was detected, so period-over-period growth cannot be calculated.",
                "Include an order/transaction date column to unlock trend and time-intelligence analysis.",
            )

        # Mix breakdowns
        for dim, metric_id, title in (
            (cm.category, "revenue_by_category", "Revenue by Category"),
            (cm.region, "revenue_by_region", "Revenue by Region"),
            (cm.channel, "revenue_by_channel", "Revenue by Channel"),
        ):
            if not dim:
                continue
            breakdown = top_n(frame, dim, revenue_col, n=12)
            if breakdown:
                registry.register(
                    title,
                    breakdown,
                    metric_id=metric_id,
                    definition=f"{revenue_col} summed by {dim}.",
                    formula=f"SUM({table}[{revenue_col}]) grouped by {table}[{dim}]",
                    source=self.source(table, [revenue_col, dim], rows),
                    unit="currency",
                    value_type="series",
                    skill=self.key,
                )

        return {
            "revenue_column": revenue_col,
            "derived": derived,
            "trend": trend_meta,
            "concentration_pct": concentration(
                [b["value"] for b in top_n(frame, cm.category or cm.product_name or "", revenue_col, n=1000)]
            )
            if (cm.category or cm.product_name)
            else None,
        }
