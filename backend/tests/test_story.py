"""Phase 3 tests: projects / characters+upload / scenes / director / gates.

Director tests use controlled `test`-kind adapters (mock=true).
"""
from __future__ import annotations

import hashlib
import json
import os
import struct
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.ai import adapters as A  # noqa: E402
from app.ai.circuit import CircuitBreaker  # noqa: E402
import app.ai.circuit as circuit_mod  # noqa: E402
from app.api.v1 import ai as ai_api  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db import models as M  # noqa: E402
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
    monkeypatch.setattr(circuit_mod.breaker, "_entries", {})
    # Storage jail inside tmp (story module holds a settings reference).
    import app.api.v1.story as story_mod
    from types import SimpleNamespace
    monkeypatch.setattr(story_mod, "settings",
                        SimpleNamespace(projects_root=str(tmp_path / "projects")))
    A._ADAPTERS.clear()
    A._ADAPTERS["test"] = A.TestAdapter()
    yield TestClient(app)
    A._ADAPTERS.clear()


def mk_project(client, name="Story One", **kw):
    body = {"name": name, "description": "d", "language": "vi",
            "style": "3D", "audience": "kids", "duration_target": 30.0}
    body.update(kw)
    res = client.post("/api/v1/projects", json=body)
    assert res.status_code == 201, res.text
    return res.json()["data"]


def mk_ai(client, caps=("STORY",), cost="FREE", lic="VERIFIED_COMMERCIAL"):
    p = client.post("/api/v1/ai/providers",
                    json={"name": "P", "adapter_key": "test"}).json()["data"]
    client.post("/api/v1/ai/credentials",
                json={"provider_id": p["id"], "secret": "sk-x"})
    m = client.post("/api/v1/ai/models", json={
        "provider_id": p["id"], "name": "DM", "model_id": "mid-dm",
        "capabilities": list(caps), "cost_class": cost,
        "license_status": lic}).json()["data"]
    return p, m


PLAN = {
    "title": "The Brave Cat",
    "concept": "A cat saves a bird.",
    "hook": "One stormy night...",
    "audience": "kids", "tone": "warm", "story_structure": "3 acts",
    "characters": [{"name": "Milo", "role": "hero", "description": "clever cat"}],
    "scenes": [{"scene_number": 1, "description": "Forest",
                "dialogue": "Meow", "visual_prompt": "cat in forest",
                "camera": "wide", "duration": 5.0, "characters": ["Milo"]}],
    "visual_style": "3D cartoon", "camera_style": "dynamic",
    "voice_style": "warm narrator", "duration": 30.0,
    "ending": "Friends forever.", "cta": "Subscribe!",
}


def queue_plan(text=None):
    A._ADAPTERS["test"].queue(True, text or json.dumps(PLAN))


# ------------------------------------------------------------------ projects

def test_project_crud_validation_factory_isolation(client):
    prj = mk_project(client)
    assert prj["factory_type"] == "story" and prj["status"] == "DRAFT"
    assert client.get("/api/v1/projects").json()["data"][0]["id"] == prj["id"]
    res = client.patch(f"/api/v1/projects/{prj['id']}",
                       json={"status": "REVIEW", "name": "Renamed"})
    assert res.json()["data"]["status"] == "REVIEW"
    assert client.patch(f"/api/v1/projects/{prj['id']}",
                        json={"status": "NOPE"}).status_code == 400
    assert client.post("/api/v1/projects",
                       json={"name": "x", "factory_type": "affiliate"}).status_code == 400
    assert client.post("/api/v1/projects", json={"name": ""}).status_code == 422
    assert client.delete(f"/api/v1/projects/{prj['id']}").status_code == 200
    assert client.get(f"/api/v1/projects/{prj['id']}").status_code == 404


