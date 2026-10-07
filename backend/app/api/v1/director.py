"""Director API: generate / versions / approve / reject / regenerate / section / edit.

All generation goes through AI Router (capability STORY, task STORY_GENERATION).
No downstream media jobs are created here (Phase 4+ concern; gate-tested).
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...ai.director import (SECTIONS, build_prompt, build_section_prompt,
                            extract_json, validate_plan)
from ...ai.router import RouteInput, Router
from ...core.exceptions import AppError
from ...db import models as M
from ...db.session import get_db
from .story import _get_story_project

router = APIRouter()


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "req_unknown")


def _plan_out(p: M.DirectorPlan) -> dict:
    return {"id": p.id, "project_id": p.project_id, "version": p.version,
            "status": p.status, "origin": p.origin, "parent_version": p.parent_version,
            "input_snapshot": p.input_snapshot, "plan": p.plan,
            "provider": p.provider, "model": p.model,
            "request_id": p.request_id, "mock": p.mock, "created_at": p.created_at}


def _latest(db: Session, project_id: str) -> M.DirectorPlan | None:
    return db.scalar(select(M.DirectorPlan).where(
        M.DirectorPlan.project_id == project_id).order_by(M.DirectorPlan.version.desc()))


def _get_plan(db: Session, plan_id: str) -> M.DirectorPlan:
    p = db.get(M.DirectorPlan, plan_id)
    if p is None:
        raise AppError("NOT_FOUND", "Director plan not found.", 404)
    _get_story_project(db, p.project_id)
    return p


def _route_for_director(db: Session, prompt: str, strategy: str,
                        manual_model_id: str | None, allow_paid: bool,
                        require_commercial: bool, request_id: str) -> tuple[str, str, str, bool]:
    """Returns (output, provider, model, mock). Raises AppError on failure."""
    from .ai import store as get_store
    r = Router()
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
    secrets = {ref: st.get(ref) for ref in refs}
    result = r.route(models, providers, secrets, refs, RouteInput(
        task="STORY_GENERATION", capability="STORY", prompt=prompt,
        strategy=strategy, allow_paid=allow_paid,
        require_commercial=require_commercial, manual_model_id=manual_model_id,
        max_attempts=3), request_id)
    # Record every user-triggered operation: per-attempt traces when a provider
    # was contacted, or one pre-network BLOCKED row when gates refused it.
    from ...ai.usage import record_routing
    mock_any = record_routing(db, request_id=request_id, task="STORY_GENERATION",
                              capability="STORY", result=result,
                              providers=providers, models=models)
    if not result.ok and not result.attempts:
        # Commit the BLOCKED activity row before the request rolls back, otherwise
        # a refused generation leaves no trace at all (PASS 8 fix).
        db.commit()
        raise AppError(result.error_code, result.error_message,
                       {"PAID_MODEL_BLOCKED": 402, "LICENSE_BLOCKED": 403,
                        "CREDENTIAL_MISSING": 409, "MODEL_UNAVAILABLE": 404}.get(
                           result.error_code, 400))
    if not result.ok:
        db.commit()
        raise AppError(result.error_code or "UNKNOWN_ERROR",
                       result.error_message or "Director generation failed.", 502)
    last = result.attempts[-1]
    return result.output, last.provider, last.model, mock_any


def _character_context(db: Session, project_id: str,
                       character_ids: list[str]) -> list[dict[str, Any]]:
    out = []
    for cid in character_ids:
        c = db.get(M.Character, cid)
        if c is None or c.project_id != project_id:
            raise AppError("BAD_REQUEST", f"character not in project: {cid}", 400)
        out.append({"id": c.id, "name": c.name, "kind": c.kind,
                    "description": c.description, "visual_identity": c.visual_identity})
    return out


class DirectorGenerateIn(BaseModel):
    idea: str = Field(min_length=1, max_length=4000)
    audience: str = ""
    tone: str = ""
    duration: float = 30.0
    language: str = "vi"
    style: str = ""
    character_ids: list[str] = Field(default_factory=list)
    strategy: str = "AUTO"
    manual_model_id: str | None = None
    allow_paid: bool = False
    require_commercial: bool = False


@router.post("/projects/{project_id}/director", status_code=201)
def generate_plan(project_id: str, body: DirectorGenerateIn, request: Request,
                  db: Session = Depends(get_db)) -> dict:
    rid = _rid(request)
    project = _get_story_project(db, project_id)
    if body.strategy not in ("AUTO", "PRIORITY", "WEIGHTED", "FASTEST", "CHEAPEST"):
        raise AppError("BAD_REQUEST", "unknown strategy", 400)
    chars = _character_context(db, project_id, body.character_ids)
    prompt = build_prompt(body.idea, body.audience, body.tone, body.duration,
                          body.language, body.style, chars)
    output, provider, model, mock_any = _route_for_director(
        db, prompt, body.strategy, body.manual_model_id,
        body.allow_paid, body.require_commercial, rid)
    try:
        plan = validate_plan(extract_json(output))
    except ValueError as exc:
        # Malformed: NO version saved, typed error, usage already recorded.
        raise AppError("INVALID_RESPONSE",
                       f"AI returned malformed Director Plan ({exc}). Nothing saved. "
                       "Retry, change model, or view AI Activity.", 502)
    version = (db.scalar(select(func.max(M.DirectorPlan.version)).where(
        M.DirectorPlan.project_id == project_id)) or 0) + 1
    row = M.DirectorPlan(
        id=f"dpl_{uuid.uuid4().hex[:12]}", project_id=project_id, version=version,
        status="REVIEW", origin="GENERATED",
        input_snapshot={"idea": body.idea, "audience": body.audience, "tone": body.tone,
                        "duration": body.duration, "language": body.language,
                        "style": body.style, "character_ids": body.character_ids,
                        "strategy": body.strategy, "manual_model_id": body.manual_model_id},
        plan=plan.model_dump(), provider=provider, model=model,
        request_id=rid, mock=mock_any)
    db.add(row)
    if project.status == "DRAFT":
        project.status = "REVIEW"
    db.commit()
    return {"request_id": rid, "data": _plan_out(row)}


@router.get("/projects/{project_id}/director")
def list_plans(project_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    _get_story_project(db, project_id)
    rows = db.scalars(select(M.DirectorPlan).where(
        M.DirectorPlan.project_id == project_id).order_by(M.DirectorPlan.version)).all()
    return {"request_id": _rid(request), "data": [_plan_out(r) for r in rows]}


@router.get("/projects/{project_id}/director/latest")
def latest_plan(project_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    _get_story_project(db, project_id)
    row = _latest(db, project_id)
    if row is None:
        raise AppError("NOT_FOUND", "No Director Plan yet.", 404)
    return {"request_id": _rid(request), "data": _plan_out(row)}


@router.get("/director/{plan_id}")
def get_plan(plan_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    return {"request_id": _rid(request), "data": _plan_out(_get_plan(db, plan_id))}


def _new_version(db: Session, current: M.DirectorPlan, plan: dict,
                 origin: str, provider: str, model: str,
                 request_id: str, mock: bool,
                 input_snapshot: dict | None = None) -> M.DirectorPlan:
    version = (db.scalar(select(func.max(M.DirectorPlan.version)).where(
        M.DirectorPlan.project_id == current.project_id)) or 0) + 1
    row = M.DirectorPlan(
        id=f"dpl_{uuid.uuid4().hex[:12]}", project_id=current.project_id,
        version=version, status="REVIEW", origin=origin, parent_version=current.version,
        input_snapshot=input_snapshot or current.input_snapshot,
        plan=plan, provider=provider, model=model, request_id=request_id, mock=mock)
    db.add(row)
    db.commit()
    return row


@router.post("/director/{plan_id}/approve")
def approve_plan(plan_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    p = _get_plan(db, plan_id)
    if p.status != "REVIEW":
        raise AppError("BAD_REQUEST",
                       f"Only REVIEW plans can be approved (current: {p.status}).", 400)
    # Must be the latest version — no approving stale history.
    latest = _latest(db, p.project_id)
    if latest is None or latest.id != p.id:
        raise AppError("BAD_REQUEST", "Only the latest version can be approved.", 400)
    p.status = "APPROVED"
    db.commit()
    return {"request_id": _rid(request), "data": _plan_out(p)}


@router.post("/director/{plan_id}/reject")
def reject_plan(plan_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    p = _get_plan(db, plan_id)
    if p.status != "REVIEW":
        raise AppError("BAD_REQUEST", "Only REVIEW plans can be rejected.", 400)
    p.status = "REJECTED"
    db.commit()
    return {"request_id": _rid(request), "data": _plan_out(p)}


class RegenerateIn(BaseModel):
    strategy: str = "AUTO"
    manual_model_id: str | None = None
    allow_paid: bool = False
    require_commercial: bool = False


@router.post("/director/{plan_id}/regenerate", status_code=201)
def regenerate_plan(plan_id: str, body: RegenerateIn, request: Request,
                    db: Session = Depends(get_db)) -> dict:
    rid = _rid(request)
    current = _get_plan(db, plan_id)
    snap = current.input_snapshot
    chars = _character_context(db, current.project_id, snap.get("character_ids", []))
    prompt = build_prompt(snap.get("idea", ""), snap.get("audience", ""), snap.get("tone", ""),
                          snap.get("duration", 30.0), snap.get("language", "vi"),
                          snap.get("style", ""), chars)
    output, provider, model, mock_any = _route_for_director(
        db, prompt, body.strategy, body.manual_model_id,
        body.allow_paid, body.require_commercial, rid)
    try:
        plan = validate_plan(extract_json(output))
    except ValueError as exc:
        raise AppError("INVALID_RESPONSE",
                       f"Regeneration returned malformed plan ({exc}). Current version kept.", 502)
    row = _new_version(db, current, plan.model_dump(), "REGENERATED",
                       provider, model, rid, mock_any, snap)
    return {"request_id": rid, "data": _plan_out(row)}


class RegenSectionIn(BaseModel):
    section: str
    strategy: str = "AUTO"
    manual_model_id: str | None = None
    allow_paid: bool = False
    require_commercial: bool = False


@router.post("/director/{plan_id}/regenerate-section", status_code=201)
def regenerate_section(plan_id: str, body: RegenSectionIn, request: Request,
                       db: Session = Depends(get_db)) -> dict:
    rid = _rid(request)
    if body.section not in SECTIONS:
        raise AppError("BAD_REQUEST", f"unknown section: {body.section}", 400)
    current = _get_plan(db, plan_id)
    snap = current.input_snapshot
    prompt = build_section_prompt(body.section, current.plan, snap.get("idea", ""),
                                  snap.get("language", "vi"))
    output, provider, model, mock_any = _route_for_director(
        db, prompt, body.strategy, body.manual_model_id,
        body.allow_paid, body.require_commercial, rid)
    try:
        data = extract_json(output)
        if not isinstance(data, dict) or data.get("section") != body.section or "value" not in data:
            raise ValueError("section response mismatch")
        merged = dict(current.plan)
        if body.section == "scenes":
            from ...ai.director import PlanScene
            merged["scenes"] = [PlanScene.model_validate(s).model_dump()
                                for s in data["value"]]
        else:
            merged[body.section] = data["value"]
        plan = validate_plan(merged)
    except (ValueError, KeyError) as exc:
        raise AppError("INVALID_RESPONSE",
                       f"Section regeneration failed ({exc}). Current version kept.", 502)
    row = _new_version(db, current, plan.model_dump(), "SECTION_REGENERATED",
                       provider, model, rid, mock_any, snap)
    return {"request_id": rid, "data": _plan_out(row)}


class EditIn(BaseModel):
    plan: dict


@router.patch("/director/{plan_id}", status_code=201)
def edit_plan(plan_id: str, body: EditIn, request: Request,
              db: Session = Depends(get_db)) -> dict:
    """User edit = shallow merge over current version, then schema-validate.

    A new version is created; history is never overwritten.
    """
    rid = _rid(request)
    current = _get_plan(db, plan_id)
    merged = dict(current.plan)
    merged.update(body.plan)
    try:
        plan = validate_plan(merged)
    except ValueError as exc:
        raise AppError("VALIDATION_FAILED", f"edited plan invalid: {exc}", 400)
    row = _new_version(db, current, plan.model_dump(), "USER_EDITED",
                       current.provider, current.model, rid, current.mock)
    return {"request_id": rid, "data": _plan_out(row)}
