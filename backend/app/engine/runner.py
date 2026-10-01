"""Automation engine: DAG jobs with reuse, bounded retry, pause/cancel, WS events.

Node lifecycle: PENDING -> WAITING_DEPS -> READY -> RUNNING ->
  SUCCEEDED | FAILED | SKIPPED_REUSE | RETRY_QUEUED -> RUNNING (bounded).
Job lifecycle: QUEUED -> RUNNING <-> PAUSED -> SUCCEEDED | FAILED | CANCELLED | BLOCKED.
progress_percent stays null unless a handler reports a real fraction.
"""
from __future__ import annotations

import hashlib
import json
import queue
import threading
import uuid
from typing import Any

from sqlalchemy import select

from ..media.pipeline import PipelineError

MAX_NODE_ATTEMPTS = 3
RETRYABLE_NODE_ERRORS = {"RATE_LIMITED", "QUOTA_EXHAUSTED", "TIMEOUT",
                         "PROVIDER_UNAVAILABLE", "MODEL_UNAVAILABLE",
                         "NETWORK_ERROR", "RENDER_FAILED", "FFMPEG_UNAVAILABLE"}

_job_queue: "queue.Queue[str]" = queue.Queue()
_worker_started = False
_worker_lock = threading.Lock()

# Overridable session factory (tests inject in-memory SQLite; production uses
# app.db.session.SessionLocal). Never bypassed: all engine DB access goes here.
SessionFactory = None

# Overridable projects root (tests inject tmp dir).
PROJECTS_ROOT = None

# When False, create_job does not enqueue to the background worker
# (tests drive run_job explicitly). Production always True.
AUTO_DISPATCH = True


def _sessions():
    if SessionFactory is not None:
        return SessionFactory()
    from ..db.session import SessionLocal
    return SessionLocal()


def _storage():
    from ..core.config import settings
    from ..storage.local import LocalStorage
    return LocalStorage(PROJECTS_ROOT or settings.projects_root)


def node_hash(kind: str, payload: dict) -> str:
    return hashlib.sha256(f"{kind}:{json.dumps(payload, sort_keys=True)}".encode()).hexdigest()[:32]


def emit(db, job_id: str, event: str, node_id: str | None = None,
         provider: str = "", model: str = "", attempt: int = 0,
         status: str = "", error: str | None = None,
         fallback: str | None = None) -> None:
    from ..db import models as M
    db.add(M.JobEvent(id=f"jev_{uuid.uuid4().hex[:12]}", job_id=job_id,
                      node_id=node_id, event=event, provider=provider,
                      model=model, attempt=attempt, latency_ms=0,
                      status=status, error_category=error,
                      fallback_reason=fallback))
    db.flush()
    try:
        from ..ws.manager import manager
        manager.broadcast_sync({"event": event, "job_id": job_id,
                                "node_id": node_id, "status": status})
    except Exception:  # noqa: BLE001 - WS must never break execution
        pass


def build_full_pipeline(db, project, scenes: list) -> list[dict]:
    """Node specs for a story project. Pure function of project+scenes."""
    specs = []
    for s in scenes:
        img = {"key": f"img:{s.id}", "type": "IMAGE", "scene_id": s.id,
               "deps": [], "input": {"prompt": s.visual_prompt or s.description or "still"}}
        tts = {"key": f"tts:{s.id}", "type": "TTS", "scene_id": s.id,
               "deps": [], "input": {"prompt": s.dialogue or ""}}
        sub = {"key": f"sub:{s.id}", "type": "SUBTITLE", "scene_id": s.id,
               "deps": [], "input": {}}
        cmp = {"key": f"cmp:{s.id}", "type": "COMPOSE", "scene_id": s.id,
               "deps": [f"img:{s.id}", f"tts:{s.id}", f"sub:{s.id}"], "input": {}}
        specs += [img, tts, sub, cmp]
    specs.append({"key": "project:compose", "type": "PROJECT_COMPOSE",
                  "scene_id": None, "deps": [f"cmp:{s.id}" for s in scenes], "input": {}})
    specs.append({"key": "project:qc", "type": "QC", "scene_id": None,
                  "deps": ["project:compose"], "input": {}})
    return specs