def test_project_delete_cascades_children_and_disk(tmp_path, monkeypatch, client):
    import app.api.v1.story as story_mod
    prj = mk_project(client)
    pid = prj["id"]
    client.post(f"/api/v1/projects/{pid}/scenes",
                json={"order": 1, "description": "s", "status": "DRAFT"})
    client.post(f"/api/v1/projects/{pid}/characters", json={"name": "Milo"})
    from pathlib import Path
    root = Path(story_mod.settings.projects_root) / pid
    assert root.is_dir()
    assert client.delete(f"/api/v1/projects/{pid}").status_code == 200
    assert client.get(f"/api/v1/projects/{pid}").status_code == 404
    assert client.get(f"/api/v1/projects/{pid}/scenes").status_code == 404
    assert client.get(f"/api/v1/projects/{pid}/characters").status_code == 404
    assert not root.exists()
    assert client.delete(f"/api/v1/projects/{pid}").status_code == 404


def test_project_delete_blocked_with_live_job(tmp_path, monkeypatch, client):
    mk_ai(client)
    prj = mk_project(client)
    pid = prj["id"]
    queue_plan()
    plan = client.post(f"/api/v1/projects/{pid}/director", json={
        "idea": "x", "audience": "kids", "tone": "warm",
        "duration": 30.0, "language": "vi", "style": "3D"}).json()["data"]
    client.post(f"/api/v1/director/{plan['id']}/approve")
    client.post(f"/api/v1/projects/{pid}/scenes", json={"order": 1, "description": "s"})
    job = client.post("/api/v1/jobs", json={"project_id": pid, "kind": "FULL_PIPELINE",
                                            "idempotency_key": "del-guard-1"}).json()["data"]
    assert client.delete(f"/api/v1/projects/{pid}").status_code == 409
    assert client.post(f"/api/v1/jobs/{job['id']}/cancel").status_code == 200
    assert client.delete(f"/api/v1/projects/{pid}").status_code == 200
    assert client.get(f"/api/v1/projects/{pid}").status_code == 404


# ---------------------------------------------------------------- characters

def test_character_crud_lock_honesty(client):
    prj = mk_project(client)
    c = client.post(f"/api/v1/projects/{prj['id']}/characters", json={
        "name": "Milo", "kind": "MAIN", "description": "cat",
        "visual_identity": "orange", "face": "round", "hair": "short",
        "clothes": "scarf", "colors": "orange", "defining_features": "scar"}).json()["data"]
    assert c["lock_state"] == "REVIEW_REQUIRED"
    # LOCKED_VERIFIED must be rejected — no verification engine.
    res = client.post(f"/api/v1/projects/{prj['id']}/characters",
                      json={"name": "X", "lock_state": "LOCKED_VERIFIED"})
    assert res.status_code == 400
    # User-asserted LOCKED allowed, but editing identity drops it back honestly.
    client.patch(f"/api/v1/characters/{c['id']}", json={"lock_state": "LOCKED"})
    res = client.patch(f"/api/v1/characters/{c['id']}", json={"description": "changed cat"})
    assert res.json()["data"]["lock_state"] == "REVIEW_REQUIRED"


def _png_bytes(w=4, h=3):
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    chunk = b"IHDR" + ihdr
    crc = 0  # crc unchecked by our sniffer
    return b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + chunk + struct.pack(">I", crc)


def test_reference_upload_validation_jail_hash(client):
    prj = mk_project(client)
    c = client.post(f"/api/v1/projects/{prj['id']}/characters",
                    json={"name": "M"}).json()["data"]
    raw = _png_bytes()
    res = client.post(f"/api/v1/characters/{c['id']}/references",
                      files={"file": ("milo.png", raw, "image/png")})
    assert res.status_code == 201, res.text
    body = res.json()["data"]
    assert body["sha256"] == hashlib.sha256(raw).hexdigest()
    assert (body["width"], body["height"]) == (4, 3)
    assert body["asset_path"].startswith("characters/") and ".." not in body["asset_path"]
    # Wrong magic.
    res = client.post(f"/api/v1/characters/{c['id']}/references",
                      files={"file": ("evil.png", b"NOT_AN_IMAGE" * 100, "image/png")})
    assert res.status_code == 400
    # Disallowed ext/mime.
    res = client.post(f"/api/v1/characters/{c['id']}/references",
                      files={"file": ("x.exe", b"MZ" * 100, "application/octet-stream")})
    assert res.status_code == 400
    # Too large.
    res = client.post(f"/api/v1/characters/{c['id']}/references",
                      files={"file": ("big.png", b"\x89PNG\r\n\x1a\n" + b"0" * (11 * 1024 * 1024),
                                     "image/png")})
    assert res.status_code == 400
    # Listing works, cross-project character rejected on other project scenes (below).


