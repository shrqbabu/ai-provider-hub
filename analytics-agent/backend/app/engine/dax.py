"""DAX generation and validation.

Measures are generated deterministically from the real schema and the metric
registry, so every ``Table[Column]`` reference provably exists. The LLM may
only *add* measures, and any addition referencing an unknown table, column or
measure is rejected by the validator before it can reach the user.

Scope: measures, calculated columns where necessary, and a date table. No
PBIX/PBIT and no Power BI publishing.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Set, Tuple

from ..llm.client import LlmClient
from .context import AnalysisContext
from .metrics import MetricRegistry

GROUP_ORDER = [
    "Base Measures",
    "Sales Measures",
    "Customer Measures",
    "Product Measures",
    "Inventory Measures",
    "Time Intelligence",
    "Growth Measures",
    "Advanced Measures",
]

COLUMN_REF = re.compile(r"(?:'([^']+)'|\b([A-Za-z_][A-Za-z0-9_ ]*))\[([^\]]+)\]")
MEASURE_REF = re.compile(r"(?<![A-Za-z0-9_'\)])\[([^\]]+)\]")

DAX_FUNCTIONS = {
    "SUM", "SUMX", "AVERAGE", "AVERAGEX", "MIN", "MAX", "COUNT", "COUNTA", "COUNTROWS", "DISTINCTCOUNT",
    "CALCULATE", "CALCULATETABLE", "FILTER", "ALL", "ALLEXCEPT", "ALLSELECTED", "VALUES", "DISTINCT",
    "DIVIDE", "IF", "SWITCH", "BLANK", "ISBLANK", "RELATED", "RELATEDTABLE", "EARLIER", "VAR", "RETURN",
    "DATEADD", "DATESYTD", "DATESQTD", "DATESMTD", "TOTALYTD", "TOTALQTD", "TOTALMTD", "SAMEPERIODLASTYEAR",
    "PARALLELPERIOD", "PREVIOUSMONTH", "PREVIOUSYEAR", "NEXTMONTH", "ENDOFMONTH", "STARTOFMONTH",
    "FIRSTDATE", "LASTDATE", "MAXX", "MINX", "RANKX", "TOPN", "SELECTEDVALUE", "HASONEVALUE", "CONCATENATEX",
    "CALENDAR", "CALENDARAUTO", "DATE", "YEAR", "MONTH", "DAY", "QUARTER", "WEEKNUM", "FORMAT", "EOMONTH",
    "ADDCOLUMNS", "SUMMARIZE", "SUMMARIZECOLUMNS", "GENERATESERIES", "UNION", "EXCEPT", "INTERSECT",
    "COALESCE", "ABS", "ROUND", "INT", "STDEV.P", "STDEV.S", "VAR.P", "VAR.S", "MEDIAN", "PERCENTILE.INC",
    "USERELATIONSHIP", "KEEPFILTERS", "REMOVEFILTERS", "TREATAS", "NOT", "AND", "OR", "IN", "TRUE", "FALSE",
    "DATESBETWEEN", "DATESINPERIOD", "COUNTX", "ISFILTERED", "ISCROSSFILTERED", "CROSSFILTER", "LOOKUPVALUE",
}

DATE_TABLE = "DateTable"


def _q(table: str) -> str:
    """Quote a table name if DAX requires it."""
    return f"'{table}'" if re.search(r"[^A-Za-z0-9_]", table) else table


class DaxBuilder:
    def __init__(self, ctx: AnalysisContext, registry: MetricRegistry) -> None:
        self.ctx = ctx
        self.registry = registry
        self.measures: List[Dict[str, Any]] = []
        self._names: Set[str] = set()

    def add(
        self,
        name: str,
        code: str,
        purpose: str,
        group: str,
        *,
        dependencies: Optional[List[str]] = None,
        metric_id: Optional[str] = None,
        kind: str = "measure",
    ) -> None:
        if name in self._names:
            return
        self._names.add(name)
        self.measures.append(
            {
                "name": name,
                "dax_code": code.strip(),
                "purpose": purpose,
                "group": group,
                "kind": kind,
                "dependencies": dependencies or [],
                "metric_id": metric_id,
                "validation_status": "unverified",
                "validation_errors": [],
                "generator": "deterministic",
            }
        )


def generate(ctx: AnalysisContext, registry: MetricRegistry, llm: Optional[LlmClient] = None) -> Dict[str, Any]:
    builder = DaxBuilder(ctx, registry)
    table = ctx.primary_table
    cm = ctx.primary_columns
    t = _q(table)

    revenue_col = cm.revenue
    if not revenue_col:
        rev_metric = registry.get("total_revenue")
        if rev_metric:
            cols = rev_metric.source.get("columns") or []
            revenue_col = cols[0] if cols and not str(cols[0]).startswith("__") else None

    # --- Base -------------------------------------------------------------
    builder.add(
        "Row Count",
        f"Row Count = COUNTROWS({t})",
        f"Total number of rows in {table}. Baseline for every count-based measure.",
        "Base Measures",
    )

    if revenue_col:
        builder.add(
            "Total Revenue",
            f"Total Revenue = SUM({t}[{revenue_col}])",
            f"Sum of {revenue_col}. Single source of truth for revenue across the model.",
            "Base Measures",
            metric_id="total_revenue",
        )
    if cm.quantity:
        builder.add(
            "Total Quantity",
            f"Total Quantity = SUM({t}[{cm.quantity}])",
            f"Sum of {cm.quantity}.",
            "Base Measures",
            metric_id="total_units",
        )
    if cm.cost:
        builder.add(
            "Total Cost",
            f"Total Cost = SUM({t}[{cm.cost}])",
            f"Sum of {cm.cost}.",
            "Base Measures",
            metric_id="total_cost",
        )

    # --- Sales ------------------------------------------------------------
    if cm.order_id:
        builder.add(
            "Total Orders",
            f"Total Orders = DISTINCTCOUNT({t}[{cm.order_id}])",
            f"Distinct count of {cm.order_id}.",
            "Sales Measures",
            metric_id="total_orders",
        )
    else:
        builder.add(
            "Total Orders",
            f"Total Orders = COUNTROWS({t})",
            "Row count used as the transaction count (no order identifier in the source).",
            "Sales Measures",
            metric_id="total_orders",
        )

    if revenue_col:
        builder.add(
            "Average Order Value",
            "Average Order Value = DIVIDE([Total Revenue], [Total Orders])",
            "Revenue per order. DIVIDE guards against a zero denominator.",
            "Sales Measures",
            dependencies=["Total Revenue", "Total Orders"],
            metric_id="average_order_value",
        )
    if revenue_col and cm.quantity:
        builder.add(
            "Average Selling Price",
            "Average Selling Price = DIVIDE([Total Revenue], [Total Quantity])",
            "Revenue per unit sold.",
            "Sales Measures",
            dependencies=["Total Revenue", "Total Quantity"],
            metric_id="average_selling_price",
        )
    if cm.profit:
        builder.add(
            "Gross Profit",
            f"Gross Profit = SUM({t}[{cm.profit}])",
            f"Sum of {cm.profit}.",
            "Sales Measures",
            metric_id="gross_profit",
        )
    elif revenue_col and cm.cost:
        builder.add(
            "Gross Profit",
            "Gross Profit = [Total Revenue] - [Total Cost]",
            "Revenue less cost.",
            "Sales Measures",
            dependencies=["Total Revenue", "Total Cost"],
            metric_id="gross_profit",
        )
    if (cm.profit or cm.cost) and revenue_col:
        builder.add(
            "Gross Margin %",
            "Gross Margin % = DIVIDE([Gross Profit], [Total Revenue])",
            "Gross profit as a share of revenue. Format as percentage.",
            "Sales Measures",
            dependencies=["Gross Profit", "Total Revenue"],
            metric_id="gross_margin_pct",
        )
    if cm.discount and revenue_col:
        builder.add(
            "Total Discount",
            f"Total Discount = SUM({t}[{cm.discount}])",
            f"Sum of {cm.discount}.",
            "Sales Measures",
            metric_id="total_discount",
        )
        builder.add(
            "Discount Rate %",
            "Discount Rate % = DIVIDE([Total Discount], [Total Revenue] + [Total Discount])",
            "Discount as a share of gross value before discount.",
            "Sales Measures",
            dependencies=["Total Discount", "Total Revenue"],
        )

    # --- Customer ---------------------------------------------------------
    ckey = cm.customer_id or cm.customer_name
    if ckey:
        builder.add(
            "Unique Customers",
            f"Unique Customers = DISTINCTCOUNT({t}[{ckey}])",
            f"Distinct count of {ckey}.",
            "Customer Measures",
            metric_id="unique_customers",
        )
        if revenue_col:
            builder.add(
                "Revenue per Customer",
                "Revenue per Customer = DIVIDE([Total Revenue], [Unique Customers])",
                "Average revenue per distinct customer in the current filter context.",
                "Customer Measures",
                dependencies=["Total Revenue", "Unique Customers"],
                metric_id="revenue_per_customer",
            )
        builder.add(
            "Orders per Customer",
            "Orders per Customer = DIVIDE([Total Orders], [Unique Customers])",
            "Average order frequency per customer.",
            "Customer Measures",
            dependencies=["Total Orders", "Unique Customers"],
            metric_id="avg_orders_per_customer",
        )
        builder.add(
            "Repeat Customers",
            (
                "Repeat Customers =\n"
                f"COUNTROWS(\n    FILTER(\n        VALUES({t}[{ckey}]),\n"
                "        [Total Orders] > 1\n    )\n)"
            ),
            "Customers with more than one order in the current filter context.",
            "Customer Measures",
            dependencies=["Total Orders"],
            metric_id="repeat_customers",
        )
        builder.add(
            "Repeat Purchase Rate",
            "Repeat Purchase Rate = DIVIDE([Repeat Customers], [Unique Customers])",
            "Share of customers who purchased more than once.",
            "Customer Measures",
            dependencies=["Repeat Customers", "Unique Customers"],
            metric_id="repeat_purchase_rate",
        )
        if cm.date:
            builder.add(
                "Days Since Last Order",
                (
                    "Days Since Last Order =\n"
                    "VAR LastOrder =\n"
                    f"    CALCULATE(MAX({t}[{cm.date}]), ALLEXCEPT({t}, {t}[{ckey}]))\n"
                    "VAR AsOf =\n"
                    f"    CALCULATE(MAX({t}[{cm.date}]), ALL({t}))\n"
                    "RETURN\n    DATEDIFF(LastOrder, AsOf, DAY)"
                ),
                "Recency in days for the selected customer, measured against the latest date in the model.",
                "Customer Measures",
                metric_id="avg_recency_days",
            )

    # --- Product ----------------------------------------------------------
    pkey = cm.product_id or cm.product_name or cm.category
    if pkey:
        builder.add(
            "Distinct Products",
            f"Distinct Products = DISTINCTCOUNT({t}[{pkey}])",
            f"Distinct count of {pkey}.",
            "Product Measures",
            metric_id="distinct_products",
        )
        if revenue_col:
            builder.add(
                "Product Rank by Revenue",
                (
                    "Product Rank by Revenue =\n"
                    f"RANKX(\n    ALLSELECTED({t}[{pkey}]),\n    [Total Revenue],\n    ,\n    DESC,\n    DENSE\n)"
                ),
                "Dense ranking of products by revenue within the current selection.",
                "Product Measures",
                dependencies=["Total Revenue"],
            )
            builder.add(
                "Revenue Share of Total %",
                (
                    "Revenue Share of Total % =\n"
                    "DIVIDE(\n    [Total Revenue],\n"
                    f"    CALCULATE([Total Revenue], REMOVEFILTERS({t}[{pkey}]))\n)"
                ),
                "Contribution of the selected product to the unfiltered total.",
                "Product Measures",
                dependencies=["Total Revenue"],
            )

    # --- Inventory --------------------------------------------------------
    if cm.stock:
        builder.add(
            "Stock On Hand",
            f"Stock On Hand = SUM({t}[{cm.stock}])",
            f"Sum of {cm.stock}.",
            "Inventory Measures",
            metric_id="total_stock_on_hand",
        )
        builder.add(
            "Out of Stock Items",
            (
                "Out of Stock Items =\n"
                f"CALCULATE(\n    COUNTROWS({t}),\n    {t}[{cm.stock}] <= 0\n)"
            ),
            "Count of rows at or below zero on-hand quantity.",
            "Inventory Measures",
            metric_id="out_of_stock_items",
        )
        builder.add(
            "Stockout Rate %",
            "Stockout Rate % = DIVIDE([Out of Stock Items], [Row Count])",
            "Share of item rows currently out of stock.",
            "Inventory Measures",
            dependencies=["Out of Stock Items", "Row Count"],
            metric_id="stockout_rate_pct",
        )
        if cm.reorder_point:
            builder.add(
                "Items Below Reorder Point",
                (
                    "Items Below Reorder Point =\n"
                    f"COUNTROWS(\n    FILTER(\n        {t},\n"
                    f"        {t}[{cm.stock}] < {t}[{cm.reorder_point}]\n    )\n)"
                ),
                "Rows where on-hand quantity has fallen below the reorder threshold.",
                "Inventory Measures",
                metric_id="below_reorder_point",
            )
        if cm.quantity and cm.quantity != cm.stock:
            builder.add(
                "Days of Cover",
                (
                    "Days of Cover =\n"
                    "VAR DailyDemand =\n"
                    "    DIVIDE(\n        [Total Quantity],\n"
                    f"        DATEDIFF(MIN({DATE_TABLE}[Date]), MAX({DATE_TABLE}[Date]), DAY) + 1\n    )\n"
                    "RETURN\n    DIVIDE([Stock On Hand], DailyDemand)"
                ),
                "Stock on hand divided by average daily demand over the selected period.",
                "Inventory Measures",
                dependencies=["Total Quantity", "Stock On Hand"],
                metric_id="days_of_cover",
            )

    # --- Date table + time intelligence ------------------------------------
    if cm.date:
        builder.add(
            DATE_TABLE,
            (
                f"{DATE_TABLE} =\n"
                "VAR MinDate =\n"
                f"    MIN({t}[{cm.date}])\n"
                "VAR MaxDate =\n"
                f"    MAX({t}[{cm.date}])\n"
                "RETURN\n"
                "ADDCOLUMNS(\n"
                "    CALENDAR(DATE(YEAR(MinDate), 1, 1), DATE(YEAR(MaxDate), 12, 31)),\n"
                '    "Year", YEAR([Date]),\n'
                '    "Quarter", "Q" & QUARTER([Date]),\n'
                '    "Month", FORMAT([Date], "MMM"),\n'
                '    "Month Number", MONTH([Date]),\n'
                '    "Year Month", FORMAT([Date], "YYYY-MM"),\n'
                '    "Day of Week", FORMAT([Date], "ddd")\n'
                ")"
            ),
            (
                f"Marked-as-date calculated table spanning the range of {table}[{cm.date}]. "
                f"Relate {t}[{cm.date}] → {DATE_TABLE}[Date] (many-to-one, single direction) before using "
                "any time-intelligence measure."
            ),
            "Time Intelligence",
            kind="calculated_table",
        )
        if revenue_col:
            builder.add(
                "Revenue YTD",
                f"Revenue YTD = TOTALYTD([Total Revenue], {DATE_TABLE}[Date])",
                "Year-to-date revenue. Requires the DateTable relationship.",
                "Time Intelligence",
                dependencies=["Total Revenue", DATE_TABLE],
            )
            builder.add(
                "Revenue MTD",
                f"Revenue MTD = TOTALMTD([Total Revenue], {DATE_TABLE}[Date])",
                "Month-to-date revenue.",
                "Time Intelligence",
                dependencies=["Total Revenue", DATE_TABLE],
            )
            builder.add(
                "Revenue PY",
                (
                    "Revenue PY =\n"
                    "CALCULATE(\n    [Total Revenue],\n"
                    f"    SAMEPERIODLASTYEAR({DATE_TABLE}[Date])\n)"
                ),
                "Revenue for the equivalent period one year earlier.",
                "Time Intelligence",
                dependencies=["Total Revenue", DATE_TABLE],
            )
            builder.add(
                "Revenue Previous Month",
                (
                    "Revenue Previous Month =\n"
                    "CALCULATE(\n    [Total Revenue],\n"
                    f"    DATEADD({DATE_TABLE}[Date], -1, MONTH)\n)"
                ),
                "Revenue shifted back one month within the current filter context.",
                "Time Intelligence",
                dependencies=["Total Revenue", DATE_TABLE],
            )
            builder.add(
                "Revenue YoY %",
                (
                    "Revenue YoY % =\n"
                    "VAR Current = [Total Revenue]\n"
                    "VAR Prior = [Revenue PY]\n"
                    "RETURN\n    DIVIDE(Current - Prior, Prior)"
                ),
                "Year-over-year revenue growth. Blank when there is no prior-year data.",
                "Growth Measures",
                dependencies=["Total Revenue", "Revenue PY"],
                metric_id="revenue_yoy_pct",
            )
            builder.add(
                "Revenue MoM %",
                (
                    "Revenue MoM % =\n"
                    "VAR Current = [Total Revenue]\n"
                    "VAR Prior = [Revenue Previous Month]\n"
                    "RETURN\n    DIVIDE(Current - Prior, Prior)"
                ),
                "Month-over-month revenue growth.",
                "Growth Measures",
                dependencies=["Total Revenue", "Revenue Previous Month"],
                metric_id="revenue_growth_pct",
            )
            builder.add(
                "Revenue 3M Moving Average",
                (
                    "Revenue 3M Moving Average =\n"
                    "AVERAGEX(\n"
                    f"    DATESINPERIOD({DATE_TABLE}[Date], MAX({DATE_TABLE}[Date]), -3, MONTH),\n"
                    "    [Total Revenue]\n)"
                ),
                "Three-month trailing average, smoothing period volatility.",
                "Advanced Measures",
                dependencies=["Total Revenue", DATE_TABLE],
            )

    # --- Advanced -----------------------------------------------------------
    if revenue_col and pkey:
        builder.add(
            "Top 10 Product Revenue",
            (
                "Top 10 Product Revenue =\n"
                "CALCULATE(\n    [Total Revenue],\n"
                f"    TOPN(10, ALLSELECTED({t}[{pkey}]), [Total Revenue], DESC)\n)"
            ),
            "Revenue contributed by the ten highest-revenue products in the current selection.",
            "Advanced Measures",
            dependencies=["Total Revenue"],
        )
    if revenue_col:
        builder.add(
            "Revenue Standard Deviation",
            f"Revenue Standard Deviation = STDEV.P({t}[{revenue_col}])",
            "Population standard deviation of the revenue column — dispersion of transaction values.",
            "Advanced Measures",
        )

    measures = builder.measures

    if llm and llm.available:
        measures = measures + _llm_extra_measures(ctx, registry, llm, existing={m["name"] for m in measures})

    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for m in measures:
        grouped.setdefault(m["group"], []).append(m)
    ordered_groups = [g for g in GROUP_ORDER if g in grouped]

    return {
        "measures": measures,
        "groups": ordered_groups,
        "grouped": {g: grouped[g] for g in ordered_groups},
        "date_table": DATE_TABLE if cm.date else None,
        "model_notes": [
            f"Primary fact table: {table}.",
            *(
                [f"Relate {t}[{cm.date}] to {DATE_TABLE}[Date] and mark {DATE_TABLE} as a date table."]
                if cm.date
                else ["No date column detected — time-intelligence measures were not generated."]
            ),
            *[
                f"Relationship: {r['from_table']}[{r['from_column']}] → {r['to_table']}[{r['to_column']}] ({r['cardinality']})"
                for r in ctx.model.get("relationships", [])
                if r.get("safe_to_join")
            ],
        ],
    }


DAX_LLM_SYSTEM = """You extend a DAX measure library for a Power BI model.