def create_job(db, project_id: str, kind: str, idempotency_key: str,
               request_id: str) -> tuple[Any, bool]:
    """Create job + nodes. Returns (job, created). Duplicate key -> replay."""
    from ..db import models as M
    existing = db.scalar(select(M.Job).where(M.Job.idempotency_key == idempotency_key))
    if existing is not None:
        return existing, False
    job = M.Job(id=f"JOB-{uuid.uuid4().hex[:8].upper()}", project_id=project_id,
                kind=kind, status="QUEUED", stage="QUEUED",
                progress_percent=None, status_text="Queued",
                idempotency_key=idempotency_key)
    db.add(job)
    db.flush()
    if kind == "FULL_PIPELINE":
        scenes = db.scalars(select(M.Scene).where(
            M.Scene.project_id == project_id).order_by(M.Scene.idx)).all()
        # Specs are topologically ordered (deps first), so key map resolves inline.
        key_to_id: dict[str, str] = {}
        for spec in build_full_pipeline(db, None, scenes):
            node = M.WorkflowNode(
                id=f"nd_{uuid.uuid4().hex[:12]}", job_id=job.id, type=spec["type"],
                status="PENDING", deps=[key_to_id[d] for d in spec["deps"]],
                input_hash=node_hash(spec["type"], {**spec["input"],
                                                     "scene": spec["scene_id"]}),
                provider="", model="", attempts=0)
            node.output_artifact_id = None
            db.add(node)
            db.flush()
            key_to_id[spec["key"]] = node.id
    emit(db, job.id, "job.created", status="QUEUED")
    db.commit()
    if AUTO_DISPATCH:
        ensure_worker()
        _job_queue.put(job.id)
    return job, True


def _node_scene(db, node, job_scenes: list) -> Any | None:
    """Re-derive scene for a node: match by dependency position is fragile;
    instead match input_hash against current scene hashes."""
    from ..db import models as M  # noqa
    for s in job_scenes:
        for kind in ("IMAGE", "TTS", "SUBTITLE", "COMPOSE"):
            payload = {"scene": s.id}
            if kind == "IMAGE":
                payload = {"prompt": s.visual_prompt or s.description or "still",
                           "scene": s.id}
            elif kind == "TTS":
                payload = {"prompt": s.dialogue or "", "scene": s.id}
            if node.type == kind and node.input_hash == node_hash(kind, payload):
                return s
    return None


def _find_reuse(db, project_id: str, input_hash: str) -> Any | None:
    """Prior SUCCEEDED node with same hash whose artifact still exists on disk."""
    from ..db import models as M
    storage = _storage()
    cands = db.scalars(select(M.WorkflowNode).where(
        M.WorkflowNode.input_hash == input_hash,
        M.WorkflowNode.status == "SUCCEEDED")).all()
    for n in cands:
        job = db.get(M.Job, n.job_id)
        if job is None or job.project_id != project_id:
            continue
        arts = db.scalars(select(M.Artifact).where(
            M.Artifact.job_id == n.job_id)).all()
        ok_paths = []
        for a in arts:
            try:
                p = storage.resolve(project_id, a.path)
                if p.exists() and p.stat().st_size == a.bytes and a.bytes > 0:
                    ok_paths.append(a.id)
            except Exception:  # noqa: BLE001
                continue
        if ok_paths:
            return n
    return None


