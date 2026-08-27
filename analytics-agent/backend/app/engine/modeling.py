"""Schema modelling.

Detects, from the profiled data only:
  * column roles (measures, dimensions, keys, dates)
  * candidate relationships between tables and their cardinality
  * the business domain(s) actually evidenced by the schema

No table or column is ever invented: every name returned here exists in the
parsed data.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

DOMAIN_SIGNALS: Dict[str, List[str]] = {
    "sales": [
        "revenue", "sales", "order", "invoice", "amount", "gross", "net", "transaction",
        "deal", "billing", "price", "discount", "profit", "margin",
    ],
    "customer": ["customer", "client", "account", "buyer", "member", "subscriber", "user", "segment", "churn", "retention"],
    "product": ["product", "sku", "item", "category", "brand", "model", "variant", "catalog"],
    "inventory": ["stock", "inventory", "warehouse", "onhand", "on_hand", "reorder", "supply", "lead_time", "backorder", "units_available"],
    "finance": ["cost", "expense", "budget", "gl", "ledger", "cash", "payable", "receivable"],
    "operations": ["ship", "delivery", "fulfil", "fulfill", "carrier", "sla", "lead", "cycle_time"],
    "marketing": ["campaign", "channel", "impression", "click", "spend", "cac", "conversion", "lead_source"],
}

MEASURE_TYPES = {"currency", "quantity", "numeric"}


def classify_columns(profile: Dict[str, Any]) -> Dict[str, List[str]]:
    measures: List[str] = []
    dimensions: List[str] = []
    keys: List[str] = []
    dates: List[str] = list(profile.get("date_columns", []))

    for col in profile.get("columns", []):
        name, stype = col["name"], col["semantic_type"]
        if name in dates:
            continue
        if stype == "identifier":
            keys.append(name)
        elif stype in MEASURE_TYPES:
            measures.append(name)
        elif stype in {"category", "text", "boolean"}:
            dimensions.append(name)

    return {"measures": measures, "dimensions": dimensions, "keys": keys, "dates": dates}


def detect_domains(profiles: List[Dict[str, Any]]) -> Dict[str, float]:
    """Score each business domain by evidence in table/column names."""
    tokens: List[str] = []
    for prof in profiles:
        tokens.append(str(prof.get("table_name", "")).lower())
        tokens.extend(str(c["name"]).lower() for c in prof.get("columns", []))
    blob = " ".join(tokens)

    scores: Dict[str, float] = {}
    for domain, signals in DOMAIN_SIGNALS.items():
        hits = sum(1 for s in signals if s in blob)
        if hits:
            scores[domain] = round(min(1.0, hits / max(len(signals) * 0.4, 1)), 3)
    return dict(sorted(scores.items(), key=lambda kv: kv[1], reverse=True))


def _normalise_key(values: pd.Series) -> pd.Series:
    if pd.api.types.is_numeric_dtype(values):
        return values.dropna()
    return values.dropna().astype(str).str.strip().str.lower()


def detect_relationships(
    frames: Dict[str, pd.DataFrame], profiles: Dict[str, Any], max_pairs: int = 60
) -> List[Dict[str, Any]]:
    """Find FK-like column pairs and measure their real join behaviour."""
    if len(frames) < 2:
        return []

    candidates: List[Tuple[str, str, str, str]] = []
    names = list(frames.keys())
    for i, left in enumerate(names):
        for right in names[i + 1 :]:
            lprof, rprof = profiles.get(left, {}), profiles.get(right, {})
            lkeys = set(lprof.get("identifier_columns", [])) | set(lprof.get("category_columns", []))
            rkeys = set(rprof.get("identifier_columns", [])) | set(rprof.get("category_columns", []))
            for lc in lkeys:
                for rc in rkeys:
                    if _keys_look_related(lc, rc):
                        candidates.append((left, lc, right, rc))

    relationships: List[Dict[str, Any]] = []
    for left, lc, right, rc in candidates[:max_pairs]:
        lf, rf = frames[left], frames[right]
        if lc not in lf.columns or rc not in rf.columns:
            continue
        lvals, rvals = _normalise_key(lf[lc]), _normalise_key(rf[rc])
        if lvals.empty or rvals.empty:
            continue
        lset, rset = set(lvals.unique()), set(rvals.unique())
        if not lset or not rset:
            continue
        overlap = len(lset & rset)
        if overlap == 0:
            continue

        l_unique = lvals.nunique() == len(lvals)
        r_unique = rvals.nunique() == len(rvals)
        if r_unique and not l_unique:
            from_t, from_c, to_t, to_c = left, lc, right, rc
            cardinality = "many-to-one"
            match_pct = len(lset & rset) / len(lset) * 100
        elif l_unique and not r_unique:
            from_t, from_c, to_t, to_c = right, rc, left, lc
            cardinality = "many-to-one"
            match_pct = len(rset & lset) / len(rset) * 100
        elif l_unique and r_unique:
            from_t, from_c, to_t, to_c = left, lc, right, rc
            cardinality = "one-to-one"
            match_pct = overlap / max(len(lset), 1) * 100
        else:
            from_t, from_c, to_t, to_c = left, lc, right, rc
            cardinality = "many-to-many"
            match_pct = overlap / max(len(lset), 1) * 100

        relationships.append(
            {
                "from_table": from_t,
                "from_column": from_c,
                "to_table": to_t,
                "to_column": to_c,
                "cardinality": cardinality,
                "match_pct": round(float(match_pct), 2),
                "matched_keys": int(overlap),
                "fan_out": cardinality == "many-to-many",
                "safe_to_join": cardinality in {"many-to-one", "one-to-one"} and match_pct >= 90,
            }
        )

    relationships.sort(key=lambda r: (-r["match_pct"], r["from_table"]))
    return relationships


def _keys_look_related(a: str, b: str) -> bool:
    na, nb = _key_stem(a), _key_stem(b)
    if not na or not nb:
        return False
    return na == nb or na in nb or nb in na


def _key_stem(name: str) -> str:
    stem = re.sub(r"(^|_)(id|key|code|no|number)$", "", str(name).strip().lower())
    stem = re.sub(r"[^a-z0-9]+", "", stem)
    return stem


def build_model(frames: Dict[str, pd.DataFrame], profiles_by_table: Dict[str, Any]) -> Dict[str, Any]:
    profile_list = list(profiles_by_table.values())
    relationships = detect_relationships(frames, profiles_by_table)
    tables: List[Dict[str, Any]] = []

    for name, prof in profiles_by_table.items():
        roles = classify_columns(prof)
        grain = _infer_grain(prof, roles)
        tables.append(
            {
                "table_name": name,
                "row_count": prof.get("row_count", 0),
                "column_count": prof.get("column_count", 0),
                "grain": grain,
                "roles": roles,
                "date_range": prof.get("date_range"),
            }
        )

    fact = _pick_fact_table(tables)
    return {
        "tables": tables,
        "relationships": relationships,
        "domains": detect_domains(profile_list),
        "fact_table": fact,
        "dimension_tables": [t["table_name"] for t in tables if t["table_name"] != fact],
        "date_table_recommended": any(t["roles"]["dates"] for t in tables),
        "join_warnings": [
            f"{r['from_table']}→{r['to_table']} is {r['cardinality']} at {r['match_pct']:.0f}% key coverage"
            for r in relationships
            if not r["safe_to_join"]
        ],
    }


def _infer_grain(prof: Dict[str, Any], roles: Dict[str, List[str]]) -> str:
    keys = roles["keys"]
    dates = roles["dates"]
    parts: List[str] = []
    if keys:
        parts.append(keys[0])
    if dates:
        parts.append(dates[0])
    if not parts:
        return "one row per record"
    return "one row per " + " × ".join(parts)


def _pick_fact_table(tables: List[Dict[str, Any]]) -> Optional[str]:
    if not tables:
        return None
    def score(t: Dict[str, Any]) -> float:
        return (
            len(t["roles"]["measures"]) * 3
            + len(t["roles"]["dates"]) * 2
            + len(t["roles"]["keys"])
            + (t["row_count"] / 10000.0)
        )
    return max(tables, key=score)["table_name"]
