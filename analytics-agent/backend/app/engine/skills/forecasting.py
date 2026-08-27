"""Forecasting skill.

Uses Holt-Winters exponential smoothing when there is enough history,
otherwise a linear (OLS) projection, otherwise reports NOT_SUPPORTED.
Never extrapolates from fewer than 6 observed periods.
"""
from __future__ import annotations

import warnings
from typing import Any, Dict, List

import numpy as np
import pandas as pd
from scipy import stats as sps

from ..context import AnalysisContext
from ..metrics import MetricRegistry
from .base import Applicability, Skill, safe_float

MIN_PERIODS_LINEAR = 6
MIN_PERIODS_SEASONAL = 24


class ForecastingSkill(Skill):
    key = "forecasting"
    title = "Forecasting"
    keywords = ("forecast", "predict", "projection", "outlook", "next month", "next quarter", "future", "trend ahead", "seasonality")
    domains = ("sales", "inventory", "finance")

    def applicability(self, ctx: AnalysisContext) -> Applicability:
        cm = ctx.primary_columns
        if not cm.date:
            return Applicability(
                False,
                reason="Forecasting requires a date column; none was detected.",
                alternative="Include a transaction/order date column to enable forecasting.",
            )
        measure = cm.revenue or cm.quantity
        if not measure:
            return Applicability(
                False,
                reason="Forecasting requires a numeric measure (revenue or quantity).",
                alternative="Include a revenue or quantity column to forecast.",
            )
        series = self._monthly(ctx, measure)
        if len(series) < MIN_PERIODS_LINEAR:
            return Applicability(
                False,
                reason=(
                    f"Only {len(series)} complete month(s) of history are present; at least "
                    f"{MIN_PERIODS_LINEAR} are required for a defensible forecast."
                ),
                alternative="Historical trend is reported without a forward projection.",
            )
        return Applicability(True, confidence=0.9 if len(series) >= MIN_PERIODS_SEASONAL else 0.6)

    @staticmethod
    def _monthly(ctx: AnalysisContext, measure: str) -> pd.Series:
        frame = ctx.primary_frame
        cm = ctx.primary_columns
        work = pd.DataFrame(
            {"d": pd.to_datetime(frame[cm.date], errors="coerce"), "v": pd.to_numeric(frame[measure], errors="coerce")}
        ).dropna()
        if work.empty:
            return pd.Series(dtype=float)
        return work.set_index("d")["v"].resample("MS").sum().sort_index()

    def run(self, ctx: AnalysisContext, registry: MetricRegistry) -> Dict[str, Any]:
        cm = ctx.primary_columns
        table = ctx.primary_table
        measure = cm.revenue or cm.quantity
        series = self._monthly(ctx, measure)
        horizon = 3 if len(series) < 12 else 6
        unit = "currency" if measure == cm.revenue else "number"

        method, points, meta = self._forecast(series, horizon)
        if not points:
            registry.mark_unsupported(
                "Forward forecast",
                "The observed history could not produce a stable projection.",
                "Historical trend metrics are reported instead.",
            )
            return {"method": "none"}

        registry.register(
            f"{measure.title()} Forecast (next {horizon} months)",
            points,
            metric_id="forecast_series",
            definition=(
                f"{horizon}-month projection of monthly {measure} using {method}, fitted on "
                f"{len(series)} observed months ({series.index.min().date()} → {series.index.max().date()})."
            ),
            formula=f"{method} on monthly SUM({table}[{measure}])",
            source=self.source(
                table, [measure, cm.date], int(ctx.primary_frame.shape[0]),
                {"method": method, "observed_periods": int(len(series)), "horizon_months": horizon, **meta},
            ),
            unit=unit,
            value_type="series",
            period=f"{points[0]['period']} → {points[-1]['period']}",
            skill=self.key,
        )

        total = sum(p["value"] for p in points if p.get("value") is not None)
        registry.register(
            f"Forecast Total (next {horizon} months)",
            safe_float(total),
            metric_id="forecast_total",
            definition=f"Sum of the {horizon}-month projection produced by {method}.",
            formula="SUM(forecast points)",
            source=self.source(table, [measure, cm.date], int(ctx.primary_frame.shape[0]), {"method": method}),
            unit=unit,
            skill=self.key,
        )

        recent = float(series.tail(horizon).sum())
        if recent:
            registry.register(
                "Forecast vs Recent Actuals %",
                safe_float((total - recent) / abs(recent) * 100),
                metric_id="forecast_vs_recent_pct",
                definition=(
                    f"Projected next {horizon} months versus the most recent {horizon} observed months."
                ),
                formula="DIVIDE(forecast_total - recent_actual_total, recent_actual_total)",
                source=self.source(table, [measure, cm.date], int(ctx.primary_frame.shape[0]), {"recent_actual": safe_float(recent)}),
                unit="percent",
                skill=self.key,
            )

        return {"method": method, "horizon": horizon, "observed_periods": int(len(series)), **meta}

    def _forecast(self, series: pd.Series, horizon: int):
        values = series.values.astype(float)
        index = series.index
        meta: Dict[str, Any] = {}

        if len(series) >= MIN_PERIODS_SEASONAL:
            try:
                from statsmodels.tsa.holtwinters import ExponentialSmoothing

                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    model = ExponentialSmoothing(
                        series, trend="add", seasonal="add", seasonal_periods=12, initialization_method="estimated"
                    ).fit(optimized=True)
                    prediction = model.forecast(horizon)
                    fitted = model.fittedvalues
                residuals = values - np.asarray(fitted, dtype=float)
                mape = float(np.mean(np.abs(residuals / np.where(values == 0, np.nan, values))) * 100)
                sigma = float(np.std(residuals))
                meta = {"in_sample_mape_pct": safe_float(mape), "residual_sigma": safe_float(sigma)}
                points = [
                    {
                        "period": ts.strftime("%Y-%m-%d"),
                        "value": safe_float(v),
                        "lower": safe_float(v - 1.96 * sigma),
                        "upper": safe_float(v + 1.96 * sigma),
                    }
                    for ts, v in prediction.items()
                ]
                return "Holt-Winters exponential smoothing (additive trend + 12-month seasonality)", points, meta
            except Exception:  # noqa: BLE001 - fall through to linear
                pass

        if len(series) < MIN_PERIODS_LINEAR:
            return "none", [], meta

        x = np.arange(len(values), dtype=float)
        slope, intercept, r_value, p_value, std_err = sps.linregress(x, values)
        residuals = values - (slope * x + intercept)
        sigma = float(np.std(residuals))
        meta = {
            "r_squared": safe_float(r_value ** 2),
            "p_value": safe_float(p_value),
            "residual_sigma": safe_float(sigma),
        }
        future_index = pd.date_range(index[-1] + pd.offsets.MonthBegin(1), periods=horizon, freq="MS")
        points = []
        for step, ts in enumerate(future_index, start=1):
            v = slope * (len(values) - 1 + step) + intercept
            points.append(
                {
                    "period": ts.strftime("%Y-%m-%d"),
                    "value": safe_float(max(v, 0.0)),
                    "lower": safe_float(max(v - 1.96 * sigma, 0.0)),
                    "upper": safe_float(v + 1.96 * sigma),
                }
            )
        return "ordinary least squares linear trend", points, meta
