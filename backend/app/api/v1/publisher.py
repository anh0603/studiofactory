"""Publisher + Connections APIs. Gate-enforced publish, secret-free responses."""
from __future__ import annotations

import json as _json
import time
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.exceptions import AppError
from ...db import models as M
from ...db.session import get_db
from ...publisher.platforms import (OAUTH_ENDPOINTS, OAuthError, build_authorize_url,
                                    exchange_code, get_platform_adapter)
from ...publisher.service import dispatch, enqueue
from .story import _get_story_project

router = APIRouter()

PLATFORMS = ("youtube", "tiktok", "facebook")


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "req_unknown")


def _cred_store():
    from ...api.v1.ai import store as get_store
    return get_store()


# --------------------------------------------------------------- connections

def _conn_out(c: M.SocialConnection | None, platform: str) -> dict:
    if c is None:
        return {"platform": platform, "status": "CONFIG_REQUIRED",
                "account": None, "scopes": [], "token_expiry": None,
                "support_state": "CONFIG_REQUIRED"}
    return {"platform": platform, "status": c.status, "account": c.account_label or None,
            "scopes": c.scopes, "token_expiry": c.token_expiry,
            "support_state": "SUPPORTED" if c.status == "CONNECTED" else c.status}


@router.get("/connections")
def list_connections(request: Request, db: Session = Depends(get_db)) -> dict:
    out = []
    for p in PLATFORMS:
        c = db.scalar(select(M.SocialConnection).where(
            M.SocialConnection.platform == p).order_by(
                M.SocialConnection.created_at.desc()))
        out.append(_conn_out(c, p))
    return {"request_id": _rid(request), "data": out}


@router.get("/publisher/platforms")
def list_platforms(request: Request, db: Session = Depends(get_db)) -> dict:
    return {"request_id": _rid(request),
            "data": list_connections(request, db)["data"]}


class OAuthStartIn(BaseModel):
    redirect_uri: str = ""
    client_id: str = ""  # BYOK: user supplies their own OAuth client


@router.post("/publisher/connections/{platform}/start")
def oauth_start(platform: str, body: OAuthStartIn, request: Request,
                db: Session = Depends(get_db)) -> dict:
    if platform not in PLATFORMS:
        raise AppError("BAD_REQUEST", "unsupported platform", 400)
    if not body.client_id:
        # No client credentials -> honest CONFIG_REQUIRED, no fake URL.
        return {"request_id": _rid(request),
                "data": {"status": "CONFIG_REQUIRED",
                         "message": "Provide your OAuth client_id (BYOK) to connect."}}
    state = f"st_{uuid.uuid4().hex[:16]}"
    url = build_authorize_url(platform, body.client_id,
                              body.redirect_uri or "http://localhost:5173/oauth/callback",
                              state)
    c = db.scalar(select(M.SocialConnection).where(
        M.SocialConnection.platform == platform).order_by(
            M.SocialConnection.created_at.desc()))
    if c is None:
        c = M.SocialConnection(id=f"soc_{uuid.uuid4().hex[:12]}", platform=platform,
                               status="NOT_CONNECTED")
        db.add(c)
    c.oauth_state = state
    c.status = "NOT_CONNECTED"
    db.commit()
    # Never store client_secret server-side in Phase 7 (user passes at callback).
    return {"request_id": _rid(request), "data": {"status": "NOT_CONNECTED",
                                                 "authorize_url": url, "state": state}}


class OAuthCallbackIn(BaseModel):
    code: str
    state: str
    client_id: str
    client_secret: str
    redirect_uri: str = "http://localhost:5173/oauth/callback"
    account_label: str = ""


@router.post("/publisher/connections/{platform}/callback")
def oauth_callback(platform: str, body: OAuthCallbackIn, request: Request,
                   db: Session = Depends(get_db)) -> dict:
    if platform not in PLATFORMS:
        raise AppError("BAD_REQUEST", "unsupported platform", 400)
    c = db.scalar(select(M.SocialConnection).where(
        M.SocialConnection.platform == platform).order_by(
            M.SocialConnection.created_at.desc()))
    if c is None or c.oauth_state != body.state:
        raise AppError("BAD_REQUEST", "invalid or expired oauth state", 400)
    try:
        data = exchange_code(platform, body.code, body.client_id,
                             body.client_secret, body.redirect_uri)
    except OAuthError as exc:
        c.status = "AUTH_FAILED"
        db.commit()
        raise AppError(exc.code, f"OAuth failed: {exc.message}", 401)
    ref = c.token_ref or f"tok_{uuid.uuid4().hex[:12]}"
    _cred_store().save(ref, _json.dumps({
        "access": data["access_token"], "refresh": data.get("refresh_token", ""),
        "expiry": time.time() + int(data.get("expires_in", 3600))}))
    c.token_ref = ref
    c.status = "CONNECTED"
    c.account_label = body.account_label or c.account_label
    c.scopes = OAUTH_ENDPOINTS[platform]["scopes"]
    c.token_expiry = datetime.fromtimestamp(
        time.time() + int(data.get("expires_in", 3600)), timezone.utc)
    c.oauth_state = None
    db.commit()
    return {"request_id": _rid(request), "data": _conn_out(c, platform)}


@router.post("/publisher/connections/{platform}/disconnect")
def oauth_disconnect(platform: str, request: Request,
                     db: Session = Depends(get_db)) -> dict:
    if platform not in PLATFORMS:
        raise AppError("BAD_REQUEST", "unsupported platform", 400)
    c = db.scalar(select(M.SocialConnection).where(
        M.SocialConnection.platform == platform).order_by(
            M.SocialConnection.created_at.desc()))
    if c is None:
        raise AppError("NOT_FOUND", "No connection.", 404)
    if c.token_ref:
        try:
            _cred_store().delete(c.token_ref)
        except Exception:  # noqa: BLE001
            pass
        c.token_ref = ""
    c.status = "NOT_CONNECTED"
    c.token_expiry = None
    db.commit()
    return {"request_id": _rid(request), "data": _conn_out(c, platform)}