You are given the exact schema (tables and columns) and the measures that already exist.
Return JSON only: {"measures": [{"name": "...", "dax_code": "Name = <dax>", "purpose": "...", "group": "...", "dependencies": ["Existing Measure"]}]}

Hard rules:
- Use ONLY tables and columns from the provided schema. Inventing either is a critical failure.
- Reference existing measures with [Measure Name] only if that measure is in the provided list.
- group must be one of: Base Measures, Sales Measures, Customer Measures, Product Measures, Inventory Measures, Time Intelligence, Growth Measures, Advanced Measures.
- Do not duplicate an existing measure name.
- Always use DIVIDE() instead of the / operator.
- Return at most 6 measures that specifically serve the admin's report prompt."""


def _llm_extra_measures(
    ctx: AnalysisContext, registry: MetricRegistry, llm: LlmClient, existing: Set[str]
) -> List[Dict[str, Any]]:
    payload = {
        "report_prompt": ctx.prompt,
        "schema": ctx.schema_summary(),
        "existing_measures": sorted(existing),
        "date_table": DATE_TABLE if ctx.primary_columns.date else None,
    }
    result = llm.complete_json(DAX_LLM_SYSTEM, json.dumps(payload, default=str)[:60000], fallback=None)
    if not isinstance(result, dict):
        return []
    out: List[Dict[str, Any]] = []
    for item in (result.get("measures") or [])[:6]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        code = str(item.get("dax_code") or "").strip()
        if not name or not code or name in existing:
            continue
        group = str(item.get("group") or "Advanced Measures")
        if group not in GROUP_ORDER:
            group = "Advanced Measures"
        existing.add(name)
        out.append(
            {
                "name": name[:120],
                "dax_code": code[:4000],
                "purpose": str(item.get("purpose") or "")[:400],
                "group": group,
                "kind": "measure",
                "dependencies": [str(d) for d in (item.get("dependencies") or [])][:10],
                "metric_id": None,
                "validation_status": "unverified",
                "validation_errors": [],
                "generator": "llm",
            }
        )
    return out


