"""Phase 7 tests: OAuth states, publish gate/idempotency/retry/confirm, no fakes."""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

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
import app.engine.runner as R  # noqa: E402
from app.main import create_app  # noqa: E402
import app.publisher.service as pub  # noqa: E402
from app.publisher.platforms import (TestPlatformAdapter, YouTubeAdapter,  # noqa: E402
                                     exchange_code, refresh_access_token)


def make_client(tmp_path, monkeypatch):
    db_file = tmp_path / "t.db"
    engine = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    TS = sessionmaker(bind=engine, future=True)
    monkeypatch.setattr(R, "SessionFactory", TS)
    monkeypatch.setattr(R, "PROJECTS_ROOT", str(tmp_path / "p"))
    monkeypatch.setattr(R, "AUTO_DISPATCH", False)
    monkeypatch.setattr(pub, "SessionFactory", TS)
    monkeypatch.setattr(pub, "PROJECTS_ROOT", str(tmp_path / "p"))
    monkeypatch.setattr(pub, "PUB_AUTO_DISPATCH", False)

    def odb():
        db = TS()
        try:
            yield db
        finally:
            db.close()

    app = create_app()
    app.dependency_overrides[get_db] = odb
    import app.credentials.store as sm
    fresh = sm.FernetCredentialStore(key_file=str(tmp_path / "k"), data_file=str(tmp_path / "c"))
    monkeypatch.setattr(ai_api, "_store", fresh)
    monkeypatch.setattr(circuit_mod.breaker, "_entries", {})
    import app.api.v1.story as stm, app.api.v1.media as mm
    from types import SimpleNamespace as NS
    monkeypatch.setattr(stm, "settings", NS(projects_root=str(tmp_path / "p")))
    monkeypatch.setattr(mm, "settings", NS(projects_root=str(tmp_path / "p")))
    A._ADAPTERS.clear()
    A._ADAPTERS["test"] = A.TestAdapter()
    return TestClient(app), TS, fresh


def craft_gate_pass(client, TS, project_id, job_id="JOB-PUB1"):
    """DB-recorded artifacts that honestly pass QC+gate (no ffmpeg needed)."""
    scn = client.post(f"/api/v1/projects/{project_id}/scenes", json={
        "order": 1, "description": "d", "dialogue": "hi"}).json()["data"]
    db = TS()
    try:
        db.add(M.Job(id=job_id, project_id=project_id, kind="FULL_PIPELINE",
                     status="SUCCEEDED", stage="SUCCEEDED", idempotency_key=job_id))
        db.flush()
        for aid, kind, path, extra in (
                ("pa-v", "VIDEO", "renders/final.mp4",
                 {"bytes": 5000, "width": 720, "height": 1280, "duration_s": 10.0}),
                ("pa-a", "TTS", "audio/x.wav", {"bytes": 1000, "duration_s": 10.0}),
                ("pa-s", "SUBTITLE", "subtitles/x.srt", {"bytes": 100})):
            kw = {"mime": "video/mp4" if kind == "VIDEO" else "x",
                  "provider": "t", "model": "m", "request_id": "r",
                  "cost_class": "FREE", "license_status": "VERIFIED_COMMERCIAL"}
            kw.update(extra)
            db.add(M.Artifact(id=aid, job_id=job_id, kind=kind, path=path,
                              sha256="x" * 64,
                              scene_id=scn["id"] if kind != "VIDEO" else None, **kw))
        db.commit()
    finally:
        db.close()
    return job_id


def write_video_bytes(tmp_path, project_id):
    from pathlib import Path
    p = Path(str(tmp_path / "p")) / project_id / "renders" / "final.mp4"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"\x00\x00\x00\x18ftypisom" + b"\x00" * 2048)