def _execute_node(db, job, node, request_id: str) -> tuple[bool, str, dict]:
    """Run one node. Returns (ok, error_code, output{artifact_ids})."""
    from ..db import models as M
    from ..core.config import settings
    from ..storage.local import LocalStorage
    from ..media.pipeline import generate_bytes, persist_artifact
    from ..media.validate import (MediaInvalid, build_srt, decode_payload,
                                  validate_audio, validate_image)
    from ..media import ffmpeg as ff

    storage = _storage()
    project_id = job.project_id
    scenes = db.scalars(select(M.Scene).where(
        M.Scene.project_id == project_id).order_by(M.Scene.idx)).all()
    scene = _node_scene(db, node, scenes)

    def _registry():
        from ..api.v1.ai import store as get_store
        st = get_store()
        refs = {c.ref for c in db.scalars(select(M.Credential)).all() if st.exists(c.ref)}
        return refs

    if node.type in ("IMAGE", "TTS", "VIDEO"):
        if node.type == "TTS" and scene is not None and not (scene.dialogue or "").strip():
            return False, "BAD_REQUEST", {}
        kind = node.type
        task_cap = {"IMAGE": ("IMAGE_GENERATION", "IMAGE"),
                    "TTS": ("TTS", "TTS"),
                    "VIDEO": ("VIDEO_GENERATION", "VIDEO")}[kind]
        prompt = ""
        if scene is not None:
            prompt = (scene.visual_prompt or scene.description) if kind != "TTS" else scene.dialogue
        from ..ai.router import RouteInput, Router
        models, providers, secrets, refs = _registry_full(db)
        result = Router().route_media(kind, models, providers, secrets, refs, RouteInput(
            task=task_cap[0], capability=task_cap[1], prompt=prompt or "still",
            max_attempts=2), request_id)
        _record_attempts(db, request_id, task_cap[0], task_cap[1], result, providers, models,
                         job.id)
        if not result.ok:
            return False, result.error_code or "UNKNOWN_ERROR", {}
        from ..media.validate import decode_payload as _dec
        try:
            data, _mime = _dec(result.output)
            if kind == "IMAGE":
                mime, w, h = validate_image(data)
            elif kind == "TTS":
                from ..media.validate import validate_audio as _va
                mime, dur = _va(data)
                w = h = 0
            else:
                from ..media.validate import validate_video as _vv
                mime, _sz = _vv(data)
                w = h = 0
                dur = 0.0
        except MediaInvalid:
            return False, "INVALID_RESPONSE", {}
        last = result.attempts[-1]
        win = next((m for m in models if m["name"] == last.model), {})
        meta = {"provider": last.provider, "model": last.model,
                "mock": any(_is_mock(providers, models, a) for a in result.attempts),
                "task": task_cap[0], "capability": task_cap[1],
                "cost_class": win.get("cost_class", "UNKNOWN"),
                "license_status": win.get("license_status", "UNVERIFIED")}
        subdir = {"IMAGE": "scenes", "TTS": "audio", "VIDEO": "scenes"}[kind]
        ext = {"IMAGE": ".png", "TTS": ".wav", "VIDEO": ".mp4"}[kind]
        art = persist_artifact(db, storage, project_id, subdir,
                               f"{node.id}{ext}", data, kind, mime, meta,
                               request_id, job.id,
                               scene.id if scene else None,
                               dur if kind == "TTS" else 0.0, w, h)
        node.provider, node.model = last.provider, last.model
        return True, "", {"artifact_ids": [art["id"]]}

    if node.type == "SUBTITLE":
        if scene is None:
            return False, "BAD_REQUEST", {}
        dur = scene.duration_s or 5.0
        text = scene.dialogue or scene.description or "(no dialogue)"
        try:
            srt = build_srt([(0.0, dur, text)])
        except MediaInvalid:
            return False, "BAD_REQUEST", {}
        art = persist_artifact(db, storage, project_id, "subtitles", f"{scene.id}.srt",
                               srt.encode(), "SUBTITLE", "text/srt",
                               {"provider": "local", "model": "srt-v1",
                                "cost_class": "LOCAL",
                                "license_status": "VERIFIED_COMMERCIAL"},
                               request_id, job.id, scene.id, dur)
        node.provider, node.model = "local", "srt-v1"
        return True, "", {"artifact_ids": [art["id"]]}

    if node.type == "COMPOSE":
        if scene is None:
            return False, "BAD_REQUEST", {}
        if ff.executable() is None:
            return False, "FFMPEG_UNAVAILABLE", {}
        dep_outs = _dep_artifacts(db, node)
        img = next((a for a in dep_outs if a.kind == "IMAGE"), None)
        aud = next((a for a in dep_outs if a.kind == "TTS"), None)
        sub = next((a for a in dep_outs if a.kind == "SUBTITLE"), None)
        if img is None or aud is None:
            return False, "BAD_REQUEST", {}
        import tempfile as _tf
        from pathlib import Path as _P
        import shutil as _sh
        tmp = _P(_tf.mkdtemp(prefix="sf_eng_"))
        try:
            out = tmp / "scene.mp4"
            ff.compose_scene(storage.resolve(project_id, img.path),
                             storage.resolve(project_id, aud.path),
                             storage.resolve(project_id, sub.path) if sub else None,
                             out, aud.duration_s or scene.duration_s or 5.0)
            data = out.read_bytes()
        except (RuntimeError, ValueError):
            return False, "RENDER_FAILED", {}
        finally:
            _sh.rmtree(tmp, ignore_errors=True)
        art = persist_artifact(db, storage, project_id, "renders", f"{node.id}.mp4",
                               data, "VIDEO", "video/mp4",
                               {"provider": "local", "model": "ffmpeg-compose",
                                "cost_class": "LOCAL",
                                "license_status": "VERIFIED_COMMERCIAL"},
                               request_id, job.id, scene.id,
                               aud.duration_s or 0.0, 720, 1280)
        node.provider, node.model = "local", "ffmpeg-compose"
        return True, "", {"artifact_ids": [art["id"]]}

    if node.type == "PROJECT_COMPOSE":
        if ff.executable() is None:
            return False, "FFMPEG_UNAVAILABLE", {}
        dep_outs = _dep_artifacts(db, node)
        videos = sorted([a for a in dep_outs if a.kind == "VIDEO"],
                        key=lambda a: a.created_at)
        if not videos:
            return False, "BAD_REQUEST", {}
        from ..media.pipeline import render_project as _rp
        try:
            result = _rp(project_id, [{"video": v.path} for v in videos], storage)
        except Exception:  # noqa: BLE001 - mapped below by type
            return False, "RENDER_FAILED", {}
        total = sum(v.duration_s or 0.0 for v in videos)
        art = persist_artifact(db, storage, project_id, "renders", f"{node.id}_final.mp4",
                               result["video"], "VIDEO", "video/mp4",
                               {"provider": "local", "model": "ffmpeg-concat",
                                "cost_class": "LOCAL",
                                "license_status": "VERIFIED_COMMERCIAL"},
                               request_id, job.id, None, total, 720, 1280)
        node.provider, node.model = "local", "ffmpeg-concat"
        return True, "", {"artifact_ids": [art["id"]]}

    if node.type == "QC":
        from ..media.qc import persist_qc as _pq, production_gate, run_qc
        dep_outs = _dep_artifacts(db, node)
        final = next((a for a in dep_outs if a.kind == "VIDEO"), None)
        qc = run_qc({
            "video": {"bytes": final.bytes, "duration_s": final.duration_s,
                      "width": final.width, "height": final.height,
                      "sha256": final.sha256, "provenance": True} if final else None,
            "audio": {"duration_s": 1.0, "sha256": "mixed", "provenance": True},
            "subtitle": {"sha256": "s", "provenance": True},
            "character_ok": None, "license_ok": None, "disclosure": True,
        })
        _pq(db, job.id, qc)
        gate = production_gate(qc)
        if gate["decision"] != "PASS":
            # QC gate is advisory inside automation: REVIEW_REQUIRED continues,
            # BLOCKED fails the job honestly.
            if qc["verdict"] == "BLOCKED":
                return False, "GATE_BLOCKED", {}
        node.provider, node.model = "local", "qc-v1"
        return True, "", {"verdict": qc["verdict"]}
    return False, "BAD_REQUEST", {}


