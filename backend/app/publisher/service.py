"""Publisher dispatch: gate-checked, idempotent, bounded retry, confirm-only ids."""
from __future__ import annotations

import json as _json
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from .platforms import PublishPayload, get_platform_adapter

MAX_ATTEMPTS = 3
RETRY_DELAYS = (60.0, 300.0, 900.0)

_pub_queue: list[str] = []
_pub_lock = threading.Lock()
_pub_worker_started = False
PUB_AUTO_DISPATCH = True
SessionFactory = None
PROJECTS_ROOT = None


def _sessions():
    if SessionFactory is not None:
        return SessionFactory()
    from ..db.session import SessionLocal
    return SessionLocal()


def _now():
    return datetime.now(timezone.utc)


def enqueue(publish_job_id: str) -> None:
    global _pub_worker_started
    with _pub_lock:
        _pub_queue.append(publish_job_id)
        if PUB_AUTO_DISPATCH and not _pub_worker_started:
            _pub_worker_started = True
            threading.Thread(target=_worker, daemon=True, name="sf-publisher").start()


def _worker() -> None:
    while True:
        with _pub_lock:
            if not _pub_queue:
                job_id = None
            else:
                job_id = _pub_queue.pop(0)
        if job_id is None:
            time.sleep(0.5)
            continue
        try:
            dispatch(job_id)
        except Exception:  # noqa: BLE001 - publisher worker never dies
            pass


def _token_for(db, conn) -> str:
    """Resolve + refresh OAuth token. Raises with typed code on failure."""
    from ..api.v1.publisher import _cred_store
    from .platforms import OAuthError, refresh_access_token
    store = _cred_store()
    if not conn.token_ref or not store.exists(conn.token_ref):
        raise OAuthError("CREDENTIAL_MISSING", "no token stored")
    raw = store.get(conn.token_ref)
    try:
        tok = _json.loads(raw)
    except Exception:  # noqa: BLE001
        raise OAuthError("AUTH_FAILED", "token corrupted")
    exp = tok.get("expiry", 0)
    if exp and exp - time.time() > 120:
        return tok["access"]
    # Refresh path (client secrets live server-side in settings-like env only).
    import os
    cid = os.environ.get(f"{conn.platform.upper()}_CLIENT_ID", "")
    csec = os.environ.get(f"{conn.platform.upper()}_CLIENT_SECRET", "")
    if not cid or not csec or not tok.get("refresh"):
        raise OAuthError("AUTH_FAILED", "token expired; reconnect required")
    data = refresh_access_token(conn.platform, tok["refresh"], cid, csec)
    tok["access"] = data["access_token"]
    tok["expiry"] = time.time() + int(data.get("expires_in", 3600))
    store.save(conn.token_ref, _json.dumps(tok))
    conn.token_expiry = datetime.fromtimestamp(tok["expiry"], timezone.utc)
    db.flush()
    return tok["access"]


def dispatch(publish_job_id: str) -> dict:
    """Execute all QUEUED/RETRYABLE attempts once. Returns summary."""
    from ..db import models as M
    db = _sessions()
    try:
        job = db.get(M.PublishJob, publish_job_id)
        if job is None:
            return {"ok": False, "error": "NOT_FOUND"}
        # Already-confirmed attempts are never resent (duplicate prevention).
        attempts = db.scalars(select(M.PublishAttempt).where(
            M.PublishAttempt.publish_job_id == job.id)).all()
        # Load video bytes once from project artifacts (final render preferred).
        video = _load_video(db, job.project_id, job.job_id)
        if video is None:
            for a in attempts:
                if a.status in ("QUEUED", "RETRYABLE_ERROR"):
                    a.status = "FATAL_ERROR"
                    a.reason = "no rendered video"
            db.commit()
            return {"ok": False, "error": "no rendered video"}
        payload = PublishPayload(title=job.title or "Untitled",
                                 description=job.description or "",
                                 hashtags=list(job.hashtags or []),
                                 video_bytes=video)
        for a in attempts:
            if a.status == "CONFIRMED_PUBLISHED":
                continue  # never republish confirmed
            if a.status == "FATAL_ERROR":
                continue
            if a.status == "RETRYABLE_ERROR" and a.next_retry_at and a.next_retry_at > _now():
                continue  # backoff not elapsed
            conn = db.scalar(select(M.SocialConnection).where(
                M.SocialConnection.platform == a.platform).order_by(
                    M.SocialConnection.created_at.desc()))
            if conn is None or conn.status != "CONNECTED":
                a.status = "RETRYABLE_ERROR"
                a.reason = "platform not connected"
                continue
            try:
                token = _token_for(db, conn)
            except Exception as exc:  # noqa: BLE001 - OAuthError typed
                code = getattr(exc, "code", "AUTH_FAILED")
                a.status = "FATAL_ERROR" if code in ("CREDENTIAL_MISSING",) else "RETRYABLE_ERROR"
                a.reason = f"{code}: {str(exc)[:150]}"
                continue
            a.status = "SENDING"
            a.attempts += 1
            db.flush()
            try:
                adapter = get_platform_adapter(a.platform)
            except ValueError:
                a.status = "FATAL_ERROR"
                a.reason = "unsupported platform"
                continue
            res = adapter.upload(payload, token)
            if res.ok and res.post_id:
                a.status = "CONFIRMED_PUBLISHED"
                a.platform_post_id = res.post_id  # ONLY on confirmation
                a.reason = ""
            elif res.retryable and a.attempts < MAX_ATTEMPTS:
                a.status = "RETRYABLE_ERROR"
                delay = RETRY_DELAYS[min(a.attempts - 1, len(RETRY_DELAYS) - 1)]
                a.next_retry_at = _now() + timedelta(seconds=delay)
                a.reason = f"{res.error_code}: {res.message[:150]}"
            else:
                a.status = "FATAL_ERROR"
                a.reason = f"{res.error_code}: {res.message[:150]}"
        db.commit()
        return {"ok": True, "job_id": job.id}
    finally:
        db.close()


def _load_video(db, project_id: str, job_id: str | None) -> bytes | None:
    from ..db import models as M
    from ..core.config import settings as _settings
    from ..storage.local import LocalStorage
    root = PROJECTS_ROOT or getattr(_settings, "projects_root", "./projects")
    storage = LocalStorage(root)
    # Prefer project final render, else latest scene render of the job.
    cands = db.scalars(select(M.Artifact).where(
        M.Artifact.kind == "VIDEO").order_by(M.Artifact.created_at.desc())).all()
    for a in cands:
        job = db.get(M.Job, a.job_id) if a.job_id.startswith("JOB-") else None
        same_project = (job is not None and job.project_id == project_id)
        if not same_project:
            continue
        if a.scene_id is None and a.path.startswith("renders/"):
            try:
                return storage.resolve(project_id, a.path).read_bytes()
            except Exception:  # noqa: BLE001
                continue
    for a in cands:
        if job_id and a.job_id == job_id and a.path.startswith("renders/"):
            try:
                return storage.resolve(project_id, a.path).read_bytes()
            except Exception:  # noqa: BLE001
                continue
    return None
