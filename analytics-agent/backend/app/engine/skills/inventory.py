"""Inventory analysis skill — stock cover, turnover, stockouts, reorder risk."""
from __future__ import annotations

from typing import Any, Dict

import pandas as pd

from ..context import AnalysisContext
from ..metrics import MetricRegistry
from .base import Applicability, Skill, pct, safe_float, top_n


class InventorySkill(Skill):
    key = "inventory"
    title = "Inventory Analysis"
    keywords = ("inventory", "stock", "warehouse", "reorder", "stockout", "turnover", "cover", "supply", "on hand")
    domains = ("inventory", "operations")

    def applicability(self, ctx: AnalysisContext) -> Applicability:
        cm = ctx.primary_columns
        if cm.stock:
            return Applicability(True)
        return Applicability(
            False,
            reason="No stock / on-hand / inventory level column was found.",
            alternative="Upload an inventory table containing stock-on-hand per SKU to enable inventory analysis.",
        )

    def run(self, ctx: AnalysisContext, registry: MetricRegistry) -> Dict[str, Any]:
        table = ctx.primary_table
        frame = ctx.primary_frame
        cm = ctx.primary_columns
        rows = len(frame)
        stock = pd.to_numeric(frame[cm.stock], errors="coerce")
        result: Dict[str, Any] = {"stock_column": cm.stock}

        registry.register(
            "Total Stock On Hand",
            safe_float(stock.sum()),
            metric_id="total_stock_on_hand",
            definition=f"Sum of {cm.stock} in {table}.",
            formula=f"SUM({table}[{cm.stock}])",
            source=self.source(table, [cm.stock], rows),
            unit="number",
            skill=self.key,
        )

        zero = int((stock.fillna(0) <= 0).sum())
        registry.register(
            "Out-of-Stock Items",
            zero,
            metric_id="out_of_stock_items",
            definition=f"Rows where {cm.stock} is zero or negative.",
            formula=f"CALCULATE(COUNTROWS({table}), {table}[{cm.stock}] <= 0)",
            source=self.source(table, [cm.stock], rows),
            unit="number",
            skill=self.key,
        )
        registry.register(
            "Stockout Rate",
            pct(zero, rows),
            metric_id="stockout_rate_pct",
            definition="Share of stocked rows currently at or below zero units.",
            formula="DIVIDE([Out-of-Stock Items], COUNTROWS(table))",
            source=self.source(table, [cm.stock], rows),
            unit="percent",
            skill=self.key,
        )

        if cm.reorder_point:
            reorder = pd.to_numeric(frame[cm.reorder_point], errors="coerce")
            below = int((stock < reorder).sum())
            registry.register(
                "Items Below Reorder Point",
                below,
                metric_id="below_reorder_point",
                definition=f"Rows where {cm.stock} is below {cm.reorder_point}.",
                formula=f"CALCULATE(COUNTROWS({table}), {table}[{cm.stock}] < {table}[{cm.reorder_point}])",
                source=self.source(table, [cm.stock, cm.reorder_point], rows),
                unit="number",
                skill=self.key,
            )
            registry.register(
                "Reorder Risk Rate",
                pct(below, rows),
                metric_id="reorder_risk_pct",
                definition="Share of items at or under their reorder threshold.",
                formula="DIVIDE([Items Below Reorder Point], COUNTROWS(table))",
                source=self.source(table, [cm.stock, cm.reorder_point], rows),
                unit="percent",
                skill=self.key,
            )
        else:
            registry.mark_unsupported(
                "Reorder-point breach analysis",
                "No reorder point / safety stock column exists in the dataset.",
                "Out-of-stock counts based on zero on-hand quantity are reported instead.",
            )

        # Turnover and days of cover require demand as well as stock.
        demand_col = cm.quantity if cm.quantity and cm.quantity != cm.stock else None
        if demand_col and cm.date:
            dates = pd.to_datetime(frame[cm.date], errors="coerce")
            span_days = max((dates.max() - dates.min()).days, 1) if dates.notna().any() else None
            demand_total = safe_float(pd.to_numeric(frame[demand_col], errors="coerce").sum())
            avg_stock = safe_float(stock.mean())
            if span_days and demand_total and avg_stock:
                daily_demand = demand_total / span_days
                registry.register(
                    "Average Daily Demand",
                    daily_demand,
                    metric_id="avg_daily_demand",
                    definition=f"Total {demand_col} divided by the {span_days}-day observed window.",
                    formula=f"DIVIDE(SUM({table}[{demand_col}]), days in period)",
                    source=self.source(table, [demand_col, cm.date], rows, {"span_days": span_days}),
                    unit="number",
                    skill=self.key,
                )
                registry.register(
                    "Days of Cover",
                    safe_float(stock.sum() / daily_demand) if daily_demand else None,
                    metric_id="days_of_cover",
                    definition="Total stock on hand divided by average daily demand over the observed window.",
                    formula="DIVIDE([Total Stock On Hand], [Average Daily Demand])",
                    source=self.source(table, [cm.stock, demand_col, cm.date], rows),
                    unit="days",
                    skill=self.key,
                )
                registry.register(
                    "Inventory Turnover (annualised)",
                    safe_float((demand_total / span_days * 365) / avg_stock) if avg_stock else None,
                    metric_id="inventory_turnover",
                    definition=(
                        "Annualised demand divided by average stock on hand. Extrapolated from the "
                        f"{span_days}-day observed window."
                    ),
                    formula="DIVIDE([Annualised Demand], [Average Stock])",
                    source=self.source(table, [cm.stock, demand_col, cm.date], rows, {"extrapolated": True}),
                    unit="ratio",
                    skill=self.key,
                )
        else:
            registry.mark_unsupported(
                "Inventory turnover / days of cover",
                "Turnover requires both a demand quantity column and a date column; at least one is missing.",
                "Stock levels and stockout counts are reported instead.",
            )

        key = cm.product_id or cm.product_name or cm.category
        if key:
            lowest = top_n(frame.dropna(subset=[key]), key, cm.stock, n=10, ascending=True)
            if lowest:
                registry.register(
                    "Lowest Stock Items",
                    lowest,
                    metric_id="lowest_stock_items",
                    definition=f"{key} values with the least {cm.stock}.",
                    formula=f"BOTTOMN(10, VALUES({table}[{key}]), SUM({table}[{cm.stock}]))",
                    source=self.source(table, [key, cm.stock], rows),
                    unit="number",
                    value_type="series",
                    skill=self.key,
                )

        if cm.lead_time:
            lt = pd.to_numeric(frame[cm.lead_time], errors="coerce")
            registry.register(
                "Average Lead Time",
                safe_float(lt.mean()),
                metric_id="avg_lead_time_days",
                definition=f"Mean of {cm.lead_time}.",
                formula=f"AVERAGE({table}[{cm.lead_time}])",
                source=self.source(table, [cm.lead_time], rows),
                unit="days",
                skill=self.key,
            )

        return result