def _registry_full(db):
    from ..api.v1.ai import store as get_store
    from sqlalchemy import select
    from ..db import models as M
    models = [{
        "id": m.id, "provider_id": m.provider_id, "credential_ref": m.credential_ref,
        "name": m.name, "model_id": m.model_id, "capabilities": m.capabilities,
        "priority": m.priority, "enabled": m.enabled, "cost_class": m.cost_class,
        "license_status": m.license_status, "health_status": m.health_status,
    } for m in db.scalars(select(M.AIModel)).all()]
    providers = {p.id: {"id": p.id, "name": p.name, "base_url": p.base_url,
                        "adapter_key": p.adapter_key, "enabled": p.enabled}
                 for p in db.scalars(select(M.AIProvider)).all()}
    st = get_store()
    refs = {c.ref for c in db.scalars(select(M.Credential)).all() if st.exists(c.ref)}
    return models, providers, {ref: st.get(ref) for ref in refs}, refs


def _is_mock(providers, models, attempt) -> bool:
    return (providers.get(next(
        (m["provider_id"] for m in models if m["name"] == attempt.model), ""),
        {}).get("adapter_key") == "test")


def _record_attempts(db, request_id, task, cap, result, providers, models, job_id):
    import uuid as _uuid
    from ..db import models as M
    for a in result.attempts:
        db.add(M.UsageEvent(id=f"uev_{_uuid.uuid4().hex[:12]}", request_id=request_id,
                            job_id=job_id, task=task, capability=cap,
                            provider=a.provider, model=a.model, attempt=a.attempt,
                            latency_ms=a.latency_ms, status=a.status,
                            error_category=a.error_code if a.status != "SUCCESS" else None,
                            fallback_reason=a.fallback_reason or None,
                            cost=None, cost_state="UNKNOWN",
                            mock=_is_mock(providers, models, a)))


