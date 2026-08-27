"""Shared fixtures: isolated store, dev-mode auth, deterministic sample data."""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


@pytest.fixture(scope="function")
def workspace(monkeypatch):
    """Fresh local store + dev auth for each test."""
    tmp = tempfile.mkdtemp(prefix="analytics-test-")
    monkeypatch.setenv("LOCAL_DATA_DIR", tmp)
    monkeypatch.setenv("DEV_MODE", "true")
    monkeypatch.setenv("LLM_PROVIDER", "deterministic")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.setenv("MAX_UPLOAD_MB", "8")

    from app import config, store

    config.reload_settings()
    store.reset_store()
    yield tmp
    store.reset_store()
    config.reload_settings()
    shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture
def client(workspace):
    from fastapi.testclient import TestClient

    import app.main as main_module
    import importlib

    importlib.reload(main_module)
    with TestClient(main_module.app) as c:
        yield c


ADMIN_A = "00000000-0000-0000-0000-0000000000aa"
ADMIN_B = "00000000-0000-0000-0000-0000000000bb"


def auth(user_id: str = ADMIN_A) -> dict:
    return {"Authorization": f"Bearer dev.{user_id}"}


@pytest.fixture
def sales_frame() -> pd.DataFrame:
    """Deterministic dataset with known ground-truth KPIs."""
    rng = np.random.default_rng(42)
    n = 1200
    start = pd.Timestamp("2023-01-01")
    dates = start + pd.to_timedelta(rng.integers(0, 900, n), unit="D")
    qty = rng.integers(1, 10, n)
    price = np.round(rng.uniform(10, 200, n), 2)
    revenue = np.round(qty * price, 2)
    return pd.DataFrame(
        {
            "order_id": [f"ORD-{i:05d}" for i in range(n)],
            "order_date": dates.strftime("%Y-%m-%d"),
            "customer_id": rng.choice([f"CUST-{i:03d}" for i in range(150)], n),
            "product_id": rng.choice([f"SKU-{i:02d}" for i in range(30)], n),
            "category": rng.choice(["Electronics", "Apparel", "Home"], n),
            "region": rng.choice(["North", "South", "East", "West"], n),
            "quantity": qty,
            "unit_price": price,
            "revenue": revenue,
            "cost": np.round(revenue * 0.6, 2),
        }
    )


@pytest.fixture
def sales_csv(sales_frame) -> bytes:
    return sales_frame.to_csv(index=False).encode("utf-8")


@pytest.fixture
def sales_xlsx(sales_frame) -> bytes:
    import io

    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        sales_frame.to_excel(writer, sheet_name="Orders", index=False)
        sales_frame.groupby("category", as_index=False)["revenue"].sum().to_excel(
            writer, sheet_name="Summary", index=False
        )
        pd.DataFrame().to_excel(writer, sheet_name="EmptySheet", index=False)
    return buffer.getvalue()
