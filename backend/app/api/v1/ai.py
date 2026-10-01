"""AI infrastructure API: providers / models / credentials / router / activity / usage."""
from __future__ import annotations

import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...ai.adapters import get_adapter, validate_provider_url
from ...ai.circuit import breaker
from ...ai.policies import cost_allowed, license_allowed
from ...ai.router import STRATEGIES, RouteInput, Router
from ...core.config import settings
from ...core.errors import error_body
from ...core.exceptions import AppError
from ...credentials.store import FernetCredentialStore, fingerprint
from ...db import models as M
from ...db.session import get_db

router = APIRouter(prefix="/ai")

ADAPTER_KEYS = ("openai_compatible", "openrouter", "openai", "together", "groq", "custom", "test")
CAPABILITIES = ("TEXT", "STORY", "VISION", "IMAGE", "VIDEO", "TTS", "MUSIC", "SFX", "EMBEDDING")
COST_CLASSES = ("LOCAL", "FREE", "FREE_WITH_LIMIT", "TRIAL", "PAID", "UNKNOWN")
LICENSES = ("VERIFIED_COMMERCIAL", "VERIFIED_NONCOMMERCIAL", "UNKNOWN", "UNVERIFIED")

_store: FernetCredentialStore | None = None


def store() -> FernetCredentialStore:
    global _store
    if _store is None:
        _store = FernetCredentialStore(
            master_key_b64=settings.credential_master_key,
            key_file=settings.credential_key_file,
            data_file="./.credentials.enc",
        )
    return _store


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "req_unknown")


# ------------------------------------------------------------------ providers

class ProviderIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    base_url: str = ""
    adapter_key: str = "custom"
    enabled: bool = True


class ProviderPatch(BaseModel):
    name: str | None = None
    base_url: str | None = None
    adapter_key: str | None = None
    enabled: bool | None = None


def _provider_out(p: M.AIProvider, cred_configured: bool) -> dict:
    return {"id": p.id, "name": p.name, "base_url": p.base_url,
            "adapter_key": p.adapter_key, "enabled": p.enabled,
            "health": p.health, "last_probe_at": p.last_probe_at,
            "credential_configured": cred_configured}


@router.get("/providers")
def list_providers(request: Request, db: Session = Depends(get_db)) -> dict:
    providers = db.scalars(select(M.AIProvider)).all()
    refs = {c.provider_id for c in db.scalars(select(M.Credential)).all()}
    return {"request_id": _rid(request),
            "data": [_provider_out(p, p.id in refs) for p in providers]}


@router.post("/providers", status_code=201)
def create_provider(body: ProviderIn, request: Request, db: Session = Depends(get_db)) -> dict:
    if body.adapter_key not in ADAPTER_KEYS:
        raise AppError("BAD_REQUEST", f"unknown adapter_key: {body.adapter_key}", 400)
    base_url = ""
    if body.base_url and body.adapter_key != "test":
        try:
            base_url = validate_provider_url(body.base_url)
        except ValueError as exc:
            raise AppError("BAD_REQUEST", f"invalid provider URL: {exc}", 400)
    p = M.AIProvider(id=f"prov_{uuid.uuid4().hex[:12]}", name=body.name,
                     base_url=base_url, adapter_key=body.adapter_key,
                     enabled=body.enabled, health="UNKNOWN")
    db.add(p)
    db.commit()
    return {"request_id": _rid(request), "data": _provider_out(p, False)}


