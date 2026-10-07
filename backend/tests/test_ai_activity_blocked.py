"""PASS 8 regression: a user-triggered AI operation must ALWAYS leave activity.

Before this fix, operations refused by pre-network gates (no model, no
credential, paid blocked, license blocked) produced `attempts == []` and were
never persisted, so `/ai/activity` was empty and `/ai/usage` reported
`requests: 0` even though the operator had pressed Generate.

Contract locked here:
- blocked row => status=BLOCKED, attempt=0, latency_ms=0, provider/model empty,
  mock=false, error_category = typed code.
- a blocked row is NOT a provider request: `attempt` stays 0 so readers can
  derive `network_called = attempt >= 1`.
- successful provider rows are unaffected and still carry provider/model/latency.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.ai import adapters as A  # noqa: E402
from app.api.v1 import ai as ai_api  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db import models as _models  # noqa: E402,F401
from app.db.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

    def override_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app = create_app()
    app.dependency_overrides[get_db] = override_db
    import app.credentials.store as store_mod
    fresh = store_mod.FernetCredentialStore(key_file=str(tmp_path / "master.key"),
                                            data_file=str(tmp_path / "creds.enc"))
    monkeypatch.setattr(ai_api, "_store", fresh)
    import app.ai.circuit as circuit_mod
    monkeypatch.setattr(circuit_mod.breaker, "_entries", {})
    A._ADAPTERS.clear()
    yield TestClient(app)
    A._ADAPTERS.clear()


def make_provider(client, name, adapter_key="test"):
    res = client.post("/api/v1/ai/providers",
                      json={"name": name, "adapter_key": adapter_key})
    assert res.status_code == 201, res.text
    return res.json()["data"]


def make_model(client, provider_id, name="M", caps=("TEXT",), cost="FREE",
               lic="VERIFIED_COMMERCIAL", enabled=True):
    res = client.post("/api/v1/ai/models", json={
        "provider_id": provider_id, "name": name, "model_id": f"mid-{name}",
        "capabilities": list(caps), "priority": 100, "enabled": enabled,
        "cost_class": cost, "license_status": lic})
    assert res.status_code == 201, res.text
    return res.json()["data"]


def save_cred(client, provider_id, secret="sk-test-secret-1234"):
    res = client.post("/api/v1/ai/credentials",
                      json={"provider_id": provider_id, "secret": secret})
    assert res.status_code == 201, res.text
    return res.json()["data"]


def events(client, capability=None):
    rows = client.get("/api/v1/ai/activity?limit=200").json()["data"]
    return [r for r in rows if capability is None or r["capability"] == capability]


def assert_pre_network_block(row):
    """A blocked row must never look like a provider call."""
    assert row["status"] == "BLOCKED"
    assert row["attempt"] == 0, "blocked row must not claim a provider attempt"
    assert row["latency_ms"] == 0, "blocked row must not claim network latency"
    assert row["provider"] == ""
    assert row["model"] == ""
    assert row["mock"] is False
    assert row["error_category"]


# ------------------------------------------------------------- blocked cases

def test_blocked_model_unavailable_is_recorded(client):
    """No model registered at all -> the press still leaves a trace."""
    res = client.post("/api/v1/ai/router/generate",
                      json={"task": "SCRIPT_GENERATION", "capability": "TEXT",
                            "prompt": "hello"})
    assert res.status_code == 404, res.text
    assert res.json()["error"]["code"] == "MODEL_UNAVAILABLE"

    rows = events(client, "TEXT")
    assert len(rows) == 1, rows
    assert_pre_network_block(rows[0])
    assert rows[0]["error_category"] == "MODEL_UNAVAILABLE"


def test_blocked_credential_missing_is_recorded(client):
    p = make_provider(client, "NoCred")
    make_model(client, p["id"])
    res = client.post("/api/v1/ai/router/generate",
                      json={"task": "SCRIPT_GENERATION", "capability": "TEXT",
                            "prompt": "hello"})
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "CREDENTIAL_MISSING"

    rows = events(client, "TEXT")
    assert len(rows) == 1, rows
    assert_pre_network_block(rows[0])
    assert rows[0]["error_category"] == "CREDENTIAL_MISSING"


def test_blocked_paid_model_is_recorded(client):
    p = make_provider(client, "Paid")
    save_cred(client, p["id"])
    make_model(client, p["id"], name="PaidModel", cost="PAID")
    res = client.post("/api/v1/ai/router/generate",
                      json={"task": "SCRIPT_GENERATION", "capability": "TEXT",
                            "prompt": "hello", "allow_paid": False})
    assert res.status_code == 402, res.text
    assert res.json()["error"]["code"] == "PAID_MODEL_BLOCKED"

    rows = events(client, "TEXT")
    assert len(rows) == 1, rows
    assert_pre_network_block(rows[0])
    assert rows[0]["error_category"] == "PAID_MODEL_BLOCKED"


def test_blocked_license_is_recorded(client):
    p = make_provider(client, "Unverified")
    save_cred(client, p["id"])
    make_model(client, p["id"], name="NonComm", lic="UNKNOWN")
    res = client.post("/api/v1/ai/router/generate",
                      json={"task": "SCRIPT_GENERATION", "capability": "TEXT",
                            "prompt": "hello", "require_commercial": True})
    assert res.status_code == 403, res.text
    assert res.json()["error"]["code"] == "LICENSE_BLOCKED"

    rows = events(client, "TEXT")
    assert len(rows) == 1, rows
    assert_pre_network_block(rows[0])
    assert rows[0]["error_category"] == "LICENSE_BLOCKED"


def test_blocked_director_is_recorded(client):
    """Director path uses its own recorder; it must behave the same."""
    proj = client.post("/api/v1/projects", json={"name": "P"}).json()["data"]
    res = client.post(f"/api/v1/projects/{proj['id']}/director",
                      json={"idea": "a dog lost in a park"})
    assert res.status_code == 404, res.text
    assert res.json()["error"]["code"] == "MODEL_UNAVAILABLE"

    rows = events(client, "STORY")
    assert len(rows) == 1, rows
    assert_pre_network_block(rows[0])
    assert rows[0]["error_category"] == "MODEL_UNAVAILABLE"


def test_blocked_media_is_recorded(client):
    """IMAGE path goes through pipeline.generate_bytes -> same recorder."""
    proj = client.post("/api/v1/projects", json={"name": "P"}).json()["data"]
    scene = client.post(f"/api/v1/projects/{proj['id']}/scenes",
                        json={"order": 1, "description": "d",
                              "visual_prompt": "v"}).json()["data"]
    res = client.post(
        f"/api/v1/projects/{proj['id']}/scenes/{scene['id']}/image", json={})
    assert res.status_code == 404, res.text
    assert res.json()["error"]["code"] == "MODEL_UNAVAILABLE"

    rows = events(client, "IMAGE")
    assert len(rows) == 1, rows
    assert_pre_network_block(rows[0])
    assert rows[0]["error_category"] == "MODEL_UNAVAILABLE"
    # The media job must be FAILED, never SUCCEEDED.
    jobs = client.get(f"/api/v1/jobs?project_id={proj['id']}").json()["data"]
    assert [j["status"] for j in jobs] == ["FAILED"], jobs
    # And no artifact may exist.
    assert client.get(f"/api/v1/projects/{proj['id']}/artifacts").json()["data"] == []


# --------------------------------------------------------------- aggregation

def test_usage_model_breakdown_excludes_pre_network_blocks(client):
    """A blocked row has no model, so it must not appear as an empty entry."""
    client.post("/api/v1/ai/router/generate",
                json={"task": "SCRIPT_GENERATION", "capability": "TEXT", "prompt": "a"})
    usage = client.get("/api/v1/ai/usage").json()["data"]
    assert usage["by_model"] == [], usage["by_model"]


def test_usage_counts_blocked_as_failed_not_successful(client):
    client.post("/api/v1/ai/router/generate",
                json={"task": "SCRIPT_GENERATION", "capability": "TEXT", "prompt": "a"})
    client.post("/api/v1/ai/router/generate",
                json={"task": "SCRIPT_GENERATION", "capability": "TEXT", "prompt": "b"})

    usage = client.get("/api/v1/ai/usage").json()["data"]
    assert usage["requests"] == 2
    assert usage["successful"] == 0, "a pre-network block is not a success"
    assert usage["failed"] == 2
    assert usage["fallbacks"] == 0
    assert usage["avg_latency_ms"] == 0.0
    assert usage["cost"] is None
    assert usage["cost_state"] == "UNKNOWN"


def test_usage_mixes_real_success_and_block_correctly(client):
    """One provider answer + one blocked call must not be conflated."""
    p = make_provider(client, "Prov")
    save_cred(client, p["id"])
    m = make_model(client, p["id"], name="Live")
    adapter = A.TestAdapter()
    adapter.queue(True, "real-ish output from scripted adapter", "SUCCESS")
    A._ADAPTERS["test"] = adapter

    ok = client.post("/api/v1/ai/router/generate",
                     json={"task": "SCRIPT_GENERATION", "capability": "TEXT",
                           "prompt": "hi"})
    assert ok.status_code == 200, ok.text

    # Now block the same model with a paid-only policy.
    client.patch(f"/api/v1/ai/models/{m['id']}", json={"cost_class": "PAID"})
    blocked = client.post("/api/v1/ai/router/generate",
                          json={"task": "SCRIPT_GENERATION", "capability": "TEXT",
                                "prompt": "hi"})
    assert blocked.status_code == 402, blocked.text

    rows = events(client, "TEXT")
    statuses = sorted(r["status"] for r in rows)
    assert statuses == ["BLOCKED", "SUCCESS"], rows
    success_row = next(r for r in rows if r["status"] == "SUCCESS")
    assert success_row["attempt"] == 1
    assert success_row["provider"] == "Prov"
    assert success_row["mock"] is True, "scripted adapter must stay labeled mock"

    usage = client.get("/api/v1/ai/usage").json()["data"]
    assert usage["requests"] == 2
    assert usage["successful"] == 1
    assert usage["failed"] == 1


def test_network_called_is_derivable_from_attempt(client):
    """Readers must be able to tell a provider call from a pre-network block."""
    client.post("/api/v1/ai/router/generate",
                json={"task": "SCRIPT_GENERATION", "capability": "TEXT", "prompt": "a"})
    p = make_provider(client, "Prov2")
    save_cred(client, p["id"])
    make_model(client, p["id"], name="Live2")
    adapter = A.TestAdapter()
    adapter.queue(True, "output", "SUCCESS")
    A._ADAPTERS["test"] = adapter
    client.post("/api/v1/ai/router/generate",
                json={"task": "SCRIPT_GENERATION", "capability": "TEXT", "prompt": "b"})

    rows = events(client, "TEXT")
    blocked = [r for r in rows if r["status"] == "BLOCKED"]
    called = [r for r in rows if r["attempt"] >= 1]
    assert len(blocked) == 1 and len(called) == 1, rows
    assert all(r["latency_ms"] == 0 for r in blocked)


# ------------------------------------------------------------------ secrets

def test_blocked_rows_never_contain_a_secret(client):
    p = make_provider(client, "SecProv")
    secret = "sk-live-DO-NOT-LEAK-9876"
    save_cred(client, p["id"], secret)
    make_model(client, p["id"], name="Leaky", cost="PAID")
    client.post("/api/v1/ai/router/generate",
                json={"task": "SCRIPT_GENERATION", "capability": "TEXT", "prompt": "a"})

    body = client.get("/api/v1/ai/activity?limit=200").text
    assert secret not in body
    assert "DO-NOT-LEAK" not in body
    usage = client.get("/api/v1/ai/usage").text
    assert secret not in usage and "DO-NOT-LEAK" not in usage