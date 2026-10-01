"""Auto Pilot + Scheduler execution. All generation via Router/engine/QC.

Run flow per item: idea -> director (Router) -> approve(actor=autopilot) ->
scenes -> engine FULL_PIPELINE job -> QC -> gate ->
  require_approval ? AWAITING_APPROVAL : schedule.
Autopilot never bypasses Router policy, QC, Gate, or idempotency.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select

RUN_STATUSES = ("RUNNING", "PAUSED", "COMPLETED", "BLOCKED", "FAILED",
                "STOPPED", "AWAITING_APPROVAL")
SCHED_STATUSES = ("SCHEDULED", "CLAIMED", "DISPATCHED", "MISSED", "CANCELLED")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _tz(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name or "Asia/Ho_Chi_Minh")
    except ZoneInfoNotFoundError:
        raise ValueError(f"unknown timezone: {name}")


def in_window(now_utc: datetime, tz: str, start: str, end: str) -> bool:
    local = now_utc.astimezone(_tz(tz))
    cur = local.strftime("%H:%M")
    return start <= cur <= end


def pick_idea(topics: list[str], run_seq: int, item_idx: int, randomize: bool) -> str:
    topics = topics or ["a brave little animal adventure"]
    if randomize:
        h = int(hashlib.sha256(f"{run_seq}:{item_idx}".encode()).hexdigest(), 16)
        return topics[h % len(topics)]
    return topics[(item_idx) % len(topics)]


def local_to_utc(date_s: str, time_s: str, tz: str) -> datetime:
    """'2026-10-02' + '20:00' + tz -> aware UTC. Raises ValueError."""
    zone = _tz(tz)
    try:
        naive = datetime.strptime(f"{date_s} {time_s}", "%Y-%m-%d %H:%M")
    except ValueError:
        raise ValueError("expected date YYYY-MM-DD and time HH:MM")
    return naive.replace(tzinfo=zone).astimezone(timezone.utc)


def _fake_request(request_id: str):
    return SimpleNamespace(state=SimpleNamespace(request_id=request_id))


def _db_factory():
    if DB_FACTORY is not None:
        return DB_FACTORY
    from ..db.session import SessionLocal
    return SessionLocal


# Overridable in tests (file-backed TestingSession for thread visibility).
DB_FACTORY = None


def execute_run_in_background(run_id: str, request_id: str,
                              db_factory=None) -> None:
    """Thread entry: fresh session, load run+config, execute, close."""
    from ..db import models as M
    factory = db_factory or _db_factory()
    db = factory()
    try:
        run = db.get(M.AutopilotRun, run_id)
        if run is None:
            return
        config = db.get(M.AutopilotConfig, run.config_id)
        execute_run(db, run, config, request_id)
    finally:
        db.close()


def execute_run(db, run, config, request_id: str) -> dict:
    """Run autopilot items synchronously. Returns summary. Bounded by config."""
    from ..api.v1.director import _route_for_director
    from ..ai.director import build_prompt, extract_json, validate_plan
    from ..db import models as M
    from ..engine.runner import create_job, run_job

    project = db.get(M.Project, run.project_id)
    if project is None:
        run.status = "FAILED"
        run.note = "project gone"
        db.commit()
        return {"ok": False, "status": "FAILED"}
    if not in_window(_now(), config.timezone, config.window_start, config.window_end):
        run.status = "FAILED"
        run.note = "outside generation window"
        db.commit()
        return {"ok": False, "status": "FAILED"}

    for i in range(config.daily_target):
        db.refresh(run)
        if run.status in ("PAUSED", "STOPPED"):
            db.commit()
            return {"ok": True, "status": run.status}
        idea = pick_idea(config.topics, 0, run.planned, config.randomization)
        run.planned += 1
        db.flush()  # persist counter before refresh() calls below
        try:
            prompt = build_prompt(idea, project.audience or "general", "warm",
                                  project.duration_target or 30.0,
                                  project.language or "vi", project.style or "", [])
            output, provider, model, mock_any = _route_for_director(
                db, prompt, config.model_strategy, None,
                config.allow_paid_models, False, f"{request_id}-ap{i}")
            plan = validate_plan(extract_json(output))
        except Exception as exc:  # noqa: BLE001 - router/parse typed errors
            run.failed += 1
            run.consecutive_failures += 1
            run.note = f"item {i}: {type(exc).__name__}: {str(exc)[:200]}"
            if run.consecutive_failures >= config.stop_after_consecutive_failures:
                run.status = "BLOCKED"
                run.note += " | auto-stopped: consecutive failures"
            db.commit()  # persist before next refresh()/return
            if run.status == "BLOCKED":
                return {"ok": False, "status": "BLOCKED"}
            continue
        # Persist plan (actor=autopilot) + auto-approve director stage.
        from sqlalchemy import func as _func
        version = (db.scalar(select(_func.max(M.DirectorPlan.version)).where(
            M.DirectorPlan.project_id == project.id)) or 0) + 1
        row = M.DirectorPlan(
            id=f"dpl_{uuid.uuid4().hex[:12]}", project_id=project.id,
            version=version, status="APPROVED", origin="GENERATED",
            parent_version=None,
            input_snapshot={"idea": idea, "actor": "autopilot",
                            "strategy": config.model_strategy},
            plan=plan.model_dump(), provider=provider, model=model,
            request_id=f"{request_id}-ap{i}", mock=mock_any)
        db.add(row)
        db.flush()
        # Scenes from plan.
        for sc in plan.scenes:
            db.add(M.Scene(id=f"scn_{uuid.uuid4().hex[:12]}", project_id=project.id,
                           idx=sc.scene_number, description=sc.description,
                           characters_json=[], dialogue=sc.dialogue,
                           visual_prompt=sc.visual_prompt, camera=sc.camera,
                           motion="", environment="",
                           duration_s=sc.duration or 5.0, status="PLANNED"))
        db.flush()
        job, _ = create_job(db, project.id, "FULL_PIPELINE",
                            f"ap-{run.id}-{i}", f"{request_id}-ap{i}")
        run.job_ids = [*run.job_ids, job.id]
        db.commit()
        summary = run_job(job.id, f"{request_id}-ap{i}")
        db.refresh(job)
        if summary.get("status") != "SUCCEEDED":
            run.failed += 1
            run.consecutive_failures += 1
            if run.consecutive_failures >= config.stop_after_consecutive_failures:
                run.status = "BLOCKED"
                db.commit()
                return {"ok": False, "status": "BLOCKED"}
            db.commit()  # persist before next refresh()
            continue
        run.consecutive_failures = 0
        # QC + gate over the finished job's project artifacts.
        from ..api.v1.media import run_project_qc
        from ..api.v1.media import QCIn
        qc_res = run_project_qc(project.id, QCIn(disclosure=True),
                                _fake_request(f"{request_id}-ap{i}"), db)
        gate = qc_res["data"]["gate"]
        if gate["decision"] != "PASS":
            run.failed += 1
            run.consecutive_failures += 1
            run.note = f"item {i}: gate BLOCKED: {'; '.join(gate['reasons'])[:200]}"
            if run.consecutive_failures >= config.stop_after_consecutive_failures:
                run.status = "BLOCKED"
                db.commit()
                return {"ok": False, "status": "BLOCKED"}
            db.commit()  # persist before next refresh()
            continue
        run.completed += 1
        run.note = ""
        if config.require_approval_before_publish:
            run.status = "AWAITING_APPROVAL"
            db.commit()
            return {"ok": True, "status": "AWAITING_APPROVAL"}
        # Schedule publish slot (due immediately; tick dispatches).
        sched = M.Schedule(
            id=f"sch_{uuid.uuid4().hex[:12]}", project_id=project.id,
            job_id=job.id, run_at=_now(), timezone=config.timezone,
            recurrence=None, platforms=list(config.platforms or []),
            status="SCHEDULED", idempotency_key=f"ap-{run.id}-{i}")
        db.add(sched)
        db.flush()
        run.schedule_ids = [*run.schedule_ids, sched.id]
        db.commit()
    db.refresh(run)
    if run.status == "RUNNING":
        if run.completed == 0 and run.failed > 0:
            run.status = "FAILED"
        else:
            run.status = "COMPLETED"
        db.commit()
    return {"ok": True, "status": run.status}


def approve_run(db, run, request_id: str) -> dict:
    """User approves publishing: schedule all completed jobs. Idempotent-ish."""
    from ..db import models as M
    if run.status != "AWAITING_APPROVAL":
        raise ValueError(f"run is {run.status}, not awaiting approval")
    config = db.get(M.AutopilotConfig, run.config_id)
    for jid in run.job_ids:
        key = f"ap-{run.id}-approve-{jid}"
        if db.scalar(select(M.Schedule).where(M.Schedule.idempotency_key == key)):
            continue
        db.add(M.Schedule(id=f"sch_{uuid.uuid4().hex[:12]}",
                          project_id=run.project_id, job_id=jid, run_at=_now(),
                          timezone=config.timezone if config else "Asia/Ho_Chi_Minh",
                          platforms=list(config.platforms) if config else [],
                          status="SCHEDULED", idempotency_key=key))
    run.schedule_ids = [s.id for s in db.scalars(
        select(M.Schedule).where(M.Schedule.project_id == run.project_id)).all()
        if s.idempotency_key.startswith(f"ap-{run.id}")]
    run.status = "COMPLETED"
    db.commit()
    return {"ok": True, "status": "COMPLETED"}


def tick_schedules(db, now: datetime | None = None) -> list[dict]:
    """Fire due SCHEDULED slots: verify job SUCCEEDED + gate PASS -> DISPATCHED.

    Recurrence 'daily' spawns exactly one next occurrence. Failures -> MISSED.
    """
    from ..db import models as M
    now = now or _now()
    due = db.scalars(select(M.Schedule).where(
        M.Schedule.status == "SCHEDULED", M.Schedule.run_at <= now)).all()
    out = []
    for s in due:
        s.status = "CLAIMED"
        db.flush()
        job = db.get(M.Job, s.job_id) if s.job_id else None
        if job is None or job.status != "SUCCEEDED":
            s.status = "MISSED"
            s.note = "job not succeeded"
            out.append({"id": s.id, "status": "MISSED"})
            continue
        from ..api.v1.media import QCIn, run_project_qc
        gate = run_project_qc(s.project_id, QCIn(disclosure=True),
                              _fake_request(f"tick-{s.id}"), db)["data"]["gate"]
        if gate["decision"] != "PASS":
            s.status = "MISSED"
            s.note = f"gate: {'; '.join(gate['reasons'])[:200]}"
            out.append({"id": s.id, "status": "MISSED"})
            continue
        s.status = "DISPATCHED"  # handoff marker for Publisher (Phase 7)
        s.note = ""
        out.append({"id": s.id, "status": "DISPATCHED"})
        if s.recurrence == "daily":
            nxt = M.Schedule(id=f"sch_{uuid.uuid4().hex[:12]}",
                             project_id=s.project_id, job_id=s.job_id,
                             run_at=s.run_at + timedelta(days=1),
                             timezone=s.timezone, recurrence="daily",
                             platforms=list(s.platforms), status="SCHEDULED",
                             idempotency_key=f"{s.idempotency_key}:next")
            # Idempotent: skip if already spawned.
            if not db.scalar(select(M.Schedule).where(
                    M.Schedule.idempotency_key == nxt.idempotency_key)):
                db.add(nxt)
    db.commit()
    return out
