"""End-to-end: login → project → upload → profile → quality → prompt → run →
validate → DAX → PNG → view/download, plus SQL guard rails and error handling."""
from __future__ import annotations

import time

import pytest

from tests.conftest import ADMIN_A, ADMIN_B, auth


def wait_for(client, run_id, timeout=240):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = client.get(f"/v1/runs/{run_id}", headers=auth()).json()
        if last["status"] not in ("queued", "running"):
            return last
        time.sleep(0.25)
    raise AssertionError(f"run stuck: {last}")


def test_full_journey(client, sales_csv):
    # 1. login
    me = client.get("/v1/me", headers=auth())
    assert me.status_code == 200 and me.json()["role"] == "admin"

    # 2. create project
    project = client.post(
        "/v1/projects",
        json={"name": "Q3 Retail Review", "description": "Quarterly review", "source_type": "csv"},
        headers=auth(),
    ).json()
    project_id = project["id"]
    assert project["status"] == "draft"

    # 3. upload CSV -> parse -> profile -> schema
    upload = client.post(
        f"/v1/projects/{project_id}/datasets",
        files={"file": ("sales.csv", sales_csv, "text/csv")},
        headers=auth(),
    )
    assert upload.status_code == 201, upload.text
    profile = upload.json()["profile"]
    assert profile["total_rows"] == 1200
    assert profile["tables"][0]["date_columns"] == ["order_date"]
    dataset_id = upload.json()["dataset"]["id"]

    # 4. data quality
    dq = client.get(f"/v1/datasets/{dataset_id}/quality", headers=auth()).json()
    assert 0 <= dq["quality"]["score"] <= 100
    assert "completeness" in dq["quality"]

    # 5. report prompt -> run
    prompt = (
        "Analyse revenue performance by category and region, review customer retention, "
        "identify the top products and recommend actions for next quarter."
    )
    started = client.post(f"/v1/projects/{project_id}/runs", json={"prompt": prompt}, headers=auth())
    assert started.status_code == 202
    run_id = started.json()["id"]

    # 6. progress + completion
    final = wait_for(client, run_id)
    assert final["status"] == "completed", final.get("error")
    assert final["progress"] == 100
    assert final["validation_status"] == "passed"
    assert final["metric_count"] > 10

    # 7. results tabs
    overview = client.get(f"/v1/runs/{run_id}/results?section=overview", headers=auth()).json()
    assert overview["validation"]["passed"] is True
    assert overview["headline_metrics"]

    insights = client.get(f"/v1/runs/{run_id}/results?section=insights", headers=auth()).json()["insights"]
    assert insights
    assert all(i["validation_status"] == "valid" for i in insights)

    metrics = client.get(f"/v1/runs/{run_id}/results?section=metrics", headers=auth()).json()["metrics"]
    assert any(m["metric_id"] == "total_revenue" for m in metrics)

    report = client.get(f"/v1/runs/{run_id}/results?section=report", headers=auth()).json()["report"]
    titles = [s["title"] for s in report["sections"]]
    assert "Executive Summary" in titles
    assert "Recommendations" in titles
    assert prompt[:30] in report["markdown"]

    dax = client.get(f"/v1/runs/{run_id}/results?section=dax", headers=auth()).json()
    assert dax["summary"]["failed"] == 0
    assert any(m["name"] == "Total Revenue" for m in dax["measures"])
    assert "Base Measures" in dax["groups"]

    quality = client.get(f"/v1/runs/{run_id}/results?section=quality", headers=auth()).json()["data_quality"]
    assert quality["score"] is not None

    # 8. artifacts: view / preview / download
    artifacts = client.get(f"/v1/runs/{run_id}/artifacts", headers=auth()).json()["artifacts"]
    types = {a["artifact_type"] for a in artifacts}
    assert types == {"report", "dax", "dashboard_png", "data_quality"}
    assert not any(a["file_name"].endswith((".pbix", ".pbit")) for a in artifacts)

    png = next(a for a in artifacts if a["artifact_type"] == "dashboard_png")
    content = client.get(f"/v1/artifacts/{png['id']}/content", headers=auth())
    assert content.status_code == 200
    assert content.content[:8] == b"\x89PNG\r\n\x1a\n"

    dax_file = next(a for a in artifacts if a["artifact_type"] == "dax")
    dax_text = client.get(f"/v1/artifacts/{dax_file['id']}/content", headers=auth()).text
    assert "Total Revenue =" in dax_text

    signed = client.get(f"/v1/artifacts/{png['id']}/url", headers=auth()).json()
    assert signed["url"]

    # 9. project persists and history is immutable
    reopened = client.get(f"/v1/projects/{project_id}", headers=auth()).json()
    assert reopened["project"]["status"] == "completed"
    assert reopened["prompt_history"][0]["prompt"] == prompt

    second = client.post(f"/v1/projects/{project_id}/runs",
                         json={"prompt": "Focus only on inventory risk and stock cover."}, headers=auth())
    assert second.status_code == 202
    wait_for(client, second.json()["id"])
    runs = client.get(f"/v1/projects/{project_id}", headers=auth()).json()["runs"]
    assert len(runs) == 2
    assert {r["id"] for r in runs} == {run_id, second.json()["id"]}

    # 10. delete cascades
    deleted = client.delete(f"/v1/projects/{project_id}", headers=auth()).json()
    assert deleted["deleted"] is True
    assert deleted["runs"] == 2
    assert client.get(f"/v1/projects/{project_id}", headers=auth()).status_code == 404
    assert client.get(f"/v1/runs/{run_id}", headers=auth()).status_code == 404


