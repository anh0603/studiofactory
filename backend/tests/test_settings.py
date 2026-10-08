"""Affiliate script reorder + media file serving (Range)."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.api.v1 import ai as ai_api  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db import models as M  # noqa: E402,F401
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
    # Isolated storage jail for file-serving tests.
    from app.storage.local import LocalStorage
    import app.api.v1.files as files_api
    monkeypatch.setattr(files_api, "_storage", lambda: LocalStorage(str(tmp_path / "projects")))
    client = TestClient(app)
    client.testing_session = TestingSession
    return client


def _db(client):
    return client.testing_session()


def test_script_reorder(client):
    db = _db(client)
    p = M.AffiliateProduct(id="afp_1", name="P")
    db.add(p)
    for i, sid in enumerate(("s1", "s2", "s3")):
        db.add(M.AffiliateScript(id=sid, product_id="afp_1", style="REVIEW",
                                 body="b", disclosure="d", position=i))
    db.commit()
    db.close()
    # Move last script to front.
    res = client.patch("/api/v1/affiliate/scripts/s3", json={"position": 0})
    assert res.status_code == 200, res.text
    res = client.get("/api/v1/affiliate/products/afp_1/scripts")
    ids = [s["id"] for s in res.json()["data"]]
    assert ids == ["s3", "s1", "s2"], ids
    # Out-of-range clamps to the end.
    res = client.patch("/api/v1/affiliate/scripts/s3", json={"position": 99})
    assert res.status_code == 200
    res = client.get("/api/v1/affiliate/products/afp_1/scripts")
    assert [s["id"] for s in res.json()["data"]] == ["s1", "s2", "s3"]
    # Unknown script 404.
    assert client.patch("/api/v1/affiliate/scripts/nope", json={"position": 0}).status_code == 404


def test_ai_quotas_unreachable_without_db(client, tmp_path, monkeypatch):
    import app.api.v1.ai as ai_api
    monkeypatch.setattr(ai_api, "_freellmapi_db_path", lambda: None)
    res = client.get("/api/v1/ai/quotas")
    assert res.status_code == 200
    assert res.json()["data"] == {"source": "freellmapi-local", "reachable": False,
                                  "providers": []}


def test_ai_quotas_reads_local_ledger(client, tmp_path, monkeypatch):
    import sqlite3
    import app.api.v1.ai as ai_api
    db_path = tmp_path / "freeapi.db"
    c = sqlite3.connect(str(db_path))
    c.execute("CREATE TABLE api_keys (platform TEXT, status TEXT, enabled INTEGER)")
    c.execute("CREATE TABLE rate_limit_cooldowns (platform TEXT, model_id TEXT, expires_at_ms INTEGER)")
    c.execute("CREATE TABLE rate_limit_usage (platform TEXT, kind TEXT, tokens INTEGER, created_at_ms INTEGER)")
    c.execute("CREATE TABLE provider_quota_state (platform TEXT, quota_pool_key TEXT, metric TEXT, limit_value INTEGER, remaining_value INTEGER, reset_at TEXT, confidence REAL)")
    c.execute("INSERT INTO api_keys VALUES ('groq', 'healthy', 1)")
    c.execute("INSERT INTO rate_limit_usage VALUES ('groq', 'request', 0, 9999999999999)")
    c.execute("INSERT INTO rate_limit_usage VALUES ('groq', 'tokens', 500, 9999999999999)")
    c.commit()
    c.close()
    monkeypatch.setattr(ai_api, "_freellmapi_db_path", lambda: str(db_path))
    res = client.get("/api/v1/ai/quotas")
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["reachable"] is True
    groq = next(p for p in data["providers"] if p["platform"] == "groq")
    assert groq["key_status"] == "healthy"
    assert groq["usage_24h"] == {"requests": 1, "tokens": 500}
    assert groq["quotas"] == []  # unknown limits are omitted, never invented


def test_files_guards(client):
    assert client.get("/api/v1/artifacts/nope!/content").status_code == 400
    assert client.get("/api/v1/artifacts/art_missing/content").status_code == 404
    assert client.get("/api/v1/artifacts/art_missing").status_code == 404


def test_artifact_stream_roundtrip(tmp_path, client):
    import app.api.v1.files as files_api
    store = files_api._storage()
    store.ensure_project("prj_t1")
    payload = b"\x89PNG\r\n\x1a\n" + b"IDAT" + b"x" * 100 + b"IEND\xae\x42\x60\x82"
    (store.project_dir("prj_t1") / "renders").mkdir(parents=True, exist_ok=True)
    (store.project_dir("prj_t1") / "renders" / "final.png").write_bytes(payload)
    db = _db(client)
    db.add(M.Job(id="job_t1", project_id="prj_t1", kind="RENDER", status="DONE",
                 stage="READY", progress_percent=100, status_text="ok",
                 idempotency_key="t1"))
    db.add(M.Artifact(id="art_t1", job_id="job_t1", kind="IMAGE",
                      path="renders/final.png", sha256="x", bytes=len(payload),
                      mime="image/png"))
    db.commit()
    db.close()
    res = client.get("/api/v1/artifacts/art_t1/content")
    assert res.status_code == 200
    assert res.content == payload
    # Range request returns 206 with correct slice.
    res = client.get("/api/v1/artifacts/art_t1/content", headers={"Range": "bytes=0-9"})
    assert res.status_code == 206
    assert res.content == payload[:10]
    assert res.headers["content-range"] == f"bytes 0-9/{len(payload)}"
    # Meta endpoint mirrors the row, never the bytes.
    meta = client.get("/api/v1/artifacts/art_t1").json()["data"]
    assert meta["mime"] == "image/png" and meta["bytes"] == len(payload)