# ---------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------
def validate(ctx: AnalysisContext, dax: Dict[str, Any]) -> Dict[str, Any]:
    """Static validation against the real schema. Rejects invented references."""
    schema: Dict[str, Set[str]] = {
        name: {str(c["name"]) for c in prof.get("columns", [])} for name, prof in ctx.profiles.items()
    }
    date_table = dax.get("date_table")
    if date_table:
        schema[date_table] = {"Date", "Year", "Quarter", "Month", "Month Number", "Year Month", "Day of Week"}

    measure_names = {m["name"] for m in dax["measures"]}
    errors_total = 0
    warnings_total = 0

    for measure in dax["measures"]:
        errors: List[str] = []
        warnings: List[str] = []
        code = measure["dax_code"]

        # 1. Assignment form
        if "=" not in code:
            errors.append("Measure has no '=' assignment.")
        else:
            declared = code.split("=", 1)[0].strip().strip("'")
            if declared and declared != measure["name"]:
                warnings.append(f"Declared name '{declared}' differs from measure name '{measure['name']}'.")

        # 2. Balanced delimiters
        if code.count("(") != code.count(")"):
            errors.append("Unbalanced parentheses.")
        if code.count("[") != code.count("]"):
            errors.append("Unbalanced square brackets.")
        if code.count("'") % 2 != 0:
            errors.append("Unbalanced single quotes around a table name.")

        # 3. Table[Column] references must exist
        refs: List[Tuple[str, str]] = []
        for quoted, bare, column in COLUMN_REF.findall(code):
            tbl = (quoted or bare).strip()
            if not tbl or tbl.upper() in DAX_FUNCTIONS:
                continue
            refs.append((tbl, column.strip()))
        for tbl, column in refs:
            if tbl not in schema:
                errors.append(f"Unknown table '{tbl}'. Model tables: {', '.join(sorted(schema)) or 'none'}.")
            elif column not in schema[tbl]:
                errors.append(f"Unknown column '{tbl}[{column}]'.")

        # 4. Bare [Measure] references must exist.
        #    Inside a calculated table/column, a bare [Column] legally refers to a
        #    column of the row context, so those names are allowed too.
        stripped = COLUMN_REF.sub(" ", code)
        body = stripped.split("=", 1)[1] if "=" in stripped else stripped
        local_columns: Set[str] = set()
        if measure.get("kind") in {"calculated_table", "calculated_column"}:
            local_columns |= schema.get(measure["name"], set())
            local_columns |= {
                str(m.group(1))
                for m in re.finditer(r'"([^"]+)"\s*,', code)
            }
            local_columns |= {"Date", "Value"}
        for ref in MEASURE_REF.findall(body):
            ref = ref.strip()
            if ref and ref not in measure_names and ref not in local_columns:
                errors.append(f"References undefined measure '[{ref}]'.")

        # 5. Declared dependencies must exist
        for dep in measure.get("dependencies", []):
            if dep not in measure_names and dep not in schema:
                errors.append(f"Declared dependency '{dep}' does not exist in the model.")

        # 6. Time intelligence requires the date table
        if measure["group"] in {"Time Intelligence", "Growth Measures"} and date_table:
            uses_ti = re.search(
                r"\b(TOTALYTD|TOTALQTD|TOTALMTD|SAMEPERIODLASTYEAR|DATEADD|DATESINPERIOD|DATESYTD|PARALLELPERIOD)\b",
                code, re.I,
            )
            if uses_ti and date_table not in code and not any(t[0] == date_table for t in refs):
                deps_cover = any(d in measure_names for d in measure.get("dependencies", []))
                if not deps_cover:
                    errors.append(
                        f"Time-intelligence function used without a reference to the marked date table '{date_table}'."
                    )

        # 7. Division safety
        if re.search(r"(?<![<>=!/])/(?!/)", code.split("=", 1)[-1]) and "DIVIDE" not in code.upper():
            warnings.append("Uses the '/' operator; DIVIDE() is safer against divide-by-zero.")

        # 8. Unknown function names
        for fn in re.findall(r"\b([A-Z][A-Z0-9_.]{2,})\s*\(", code):
            if fn.upper() not in DAX_FUNCTIONS and fn.upper() not in {"DATEDIFF", "SUMMARIZE"}:
                warnings.append(f"'{fn}' is not in the recognised DAX function list — verify manually.")

        measure["validation_errors"] = errors
        measure["validation_warnings"] = warnings
        measure["validation_status"] = "failed" if errors else ("warning" if warnings else "valid")
        errors_total += len(errors)
        warnings_total += len(warnings)

    valid = [m for m in dax["measures"] if m["validation_status"] != "failed"]
    dax["validation"] = {
        "total": len(dax["measures"]),
        "valid": sum(1 for m in dax["measures"] if m["validation_status"] == "valid"),
        "warning": sum(1 for m in dax["measures"] if m["validation_status"] == "warning"),
        "failed": sum(1 for m in dax["measures"] if m["validation_status"] == "failed"),
        "error_count": errors_total,
        "warning_count": warnings_total,
        "passed": errors_total == 0,
    }
    dax["valid_measures"] = valid
    return dax


def to_text(dax: Dict[str, Any], *, include_failed: bool = False) -> str:
    """Render the library as a downloadable .dax file."""
    lines: List[str] = [
        "// ============================================================",
        "// DAX measure library",
        "// Generated from the uploaded schema by the Data Analytics AI Agent.",
        "// Every reference below was statically validated against the real",
        "// tables and columns of the analysed dataset.",
        "// ============================================================",
        "",
    ]
    for note in dax.get("model_notes", []):
        lines.append(f"// {note}")
    lines.append("")
    for group in dax.get("groups", []):
        members = [
            m for m in dax["grouped"][group] if include_failed or m["validation_status"] != "failed"
        ]
        if not members:
            continue
        lines.append(f"// ---------- {group} ----------")
        lines.append("")
        for m in members:
            lines.append(f"// {m['purpose']}")
            if m["validation_status"] != "valid":
                for w in m.get("validation_warnings", []):
                    lines.append(f"// WARNING: {w}")
                for e in m.get("validation_errors", []):
                    lines.append(f"// ERROR: {e}")
            lines.append(m["dax_code"])
            lines.append("")
    return "\n".join(lines).strip() + "\n"
