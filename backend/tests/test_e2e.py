"""Phase 10 E2E: full Story flow with honest ffmpeg-gated outcome + Affiliate pass.

Story (no ffmpeg in env): idea -> director -> approve -> scenes -> media
(IMAGE/TTS/SUBTITLE succeed for real) -> engine job -> COMPOSE fails
FFMPEG_UNAVAILABLE (typed, bounded) -> QC BLOCKED -> export/publish BLOCKED.
Every step asserts real states; nothing claims success it doesn't have.
Affiliate: product -> script(+disclosure) -> video -> export manifest PASS.
"""
from __future__ import annotations

import base64
import json
import os
import struct
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.ai import adapters as A  # noqa: E402
import app.ai.circuit as circuit_mod  # noqa: E402
from app.api.v1 import ai as ai_api  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import get_db  # noqa: E402
import app.engine.runner as R  # noqa: E402
from app.main import create_app  # noqa: E402
from helpers import data_url, valid_png_bytes, valid_wav_bytes  # noqa: E402


def png_b64():
    return data_url("image/png", valid_png_bytes())


def wav_b64():
    return data_url("audio/wav", valid_wav_bytes())


PLAN = {"title": "The Brave Cat", "concept": "c", "hook": "h", "audience": "kids",
        "tone": "warm", "story_structure": "3 acts", "characters": [],
        "scenes": [{"scene_number": 1, "description": "Forest", "dialogue": "Run!",
                    "visual_prompt": "cat", "camera": "wide", "duration": 5.0,
                    "characters": []}],
        "visual_style": "3D", "camera_style": "dyn", "voice_style": "warm",
        "duration": 30.0, "ending": "E", "cta": "C"}


def make_client(tmp_path, monkeypatch):
    db_file = tmp_path / "t.db"
    engine = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    TS = sessionmaker(bind=engine, future=True)
    monkeypatch.setattr(R, "SessionFactory", TS)
    monkeypatch.setattr(R, "PROJECTS_ROOT", str(tmp_path / "p"))
    monkeypatch.setattr(R, "AUTO_DISPATCH", False)

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
    import app.api.v1.story as stm, app.api.v1.media as mm
    from types import SimpleNamespace as NS
    monkeypatch.setattr(stm, "settings", NS(projects_root=str(tmp_path / "p")))
    monkeypatch.setattr(mm, "settings", NS(projects_root=str(tmp_path / "p")))
    import app.api.v1.affiliate as aff
    monkeypatch.setattr(aff, "settings", NS(projects_root=str(tmp_path / "p")))
    A._ADAPTERS.clear()
    A._ADAPTERS["test"] = A.TestAdapter()
    return TestClient(app)


def setup_ai(client):
    p = client.post("/api/v1/ai/providers",
                    json={"name": "P", "adapter_key": "test"}).json()["data"]
    client.post("/api/v1/ai/credentials", json={"provider_id": p["id"], "secret": "sk-e2e"})
    for name, caps in (("M_STORY", ["STORY", "TEXT"]), ("M_MEDIA", ["IMAGE", "VIDEO", "TTS"])):
        client.post("/api/v1/ai/models", json={
            "provider_id": p["id"], "name": name, "model_id": f"mid-{name}",
            "capabilities": caps, "cost_class": "FREE",
            "license_status": "VERIFIED_COMMERCIAL"})