def connect_youtube_stub(client, TS, fresh, platform="youtube"):
    """Direct DB+store setup (legitimate fixture): CONNECTED with stored token."""
    db = TS()
    try:
        c = M.SocialConnection(id=f"soc_{platform}", platform=platform,
                               status="CONNECTED", account_label="@test",
                               scopes=["upload"], token_ref=f"tok_{platform}")
        db.add(c)
        db.commit()
    finally:
        db.close()
    fresh.save(f"tok_{platform}", json.dumps({"access": "tok-access-1",
                                              "refresh": "tok-refresh-1",
                                              "expiry": time.time() + 3600}))


# ------------------------------------------------------------------- OAuth

def test_platforms_initially_config_required(tmp_path, monkeypatch):
    client, _, _ = make_client(tmp_path, monkeypatch)
    data = client.get("/api/v1/publisher/platforms").json()["data"]
    assert {p["platform"] for p in data} == {"youtube", "tiktok", "facebook"}
    assert all(p["support_state"] == "CONFIG_REQUIRED" for p in data)


def test_oauth_start_needs_byok_client(tmp_path, monkeypatch):
    client, _, _ = make_client(tmp_path, monkeypatch)
    res = client.post("/api/v1/publisher/connections/youtube/start", json={})
    assert res.json()["data"]["status"] == "CONFIG_REQUIRED"
    assert "authorize_url" not in res.json()["data"]
    res = client.post("/api/v1/publisher/connections/youtube/start",
                      json={"client_id": "cid123",
                            "redirect_uri": "http://localhost:5173/oauth/callback"})
    assert "accounts.google.com" in res.json()["data"]["authorize_url"]
    assert res.json()["data"]["state"].startswith("st_")


def test_oauth_callback_state_and_exchange(tmp_path, monkeypatch):
    client, TS, fresh = make_client(tmp_path, monkeypatch)
    start = client.post("/api/v1/publisher/connections/youtube/start",
                        json={"client_id": "cid"}).json()["data"]
    bad = client.post("/api/v1/publisher/connections/youtube/callback", json={
        "code": "c", "state": "wrong", "client_id": "cid", "client_secret": "s"})
    assert bad.status_code == 400
    # Success path with labeled double for the token HTTP (unit-verified below).
    import app.api.v1.publisher as pub_api
    monkeypatch.setattr(pub_api, "exchange_code",
                        lambda *a, **k: {"access_token": "acc-1",
                                         "refresh_token": "ref-1", "expires_in": 3600,
                                         "mock": True})
    res = client.post("/api/v1/publisher/connections/youtube/callback", json={
        "code": "c", "state": start["state"], "client_id": "cid",
        "client_secret": "s", "account_label": "@me"})
    assert res.status_code == 200, res.text
    body = res.json()["data"]
    assert body["status"] == "CONNECTED" and body["account"] == "@me"
    assert "acc-1" not in res.text and "client_secret" not in res.text.lower()
    # Disconnect wipes token.
    assert client.post("/api/v1/publisher/connections/youtube/disconnect").status_code == 200
    assert client.get("/api/v1/connections").json()["data"][0]["status"] == "NOT_CONNECTED"


class _StubHandler(BaseHTTPRequestHandler):
    mode = "token_ok"

    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        self.rfile.read(length)
        if self.path == "/token":
            if self.server.mode == "token_ok":
                self._send(200, {"access_token": "A", "refresh_token": "R",
                                 "expires_in": 3600})
            else:
                self._send(400, {"error": "invalid_grant"})
        else:
            self._send(404, {})


def _stub_server(mode):
    srv = HTTPServer(("127.0.0.1", 0), _StubHandler)
    srv.mode = mode
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def test_oauth_http_against_stub():
    srv = _stub_server("token_ok")
    url = f"http://127.0.0.1:{srv.server_port}/token"
    data = exchange_code("youtube", "code1", "cid", "csec", "http://x/", token_url=url)
    assert data["access_token"] == "A"
    ref = refresh_access_token("youtube", "R", "cid", "csec", token_url=url)
    assert ref["refresh_token"] == "R"
    srv.shutdown()
    srv2 = _stub_server("token_bad")
    url2 = f"http://127.0.0.1:{srv2.server_port}/token"
    import pytest as _p
    from app.publisher.platforms import OAuthError
    with _p.raises(OAuthError):
        exchange_code("youtube", "bad", "cid", "csec", "http://x/", token_url=url2)
    srv2.shutdown()


