"""Phase 1 foundation tests: no AI, no network, no mocks of production."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient  # noqa: E402

from app.core.scrub import scrub  # noqa: E402
from app.credentials.store import FernetCredentialStore  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db import models as _models  # noqa: E402,F401 - register tables
from app.db.session import engine  # noqa: E402
from app.main import create_app  # noqa: E402
from app.storage.local import LocalStorage, PathJailError  # noqa: E402

client = TestClient(create_app())


def test_health_has_request_id():
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["request_id"]
    assert res.headers["X-Request-Id"] == body["request_id"]


def test_unknown_route_uses_typed_error_without_secret():
    res = client.get("/api/v1/does-not-exist")
    assert res.status_code == 404
    body = res.json()
    assert body["error"]["code"] == "NOT_FOUND"
    assert body["error"]["request_id"]
    assert res.headers.get("X-Request-Id") == body["error"]["request_id"]


def test_diagnostics_real_shape_no_fake_healthy():
    import shutil
    res = client.get("/api/v1/diagnostics")
    assert res.status_code == 200
    body = res.json()
    assert body["request_id"]
    checks = body["checks"]
    for key in ("backend", "database", "storage", "ffmpeg"):
        assert key in checks
        assert checks[key]["status"] in ("HEALTHY", "UNAVAILABLE", "UNKNOWN", "CONFIG_REQUIRED")
    # Honest either way: HEALTHY iff a real binary exists, else UNAVAILABLE.
    if shutil.which("ffmpeg"):
        assert checks["ffmpeg"]["status"] == "HEALTHY"
    else:
        assert checks["ffmpeg"]["status"] == "UNAVAILABLE"
    dumped = str(body).lower()
    assert "sk-" not in dumped or "sk-****" in dumped


def test_storage_path_jail_blocks_traversal_and_absolute(tmp_path):
    store = LocalStorage(str(tmp_path))
    store.ensure_project("proj_123")
    for bad in ("..", "../evil", "..\\evil", "/abs", "C:\\win"):
        try:
            store.resolve("proj_123", bad)
        except (PathJailError, ValueError):
            continue
        raise AssertionError(f"jail allowed: {bad}")
    try:
        store.resolve("proj_123", "..", "evil")
        raise AssertionError("jail allowed parent escape")
    except PathJailError:
        pass
    ok = store.resolve("proj_123", "exports", "final.mp4")
    assert ".mp4" in str(ok)


def test_credential_store_never_leaks_secret(tmp_path):
    data_file = tmp_path / "creds.enc"
    key_file = tmp_path / "master.key"
    store = FernetCredentialStore(key_file=str(key_file), data_file=str(data_file))
    store.save("ref1", "sk-live-super-secret-value-1234")
    assert store.exists("ref1")
    assert store.get("ref1") == "sk-live-super-secret-value-1234"
    meta = store.metadata("ref1")
    assert meta == {"configured": True, "ref": "ref1"}
    assert "sk-live" not in str(meta)
    raw = data_file.read_text(encoding="utf-8")
    assert "sk-live" not in raw
    assert "sk-live" not in str(scrub({"api_key": "sk-live-x"}))


def test_db_tables_created_via_metadata():
    names = set(Base.metadata.tables.keys())
    for expected in (
        "projects", "characters", "character_references", "scenes",
        "ai_providers", "credentials", "ai_models", "jobs",
        "workflow_nodes", "job_events", "artifacts", "qc_results",
        "exports", "settings",
    ):
        assert expected in names


def test_websocket_skeleton_connects():
    with client.websocket_connect("/ws") as ws:
        first = ws.receive_json()
        assert first["event"] == "connected"
        ws.send_text("ping")
        assert ws.receive_json()["event"] == "pong"