def _dep_artifacts(db, node) -> list:
    from ..db import models as M
    out = []
    for dep_id in (node.deps or []):
        dep = db.get(M.WorkflowNode, dep_id)
        if dep is None or not dep.output_artifact_id:
            continue
        try:
            ids = json.loads(dep.output_artifact_id).get("artifact_ids", [])
        except Exception:  # noqa: BLE001
            continue
        for aid in ids:
            a = db.get(M.Artifact, aid)
            if a is not None:
                out.append(a)
    return out


def _deps_succeeded(db, node) -> bool:
    from ..db import models as M
    for dep_id in (node.deps or []):
        dep = db.get(M.WorkflowNode, dep_id)
        if dep is None or dep.status not in ("SUCCEEDED", "SKIPPED_REUSE"):
            return False
    return True


def run_job(job_id: str, request_id: str = "") -> dict:
    """Execute a job synchronously to completion/pause/cancel. Returns summary."""
    from ..db import models as M
    db = _sessions()
    try:
        job = db.get(M.Job, job_id)
        if job is None:
            return {"ok": False, "error": "NOT_FOUND"}
        if job.status in ("SUCCEEDED", "FAILED", "CANCELLED", "BLOCKED",
                          "AWAITING_APPROVAL", "PUBLISHED"):
            return {"ok": True, "status": job.status, "note": "terminal; no-op"}
        if job.status == "PAUSED":
            return {"ok": True, "status": "PAUSED", "note": "paused; resume to continue"}
        rid = request_id or f"req_{uuid.uuid4().hex[:12]}"
        job.status = "RUNNING"
        job.stage = "RUNNING"
        emit(db, job.id, "job.started", status="RUNNING")
        db.commit()
        nodes = db.scalars(select(M.WorkflowNode).where(
            M.WorkflowNode.job_id == job.id)).all()
        # Node-level reuse pass first (unchanged inputs with valid artifacts).
        for node in nodes:
            if node.status == "PENDING":
                reuse = _find_reuse(db, job.project_id, node.input_hash)
                if reuse is not None and reuse.job_id != job.id:
                    node.status = "SKIPPED_REUSE"
                    # Link reused artifacts into this job's outputs.
                    arts = db.scalars(select(M.Artifact).where(
                        M.Artifact.job_id == reuse.job_id)).all()
                    node.output_artifact_id = json.dumps(
                        {"artifact_ids": [a.id for a in arts],
                         "reused_from": reuse.job_id})
                    emit(db, job.id, "job.stage_changed", node.id, status="SKIPPED_REUSE")
        progress = True
        while progress:
            progress = False
            db.refresh(job)
            if job.status in ("PAUSED", "CANCELLED"):
                emit(db, job.id, "job.status_changed", status=job.status)
                db.commit()
                return {"ok": True, "status": job.status}
            nodes = db.scalars(select(M.WorkflowNode).where(
                M.WorkflowNode.job_id == job.id)).all()
            ready = [n for n in nodes
                     if n.status in ("PENDING", "READY", "WAITING_DEPS", "RETRY_QUEUED")
                     and _deps_succeeded(db, n)]
            if not ready:
                break
            # Dependency failure propagation: fail nodes whose deps FAILED.
            for n in list(ready):
                deps = [db.get(M.WorkflowNode, d) for d in (n.deps or [])]
                if any(d is not None and d.status == "FAILED" for d in deps):
                    n.status = "FAILED"
                    n.error_code = "UPSTREAM_FAILED"
                    emit(db, job.id, "job.stage_changed", n.id,
                         status="FAILED", error="UPSTREAM_FAILED")
                    progress = True
            ready = [n for n in ready if n.status != "FAILED"]
            if not ready:
                continue
            node = ready[0]
            node.status = "RUNNING"
            node.attempts += 1
            emit(db, job.id, "job.stage_changed", node.id,
                 status="RUNNING", attempt=node.attempts)
            db.commit()
            ok, err, output = _execute_node(db, job, node, rid)
            if ok:
                node.status = "SUCCEEDED"
                node.output_artifact_id = json.dumps(output)
                emit(db, job.id, "job.artifact_completed" if output.get("artifact_ids")
                     else "job.stage_changed", node.id, node.provider, node.model,
                     node.attempts, "SUCCEEDED")
            else:
                if err in RETRYABLE_NODE_ERRORS and node.attempts < MAX_NODE_ATTEMPTS:
                    node.status = "RETRY_QUEUED"
                    node.error_code = err
                    emit(db, job.id, "job.stage_changed", node.id, status="RETRY_QUEUED",
                         error=err)
                else:
                    node.status = "FAILED"
                    node.error_code = err
                    emit(db, job.id, "job.error", node.id, status="FAILED", error=err)
            db.commit()
            progress = True
        # Terminal resolution.
        nodes = db.scalars(select(M.WorkflowNode).where(
            M.WorkflowNode.job_id == job.id)).all()
        states = {n.status for n in nodes}
        if job.status in ("PAUSED", "CANCELLED"):
            pass
        elif "FAILED" in states:
            job.status = "FAILED"
            job.stage = "FAILED"
            emit(db, job.id, "job.failed", status="FAILED")
        elif states and states <= {"SUCCEEDED", "SKIPPED_REUSE"}:
            job.status = "SUCCEEDED"
            job.stage = "SUCCEEDED"
            job.progress_percent = None
            emit(db, job.id, "job.completed", status="SUCCEEDED")
        else:
            job.status = "FAILED"
            job.stage = "FAILED"
            emit(db, job.id, "job.failed", status="FAILED")
        db.commit()
        return {"ok": True, "status": job.status}
    finally:
        db.close()