def test_story_e2e_honest_no_ffmpeg(tmp_path, monkeypatch):
    import shutil as _sh
    HAS_FFMPEG = _sh.which("ffmpeg") is not None
    client = make_client(tmp_path, monkeypatch)
    setup_ai(client)
    # 1. Project + character + director + approve.
    prj = client.post("/api/v1/projects", json={"name": "E2E Story"}).json()["data"]
    ch = client.post(f"/api/v1/projects/{prj['id']}/characters",
                     json={"name": "Milo"}).json()["data"]
    assert ch["lock_state"] == "REVIEW_REQUIRED"  # never verified-fake
    A._ADAPTERS["test"].queue(True, json.dumps(PLAN))
    plan = client.post(f"/api/v1/projects/{prj['id']}/director", json={
        "idea": "cat adventure", "character_ids": [ch["id"]]}).json()["data"]
    assert plan["status"] == "REVIEW" and plan["mock"] is True
    assert client.post(f"/api/v1/director/{plan['id']}/approve").status_code == 200
    scn = client.post(f"/api/v1/projects/{prj['id']}/scenes", json={
        "order": 1, "description": "Forest", "dialogue": "Run!"}).json()["data"]
    # 2. Real media artifacts for image/tts/subtitle.
    A._ADAPTERS["test"].queue_media(True, png_b64())
    assert client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/image",
                       json={}).status_code == 200
    A._ADAPTERS["test"].queue_media(True, wav_b64())
    tts = client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/tts",
                      json={}).json()["data"]["artifacts"][0]
    assert tts["duration_s"] > 0  # measured, not estimated
    assert client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/subtitle",
                       json={}).status_code == 200
    # 3. Engine job: queue fresh payloads for its own IMAGE/TTS nodes.
    A._ADAPTERS["test"].queue_media(True, png_b64())
    A._ADAPTERS["test"].queue_media(True, wav_b64())
    job = client.post("/api/v1/jobs", json={
        "project_id": prj["id"], "kind": "FULL_PIPELINE",
        "idempotency_key": "e2e-1"}).json()["data"]
    summary = R.run_job(job["id"])
    detail = client.get(f"/api/v1/jobs/{job['id']}").json()["data"]
    if HAS_FFMPEG:
        # Real render path: everything succeeds, QC REVIEW (character
        # Milo is REVIEW_REQUIRED, honestly not verified), gate PASS.
        assert summary["status"] == "SUCCEEDED"
        compose = next(n for n in detail["nodes"] if n["type"] == "COMPOSE")
        assert compose["status"] == "SUCCEEDED"
        qc = client.post(f"/api/v1/projects/{prj['id']}/qc",
                         json={"disclosure": True}).json()["data"]
        assert qc["qc"]["verdict"] == "REVIEW_REQUIRED"
        assert qc["gate"]["decision"] == "PASS"
        exp = client.post(f"/api/v1/projects/{prj['id']}/export",
                          json={"disclosure_text": "AI-generated."})
        assert exp.status_code == 200, exp.text
        manifest = exp.json()["data"]["manifest"]
        assert manifest["files"].get("VIDEO", "").endswith("final.mp4")
        # Real MP4 on disk: verify with ffprobe (streams, duration, size).
        import json as _json
        import subprocess as _sp
        from pathlib import Path as _P
        mp4 = next((_P(str(tmp_path / "p")) / prj["id"] / v
                    for v in [manifest["files"]["VIDEO"]]), None)
        assert mp4 is not None and mp4.exists() and mp4.stat().st_size > 1000
        probe = _sp.run(["ffprobe", "-v", "quiet", "-print_format", "json",
                         "-show_format", "-show_streams", str(mp4)],
                        capture_output=True, text=True, timeout=60)
        info = _json.loads(probe.stdout)
        kinds = {s["codec_type"] for s in info["streams"]}
        assert {"video", "audio"} <= kinds
        assert float(info["format"]["duration"]) > 0
        vstream = next(s for s in info["streams"] if s["codec_type"] == "video")
        assert (vstream["width"], vstream["height"]) == (720, 1280)
    else:
        assert summary["status"] == "FAILED"
        compose = next(n for n in detail["nodes"] if n["type"] == "COMPOSE")
        assert compose["error_code"] == "FFMPEG_UNAVAILABLE"
    assert detail["progress_percent"] is None  # never fabricated
    if HAS_FFMPEG:
        # 4b. Gate passed already; publish still refused without connection.
        pub = client.post("/api/v1/publisher/publish", json={
            "job_id": job["id"], "platforms": ["youtube"], "idempotency_key": "e2e-pub"})
        assert pub.status_code == 409
        assert pub.json()["error"]["code"] == "PUBLISH_CONFIG_REQUIRED"
        analytics = client.get("/api/v1/analytics/overview").json()["data"]
        assert analytics["production"]["jobs_failed"] == 0
        assert analytics["production"]["exports"] == 1
        assert analytics["publishing"]["confirmed"] == 0
    else:
        # 4. QC BLOCKED -> export BLOCKED -> publish BLOCKED. No fake success.
        qc = client.post(f"/api/v1/projects/{prj['id']}/qc",
                         json={"disclosure": True}).json()["data"]
        assert qc["qc"]["verdict"] == "BLOCKED"
        exp = client.post(f"/api/v1/projects/{prj['id']}/export",
                          json={"disclosure_text": "AI-generated."})
        assert exp.status_code == 422 and exp.json()["error"]["code"] == "PRODUCTION_BLOCKED"
        pub = client.post("/api/v1/publisher/publish", json={
            "job_id": job["id"], "platforms": ["youtube"], "idempotency_key": "e2e-pub"})
        assert pub.status_code == 422
        # 5. Analytics reflects reality: 1 failed job, 0 published.
        analytics = client.get("/api/v1/analytics/overview").json()["data"]
        assert analytics["production"]["jobs_failed"] == 1
        assert analytics["publishing"]["confirmed"] == 0
    assert "sk-e2e" not in (client.get("/api/v1/ai/activity").text
                            + client.get(f"/api/v1/jobs/{job['id']}").text)


def test_affiliate_e2e_full_pass(tmp_path, monkeypatch):
    client = make_client(tmp_path, monkeypatch)
    setup_ai(client)
    p = client.post("/api/v1/affiliate/products", json={
        "name": "Earbuds", "description": "bass",
        "affiliate_url": "https://shop.example/1"}).json()["data"]
    A._ADAPTERS["test"].queue(True, json.dumps({
        "hook": "H", "body": "Great buds.", "cta": "Buy",
        "disclosure": "Affiliate disclosure."}))
    s = client.post(f"/api/v1/affiliate/products/{p['id']}/scripts",
                    json={"style": "REVIEW"}).json()["data"]
    v = client.post(f"/api/v1/affiliate/products/{p['id']}/videos",
                    json={"script_id": s["id"]}).json()["data"]
    assert v["status"] == "READY"
    exp = client.post(f"/api/v1/affiliate/videos/{v['id']}/export").json()["data"]
    assert exp["manifest"]["script"]["disclosure"] == "Affiliate disclosure."
    assert exp["manifest"]["auto_publish"] is False
    analytics = client.get("/api/v1/analytics/overview").json()["data"]
    assert analytics["affiliate"]["products"] == 1
    assert analytics["affiliate"]["exported"] == 1
