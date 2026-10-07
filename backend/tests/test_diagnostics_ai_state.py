"""PASS 8: diagnostics must report the AI registry honestly, without secrets.

Before this pass `/diagnostics` hardcoded `CONFIG_REQUIRED` with "lands in
Phase 2/6/7" messages while the router/publisher/scheduler all existed. Now each
of those subsystems is probed for real, and a subsystem that is not configured
must say CONFIG_REQUIRED rather than looking healthy.
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
from app.api.v1 import ai as ai_api  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db import models as _models  # noqa: E402,F401
from app.db.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402

ALLOWED = ("HEALTHY", "UNAVAILABLE", "UNKNOWN", "CONFIG_REQUIRED")


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


def checks(client):
    res = client.get("/api/v1/diagnostics")
    assert res.status_code == 200, res.text
    return res.json()["checks"]


def test_diagnostics_covers_every_required_subsystem(client):
    got = checks(client)
    for key in ("backend", "database", "storage", "ffmpeg", "ffprobe",
                "ai_providers", "ai_models", "ai_credentials",
                "scheduler", "publisher"):
        assert key in got, f"missing diagnostic check: {key}"
        assert got[key]["status"] in ALLOWED, got[key]


def test_empty_registry_is_config_required_not_healthy(client):
    got = checks(client)
    assert got["ai_providers"]["status"] == "CONFIG_REQUIRED"
    assert got["ai_models"]["status"] == "CONFIG_REQUIRED"
    assert got["ai_credentials"]["status"] == "CONFIG_REQUIRED"
    # Stale phase messages must be gone.
    dumped = str(got)
    assert "Phase 2" not in dumped and "Phase 6" not in dumped and "Phase 7" not in dumped


def test_publisher_reports_missing_connections(client):
    got = checks(client)
    assert got["publisher"]["status"] == "CONFIG_REQUIRED"
    assert "kết nối" in got["publisher"]["detail"]


def test_configured_registry_reports_healthy_without_secrets(client):
    p = client.post("/api/v1/ai/providers",
                    json={"name": "Prov", "adapter_key": "test"}).json()["data"]
    secret = "sk-diag-secret-5555"
    client.post("/api/v1/ai/credentials", json={"provider_id": p["id"], "secret": secret})
    client.post("/api/v1/ai/models", json={
        "provider_id": p["id"], "name": "M", "model_id": "mid-M",
        "capabilities": ["STORY", "TEXT"], "priority": 10,
        "cost_class": "FREE", "license_status": "VERIFIED_COMMERCIAL"})

    got = checks(client)
    assert got["ai_providers"]["status"] == "HEALTHY"
    assert got["ai_credentials"]["status"] == "HEALTHY"
    assert got["ai_models"]["status"] == "HEALTHY"
    # Capability counts must be reported per capability, from the real router.
    assert "STORY=1" in got["ai_models"]["detail"]

    body = client.get("/api/v1/diagnostics").text
    assert secret not in body
    assert "sk-diag-secret" not in body


def test_paid_only_model_is_config_required(client):
    """Cost policy must be visible in diagnostics, not silently 'healthy'."""
    p = client.post("/api/v1/ai/providers",
                    json={"name": "Paid", "adapter_key": "test"}).json()["data"]
    client.post("/api/v1/ai/credentials",
                json={"provider_id": p["id"], "secret": "sk-x-1111"})
    client.post("/api/v1/ai/models", json={
        "provider_id": p["id"], "name": "PaidM", "model_id": "mid-paid",
        "capabilities": ["TEXT"], "cost_class": "PAID",
        "license_status": "VERIFIED_COMMERCIAL"})
    got = checks(client)
    # allow_paid defaults to false -> nothing is routable.
    assert got["ai_models"]["status"] == "CONFIG_REQUIRED"
    assert "TEXT=0" in got["ai_models"]["detail"]


def test_diagnostics_never_500_on_broken_probe(client, monkeypatch):
    """A failing probe degrades to UNKNOWN, it does not break the page."""
    import app.diagnostics.service as svc

    def boom(*_a, **_k):
        raise RuntimeError("probe exploded")

    monkeypatch.setattr(svc, "_check_ai_models", boom)
    got = checks(client)
    assert got["ai_models"]["status"] == "UNKNOWN"
    assert "probe exploded" not in got["ai_models"]["detail"]  # class name only
    assert "RuntimeError" in got["ai_models"]["detail"]