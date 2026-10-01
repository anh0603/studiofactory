"""Jobs API: create (idempotent) / list / detail / pause / resume / cancel / retry.

Execution lives in app.engine.runner (background worker + run_job sync core).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.exceptions import AppError
from ...db import models as M
from ...db.session import get_db
from ...engine.runner import AUTO_DISPATCH, create_job, emit, ensure_worker, recover_stuck
from .story import _get_story_project

router = APIRouter()

JOB_KINDS = ("FULL_PIPELINE",)


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "req_unknown")


class JobIn(BaseModel):
    project_id: str
    kind: str = "FULL_PIPELINE"
    idempotency_key: str = Field(min_length=1, max_length=128)


def _job_out(job: M.Job, nodes: list | None = None) -> dict:
    return {"id": job.id, "project_id": job.project_id, "kind": job.kind,
            "status": job.status, "stage": job.stage,
            "provider": job.provider, "model": job.model,
            "progress_percent": job.progress_percent, "status_text": job.status_text,
            "attempts": job.attempts, "error_code": job.error_code,
            "created_at": job.created_at, "updated_at": job.updated_at,
            "nodes": nodes}


def _node_out(n: M.WorkflowNode) -> dict:
    import json as _json
    try:
        output = _json.loads(n.output_artifact_id) if n.output_artifact_id else {}
    except Exception:  # noqa: BLE001
        output = {}
    return {"id": n.id, "job_id": n.job_id, "type": n.type, "status": n.status,
            "attempts": n.attempts, "provider": n.provider, "model": n.model,
            "error_code": n.error_code, "output": output,
            "started_at": n.started_at, "ended_at": n.ended_at}


@router.post("/jobs", status_code=201)
def post_job(body: JobIn, request: Request, db: Session = Depends(get_db)) -> dict:
    rid = _rid(request)
    project = _get_story_project(db, body.project_id)
    if body.kind not in JOB_KINDS:
        raise AppError("BAD_REQUEST", f"unknown kind: {body.kind}", 400)
    if body.kind == "FULL_PIPELINE":
        # Gate: approved director plan required before automation runs media.
        latest = db.scalar(select(M.DirectorPlan).where(
            M.DirectorPlan.project_id == project.id).order_by(
                M.DirectorPlan.version.desc()))
        if latest is None or latest.status != "APPROVED":
            raise AppError("APPROVAL_REQUIRED",
                           "FULL_PIPELINE requires an APPROVED Director Plan.", 409)
        scenes = db.scalars(select(M.Scene).where(
            M.Scene.project_id == project.id)).all()
        if not scenes:
            raise AppError("BAD_REQUEST", "project has no scenes", 400)
    job, created = create_job(db, project.id, body.kind, body.idempotency_key, rid)
    nodes = db.scalars(select(M.WorkflowNode).where(
        M.WorkflowNode.job_id == job.id)).all()
    return {"request_id": rid, "data": {**_job_out(job),
                                       "nodes": [_node_out(n) for n in nodes],
                                       "replay": not created}}


@router.get("/jobs")
def list_jobs(request: Request, status: str | None = None,
              limit: int = 20, db: Session = Depends(get_db)) -> dict:
    q = select(M.Job).order_by(M.Job.created_at.desc()).limit(min(limit, 100))
    if status:
        q = q.where(M.Job.status == status)
    rows = db.scalars(q).all()
    return {"request_id": _rid(request), "data": [_job_out(j) for j in rows]}


def _get_job(db: Session, job_id: str) -> M.Job:
    job = db.get(M.Job, job_id)
    if job is None:
        raise AppError("NOT_FOUND", "Job not found.", 404)
    return job


@router.get("/jobs/{job_id}")
def get_job(job_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    job = _get_job(db, job_id)
    nodes = db.scalars(select(M.WorkflowNode).where(
        M.WorkflowNode.job_id == job.id)).all()
    events = db.scalars(select(M.JobEvent).where(
        M.JobEvent.job_id == job.id).order_by(M.JobEvent.created_at)).all()
    data = _job_out(job, [_node_out(n) for n in nodes])
    data["events"] = [{"event": e.event, "node_id": e.node_id, "status": e.status,
                       "error_category": e.error_category,
                       "created_at": e.created_at} for e in events]
    return {"request_id": _rid(request), "data": data}


@router.post("/jobs/{job_id}/pause")
def pause_job(job_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    job = _get_job(db, job_id)
    if job.status not in ("QUEUED", "RUNNING"):
        raise AppError("BAD_REQUEST", f"cannot pause job in {job.status}", 400)
    job.status = "PAUSED"
    job.stage = "PAUSED"
    emit(db, job.id, "job.status_changed", status="PAUSED")
    db.commit()
    return {"request_id": _rid(request), "data": _job_out(job)}


@router.post("/jobs/{job_id}/resume")
def resume_job(job_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    from ...engine.runner import _job_queue
    job = _get_job(db, job_id)
    if job.status != "PAUSED":
        raise AppError("BAD_REQUEST", f"cannot resume job in {job.status}", 400)
    job.status = "QUEUED"
    job.stage = "QUEUED"
    emit(db, job.id, "job.status_changed", status="QUEUED")
    db.commit()
    if AUTO_DISPATCH:
        ensure_worker()
        _job_queue.put(job.id)
    return {"request_id": _rid(request), "data": _job_out(job)}


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    job = _get_job(db, job_id)
    if job.status in ("SUCCEEDED", "FAILED", "CANCELLED", "PUBLISHED", "BLOCKED"):
        raise AppError("BAD_REQUEST", f"cannot cancel terminal job in {job.status}", 400)
    job.status = "CANCELLED"
    job.stage = "CANCELLED"
    emit(db, job.id, "job.status_changed", status="CANCELLED")
    db.commit()
    return {"request_id": _rid(request), "data": _job_out(job)}


@router.post("/jobs/{job_id}/retry")
def retry_job(job_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    from ...engine.runner import _job_queue
    job = _get_job(db, job_id)
    if job.status != "FAILED":
        raise AppError("BAD_REQUEST", "only FAILED jobs can be retried", 400)
    nodes = db.scalars(select(M.WorkflowNode).where(
        M.WorkflowNode.job_id == job.id)).all()
    non_retryable = False
    for n in nodes:
        if n.status == "FAILED":
            from ...engine.runner import RETRYABLE_NODE_ERRORS
            if n.error_code in RETRYABLE_NODE_ERRORS:
                n.status = "RETRY_QUEUED"
            else:
                non_retryable = True
    if non_retryable and not any(n.status == "RETRY_QUEUED" for n in nodes):
        raise AppError("BAD_REQUEST",
                       "job failed with non-retryable error; fix inputs first", 400)
    job.status = "QUEUED"
    job.stage = "QUEUED"
    emit(db, job.id, "job.status_changed", status="QUEUED")
    db.commit()
    if AUTO_DISPATCH:
        ensure_worker()
        _job_queue.put(job.id)
    return {"request_id": _rid(request), "data": _job_out(job)}


@router.post("/jobs/recover")
def recover_jobs(request: Request, db: Session = Depends(get_db)) -> dict:
    """Requeue jobs stuck RUNNING (interrupted workers). Idempotent."""
    ids = recover_stuck()
    return {"request_id": _rid(request), "data": {"requeued": ids}}
