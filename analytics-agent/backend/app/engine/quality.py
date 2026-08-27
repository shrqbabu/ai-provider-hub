"""Deterministic data-quality assessment.

Dimensions: completeness, validity, consistency, uniqueness, relationships.
Every score is computed from the data — no model involvement.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def _issue(severity: str, dimension: str, message: str, *, table: str = "", column: str = "", detail: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return {
        "severity": severity,
        "dimension": dimension,
        "message": message,
        "table": table,
        "column": column,
        "detail": detail or {},
    }


def assess_completeness(tables: Dict[str, pd.DataFrame]) -> Dict[str, Any]:
    per_table: Dict[str, Any] = {}
    issues: List[Dict[str, Any]] = []
    total_cells = 0
    filled_cells = 0
    for name, frame in tables.items():
        cells = int(frame.shape[0] * frame.shape[1]) or 1
        missing = int(frame.isna().sum().sum())
        total_cells += cells
        filled_cells += cells - missing
        col_missing = {
            str(c): round(float(frame[c].isna().mean() * 100), 2) for c in frame.columns
        }
        per_table[name] = {
            "missing_cells": missing,
            "missing_pct": round(missing / cells * 100, 2),
            "columns_missing_pct": col_missing,
            "fully_empty_columns": [c for c, pct in col_missing.items() if pct >= 100.0],
        }
        for col, pct in col_missing.items():
            if pct >= 100:
                issues.append(_issue("high", "completeness", f"Column '{col}' is entirely empty.", table=name, column=col))
            elif pct >= 40:
                issues.append(
                    _issue("high", "completeness", f"Column '{col}' is {pct:.1f}% missing.", table=name, column=col, detail={"missing_pct": pct})
                )
            elif pct >= 10:
                issues.append(
                    _issue("medium", "completeness", f"Column '{col}' is {pct:.1f}% missing.", table=name, column=col, detail={"missing_pct": pct})
                )
    score = (filled_cells / total_cells * 100) if total_cells else 0.0
    return {"score": round(score, 2), "tables": per_table, "issues": issues}


def assess_uniqueness(tables: Dict[str, pd.DataFrame], profiles: Dict[str, Any]) -> Dict[str, Any]:
    per_table: Dict[str, Any] = {}
    issues: List[Dict[str, Any]] = []
    penalties: List[float] = []
    for name, frame in tables.items():
        dupes = int(frame.duplicated().sum())
        rows = max(len(frame), 1)
        dupe_pct = dupes / rows * 100
        candidate_keys: List[str] = []
        broken_keys: List[Dict[str, Any]] = []
        for col in profiles.get(name, {}).get("identifier_columns", []):
            if col not in frame.columns:
                continue
            series = frame[col].dropna()
            if series.empty:
                continue
            if series.nunique() == len(series):
                candidate_keys.append(col)
            elif series.nunique() >= 0.9 * len(series):
                dup_count = int(len(series) - series.nunique())
                broken_keys.append({"column": col, "duplicate_values": dup_count})
                issues.append(
                    _issue(
                        "medium",
                        "uniqueness",
                        f"'{col}' looks like a key but has {dup_count} duplicate value(s).",
                        table=name,
                        column=col,
                    )
                )
        per_table[name] = {
            "duplicate_rows": dupes,
            "duplicate_pct": round(dupe_pct, 2),
            "candidate_keys": candidate_keys,
            "near_keys_with_duplicates": broken_keys,
        }
        if dupes:
            severity = "high" if dupe_pct > 5 else "medium"
            issues.append(
                _issue(severity, "uniqueness", f"{dupes} duplicate row(s) ({dupe_pct:.2f}%) in '{name}'.", table=name)
            )
        penalties.append(max(0.0, 100.0 - dupe_pct * 4))
    return {"score": round(float(np.mean(penalties)) if penalties else 100.0, 2), "tables": per_table, "issues": issues}


def assess_validity(tables: Dict[str, pd.DataFrame], profiles: Dict[str, Any]) -> Dict[str, Any]:
    per_table: Dict[str, Any] = {}
    issues: List[Dict[str, Any]] = []
    scores: List[float] = []
    for name, frame in tables.items():
        prof = profiles.get(name, {})
        checks: Dict[str, Any] = {}
        penalty = 0.0

        for col in prof.get("numeric_columns", []):
            if col not in frame.columns:
                continue
            series = pd.to_numeric(frame[col], errors="coerce")
            negatives = int((series < 0).sum())
            checks[col] = {"negative_values": negatives}
            semantic = next(
                (c["semantic_type"] for c in prof.get("columns", []) if c["name"] == col), "numeric"
            )
            if semantic in {"currency", "quantity"} and negatives > 0:
                pct = negatives / max(series.notna().sum(), 1) * 100
                sev = "high" if pct > 5 else "low"
                issues.append(
                    _issue(
                        sev,
                        "validity",
                        f"'{col}' contains {negatives} negative value(s) — verify returns/credits are intended.",
                        table=name,
                        column=col,
                    )
                )
                penalty += min(pct, 10)

            non_null = series.dropna()
            if len(non_null) >= 20:
                q1, q3 = non_null.quantile(0.25), non_null.quantile(0.75)
                iqr = q3 - q1
                if iqr > 0:
                    outliers = int(((non_null < q1 - 3 * iqr) | (non_null > q3 + 3 * iqr)).sum())
                    checks[col]["extreme_outliers"] = outliers
                    if outliers and outliers / len(non_null) > 0.02:
                        issues.append(
                            _issue(
                                "medium",
                                "validity",
                                f"'{col}' has {outliers} extreme outlier(s) beyond 3×IQR.",
                                table=name,
                                column=col,
                            )
                        )
                        penalty += 3

        for col in prof.get("date_columns", []):
            if col not in frame.columns:
                continue
            series = pd.to_datetime(frame[col], errors="coerce")
            future = int((series > pd.Timestamp.now() + pd.Timedelta(days=1)).sum())
            ancient = int((series < pd.Timestamp("1970-01-01")).sum())
            checks[col] = {"future_dates": future, "pre_1970_dates": ancient}
            if future:
                issues.append(
                    _issue("medium", "validity", f"'{col}' has {future} date(s) in the future.", table=name, column=col)
                )
                penalty += 3
            if ancient:
                issues.append(
                    _issue("low", "validity", f"'{col}' has {ancient} implausible pre-1970 date(s).", table=name, column=col)
                )
                penalty += 1

        per_table[name] = checks
        scores.append(max(0.0, 100.0 - penalty))
    return {"score": round(float(np.mean(scores)) if scores else 100.0, 2), "tables": per_table, "issues": issues}


def assess_consistency(tables: Dict[str, pd.DataFrame], profiles: Dict[str, Any]) -> Dict[str, Any]:
    per_table: Dict[str, Any] = {}
    issues: List[Dict[str, Any]] = []
    scores: List[float] = []
    for name, frame in tables.items():
        prof = profiles.get(name, {})
        findings: Dict[str, Any] = {}
        penalty = 0.0
        for col in prof.get("category_columns", []) + prof.get("text_columns", []):
            if col not in frame.columns:
                continue
            series = frame[col].dropna().astype(str)
            if series.empty:
                continue
            raw_distinct = series.nunique()
            norm_distinct = series.str.strip().str.lower().nunique()
            if norm_distinct < raw_distinct:
                findings[col] = {
                    "distinct_raw": int(raw_distinct),
                    "distinct_normalised": int(norm_distinct),
                    "casing_or_whitespace_variants": int(raw_distinct - norm_distinct),
                }
                issues.append(
                    _issue(
                        "medium",
                        "consistency",
                        f"'{col}' has {raw_distinct - norm_distinct} value(s) differing only by case/whitespace.",
                        table=name,
                        column=col,
                    )
                )
                penalty += 4

        dates = prof.get("date_columns", [])
        if len(dates) >= 2 and all(d in frame.columns for d in dates[:2]):
            a, b = dates[0], dates[1]
            sa, sb = pd.to_datetime(frame[a], errors="coerce"), pd.to_datetime(frame[b], errors="coerce")
            inverted = int((sb < sa).sum())
            if inverted:
                findings[f"{a}_vs_{b}"] = {"inverted_pairs": inverted}
                issues.append(
                    _issue("medium", "consistency", f"{inverted} row(s) where '{b}' precedes '{a}'.", table=name)
                )
                penalty += 5

        per_table[name] = findings
        scores.append(max(0.0, 100.0 - penalty))
    return {"score": round(float(np.mean(scores)) if scores else 100.0, 2), "tables": per_table, "issues": issues}


def assess_relationships(relationships: List[Dict[str, Any]]) -> Dict[str, Any]:
    issues: List[Dict[str, Any]] = []
    if not relationships:
        return {"score": 100.0, "relationships": [], "issues": issues}
    scores: List[float] = []
    for rel in relationships:
        coverage = float(rel.get("match_pct", 100.0))
        scores.append(coverage)
        if coverage < 90:
            issues.append(
                _issue(
                    "high" if coverage < 70 else "medium",
                    "relationships",
                    (
                        f"Only {coverage:.1f}% of '{rel['from_table']}.{rel['from_column']}' values match "
                        f"'{rel['to_table']}.{rel['to_column']}' — joins will drop or orphan rows."
                    ),
                    table=rel["from_table"],
                    column=rel["from_column"],
                    detail=rel,
                )
            )
        if rel.get("fan_out"):
            issues.append(
                _issue(
                    "high",
                    "relationships",
                    (
                        f"'{rel['from_table']}' → '{rel['to_table']}' is many-to-many; joining will "
                        "duplicate rows and inflate totals."
                    ),
                    table=rel["from_table"],
                    detail=rel,
                )
            )
    return {"score": round(float(np.mean(scores)) if scores else 100.0, 2), "relationships": relationships, "issues": issues}


def assess(
    tables: Dict[str, pd.DataFrame],
    profiles: Dict[str, Any],
    relationships: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    completeness = assess_completeness(tables)
    uniqueness = assess_uniqueness(tables, profiles)
    validity = assess_validity(tables, profiles)
    consistency = assess_consistency(tables, profiles)
    rels = assess_relationships(relationships or [])

    weights = {"completeness": 0.30, "validity": 0.25, "consistency": 0.15, "uniqueness": 0.20, "relationships": 0.10}
    score = (
        completeness["score"] * weights["completeness"]
        + validity["score"] * weights["validity"]
        + consistency["score"] * weights["consistency"]
        + uniqueness["score"] * weights["uniqueness"]
        + rels["score"] * weights["relationships"]
    )

    issues = (
        completeness["issues"] + validity["issues"] + consistency["issues"] + uniqueness["issues"] + rels["issues"]
    )
    issues.sort(key=lambda i: SEVERITY_ORDER.get(i["severity"], 9))

    return {
        "score": round(score, 2),
        "grade": _grade(score),
        "completeness": {k: v for k, v in completeness.items() if k != "issues"},
        "validity": {k: v for k, v in validity.items() if k != "issues"},
        "consistency": {k: v for k, v in consistency.items() if k != "issues"},
        "uniqueness": {k: v for k, v in uniqueness.items() if k != "issues"},
        "relationships": {k: v for k, v in rels.items() if k != "issues"},
        "issues": issues,
        "critical_issue_count": sum(1 for i in issues if i["severity"] == "critical"),
        "high_issue_count": sum(1 for i in issues if i["severity"] == "high"),
    }


def _grade(score: float) -> str:
    if score >= 90:
        return "excellent"
    if score >= 80:
        return "good"
    if score >= 65:
        return "fair"
    if score >= 50:
        return "poor"
    return "critical"