@router.get("/providers/{provider_id}")
def get_provider(provider_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    p = db.get(M.AIProvider, provider_id)
    if p is None:
        raise AppError("NOT_FOUND", "Provider not found.", 404)
    configured = db.scalar(select(func.count()).where(M.Credential.provider_id == provider_id)) or 0
    return {"request_id": _rid(request), "data": _provider_out(p, configured > 0)}


@router.patch("/providers/{provider_id}")
def patch_provider(provider_id: str, body: ProviderPatch, request: Request,
                   db: Session = Depends(get_db)) -> dict:
    p = db.get(M.AIProvider, provider_id)
    if p is None:
        raise AppError("NOT_FOUND", "Provider not found.", 404)
    if body.adapter_key is not None:
        if body.adapter_key not in ADAPTER_KEYS:
            raise AppError("BAD_REQUEST", "unknown adapter_key", 400)
        p.adapter_key = body.adapter_key
    if body.name is not None:
        p.name = body.name
    if body.base_url is not None:
        if body.base_url and p.adapter_key != "test":
            try:
                p.base_url = validate_provider_url(body.base_url)
            except ValueError as exc:
                raise AppError("BAD_REQUEST", f"invalid provider URL: {exc}", 400)
        else:
            p.base_url = body.base_url
    if body.enabled is not None:
        p.enabled = body.enabled
    db.commit()
    return {"request_id": _rid(request), "data": _provider_out(p, True)}


@router.delete("/providers/{provider_id}")
def delete_provider(provider_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    p = db.get(M.AIProvider, provider_id)
    if p is None:
        raise AppError("NOT_FOUND", "Provider not found.", 404)
    n_models = db.scalar(select(func.count()).where(M.AIModel.provider_id == provider_id)) or 0
    if n_models:
        raise AppError("CONFLICT", "Provider has models; delete them first.", 409)
    for c in db.scalars(select(M.Credential).where(M.Credential.provider_id == provider_id)).all():
        try:
            store().delete(c.ref)
        except Exception:  # noqa: BLE001
            pass
        db.delete(c)
    db.delete(p)
    db.commit()
    return {"request_id": _rid(request), "data": {"deleted": provider_id}}


# --------------------------------------------------------------------- models

class ModelIn(BaseModel):
    provider_id: str
    name: str = Field(min_length=1, max_length=255)
    model_id: str = Field(min_length=1, max_length=255)
    capabilities: list[str] = Field(default_factory=list)
    priority: int = 100
    enabled: bool = True
    cost_class: str = "UNKNOWN"
    license_status: str = "UNVERIFIED"
    context_window: int = 0
    metadata: dict = Field(default_factory=dict)


class ModelPatch(BaseModel):
    name: str | None = None
    model_id: str | None = None
    capabilities: list[str] | None = None
    priority: int | None = None
    enabled: bool | None = None
    cost_class: str | None = None
    license_status: str | None = None
    context_window: int | None = None
    metadata: dict | None = None
    # Operator quarantine override (system otherwise owns health via probes/router).
    health_status: str | None = None


def _model_out(m: M.AIModel) -> dict:
    return {"id": m.id, "provider_id": m.provider_id, "credential_ref": m.credential_ref,
            "name": m.name, "model_id": m.model_id, "capabilities": m.capabilities,
            "priority": m.priority, "enabled": m.enabled, "cost_class": m.cost_class,
            "license_status": m.license_status, "context_window": m.context_window,
            "metadata": m.extra_metadata, "health_status": m.health_status,
            "last_test_at": m.last_test_at, "created_at": m.created_at, "updated_at": m.updated_at}


def _validate_model_fields(capabilities: list[str], cost: str, lic: str) -> None:
    for c in capabilities:
        if c not in CAPABILITIES:
            raise AppError("BAD_REQUEST", f"unknown capability: {c}", 400)
    if cost not in COST_CLASSES:
        raise AppError("BAD_REQUEST", f"unknown cost_class: {cost}", 400)
    if lic not in LICENSES:
        raise AppError("BAD_REQUEST", f"unknown license_status: {lic}", 400)


@router.get("/models")
def list_models(request: Request, capability: str | None = None,
                db: Session = Depends(get_db)) -> dict:
    models = db.scalars(select(M.AIModel).order_by(M.AIModel.priority.desc())).all()
    out = [_model_out(m) for m in models]
    if capability:
        out = [m for m in out if capability in m["capabilities"]]
    return {"request_id": _rid(request), "data": out}


@router.post("/models", status_code=201)
def create_model(body: ModelIn, request: Request, db: Session = Depends(get_db)) -> dict:
    provider = db.get(M.AIProvider, body.provider_id)
    if provider is None:
        raise AppError("NOT_FOUND", "Provider not found.", 404)
    _validate_model_fields(body.capabilities, body.cost_class, body.license_status)
    cred = db.scalar(select(M.Credential).where(M.Credential.provider_id == body.provider_id))
    m = M.AIModel(id=f"mdl_{uuid.uuid4().hex[:12]}", provider_id=body.provider_id,
                  credential_ref=cred.ref if cred else "", name=body.name, model_id=body.model_id,
                  capabilities=body.capabilities, priority=body.priority, enabled=body.enabled,
                  cost_class=body.cost_class, license_status=body.license_status,
                  context_window=body.context_window, extra_metadata=body.metadata,
                  health_status="UNKNOWN")
    db.add(m)
    db.commit()
    return {"request_id": _rid(request), "data": _model_out(m)}


@router.get("/models/{model_id}")
def get_model(model_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    m = db.get(M.AIModel, model_id)
    if m is None:
        raise AppError("NOT_FOUND", "Model not found.", 404)
    return {"request_id": _rid(request), "data": _model_out(m)}


@router.patch("/models/{model_id}")
def patch_model(model_id: str, body: ModelPatch, request: Request,
                db: Session = Depends(get_db)) -> dict:
    m = db.get(M.AIModel, model_id)
    if m is None:
        raise AppError("NOT_FOUND", "Model not found.", 404)
    data = body.model_dump(exclude_unset=True)
    if "health_status" in data and data["health_status"] not in (
        "ACTIVE", "COOLDOWN", "DISABLED", "AUTH_FAILED",
        "QUOTA_EXHAUSTED", "UNAVAILABLE", "UNKNOWN",
    ):
        raise AppError("BAD_REQUEST", "unknown health_status", 400)
    if "capabilities" in data or "cost_class" in data or "license_status" in data:
        _validate_model_fields(data.get("capabilities", m.capabilities),
                               data.get("cost_class", m.cost_class),
                               data.get("license_status", m.license_status))
    for k, v in data.items():
        if k == "metadata":
            m.extra_metadata = v
        else:
            setattr(m, k, v)
    db.commit()
    return {"request_id": _rid(request), "data": _model_out(m)}


@router.delete("/models/{model_id}")
def delete_model(model_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    m = db.get(M.AIModel, model_id)
    if m is None:
        raise AppError("NOT_FOUND", "Model not found.", 404)
    db.delete(m)
    db.commit()
    return {"request_id": _rid(request), "data": {"deleted": model_id}}


class TestIn(BaseModel):
    capability: str = "TEXT"


@router.post("/models/{model_id}/test")
def test_model(model_id: str, body: TestIn, request: Request,
               db: Session = Depends(get_db)) -> dict:
    rid = _rid(request)
    m = db.get(M.AIModel, model_id)
    if m is None:
        raise AppError("NOT_FOUND", "Model not found.", 404)
    if body.capability not in CAPABILITIES:
        raise AppError("BAD_REQUEST", "unknown capability", 400)
    provider = db.get(M.AIProvider, m.provider_id)
    cred = db.scalar(select(M.Credential).where(M.Credential.ref == m.credential_ref))
    if cred is None or not store().exists(m.credential_ref):
        return {"request_id": rid, "data": {"state": "FAILED", "error": "CREDENTIAL_MISSING",
                                            "checks": {"reachable": False, "authenticated": False}}}
    secret = store().get(m.credential_ref)
    try:
        adapter = get_adapter(_Obj(provider), provider.base_url if provider else "")
    except ValueError:
        raise AppError("BAD_REQUEST", "no adapter for provider", 400)
    result = adapter.test_capability(body.capability, m.model_id, secret)
    from datetime import datetime, timezone
    m.last_test_at = datetime.now(timezone.utc)
    if result.get("state") == "CAPABILITY_VERIFIED":
        m.health_status = "ACTIVE"
    db.commit()
    return {"request_id": rid, "data": result}


class _Obj:
    def __init__(self, p: Any):
        self.adapter_key = getattr(p, "adapter_key", "custom") if p else "custom"


# ---------------------------------------------------------------- credentials

class CredentialIn(BaseModel):
    provider_id: str
    secret: str = Field(min_length=1, max_length=4096)


@router.post("/credentials", status_code=201)
def save_credential(body: CredentialIn, request: Request, db: Session = Depends(get_db)) -> dict:
    rid = _rid(request)
    provider = db.get(M.AIProvider, body.provider_id)
    if provider is None:
        raise AppError("NOT_FOUND", "Provider not found.", 404)
    existing = db.scalar(select(M.Credential).where(M.Credential.provider_id == body.provider_id))
    ref = existing.ref if existing else f"cred_{uuid.uuid4().hex[:12]}"
    store().save(ref, body.secret)
    if existing is None:
        db.add(M.Credential(id=f"crd_{uuid.uuid4().hex[:12]}", provider_id=body.provider_id,
                            ref=ref, secret_encrypted="via-credential-store",
                            fingerprint=fingerprint(body.secret)))
    else:
        existing.fingerprint = fingerprint(body.secret)
    # Bind models of this provider missing a ref.
    for m in db.scalars(select(M.AIModel).where(M.AIModel.provider_id == body.provider_id)).all():
        if not m.credential_ref:
            m.credential_ref = ref
    db.commit()
    return {"request_id": rid, "data": {"configured": True, "ref": ref}}


@router.get("/credentials")
def list_credentials(request: Request, provider_id: str | None = None,
                     db: Session = Depends(get_db)) -> dict:
    q = select(M.Credential)
    if provider_id:
        q = q.where(M.Credential.provider_id == provider_id)
    out = [{"configured": True, "ref": c.ref, "provider_id": c.provider_id,
            "last_verified_at": c.last_verified_at} for c in db.scalars(q).all()]
    return {"request_id": _rid(request), "data": out}


@router.get("/credentials/{ref}")
def credential_meta(ref: str, request: Request, db: Session = Depends(get_db)) -> dict:
    c = db.scalar(select(M.Credential).where(M.Credential.ref == ref))
    if c is None or not store().exists(ref):
        raise AppError("NOT_FOUND", "Credential not found.", 404)
    return {"request_id": _rid(request),
            "data": {"configured": True, "ref": ref, "provider_id": c.provider_id}}


@router.delete("/credentials/{ref}")
def delete_credential(ref: str, request: Request, db: Session = Depends(get_db)) -> dict:
    c = db.scalar(select(M.Credential).where(M.Credential.ref == ref))
    if c is None:
        raise AppError("NOT_FOUND", "Credential not found.", 404)
    store().delete(ref)
    for m in db.scalars(select(M.AIModel).where(M.AIModel.credential_ref == ref)).all():
        m.credential_ref = ""
        m.enabled = False
    db.delete(c)
    db.commit()
    return {"request_id": _rid(request), "data": {"deleted": ref}}


# --------------------------------------------------------------------- router

class RouterGenerateIn(BaseModel):
    task: str = "SCRIPT_GENERATION"
    capability: str = "TEXT"
    prompt: str = ""
    strategy: str = "AUTO"
    allow_paid: bool = False
    require_commercial: bool = False
    manual_model_id: str | None = None
    job_id: str | None = None
    max_attempts: int = 3


@router.get("/router/strategies")
def router_strategies(request: Request) -> dict:
    return {"request_id": _rid(request), "data": list(STRATEGIES),
            "circuit": breaker.snapshot()}


@router.get("/router/eligible")
def router_eligible(request: Request, capability: str = "TEXT",
                    allow_paid: bool = False, require_commercial: bool = False,
                    db: Session = Depends(get_db)) -> dict:
    r = Router()
    models = [_model_out(m) for m in db.scalars(select(M.AIModel)).all()]
    refs = {c.ref for c in db.scalars(select(M.Credential)).all()
            if store().exists(c.ref)}
    eligible, excluded = r.eligible(models, refs, RouteInput(
        task="INSPECT", capability=capability, allow_paid=allow_paid,
        require_commercial=require_commercial))
    ordered, resolved = r.order(eligible, "AUTO")
    return {"request_id": _rid(request),
            "data": {"strategy_resolved": resolved, "eligible": ordered, "excluded": excluded,
                     "circuit": breaker.snapshot()}}


@router.post("/router/generate")
def router_generate(body: RouterGenerateIn, request: Request,
                    db: Session = Depends(get_db)) -> dict:
    rid = _rid(request)
    if body.strategy not in STRATEGIES:
        raise AppError("BAD_REQUEST", f"unknown strategy: {body.strategy}", 400)
    if body.capability not in CAPABILITIES:
        raise AppError("BAD_REQUEST", "unknown capability", 400)
    r = Router()
    db_models = db.scalars(select(M.AIModel)).all()
    models = [_model_out(m) for m in db_models]
    providers = {p.id: {"id": p.id, "name": p.name, "base_url": p.base_url,
                        "adapter_key": p.adapter_key, "enabled": p.enabled}
                 for p in db.scalars(select(M.AIProvider)).all()}
    refs = {c.ref for c in db.scalars(select(M.Credential)).all() if store().exists(c.ref)}
    secrets = {ref: store().get(ref) for ref in refs}
    result = r.route(models, providers, secrets, refs, RouteInput(
        task=body.task, capability=body.capability, prompt=body.prompt,
        strategy=body.strategy, allow_paid=body.allow_paid,
        require_commercial=body.require_commercial, manual_model_id=body.manual_model_id,
        job_id=body.job_id, max_attempts=max(1, min(body.max_attempts, 5))), rid)
    # Record activity (append-only usage_events). No secrets.
    import datetime as _dt
    for a in result.attempts:
        is_mock = (providers.get(next((m["provider_id"] for m in models if m["name"] == a.model), ""),
                                 {}).get("adapter_key") == "test")
        db.add(M.UsageEvent(id=f"uev_{uuid.uuid4().hex[:12]}", request_id=rid,
                            job_id=body.job_id, task=body.task, capability=body.capability,
                            provider=a.provider, model=a.model, attempt=a.attempt,
                            latency_ms=a.latency_ms, status=a.status,
                            error_category=a.error_code if a.status != "SUCCESS" else None,
                            fallback_reason=a.fallback_reason or None,
                            cost=None, cost_state="UNKNOWN", mock=is_mock))
    db.commit()
    if not result.ok and not result.attempts:
        status = {"PAID_MODEL_BLOCKED": 402, "LICENSE_BLOCKED": 403,
                  "CREDENTIAL_MISSING": 409, "MODEL_UNAVAILABLE": 404}.get(result.error_code, 400)
        raise AppError(result.error_code, result.error_message, status)
    if not result.ok:
        status = {"AUTH_FAILED": 401, "BAD_REQUEST": 400, "CONTENT_POLICY_BLOCK": 422}.get(
            result.error_code, 502)
        return {"request_id": rid, "data": None,
                "error": {"code": result.error_code, "message": result.error_message,
                          "request_id": rid},
                "trace": [a.__dict__ for a in result.attempts]}
    return {"request_id": rid,
            "data": {"output": result.output, "strategy_resolved": result.strategy_resolved},
            "trace": [a.__dict__ for a in result.attempts]}


# --------------------------------------------------------------- activity/usage

@router.get("/activity")
def activity(request: Request, limit: int = Query(50, le=200),
             db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(select(M.UsageEvent).order_by(M.UsageEvent.created_at.desc()).limit(limit)).all()
    return {"request_id": _rid(request), "data": [{
        "request_id": e.request_id, "job_id": e.job_id, "task": e.task,
        "capability": e.capability, "provider": e.provider, "model": e.model,
        "attempt": e.attempt, "latency_ms": e.latency_ms, "status": e.status,
        "error_category": e.error_category, "fallback_reason": e.fallback_reason,
        "mock": e.mock, "created_at": e.created_at} for e in rows]}


@router.get("/usage")
def usage(request: Request, db: Session = Depends(get_db)) -> dict:
    total = db.scalar(select(func.count()).select_from(M.UsageEvent)) or 0
    success = db.scalar(select(func.count()).where(M.UsageEvent.status == "SUCCESS")) or 0
    fallbacks = db.scalar(select(func.count()).where(M.UsageEvent.fallback_reason != None)) or 0  # noqa: E711
    avg_lat = db.scalar(select(func.avg(M.UsageEvent.latency_ms))) or 0
    by_model = db.execute(select(M.UsageEvent.model,
                                 func.count().label("n")).group_by(M.UsageEvent.model)).all()
    return {"request_id": _rid(request), "data": {
        "requests": total, "successful": success, "failed": total - success,
        "fallbacks": fallbacks, "avg_latency_ms": round(float(avg_lat or 0), 1),
        "by_model": [{"model": m, "count": n} for m, n in by_model],
        "cost": None, "cost_state": "UNKNOWN"}}
