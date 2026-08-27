"""Metric registry — the single source of truth.

Every number that reaches the report, the DAX layer or the dashboard PNG must
come from a registered ``Metric``. Nothing downstream is allowed to recompute
or restate a value, which is what keeps Report / PNG / DAX reconciled.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, Iterable, List, Optional

VALID = "valid"
UNVERIFIED = "unverified"
FAILED = "failed"
NOT_SUPPORTED = "not_supported"


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", str(text).strip().lower()).strip("_")
    return slug or "metric"


def _clean_number(value: Any) -> Any:
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return round(value, 6)
    return value


@dataclass
class Metric:
    metric_id: str
    name: str
    definition: str
    formula: str
    value: Any
    source: Dict[str, Any] = field(default_factory=dict)
    grain: str = ""
    filters: List[str] = field(default_factory=list)
    period: Optional[str] = None
    unit: str = "number"  # number | currency | percent | days | ratio
    value_type: str = "scalar"  # scalar | series | table
    skill: str = "core"
    validation_status: str = UNVERIFIED
    validation_notes: List[str] = field(default_factory=list)
    display_value: str = ""

    def __post_init__(self) -> None:
        self.value = _clean_number(self.value)
        if not self.display_value:
            self.display_value = format_value(self.value, self.unit, self.value_type)

    def as_row(self) -> Dict[str, Any]:
        return {
            "metric_id": self.metric_id,
            "name": self.name,
            "definition": self.definition,
            "formula": self.formula,
            "value": {
                "value": self.value,
                "unit": self.unit,
                "value_type": self.value_type,
                "display": self.display_value,
                "period": self.period,
            },
            "source": {
                **self.source,
                "grain": self.grain,
                "filters": self.filters,
                "skill": self.skill,
            },
            "validation_status": self.validation_status,
        }

    def as_dict(self) -> Dict[str, Any]:
        return asdict(self)


def format_value(value: Any, unit: str, value_type: str = "scalar") -> str:
    if value is None:
        return "n/a"
    if value_type != "scalar":
        if isinstance(value, list):
            return f"{len(value)} points"
        return "series"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)[:60]

    if unit == "percent":
        return f"{number:,.1f}%"
    if unit == "currency":
        return _compact_currency(number)
    if unit == "days":
        return f"{number:,.1f} days"
    if unit == "ratio":
        return f"{number:,.2f}x"
    if abs(number) >= 1000 and float(number).is_integer():
        return f"{int(number):,}"
    if abs(number) >= 1000:
        return f"{number:,.0f}"
    if float(number).is_integer():
        return f"{int(number):,}"
    return f"{number:,.2f}"


def _compact_currency(number: float) -> str:
    sign = "-" if number < 0 else ""
    n = abs(number)
    if n >= 1_000_000_000:
        return f"{sign}{n / 1_000_000_000:.2f}B"
    if n >= 1_000_000:
        return f"{sign}{n / 1_000_000:.2f}M"
    if n >= 1_000:
        return f"{sign}{n / 1_000:.1f}K"
    return f"{sign}{n:,.2f}"


class MetricRegistry:
    """Ordered, de-duplicated collection of metrics for one analysis run."""

    def __init__(self) -> None:
        self._metrics: Dict[str, Metric] = {}
        self._unsupported: List[Dict[str, Any]] = []

    # -- writes ------------------------------------------------------------
    def add(self, metric: Metric) -> Metric:
        base = metric.metric_id
        suffix = 2
        while metric.metric_id in self._metrics:
            metric.metric_id = f"{base}_{suffix}"
            suffix += 1
        self._metrics[metric.metric_id] = metric
        return metric

    def register(
        self,
        name: str,
        value: Any,
        *,
        definition: str,
        formula: str,
        source: Dict[str, Any],
        unit: str = "number",
        value_type: str = "scalar",
        grain: str = "",
        filters: Optional[List[str]] = None,
        period: Optional[str] = None,
        skill: str = "core",
        metric_id: Optional[str] = None,
    ) -> Metric:
        return self.add(
            Metric(
                metric_id=metric_id or slugify(name),
                name=name,
                definition=definition,
                formula=formula,
                value=value,
                source=source,
                unit=unit,
                value_type=value_type,
                grain=grain,
                filters=filters or [],
                period=period,
                skill=skill,
            )
        )

    _UNSUPPORTED_NOISE = {
        "rate", "ratio", "percent", "percentage", "pct", "analysis", "metric",
        "metrics", "report", "the", "a", "an", "of", "by", "per", "for",
    }

    @classmethod
    def _unsupported_key(cls, requested: str) -> frozenset:
        words = {w.strip(".,;:()").lower() for w in str(requested).split()}
        return frozenset(w for w in words if w and w not in cls._UNSUPPORTED_NOISE)

    def mark_unsupported(self, requested: str, reason: str, alternative: str = "") -> None:
        """
        Record an explicitly unsupported request instead of fabricating it.

        The planner and the individual skills can independently decline the same
        thing (for example "customer churn" and "contractual customer churn
        rate"). Report it once: if one phrasing's significant words are a subset
        of another's, they are the same refusal, and the entry carrying the
        fuller explanation is kept.
        """
        key = self._unsupported_key(requested)
        for existing in self._unsupported:
            existing_key = self._unsupported_key(existing["requested"])
            if not key or not existing_key:
                continue
            if key <= existing_key or existing_key <= key:
                # Keep whichever phrasing explains itself best.
                if len(reason) > len(existing.get("reason", "")):
                    existing["requested"] = requested
                    existing["reason"] = reason
                if alternative and not existing.get("alternative"):
                    existing["alternative"] = alternative
                return
        self._unsupported.append(
            {"requested": requested, "status": NOT_SUPPORTED, "reason": reason, "alternative": alternative}
        )

    # -- reads -------------------------------------------------------------
    def get(self, metric_id: str) -> Optional[Metric]:
        return self._metrics.get(metric_id)

    def require(self, metric_id: str) -> Metric:
        metric = self._metrics.get(metric_id)
        if metric is None:
            raise KeyError(f"metric '{metric_id}' is not registered")
        return metric

    def all(self) -> List[Metric]:
        return list(self._metrics.values())

    def scalars(self) -> List[Metric]:
        return [m for m in self._metrics.values() if m.value_type == "scalar" and m.value is not None]

    def by_skill(self, skill: str) -> List[Metric]:
        return [m for m in self._metrics.values() if m.skill == skill]

    def headline(self, limit: int = 6) -> List[Metric]:
        priority = [
            "total_revenue", "gross_revenue", "net_revenue", "total_sales", "total_orders",
            "order_count", "unique_customers", "average_order_value", "revenue_growth_pct",
            "gross_margin_pct", "total_quantity", "total_units",
        ]
        picked: List[Metric] = []
        for key in priority:
            metric = self._metrics.get(key)
            if metric and metric.value_type == "scalar" and metric.value is not None:
                picked.append(metric)
            if len(picked) >= limit:
                return picked
        for metric in self.scalars():
            if metric not in picked:
                picked.append(metric)
            if len(picked) >= limit:
                break
        return picked

    @property
    def unsupported(self) -> List[Dict[str, Any]]:
        return list(self._unsupported)

    def to_rows(self) -> List[Dict[str, Any]]:
        return [m.as_row() for m in self._metrics.values()]

    def to_context(self, include_series: bool = False) -> List[Dict[str, Any]]:
        """Compact view handed to the LLM. Values only, never raw records."""
        out: List[Dict[str, Any]] = []
        for m in self._metrics.values():
            if m.value_type != "scalar" and not include_series:
                out.append(
                    {
                        "metric_id": m.metric_id,
                        "name": m.name,
                        "type": m.value_type,
                        "definition": m.definition,
                        "points": len(m.value) if isinstance(m.value, list) else None,
                        "top": (m.value[:5] if isinstance(m.value, list) else None),
                    }
                )
                continue
            out.append(
                {
                    "metric_id": m.metric_id,
                    "name": m.name,
                    "value": m.value,
                    "display": m.display_value,
                    "unit": m.unit,
                    "definition": m.definition,
                    "period": m.period,
                    "skill": m.skill,
                }
            )
        return out

    def __len__(self) -> int:
        return len(self._metrics)

    def __iter__(self) -> Iterable[Metric]:
        return iter(self._metrics.values())
