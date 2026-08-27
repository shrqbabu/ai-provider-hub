"""File ingestion, validation and profiling.

CSV and Excel are validated *before* parsing (extension, MIME, size, encoding,
delimiter, header) and parsed defensively: malformed rows are counted and
reported, never silently dropped without a trace. Populated Excel sheets are
never ignored.
"""
from __future__ import annotations

import csv
import hashlib
import io
import math
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

CSV_EXTENSIONS = {".csv", ".tsv", ".txt"}
EXCEL_EXTENSIONS = {".xlsx", ".xls", ".xlsm"}
ALLOWED_EXTENSIONS = CSV_EXTENSIONS | EXCEL_EXTENSIONS

CSV_MIME = {
    "text/csv",
    "text/plain",
    "application/csv",
    "application/vnd.ms-excel",  # browsers mislabel .csv as this
    "text/tab-separated-values",
    "application/octet-stream",
}
EXCEL_MIME = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/vnd.ms-excel.sheet.macroEnabled.12",
    "application/octet-stream",
}

XLSX_MAGIC = b"PK\x03\x04"
XLS_MAGIC = b"\xd0\xcf\x11\xe0"

DATE_HINT = re.compile(r"(date|day|month|year|time|period|dt|created|updated|order.?date)", re.I)
ID_HINT = re.compile(r"(^id$|_id$|^id_|code$|number$|no$|key$|sku)", re.I)
AMOUNT_HINT = re.compile(
    r"(revenue|sales|amount|total|price|cost|profit|margin|value|spend|gmv|net|gross|discount|tax|freight)", re.I
)
QTY_HINT = re.compile(r"(qty|quantity|units|count|volume|stock|inventory|onhand|on_hand)", re.I)


class IngestError(ValueError):
    """Raised for user-fixable input problems. Message is shown to the admin."""

    def __init__(self, message: str, code: str = "INVALID_FILE", hint: str = "") -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.hint = hint


@dataclass
class TableData:
    name: str
    frame: pd.DataFrame
    source_sheet: Optional[str] = None
    malformed_rows: int = 0
    notes: List[str] = field(default_factory=list)


@dataclass
class IngestResult:
    tables: List[TableData]
    encoding: str = "utf-8"
    delimiter: str = ","
    warnings: List[str] = field(default_factory=list)
    checksum: str = ""

    @property
    def primary(self) -> TableData:
        return max(self.tables, key=lambda t: (t.frame.shape[0] * max(t.frame.shape[1], 1)))


# ---------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------
def validate_upload(file_name: str, mime_type: str, size_bytes: int, max_bytes: int) -> str:
    """Validate metadata before any bytes are parsed. Returns 'csv' | 'excel'."""
    name = (file_name or "").strip()
    if not name:
        raise IngestError("File name is missing.", "INVALID_FILE_NAME")
    if "/" in name or "\\" in name or ".." in name:
        raise IngestError("File name contains illegal path characters.", "INVALID_FILE_NAME")

    ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise IngestError(
            f"Unsupported file type '{ext or name}'. Upload a .csv, .xlsx or .xls file.",
            "UNSUPPORTED_EXTENSION",
        )
    if size_bytes <= 0:
        raise IngestError("The file is empty.", "EMPTY_FILE")
    if size_bytes > max_bytes:
        raise IngestError(
            f"File is {size_bytes / 1048576:.1f} MB which exceeds the {max_bytes / 1048576:.0f} MB limit.",
            "FILE_TOO_LARGE",
            hint="Split the file or raise MAX_UPLOAD_MB on the analytics backend.",
        )

    kind = "csv" if ext in CSV_EXTENSIONS else "excel"
    mime = (mime_type or "").split(";")[0].strip().lower()
    if mime:
        allowed = CSV_MIME if kind == "csv" else EXCEL_MIME
        if mime not in allowed:
            raise IngestError(
                f"Declared content type '{mime}' does not match a {kind} file.",
                "MIME_MISMATCH",
            )
    return kind


