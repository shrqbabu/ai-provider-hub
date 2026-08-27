"""Customer analysis skill — base size, repeat behaviour, RFM, concentration.

Churn is only reported when the data actually supports it. With transaction
data only, an inactivity proxy is produced and labelled as a proxy.
"""
from __future__ import annotations

from typing import Any, Dict

import numpy as np
import pandas as pd

from ..context import AnalysisContext
from ..metrics import MetricRegistry
from .base import Applicability, Skill, concentration, pct, safe_float, top_n


class CustomerSkill(Skill):
    key = "customer"
    title = "Customer Analysis"
    keywords = ("customer", "client", "retention", "churn", "repeat", "loyalty", "segment", "cohort", "rfm", "clv", "ltv")
    domains = ("customer", "sales")

    def applicability(self, ctx: AnalysisContext) -> Applicability:
        cm = ctx.primary_columns
        if cm.customer_id or cm.customer_name:
            return Applicability(True)
        return Applicability(
            False,
            reason="No customer identifier column was found.",
            alternative="Include a customer id / customer name column to enable customer analysis.",
        )

    def run(self, ctx: AnalysisContext, registry: MetricRegistry) -> Dict[str, Any]:
        table = ctx.primary_table
        frame = ctx.primary_frame
        cm = ctx.primary_columns
        rows = len(frame)
        key = cm.customer_id or cm.customer_name
        revenue_col = cm.revenue
        result: Dict[str, Any] = {"customer_key": key}

        customers = frame[key].dropna().astype(str)
        unique_customers = int(customers.nunique())
        registry.register(
            "Unique Customers",
            unique_customers,
            metric_id="unique_customers",
            definition=f"Distinct {key} values in {table}.",
            formula=f"DISTINCTCOUNT({table}[{key}])",
            source=self.source(table, [key], rows),
            unit="number",
            skill=self.key,
        )

        # Repeat behaviour (needs an order grain)
        order_key = cm.order_id
        if order_key:
            per_customer_orders = frame.dropna(subset=[key]).groupby(frame[key].astype(str))[order_key].nunique()
        else:
            per_customer_orders = customers.value_counts()

        repeat_customers = int((per_customer_orders > 1).sum())
        registry.register(
            "Repeat Customers",
            repeat_customers,
            metric_id="repeat_customers",
            definition="Customers with more than one order/transaction in the dataset.",
            formula=f"COUNTROWS(FILTER(VALUES({table}[{key}]), [Total Orders] > 1))",
            source=self.source(table, [key, order_key], rows),
            unit="number",
            skill=self.key,
        )
        registry.register(
            "Repeat Purchase Rate",
            pct(repeat_customers, unique_customers),
            metric_id="repeat_purchase_rate",
            definition="Repeat Customers as a percentage of Unique Customers.",
            formula="DIVIDE([Repeat Customers], [Unique Customers])",
            source=self.source(table, [key, order_key], rows),
            unit="percent",
            skill=self.key,
        )
        registry.register(
            "Average Orders per Customer",
            safe_float(per_customer_orders.mean()),
            metric_id="avg_orders_per_customer",
            definition="Mean number of orders per customer.",
            formula="DIVIDE([Total Orders], [Unique Customers])",
            source=self.source(table, [key, order_key], rows),
            unit="number",
            skill=self.key,
        )

        if revenue_col:
            spend = frame.dropna(subset=[key]).groupby(frame[key].astype(str))[revenue_col].sum()
            registry.register(
                "Revenue per Customer",
                safe_float(spend.mean()),
                metric_id="revenue_per_customer",
                definition="Total revenue divided by unique customers (observed period only, not a lifetime projection).",
                formula="DIVIDE([Total Revenue], [Unique Customers])",
                source=self.source(table, [revenue_col, key], rows),
                unit="currency",
                skill=self.key,
            )
            top_customers = top_n(frame.dropna(subset=[key]), key, revenue_col, n=10)
            if top_customers:
                registry.register(
                    "Top Customers by Revenue",
                    top_customers,
                    metric_id="top_customers",
                    definition=f"Highest-spending {key} values by summed {revenue_col}.",
                    formula=f"TOPN(10, VALUES({table}[{key}]), [Total Revenue])",
                    source=self.source(table, [revenue_col, key], rows),
                    unit="currency",
                    value_type="series",
                    skill=self.key,
                )
            conc = concentration(list(spend.values))
            if conc is not None:
                registry.register(
                    "Revenue Concentration (Top 20% of Customers)",
                    conc,
                    metric_id="customer_revenue_concentration_pct",
                    definition="Share of total revenue contributed by the top 20% of customers by spend.",
                    formula="DIVIDE(SUMX(TOPN(0.2 * [Unique Customers], VALUES(Customer[Id]), [Total Revenue]), [Total Revenue]), [Total Revenue])",
                    source=self.source(table, [revenue_col, key], rows),
                    unit="percent",
                    skill=self.key,
                )
                result["concentration_pct"] = conc

        # Churn / inactivity — only as an explicitly labelled proxy
        subscription_like = cm.status and frame[cm.status].dropna().astype(str).str.lower().str.contains(
            "cancel|churn|inactive|terminated|expired|unsubscrib"
        ).any()
        if subscription_like:
            status = frame[cm.status].dropna().astype(str).str.lower()
            churned = int(status.str.contains("cancel|churn|inactive|terminated|expired|unsubscrib").sum())
            registry.register(
                "Churned Records",
                churned,
                metric_id="churned_records",
                definition=f"Rows where {cm.status} indicates cancellation/termination.",
                formula=f"CALCULATE(COUNTROWS({table}), {table}[{cm.status}] IN cancellation states)",
                source=self.source(table, [cm.status], rows),
                unit="number",
                skill=self.key,
            )
            registry.register(
                "Churn Rate",
                pct(churned, rows),
                metric_id="churn_rate_pct",
                definition="Share of records in a cancelled/terminated state.",
                formula="DIVIDE([Churned Records], COUNTROWS(table))",
                source=self.source(table, [cm.status], rows),
                unit="percent",
                skill=self.key,
            )
        elif cm.date:
            dates = pd.to_datetime(frame[cm.date], errors="coerce")
            work = pd.DataFrame({"cust": frame[key].astype(str), "d": dates}).dropna()
            if not work.empty:
                as_of = work["d"].max()
                last_seen = work.groupby("cust")["d"].max()
                recency_days = (as_of - last_seen).dt.days
                window = 90 if (as_of - work["d"].min()).days >= 180 else 30
                inactive = int((recency_days > window).sum())
                registry.register(
                    f"Inactive Customers (> {window} days)",
                    inactive,
                    metric_id="inactive_customers",
                    definition=(
                        f"Customers with no transaction in the {window} days before {as_of.date()}. "
                        "This is an inactivity proxy, not a contractual churn measure."
                    ),
                    formula=f"COUNTROWS(FILTER(VALUES({table}[{key}]), [Days Since Last Order] > {window}))",
                    source=self.source(table, [key, cm.date], rows, {"as_of": str(as_of.date()), "window_days": window}),
                    unit="number",
                    skill=self.key,
                )
                registry.register(
                    "Customer Inactivity Rate (churn proxy)",
                    pct(inactive, unique_customers),
                    metric_id="inactivity_rate_pct",
                    definition=(
                        f"Inactive customers as a share of all customers, using a {window}-day inactivity window. "
                        "Proxy only — the dataset has no subscription or cancellation status."
                    ),
                    formula="DIVIDE([Inactive Customers], [Unique Customers])",
                    source=self.source(table, [key, cm.date], rows, {"proxy": True}),
                    unit="percent",
                    skill=self.key,
                )
                registry.register(
                    "Average Recency",
                    safe_float(recency_days.mean()),
                    metric_id="avg_recency_days",
                    definition=f"Mean days since each customer's last transaction as of {as_of.date()}.",
                    formula="AVERAGEX(VALUES(Customer[Id]), [Days Since Last Order])",
                    source=self.source(table, [key, cm.date], rows),
                    unit="days",
                    skill=self.key,
                )
                registry.mark_unsupported(
                    "Contractual customer churn rate",
                    "The dataset contains no subscription, cancellation or account-status column, so true churn cannot be calculated.",
                    f"Customer inactivity rate (>{window} days without a transaction) is reported instead as a proxy.",
                )

                # RFM segmentation (deterministic quintiles)
                if revenue_col:
                    monetary = frame.dropna(subset=[key]).groupby(frame[key].astype(str))[revenue_col].sum()
                    frequency = per_customer_orders
                    rfm = pd.DataFrame(
                        {"recency": recency_days, "frequency": frequency, "monetary": monetary}
                    ).dropna()
                    if len(rfm) >= 10:
                        rfm["r"] = pd.qcut(rfm["recency"].rank(method="first"), 5, labels=[5, 4, 3, 2, 1]).astype(int)
                        rfm["f"] = pd.qcut(rfm["frequency"].rank(method="first"), 5, labels=[1, 2, 3, 4, 5]).astype(int)
                        rfm["m"] = pd.qcut(rfm["monetary"].rank(method="first"), 5, labels=[1, 2, 3, 4, 5]).astype(int)
                        rfm["segment"] = rfm.apply(_segment, axis=1)
                        counts = rfm["segment"].value_counts()
                        registry.register(
                            "Customer Segments (RFM)",
                            [{"label": str(k), "value": int(v)} for k, v in counts.items()],
                            metric_id="customer_segments_rfm",
                            definition=(
                                "Customers bucketed into RFM quintiles on recency, frequency and monetary value "
                                f"(as of {as_of.date()})."
                            ),
                            formula="RFM quintile scoring on recency/frequency/monetary",
                            source=self.source(table, [key, cm.date, revenue_col], rows, {"customers_scored": int(len(rfm))}),
                            unit="number",
                            value_type="series",
                            skill=self.key,
                        )
                        result["rfm_segments"] = int(counts.shape[0])
        else:
            registry.mark_unsupported(
                "Customer churn or retention",
                "The dataset has neither a subscription/cancellation status nor a date column.",
                "Add transaction dates for an inactivity proxy, or an account-status column for true churn.",
            )

        return result


def _segment(row: pd.Series) -> str:
    r, f, m = int(row["r"]), int(row["f"]), int(row["m"])
    if r >= 4 and f >= 4 and m >= 4:
        return "Champions"
    if r >= 4 and f >= 3:
        return "Loyal"
    if r >= 4:
        return "Recent / New"
    if r <= 2 and f >= 4:
        return "At Risk (high value)"
    if r <= 2:
        return "Dormant"
    return "Developing"
