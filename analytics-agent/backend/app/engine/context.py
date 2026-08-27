"""Shared analysis context and column-resolution helpers.

Column resolution is evidence-based: a role is only assigned when a real
column in the parsed data matches. If nothing matches, the role stays ``None``
and the dependent skill reports NOT_SUPPORTED rather than inventing a column.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import pandas as pd

# Ordered patterns: earlier = stronger evidence.
REVENUE_PATTERNS = [
    r"^(total[_ ]?)?(net[_ ]?)?revenue$", r"^sales([_ ]?amount)?$", r"^(net|gross)[_ ]?sales$",
    r"^(total|order|line)[_ ]?(amount|value|total)$", r"^amount$", r"^turnover$", r"^gmv$",
    r"revenue", r"sales[_ ]?amount", r"(^|_)amount($|_)", r"(^|_)total($|_)",
]
COST_PATTERNS = [r"^(total[_ ]?)?cogs$", r"cost[_ ]?of[_ ]?goods", r"^unit[_ ]?cost$", r"^cost$", r"cost"]
PROFIT_PATTERNS = [r"^gross[_ ]?profit$", r"^profit$", r"^margin$", r"profit", r"margin"]
QTY_PATTERNS = [r"^quantity$", r"^qty$", r"^units([_ ]?sold)?$", r"^volume$", r"quantity", r"(^|_)qty($|_)", r"units"]
PRICE_PATTERNS = [r"^unit[_ ]?price$", r"^price$", r"price"]
DISCOUNT_PATTERNS = [r"^discount([_ ]?amount|[_ ]?pct)?$", r"discount"]
CUSTOMER_ID_PATTERNS = [r"^customer[_ ]?id$", r"^client[_ ]?id$", r"^account[_ ]?id$", r"^cust(omer)?[_ ]?(no|code|key)$", r"customer", r"client", r"account"]
CUSTOMER_NAME_PATTERNS = [r"^customer([_ ]?name)?$", r"^client[_ ]?name$", r"^account[_ ]?name$", r"customer[_ ]?name"]
PRODUCT_ID_PATTERNS = [r"^product[_ ]?id$", r"^sku$", r"^item[_ ]?(id|code)$", r"product[_ ]?id", r"sku", r"item"]
PRODUCT_NAME_PATTERNS = [r"^product([_ ]?name)?$", r"^item[_ ]?name$", r"^description$", r"product[_ ]?name"]
CATEGORY_PATTERNS = [r"^category$", r"^product[_ ]?category$", r"^segment$", r"^type$", r"category", r"segment"]
REGION_PATTERNS = [r"^region$", r"^country$", r"^state$", r"^city$", r"^territory$", r"^market$", r"region", r"country", r"location"]
CHANNEL_PATTERNS = [r"^channel$", r"^sales[_ ]?channel$", r"^source$", r"channel"]
ORDER_ID_PATTERNS = [r"^order[_ ]?id$", r"^invoice([_ ]?id|[_ ]?no)?$", r"^transaction[_ ]?id$", r"^order[_ ]?number$", r"order[_ ]?id", r"invoice", r"transaction"]
STOCK_PATTERNS = [r"^stock([_ ]?on[_ ]?hand)?$", r"^on[_ ]?hand$", r"^inventory([_ ]?qty|[_ ]?level)?$", r"^units[_ ]?available$", r"stock", r"inventory", r"on[_ ]?hand"]
REORDER_PATTERNS = [r"^reorder[_ ]?(point|level)$", r"^safety[_ ]?stock$", r"^min[_ ]?stock$", r"reorder"]
LEADTIME_PATTERNS = [r"^lead[_ ]?time([_ ]?days)?$", r"lead[_ ]?time"]
STATUS_PATTERNS = [r"^status$", r"^order[_ ]?status$", r"^state$", r"status"]
DATE_PATTERNS = [r"^order[_ ]?date$", r"^date$", r"^invoice[_ ]?date$", r"^transaction[_ ]?date$", r"^created([_ ]?at|[_ ]?date)?$", r"date"]


def match_column(columns: List[str], patterns: List[str], *, exclude: Optional[List[str]] = None) -> Optional[str]:
    exclude = {e.lower() for e in (exclude or [])}
    pool = [c for c in columns if c.lower() not in exclude]
    for pattern in patterns:
        rx = re.compile(pattern, re.I)
        for col in pool:
            if rx.search(str(col).strip().lower().replace(" ", "_")):
                return col
    return None


@dataclass
class ColumnMap:
    """Resolved semantic roles. ``None`` means 'this dataset does not have it'."""

    table: str
    date: Optional[str] = None
    revenue: Optional[str] = None
    cost: Optional[str] = None
    profit: Optional[str] = None
    quantity: Optional[str] = None
    price: Optional[str] = None
    discount: Optional[str] = None
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    product_id: Optional[str] = None
    product_name: Optional[str] = None
    category: Optional[str] = None
    region: Optional[str] = None
    channel: Optional[str] = None
    order_id: Optional[str] = None
    stock: Optional[str] = None
    reorder_point: Optional[str] = None
    lead_time: Optional[str] = None
    status: Optional[str] = None

    def present(self) -> Dict[str, str]:
        return {k: v for k, v in self.__dict__.items() if v and k != "table"}


def resolve_columns(frame: pd.DataFrame, profile: Dict[str, Any], table: str) -> ColumnMap:
    cols = [str(c) for c in frame.columns]
    numeric = set(profile.get("numeric_columns", []))
    dates = profile.get("date_columns", [])

    def num(patterns: List[str], exclude: Optional[List[str]] = None) -> Optional[str]:
        candidates = [c for c in cols if c in numeric]
        return match_column(candidates, patterns, exclude=exclude)

    def any_col(patterns: List[str]) -> Optional[str]:
        return match_column(cols, patterns)

    date_col = match_column(dates, DATE_PATTERNS) or (dates[0] if dates else None)
    revenue = num(REVENUE_PATTERNS)
    cost = num(COST_PATTERNS, exclude=[revenue] if revenue else None)
    profit = num(PROFIT_PATTERNS, exclude=[c for c in (revenue, cost) if c])
    quantity = num(QTY_PATTERNS, exclude=[c for c in (revenue, cost, profit) if c])
    price = num(PRICE_PATTERNS, exclude=[c for c in (revenue, cost, profit, quantity) if c])
    stock = num(STOCK_PATTERNS, exclude=[c for c in (quantity,) if c])

    return ColumnMap(
        table=table,
        date=date_col,
        revenue=revenue,
        cost=cost,
        profit=profit,
        quantity=quantity,
        price=price,
        discount=num(DISCOUNT_PATTERNS),
        customer_id=any_col(CUSTOMER_ID_PATTERNS),
        customer_name=any_col(CUSTOMER_NAME_PATTERNS),
        product_id=any_col(PRODUCT_ID_PATTERNS),
        product_name=any_col(PRODUCT_NAME_PATTERNS),
        category=any_col(CATEGORY_PATTERNS),
        region=any_col(REGION_PATTERNS),
        channel=any_col(CHANNEL_PATTERNS),
        order_id=any_col(ORDER_ID_PATTERNS),
        stock=stock,
        reorder_point=num(REORDER_PATTERNS),
        lead_time=num(LEADTIME_PATTERNS),
        status=any_col(STATUS_PATTERNS),
    )


@dataclass
class AnalysisContext:
    prompt: str
    frames: Dict[str, pd.DataFrame]
    profiles: Dict[str, Dict[str, Any]]
    model: Dict[str, Any]
    quality: Dict[str, Any] = field(default_factory=dict)
    plan: Dict[str, Any] = field(default_factory=dict)
    columns: Dict[str, ColumnMap] = field(default_factory=dict)
    notes: List[str] = field(default_factory=list)

    @property
    def primary_table(self) -> str:
        fact = self.model.get("fact_table")
        if fact and fact in self.frames:
            return fact
        return next(iter(self.frames))

    @property
    def primary_frame(self) -> pd.DataFrame:
        return self.frames[self.primary_table]

    @property
    def primary_columns(self) -> ColumnMap:
        return self.columns[self.primary_table]

    def profile(self, table: Optional[str] = None) -> Dict[str, Any]:
        return self.profiles[table or self.primary_table]

    def schema_summary(self) -> List[Dict[str, Any]]:
        """Compact schema handed to the LLM so it can never invent names."""
        out = []
        for name, prof in self.profiles.items():
            out.append(
                {
                    "table": name,
                    "rows": prof.get("row_count"),
                    "columns": [
                        {"name": c["name"], "type": c["semantic_type"], "nulls_pct": c["null_pct"]}
                        for c in prof.get("columns", [])
                    ],
                    "date_range": prof.get("date_range"),
                }
            )
        return out


def build_context(
    prompt: str,
    frames: Dict[str, pd.DataFrame],
    profiles: Dict[str, Dict[str, Any]],
    model: Dict[str, Any],
    quality: Dict[str, Any],
) -> AnalysisContext:
    columns = {name: resolve_columns(frames[name], profiles[name], name) for name in frames}
    return AnalysisContext(
        prompt=prompt, frames=frames, profiles=profiles, model=model, quality=quality, columns=columns
    )