def sniff_content(content: bytes, kind: str) -> None:
    """Magic-byte check so a renamed binary cannot masquerade as a CSV."""
    head = content[:8]
    if kind == "excel":
        if not (head.startswith(XLSX_MAGIC) or head.startswith(XLS_MAGIC)):
            raise IngestError("File content is not a valid Excel workbook.", "CORRUPT_WORKBOOK")
    else:
        if head.startswith(XLSX_MAGIC) or head.startswith(XLS_MAGIC):
            raise IngestError(
                "This looks like an Excel workbook saved with a .csv extension. Rename it to .xlsx and re-upload.",
                "EXTENSION_CONTENT_MISMATCH",
            )
        if b"\x00" in content[:4096]:
            raise IngestError("File appears to be binary, not delimited text.", "NOT_TEXT")


def detect_encoding(content: bytes) -> str:
    if content[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return "utf-16"
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            content[: 256 * 1024].decode(enc)
            return enc
        except (UnicodeDecodeError, LookupError):
            continue
    raise IngestError("Unable to decode the file. Save it as UTF-8 and retry.", "UNKNOWN_ENCODING")


def detect_delimiter(sample: str) -> str:
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        return dialect.delimiter
    except csv.Error:
        counts = {d: sample.count(d) for d in [",", ";", "\t", "|"]}
        best = max(counts, key=counts.get)
        return best if counts[best] > 0 else ","


# ---------------------------------------------------------------------------
# parsing
# ---------------------------------------------------------------------------
def _clean_columns(frame: pd.DataFrame) -> Tuple[pd.DataFrame, List[str]]:
    notes: List[str] = []
    cols: List[str] = []
    seen: Dict[str, int] = {}
    for idx, raw in enumerate(frame.columns):
        name = str(raw).strip()
        if not name or name.lower().startswith("unnamed:"):
            name = f"column_{idx + 1}"
            notes.append(f"Unnamed column at position {idx + 1} renamed to '{name}'.")
        base = name
        if base in seen:
            seen[base] += 1
            name = f"{base}_{seen[base]}"
            notes.append(f"Duplicate column '{base}' renamed to '{name}'.")
        else:
            seen[base] = 0
        cols.append(name)
    frame = frame.copy()
    frame.columns = cols
    return frame, notes


def _drop_empty(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.dropna(axis=0, how="all")
    frame = frame.dropna(axis=1, how="all")
    return frame


def read_csv_bytes(content: bytes, table_name: str = "data", max_rows: Optional[int] = None) -> IngestResult:
    sniff_content(content, "csv")
    encoding = detect_encoding(content)
    text_sample = content[: 128 * 1024].decode(encoding, errors="replace")
    if not text_sample.strip():
        raise IngestError("The file contains no data.", "EMPTY_FILE")
    delimiter = detect_delimiter(text_sample)

    warnings: List[str] = []
    bad_rows: List[str] = []

    def _on_bad(line: List[str]) -> None:
        if len(bad_rows) < 50:
            bad_rows.append(delimiter.join(map(str, line))[:200])

    try:
        frame = pd.read_csv(
            io.BytesIO(content),
            encoding=encoding,
            sep=delimiter,
            engine="python",
            on_bad_lines=_on_bad,
            skip_blank_lines=True,
            nrows=max_rows,
        )
    except pd.errors.EmptyDataError as exc:
        raise IngestError("The file contains no parsable rows.", "EMPTY_FILE") from exc
    except Exception as exc:  # noqa: BLE001
        raise IngestError(f"CSV could not be parsed: {exc}", "CSV_PARSE_FAILED") from exc

    if frame.empty:
        raise IngestError("The file parsed to zero data rows.", "EMPTY_FILE")

    header_looks_like_data = all(
        re.fullmatch(r"-?\d+(\.\d+)?", str(c).strip()) for c in frame.columns
    )
    if header_looks_like_data:
        warnings.append("Header row looks numeric — verify the first row is really a header.")

    frame = _drop_empty(frame)
    frame, notes = _clean_columns(frame)
    if bad_rows:
        warnings.append(
            f"{len(bad_rows)} malformed row(s) skipped because the column count did not match the header."
        )

    table = TableData(name=table_name, frame=frame, malformed_rows=len(bad_rows), notes=notes)
    return IngestResult(
        tables=[table],
        encoding=encoding,
        delimiter=delimiter,
        warnings=warnings,
        checksum=hashlib.sha256(content).hexdigest(),
    )


def read_excel_bytes(content: bytes, max_rows: Optional[int] = None) -> IngestResult:
    sniff_content(content, "excel")
    try:
        book = pd.ExcelFile(io.BytesIO(content))
    except Exception as exc:  # noqa: BLE001
        raise IngestError(f"Workbook could not be opened: {exc}", "CORRUPT_WORKBOOK") from exc

    tables: List[TableData] = []
    warnings: List[str] = []
    for sheet in book.sheet_names:
        try:
            raw = book.parse(sheet, header=None, nrows=max_rows)
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"Sheet '{sheet}' could not be parsed: {exc}")
            continue
        raw = _drop_empty(raw)
        if raw.empty:
            warnings.append(f"Sheet '{sheet}' is empty and was skipped.")
            continue

        header_idx = _find_header_row(raw)
        frame = raw.iloc[header_idx + 1 :].reset_index(drop=True)
        frame.columns = [str(c) for c in raw.iloc[header_idx].tolist()]
        frame = _drop_empty(frame)
        if frame.empty:
            warnings.append(f"Sheet '{sheet}' has a header but no data rows.")
            continue
        frame, notes = _clean_columns(frame)
        frame = frame.infer_objects()
        for col in frame.columns:
            if frame[col].dtype == object:
                converted = pd.to_numeric(frame[col], errors="coerce")
                if converted.notna().sum() >= max(1, int(frame[col].notna().sum() * 0.95)):
                    frame[col] = converted
        if header_idx > 0:
            notes.append(f"Header detected on row {header_idx + 1}; {header_idx} preamble row(s) skipped.")
        tables.append(TableData(name=_safe_table_name(sheet), frame=frame, source_sheet=sheet, notes=notes))

    if not tables:
        raise IngestError(
            "The workbook contains no populated sheets with a usable header row.", "EMPTY_WORKBOOK"
        )
    return IngestResult(
        tables=tables, warnings=warnings, checksum=hashlib.sha256(content).hexdigest()
    )


def _find_header_row(raw: pd.DataFrame, scan: int = 12) -> int:
    """Pick the first row that looks like a header (mostly non-numeric, filled)."""
    best_idx, best_score = 0, -1.0
    for idx in range(min(scan, len(raw))):
        row = raw.iloc[idx]
        filled = row.notna().sum()
        if filled == 0:
            continue
        non_numeric = sum(
            1 for v in row.dropna() if not isinstance(v, (int, float, np.integer, np.floating))
        )
        score = (filled / max(len(row), 1)) + (non_numeric / max(filled, 1))
        if score > best_score:
            best_idx, best_score = idx, score
    return best_idx


def _safe_table_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_]+", "_", str(name).strip()).strip("_")
    return cleaned or "Sheet"


