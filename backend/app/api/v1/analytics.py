"""Analytics: real aggregations over stored rows. No invented metrics.

Counts are exact (0 is mathematically correct when empty). Cost is UNKNOWN:
the system has no reliable pricing data and never invents prices.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...core.exceptions import AppError
from ...db import models as M
from ...db.session import get_db

router = APIRouter()


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "req_unknown")


def _parse_range(from_s: str | None, to_s: str | None) -> tuple[datetime | None, datetime | None]:
    try:
        f = datetime.fromisoformat(from_s.replace("Z", "+00:00")) if from_s else None
        t = datetime.fromisoformat(to_s.replace("Z", "+00:00")) if to_s else None
    except ValueError:
        raise AppError("BAD_REQUEST", "from/to must be ISO8601", 400)
    return f, t


def _in_range(q, column, f, t):
    if f is not None:
        q = q.where(column >= f)
    if t is not None:
        q = q.where(column <= t)
    return q


@router.get("/analytics/overview")
def overview(request: Request, from_: str | None = Query(default=None, alias="from"),
             to: str | None = None, db: Session = Depends(get_db)) -> dict:
    f, t = _parse_range(from_, to)

    def count(model, status_col=None, status=None, time_col=None):
        q = select(func.count()).select_from(model)
        if status_col is not None:
            q = q.where(status_col == status)
        if time_col is not None:
            q = _in_range(q, time_col, f, t)
        return db.scalar(q) or 0

    jobs_total = count(M.Job, None, None, M.Job.created_at)
    jobs_failed = count(M.Job, M.Job.status, "FAILED", M.Job.created_at)
    jobs_succeeded = count(M.Job, M.Job.status, "SUCCEEDED", M.Job.created_at)
    qc_total = count(M.QCResult, None, None, M.QCResult.created_at)
    qc_blocked = count(M.QCResult, M.QCResult.verdict, "BLOCKED", M.QCResult.created_at)
    qc_review = count(M.QCResult, M.QCResult.verdict, "REVIEW_REQUIRED", M.QCResult.created_at)
    exports = count(M.Export, None, None, M.Export.created_at)
    videos = count(M.Artifact, M.Artifact.kind, "VIDEO", M.Artifact.created_at)
    runs = count(M.AutopilotRun, None, None, M.AutopilotRun.created_at)
    sched_scheduled = count(M.Schedule, M.Schedule.status, "SCHEDULED", M.Schedule.created_at)
    sched_dispatched = count(M.Schedule, M.Schedule.status, "DISPATCHED", M.Schedule.created_at)
    sched_missed = count(M.Schedule, M.Schedule.status, "MISSED", M.Schedule.created_at)
    pub_confirmed = count(M.PublishAttempt, M.PublishAttempt.status,
                          "CONFIRMED_PUBLISHED", M.PublishAttempt.created_at)
    pub_failed = db.scalar(select(func.count()).where(
        M.PublishAttempt.status.in_(("RETRYABLE_ERROR", "FATAL_ERROR")))) or 0
    aff_products = count(M.AffiliateProduct, None, None, M.AffiliateProduct.created_at)
    aff_videos = count(M.AffiliateVideo, None, None, M.AffiliateVideo.created_at)
    aff_exported = count(M.AffiliateVideo, M.AffiliateVideo.status,
                         "EXPORTED", M.AffiliateVideo.created_at)

    # Avg generation time: SUCCEEDED jobs with both timestamps (seconds).
    avg_gen = db.scalar(select(func.avg(
        func.julianday(M.Job.updated_at) - func.julianday(M.Job.created_at)
    )).where(M.Job.status == "SUCCEEDED")) or 0
    avg_gen_s = round(float(avg_gen) * 86400, 1)

    # AI usage rollup (mirrors /ai/usage, range-aware).
    uq = select(M.UsageEvent)
    uq = _in_range(uq, M.UsageEvent.created_at, f, t)
    ai_rows = db.scalars(uq).all()
    ai_success = sum(1 for e in ai_rows if e.status == "SUCCESS")
    ai_fallbacks = sum(1 for e in ai_rows if e.fallback_reason)
    lat = [e.latency_ms for e in ai_rows if e.latency_ms]
    by_model: dict[str, int] = {}
    by_error: dict[str, dict] = {}
    blocked_pre_network = 0
    for e in ai_rows:
        # Empty-model rows are pre-network refusals, not a model named "" —
        # they belong in the blocked count, never in a "?" chart row.
        if e.status == "BLOCKED":
            blocked_pre_network += 1
        if e.model:
            by_model[e.model] = by_model.get(e.model, 0) + 1
        if e.error_category:
            d = by_error.setdefault(e.error_category, {"count": 0, "blocked": 0})
            d["count"] += 1
            if e.status == "BLOCKED":
                d["blocked"] += 1

    pub_by_platform = dict(db.execute(select(
        M.PublishAttempt.platform, func.count()).where(
            M.PublishAttempt.status == "CONFIRMED_PUBLISHED").group_by(
                M.PublishAttempt.platform)).all())
    jobs_by_status = dict(db.execute(select(
        M.Job.status, func.count()).group_by(M.Job.status)).all())

    return {"request_id": _rid(request), "data": {
        "production": {"videos": videos, "jobs_total": jobs_total,
                       "jobs_succeeded": jobs_succeeded, "jobs_failed": jobs_failed,
                       "avg_generation_seconds": avg_gen_s,
                       "qc_total": qc_total, "qc_blocked": qc_blocked,
                       "qc_review_required": qc_review,
                       "exports": exports, "jobs_by_status": jobs_by_status},
        "ai": {"requests": len(ai_rows), "successful": ai_success,
               "failed": len(ai_rows) - ai_success, "fallbacks": ai_fallbacks,
               "avg_latency_ms": round(sum(lat) / len(lat), 1) if lat else 0,
               "blocked_pre_network": blocked_pre_network,
               "by_model": [{"model": k, "count": v} for k, v in by_model.items()],
               "by_error": [{"code": k, "count": v["count"], "blocked": v["blocked"]}
                            for k, v in by_error.items()],
               "cost": None, "cost_state": "UNKNOWN"},
        "automation": {"runs": runs, "scheduled": sched_scheduled,
                       "dispatched": sched_dispatched, "missed": sched_missed},
        "publishing": {"confirmed": pub_confirmed, "failed": pub_failed,
                       "by_platform": [{"platform": k, "count": v}
                                       for k, v in pub_by_platform.items()]},
        "affiliate": {"products": aff_products, "videos": aff_videos,
                      "exported": aff_exported},
    }}