# ----------------------------------------------------------------- publish

def test_publish_blocked_without_gate(tmp_path, monkeypatch):
    client, _, _ = make_client(tmp_path, monkeypatch)
    prj = client.post("/api/v1/projects", json={"name": "P"}).json()["data"]
    res = client.post("/api/v1/publisher/publish", json={
        "platforms": ["youtube"], "idempotency_key": "pub-1"})
    assert res.status_code == 400  # no job/schedule
    res = client.post("/api/v1/publisher/publish", json={
        "platforms": ["not-a-platform"], "job_id": "JOB-X",
        "idempotency_key": "pub-2"})
    assert res.status_code in (400, 404)


def test_publish_gate_blocks_before_connections(tmp_path, monkeypatch):
    client, TS, fresh = make_client(tmp_path, monkeypatch)
    prj = client.post("/api/v1/projects", json={"name": "P"}).json()["data"]
    connect_youtube_stub(client, TS, fresh)  # connected, yet gate must block first
    db = TS()
    try:
        db.add(M.Job(id="JOB-EMPTY", project_id=prj["id"], kind="FULL_PIPELINE",
                     status="SUCCEEDED", stage="SUCCEEDED", idempotency_key="e1"))
        db.commit()
    finally:
        db.close()
    res = client.post("/api/v1/publisher/publish", json={
        "job_id": "JOB-EMPTY", "platforms": ["youtube"], "title": "T",
        "idempotency_key": "pub-blocked"})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "PRODUCTION_BLOCKED"


def test_publish_gate_then_connection_required(tmp_path, monkeypatch):
    client, TS, _ = make_client(tmp_path, monkeypatch)
    prj = client.post("/api/v1/projects", json={"name": "P"}).json()["data"]
    job_id = craft_gate_pass(client, TS, prj["id"])
    res = client.post("/api/v1/publisher/publish", json={
        "job_id": job_id, "platforms": ["youtube"], "title": "T",
        "idempotency_key": "pub-g"})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "PUBLISH_CONFIG_REQUIRED"


def test_publish_confirm_retry_idempotency(tmp_path, monkeypatch):
    client, TS, fresh = make_client(tmp_path, monkeypatch)
    prj = client.post("/api/v1/projects", json={"name": "P"}).json()["data"]
    job_id = craft_gate_pass(client, TS, prj["id"])
    write_video_bytes(tmp_path, prj["id"])
    connect_youtube_stub(client, TS, fresh)
    scripted = TestPlatformAdapter()
    scripted.queue(False, "busy", True, "RATE_LIMITED")
    scripted.queue(True, "yt_post_9")
    import app.publisher.platforms as plat
    monkeypatch.setitem(plat.ADAPTERS, "youtube", scripted)
    res = client.post("/api/v1/publisher/publish", json={
        "job_id": job_id, "platforms": ["youtube"], "title": "T",
        "description": "d", "hashtags": ["#s"],
        "idempotency_key": "pub-ok"})
    assert res.status_code == 201, res.text
    pub_id = res.json()["data"]["id"]
    # First dispatch: RATE_LIMITED -> RETRYABLE, post_id stays null.
    import app.publisher.service as svc
    svc.dispatch(pub_id)
    st = client.get(f"/api/v1/publisher/jobs/{pub_id}").json()["data"]
    assert st["attempts"][0]["status"] == "RETRYABLE_ERROR"
    assert st["attempts"][0]["platform_post_id"] is None
    # Release backoff + retry endpoint -> CONFIRMED with post id.
    assert client.post(f"/api/v1/publisher/jobs/{pub_id}/retry").status_code == 200
    svc.dispatch(pub_id)
    st = client.get(f"/api/v1/publisher/jobs/{pub_id}").json()["data"]
    assert st["attempts"][0]["status"] == "CONFIRMED_PUBLISHED"
    assert st["attempts"][0]["platform_post_id"] == "yt_post_9"
    # Second dispatch never resends confirmed (call count stays 2).
    svc.dispatch(pub_id)
    assert len(scripted.calls) == 2
    # Idempotent replay returns same job, no duplicate attempts.
    res2 = client.post("/api/v1/publisher/publish", json={
        "job_id": job_id, "platforms": ["youtube"], "title": "T",
        "idempotency_key": "pub-ok"})
    assert res2.json()["data"]["id"] == pub_id
    assert res2.json()["data"]["replay"] is True
    assert "tok-access-1" not in res.text