def load_bytes(file_name: str, content: bytes, kind: str, max_rows: Optional[int] = None) -> IngestResult:
    if kind == "excel":
        return read_excel_bytes(content, max_rows=max_rows)
    base = _safe_table_name(file_name.rsplit(".", 1)[0])
    return read_csv_bytes(content, table_name=base, max_rows=max_rows)


# ---------------------------------------------------------------------------
# profiling
# ---------------------------------------------------------------------------
def _semantic_type(series: pd.Series, name: str) -> str:
    if pd.api.types.is_datetime64_any_dtype(series):
        return "date"
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_numeric_dtype(series):
        if ID_HINT.search(name):
            return "identifier"
        if AMOUNT_HINT.search(name):
            return "currency"
        if QTY_HINT.search(name):
            return "quantity"
        return "numeric"
    non_null = series.dropna()
    if non_null.empty:
        return "empty"
    nunique = non_null.nunique()
    if ID_HINT.search(name) and nunique > 0.5 * len(non_null):
        return "identifier"
    if nunique <= max(2, min(50, int(0.05 * len(non_null)) or 2)):
        return "category"
    return "text"


def coerce_dates(frame: pd.DataFrame) -> Tuple[pd.DataFrame, List[str]]:
    """Convert obvious date columns. Conservative: needs >=80% parse success."""
    frame = frame.copy()
    converted: List[str] = []
    for col in frame.columns:
        series = frame[col]
        if pd.api.types.is_datetime64_any_dtype(series):
            converted.append(col)
            continue
        if pd.api.types.is_numeric_dtype(series) or pd.api.types.is_bool_dtype(series):
            continue
        non_null = series.dropna()
        if non_null.empty:
            continue
        if not DATE_HINT.search(str(col)):
            sample = non_null.astype(str).head(50)
            if not sample.str.contains(r"\d{4}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}").mean() > 0.8:
                continue
        parsed = pd.to_datetime(series, errors="coerce", format="mixed", dayfirst=False)
        ratio = parsed.notna().sum() / max(non_null.shape[0], 1)
        if ratio >= 0.8:
            frame[col] = parsed
            converted.append(col)
    return frame, converted