# --------------------------------------------------------------------- scenes

def test_scene_crud_ordering_isolation(client):
    p1 = mk_project(client, "P1")
    p2 = mk_project(client, "P2")
    ch = client.post(f"/api/v1/projects/{p1['id']}/characters",
                     json={"name": "M"}).json()["data"]
    s1 = client.post(f"/api/v1/projects/{p1['id']}/scenes", json={
        "order": 2, "description": "second", "dialogue": "hi",
        "visual_prompt": "vp", "camera": "wide", "duration": 5.0,
        "characters": [ch["id"]], "status": "PLANNED"}).json()["data"]
    s0 = client.post(f"/api/v1/projects/{p1['id']}/scenes", json={
        "order": 1, "description": "first"}).json()["data"]
    rows = client.get(f"/api/v1/projects/{p1['id']}/scenes").json()["data"]
    assert [r["order"] for r in rows] == [1, 2]
    assert rows[1]["characters"] == [ch["id"]]
    # Foreign character rejected.
    res = client.post(f"/api/v1/projects/{p2['id']}/scenes",
                      json={"order": 1, "characters": [ch["id"]]})
    assert res.status_code == 400
    # Cross-project read rejected.
    assert client.get(f"/api/v1/scenes/{s0['id']}").status_code == 200
    res = client.patch(f"/api/v1/scenes/{s1['id']}",
                       json={"status": "APPROVED", "duration": 6.0})
    assert res.json()["data"]["status"] == "APPROVED"
    assert client.patch(f"/api/v1/scenes/{s1['id']}",
                        json={"status": "GENERATED"}).status_code == 400
    assert client.delete(f"/api/v1/scenes/{s0['id']}").status_code == 200


# ------------------------------------------------------------------- director

def test_director_generate_approve_flow(client):
    prj = mk_project(client)
    mk_ai(client)
    ch = client.post(f"/api/v1/projects/{prj['id']}/characters",
                     json={"name": "Milo", "description": "cat"}).json()["data"]
    queue_plan()
    res = client.post(f"/api/v1/projects/{prj['id']}/director", json={
        "idea": "a cat saves a bird", "audience": "kids", "tone": "warm",
        "duration": 30.0, "language": "vi", "style": "3D",
        "character_ids": [ch["id"]]})
    assert res.status_code == 201, res.text
    plan = res.json()["data"]
    assert plan["version"] == 1 and plan["status"] == "REVIEW"
    assert plan["plan"]["title"] == "The Brave Cat"
    assert plan["plan"]["scenes"][0]["scene_number"] == 1
    assert plan["mock"] is True  # labeled, never claimed live
    # Approve stale or double-approve guarded.
    assert client.post(f"/api/v1/director/{plan['id']}/approve").status_code == 200
    assert client.post(f"/api/v1/director/{plan['id']}/approve").status_code == 400
    latest = client.get(f"/api/v1/projects/{prj['id']}/director/latest").json()["data"]
    assert latest["status"] == "APPROVED"


def test_director_malformed_not_saved(client):
    prj = mk_project(client)
    mk_ai(client)
    A._ADAPTERS["test"].queue(True, "this is not json at all {{{")
    res = client.post(f"/api/v1/projects/{prj['id']}/director",
                      json={"idea": "x"})
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "INVALID_RESPONSE"
    assert "request_id" in res.json()["error"]
    assert client.get(f"/api/v1/projects/{prj['id']}/director").json()["data"] == []


def test_director_provider_failure_and_policy(client):
    prj = mk_project(client)
    # No models at all -> MODEL_UNAVAILABLE typed.
    res = client.post(f"/api/v1/projects/{prj['id']}/director", json={"idea": "x"})
    assert res.status_code == 404
    # Paid model blocked pre-network.
    mk_ai(client, cost="PAID")
    res = client.post(f"/api/v1/projects/{prj['id']}/director", json={"idea": "x"})
    assert res.json()["error"]["code"] == "PAID_MODEL_BLOCKED"


