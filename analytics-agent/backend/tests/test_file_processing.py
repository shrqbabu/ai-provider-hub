"""File-processing tests: valid CSV, malformed CSV, XLSX, empty, unsupported, oversized."""
from __future__ import annotations

import io

import pandas as pd
import pytest

from app.engine.ingest import (
    IngestError,
    load_bytes,
    profile_dataset,
    read_csv_bytes,
    read_excel_bytes,
    validate_upload,
)


def test_valid_csv_parses_and_profiles(sales_csv):
    result = read_csv_bytes(sales_csv, "sales")
    profile = profile_dataset(result)
    table = profile["tables"][0]
    assert table["row_count"] == 1200
    assert table["column_count"] == 10
    assert "revenue" in table["numeric_columns"]
    assert "order_date" in table["date_columns"]
    assert table["date_range"]["column"] == "order_date"
    assert any(c["semantic_type"] == "category" for c in table["columns"])
    assert table["sample_rows"]


def test_semicolon_delimiter_detected():
    csv = b"name;amount;date\nA;10;2024-01-01\nB;20;2024-02-01\nC;30;2024-03-01\n"
    result = read_csv_bytes(csv, "t")
    assert result.delimiter == ";"
    assert result.tables[0].frame.shape == (3, 3)


def test_latin1_encoding_handled():
    csv = "name,city\nJosé,Málaga\nRené,Köln\n".encode("cp1252")
    result = read_csv_bytes(csv, "t")
    assert result.encoding in {"cp1252", "latin-1"}
    assert result.tables[0].frame.shape[0] == 2


def test_malformed_csv_rows_counted_not_silently_dropped():
    csv = b"a,b,c\n1,2,3\n4,5\n6,7,8,9,10\n11,12,13\n"
    result = read_csv_bytes(csv, "t")
    assert result.tables[0].malformed_rows >= 1
    assert any("malformed" in w.lower() for w in result.warnings)


def test_duplicate_and_unnamed_columns_are_renamed():
    csv = b"a,a,,b\n1,2,3,4\n5,6,7,8\n"
    result = read_csv_bytes(csv, "t")
    cols = list(result.tables[0].frame.columns)
    assert len(set(cols)) == len(cols)
    assert result.tables[0].notes


def test_empty_file_rejected():
    with pytest.raises(IngestError) as exc:
        read_csv_bytes(b"", "t")
    assert exc.value.code in {"EMPTY_FILE", "UNKNOWN_ENCODING"}


def test_header_only_file_rejected():
    with pytest.raises(IngestError) as exc:
        read_csv_bytes(b"a,b,c\n", "t")
    assert exc.value.code == "EMPTY_FILE"


def test_binary_disguised_as_csv_rejected():
    with pytest.raises(IngestError) as exc:
        read_csv_bytes(b"PK\x03\x04rest-of-a-zip", "t")
    assert exc.value.code == "EXTENSION_CONTENT_MISMATCH"


def test_unsupported_extension_rejected():
    with pytest.raises(IngestError) as exc:
        validate_upload("data.json", "application/json", 1000, 10_000_000)
    assert exc.value.code == "UNSUPPORTED_EXTENSION"


def test_oversized_file_rejected():
    with pytest.raises(IngestError) as exc:
        validate_upload("big.csv", "text/csv", 50 * 1024 * 1024, 8 * 1024 * 1024)
    assert exc.value.code == "FILE_TOO_LARGE"


def test_path_traversal_filename_rejected():
    with pytest.raises(IngestError) as exc:
        validate_upload("../../etc/passwd.csv", "text/csv", 100, 10_000_000)
    assert exc.value.code == "INVALID_FILE_NAME"


def test_mime_mismatch_rejected():
    with pytest.raises(IngestError) as exc:
        validate_upload("data.csv", "image/png", 100, 10_000_000)
    assert exc.value.code == "MIME_MISMATCH"


def test_excel_sheets_detected_and_empty_sheet_reported(sales_xlsx):
    result = read_excel_bytes(sales_xlsx)
    names = {t.name for t in result.tables}
    assert "Orders" in names
    assert "Summary" in names  # populated sheets are never silently ignored
    assert any("EmptySheet" in w for w in result.warnings)


def test_excel_with_preamble_rows_finds_header():
    buffer = io.BytesIO()
    frame = pd.DataFrame({"Region": ["N", "S"], "Revenue": [100, 200]})
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        frame.to_excel(writer, sheet_name="Report", index=False, startrow=3)
    result = read_excel_bytes(buffer.getvalue())
    parsed = result.tables[0].frame
    assert list(parsed.columns) == ["Region", "Revenue"]
    assert parsed.shape[0] == 2


def test_corrupt_workbook_rejected():
    with pytest.raises(IngestError) as exc:
        read_excel_bytes(b"not really a workbook at all")
    assert exc.value.code == "CORRUPT_WORKBOOK"


def test_load_bytes_dispatches_by_kind(sales_csv, sales_xlsx):
    assert load_bytes("s.csv", sales_csv, "csv").tables[0].frame.shape[0] == 1200
    assert len(load_bytes("s.xlsx", sales_xlsx, "excel").tables) >= 2
