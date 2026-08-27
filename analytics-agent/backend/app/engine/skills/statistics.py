"""Statistical analysis skill — distributions, correlation, variance, outliers.

Correlation is reported as association only. Causal language is forbidden and
the validator rejects it downstream.
"""
from __future__ import annotations

from typing import Any, Dict, List

import numpy as np
import pandas as pd
from scipy import stats as sps

from ..context import AnalysisContext
from ..metrics import MetricRegistry
from .base import Applicability, Skill, safe_float


class StatisticsSkill(Skill):
    key = "statistics"
    title = "Statistical Analysis"
    keywords = ("statistic", "correlation", "distribution", "variance", "outlier", "significance", "confidence", "std", "deviation")
    domains = ()

    def applicability(self, ctx: AnalysisContext) -> Applicability:
        numeric = ctx.profile().get("numeric_columns", [])
        if len(numeric) >= 1 and ctx.profile().get("row_count", 0) >= 10:
            return Applicability(True)
        return Applicability(
            False,
            reason="Statistical analysis needs at least one numeric column and 10+ rows.",
            alternative="Upload a dataset with numeric measures for distribution and correlation analysis.",
        )

    def run(self, ctx: AnalysisContext, registry: MetricRegistry) -> Dict[str, Any]:
        table = ctx.primary_table
        frame = ctx.primary_frame
        prof = ctx.profile()
        rows = len(frame)
        numeric_cols: List[str] = [c for c in prof.get("numeric_columns", []) if c in frame.columns][:12]
        result: Dict[str, Any] = {"numeric_columns": numeric_cols}

        distributions: List[Dict[str, Any]] = []
        for col in numeric_cols:
            series = pd.to_numeric(frame[col], errors="coerce").dropna()
            if len(series) < 10:
                continue
            q1, q3 = series.quantile(0.25), series.quantile(0.75)
            iqr = q3 - q1
            outliers = int(((series < q1 - 1.5 * iqr) | (series > q3 + 1.5 * iqr)).sum()) if iqr > 0 else 0
            distributions.append(
                {
                    "column": col,
                    "count": int(len(series)),
                    "mean": safe_float(series.mean()),
                    "median": safe_float(series.median()),
                    "std": safe_float(series.std()),
                    "cv_pct": safe_float(series.std() / series.mean() * 100) if series.mean() else None,
                    "p05": safe_float(series.quantile(0.05)),
                    "p95": safe_float(series.quantile(0.95)),
                    "skewness": safe_float(sps.skew(series)) if len(series) > 2 else None,
                    "kurtosis": safe_float(sps.kurtosis(series)) if len(series) > 3 else None,
                    "outliers_iqr": outliers,
                }
            )

        if distributions:
            registry.register(
                "Numeric Distributions",
                distributions,
                metric_id="numeric_distributions",
                definition="Descriptive statistics (mean, median, dispersion, skew, IQR outliers) per numeric column.",
                formula="pandas/scipy descriptive statistics",
                source=self.source(table, numeric_cols, rows),
                unit="number",
                value_type="table",
                skill=self.key,
            )
            most_volatile = max(
                (d for d in distributions if d["cv_pct"] is not None), key=lambda d: d["cv_pct"], default=None
            )
            if most_volatile:
                registry.register(
                    f"Coefficient of Variation — {most_volatile['column']}",
                    most_volatile["cv_pct"],
                    metric_id="highest_cv_pct",
                    definition=(
                        f"Standard deviation divided by mean for '{most_volatile['column']}' — the most dispersed "
                        "numeric column in the dataset."
                    ),
                    formula="DIVIDE(STDEV.P(column), AVERAGE(column))",
                    source=self.source(table, [most_volatile["column"]], rows),
                    unit="percent",
                    skill=self.key,
                )

        # Correlations
        if len(numeric_cols) >= 2:
            numeric_frame = frame[numeric_cols].apply(pd.to_numeric, errors="coerce").dropna()
            if len(numeric_frame) >= 10:
                corr = numeric_frame.corr(method="pearson")
                pairs: List[Dict[str, Any]] = []
                for i, a in enumerate(corr.columns):
                    for b in corr.columns[i + 1 :]:
                        r = safe_float(corr.loc[a, b])
                        if r is None:
                            continue
                        n = len(numeric_frame)
                        p_value = None
                        if n > 3 and abs(r) < 1:
                            try:
                                p_value = safe_float(sps.pearsonr(numeric_frame[a], numeric_frame[b])[1])
                            except Exception:  # noqa: BLE001
                                p_value = None
                        pairs.append(
                            {
                                "a": a,
                                "b": b,
                                "r": round(r, 4),
                                "strength": _strength(r),
                                "p_value": p_value,
                                "significant_at_05": (p_value is not None and p_value < 0.05),
                                "n": n,
                            }
                        )
                pairs.sort(key=lambda p: abs(p["r"]), reverse=True)
                if pairs:
                    registry.register(
                        "Correlation Matrix (top pairs)",
                        pairs[:15],
                        metric_id="correlations",
                        definition=(
                            "Pearson correlation between numeric columns with two-sided p-values. "
                            "Association only — does not establish causation."
                        ),
                        formula="Pearson r over complete cases",
                        source=self.source(table, numeric_cols, len(numeric_frame), {"method": "pearson", "complete_cases": len(numeric_frame)}),
                        unit="ratio",
                        value_type="table",
                        skill=self.key,
                    )
                    result["strongest_pair"] = pairs[0]

        # Trend significance on the primary measure
        cm = ctx.primary_columns
        measure = cm.revenue or (numeric_cols[0] if numeric_cols else None)
        if cm.date and measure:
            work = pd.DataFrame(
                {"d": pd.to_datetime(frame[cm.date], errors="coerce"), "v": pd.to_numeric(frame[measure], errors="coerce")}
            ).dropna()
            if len(work) >= 12:
                monthly = work.set_index("d")["v"].resample("ME").sum()
                if len(monthly) >= 4:
                    x = np.arange(len(monthly), dtype=float)
                    slope, intercept, r_value, p_value, std_err = sps.linregress(x, monthly.values.astype(float))
                    registry.register(
                        "Trend Slope (per period)",
                        safe_float(slope),
                        metric_id="trend_slope",
                        definition=(
                            f"OLS slope of monthly {measure} over {len(monthly)} periods. "
                            f"R²={r_value ** 2:.3f}, p={p_value:.4f}."
                        ),
                        formula="linregress(period_index, monthly_total)",
                        source=self.source(
                            table, [measure, cm.date], rows,
                            {"r_squared": safe_float(r_value ** 2), "p_value": safe_float(p_value), "periods": len(monthly)},
                        ),
                        unit="number",
                        skill=self.key,
                    )
                    result["trend_significant"] = bool(p_value < 0.05)

        return result


def _strength(r: float) -> str:
    a = abs(r)
    if a >= 0.8:
        return "very strong"
    if a >= 0.6:
        return "strong"
    if a >= 0.4:
        return "moderate"
    if a >= 0.2:
        return "weak"
    return "negligible"