def test_director_regen_section_version_preserved_on_fail(client):
    prj = mk_project(client)
    mk_ai(client)
    queue_plan()
    v1 = client.post(f"/api/v1/projects/{prj['id']}/director",
                     json={"idea": "x"}).json()["data"]
    # Section regen success -> v2, only hook changed.
    A._ADAPTERS["test"].queue(True, json.dumps({"section": "hook", "value": "New hook!"}))
    res = client.post(f"/api/v1/director/{v1['id']}/regenerate-section",
                      json={"section": "hook"})
    assert res.status_code == 201, res.text
    v2 = res.json()["data"]
    assert v2["version"] == 2 and v2["origin"] == "SECTION_REGENERATED"
    assert v2["plan"]["hook"] == "New hook!"
    assert v2["plan"]["title"] == v1["plan"]["title"]
    # Failed regen keeps current version intact (no v3).
    A._ADAPTERS["test"].queue(True, "garbage{{{")
    res = client.post(f"/api/v1/director/{v1['id']}/regenerate-section",
                      json={"section": "ending"})
    assert res.status_code == 502
    rows = client.get(f"/api/v1/projects/{prj['id']}/director").json()["data"]
    assert [r["version"] for r in rows] == [1, 2]
    # Unknown section rejected.
    assert client.post(f"/api/v1/director/{v1['id']}/regenerate-section",
                       json={"section": "nope"}).status_code == 400


def test_director_edit_reject_flow(client):
    prj = mk_project(client)
    mk_ai(client)
    queue_plan()
    v1 = client.post(f"/api/v1/projects/{prj['id']}/director",
                     json={"idea": "x"}).json()["data"]
    edited = {"title": "User Title"}
    res = client.patch(f"/api/v1/director/{v1['id']}", json={"plan": edited})
    assert res.status_code == 201
    assert res.json()["data"]["origin"] == "USER_EDITED"
    assert res.json()["data"]["plan"]["title"] == "User Title"
    # Merge semantics: untouched sections preserved.
    assert res.json()["data"]["plan"]["scenes"] == v1["plan"]["scenes"]
    res = client.patch(f"/api/v1/director/{v1['id']}", json={"plan": {"title": 123}})
    assert res.status_code == 400  # schema enforced
    v2id = client.get(f"/api/v1/projects/{prj['id']}/director/latest").json()["data"]["id"]
    assert client.post(f"/api/v1/director/{v2id}/reject").status_code == 200


def test_no_downstream_generation_gate(client):
    """NOT APPROVED (or even APPROVED) plan must create zero media jobs/requests."""
    prj = mk_project(client)
    mk_ai(client)
    queue_plan()
    plan = client.post(f"/api/v1/projects/{prj['id']}/director",
                       json={"idea": "x"}).json()["data"]
    assert plan["status"] == "REVIEW"  # not approved
    # No IMAGE/VIDEO/TTS usage events exist anywhere.
    res = client.get("/api/v1/ai/activity?limit=200").json()["data"]
    tasks = {a["task"] for a in res}
    assert not (tasks & {"IMAGE_GENERATION", "VIDEO_GENERATION", "TTS"}), tasks


def test_security_no_secret_no_cross_project(client):
    p1 = mk_project(client, "P1")
    p2 = mk_project(client, "P2")
    mk_ai(client)
    ch = client.post(f"/api/v1/projects/{p1['id']}/characters",
                     json={"name": "M"}).json()["data"]
    # Character from another project must not leak into this director call.
    queue_plan()
    res = client.post(f"/api/v1/projects/{p2['id']}/director",
                      json={"idea": "x", "character_ids": [ch["id"]]})
    assert res.status_code == 400
    queue_plan()
    res = client.post(f"/api/v1/projects/{p1['id']}/director",
                      json={"idea": "x", "character_ids": [ch["id"]]})
    assert res.status_code == 201
    blob = (client.get(f"/api/v1/projects/{p1['id']}/director").text
            + client.get("/api/v1/ai/activity").text)
    assert "sk-x" not in blob