def profile_table(table: TableData) -> Dict[str, Any]:
    frame, date_cols = coerce_dates(table.frame)
    table.frame = frame
    rows, cols = frame.shape
    columns: List[Dict[str, Any]] = []

    for col in frame.columns:
        series = frame[col]
        non_null = series.dropna()
        stype = _semantic_type(series, str(col))
        info: Dict[str, Any] = {
            "name": str(col),
            "dtype": str(series.dtype),
            "semantic_type": stype,
            "null_count": int(series.isna().sum()),
            "null_pct": round(float(series.isna().mean() * 100), 2),
            "distinct_count": int(non_null.nunique()) if not non_null.empty else 0,
        }
        if not non_null.empty:
            if pd.api.types.is_numeric_dtype(series):
                desc = non_null.astype(float)
                info.update(
                    {
                        "min": _finite(desc.min()),
                        "max": _finite(desc.max()),
                        "mean": _finite(desc.mean()),
                        "median": _finite(desc.median()),
                        "std": _finite(desc.std()),
                        "sum": _finite(desc.sum()),
                        "zero_count": int((desc == 0).sum()),
                        "negative_count": int((desc < 0).sum()),
                    }
                )
            elif pd.api.types.is_datetime64_any_dtype(series):
                info.update(
                    {
                        "min": str(non_null.min()),
                        "max": str(non_null.max()),
                        "distinct_days": int(non_null.dt.normalize().nunique()),
                    }
                )
            else:
                top = non_null.astype(str).value_counts().head(5)
                info["top_values"] = [
                    {"value": str(k)[:80], "count": int(v)} for k, v in top.items()
                ]
                lengths = non_null.astype(str).str.len()
                info["min_length"] = int(lengths.min())
                info["max_length"] = int(lengths.max())
        columns.append(info)

    numeric_cols = [c["name"] for c in columns if c["semantic_type"] in {"numeric", "currency", "quantity"}]
    category_cols = [c["name"] for c in columns if c["semantic_type"] == "category"]
    id_cols = [c["name"] for c in columns if c["semantic_type"] == "identifier"]

    date_range = None
    if date_cols:
        primary_date = date_cols[0]
        series = frame[primary_date].dropna()
        if not series.empty:
            date_range = {"column": primary_date, "min": str(series.min()), "max": str(series.max())}

    duplicate_rows = int(frame.duplicated().sum())

    return {
        "table_name": table.name,
        "source_sheet": table.source_sheet,
        "row_count": int(rows),
        "column_count": int(cols),
        "duplicate_row_count": duplicate_rows,
        "malformed_rows": table.malformed_rows,
        "columns": columns,
        "date_columns": date_cols,
        "numeric_columns": numeric_cols,
        "category_columns": category_cols,
        "identifier_columns": id_cols,
        "text_columns": [c["name"] for c in columns if c["semantic_type"] == "text"],
        "date_range": date_range,
        "notes": table.notes,
        "sample_rows": _sample_rows(frame, 8),
    }


def _sample_rows(frame: pd.DataFrame, n: int) -> List[Dict[str, Any]]:
    head = frame.head(n)
    out: List[Dict[str, Any]] = []
    for _, row in head.iterrows():
        out.append({str(k): _jsonable(v) for k, v in row.items()})
    return out


def _jsonable(value: Any) -> Any:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return _finite(float(value))
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if pd.isna(value):
        return None
    return value if isinstance(value, (int, float, bool, str)) else str(value)


def _finite(value: Any) -> Optional[float]:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return round(f, 6)


def profile_dataset(result: IngestResult) -> Dict[str, Any]:
    tables = [profile_table(t) for t in result.tables]
    return {
        "encoding": result.encoding,
        "delimiter": result.delimiter,
        "warnings": result.warnings,
        "checksum": result.checksum,
        "table_count": len(tables),
        "total_rows": int(sum(t["row_count"] for t in tables)),
        "total_columns": int(sum(t["column_count"] for t in tables)),
        "tables": tables,
    }
