"""Phase 4 tests: image/video/tts/subtitle/render/QC/gate/export, no fakes."""
from __future__ import annotations

import base64
import json
import os
import struct
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.ai import adapters as A  # noqa: E402
import app.ai.circuit as circuit_mod  # noqa: E402
from app.api.v1 import ai as ai_api  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db import models as M  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.media import ffmpeg as ff  # noqa: E402


def png_bytes(w=8, h=6):
    return (b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" +
            struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0) + struct.pack(">I", 0))


def wav_bytes(duration_s=2.0, rate=8000):
    n = int(duration_s * rate)
    data = b"\x00" * n
    header = (b"RIFF" + struct.pack("<I", 36 + n) + b"WAVE" + b"fmt " +
              struct.pack("<IHHIIHH", 16, 1, 1, rate, rate, 1, 8) + b"data" +
              struct.pack("<I", n))
    return header + data


def mp4_bytes():
    return b"\x00\x00\x00\x18ftypisom" + b"\x00" * 2048


def data_url(mime, raw):
    return f"data:{mime};base64," + base64.b64encode(raw).decode()


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
    import app.api.v1.story as story_mod
    from types import SimpleNamespace
    monkeypatch.setattr(story_mod, "settings",
                        SimpleNamespace(projects_root=str(tmp_path / "projects")))
    import app.api.v1.media as media_mod
    from types import SimpleNamespace as _NS
    monkeypatch.setattr(media_mod, "settings",
                        _NS(projects_root=str(tmp_path / "projects")))
    A._ADAPTERS.clear()
    A._ADAPTERS["test"] = A.TestAdapter()
    yield TestClient(app)
    A._ADAPTERS.clear()


def setup(client, caps=("IMAGE", "VIDEO", "TTS", "STORY")):
    prj = client.post("/api/v1/projects", json={"name": "P"}).json()["data"]
    p = client.post("/api/v1/ai/providers",
                    json={"name": "MP", "adapter_key": "test"}).json()["data"]
    client.post("/api/v1/ai/credentials", json={"provider_id": p["id"], "secret": "sk-x"})
    client.post("/api/v1/ai/models", json={
        "provider_id": p["id"], "name": "MM", "model_id": "mid-mm",
        "capabilities": list(caps), "cost_class": "FREE",
        "license_status": "VERIFIED_COMMERCIAL"})
    scn = client.post(f"/api/v1/projects/{prj['id']}/scenes", json={
        "order": 1, "description": "d", "dialogue": "hello world"}).json()["data"]
    return prj, scn


def test_image_success_provenance_artifact(client, tmp_path):
    prj, scn = setup(client)
    A._ADAPTERS["test"].queue_media(True, data_url("image/png", png_bytes()))
    res = client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/image",
                      json={"prompt": "cat"})
    assert res.status_code == 200, res.text
    art = res.json()["data"]["artifacts"][0]
    assert art["mime"] == "image/png" and art["sha256"]
    f = tmp_path / "projects" / prj["id"] / art["path"]
    assert f.exists() and f.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    prov = tmp_path / "projects" / prj["id"] / art.get("provenance", "provenance/x")
    # provenance sidecar exists next to artifact record
    rows = client.get(f"/api/v1/projects/{prj['id']}/artifacts").json()["data"]
    assert any(r["id"] == art["id"] for r in rows)
    assert "sk-x" not in res.text


def test_image_invalid_bytes_rejected(client):
    prj, scn = setup(client)
    A._ADAPTERS["test"].queue_media(True, data_url("image/png", b"GARBAGE" * 50))
    res = client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/image",
                      json={})
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "INVALID_RESPONSE"


def test_video_tts_subtitle_flow(client):
    prj, scn = setup(client)
    A._ADAPTERS["test"].queue_media(True, data_url("video/mp4", mp4_bytes()))
    res = client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/video",
                      json={})
    assert res.status_code == 200, res.text
    A._ADAPTERS["test"].queue_media(True, data_url("audio/wav", wav_bytes()))
    res = client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/tts",
                      json={})
    assert res.status_code == 200, res.text
    assert res.json()["data"]["artifacts"][0]["duration_s"] == pytest.approx(2.0, abs=0.05)
    res = client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/subtitle",
                      json={})
    assert res.status_code == 200
    srt = res.json()["data"]["artifacts"][0]
    assert srt["mime"] == "text/srt"
    # bad cues rejected
    res = client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/subtitle",
                      json={"cues": [[5.0, 1.0, "bad"]]})
    assert res.status_code == 400


def test_tts_empty_dialogue_rejected(client):
    prj, _ = setup(client)
    scn = client.post(f"/api/v1/projects/{prj['id']}/scenes", json={
        "order": 2, "description": "silent"}).json()["data"]
    assert client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/tts",
                       json={}).status_code == 400


