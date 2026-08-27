"""Premium dashboard PNG renderer.

Renders a single high-resolution PNG from **registry values only**. Every
number drawn is recorded in ``rendered_values`` so the validator can reconcile
the image against the metric registry (this is what stops the report and the
PNG disagreeing).

Explicitly out of scope: PBIX, PBIT, interactive dashboards, Power BI
publishing. The output is one static image.
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import matplotlib

matplotlib.use("Agg")

import matplotlib.dates as mdates  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.gridspec import GridSpec  # noqa: E402
from matplotlib.patches import FancyBboxPatch  # noqa: E402

from .context import AnalysisContext  # noqa: E402
from .metrics import Metric, MetricRegistry  # noqa: E402


@dataclass
class Theme:
    name: str = "executive_light"
    bg: str = "#F4F6FA"
    panel: str = "#FFFFFF"
    ink: str = "#0F172A"
    ink_soft: str = "#64748B"
    grid: str = "#E2E8F0"
    accent: str = "#1D4ED8"
    accent_soft: str = "#93B4FD"
    positive: str = "#047857"
    negative: str = "#B91C1C"
    warning: str = "#B45309"
    series: Tuple[str, ...] = (
        "#1D4ED8", "#0EA5E9", "#7C3AED", "#059669", "#D97706", "#DB2777", "#0891B2", "#65A30D",
    )


DARK = Theme(
    name="executive_dark",
    bg="#0B1120",
    panel="#131C31",
    ink="#F8FAFC",
    ink_soft="#94A3B8",
    grid="#1E293B",
    accent="#60A5FA",
    accent_soft="#1E3A8A",
    positive="#34D399",
    negative="#F87171",
    warning="#FBBF24",
    series=("#60A5FA", "#38BDF8", "#A78BFA", "#34D399", "#FBBF24", "#F472B6", "#22D3EE", "#A3E635"),
)


@dataclass
class RenderResult:
    png_bytes: bytes
    width: int
    height: int
    dpi: int
    rendered_values: List[Dict[str, Any]] = field(default_factory=list)
    panels: List[str] = field(default_factory=list)
    theme: str = "executive_light"
    title: str = ""
    subtitle: str = ""
    date_range: Optional[str] = None


def _wants_dark(prompt: str) -> bool:
    return bool(re.search(r"\bdark(\s|-)?(mode|theme|background)\b", prompt or "", re.I))


def _requested(prompt: str, *patterns: str) -> bool:
    text = (prompt or "").lower()
    return any(re.search(p, text) for p in patterns)


def _rounded_panel(
    ax,
    theme: Theme,
    *,
    radius: float = 0.018,
    pad_left: float = 0.0,
    pad_right: float = 0.0,
    pad_top: float = 0.0,
    pad_bottom: float = 0.0,
) -> None:
    """Draw the card behind an axes. Padding extends the card so that axis tick
    labels and the panel title sit *inside* the card rather than floating on the
    page background."""
    ax.set_facecolor("none")
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.patch.set_visible(False)
    ax.set_zorder(3)
    bbox = ax.get_position()
    fig = ax.figure
    patch = FancyBboxPatch(
        (bbox.x0 - pad_left, bbox.y0 - pad_bottom),
        bbox.width + pad_left + pad_right,
        bbox.height + pad_bottom + pad_top,
        boxstyle=f"round,pad=0,rounding_size={radius}",
        transform=fig.transFigure,
        facecolor=theme.panel,
        edgecolor=theme.grid,
        linewidth=1.0,
        zorder=-5,
        mutation_aspect=fig.get_figwidth() / fig.get_figheight(),
    )
    patch.set_clip_on(False)
    fig.patches.append(patch)


# Padding presets (figure fractions) for the different card types.
CHART_PAD = {"pad_left": 0.031, "pad_right": 0.013, "pad_top": 0.055, "pad_bottom": 0.052}
FLAT_PAD = {"pad_left": 0.012, "pad_right": 0.013, "pad_top": 0.052, "pad_bottom": 0.026}
KPI_PAD = {"pad_left": 0.006, "pad_right": 0.006, "pad_top": 0.006, "pad_bottom": 0.006}


def _fmt_axis_value(value: float) -> str:
    a = abs(value)
    if a >= 1_000_000_000:
        return f"{value / 1_000_000_000:.1f}B"
    if a >= 1_000_000:
        return f"{value / 1_000_000:.1f}M"
    if a >= 1_000:
        return f"{value / 1_000:.0f}K"
    if a >= 10:
        return f"{value:.0f}"
    return f"{value:.2f}"


class DashboardRenderer:
    def __init__(self, ctx: AnalysisContext, registry: MetricRegistry, insights: List[Dict[str, Any]]) -> None:
        self.ctx = ctx
        self.registry = registry
        self.insights = insights
        self.theme = DARK if _wants_dark(ctx.prompt) else Theme()
        self.rendered: List[Dict[str, Any]] = []
        self.panels: List[str] = []

    # -- value recording ---------------------------------------------------
    def _record(self, metric: Optional[Metric], displayed: str, element: str, label: str = "") -> None:
        self.rendered.append(
            {
                "element": element,
                "label": label or (metric.name if metric else ""),
                "displayed": displayed,
                "metric_id": metric.metric_id if metric else None,
                "source_display": metric.display_value if metric else None,
            }
        )

    # -- panel builders ----------------------------------------------------
    def _kpi_card(self, ax, metric: Metric, delta: Optional[Metric] = None) -> None:
        t = self.theme
        _rounded_panel(ax, t, **KPI_PAD)
        ax.set_xticks([])
        ax.set_yticks([])
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1)

        ax.text(0.07, 0.74, metric.name.upper()[:34], color=t.ink_soft, fontsize=10.5, fontweight="bold")
        value_text = metric.display_value
        size = 30 if len(value_text) <= 8 else (25 if len(value_text) <= 12 else 20)
        ax.text(0.07, 0.36, value_text, color=t.ink, fontsize=size, fontweight="bold", va="center")
        self._record(metric, value_text, "kpi_card")

        if delta and delta.value is not None:
            positive = delta.value >= 0
            colour = t.positive if positive else t.negative
            arrow = "▲" if positive else "▼"
            txt = f"{arrow} {abs(delta.value):.1f}%  vs prior period"
            ax.text(0.07, 0.13, txt, color=colour, fontsize=11, fontweight="bold")
            self._record(delta, f"{abs(delta.value):.1f}%", "kpi_delta", delta.name)
        elif metric.period:
            ax.text(0.07, 0.13, str(metric.period)[:40], color=t.ink_soft, fontsize=9.5)

    def _line_panel(self, ax, metric: Metric, title: str) -> None:
        t = self.theme
        _rounded_panel(ax, t, **CHART_PAD)
        points = [p for p in metric.value if p.get("value") is not None]
        if not points:
            self._empty(ax, "No time series available")
            return
        x = [pd.to_datetime(p["period"]) for p in points]
        y = [float(p["value"]) for p in points]

        ax.plot(x, y, color=t.accent, linewidth=2.6, solid_capstyle="round", zorder=3)
        ax.fill_between(x, y, min(y) * 0.98 if min(y) > 0 else 0, color=t.accent, alpha=0.10, zorder=2)
        ax.scatter([x[-1]], [y[-1]], s=52, color=t.accent, zorder=4, edgecolor=t.panel, linewidth=2)

        last_label = _fmt_axis_value(y[-1])
        ax.annotate(
            last_label,
            (x[-1], y[-1]),
            textcoords="offset points",
            xytext=(-6, 12),
            ha="right",
            fontsize=11,
            fontweight="bold",
            color=t.ink,
        )
        self._record(metric, last_label, "line_last_point", f"{title} — latest")

        ax.set_title(title, color=t.ink, fontsize=13.5, fontweight="bold", loc="left", pad=14)
        self._style_axes(ax, currency=metric.unit == "currency")
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %y"))
        ax.tick_params(axis="x", rotation=0)
        if len(x) > 12:
            ax.xaxis.set_major_locator(mdates.AutoDateLocator(maxticks=8))

    def _forecast_panel(self, ax, actual: Optional[Metric], forecast: Metric, title: str) -> None:
        t = self.theme
        _rounded_panel(ax, t, **CHART_PAD)
        fpoints = [p for p in forecast.value if p.get("value") is not None]
        if not fpoints:
            self._empty(ax, "No forecast available")
            return

        if actual and isinstance(actual.value, list):
            apoints = [p for p in actual.value if p.get("value") is not None][-18:]
            ax.plot(
                [pd.to_datetime(p["period"]) for p in apoints],
                [float(p["value"]) for p in apoints],
                color=t.ink_soft, linewidth=2.2, label="Actual", zorder=3,
            )
        fx = [pd.to_datetime(p["period"]) for p in fpoints]
        fy = [float(p["value"]) for p in fpoints]
        ax.plot(fx, fy, color=t.accent, linewidth=2.6, linestyle="--", label="Forecast", zorder=3)
        if all(p.get("lower") is not None and p.get("upper") is not None for p in fpoints):
            ax.fill_between(
                fx, [p["lower"] for p in fpoints], [p["upper"] for p in fpoints],
                color=t.accent, alpha=0.15, label="95% interval", zorder=2,
            )
        ax.set_title(title, color=t.ink, fontsize=13.5, fontweight="bold", loc="left", pad=14)
        legend = ax.legend(loc="lower left", frameon=False, fontsize=9, ncols=3, borderaxespad=0.2)
        for text in legend.get_texts():
            text.set_color(t.ink_soft)
        self._style_axes(ax, currency=forecast.unit == "currency")
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %y"))
        self._record(forecast, _fmt_axis_value(fy[-1]), "forecast_last_point", f"{title} — final period")

    def _bar_panel(self, ax, metric: Metric, title: str, horizontal: bool = True, limit: int = 8) -> None:
        t = self.theme
        _rounded_panel(ax, t)
        items = [p for p in metric.value if p.get("value") is not None][:limit]
        if not items:
            self._empty(ax, "No breakdown available")
            return
        labels = [str(p["label"])[:26] for p in items]
        values = [float(p["value"]) for p in items]

        if horizontal:
            order = np.argsort(values)
            labels = [labels[i] for i in order]
            values = [values[i] for i in order]
            positions = np.arange(len(values))
            bars = ax.barh(positions, values, color=t.accent, height=0.42, zorder=3)
            ax.bar_label(
                bars, labels=[_fmt_axis_value(v) for v in values], padding=7,
                color=t.ink, fontsize=10.5, fontweight="bold",
            )
            top = max(values) if max(values) > 0 else 1
            ax.set_xlim(0, top * 1.20)
            ax.set_ylim(-0.62, len(values) - 0.30)
            ax.set_yticks([])
            ax.xaxis.set_visible(False)
            ax.grid(False)
            for pos, label in zip(positions, labels):
                ax.text(0, pos + 0.30, label, color=t.ink, fontsize=10.5, va="bottom", ha="left", zorder=4)
        else:
            colours = [t.series[i % len(t.series)] for i in range(len(values))]
            bars = ax.bar(labels, values, color=colours, width=0.62, zorder=3)
            ax.bar_label(bars, labels=[_fmt_axis_value(v) for v in values], padding=5, color=t.ink, fontsize=9.5)
            ax.tick_params(axis="x", colors=t.ink, labelsize=9.5, rotation=20)
            self._style_axes(ax)
        for spine in ax.spines.values():
            spine.set_visible(False)
        ax.set_title(title, color=t.ink, fontsize=13.5, fontweight="bold", loc="left", pad=14)
        for label, value in zip(labels, values):
            self._record(metric, _fmt_axis_value(value), "bar", f"{title} — {label}")

    def _donut_panel(self, ax, metric: Metric, title: str, limit: int = 6) -> None:
        t = self.theme
        _rounded_panel(ax, t, **FLAT_PAD)
        items = [p for p in metric.value if p.get("value") is not None and float(p["value"]) > 0][:limit]
        if not items:
            self._empty(ax, "No composition available")
            return
        labels = [str(p["label"])[:20] for p in items]
        values = [float(p["value"]) for p in items]
        total = sum(values)
        colours = [t.series[i % len(t.series)] for i in range(len(values))]
        wedges, _ = ax.pie(values, colors=colours, startangle=90, wedgeprops={"width": 0.42, "edgecolor": t.panel, "linewidth": 2})
        ax.set_title(title, color=t.ink, fontsize=13.5, fontweight="bold", loc="left", pad=14)
        ax.text(0, 0.08, _fmt_axis_value(total), ha="center", va="center", color=t.ink, fontsize=17, fontweight="bold")
        ax.text(0, -0.16, "TOTAL", ha="center", va="center", color=t.ink_soft, fontsize=9, fontweight="bold")
        legend = ax.legend(
            wedges,
            [f"{l}  {v / total * 100:.1f}%" for l, v in zip(labels, values)],
            loc="center left", bbox_to_anchor=(0.98, 0.5), frameon=False, fontsize=9.5,
        )
        for text in legend.get_texts():
            text.set_color(t.ink_soft)
        for label, value in zip(labels, values):
            self._record(metric, f"{value / total * 100:.1f}%", "donut_share", f"{title} — {label}")

    def _table_panel(self, ax, metric: Metric, title: str, limit: int = 7) -> None:
        t = self.theme
        _rounded_panel(ax, t, **FLAT_PAD)
        ax.set_xticks([]); ax.set_yticks([]); ax.set_xlim(0, 1); ax.set_ylim(0, 1)
        ax.set_title(title, color=t.ink, fontsize=13.5, fontweight="bold", loc="left", pad=14)
        items = [p for p in metric.value if p.get("value") is not None][:limit]
        if not items:
            self._empty(ax, "No rows available")
            return
        top = 0.86
        step = min(0.115, top / max(len(items), 1))
        for idx, item in enumerate(items):
            y = top - idx * step
            ax.text(0.04, y, f"{idx + 1}", color=t.ink_soft, fontsize=10, fontweight="bold")
            ax.text(0.12, y, str(item["label"])[:30], color=t.ink, fontsize=11)
            display = _fmt_axis_value(float(item["value"]))
            ax.text(0.96, y, display, color=t.ink, fontsize=11, fontweight="bold", ha="right")
            self._record(metric, display, "table_row", f"{title} — {item['label']}")
            if idx < len(items) - 1:
                ax.plot([0.04, 0.96], [y - step * 0.45] * 2, color=t.grid, linewidth=0.8)

    def _quality_panel(self, ax) -> None:
        t = self.theme
        _rounded_panel(ax, t, **FLAT_PAD)
        ax.set_xticks([]); ax.set_yticks([]); ax.set_xlim(0, 1); ax.set_ylim(0, 1)
        q = self.ctx.quality
        score = float(q.get("score") or 0)
        ax.set_title("Data Quality", color=t.ink, fontsize=13.5, fontweight="bold", loc="left", pad=14)
        colour = t.positive if score >= 85 else (t.warning if score >= 70 else t.negative)
        ax.text(0.04, 0.66, f"{score:.0f}", color=colour, fontsize=32, fontweight="bold", va="center")
        ax.text(0.30, 0.70, "/100", color=t.ink_soft, fontsize=13, va="center")
        ax.text(0.30, 0.56, str(q.get("grade", "")).upper(), color=t.ink_soft, fontsize=10, fontweight="bold", va="center")
        self.rendered.append(
            {"element": "quality_score", "label": "Data quality score", "displayed": f"{score:.0f}", "metric_id": None, "source_display": f"{score:.0f}"}
        )
        dims = [
            ("Completeness", q.get("completeness", {}).get("score", 0)),
            ("Validity", q.get("validity", {}).get("score", 0)),
            ("Consistency", q.get("consistency", {}).get("score", 0)),
            ("Uniqueness", q.get("uniqueness", {}).get("score", 0)),
        ]
        y = 0.40
        for name, value in dims:
            ax.text(0.04, y, name, color=t.ink_soft, fontsize=9.5, va="center")
            ax.add_patch(plt.Rectangle((0.42, y - 0.022), 0.44, 0.044, color=t.grid, zorder=2))
            ax.add_patch(plt.Rectangle((0.42, y - 0.022), 0.44 * float(value) / 100.0, 0.044, color=t.accent, zorder=3))
            ax.text(0.96, y, f"{float(value):.0f}", color=t.ink, fontsize=9.5, ha="right", va="center")
            y -= 0.105

    def _insight_panel(self, ax) -> None:
        t = self.theme
        _rounded_panel(ax, t, **FLAT_PAD)
        ax.set_xticks([]); ax.set_yticks([]); ax.set_xlim(0, 1); ax.set_ylim(0, 1)
        ax.set_title("Key Insights", color=t.ink, fontsize=13.5, fontweight="bold", loc="left", pad=14)
        if not self.insights:
            self._empty(ax, "No insights generated")
            return
        y = 0.84
        palette = {"critical": t.negative, "high": t.warning, "medium": t.accent, "low": t.ink_soft}
        for insight in self.insights[:4]:
            colour = palette.get(insight.get("priority", "medium"), t.accent)
            ax.add_patch(plt.Rectangle((0.035, y - 0.10), 0.008, 0.14, color=colour, zorder=3))
            ax.text(0.065, y, _wrap(insight["title"], 46), color=t.ink, fontsize=11, fontweight="bold", va="top")
            ax.text(0.065, y - 0.062, _wrap(insight["finding"], 60, 2), color=t.ink_soft, fontsize=9.2, va="top", linespacing=1.45)
            y -= 0.215

    def _empty(self, ax, message: str) -> None:
        ax.text(0.5, 0.5, message, ha="center", va="center", color=self.theme.ink_soft, fontsize=11, transform=ax.transAxes)
        ax.set_xticks([]); ax.set_yticks([])

    def _style_axes(self, ax, currency: bool = False) -> None:
        t = self.theme
        ax.grid(axis="y", color=t.grid, linewidth=0.9, zorder=1)
        ax.set_axisbelow(True)
        for name, spine in ax.spines.items():
            spine.set_visible(name == "bottom")
            spine.set_color(t.grid)
        ax.tick_params(colors=t.ink_soft, labelsize=9.5)
        ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: _fmt_axis_value(v)))

    # -- layout ------------------------------------------------------------
    def _select_panels(self) -> List[Tuple[str, Any]]:
        """Choose visuals based on the prompt first, then available metrics."""
        r = self.registry
        prompt = self.ctx.prompt
        panels: List[Tuple[str, Any]] = []

        trend = r.get("revenue_trend")
        forecast = r.get("forecast_series")
        wants_forecast = _requested(prompt, r"forecast", r"project", r"outlook", r"next (month|quarter|year)")
        wants_trend = _requested(prompt, r"trend", r"over time", r"month", r"season", r"growth")

        if forecast and (wants_forecast or not wants_trend):
            panels.append(("forecast", (trend, forecast)))
        if trend and (wants_trend or not forecast):
            panels.insert(0, ("trend", trend))

        breakdowns = [
            ("revenue_by_category", "Revenue by Category"),
            ("category_performance", "Category Performance"),
            ("revenue_by_region", "Revenue by Region"),
            ("revenue_by_channel", "Revenue by Channel"),
            ("top_products", "Top Products"),
            ("top_customers", "Top Customers"),
            ("customer_segments_rfm", "Customer Segments"),
            ("lowest_stock_items", "Lowest Stock Items"),
            ("bottom_products", "Lowest Performing Products"),
        ]
        priority_tokens = {
            "revenue_by_region": [r"region", r"country", r"geograph", r"market"],
            "revenue_by_channel": [r"channel"],
            "top_products": [r"product", r"sku", r"item", r"top seller"],
            "top_customers": [r"customer", r"client", r"account"],
            "customer_segments_rfm": [r"segment", r"rfm", r"cohort"],
            "lowest_stock_items": [r"inventory", r"stock", r"reorder"],
        }
        scored: List[Tuple[float, str, str]] = []
        for metric_id, title in breakdowns:
            metric = r.get(metric_id)
            if not metric or not isinstance(metric.value, list) or not metric.value:
                continue
            boost = 1.0 if _requested(prompt, *priority_tokens.get(metric_id, [])) else 0.0
            scored.append((boost, metric_id, title))
        scored.sort(key=lambda s: -s[0])

        for idx, (_boost, metric_id, title) in enumerate(scored[:3]):
            metric = r.require(metric_id)
            if idx == 0 and len(metric.value) <= 6 and _requested(prompt, r"mix", r"composition", r"share", r"split", r"contribution"):
                panels.append(("donut", (metric, title)))
            elif idx == 2:
                panels.append(("table", (metric, title)))
            else:
                panels.append(("bar", (metric, title)))
        return panels

    def render(self, *, title: str = "Analytics Dashboard", subtitle: str = "", dpi: int = 200) -> RenderResult:
        t = self.theme
        plt.rcParams.update(
            {
                "font.family": "DejaVu Sans",
                "figure.facecolor": t.bg,
                "savefig.facecolor": t.bg,
                "axes.facecolor": t.panel,
                "text.color": t.ink,
            }
        )

        kpis = self.registry.headline(4)
        delta = self.registry.get("revenue_growth_pct") or self.registry.get("revenue_yoy_pct")
        body_panels = self._select_panels()

        fig = plt.figure(figsize=(19.2, 10.8), dpi=dpi)
        gs = GridSpec(
            12, 12, figure=fig,
            left=0.050, right=0.970, top=0.838, bottom=0.078, hspace=4.2, wspace=1.9,
        )

        # Header
        header = fig.add_axes([0.0, 0.885, 1.0, 0.105])
        header.axis("off")
        header.text(0.026, 0.60, title[:70], color=t.ink, fontsize=26, fontweight="bold", va="center")
        if subtitle:
            header.text(0.026, 0.20, subtitle[:130], color=t.ink_soft, fontsize=11.5, va="center")
        date_range = None
        trend_metric = self.registry.get("revenue_trend")
        if trend_metric and trend_metric.period:
            date_range = str(trend_metric.period)
        elif self.ctx.profile().get("date_range"):
            dr = self.ctx.profile()["date_range"]
            date_range = f"{str(dr['min'])[:10]} → {str(dr['max'])[:10]}"
        if date_range:
            header.text(0.974, 0.60, f"Period: {date_range}", color=t.ink_soft, fontsize=11, ha="right", va="center")
            self.rendered.append(
                {"element": "date_range", "label": "Reporting period", "displayed": date_range, "metric_id": None, "source_display": date_range}
            )
        header.text(
            0.970, 0.22,
            f"{len(self.registry)} validated metrics · deterministic engine",
            color=t.ink_soft, fontsize=9.5, ha="right", va="center",
        )

        # KPI row
        span = 12 // max(len(kpis), 1) if kpis else 12
        for idx, metric in enumerate(kpis[:4]):
            ax = fig.add_subplot(gs[0:3, idx * span : (idx + 1) * span])
            self._kpi_card(ax, metric, delta if (idx == 0 and delta and delta.metric_id != metric.metric_id) else None)
            self.panels.append(f"kpi:{metric.metric_id}")

        # Main visual row
        row2 = body_panels[:2]
        if row2:
            widths = [8, 4] if len(row2) == 2 else [12]
            start = 0
            for (kind, payload), width in zip(row2, widths):
                ax = fig.add_subplot(gs[3:7, start : start + width])
                self._draw(ax, kind, payload)
                self.panels.append(kind)
                start += width

        # Bottom row: remaining visual + insights + quality
        remaining = body_panels[2:3]
        if remaining:
            ax = fig.add_subplot(gs[8:12, 0:5])
            self._draw(ax, remaining[0][0], remaining[0][1])
            self.panels.append(remaining[0][0])
            insight_slice, quality_slice = gs[8:12, 5:9], gs[8:12, 9:12]
        else:
            insight_slice, quality_slice = gs[8:12, 0:8], gs[8:12, 8:12]

        self._insight_panel(fig.add_subplot(insight_slice))
        self.panels.append("insights")
        self._quality_panel(fig.add_subplot(quality_slice))
        self.panels.append("quality")

        footer = fig.add_axes([0.0, 0.0, 1.0, 0.034])
        footer.axis("off")
        footer.text(
            0.026, 0.5,
            "All figures computed deterministically from the uploaded dataset and reconciled with the metric registry.",
            color=t.ink_soft, fontsize=8.5, va="center",
        )

        buffer = io.BytesIO()
        fig.savefig(buffer, format="png", dpi=dpi, facecolor=t.bg)
        plt.close(fig)
        data = buffer.getvalue()

        return RenderResult(
            png_bytes=data,
            width=int(19.2 * dpi),
            height=int(10.8 * dpi),
            dpi=dpi,
            rendered_values=self.rendered,
            panels=self.panels,
            theme=t.name,
            title=title,
            subtitle=subtitle,
            date_range=date_range,
        )

    def _draw(self, ax, kind: str, payload: Any) -> None:
        if kind == "trend":
            self._line_panel(ax, payload, payload.name)
        elif kind == "forecast":
            actual, forecast = payload
            self._forecast_panel(ax, actual, forecast, forecast.name)
        elif kind == "bar":
            metric, title = payload
            self._bar_panel(ax, metric, title)
        elif kind == "donut":
            metric, title = payload
            self._donut_panel(ax, metric, title)
        elif kind == "table":
            metric, title = payload
            self._table_panel(ax, metric, title)


def _wrap(text: str, width: int, max_lines: int = 3) -> str:
    import textwrap

    lines = textwrap.wrap(str(text), width=width)[:max_lines]
    if not lines:
        return ""
    if len(textwrap.wrap(str(text), width=width)) > max_lines:
        lines[-1] = lines[-1][: width - 1] + "…"
    return "\n".join(lines)


def render_dashboard(
    ctx: AnalysisContext,
    registry: MetricRegistry,
    insights: List[Dict[str, Any]],
    *,
    title: str = "Analytics Dashboard",
    subtitle: str = "",
    dpi: int = 200,
) -> RenderResult:
    return DashboardRenderer(ctx, registry, insights).render(title=title, subtitle=subtitle, dpi=dpi)