# ------------------------------------------------------------------- publish

class PublishIn(BaseModel):
    job_id: str | None = None
    schedule_id: str | None = None
    platforms: list[str] = Field(min_length=1)
    title: str = ""
    description: str = ""
    hashtags: list[str] = Field(default_factory=list)
    mode: str = "NOW"
    idempotency_key: str = Field(min_length=1, max_length=128)


def _publish_out(job: M.PublishJob, attempts: list) -> dict:
    return {"id": job.id, "project_id": job.project_id, "mode": job.mode,
            "title": job.title, "platforms": job.platforms,
            "attempts": [{"platform": a.platform, "status": a.status,
                          "platform_post_id": a.platform_post_id,
                          "reason": a.reason, "attempts": a.attempts}
                         for a in attempts]}


@router.post("/publisher/publish", status_code=201)
def publish(body: PublishIn, request: Request, db: Session = Depends(get_db)) -> dict:
    from .media import QCIn, run_project_qc
    rid = _rid(request)
    for p in body.platforms:
        if p not in PLATFORMS:
            raise AppError("BAD_REQUEST", f"unsupported platform: {p}", 400)
    existing = db.scalar(select(M.PublishJob).where(
        M.PublishJob.idempotency_key == body.idempotency_key))
    if existing is not None:
        attempts = db.scalars(select(M.PublishAttempt).where(
            M.PublishAttempt.publish_job_id == existing.id)).all()
        return {"request_id": rid, "data": {**_publish_out(existing, attempts),
                                           "replay": True}}
    project_id = None
    if body.job_id:
        job = db.get(M.Job, body.job_id)
        if job is None:
            raise AppError("NOT_FOUND", "Job not found.", 404)
        project_id = job.project_id
    elif body.schedule_id:
        sched = db.get(M.Schedule, body.schedule_id)
        if sched is None:
            raise AppError("NOT_FOUND", "Schedule not found.", 404)
        project_id = sched.project_id
    else:
        raise AppError("BAD_REQUEST", "job_id or schedule_id required", 400)
    _get_story_project(db, project_id)
    # Server-side Production Gate: no bypass parameter exists.
    from ...media.qc import production_gate as _gate
    qc_data = run_project_qc(project_id, QCIn(disclosure=True),
                             SimpleNamespace(state=SimpleNamespace(request_id=rid)), db)["data"]
    gate = _gate(qc_data["qc"])
    if gate["decision"] != "PASS":
        raise AppError("PRODUCTION_BLOCKED",
                       f"Publish blocked by Production Gate: {'; '.join(gate['reasons'])}", 422)
    # Platform readiness: every platform must be CONNECTED, else honest 409.
    not_ready = []
    for p in body.platforms:
        c = db.scalar(select(M.SocialConnection).where(
            M.SocialConnection.platform == p).order_by(
                M.SocialConnection.created_at.desc()))
        if c is None or c.status != "CONNECTED":
            not_ready.append(p)
    if not_ready:
        raise AppError("PUBLISH_CONFIG_REQUIRED",
                       f"Platforms not connected: {', '.join(not_ready)}", 409)
    job = M.PublishJob(id=f"pub_{uuid.uuid4().hex[:12]}", project_id=project_id,
                       job_id=body.job_id, schedule_id=body.schedule_id,
                       mode=body.mode, title=body.title,
                       description=body.description, hashtags=body.hashtags,
                       platforms=body.platforms, idempotency_key=body.idempotency_key)
    db.add(job)
    db.flush()
    for p in body.platforms:
        db.add(M.PublishAttempt(id=f"pba_{uuid.uuid4().hex[:12]}",
                                publish_job_id=job.id, platform=p, status="QUEUED"))
    db.commit()
    enqueue(job.id)
    attempts = db.scalars(select(M.PublishAttempt).where(
        M.PublishAttempt.publish_job_id == job.id)).all()
    return {"request_id": rid, "data": {**_publish_out(job, attempts), "replay": False}}


@router.get("/publisher/jobs/{publish_id}")
def publish_status(publish_id: str, request: Request,
                   db: Session = Depends(get_db)) -> dict:
    job = db.get(M.PublishJob, publish_id)
    if job is None:
        raise AppError("NOT_FOUND", "Publish job not found.", 404)
    attempts = db.scalars(select(M.PublishAttempt).where(
        M.PublishAttempt.publish_job_id == job.id)).all()
    return {"request_id": _rid(request), "data": _publish_out(job, attempts)}


@router.post("/publisher/jobs/{publish_id}/retry")
def publish_retry(publish_id: str, request: Request,
                  db: Session = Depends(get_db)) -> dict:
    job = db.get(M.PublishJob, publish_id)
    if job is None:
        raise AppError("NOT_FOUND", "Publish job not found.", 404)
    attempts = db.scalars(select(M.PublishAttempt).where(
        M.PublishAttempt.publish_job_id == job.id)).all()
    retryable = [a for a in attempts if a.status == "RETRYABLE_ERROR"]
    if not retryable:
        raise AppError("BAD_REQUEST", "no retryable attempts", 400)
    for a in retryable:
        a.next_retry_at = None  # release backoff; same payload, no duplicate post
    db.commit()
    enqueue(job.id)
    return {"request_id": _rid(request), "data": _publish_out(job, attempts)}