def test_excel_journey(client, sales_xlsx):
    project_id = client.post("/v1/projects", json={"name": "XLSX", "source_type": "excel"},
                             headers=auth()).json()["id"]
    upload = client.post(
        f"/v1/projects/{project_id}/datasets",
        files={"file": ("book.xlsx", sales_xlsx,
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth(),
    )
    assert upload.status_code == 201, upload.text
    profile = upload.json()["profile"]
    assert profile["table_count"] >= 2  # populated sheets are not dropped
    run_id = client.post(f"/v1/projects/{project_id}/runs",
                         json={"prompt": "Summarise revenue by category with key findings."},
                         headers=auth()).json()["id"]
    final = wait_for(client, run_id)
    assert final["status"] == "completed", final.get("error")


def test_unsupported_metric_is_declared_not_fabricated(client, sales_csv):
    project_id = client.post("/v1/projects", json={"name": "Churn ask", "source_type": "csv"},
                             headers=auth()).json()["id"]
    client.post(f"/v1/projects/{project_id}/datasets",
                files={"file": ("sales.csv", sales_csv, "text/csv")}, headers=auth())
    run_id = client.post(
        f"/v1/projects/{project_id}/runs",
        json={"prompt": "Calculate customer churn rate, CAC and our market share versus competitors."},
        headers=auth(),
    ).json()["id"]
    final = wait_for(client, run_id)
    assert final["status"] == "completed"

    overview = client.get(f"/v1/runs/{run_id}/results?section=overview", headers=auth()).json()
    requested = " ".join(u["requested"].lower() for u in overview["unsupported"])
    assert "churn" in requested
    assert "market share" in requested or "acquisition" in requested
    for item in overview["unsupported"]:
        assert item["reason"]

    report = client.get(f"/v1/runs/{run_id}/results?section=report", headers=auth()).json()["report"]
    limitations = next(s for s in report["sections"] if s["title"] == "Limitations")
    assert "NOT SUPPORTED" in limitations["body"] or "not supported" in limitations["body"].lower()

    metrics = client.get(f"/v1/runs/{run_id}/results?section=metrics", headers=auth()).json()["metrics"]
    names = " ".join(m["name"].lower() for m in metrics)
    assert "market share" not in names
    assert "acquisition cost" not in names


def test_run_requires_dataset(client):
    project_id = client.post("/v1/projects", json={"name": "Empty", "source_type": "csv"},
                             headers=auth()).json()["id"]
    resp = client.post(f"/v1/projects/{project_id}/runs", json={"prompt": "Analyse everything please."},
                       headers=auth())
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "NO_DATASET"
    assert "upload" in resp.json()["detail"]["message"].lower()


def test_short_prompt_rejected(client, sales_csv):
    project_id = client.post("/v1/projects", json={"name": "P", "source_type": "csv"},
                             headers=auth()).json()["id"]
    client.post(f"/v1/projects/{project_id}/datasets",
                files={"file": ("s.csv", sales_csv, "text/csv")}, headers=auth())
    assert client.post(f"/v1/projects/{project_id}/runs", json={"prompt": "hi"}, headers=auth()).status_code == 422


def test_concurrent_run_blocked(client, sales_csv):
    project_id = client.post("/v1/projects", json={"name": "P", "source_type": "csv"},
                             headers=auth()).json()["id"]
    client.post(f"/v1/projects/{project_id}/datasets",
                files={"file": ("s.csv", sales_csv, "text/csv")}, headers=auth())
    first = client.post(f"/v1/projects/{project_id}/runs",
                        json={"prompt": "Analyse the revenue trend in detail."}, headers=auth())
    assert first.status_code == 202
    second = client.post(f"/v1/projects/{project_id}/runs",
                         json={"prompt": "Analyse the revenue trend in detail."}, headers=auth())
    assert second.status_code in (409, 202)
    wait_for(client, first.json()["id"])


def test_upload_errors_are_specific(client):
    project_id = client.post("/v1/projects", json={"name": "P", "source_type": "csv"},
                             headers=auth()).json()["id"]

    bad_ext = client.post(f"/v1/projects/{project_id}/datasets",
                          files={"file": ("data.json", b"{}", "application/json")}, headers=auth())
    assert bad_ext.status_code == 400
    assert bad_ext.json()["detail"]["code"] == "UNSUPPORTED_EXTENSION"

    empty = client.post(f"/v1/projects/{project_id}/datasets",
                        files={"file": ("empty.csv", b"", "text/csv")}, headers=auth())
    assert empty.status_code == 400
    assert empty.json()["detail"]["code"] in {"EMPTY_FILE", "INVALID_FILE"}

    oversized = client.post(
        f"/v1/projects/{project_id}/datasets",
        files={"file": ("big.csv", b"a,b\n" + b"1,2\n" * 3_000_000, "text/csv")},
        headers=auth(),
    )
    assert oversized.status_code == 400
    assert oversized.json()["detail"]["code"] == "FILE_TOO_LARGE"
    assert "limit" in oversized.json()["detail"]["message"].lower()


def test_sql_is_disabled_by_default(client):
    body = client.get("/v1/sql/connections", headers=auth()).json()
    assert body["enabled"] is False
    assert body["access"] == "read_only"
    resp = client.post("/v1/projects", json={"name": "SQL", "source_type": "sql"}, headers=auth())
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "SQL_DISABLED"


@pytest.mark.parametrize(
    "statement",
    [
        "DROP TABLE customers",
        "DELETE FROM orders WHERE 1=1",
        "UPDATE orders SET revenue = 0",
        "INSERT INTO orders VALUES (1)",
        "TRUNCATE orders",
        "ALTER TABLE orders ADD COLUMN x int",
        "CREATE TABLE t (id int)",
        "SELECT 1; DROP TABLE orders",
        "GRANT ALL ON orders TO public",
    ],
)
def test_destructive_sql_is_blocked(statement):
    from app.sql.connector import SqlError, assert_read_only

    with pytest.raises(SqlError):
        assert_read_only(statement)


def test_read_only_sql_is_allowed():
    from app.sql.connector import assert_read_only

    assert assert_read_only("SELECT * FROM orders LIMIT 10")
    assert assert_read_only("WITH t AS (SELECT 1 AS a) SELECT * FROM t")
    assert assert_read_only("-- a comment\nSELECT count(*) FROM orders;")


def test_health_reports_no_secrets(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert set(body) == {"status", "store", "llm_provider", "supabase_configured", "sql_connectors_enabled"}
