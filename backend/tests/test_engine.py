"""Phase 5 tests: engine ordering/failure/retry/pause/cancel/idempotency/reuse/recovery/WS."""
from __future__ import annotations

import base64
import json
import os
import struct
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.ai import adapters as A  # noqa: E402
import app.ai.circuit as circuit_mod  # noqa: E402
from app.api.v1 import ai as ai_api  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db import models as M  # noqa: E402
from app.db.session import get_db  # noqa: E402
import app.engine.runner as R  # noqa: E402
from app.main import create_app  # noqa: E402


def png_bytes():
    return (b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" +
            struct.pack(">IIBBBBB", 8, 6, 8, 2, 0, 0, 0) + struct.pack(">I", 0))


def wav_bytes(duration_s=1.0, rate=8000):
    n = int(duration_s * rate)
    return (b"RIFF" + struct.pack("<I", 36 + n) + b"WAVE" + b"fmt " +
            struct.pack("<IHHIIHH", 16, 1, 1, rate, rate, 1, 8) + b"data" +
            struct.pack("<I", n) + b"\x00" * n)


def data_url(mime, raw):
    return f"data:{mime};base64," + base64.b64encode(raw).decode()


PLAN = {"title": "T", "concept": "c", "hook": "h", "audience": "a", "tone": "t",
        "story_structure": "s", "characters": [], "scenes": [],
        "visual_style": "v", "camera_style": "c", "voice_style": "v",
        "duration": 10.0, "ending": "e", "cta": "c"}


