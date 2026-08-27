"""Authentication, authorization and tenant-isolation tests."""
from __future__ import annotations

import pytest

from tests.conftest import ADMIN_A, ADMIN_B, auth


def test_public_config_contains_no_secrets(client):
    body = client.get("/v1/config").json()
    blob = str(body).lower()
    for forbidden in ("service_role", "jwt_secret", "openai_api_key", "gemini_api_key", "password", "dsn"):
        assert forbidden not in blob
    assert "supported_sources" in body


def test_admin_login_succeeds(client):
    resp = client.get("/v1/me", headers=auth())
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"


def test_missing_credentials_rejected(client):
    assert client.get("/v1/me").status_code == 401
    assert client.get("/v1/projects").status_code == 401


def test_invalid_credentials_rejected(client):
    resp = client.get("/v1/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert resp.status_code in (401, 403)


def test_malformed_authorization_header_rejected(client):
    assert client.get("/v1/me", headers={"Authorization": "Basic abc"}).status_code == 401


def test_expired_session_rejected(monkeypatch, workspace):
    """A JWT past its exp must be refused with SESSION_EXPIRED."""
    import base64, hashlib, hmac, json, time

    from app.security import AuthError, decode_jwt_hs256

    secret = "test-secret"

    def encode(payload):
        head = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).rstrip(b"=").decode()
        body = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
        sig = hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest()
        return f"{head}.{body}.{base64.urlsafe_b64encode(sig).rstrip(b'=').decode()}"

    valid = encode({"sub": ADMIN_A, "email": "a@x.com", "exp": time.time() + 600})
    assert decode_jwt_hs256(valid, secret)["sub"] == ADMIN_A

    expired = encode({"sub": ADMIN_A, "email": "a@x.com", "exp": time.time() - 10})
    with pytest.raises(AuthError) as exc:
        decode_jwt_hs256(expired, secret)
    assert exc.value.code == "SESSION_EXPIRED"


def test_tampered_signature_rejected(workspace):
    import base64, hashlib, hmac, json, time

    from app.security import AuthError, decode_jwt_hs256

    head = base64.urlsafe_b64encode(json.dumps({"alg": "HS256"}).encode()).rstrip(b"=").decode()
    body = base64.urlsafe_b64encode(json.dumps({"sub": ADMIN_A, "exp": time.time() + 60}).encode()).rstrip(b"=").decode()
    bad = hmac.new(b"wrong-secret", f"{head}.{body}".encode(), hashlib.sha256).digest()
    token = f"{head}.{body}.{base64.urlsafe_b64encode(bad).rstrip(b'=').decode()}"
    with pytest.raises(AuthError):
        decode_jwt_hs256(token, "test-secret")


def test_non_admin_profile_is_denied(workspace):
    """Authorization comes from profiles.role, not from token metadata."""
    from app.security import AuthError, resolve_principal
    from app.store import get_store

    get_store().insert("profiles", {"id": ADMIN_B, "email": "viewer@x.com", "role": "viewer"})
    with pytest.raises(AuthError) as exc:
        resolve_principal(f"dev.{ADMIN_B}")
    assert exc.value.status == 403


def test_admin_cannot_read_another_admins_project(client):
    created = client.post("/v1/projects", json={"name": "A private", "source_type": "csv"}, headers=auth(ADMIN_A))
    project_id = created.json()["id"]

    assert client.get(f"/v1/projects/{project_id}", headers=auth(ADMIN_A)).status_code == 200
    assert client.get(f"/v1/projects/{project_id}", headers=auth(ADMIN_B)).status_code == 403
    assert client.delete(f"/v1/projects/{project_id}", headers=auth(ADMIN_B)).status_code == 403

    listing = client.get("/v1/projects", headers=auth(ADMIN_B)).json()["projects"]
    assert all(p["id"] != project_id for p in listing)


def test_owner_id_cannot_be_spoofed_by_client(client):
    resp = client.post(
        "/v1/projects",
        json={"name": "Spoof", "source_type": "csv", "owner_id": ADMIN_B, "role": "superadmin"},
        headers=auth(ADMIN_A),
    )
    assert resp.status_code == 201
    assert resp.json()["owner_id"] == ADMIN_A


def test_cross_tenant_artifact_access_denied(client, sales_csv):
    project_id = client.post("/v1/projects", json={"name": "P", "source_type": "csv"},
                             headers=auth(ADMIN_A)).json()["id"]
    client.post(
        f"/v1/projects/{project_id}/datasets",
        files={"file": ("sales.csv", sales_csv, "text/csv")},
        headers=auth(ADMIN_A),
    )
    run_id = client.post(f"/v1/projects/{project_id}/runs",
                         json={"prompt": "Analyse revenue by category and region."},
                         headers=auth(ADMIN_A)).json()["id"]
    _wait(client, run_id)

    artifacts = client.get(f"/v1/runs/{run_id}/artifacts", headers=auth(ADMIN_A)).json()["artifacts"]
    assert artifacts
    artifact_id = artifacts[0]["id"]
    assert client.get(f"/v1/artifacts/{artifact_id}/content", headers=auth(ADMIN_A)).status_code == 200
    assert client.get(f"/v1/artifacts/{artifact_id}/content", headers=auth(ADMIN_B)).status_code == 403
    assert client.get(f"/v1/runs/{run_id}/results", headers=auth(ADMIN_B)).status_code == 403


def test_storage_paths_are_tenant_isolated():
    from app.store import storage_key

    key = storage_key("owner-1", "project-1", "inputs", "../../etc/passwd")
    assert key.startswith("owner-1/project-1/")
    assert ".." not in key
    assert "/etc/" not in key


def test_audit_log_records_actions_and_scrubs_secrets(client):
    client.get("/v1/me", headers=auth())
    client.post("/v1/projects", json={"name": "Audited", "source_type": "csv"}, headers=auth())
    entries = client.get("/v1/audit", headers=auth()).json()["entries"]
    actions = {e["action"] for e in entries}
    assert "LOGIN" in actions and "PROJECT_CREATED" in actions

    from app.audit import scrub

    cleaned = scrub({"password": "hunter2", "api_key": "sk-abcdef123456", "dsn": "postgresql://u:p@h/db", "rows": 10})
    assert cleaned["password"] == "[redacted]"
    assert cleaned["api_key"] == "[redacted]"
    assert cleaned["dsn"] == "[redacted]"
    assert cleaned["rows"] == 10


def _wait(client, run_id, timeout=180):
    import time

    from tests.conftest import auth as _auth

    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/v1/runs/{run_id}", headers=_auth()).json()
        if body["status"] not in ("queued", "running"):
            return body
        time.sleep(0.3)
    raise AssertionError("run did not finish in time")