def test_media_paid_license_block_zero_call(client):
    prj, scn = setup(client, caps=("IMAGE",))
    # flip model to PAID
    models = client.get("/api/v1/ai/models").json()["data"]
    client.patch(f"/api/v1/ai/models/{models[0]['id']}", json={"cost_class": "PAID"})
    res = client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/image",
                      json={})
    assert res.json()["error"]["code"] == "PAID_MODEL_BLOCKED"
    assert A._ADAPTERS["test"].calls == []
    client.patch(f"/api/v1/ai/models/{models[0]['id']}",
                 json={"cost_class": "FREE", "license_status": "UNVERIFIED"})
    res = client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/image",
                      json={"require_commercial": True})
    assert res.json()["error"]["code"] == "LICENSE_BLOCKED"


def test_media_fallback_and_idempotency(client):
    prj, scn = setup(client)
    # Second model enables fallback budget of 2.
    p2 = client.post("/api/v1/ai/providers",
                     json={"name": "P2", "adapter_key": "test"}).json()["data"]
    client.post("/api/v1/ai/credentials", json={"provider_id": p2["id"], "secret": "sk-y"})
    client.post("/api/v1/ai/models", json={
        "provider_id": p2["id"], "name": "MM2", "model_id": "mid-mm2",
        "capabilities": ["IMAGE", "VIDEO", "TTS", "STORY"], "priority": 10,
        "cost_class": "FREE", "license_status": "VERIFIED_COMMERCIAL"})
    import app.ai.router as R
    calls = {"n": 0}
    orig = R.get_adapter
    a1, a2 = A.TestAdapter(), A.TestAdapter()
    a1.queue_media(False, "busy", "RATE_LIMITED")
    a2.queue_media(True, data_url("image/png", png_bytes()))

    def fake(provider, base_url=""):
        calls["n"] += 1
        return a1 if calls["n"] == 1 else a2
    R.get_adapter = fake
    try:
        res = client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/image",
                          json={"idempotency_key": "idem-1"})
    finally:
        R.get_adapter = orig
    assert res.status_code == 200, res.text
    first = res.json()["data"]["artifacts"][0]["id"]
    # Replay with same key: no regeneration.
    res2 = client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/image",
                       json={"idempotency_key": "idem-1"})
    assert res2.json()["data"]["replay"] is True
    assert res2.json()["data"]["artifacts"][0]["id"] == first


def test_render_requires_ffmpeg_or_honest_error(client, monkeypatch):
    prj, scn = setup(client)
    A._ADAPTERS["test"].queue_media(True, data_url("image/png", png_bytes()))
    client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/image", json={})
    A._ADAPTERS["test"].queue_media(True, data_url("audio/wav", wav_bytes()))
    client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/tts", json={})
    if ff.executable() is None:
        res = client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/render",
                          json={})
        assert res.json()["error"]["code"] == "FFMPEG_UNAVAILABLE"
    else:
        res = client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/render",
                          json={})
        assert res.status_code == 200, res.text


def test_ffmpeg_argv_no_shell(client, monkeypatch, tmp_path):
    seen = {}

    class _Proc:
        returncode = 0
        stderr = ""

    def fake_popen(argv, **kw):
        seen["argv"] = argv
        seen["kwargs"] = kw
        out = argv[-1]
        open(out, "wb").write(b"\x00" * 2048)
        return _Proc()
    monkeypatch.setattr("subprocess.run", fake_popen)
    monkeypatch.setattr(ff, "executable", lambda: "/usr/bin/ffmpeg")
    from pathlib import Path
    img = tmp_path / "i.png"; img.write_bytes(png_bytes())
    aud = tmp_path / "a.wav"; aud.write_bytes(wav_bytes())
    out = tmp_path / "o.mp4"
    ff.compose_scene(img, aud, None, out, 2.0)
    assert seen["kwargs"].get("shell") is False
    assert seen["argv"][0] == "/usr/bin/ffmpeg"
    assert all(isinstance(a, str) for a in seen["argv"])
    assert not any(c in ";&|" for a in seen["argv"] for c in a if a not in (str(img), str(aud), str(out)))


def test_qc_gate_export_flow(client):
    prj, scn = setup(client)
    # QC with nothing -> BLOCKED verdict, gate BLOCKED.
    res = client.post(f"/api/v1/projects/{prj['id']}/qc", json={"disclosure": True})
    assert res.json()["data"]["qc"]["verdict"] == "BLOCKED"
    assert res.json()["data"]["gate"]["decision"] == "BLOCKED"
    # Export without disclosure -> blocked; with disclosure but no media -> blocked.
    assert client.post(f"/api/v1/projects/{prj['id']}/export",
                       json={"disclosure_text": ""}).status_code == 422
    res = client.post(f"/api/v1/projects/{prj['id']}/export",
                      json={"disclosure_text": "AI-generated content."})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "PRODUCTION_BLOCKED"


def test_media_timeout_typed(client):
    prj, scn = setup(client)
    A._ADAPTERS["test"].queue_media(False, "slow", "TIMEOUT")
    res = client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/image",
                      json={})
    assert res.json()["error"]["code"] == "TIMEOUT"


def test_media_secret_absence_and_usage(client):
    prj, scn = setup(client)
    A._ADAPTERS["test"].queue_media(True, data_url("image/png", png_bytes()))
    client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/image", json={})
    blob = (client.get(f"/api/v1/projects/{prj['id']}/artifacts").text
            + client.get("/api/v1/ai/activity").text)
    assert "sk-x" not in blob