def make_client(tmp_path, monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    monkeypatch.setattr(R, "SessionFactory", TestingSession)

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
    import app.api.v1.media as media_mod
    from types import SimpleNamespace as _NS
    monkeypatch.setattr(story_mod, "settings", _NS(projects_root=str(tmp_path / "projects")))
    monkeypatch.setattr(media_mod, "settings", _NS(projects_root=str(tmp_path / "projects")))
    monkeypatch.setattr(R, "PROJECTS_ROOT", str(tmp_path / "projects"))
    monkeypatch.setattr(R, "AUTO_DISPATCH", False)
    # Engine storage jail: patch LocalStorage root via settings used in runner imports.
    import app.core.config as cfg
    A._ADAPTERS.clear()
    A._ADAPTERS["test"] = A.TestAdapter()
    client = TestClient(app)
    return client, TestingSession


def setup_project(client, scenes=1):
    prj = client.post("/api/v1/projects", json={"name": "P"}).json()["data"]
    p = client.post("/api/v1/ai/providers",
                    json={"name": "MP", "adapter_key": "test"}).json()["data"]
    client.post("/api/v1/ai/credentials", json={"provider_id": p["id"], "secret": "sk-x"})
    client.post("/api/v1/ai/models", json={
        "provider_id": p["id"], "name": "MM", "model_id": "mid-mm",
        "capabilities": ["STORY", "IMAGE", "VIDEO", "TTS"],
        "cost_class": "FREE", "license_status": "VERIFIED_COMMERCIAL"})
    A._ADAPTERS["test"].queue(True, json.dumps(PLAN))
    client.post(f"/api/v1/projects/{prj['id']}/director", json={"idea": "x"})
    plan = client.get(f"/api/v1/projects/{prj['id']}/director/latest").json()["data"]
    client.post(f"/api/v1/director/{plan['id']}/approve")
    ids = []
    for i in range(scenes):
        s = client.post(f"/api/v1/projects/{prj['id']}/scenes", json={
            "order": i + 1, "description": f"scene {i}", "dialogue": f"line {i}"}).json()["data"]
        ids.append(s)
    return prj, ids


def queue_media(n_images=1, n_tts=1):
    for _ in range(n_images):
        A._ADAPTERS["test"].queue_media(True, data_url("image/png", png_bytes()))
    for _ in range(n_tts):
        A._ADAPTERS["test"].queue_media(True, data_url("audio/wav", wav_bytes()))


def test_job_requires_approval(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    prj = client.post("/api/v1/projects", json={"name": "P"}).json()["data"]
    res = client.post("/api/v1/jobs", json={"project_id": prj["id"],
                                            "kind": "FULL_PIPELINE",
                                            "idempotency_key": "k1"})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "APPROVAL_REQUIRED"


def test_full_pipeline_sync_success_and_events(tmp_path, monkeypatch):
    client, Sessions = make_client(tmp_path, monkeypatch)
    prj, _ = setup_project(client)
    queue_media()
    res = client.post("/api/v1/jobs", json={"project_id": prj["id"],
                                            "kind": "FULL_PIPELINE",
                                            "idempotency_key": "job-1"})
    assert res.status_code == 201, res.text
    job_id = res.json()["data"]["id"]
    summary = R.run_job(job_id, "req_test")
    # No ffmpeg in env -> COMPOSE nodes fail with FFMPEG_UNAVAILABLE (retryable),
    # job ends FAILED honestly after bounded attempts.
    db = Sessions()
    try:
        job = db.get(M.Job, job_id)
        nodes = db.scalars(select(M.WorkflowNode).where(
            M.WorkflowNode.job_id == job_id)).all()
        by_type = {}
        for n in nodes:
            by_type.setdefault(n.type, []).append(n.status)
        assert by_type["IMAGE"] == ["SUCCEEDED"]
        assert by_type["TTS"] == ["SUCCEEDED"]
        assert by_type["SUBTITLE"] == ["SUCCEEDED"]
        # Compose blocked on missing ffmpeg: FAILED after retries, honest.
        assert by_type["COMPOSE"] == ["FAILED"]
        assert job.status == "FAILED"
        # Failure propagation: downstream never ran to success.
        assert "SUCCEEDED" not in by_type.get("PROJECT_COMPOSE", ["FAILED"])
        events = db.scalars(select(M.JobEvent).where(
            M.JobEvent.job_id == job_id).order_by(M.JobEvent.created_at)).all()
        # Dependency ordering: COMPOSE started only after IMAGE+TTS succeeded.
        order = [(e.event, e.node_id, e.status) for e in events]
        img_node = next(n.id for n in nodes if n.type == "IMAGE")
        cmp_node = next(n.id for n in nodes if n.type == "COMPOSE")
        img_ok_at = next(i for i, (ev, nid, st) in enumerate(order)
                         if nid == img_node and st == "SUCCEEDED")
        cmp_start_at = next(i for i, (ev, nid, st) in enumerate(order)
                            if nid == cmp_node and ev == "job.stage_changed"
                            and st == "RUNNING")
        assert cmp_start_at > img_ok_at
        events = db.scalars(select(M.JobEvent).where(
            M.JobEvent.job_id == job_id).order_by(M.JobEvent.created_at)).all()
        kinds = [e.event for e in events]
        assert kinds[0] == "job.created"
        assert "job.failed" in kinds
        assert "sk-x" not in str([(e.event, e.status) for e in events])
        # progress never fabricated.
        assert job.progress_percent is None
    finally:
        db.close()
    assert summary["status"] == "FAILED"


def test_failure_retry_flow(tmp_path, monkeypatch):
    client, Sessions = make_client(tmp_path, monkeypatch)
    prj, _ = setup_project(client)
    # First IMAGE attempt fails retryable, nodes retry within run_job (3 attempts).
    A._ADAPTERS["test"].queue_media(False, "busy", "RATE_LIMITED")
    queue_media()
    res = client.post("/api/v1/jobs", json={"project_id": prj["id"],
                                            "kind": "FULL_PIPELINE",
                                            "idempotency_key": "job-r"})
    R.run_job(res.json()["data"]["id"])
    db = Sessions()
    try:
        img = db.scalars(select(M.WorkflowNode).where(
            M.WorkflowNode.type == "IMAGE")).all()[0]
        assert img.status == "SUCCEEDED" and img.attempts == 2
    finally:
        db.close()


def test_non_retryable_terminates_immediately(tmp_path, monkeypatch):
    client, Sessions = make_client(tmp_path, monkeypatch)
    prj, _ = setup_project(client)
    A._ADAPTERS["test"].queue_media(False, "bad", "BAD_REQUEST")
    queue_media()
    res = client.post("/api/v1/jobs", json={"project_id": prj["id"],
                                            "kind": "FULL_PIPELINE",
                                            "idempotency_key": "job-nr"})
    job_id = res.json()["data"]["id"]
    R.run_job(job_id)
    db = Sessions()
    try:
        img = db.scalars(select(M.WorkflowNode).where(
            M.WorkflowNode.type == "IMAGE")).all()[0]
        assert img.status == "FAILED" and img.attempts == 1
        # /retry refuses: non-retryable root cause.
        res = client.post(f"/api/v1/jobs/{job_id}/retry")
        assert res.status_code == 400
    finally:
        db.close()


def test_pause_resume_cancel(tmp_path, monkeypatch):
    client, Sessions = make_client(tmp_path, monkeypatch)
    prj, _ = setup_project(client)
    queue_media()
    res = client.post("/api/v1/jobs", json={"project_id": prj["id"],
                                            "kind": "FULL_PIPELINE",
                                            "idempotency_key": "job-p"})
    job_id = res.json()["data"]["id"]
    assert client.post(f"/api/v1/jobs/{job_id}/pause").status_code == 200
    summary = R.run_job(job_id)
    assert summary["status"] == "PAUSED"  # engine respected pause, ran nothing new
    db = Sessions()
    try:
        assert db.get(M.Job, job_id).status == "PAUSED"
    finally:
        db.close()
    assert client.post(f"/api/v1/jobs/{job_id}/resume").status_code == 200
    assert client.post(f"/api/v1/jobs/{job_id}/cancel").status_code == 200
    summary = R.run_job(job_id)
    assert summary["status"] == "CANCELLED"


def test_idempotent_duplicate_job(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    prj, _ = setup_project(client)
    r1 = client.post("/api/v1/jobs", json={"project_id": prj["id"],
                                           "kind": "FULL_PIPELINE",
                                           "idempotency_key": "dup-1"})
    r2 = client.post("/api/v1/jobs", json={"project_id": prj["id"],
                                           "kind": "FULL_PIPELINE",
                                           "idempotency_key": "dup-1"})
    assert r1.json()["data"]["id"] == r2.json()["data"]["id"]
    assert r2.json()["data"]["replay"] is True


def test_node_reuse_and_downstream_invalidation(tmp_path, monkeypatch):
    client, Sessions = make_client(tmp_path, monkeypatch)
    prj, scenes = setup_project(client)
    queue_media()
    j1 = client.post("/api/v1/jobs", json={"project_id": prj["id"],
                                           "kind": "FULL_PIPELINE",
                                           "idempotency_key": "reuse-1"}).json()["data"]["id"]
    R.run_job(j1)
    # Change the scene dialogue -> TTS hash changes -> rerun; IMAGE hash same -> reuse.
    sid = scenes[0]["id"]
    client.patch(f"/api/v1/scenes/{sid}", json={"dialogue": "completely new line"})
    queue_media()
    j2 = client.post("/api/v1/jobs", json={"project_id": prj["id"],
                                           "kind": "FULL_PIPELINE",
                                           "idempotency_key": "reuse-2"}).json()["data"]["id"]
    R.run_job(j2)
    db = Sessions()
    try:
        nodes = db.scalars(select(M.WorkflowNode).where(
            M.WorkflowNode.job_id == j2)).all()
        by_type = {n.type: n.status for n in nodes}
        assert by_type["IMAGE"] == "SKIPPED_REUSE"
        assert by_type["TTS"] in ("SUCCEEDED", "FAILED")  # reran (ffmpeg may fail compose)
        assert by_type["TTS"] != "SKIPPED_REUSE"
    finally:
        db.close()


def test_recover_stuck_and_restart(tmp_path, monkeypatch):
    client, Sessions = make_client(tmp_path, monkeypatch)
    prj, _ = setup_project(client)
    queue_media()
    jid = client.post("/api/v1/jobs", json={"project_id": prj["id"],
                                            "kind": "FULL_PIPELINE",
                                            "idempotency_key": "rec-1"}).json()["data"]["id"]
    db = Sessions()
    try:
        job = db.get(M.Job, jid)
        job.status = "RUNNING"  # simulate crash mid-run
        db.commit()
    finally:
        db.close()
    res = client.post("/api/v1/jobs/recover")
    assert jid in res.json()["data"]["requeued"]
    db = Sessions()
    try:
        assert db.get(M.Job, jid).status == "QUEUED"
    finally:
        db.close()


def test_websocket_receives_job_events(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    with client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["event"] == "connected"
        from app.ws.manager import manager
        import anyio
        # Broadcast path works for connected sockets (async path).
        anyio.run(manager.broadcast, {"event": "job.status_changed",
                                      "job_id": "JOB-X", "status": "QUEUED"})
        msg = ws.receive_json()
        assert msg["job_id"] == "JOB-X"
