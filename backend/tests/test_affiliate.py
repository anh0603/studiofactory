"""Phase 8 tests: affiliate CRUD/validation/script/disclosure/export + isolation."""
from __future__ import annotations

import base64
import json
import os
import struct
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.ai import adapters as A  # noqa: E402
import app.ai.circuit as circuit_mod  # noqa: E402
from app.api.v1 import ai as ai_api  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db import models as M  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from helpers import valid_png_bytes as png_bytes  # noqa: E402


def make_client(tmp_path, monkeypatch):
    db_file = tmp_path / "t.db"
    engine = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    TS = sessionmaker(bind=engine, future=True)

    def odb():
        db = TS()
        try:
            yield db
        finally:
            db.close()

    app = create_app()
    app.dependency_overrides[get_db] = odb
    import app.credentials.store as sm
    monkeypatch.setattr(ai_api, "_store", sm.FernetCredentialStore(
        key_file=str(tmp_path / "k"), data_file=str(tmp_path / "c")))
    monkeypatch.setattr(circuit_mod.breaker, "_entries", {})
    import app.api.v1.affiliate as aff
    from types import SimpleNamespace as NS
    import app.core.config as cfg
    monkeypatch.setattr(aff, "settings", NS(projects_root=str(tmp_path / "p")))
    A._ADAPTERS.clear()
    A._ADAPTERS["test"] = A.TestAdapter()
    return TestClient(app), TS


def setup_ai(client, caps=("TEXT", "IMAGE")):
    p = client.post("/api/v1/ai/providers",
                    json={"name": "P", "adapter_key": "test"}).json()["data"]
    client.post("/api/v1/ai/credentials", json={"provider_id": p["id"], "secret": "sk-x"})
    client.post("/api/v1/ai/models", json={
        "provider_id": p["id"], "name": "M", "model_id": "mid",
        "capabilities": list(caps), "cost_class": "FREE",
        "license_status": "VERIFIED_COMMERCIAL"})


