"""Affiliate Factory: products / images / analysis / scripts / videos / export.

Isolated from Story by construction: no story FKs, no shared tables, own
storage jail, own Router calls (TEXT/IMAGE only). Default workflow has NO
autopilot/scheduler/publisher involvement.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...ai.router import RouteInput, Router
from ...core.config import settings
from ...core.exceptions import AppError
from ...db import models as M
from ...db.session import get_db
from ...storage.local import LocalStorage, PathJailError
from .story import _sniff_image  # shared upload validation (ext/mime/magic/size)

router = APIRouter()

SCRIPT_STYLES = ("REVIEW", "UGC", "PROBLEM_SOLUTION", "SHOWCASE",
                 "COMPARISON", "STORYTELLING", "TOP_PRODUCT")
VIDEO_STATUSES = ("DRAFT", "RENDERING", "READY", "EXPORTED", "FAILED")
DEFAULT_DISCLOSURE = ("Disclosure: This video contains affiliate links. "
                      "If you buy through them, I may earn a commission at no extra cost to you.")


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "req_unknown")


def _storage() -> LocalStorage:
    return LocalStorage(settings.projects_root)


def _get_product(db: Session, product_id: str) -> M.AffiliateProduct:
    p = db.get(M.AffiliateProduct, product_id)
    if p is None:
        raise AppError("NOT_FOUND", "Product not found.", 404)
    return p


def _validate_url(url: str) -> str:
    if not url:
        return ""
    parsed = urlparse(url)
    if parsed.scheme not in ("https", "http") or not parsed.hostname:
        raise AppError("BAD_REQUEST", "affiliate_url must be http(s) with host", 400)
    if len(url) > 2048:
        raise AppError("BAD_REQUEST", "affiliate_url too long", 400)
    return url


# ------------------------------------------------------------------ products

class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = ""
    price: str = ""
    affiliate_url: str = ""
    audience: str = ""
    tone: str = ""
    style: str = ""


class ProductPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    price: str | None = None
    affiliate_url: str | None = None
    audience: str | None = None
    tone: str | None = None
    style: str | None = None


def _product_out(p: M.AffiliateProduct, videos: int = 0) -> dict:
    return {"id": p.id, "name": p.name, "description": p.description,
            "price": p.price, "affiliate_url": p.affiliate_url,
            "image_path": p.image_path, "image_sha256": p.image_sha256,
            "audience": p.audience, "tone": p.tone, "style": p.style,
            "videos": videos, "created_at": p.created_at, "updated_at": p.updated_at}


@router.get("/affiliate/products")
def list_products(request: Request, db: Session = Depends(get_db)) -> dict:
    from sqlalchemy import func as _f
    rows = db.scalars(select(M.AffiliateProduct).order_by(
        M.AffiliateProduct.created_at.desc())).all()
    out = []
    for p in rows:
        n = db.scalar(select(_f.count()).where(
            M.AffiliateVideo.product_id == p.id)) or 0
        out.append(_product_out(p, n))
    return {"request_id": _rid(request), "data": out}


@router.post("/affiliate/products", status_code=201)
def create_product(body: ProductIn, request: Request,
                   db: Session = Depends(get_db)) -> dict:
    url = _validate_url(body.affiliate_url)
    p = M.AffiliateProduct(id=f"afp_{uuid.uuid4().hex[:12]}", name=body.name,
                           description=body.description, price=body.price,
                           affiliate_url=url, audience=body.audience,
                           tone=body.tone, style=body.style)
    db.add(p)
    db.commit()
    _storage().ensure_affiliate(p.id)
    return {"request_id": _rid(request), "data": _product_out(p)}


@router.get("/affiliate/products/{product_id}")
def get_product(product_id: str, request: Request,
                db: Session = Depends(get_db)) -> dict:
    return {"request_id": _rid(request), "data": _product_out(_get_product(db, product_id))}


@router.patch("/affiliate/products/{product_id}")
def patch_product(product_id: str, body: ProductPatch, request: Request,
                  db: Session = Depends(get_db)) -> dict:
    p = _get_product(db, product_id)
    data = body.model_dump(exclude_unset=True)
    if "affiliate_url" in data:
        data["affiliate_url"] = _validate_url(data["affiliate_url"])
    for k, v in data.items():
        setattr(p, k, v)
    db.commit()
    return {"request_id": _rid(request), "data": _product_out(p)}


@router.delete("/affiliate/products/{product_id}")
def delete_product(product_id: str, request: Request,
                   db: Session = Depends(get_db)) -> dict:
    p = _get_product(db, product_id)
    for v in db.scalars(select(M.AffiliateVideo).where(
            M.AffiliateVideo.product_id == p.id)).all():
        db.delete(v)
    for s in db.scalars(select(M.AffiliateScript).where(
            M.AffiliateScript.product_id == p.id)).all():
        db.delete(s)
    db.delete(p)
    db.commit()
    return {"request_id": _rid(request), "data": {"deleted": product_id}}


@router.post("/affiliate/products/{product_id}/image", status_code=201)
async def upload_product_image(product_id: str, request: Request,
                               file: UploadFile = File(...),
                               db: Session = Depends(get_db)) -> dict:
    rid = _rid(request)
    p = _get_product(db, product_id)
    data = await file.read()
    ext, mime, w, h = _sniff_image(data, file.filename or "", file.content_type or "")
    digest = hashlib.sha256(data).hexdigest()
    storage = _storage()
    try:
        storage.ensure_affiliate(p.id)
        rel = f"images/{digest}{ext}"
        dest = storage.resolve_affiliate(p.id, rel)
        if not dest.exists():
            dest.write_bytes(data)
    except PathJailError:
        raise AppError("BAD_REQUEST", "invalid storage path", 400)
    p.image_path = rel
    p.image_sha256 = digest
    db.commit()
    return {"request_id": rid, "data": {"path": rel, "sha256": digest, "mime": mime,
                                       "width": w, "height": h}}


# ------------------------------------------------------------ router helpers

def _router_text(db, prompt: str, request_id: str, style: str = "AUTO",
                 manual_model_id: str | None = None) -> tuple[str, str, str, bool, list]:
    """TEXT-capability Router call + usage recording. Returns output/provider/model/mock/attempts."""
    from .ai import store as get_store
    r = Router()
    models = [{
        "id": m.id, "provider_id": m.provider_id, "credential_ref": m.credential_ref,
        "name": m.name, "model_id": m.model_id, "capabilities": m.capabilities,
        "priority": m.priority, "enabled": m.enabled, "cost_class": m.cost_class,
        "license_status": m.license_status, "health_status": m.health_status,
        "metadata": m.extra_metadata or {},
    } for m in db.scalars(select(M.AIModel)).all()]
    providers = {p.id: {"id": p.id, "name": p.name, "base_url": p.base_url,
                        "adapter_key": p.adapter_key, "enabled": p.enabled}
                 for p in db.scalars(select(M.AIProvider)).all()}
    st = get_store()
    refs = {c.ref for c in db.scalars(select(M.Credential)).all() if st.exists(c.ref)}
    secrets = {ref: st.get(ref) for ref in refs}
    result = r.route(models, providers, secrets, refs, RouteInput(
        task="SCRIPT_GENERATION", capability="TEXT", prompt=prompt,
        strategy=style if style in ("AUTO", "PRIORITY") else "AUTO",
        manual_model_id=manual_model_id, max_attempts=3), request_id)
    from ...ai.usage import record_routing
    mock_any = record_routing(db, request_id=request_id, task="SCRIPT_GENERATION",
                              capability="TEXT", result=result,
                              providers=providers, models=models)
    db.flush()
    if not result.ok:
        # Persist the BLOCKED/FAILED activity row before the request rolls back.
        db.commit()
        raise AppError(result.error_code or "UNKNOWN_ERROR",
                       result.error_message or "affiliate generation failed.",
                       {"PAID_MODEL_BLOCKED": 402, "LICENSE_BLOCKED": 403,
                        "CREDENTIAL_MISSING": 409, "MODEL_UNAVAILABLE": 404}.get(
                           result.error_code, 502))
    last = result.attempts[-1]
    return result.output, last.provider, last.model, mock_any, result.attempts


class AnalyzeIn(BaseModel):
    strategy: str = "AUTO"
    manual_model_id: str | None = None


@router.post("/affiliate/products/{product_id}/analyze")
def analyze_product(product_id: str, body: AnalyzeIn, request: Request,
                    db: Session = Depends(get_db)) -> dict:
    from ...ai.director import extract_json
    rid = _rid(request)
    p = _get_product(db, product_id)
    prompt = ("Analyze this product for short affiliate video content. "
              "Respond with ONE JSON object only: "
              '{"benefits": [...], "hooks": [...], "pain_points": [...], '
              '"target_audience": "...", "angles": [...]}. '
              f"Product: {p.name}. Description: {p.description}. Price: {p.price}. "
              f"Audience: {p.audience}. Tone: {p.tone}.")
    output, provider, model, mock_any, _ = _router_text(
        db, prompt, rid, body.strategy, body.manual_model_id)
    try:
        data = extract_json(output)
        if not isinstance(data, dict) or "benefits" not in data:
            raise ValueError("analysis shape mismatch")
    except ValueError as exc:
        raise AppError("INVALID_RESPONSE", f"analysis malformed ({exc}); nothing saved", 502)
    return {"request_id": rid, "data": {"analysis": data, "provider": provider,
                                       "model": model, "mock": mock_any}}


# ------------------------------------------------------------------- scripts

class ScriptIn(BaseModel):
    style: str = "REVIEW"
    strategy: str = "AUTO"
    manual_model_id: str | None = None


def _script_out(s: M.AffiliateScript) -> dict:
    return {"id": s.id, "product_id": s.product_id, "style": s.style,
            "hook": s.hook, "body": s.body, "cta": s.cta,
            "disclosure": s.disclosure, "disclosure_injected": s.disclosure_injected,
            "provider": s.provider, "model": s.model, "request_id": s.request_id,
            "mock": s.mock, "position": s.position, "created_at": s.created_at}


@router.post("/affiliate/products/{product_id}/scripts", status_code=201)
def create_script(product_id: str, body: ScriptIn, request: Request,
                  db: Session = Depends(get_db)) -> dict:
    from ...ai.director import extract_json
    rid = _rid(request)
    if body.style not in SCRIPT_STYLES:
        raise AppError("BAD_REQUEST", f"unknown style: {body.style}", 400)
    p = _get_product(db, product_id)
    prompt = (f"Write a short affiliate video script in style {body.style}. "
              "Respond with ONE JSON object only: "
              '{"hook": "...", "body": "...", "cta": "...", "disclosure": "..."}. '
              "disclosure MUST be a proper affiliate disclosure sentence. "
              f"Product: {p.name}. Description: {p.description}. Price: {p.price}. "
              f"URL: {p.affiliate_url}. Audience: {p.audience}. Tone: {p.tone}.")
    output, provider, model, mock_any, _ = _router_text(
        db, prompt, rid, body.strategy, body.manual_model_id)
    try:
        data = extract_json(output)
        if not isinstance(data, dict) or not data.get("body"):
            raise ValueError("script shape mismatch")
    except ValueError as exc:
        raise AppError("INVALID_RESPONSE", f"script malformed ({exc}); nothing saved", 502)
    disclosure = (data.get("disclosure") or "").strip()
    injected = False
    if not disclosure:
        disclosure = DEFAULT_DISCLOSURE
        injected = True
    s = M.AffiliateScript(id=f"afs_{uuid.uuid4().hex[:12]}", product_id=p.id,
                          style=body.style, hook=data.get("hook", ""),
                          body=data["body"], cta=data.get("cta", ""),
                          disclosure=disclosure, disclosure_injected=injected,
                          provider=provider, model=model, request_id=rid, mock=mock_any)
    db.add(s)
    db.flush()
    # New scripts go last: max sibling position + 1.
    siblings = db.scalars(select(M.AffiliateScript).where(
        M.AffiliateScript.product_id == p.id,
        M.AffiliateScript.id != s.id)).all()
    s.position = max([x.position for x in siblings], default=-1) + 1
    db.commit()
    return {"request_id": rid, "data": _script_out(s)}


@router.get("/affiliate/products/{product_id}/scripts")
def list_scripts(product_id: str, request: Request,
                 db: Session = Depends(get_db)) -> dict:
    _get_product(db, product_id)
    rows = db.scalars(select(M.AffiliateScript).where(
        M.AffiliateScript.product_id == product_id).order_by(
            M.AffiliateScript.position, M.AffiliateScript.created_at)).all()
    return {"request_id": _rid(request), "data": [_script_out(s) for s in rows]}


class ScriptPositionIn(BaseModel):
    position: int = Field(ge=0, le=10000)


@router.patch("/affiliate/scripts/{script_id}", status_code=200)
def move_script(script_id: str, body: ScriptPositionIn, request: Request,
                db: Session = Depends(get_db)) -> dict:
    """Drag-and-drop reorder: move one script, renumber siblings 0..n."""
    s = db.get(M.AffiliateScript, script_id)
    if s is None:
        raise AppError("NOT_FOUND", "Script not found.", 404)
    siblings = db.scalars(select(M.AffiliateScript).where(
        M.AffiliateScript.product_id == s.product_id,
        M.AffiliateScript.id != s.id).order_by(
            M.AffiliateScript.position, M.AffiliateScript.created_at)).all()
    at = max(0, min(body.position, len(siblings)))
    ordered = siblings[:at] + [s] + siblings[at:]
    for i, row in enumerate(ordered):
        row.position = i
    db.commit()
    return {"request_id": _rid(request), "data": _script_out(s)}


# -------------------------------------------------------------------- videos

class VideoIn(BaseModel):
    script_id: str
    generate_visual: bool = False
    strategy: str = "AUTO"


def _video_out(v: M.AffiliateVideo, script: M.AffiliateScript | None = None) -> dict:
    return {"id": v.id, "product_id": v.product_id, "script_id": v.script_id,
            "status": v.status, "visual_artifact_id": v.visual_artifact_id,
            "video_path": v.video_path or None,
            "has_video": bool(v.video_path), "duration_s": v.duration_s,
            "progress": v.progress,
            "export_manifest": v.export_manifest,
            "script": _script_out(script) if script else None,
            "created_at": v.created_at, "updated_at": v.updated_at}


@router.post("/affiliate/products/{product_id}/videos", status_code=201)
def create_video(product_id: str, body: VideoIn, request: Request,
                 db: Session = Depends(get_db)) -> dict:
    from ...media.pipeline import PipelineError, generate_bytes
    from ...media.validate import MediaInvalid, validate_image
    rid = _rid(request)
    p = _get_product(db, product_id)
    script = db.get(M.AffiliateScript, body.script_id)
    if script is None or script.product_id != p.id:
        raise AppError("BAD_REQUEST", "script not in product", 400)
    v = M.AffiliateVideo(id=f"afv_{uuid.uuid4().hex[:12]}", product_id=p.id,
                         script_id=script.id, status="DRAFT")
    db.add(v)
    db.flush()
    if body.generate_visual:
        v.status = "RENDERING"
        db.flush()
        try:
            data, _mime, meta = generate_bytes(
                "IMAGE", f"Product showcase: {p.name}. {p.description[:200]}",
                db, rid, body.strategy, None, False, False)
            data2, _, _ = data, _mime, meta
            mime, w, h = validate_image(data2)
        except (PipelineError, MediaInvalid) as exc:
            v.status = "FAILED"
            db.commit()
            code = getattr(exc, "code", "UNKNOWN_ERROR")
            raise AppError(code, str(exc)[:300],
                           {"PAID_MODEL_BLOCKED": 402, "LICENSE_BLOCKED": 403}.get(code, 502))
        import hashlib as _hl
        storage = _storage()
        storage.ensure_affiliate(p.id)
        rel = f"visuals/{v.id}.png"
        storage.resolve_affiliate(p.id, rel).write_bytes(data2)
        v.visual_artifact_id = rel
        v.status = "READY"
    else:
        v.status = "READY"
    db.commit()
    return {"request_id": rid, "data": _video_out(v, script)}


class RenderIn(BaseModel):
    strategy: str = "AUTO"


@router.post("/affiliate/videos/{video_id}/render", status_code=200)
def render_video(video_id: str, body: RenderIn, request: Request,
                 db: Session = Depends(get_db)) -> dict:
    """Narration (script hook+body+cta) -> TTS -> FFmpeg slideshow MP4.

    Visual: script video visual first, else product image. Honest 422 when
    no image or no speakable text. Never a fake/silent video.
    """
    from ...media.ffmpeg import compose_scene, require as ffmpeg_require
    from ...media.pipeline import PipelineError, generate_bytes
    from ...media.validate import MediaInvalid, build_srt, validate_audio
    rid = _rid(request)
    v = db.get(M.AffiliateVideo, video_id)
    if v is None:
        raise AppError("NOT_FOUND", "Video not found.", 404)
    p = _get_product(db, v.product_id)
    script = db.get(M.AffiliateScript, v.script_id)
    storage = _storage()
    storage.ensure_affiliate(p.id)
    img_rel = v.visual_artifact_id or p.image_path or ""
    if not img_rel:
        raise AppError("VALIDATION_FAILED",
                       "Render needs a product image or a generated visual first.", 422)
    try:
        img_path = storage.resolve_affiliate(p.id, img_rel)
    except PathJailError:
        raise AppError("BAD_REQUEST", "invalid image path", 400)
    if not img_path.is_file():
        raise AppError("NOT_FOUND", "Image file missing on disk.", 404)
    narration = " ".join(t for t in
                          [script.hook if script else "", script.body if script else "",
                           script.cta if script else ""] if t.strip())
    if not narration.strip():
        raise AppError("VALIDATION_FAILED", "Script has no speakable text.", 422)
    v.status = "RENDERING"
    v.progress = 2
    db.commit()
    try:
        ffmpeg_require()
    except Exception:  # noqa: BLE001
        v.status = "FAILED"
        db.commit()
        raise AppError("FFMPEG_UNAVAILABLE", "FFmpeg binary not found.", 502)
    from pathlib import Path as _Path
    import tempfile as _tf
    tmp_audio: str | None = None
    try:
        data, _mime, meta = generate_bytes(
            "TTS", narration, db, rid, body.strategy, None, False, False)
        audio_bytes = data
        with _tf.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(audio_bytes)
            tmp_audio = f.name
        mime, dur = validate_audio(audio_bytes)
        if dur <= 0:
            raise MediaInvalid("tts audio has no duration")
        v.progress = 30
        db.commit()
        srt = build_srt([(0.0, dur, narration[:500])])
        rel_sub = f"videos/{v.id}.srt"
        storage.resolve_affiliate(p.id, rel_sub).write_text(srt, encoding="utf-8")
        out_rel = f"videos/{v.id}.mp4"
        out_path = storage.resolve_affiliate(p.id, out_rel)

        def _on_ffmpeg(frac: float, _vid=v.id) -> None:
            # Real ffmpeg time -> 30..95%. Committed so polling clients see it.
            pct = 30 + max(0, min(65, int(frac * 65)))
            try:
                row = db.get(M.AffiliateVideo, _vid)
                if row is not None and pct > (row.progress or 0):
                    row.progress = pct
                    db.commit()
            except Exception:  # noqa: BLE001 - progress is best-effort
                try:
                    db.rollback()
                except Exception:  # noqa: BLE001
                    pass

        compose_scene(img_path, _Path(tmp_audio),
                      storage.resolve_affiliate(p.id, rel_sub),
                      out_path, dur, on_progress=_on_ffmpeg)
    except (PipelineError, MediaInvalid) as exc:
        v.status = "FAILED"
        db.commit()
        code = getattr(exc, "code", "UNKNOWN_ERROR")
        raise AppError(code, str(exc)[:300],
                       {"PAID_MODEL_BLOCKED": 402, "LICENSE_BLOCKED": 403}.get(code, 502))
    except Exception as exc:  # noqa: BLE001 - ffmpeg/io failure, honest
        v.status = "FAILED"
        db.commit()
        raise AppError("RENDER_FAILED", f"Render failed: {type(exc).__name__}", 502)
    finally:
        try:
            if tmp_audio:
                _Path(tmp_audio).unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass
    v.video_path = out_rel
    v.duration_s = dur
    v.progress = 100
    v.status = "READY"
    db.commit()
    return {"request_id": rid, "data": _video_out(v, script)}


class ReviseIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    strategy: str = "AUTO"


@router.post("/affiliate/videos/{video_id}/revise", status_code=201)
def revise_script(video_id: str, body: ReviseIn, request: Request,
                  db: Session = Depends(get_db)) -> dict:
    """Chat edit: user asks for changes in plain words, AI rewrites the
    script as a NEW versioned row. Nothing is overwritten."""
    from ...ai.director import extract_json
    rid = _rid(request)
    v = db.get(M.AffiliateVideo, video_id)
    if v is None:
        raise AppError("NOT_FOUND", "Video not found.", 404)
    p = _get_product(db, v.product_id)
    script = db.get(M.AffiliateScript, v.script_id)
    if script is None:
        raise AppError("BAD_REQUEST", "Video has no script to revise.", 400)
    prompt = (
        "Rewrite this affiliate video script following the user's request. "
        "Respond with ONE JSON object only: "
        '{"hook": "...", "body": "...", "cta": "...", "disclosure": "..."}. '
        f"Product: {p.name}. Description: {p.description}. "
        f"Current hook: {script.hook} Current body: {script.body} "
        f"Current cta: {script.cta} User request: {body.message}")
    output, provider, model, mock_any, _ = _router_text(
        db, prompt, rid, body.strategy, None)
    try:
        data = extract_json(output)
        if not isinstance(data, dict) or not data.get("body"):
            raise ValueError("script shape mismatch")
    except ValueError as exc:
        raise AppError("INVALID_RESPONSE", f"revised script malformed ({exc}); nothing saved", 502)
    disclosure = (data.get("disclosure") or "").strip() or script.disclosure
    s = M.AffiliateScript(id=f"afs_{uuid.uuid4().hex[:12]}", product_id=p.id,
                          style=script.style, hook=data.get("hook", ""),
                          body=data["body"], cta=data.get("cta", ""),
                          disclosure=disclosure, disclosure_injected=False,
                          provider=provider, model=model, request_id=rid, mock=mock_any)
    db.add(s)
    db.flush()
    siblings = db.scalars(select(M.AffiliateScript).where(
        M.AffiliateScript.product_id == p.id,
        M.AffiliateScript.id != s.id)).all()
    s.position = max([x.position for x in siblings], default=-1) + 1
    db.commit()
    return {"request_id": rid, "data": _script_out(s)}


@router.get("/affiliate/products/{product_id}/videos")
def list_videos(product_id: str, request: Request,
                db: Session = Depends(get_db)) -> dict:
    _get_product(db, product_id)
    rows = db.scalars(select(M.AffiliateVideo).where(
        M.AffiliateVideo.product_id == product_id).order_by(
            M.AffiliateVideo.created_at)).all()
    out = []
    for v in rows:
        out.append(_video_out(v, db.get(M.AffiliateScript, v.script_id)))
    return {"request_id": _rid(request), "data": out}


@router.get("/affiliate/videos/{video_id}/preview")
def preview_video(video_id: str, request: Request,
                  db: Session = Depends(get_db)) -> dict:
    v = db.get(M.AffiliateVideo, video_id)
    if v is None:
        raise AppError("NOT_FOUND", "Video not found.", 404)
    p = _get_product(db, v.product_id)
    script = db.get(M.AffiliateScript, v.script_id)
    return {"request_id": _rid(request), "data": {
        "video": _video_out(v, script),
        "product": _product_out(p),
        "disclosure": script.disclosure if script else "",
        # Default workflow has no auto-publish surface.
        "publish": {"auto_publish": False}}}


class ExportVideoIn(BaseModel):
    pass


@router.post("/affiliate/videos/{video_id}/export", status_code=201)
def export_video(video_id: str, request: Request,
                 db: Session = Depends(get_db)) -> dict:
    rid = _rid(request)
    v = db.get(M.AffiliateVideo, video_id)
    if v is None:
        raise AppError("NOT_FOUND", "Video not found.", 404)
    p = _get_product(db, v.product_id)
    script = db.get(M.AffiliateScript, v.script_id)
    if script is None or not script.disclosure.strip():
        raise AppError("PRODUCTION_BLOCKED", "export blocked: disclosure missing", 422)
    manifest = {
        "video_id": v.id, "product": {"id": p.id, "name": p.name,
                                      "affiliate_url": p.affiliate_url},
        "script": {"style": script.style, "hook": script.hook,
                   "body": script.body, "cta": script.cta,
                   "disclosure": script.disclosure,
                   "disclosure_injected": script.disclosure_injected},
        "visual": v.visual_artifact_id, "video": v.video_path or None,
        "duration_s": v.duration_s, "product_image": p.image_path,
        "auto_publish": False, "request_id": rid,
    }
    storage = _storage()
    storage.ensure_affiliate(p.id)
    rel = f"exports/{v.id}.manifest.json"
    storage.resolve_affiliate(p.id, rel).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    manifest["file"] = rel
    v.export_manifest = manifest
    v.status = "EXPORTED"
    db.commit()
    return {"request_id": rid, "data": {"video_id": v.id, "manifest": manifest}}
