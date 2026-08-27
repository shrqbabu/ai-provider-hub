"""Product analysis skill — SKU performance, mix, Pareto, category contribution."""
from __future__ import annotations

from typing import Any, Dict

import pandas as pd

from ..context import AnalysisContext
from ..metrics import MetricRegistry
from .base import Applicability, Skill, concentration, pct, safe_float, top_n


class ProductSkill(Skill):
    key = "product"
    title = "Product Analysis"
    keywords = ("product", "sku", "item", "category", "mix", "assortment", "catalog", "bestseller", "pareto")
    domains = ("product", "sales", "inventory")

    def applicability(self, ctx: AnalysisContext) -> Applicability:
        cm = ctx.primary_columns
        if cm.product_id or cm.product_name or cm.category:
            return Applicability(True)
        return Applicability(
            False,
            reason="No product, SKU or category column was found.",
            alternative="Include a product id / product name / category column to enable product analysis.",
        )

    def run(self, ctx: AnalysisContext, registry: MetricRegistry) -> Dict[str, Any]:
        table = ctx.primary_table
        frame = ctx.primary_frame
        cm = ctx.primary_columns
        rows = len(frame)
        key = cm.product_id or cm.product_name or cm.category
        measure = cm.revenue or cm.quantity
        result: Dict[str, Any] = {"product_key": key, "measure": measure}

        products = frame[key].dropna().astype(str)
        distinct = int(products.nunique())
        registry.register(
            "Distinct Products",
            distinct,
            metric_id="distinct_products",
            definition=f"Distinct {key} values in {table}.",
            formula=f"DISTINCTCOUNT({table}[{key}])",
            source=self.source(table, [key], rows),
            unit="number",
            skill=self.key,
        )

        if not measure:
            registry.mark_unsupported(
                "Product performance ranking",
                "No revenue or quantity column is available to rank products by.",
                "Upload a revenue/amount or quantity column alongside the product identifier.",
            )
            return result

        unit = "currency" if measure == cm.revenue else "number"
        best = top_n(frame.dropna(subset=[key]), key, measure, n=10)
        worst = top_n(frame.dropna(subset=[key]), key, measure, n=10, ascending=True)

        if best:
            registry.register(
                "Top Products",
                best,
                metric_id="top_products",
                definition=f"Highest {measure} by {key}.",
                formula=f"TOPN(10, VALUES({table}[{key}]), SUM({table}[{measure}]))",
                source=self.source(table, [key, measure], rows),
                unit=unit,
                value_type="series",
                skill=self.key,
            )
        if worst:
            registry.register(
                "Lowest Performing Products",
                worst,
                metric_id="bottom_products",
                definition=f"Lowest {measure} by {key}.",
                formula=f"BOTTOMN(10, VALUES({table}[{key}]), SUM({table}[{measure}]))",
                source=self.source(table, [key, measure], rows),
                unit=unit,
                value_type="series",
                skill=self.key,
            )

        totals = frame.dropna(subset=[key]).groupby(frame[key].astype(str))[measure].sum()
        conc = concentration(list(totals.values))
        if conc is not None:
            registry.register(
                "Product Concentration (Top 20%)",
                conc,
                metric_id="product_concentration_pct",
                definition=f"Share of total {measure} contributed by the top 20% of {key} values.",
                formula="Pareto share of top 20% products",
                source=self.source(table, [key, measure], rows, {"products": int(len(totals))}),
                unit="percent",
                skill=self.key,
            )
            result["concentration_pct"] = conc

        if best and totals.sum():
            top_share = pct(best[0]["value"], safe_float(totals.sum()))
            registry.register(
                "Top Product Share",
                top_share,
                metric_id="top_product_share_pct",
                definition=f"Share of total {measure} held by '{best[0]['label']}'.",
                formula="DIVIDE(top product value, total)",
                source=self.source(table, [key, measure], rows, {"top_product": best[0]["label"]}),
                unit="percent",
                skill=self.key,
            )

        if cm.category and cm.category != key:
            by_cat = top_n(frame.dropna(subset=[cm.category]), cm.category, measure, n=12)
            if by_cat:
                registry.register(
                    "Category Performance",
                    by_cat,
                    metric_id="category_performance",
                    definition=f"{measure} summed by {cm.category}.",
                    formula=f"SUM({table}[{measure}]) grouped by {table}[{cm.category}]",
                    source=self.source(table, [cm.category, measure], rows),
                    unit=unit,
                    value_type="series",
                    skill=self.key,
                )

        if cm.revenue and cm.cost:
            work = frame.dropna(subset=[key]).copy()
            grouped = work.groupby(work[key].astype(str)).agg(
                rev=(cm.revenue, "sum"), cost=(cm.cost, "sum")
            )
            grouped = grouped[grouped["rev"] > 0]
            if not grouped.empty:
                grouped["margin_pct"] = (grouped["rev"] - grouped["cost"]) / grouped["rev"] * 100
                ranked = grouped.sort_values("margin_pct", ascending=False).head(10)
                registry.register(
                    "Product Margin % (Top 10)",
                    [{"label": str(i)[:60], "value": safe_float(v)} for i, v in ranked["margin_pct"].items()],
                    metric_id="product_margin_pct",
                    definition=f"Gross margin percentage per {key}, computed as (revenue - cost) / revenue.",
                    formula="DIVIDE(SUM(revenue) - SUM(cost), SUM(revenue)) by product",
                    source=self.source(table, [key, cm.revenue, cm.cost], rows),
                    unit="percent",
                    value_type="series",
                    skill=self.key,
                )

        return result
