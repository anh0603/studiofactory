"""Auto Pilot + Scheduler APIs."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...autopilot.service import (RUN_STATUSES, approve_run, execute_run, in_window,
                                  local_to_utc, tick_schedules, _now)
from ...core.exceptions import AppError
from ...db import models as M
from ...db.session import get_db
from .story import _get_story_project

router = APIRouter()


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "req_unknown")


class ConfigIn(BaseModel):
    enabled: bool = False
    daily_target: int = Field(default=1, ge=1, le=20)
    frequency_per_day: int = Field(default=1, ge=1, le=24)
    window_start: str = "00:00"
    window_end: str = "23:59"
    timezone: str = "Asia/Ho_Chi_Minh"
    topics: list[str] = Field(default_factory=list)
    randomization: bool = True
    max_retries_per_job: int = Field(default=2, ge=0, le=5)
    max_concurrent_jobs: int = Field(default=1, ge=1, le=5)
    allow_paid_models: bool = False
    require_approval_before_publish: bool = True
    stop_after_consecutive_failures: int = Field(default=3, ge=1, le=10)
    model_strategy: str = "AUTO"
    platforms: list[str] = Field(default_factory=list)


def _config_out(c: M.AutopilotConfig) -> dict:
    return {"id": c.id, "project_id": c.project_id, "enabled": c.enabled,
            "daily_target": c.daily_target, "frequency_per_day": c.frequency_per_day,
            "window_start": c.window_start, "window_end": c.window_end,
            "timezone": c.timezone, "topics": c.topics,
            "randomization": c.randomization,
            "max_retries_per_job": c.max_retries_per_job,
            "max_concurrent_jobs": c.max_concurrent_jobs,
            "allow_paid_models": c.allow_paid_models,
            "require_approval_before_publish": c.require_approval_before_publish,
            "stop_after_consecutive_failures": c.stop_after_consecutive_failures,
            "model_strategy": c.model_strategy, "platforms": c.platforms}


def _get_config(db: Session, project_id: str) -> M.AutopilotConfig | None:
    return db.scalar(select(M.AutopilotConfig).where(
        M.AutopilotConfig.project_id == project_id))


@router.get("/projects/{project_id}/autopilot/config")
def get_config(project_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    _get_story_project(db, project_id)
    c = _get_config(db, project_id)
    if c is None:
        raise AppError("NOT_CONFIGURED", "Auto Pilot not configured for project.", 404)
    return {"request_id": _rid(request), "data": _config_out(c)}


@router.put("/projects/{project_id}/autopilot/config")
def put_config(project_id: str, body: ConfigIn, request: Request,
               db: Session = Depends(get_db)) -> dict:
    _get_story_project(db, project_id)
    import re as _re
    for f in (body.window_start, body.window_end):
        if not _re.fullmatch(r"\d{2}:\d{2}", f):
            raise AppError("BAD_REQUEST", "window must be HH:MM", 400)
    if body.model_strategy not in ("AUTO", "PRIORITY", "WEIGHTED", "FASTEST", "CHEAPEST"):
        raise AppError("BAD_REQUEST", "unknown strategy", 400)
    try:
        from zoneinfo import ZoneInfo
        ZoneInfo(body.timezone)
    except Exception:  # noqa: BLE001
        raise AppError("BAD_REQUEST", f"unknown timezone: {body.timezone}", 400)
    c = _get_config(db, project_id)
    if c is None:
        c = M.AutopilotConfig(id=f"apc_{uuid.uuid4().hex[:12]}", project_id=project_id)
        db.add(c)
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    db.commit()
    return {"request_id": _rid(request), "data": _config_out(c)}


def _run_out(r: M.AutopilotRun) -> dict:
    return {"id": r.id, "config_id": r.config_id, "project_id": r.project_id,
            "status": r.status, "planned": r.planned, "completed": r.completed,
            "failed": r.failed, "consecutive_failures": r.consecutive_failures,
            "job_ids": r.job_ids, "schedule_ids": r.schedule_ids, "note": r.note,
            "created_at": r.created_at, "updated_at": r.updated_at}


@router.post("/projects/{project_id}/autopilot/runs", status_code=202)
def start_run(project_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    import threading
    from ...autopilot.service import execute_run_in_background
    from ...db.session import SessionLocal
    rid = _rid(request)
    _get_story_project(db, project_id)
    config = _get_config(db, project_id)
    if config is None or not config.enabled:
        raise AppError("BAD_REQUEST", "Auto Pilot not enabled for project.", 400)
    # One active run at a time (bounded concurrency).
    active = db.scalar(select(M.AutopilotRun).where(
        M.AutopilotRun.project_id == project_id,
        M.AutopilotRun.status.in_(("RUNNING", "PAUSED", "AWAITING_APPROVAL"))))
    if active is not None:
        raise AppError("CONFLICT", f"run {active.id} already active", 409)
    run = M.AutopilotRun(id=f"apr_{uuid.uuid4().hex[:12]}", config_id=config.id,
                         project_id=project_id, status="RUNNING")
    db.add(run)
    db.commit()
    db.refresh(run)
    t = threading.Thread(target=execute_run_in_background,
                         args=(run.id, rid), daemon=True, name=f"ap-{run.id}")
    t.start()
    return {"request_id": rid, "data": _run_out(run)}


@router.get("/projects/{project_id}/autopilot/runs")
def list_runs(project_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    _get_story_project(db, project_id)
    rows = db.scalars(select(M.AutopilotRun).where(
        M.AutopilotRun.project_id == project_id).order_by(
            M.AutopilotRun.created_at.desc())).all()
    return {"request_id": _rid(request), "data": [_run_out(r) for r in rows]}


def _get_run(db: Session, run_id: str) -> M.AutopilotRun:
    r = db.get(M.AutopilotRun, run_id)
    if r is None:
        raise AppError("NOT_FOUND", "Run not found.", 404)
    return r


@router.get("/autopilot/runs/{run_id}")
def get_run(run_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    return {"request_id": _rid(request), "data": _run_out(_get_run(db, run_id))}


@router.post("/autopilot/runs/{run_id}/pause")
def pause_run(run_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    r = _get_run(db, run_id)
    if r.status != "RUNNING":
        raise AppError("BAD_REQUEST", f"cannot pause run in {r.status}", 400)
    r.status = "PAUSED"
    db.commit()
    return {"request_id": _rid(request), "data": _run_out(r)}


@router.post("/autopilot/runs/{run_id}/resume")
def resume_run(run_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    import threading
    from ...autopilot.service import execute_run_in_background
    rid = _rid(request)
    r = _get_run(db, run_id)
    if r.status != "PAUSED":
        raise AppError("BAD_REQUEST", f"cannot resume run in {r.status}", 400)
    r.status = "RUNNING"
    db.commit()
    t = threading.Thread(target=execute_run_in_background,
                         args=(r.id, rid), daemon=True, name=f"ap-{r.id}")
    t.start()
    return {"request_id": rid, "data": _run_out(r)}


@router.post("/autopilot/runs/{run_id}/stop")
def stop_run(run_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    r = _get_run(db, run_id)
    if r.status in ("COMPLETED", "STOPPED", "FAILED", "BLOCKED"):
        raise AppError("BAD_REQUEST", f"run already terminal: {r.status}", 400)
    r.status = "STOPPED"
    db.commit()
    return {"request_id": _rid(request), "data": _run_out(r)}


@router.post("/autopilot/runs/{run_id}/approve")
def approve_publish(run_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    r = _get_run(db, run_id)
    try:
        approve_run(db, r, _rid(request))
    except ValueError as exc:
        raise AppError("BAD_REQUEST", str(exc), 400)
    return {"request_id": _rid(request), "data": _run_out(r)}


# ------------------------------------------------------------------ scheduler

class ScheduleIn(BaseModel):
    job_id: str | None = None
    date: str = ""  # YYYY-MM-DD (local to timezone)
    time: str = ""  # HH:MM
    timezone: str = "Asia/Ho_Chi_Minh"
    recurrence: str | None = None
    platforms: list[str] = Field(default_factory=list)
    idempotency_key: str = Field(min_length=1, max_length=128)


def _sched_out(s: M.Schedule) -> dict:
    return {"id": s.id, "project_id": s.project_id, "job_id": s.job_id,
            "run_at": s.run_at, "timezone": s.timezone,
            "recurrence": s.recurrence, "platforms": s.platforms,
            "status": s.status, "note": s.note}


@router.post("/projects/{project_id}/scheduler/schedules", status_code=201)
def create_schedule(project_id: str, body: ScheduleIn, request: Request,
                    db: Session = Depends(get_db)) -> dict:
    rid = _rid(request)
    _get_story_project(db, project_id)
    if body.recurrence not in (None, "daily"):
        raise AppError("BAD_REQUEST", "recurrence must be null or daily", 400)
    try:
        run_at = local_to_utc(body.date, body.time, body.timezone)
    except ValueError as exc:
        raise AppError("BAD_REQUEST", str(exc), 400)
    if body.job_id:
        job = db.get(M.Job, body.job_id)
        if job is None or job.project_id != project_id:
            raise AppError("BAD_REQUEST", "job not in project", 400)
    existing = db.scalar(select(M.Schedule).where(
        M.Schedule.idempotency_key == body.idempotency_key))
    if existing is not None:
        return {"request_id": rid, "data": {**_sched_out(existing), "replay": True}}
    s = M.Schedule(id=f"sch_{uuid.uuid4().hex[:12]}", project_id=project_id,
                   job_id=body.job_id, run_at=run_at, timezone=body.timezone,
                   recurrence=body.recurrence, platforms=body.platforms,
                   status="SCHEDULED", idempotency_key=body.idempotency_key)
    db.add(s)
    db.commit()
    return {"request_id": rid, "data": {**_sched_out(s), "replay": False}}


@router.get("/projects/{project_id}/scheduler/schedules")
def list_schedules(project_id: str, request: Request,
                   status: str | None = None, db: Session = Depends(get_db)) -> dict:
    _get_story_project(db, project_id)
    q = select(M.Schedule).where(M.Schedule.project_id == project_id).order_by(
        M.Schedule.run_at)
    if status:
        q = q.where(M.Schedule.status == status)
    return {"request_id": _rid(request),
            "data": [_sched_out(s) for s in db.scalars(q).all()]}


@router.get("/scheduler/schedules/{schedule_id}")
def get_schedule(schedule_id: str, request: Request,
                 db: Session = Depends(get_db)) -> dict:
    s = db.get(M.Schedule, schedule_id)
    if s is None:
        raise AppError("NOT_FOUND", "Schedule not found.", 404)
    return {"request_id": _rid(request), "data": _sched_out(s)}


class RescheduleIn(BaseModel):
    date: str = ""
    time: str = ""


@router.patch("/scheduler/schedules/{schedule_id}")
def reschedule(schedule_id: str, body: RescheduleIn, request: Request,
               db: Session = Depends(get_db)) -> dict:
    s = db.get(M.Schedule, schedule_id)
    if s is None:
        raise AppError("NOT_FOUND", "Schedule not found.", 404)
    if s.status not in ("SCHEDULED", "MISSED"):
        raise AppError("BAD_REQUEST", f"cannot reschedule {s.status}", 400)
    try:
        s.run_at = local_to_utc(body.date, body.time, s.timezone)
    except ValueError as exc:
        raise AppError("BAD_REQUEST", str(exc), 400)
    s.status = "SCHEDULED"
    s.note = ""
    db.commit()
    return {"request_id": _rid(request), "data": _sched_out(s)}


@router.delete("/scheduler/schedules/{schedule_id}")
def cancel_schedule(schedule_id: str, request: Request,
                    db: Session = Depends(get_db)) -> dict:
    s = db.get(M.Schedule, schedule_id)
    if s is None:
        raise AppError("NOT_FOUND", "Schedule not found.", 404)
    if s.status in ("DISPATCHED", "CANCELLED"):
        raise AppError("BAD_REQUEST", f"cannot cancel {s.status}", 400)
    s.status = "CANCELLED"
    db.commit()
    return {"request_id": _rid(request), "data": _sched_out(s)}


@router.post("/scheduler/tick")
def tick(request: Request, db: Session = Depends(get_db)) -> dict:
    """Execute due slots. Deterministic entry point for workers/tests."""
    return {"request_id": _rid(request), "data": {"processed": tick_schedules(db)}}