def test_product_crud_url_validation(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    assert client.get("/api/v1/affiliate/products").json()["data"] == []
    p = client.post("/api/v1/affiliate/products", json={
        "name": "Earbuds", "description": "great sound", "price": "$29.99",
        "affiliate_url": "https://shop.example/item/1",
        "audience": "teens", "tone": "fun"}).json()["data"]
    assert p["affiliate_url"].startswith("https://")
    bad = client.post("/api/v1/affiliate/products", json={
        "name": "X", "affiliate_url": "not a url"})
    assert bad.status_code == 400
    bad2 = client.post("/api/v1/affiliate/products", json={
        "name": "X", "affiliate_url": "ftp://x/y"})
    assert bad2.status_code == 400
    assert client.patch(f"/api/v1/affiliate/products/{p['id']}",
                        json={"price": "$19.99"}).json()["data"]["price"] == "$19.99"
    # Product image upload validation.
    res = client.post(f"/api/v1/affiliate/products/{p['id']}/image",
                      files={"file": ("p.png", png_bytes(), "image/png")})
    assert res.status_code == 201, res.text
    assert len(res.json()["data"]["sha256"]) == 64
    res = client.post(f"/api/v1/affiliate/products/{p['id']}/image",
                      files={"file": ("x.exe", b"MZ" * 50, "application/octet-stream")})
    assert res.status_code == 400


def test_analysis_and_script_with_disclosure(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    setup_ai(client)
    p = client.post("/api/v1/affiliate/products", json={
        "name": "Earbuds", "description": "bass"}).json()["data"]
    A._ADAPTERS["test"].queue(True, json.dumps({
        "benefits": ["bass"], "hooks": ["wow"], "pain_points": ["tangles"],
        "target_audience": "teens", "angles": ["review"]}))
    res = client.post(f"/api/v1/affiliate/products/{p['id']}/analyze", json={})
    assert res.status_code == 200, res.text
    assert res.json()["data"]["analysis"]["benefits"] == ["bass"]
    # Script with disclosure from model.
    A._ADAPTERS["test"].queue(True, json.dumps({
        "hook": "Stop!", "body": "These buds...", "cta": "Buy now",
        "disclosure": "This is a paid affiliate review."}))
    res = client.post(f"/api/v1/affiliate/products/{p['id']}/scripts",
                      json={"style": "REVIEW"})
    assert res.status_code == 201, res.text
    s = res.json()["data"]
    assert s["disclosure"] and s["disclosure_injected"] is False
    # Script WITHOUT disclosure -> standard injected, labeled.
    A._ADAPTERS["test"].queue(True, json.dumps({
        "hook": "H", "body": "B", "cta": "C"}))
    res = client.post(f"/api/v1/affiliate/products/{p['id']}/scripts",
                      json={"style": "UGC"})
    s2 = res.json()["data"]
    assert "affiliate links" in s2["disclosure"] and s2["disclosure_injected"] is True
    assert client.post(f"/api/v1/affiliate/products/{p['id']}/scripts",
                       json={"style": "NOPE"}).status_code == 400
    scripts = client.get(f"/api/v1/affiliate/products/{p['id']}/scripts").json()["data"]
    assert len(scripts) == 2  # revision history preserved


def test_video_preview_export_no_autopublish(tmp_path, monkeypatch):
    client, TS = make_client(tmp_path, monkeypatch)
    setup_ai(client)
    p = client.post("/api/v1/affiliate/products", json={"name": "E"}).json()["data"]
    A._ADAPTERS["test"].queue(True, json.dumps({
        "hook": "H", "body": "B", "cta": "C", "disclosure": "Affiliate disclosure."}))
    s = client.post(f"/api/v1/affiliate/products/{p['id']}/scripts",
                    json={}).json()["data"]
    v = client.post(f"/api/v1/affiliate/products/{p['id']}/videos",
                    json={"script_id": s["id"]}).json()["data"]
    assert v["status"] == "READY"
    prev = client.get(f"/api/v1/affiliate/videos/{v['id']}/preview").json()["data"]
    assert prev["disclosure"] == "Affiliate disclosure."
    assert prev["publish"] == {"auto_publish": False}
    exp = client.post(f"/api/v1/affiliate/videos/{v['id']}/export").json()["data"]
    assert exp["manifest"]["script"]["disclosure"] == "Affiliate disclosure."
    assert exp["manifest"]["auto_publish"] is False
    # No publisher involvement by default.
    db = TS()
    try:
        assert db.query(M.PublishJob).count() == 0
        assert db.query(M.Schedule).count() == 0
    finally:
        db.close()
    # Wrong-product script rejected.
    p2 = client.post("/api/v1/affiliate/products", json={"name": "E2"}).json()["data"]
    assert client.post(f"/api/v1/affiliate/products/{p2['id']}/videos",
                       json={"script_id": s["id"]}).status_code == 400


def test_affiliate_visual_generation_and_isolation(tmp_path, monkeypatch):
    client, TS = make_client(tmp_path, monkeypatch)
    setup_ai(client)
    p = client.post("/api/v1/affiliate/products", json={"name": "E"}).json()["data"]
    A._ADAPTERS["test"].queue(True, json.dumps({
        "hook": "H", "body": "B", "cta": "C", "disclosure": "D"}))
    s = client.post(f"/api/v1/affiliate/products/{p['id']}/scripts",
                    json={}).json()["data"]
    A._ADAPTERS["test"].queue_media(True, "data:image/png;base64," + base64.b64encode(
        png_bytes()).decode())
    v = client.post(f"/api/v1/affiliate/products/{p['id']}/videos",
                    json={"script_id": s["id"], "generate_visual": True}).json()["data"]
    assert v["status"] == "READY" and v["visual_artifact_id"]
    # Isolation: story tables untouched; affiliate rows carry no story FKs.
    db = TS()
    try:
        assert db.query(M.Project).count() == 0
        assert db.query(M.Scene).count() == 0
        assert db.query(M.Character).count() == 0
        assert db.query(M.Job).count() == 0
        vids = db.query(M.AffiliateVideo).all()
        assert all(hasattr(v, "product_id") for v in vids)
        cols = {c.name for c in M.AffiliateVideo.__table__.columns}
        assert not (cols & {"project_id", "scene_id", "character_id", "job_id",
                            "schedule_id", "publish_job_id"})
        cols_p = {c.name for c in M.AffiliateProduct.__table__.columns}
        assert not (cols_p & {"project_id", "scene_id", "character_id"})
    finally:
        db.close()
    # Story factory unaffected: story project list still empty, models intact.
    assert client.get("/api/v1/projects").json()["data"] == []
    assert "sk-x" not in client.get(
        f"/api/v1/affiliate/videos/{v['id']}/preview").text
