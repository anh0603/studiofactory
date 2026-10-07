"""Phase 2 test matrix: CRUD, routing, fallback, non-fallback, cost, license, security.

Uses controlled `test`-kind adapters (mock=true, in-process, labeled).
Production router never treats these as live verification.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.ai import adapters as A  # noqa: E402
from app.ai.circuit import CircuitBreaker  # noqa: E402
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
    # Fresh isolated credential store per test (Settings is frozen; inject directly).
    import app.credentials.store as store_mod
    fresh = store_mod.FernetCredentialStore(key_file=str(tmp_path / "master.key"),
                                            data_file=str(tmp_path / "creds.enc"))
    monkeypatch.setattr(ai_api, "_store", fresh)
    # Fresh breaker per test (global singleton in app.ai.circuit).
    import app.ai.circuit as circuit_mod
    monkeypatch.setattr(circuit_mod.breaker, "_entries", {})
    A._ADAPTERS.clear()
    yield TestClient(app)
    A._ADAPTERS.clear()


def make_provider(client, name="P", adapter_key="test", base_url=""):
    res = client.post("/api/v1/ai/providers",
                      json={"name": name, "adapter_key": adapter_key, "base_url": base_url})
    assert res.status_code == 201, res.text
    return res.json()["data"]


def save_cred(client, provider_id, secret="sk-test-secret-1234"):
    res = client.post("/api/v1/ai/credentials",
                      json={"provider_id": provider_id, "secret": secret})
    assert res.status_code == 201, res.text
    return res.json()["data"]


def make_model(client, provider_id, name="M", caps=("TEXT",), priority=100,
               enabled=True, cost="FREE", lic="VERIFIED_COMMERCIAL"):
    res = client.post("/api/v1/ai/models", json={
        "provider_id": provider_id, "name": name, "model_id": f"mid-{name}",
        "capabilities": list(caps), "priority": priority, "enabled": enabled,
        "cost_class": cost, "license_status": lic})
    assert res.status_code == 201, res.text
    return res.json()["data"]


def scripted(names_scripts: dict[str, list]):
    for name, steps in names_scripts.items():
        adapter = A.TestAdapter()
        for ok, text, code in steps:
            adapter.queue(ok, text, code)
        A.register_adapter(f"test:{name}", adapter)
    return names_scripts


def adapter_for(client, provider_name, steps):
    adapter = A.TestAdapter()
    for ok, text, code in steps:
        adapter.queue(ok, text, code)
    A._ADAPTERS["test"] = adapter
    return adapter


# ------------------------------------------------------------------- basic

def test_provider_model_credential_crud(client):
    p = make_provider(client, "ProvA")
    assert p["credential_configured"] is False
    c = save_cred(client, p["id"])
    assert c == {"configured": True, "ref": c["ref"]}
    m = make_model(client, p["id"], "M1")
    assert m["credential_ref"] == c["ref"]
    # No secret anywhere.
    for payload in (p, c, m):
        assert "sk-test" not in str(payload)
    res = client.patch(f"/api/v1/ai/models/{m['id']}", json={"priority": 5})
    assert res.json()["data"]["priority"] == 5
    res = client.get("/api/v1/ai/credentials")
    assert res.json()["data"][0] == {"configured": True, "ref": c["ref"],
                                     "provider_id": p["id"], "last_verified_at": None}
    res = client.delete(f"/api/v1/ai/credentials/{c['ref']}")
    assert res.status_code == 200
    assert client.get(f"/api/v1/ai/models/{m['id']}").json()["data"]["enabled"] is False


def test_capability_test_marks_verified_only_via_adapter(client):
    p = make_provider(client)
    save_cred(client, p["id"])
    m = make_model(client, p["id"])
    A._ADAPTERS["test"] = A.TestAdapter()
    res = client.post(f"/api/v1/ai/models/{m['id']}/test", json={"capability": "TEXT"})
    assert res.json()["data"]["state"] == "CAPABILITY_VERIFIED"
    assert res.json()["data"]["mock"] is True
    # Model list alone is never proof: real adapter returns AUTHENTICATED for list-only.
    assert "sk-test" not in res.text


# ------------------------------------------------------------------ routing

def test_priority_routing_and_disabled_excluded(client):
    p = make_provider(client)
    save_cred(client, p["id"])
    make_model(client, p["id"], "Low", priority=10)
    make_model(client, p["id"], "High", priority=90)
    make_model(client, p["id"], "Off", priority=999, enabled=False)
    adapter = A.TestAdapter()
    adapter.queue(True, "hello-from-router")
    A._ADAPTERS["test"] = adapter
    res = client.post("/api/v1/ai/router/generate",
                      json={"task": "SCRIPT_GENERATION", "capability": "TEXT", "prompt": "hi"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["data"]["output"] == "hello-from-router"
    assert body["trace"][0]["model"] == "High"
    assert all(t["model"] != "Off" for t in body["trace"])


def test_capability_mismatch_and_unhealthy_excluded(client):
    p = make_provider(client)
    save_cred(client, p["id"])
    make_model(client, p["id"], "ImgOnly", caps=("IMAGE",))
    m2 = make_model(client, p["id"], "Sick")
    client.patch(f"/api/v1/ai/models/{m2['id']}", json={"health_status": "UNAVAILABLE"})
    make_model(client, p["id"], "Good")
    A._ADAPTERS["test"] = A.TestAdapter()
    res = client.get("/api/v1/ai/router/eligible", params={"capability": "TEXT"})
    names = [m["name"] for m in res.json()["data"]["eligible"]]
    assert names == ["Good"]
    reasons = {e["reason"] for e in res.json()["data"]["excluded"]}
    assert "CAPABILITY_MISMATCH" in reasons and "UNHEALTHY_UNAVAILABLE" in reasons


# ------------------------------------------------------------------ fallback

def test_quota_fallback_chain_recorded(client):
    p1 = make_provider(client, "PA")
    save_cred(client, p1["id"])
    make_model(client, p1["id"], "A", priority=100)
    p2 = make_provider(client, "PB")
    save_cred(client, p2["id"])
    make_model(client, p2["id"], "B", priority=50)

    a1, a2 = A.TestAdapter(), A.TestAdapter()
    a1.queue(False, "quota hit", "QUOTA_EXHAUSTED")
    a2.queue(True, "recovered-output")
    calls = {"n": 0}

    import app.ai.router as R
    orig = R.get_adapter
    def fake(provider, base_url=""):
        calls["n"] += 1
        return a1 if calls["n"] == 1 else a2
    R.get_adapter = fake
    try:
        res = client.post("/api/v1/ai/router/generate",
                          json={"task": "SCRIPT_GENERATION", "capability": "TEXT", "prompt": "x"})
    finally:
        R.get_adapter = orig
    assert res.status_code == 200, res.text
    trace = res.json()["trace"]
    assert [t["model"] for t in trace] == ["A", "B"]
    assert trace[0]["error_code"] == "QUOTA_EXHAUSTED"
    assert trace[0]["fallback_reason"] == "fallback"
    assert trace[1]["status"] == "SUCCESS"
    # Activity recorded with full trace fields, no secret.
    act = client.get("/api/v1/ai/activity").json()["data"]
    assert len(act) == 2
    assert all(set(a) >= {"request_id", "task", "provider", "model", "attempt",
                          "latency_ms", "status", "mock"} for a in act)
    assert "sk-test" not in str(act)


def test_all_fail_terminal_typed_error(client):
    p = make_provider(client)
    save_cred(client, p["id"])
    make_model(client, p["id"], "A")
    adapter = A.TestAdapter()
    adapter.queue(False, "down", "PROVIDER_UNAVAILABLE")
    A._ADAPTERS["test"] = adapter
    res = client.post("/api/v1/ai/router/generate",
                      json={"task": "SCRIPT_GENERATION", "capability": "TEXT", "prompt": "x"})
    assert res.status_code == 200
    body = res.json()
    assert body["data"] is None
    assert body["error"]["code"] == "PROVIDER_UNAVAILABLE"
    assert body["error"]["request_id"]


# -------------------------------------------------------------- non-fallback

@pytest.mark.parametrize("code", ["BAD_REQUEST", "AUTH_FAILED", "CONTENT_POLICY_BLOCK"])
def test_non_retryable_no_fallback(client, code):
    p1 = make_provider(client, "PA")
    save_cred(client, p1["id"])
    make_model(client, p1["id"], "A", priority=100)
    p2 = make_provider(client, "PB")
    save_cred(client, p2["id"])
    make_model(client, p2["id"], "B", priority=50)
    import app.ai.router as R
    used = []

    def fake(provider, base_url=""):
        a = A.TestAdapter()
        a.queue(False, "fatal", code)
        used.append(provider)
        return a
    orig = R.get_adapter
    R.get_adapter = fake
    try:
        res = client.post("/api/v1/ai/router/generate",
                          json={"task": "SCRIPT_GENERATION", "capability": "TEXT", "prompt": "x"})
    finally:
        R.get_adapter = orig
    body = res.json()
    assert len(body["trace"]) == 1  # no fallback
    assert len(used) == 1


# ---------------------------------------------------------------- cost/license

@pytest.mark.parametrize("cost", ["PAID", "UNKNOWN", "TRIAL"])
def test_cost_block_zero_network_calls(client, cost):
    p = make_provider(client)
    save_cred(client, p["id"])
    m = make_model(client, p["id"], "Exp", cost=cost)
    adapter = A.TestAdapter()
    A._ADAPTERS["test"] = adapter
    res = client.post("/api/v1/ai/router/generate",
                      json={"task": "SCRIPT_GENERATION", "capability": "TEXT",
                            "prompt": "x", "allow_paid": False,
                            "manual_model_id": m["id"]})
    assert res.status_code == 402
    assert res.json()["error"]["code"] == "PAID_MODEL_BLOCKED"
    assert adapter.calls == []  # ZERO network request


def test_license_block_zero_network_calls(client):
    p = make_provider(client)
    save_cred(client, p["id"])
    m = make_model(client, p["id"], "Risky", lic="UNVERIFIED")
    adapter = A.TestAdapter()
    A._ADAPTERS["test"] = adapter
    res = client.post("/api/v1/ai/router/generate",
                      json={"task": "SCRIPT_GENERATION", "capability": "TEXT",
                            "prompt": "x", "require_commercial": True,
                            "manual_model_id": m["id"]})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "LICENSE_BLOCKED"
    assert adapter.calls == []


def test_circuit_opens_after_repeated_failures():
    from app.ai.circuit import CircuitBreaker
    cb = CircuitBreaker(threshold=3, cooldown_s=60)
    for _ in range(3):
        cb.record_failure("m1")
    ok, state = cb.can_use("m1")
    assert ok is False and state == "OPEN"
    cb.record_success("m1")
    ok, _ = cb.can_use("m1")
    assert ok is True


# ----------------------------------------------------------------- security

def test_empty_pool_is_unavailable_not_paid_blocked(client):
    res = client.post("/api/v1/ai/router/generate",
                      json={"task": "T", "capability": "TEXT", "prompt": "x"})
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "MODEL_UNAVAILABLE"


def test_secret_absent_everywhere(client):
    p = make_provider(client)
    save_cred(client, p["id"], secret="sk-ultra-secret-9999")
    m = make_model(client, p["id"])
    A._ADAPTERS["test"] = A.TestAdapter()
    client.post("/api/v1/ai/router/generate",
                json={"task": "T", "capability": "TEXT", "prompt": "x"})
    blobs = [
        client.get("/api/v1/ai/providers").text,
        client.get("/api/v1/ai/models").text,
        client.get("/api/v1/ai/credentials").text,
        client.get("/api/v1/ai/activity").text,
        client.get("/api/v1/ai/usage").text,
        client.get("/api/v1/ai/router/eligible").text,
        client.get("/api/v1/diagnostics").text,
        client.get("/api/v1/does-not-exist").text,
    ]
    for b in blobs:
        assert "sk-ultra-secret-9999" not in b, b[:200]


def test_ssrf_provider_url_rejected(client):
    for bad in ("http://169.254.169.254/", "ftp://example.com/x",
                "http://10.0.0.5/", "http://192.168.1.1/",
                "http://metadata.google.internal/", "http://svc.internal/"):
        res = client.post("/api/v1/ai/providers",
                          json={"name": "evil", "adapter_key": "custom", "base_url": bad})
        assert res.status_code == 400, bad


def test_loopback_provider_url_allowed_for_local_gateways(client):
    """Local-first (project.md #3): operator-configured loopback gateways
    (Ollama, LM Studio, FreeLLMAPI) must be registrable. Phase B."""
    for good in ("http://localhost:3001/v1", "http://127.0.0.1:3001/v1"):
        res = client.post("/api/v1/ai/providers",
                          json={"name": "local-gw", "adapter_key": "custom", "base_url": good})
        assert res.status_code == 201, good


def test_keyless_model_skips_credential_gate(client):
    """Phase B6: metadata {"keyless": true} (pollinations) is eligible without
    a credential; the same model without the flag stays CREDENTIAL_MISSING."""
    from app.ai.router import RouteInput, Router
    base = {"id": "m1", "provider_id": "p1", "credential_ref": "",
            "name": "FreeImg", "model_id": "flux", "capabilities": ["IMAGE"],
            "priority": 100, "enabled": True, "cost_class": "FREE",
            "license_status": "UNKNOWN", "health_status": "UNKNOWN"}
    r = Router()
    eligible, _ = r.eligible([{**base, "metadata": {"keyless": True}}], set(),
                             RouteInput(task="T", capability="IMAGE"))
    assert [m["id"] for m in eligible] == ["m1"]
    eligible2, excluded = r.eligible([base], set(),
                                     RouteInput(task="T", capability="IMAGE"))
    assert eligible2 == []
    assert excluded[0]["reason"] == "CREDENTIAL_MISSING"


def test_empty_content_never_propagates_none():
    """Real bug (Phase 11B): provider content:null must become typed failure."""
    import json as _json
    from app.ai.adapters import AdapterRequest, OpenAICompatibleAdapter
    from app.ai.director import extract_json
    import pytest as _p
    with _p.raises(ValueError):
        extract_json(None)
    with _p.raises(ValueError):
        extract_json("   ")

    class _Resp:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return _json.dumps(
                {"choices": [{"message": {"content": None}}]}).encode()

    import urllib.request as _u
    orig = _u.urlopen
    _u.urlopen = lambda *a, **k: _Resp()
    try:
        res = OpenAICompatibleAdapter("https://api.example.invalid").generate(
            AdapterRequest(task="T", capability="TEXT", prompt="hi",
                           model_id="m"), "sk-x")
    finally:
        _u.urlopen = orig
    assert res.ok is False and res.error_code == "INVALID_RESPONSE"