def test_expired_token_and_missing_credential(tmp_path, monkeypatch):
    client, TS, fresh = make_client(tmp_path, monkeypatch)
    prj = client.post("/api/v1/projects", json={"name": "P"}).json()["data"]
    job_id = craft_gate_pass(client, TS, prj["id"])
    write_video_bytes(tmp_path, prj["id"])
    # Expired token, no client env -> AUTH_FAILED retryable.
    db = TS()
    try:
        db.add(M.SocialConnection(id="soc_youtube", platform="youtube",
                                  status="CONNECTED", token_ref="tok_youtube"))
        db.commit()
    finally:
        db.close()
    fresh.save("tok_youtube", json.dumps({"access": "old", "refresh": "",
                                          "expiry": time.time() - 10}))
    scripted = TestPlatformAdapter()
    import app.publisher.platforms as plat
    monkeypatch.setitem(plat.ADAPTERS, "youtube", scripted)
    res = client.post("/api/v1/publisher/publish", json={
        "job_id": job_id, "platforms": ["youtube"], "idempotency_key": "pub-exp"})
    pub_id = res.json()["data"]["id"]
    import app.publisher.service as svc
    svc.dispatch(pub_id)
    st = client.get(f"/api/v1/publisher/jobs/{pub_id}").json()["data"]
    assert st["attempts"][0]["status"] == "RETRYABLE_ERROR"
    assert "expired" in st["attempts"][0]["reason"]
    assert len(scripted.calls) == 0  # no upload attempted without valid token


class _YTHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        self.rfile.read(length)
        port = self.server.server_port
        self._send(200, {"session_url": f"http://127.0.0.1:{port}/session/abc"})

    def do_PUT(self):
        length = int(self.headers.get("Content-Length", 0))
        self.rfile.read(length)
        if self.server.mode == "ok":
            self._send(200, {"id": "yt_vid_123"})
        else:
            self._send(200, {"kind": "youtube#video"})  # confirmed w/o id


def test_youtube_upload_against_stub():
    from app.publisher.platforms import PublishPayload
    srv = HTTPServer(("127.0.0.1", 0), _YTHandler)
    srv.mode = "ok"
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        ad = YouTubeAdapter(base=f"http://127.0.0.1:{srv.server_port}/up")
        res = ad.upload(PublishPayload("T", "d", [], b"\x00" * 100), "tok")
        assert res.ok and res.post_id == "yt_vid_123"
    finally:
        srv.shutdown()
    srv2 = HTTPServer(("127.0.0.1", 0), _YTHandler)
    srv2.mode = "noid"
    threading.Thread(target=srv2.serve_forever, daemon=True).start()
    try:
        ad = YouTubeAdapter(base=f"http://127.0.0.1:{srv2.server_port}/up")
        res = ad.upload(PublishPayload("T", "d", [], b"\x00" * 100), "tok")
        assert not res.ok and res.error_code == "INVALID_RESPONSE"
        assert res.post_id == ""  # never store unconfirmed ids
    finally:
        srv2.shutdown()