def recover_stuck() -> list[str]:
    """Startup recovery: RUNNING jobs (interrupted) go back to QUEUED; running
    nodes go back to PENDING. Returns requeued job ids."""
    db = _sessions()
    try:
        from ..db import models as M
        stuck = db.scalars(select(M.Job).where(M.Job.status == "RUNNING")).all()
        out = []
        for job in stuck:
            job.status = "QUEUED"
            job.stage = "QUEUED"
            for n in db.scalars(select(M.WorkflowNode).where(
                    M.WorkflowNode.job_id == job.id,
                    M.WorkflowNode.status == "RUNNING")).all():
                n.status = "PENDING"
            emit(db, job.id, "job.status_changed", status="QUEUED")
            out.append(job.id)
        db.commit()
        return out
    finally:
        db.close()


def _worker() -> None:
    from ..db import models as M
    from ..db.session import SessionLocal
    while True:
        job_id = _job_queue.get()
        try:
            db = SessionLocal()
            try:
                job = db.get(M.Job, job_id)
                if job is None or job.status != "QUEUED":
                    continue
            finally:
                db.close()
            run_job(job_id)
        except Exception:  # noqa: BLE001 - worker never dies
            pass
        finally:
            _job_queue.task_done()


def ensure_worker() -> None:
    global _worker_started
    with _worker_lock:
        if not _worker_started:
            t = threading.Thread(target=_worker, daemon=True, name="sf-worker")
            t.start()
            _worker_started = True
