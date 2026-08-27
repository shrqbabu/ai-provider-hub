"""Skill framework.

A skill is a deterministic analytical capability. It declares whether the
current dataset can support it, then writes metrics into the registry. Skills
never write prose and never guess values.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from ..context import AnalysisContext, ColumnMap
from ..metrics import Metric, MetricRegistry


@dataclass
class Applicability:
    supported: bool
    reason: str = ""
    alternative: str = ""
    confidence: float = 1.0


class Skill:
    key: str = "skill"
    title: str = "Skill"
    keywords: Tuple[str, ...] = ()
    domains: Tuple[str, ...] = ()

    def applicability(self, ctx: AnalysisContext) -> Applicability:  # pragma: no cover - overridden
        raise NotImplementedError

    def run(self, ctx: AnalysisContext, registry: MetricRegistry) -> Dict[str, Any]:  # pragma: no cover
        raise NotImplementedError

    # -- helpers -----------------------------------------------------------
    @staticmethod
    def source(table: str, columns: List[Optional[str]], rows: int, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        payload = {"table": table, "columns": [c for c in columns if c], "rows_used": int(rows)}
        if extra:
            payload.update(extra)
        return payload


def safe_float(value: Any) -> Optional[float]:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def pct(numerator: Optional[float], denominator: Optional[float]) -> Optional[float]:
    n, d = safe_float(numerator), safe_float(denominator)
    if n is None or d in (None, 0):
        return None
    return n / d * 100.0


def growth_pct(current: Optional[float], previous: Optional[float]) -> Optional[float]:
    c, p = safe_float(current), safe_float(previous)
    if c is None or p is None or p == 0:
        return None
    return (c - p) / abs(p) * 100.0


def top_n(frame: pd.DataFrame, group: str, measure: str, n: int = 10, ascending: bool = False) -> List[Dict[str, Any]]:
    if group not in frame.columns or measure not in frame.columns:
        return []
    grouped = (
        frame.dropna(subset=[group])
        .groupby(frame[group].astype(str), dropna=True)[measure]
        .sum()
        .sort_values(ascending=ascending)
        .head(n)
    )
    return [{"label": str(k)[:60], "value": safe_float(v)} for k, v in grouped.items()]


def period_series(frame: pd.DataFrame, date_col: str, measure: str, freq: str = "ME") -> List[Dict[str, Any]]:
    if date_col not in frame.columns or measure not in frame.columns:
        return []
    work = frame[[date_col, measure]].dropna(subset=[date_col])
    if work.empty:
        return []
    work[date_col] = pd.to_datetime(work[date_col], errors="coerce")
    work = work.dropna(subset=[date_col])
    if work.empty:
        return []
    grouped = work.set_index(date_col)[measure].resample(freq).sum().sort_index()
    observed_max = work[date_col].max()
    points = [
        {"period": idx.strftime("%Y-%m-%d"), "value": safe_float(val)}
        for idx, val in grouped.items()
    ]
    return drop_incomplete_tail(points, observed_max, freq)


def drop_incomplete_tail(points, observed_max, freq: str):
    """Remove a trailing period the data does not fully cover.

    Resampling always emits the bucket containing the last observation even when
    only a few days of it exist, which would show up as a fake collapse in the
    trend and a fake negative growth rate. Only complete periods are reported.
    """
    if not points or observed_max is None:
        return points
    try:
        offset = pd.tseries.frequencies.to_offset(freq)
        last_label = pd.Timestamp(points[-1]["period"])
        period_end = last_label if offset.is_on_offset(last_label) else last_label + offset
        # `resample` labels months/quarters at their period end, days/weeks at their start.
        if freq.upper().startswith(("D", "W")):
            period_end = last_label + offset - pd.Timedelta(days=1)
        if pd.Timestamp(observed_max).normalize() < pd.Timestamp(period_end).normalize():
            if len(points) > 2:
                trimmed = points[:-1]
                trimmed[-1] = dict(trimmed[-1])
                return trimmed
    except Exception:  # noqa: BLE001 - never fail the run over a cosmetic trim
        return points
    return points


def count_series(frame: pd.DataFrame, date_col: str, freq: str = "ME") -> List[Dict[str, Any]]:
    if date_col not in frame.columns:
        return []
    work = frame[[date_col]].dropna()
    if work.empty:
        return []
    work[date_col] = pd.to_datetime(work[date_col], errors="coerce")
    work = work.dropna()
    observed_max = work[date_col].max()
    grouped = work.set_index(date_col).resample(freq).size().sort_index()
    points = [{"period": idx.strftime("%Y-%m-%d"), "value": int(val)} for idx, val in grouped.items()]
    return drop_incomplete_tail(points, observed_max, freq)


def choose_freq(frame: pd.DataFrame, date_col: str) -> Tuple[str, str]:
    """Pick a sensible resampling frequency from the observed date span."""
    series = pd.to_datetime(frame[date_col], errors="coerce").dropna()
    if series.empty:
        return "ME", "month"
    span_days = (series.max() - series.min()).days
    if span_days <= 45:
        return "D", "day"
    if span_days <= 90:
        return "W", "week"
    if span_days <= 1500:
        return "ME", "month"
    return "QE", "quarter"


def split_periods(series: List[Dict[str, Any]]) -> Tuple[Optional[float], Optional[float]]:
    """Last complete period vs the one before it."""
    values = [p["value"] for p in series if p.get("value") is not None]
    if len(values) < 2:
        return (values[-1] if values else None), None
    return values[-1], values[-2]


def concentration(values: List[float]) -> Optional[float]:
    """Share of total held by the top 20% of contributors (Pareto check)."""
    clean = sorted([v for v in values if safe_float(v) is not None and v > 0], reverse=True)
    if not clean:
        return None
    total = sum(clean)
    if total <= 0:
        return None
    cutoff = max(1, int(round(len(clean) * 0.2)))
    return sum(clean[:cutoff]) / total * 100.0
