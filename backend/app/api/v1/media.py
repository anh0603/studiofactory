"""Media API: scene image/video/tts/subtitle/render, project render/QC/export.

All AI generation goes through AI Router. Every success persists a validated
artifact + provenance. Idempotent via Job.idempotency_key when provided.
Export enforces server-side Production Gate (no bypass parameter exists).
"""
from __future__ import annotations

import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.config import settings
from ...core.exceptions import AppError
from ...db import models as M
from ...db.session import get_db
from ...media import ffmpeg
from ...media.pipeline import (EXT, PipelineError, generate_bytes, persist_artifact,
                               render_project)
from ...media.qc import persist_qc, production_gate, run_qc
from ...media.validate import MediaInvalid, validate_audio, validate_image, validate_video
from ...storage.local import LocalStorage
from .story import _get_scene, _get_story_project

router = APIRouter()


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "req_unknown")


def _storage() -> LocalStorage:
    return LocalStorage(settings.projects_root)


class MediaIn(BaseModel):
    prompt: str = ""
    strategy: str = "AUTO"
    manual_model_id: str | None = None
    allow_paid: bool = False
    require_commercial: bool = False
    idempotency_key: str | None = None
    duration: float = 0.0  # scene render / tts hint


def _job_for(db: Session, project_id: str, kind: str,
             key: str | None) -> tuple[M.Job, bool]:
    if key:
        existing = db.scalar(select(M.Job).where(M.Job.idempotency_key == key))
        if existing is not None:
            return existing, False
    job = M.Job(id=f"JOB-{uuid.uuid4().hex[:8].upper()}", project_id=project_id,
                kind=kind, status="RUNNING", stage="RUNNING",
                idempotency_key=key or f"im_{uuid.uuid4().hex[:12]}")
    db.add(job)
    db.flush()
    return job, True


def _job_done(db: Session, job: M.Job, provider: str, model: str,
              ok: bool, err: str = "") -> None:
    job.provider = provider
    job.model = model
    job.status = "SUCCEEDED" if ok else "FAILED"
    job.stage = job.status
    job.error_code = err or None


def _latest_artifact(db: Session, job_id: str, kind: str,
                     scene_id: str | None = None) -> M.Artifact | None:
    q = select(M.Artifact).where(M.Artifact.job_id == job_id, M.Artifact.kind == kind)
    if scene_id is not None:
        q = q.where(M.Artifact.scene_id == scene_id)
    return db.scalar(q.order_by(M.Artifact.created_at.desc()))


def _scene_artifacts(db: Session, project_id: str, scene_id: str) -> dict[str, M.Artifact]:
    rows = db.scalars(select(M.Artifact).where(
        M.Artifact.scene_id == scene_id).order_by(M.Artifact.created_at)).all()
    out: dict[str, M.Artifact] = {}
    for r in rows:
        out[r.kind] = r  # latest wins by ordering
    return out


def _art_out(a: M.Artifact) -> dict:
    return {"id": a.id, "kind": a.kind, "path": a.path, "sha256": a.sha256,
            "bytes": a.bytes, "mime": a.mime, "width": a.width, "height": a.height,
            "duration_s": a.duration_s, "provider": a.provider, "model": a.model,
            "request_id": a.request_id, "scene_id": a.scene_id}


def _gen_kind(kind: str, router_kind: str, body: MediaIn, project_id: str,
              scene_id: str | None, request: Request, db: Session,
              prompt: str, validate) -> dict:
    rid = _rid(request)
    storage = _storage()
    storage.ensure_project(project_id)
    job, created = _job_for(db, project_id, kind, body.idempotency_key)
    if not created:
        arts = [_art_out(a) for a in db.scalars(
            select(M.Artifact).where(M.Artifact.job_id == job.id)).all()]
        return {"request_id": rid, "data": {"job_id": job.id, "replay": True,
                                            "artifacts": arts}}
    try:
        data, _mime, meta = generate_bytes(
            router_kind, prompt, db, rid, body.strategy, body.manual_model_id,
            body.allow_paid, body.require_commercial, job.id)
    except PipelineError as exc:
        _job_done(db, job, "", "", False, exc.code)
        db.commit()
        raise AppError(exc.code, exc.message,
                       {"PAID_MODEL_BLOCKED": 402, "LICENSE_BLOCKED": 403,
                        "CREDENTIAL_MISSING": 409, "MODEL_UNAVAILABLE": 404}.get(
                           exc.code, 502))
    try:
        if kind == "IMAGE":
            mime, w, h = validate_image(data)
            art = persist_artifact(db, storage, project_id, "scenes", f"{scene_id}_img{EXT[kind]}",
                                   data, kind, mime, meta, rid, job.id, scene_id)
            art.update({"width": w, "height": h})
            row = db.get(M.Artifact, art["id"]); row.width = w; row.height = h
        elif kind == "VIDEO":
            mime, _size = validate_video(data)
            art = persist_artifact(db, storage, project_id, "scenes", f"{scene_id}_vid.mp4",
                                   data, kind, mime, meta, rid, job.id, scene_id)
        elif kind == "TTS":
            mime, dur = validate_audio(data)
            art = persist_artifact(db, storage, project_id, "audio", f"{scene_id}_tts.wav",
                                   data, kind, mime, meta, rid, job.id, scene_id, dur)
            art["duration_s"] = dur
            row = db.get(M.Artifact, art["id"]); row.duration_s = dur
        _job_done(db, job, meta["provider"], meta["model"], True)
        db.commit()
    except MediaInvalid as exc:
        _job_done(db, job, meta.get("provider", ""), meta.get("model", ""), False,
                  "INVALID_RESPONSE")
        db.commit()
        raise AppError("INVALID_RESPONSE", f"Provider returned invalid media: {exc}", 502)
    return {"request_id": rid, "data": {"job_id": job.id, "replay": False,
                                       "artifacts": [art]}}


@router.post("/projects/{project_id}/scenes/{scene_id}/image")
def gen_image(project_id: str, scene_id: str, body: MediaIn, request: Request,
              db: Session = Depends(get_db)) -> dict:
    s = _get_scene(db, scene_id)
    if s.project_id != project_id:
        raise AppError("BAD_REQUEST", "scene not in project", 400)
    prompt = body.prompt or s.visual_prompt or s.description or "video still"
    # Character reference: pass ids only (bytes never enter prompts).
    return _gen_kind("IMAGE", "IMAGE", body, project_id, scene_id, request, db,
                     prompt, validate_image)


@router.post("/projects/{project_id}/scenes/{scene_id}/video")
def gen_video(project_id: str, scene_id: str, body: MediaIn, request: Request,
              db: Session = Depends(get_db)) -> dict:
    s = _get_scene(db, scene_id)
    if s.project_id != project_id:
        raise AppError("BAD_REQUEST", "scene not in project", 400)
    prompt = body.prompt or s.visual_prompt or s.description or "short clip"
    return _gen_kind("VIDEO", "VIDEO", body, project_id, scene_id, request, db,
                     prompt, validate_video)


@router.post("/projects/{project_id}/scenes/{scene_id}/tts")
def gen_tts(project_id: str, scene_id: str, body: MediaIn, request: Request,
            db: Session = Depends(get_db)) -> dict:
    s = _get_scene(db, scene_id)
    if s.project_id != project_id:
        raise AppError("BAD_REQUEST", "scene not in project", 400)
    prompt = body.prompt or s.dialogue
    if not prompt.strip():
        raise AppError("BAD_REQUEST", "scene has no dialogue to speak", 400)
    return _gen_kind("TTS", "TTS", body, project_id, scene_id, request, db,
                     prompt, validate_audio)


class SubtitleIn(BaseModel):
    cues: list[tuple[float, float, str]] | None = None
    idempotency_key: str | None = None


@router.post("/projects/{project_id}/scenes/{scene_id}/subtitle")
def gen_subtitle(project_id: str, scene_id: str, body: SubtitleIn, request: Request,
                 db: Session = Depends(get_db)) -> dict:
    from ...media.validate import build_srt
    rid = _rid(request)
    s = _get_scene(db, scene_id)
    if s.project_id != project_id:
        raise AppError("BAD_REQUEST", "scene not in project", 400)
    storage = _storage()
    storage.ensure_project(project_id)
    cues = body.cues
    if cues is None:
        dur = s.duration_s or 5.0
        text = s.dialogue or s.description or "(no dialogue)"
        cues = [(0.0, dur, text)]
    try:
        srt = build_srt([(float(a), float(b), str(t)) for a, b, t in cues])
    except MediaInvalid as exc:
        raise AppError("VALIDATION_FAILED", f"invalid cues: {exc}", 400)
    job, created = _job_for(db, project_id, "SUBTITLE", body.idempotency_key)
    if not created:
        arts = [_art_out(a) for a in db.scalars(
            select(M.Artifact).where(M.Artifact.job_id == job.id)).all()]
        return {"request_id": rid, "data": {"job_id": job.id, "replay": True,
                                            "artifacts": arts}}
    art = persist_artifact(db, storage, project_id, "subtitles", f"{scene_id}.srt",
                           srt.encode("utf-8"), "SUBTITLE", "text/srt",
                           {"provider": "local", "model": "srt-v1",
                            "cost_class": "LOCAL", "license_status": "VERIFIED_COMMERCIAL"},
                           rid, job.id, scene_id, cues[-1][1])
    _job_done(db, job, "local", "srt-v1", True)
    db.commit()
    return {"request_id": rid, "data": {"job_id": job.id, "replay": False,
                                       "artifacts": [art]}}


@router.post("/projects/{project_id}/scenes/{scene_id}/render")
def render_scene(project_id: str, scene_id: str, body: MediaIn, request: Request,
                 db: Session = Depends(get_db)) -> dict:
    rid = _rid(request)
    s = _get_scene(db, scene_id)
    if s.project_id != project_id:
        raise AppError("BAD_REQUEST", "scene not in project", 400)
    storage = _storage()
    arts = _scene_artifacts(db, project_id, scene_id)
    img, aud, sub = arts.get("IMAGE"), arts.get("TTS"), arts.get("SUBTITLE")
    if img is None or aud is None:
        raise AppError("BAD_REQUEST", "scene needs IMAGE + TTS before render", 400)
    job, created = _job_for(db, project_id, "COMPOSE", body.idempotency_key)
    if not created:
        arts_out = [_art_out(a) for a in db.scalars(
            select(M.Artifact).where(M.Artifact.job_id == job.id)).all()]
        return {"request_id": rid, "data": {"job_id": job.id, "replay": True,
                                            "artifacts": arts_out}}
    if ffmpeg.executable() is None:
        _job_done(db, job, "", "", False, "FFMPEG_UNAVAILABLE")
        db.commit()
        raise AppError("FFMPEG_UNAVAILABLE", "ffmpeg binary not found on PATH", 503)
    import tempfile as _tf
    tmp = _tf.mkdtemp(prefix="sf_scene_")
    try:
        from pathlib import Path as _P
        out = _P(tmp) / "scene.mp4"
        dur = aud.duration_s or s.duration_s or 5.0
        ffmpeg.compose_scene(
            storage.resolve(project_id, img.path),
            storage.resolve(project_id, aud.path),
            storage.resolve(project_id, sub.path) if sub else None,
            out, dur)
        data = out.read_bytes()
    except (RuntimeError, ValueError) as exc:
        _job_done(db, job, "", "", False, "RENDER_FAILED")
        db.commit()
        raise AppError("RENDER_FAILED", f"scene render failed: {str(exc)[-300:]}", 500)
    finally:
        import shutil as _sh
        _sh.rmtree(tmp, ignore_errors=True)
    meta = {"provider": "local", "model": "ffmpeg-compose",
            "cost_class": "LOCAL", "license_status": "VERIFIED_COMMERCIAL"}
    art = persist_artifact(db, storage, project_id, "renders", f"{scene_id}.mp4",
                           data, "VIDEO", "video/mp4", meta, rid, job.id, scene_id,
                           dur, 720, 1280)
    try:
        import tempfile as _tf2
        from pathlib import Path as _P2
        tdir = _P2(_tf2.mkdtemp(prefix="sf_thumb_"))
        tp = tdir / "t.jpg"
        ffmpeg.thumbnail(storage.resolve(project_id, art["path"]), tp)
        tbytes = tp.read_bytes()
        import shutil as _sh2
        _sh2.rmtree(tdir, ignore_errors=True)
        persist_artifact(db, storage, project_id, "renders", f"{scene_id}_thumb.jpg",
                         tbytes, "THUMBNAIL", "image/jpeg", meta, rid, job.id, scene_id)
    except RuntimeError:
        pass
    _job_done(db, job, "local", "ffmpeg-compose", True)
    db.commit()
    arts_out = [_art_out(a) for a in db.scalars(
        select(M.Artifact).where(M.Artifact.job_id == job.id)).all()]
    return {"request_id": rid, "data": {"job_id": job.id, "replay": False,
                                       "artifacts": arts_out}}


@router.post("/projects/{project_id}/render")
def render_project_endpoint(project_id: str, body: MediaIn, request: Request,
                            db: Session = Depends(get_db)) -> dict:
    rid = _rid(request)
    _get_story_project(db, project_id)
    storage = _storage()
    scenes = db.scalars(select(M.Scene).where(
        M.Scene.project_id == project_id).order_by(M.Scene.idx)).all()
    if not scenes:
        raise AppError("BAD_REQUEST", "project has no scenes", 400)
    parts = []
    total = 0.0
    for s in scenes:
        arts = _scene_artifacts(db, project_id, s.id)
        v = arts.get("VIDEO")
        if v is None or v.path.endswith(".mp4") is False:
            raise AppError("BAD_REQUEST", f"scene {s.idx} has no rendered video", 400)
        # Distinguish scene renders (in renders/) from raw VIDEO payloads.
        if not v.path.startswith("renders/"):
            raise AppError("BAD_REQUEST", f"scene {s.idx} has no rendered video", 400)
        parts.append({"video": v.path})
        total += v.duration_s or 0.0
    job, created = _job_for(db, project_id, "COMPOSE", body.idempotency_key)
    if not created:
        arts_out = [_art_out(a) for a in db.scalars(
            select(M.Artifact).where(M.Artifact.job_id == job.id)).all()]
        return {"request_id": rid, "data": {"job_id": job.id, "replay": True,
                                            "artifacts": arts_out}}
    try:
        result = render_project(project_id, parts, storage)
    except PipelineError as exc:
        _job_done(db, job, "", "", False, exc.code)
        db.commit()
        raise AppError(exc.code, exc.message, 503 if exc.code == "FFMPEG_UNAVAILABLE" else 500)
    except RuntimeError as exc:
        _job_done(db, job, "", "", False, "RENDER_FAILED")
        db.commit()
        raise AppError("RENDER_FAILED", str(exc)[-300:], 500)
    meta = {"provider": "local", "model": "ffmpeg-concat",
            "cost_class": "LOCAL", "license_status": "VERIFIED_COMMERCIAL"}
    art = persist_artifact(db, storage, project_id, "renders", "final.mp4",
                           result["video"], "VIDEO", "video/mp4", meta, rid, job.id,
                           None, total, 720, 1280)
    if result.get("thumbnail"):
        persist_artifact(db, storage, project_id, "renders", "thumbnail.jpg",
                         result["thumbnail"], "THUMBNAIL", "image/jpeg",
                         meta, rid, job.id)
    _job_done(db, job, "local", "ffmpeg-concat", True)
    db.commit()
    arts_out = [_art_out(a) for a in db.scalars(
        select(M.Artifact).where(M.Artifact.job_id == job.id)).all()]
    return {"request_id": rid, "data": {"job_id": job.id, "replay": False,
                                       "artifacts": arts_out}}


@router.get("/projects/{project_id}/artifacts")
def list_artifacts(project_id: str, request: Request,
                   kind: str | None = None, scene_id: str | None = None,
                   db: Session = Depends(get_db)) -> dict:
    _get_story_project(db, project_id)
    scenes = {s.id for s in db.scalars(select(M.Scene).where(
        M.Scene.project_id == project_id)).all()}
    rows = db.scalars(select(M.Artifact).order_by(M.Artifact.created_at.desc())).all()
    out = []
    for a in rows:
        # Belongs to project if scene-linked in project, or via job project.
        job = db.get(M.Job, a.job_id) if a.job_id.startswith("JOB-") else None
        in_project = (a.scene_id in scenes) or (job is not None and job.project_id == project_id)
        if not in_project:
            continue
        if kind and a.kind != kind:
            continue
        if scene_id and a.scene_id != scene_id:
            continue
        out.append(_art_out(a))
    return {"request_id": _rid(request), "data": out}


class QCIn(BaseModel):
    disclosure: bool = False
    require_commercial: bool = False


@router.post("/projects/{project_id}/qc")
def run_project_qc(project_id: str, body: QCIn, request: Request,
                   db: Session = Depends(get_db)) -> dict:
    rid = _rid(request)
    project = _get_story_project(db, project_id)
    scenes = db.scalars(select(M.Scene).where(
        M.Scene.project_id == project_id).order_by(M.Scene.idx)).all()
    final = None
    for a in db.scalars(select(M.Artifact).order_by(M.Artifact.created_at.desc())).all():
        job = db.get(M.Job, a.job_id) if a.job_id.startswith("JOB-") else None
        if (job is not None and job.project_id == project_id
                and a.kind == "VIDEO" and a.scene_id is None
                and a.path.startswith("renders/")):
            final = a
            break
    audio_dur = 0.0
    subs = 0
    for s in scenes:
        arts = _scene_artifacts(db, project_id, s.id)
        if arts.get("TTS"):
            audio_dur += arts["TTS"].duration_s or 0.0
        if arts.get("SUBTITLE"):
            subs += 1
    mains = db.scalars(select(M.Character).where(
        M.Character.project_id == project_id, M.Character.kind == "MAIN")).all()
    if not mains:
        char_ok: bool | None = True
    elif any(c.lock_state == "UNSUPPORTED" for c in mains):
        char_ok = False
    else:
        char_ok = None  # LOCKED is user-asserted; REVIEW_REQUIRED pending — needs review
    lic_all = []
    for a in db.scalars(select(M.Artifact)).all():
        job = db.get(M.Job, a.job_id) if a.job_id.startswith("JOB-") else None
        if job is not None and job.project_id == project_id:
            lic_all.append(a.license_status)
    license_ok: bool | None = None
    if lic_all:
        license_ok = all(v == "VERIFIED_COMMERCIAL" for v in lic_all)
    qc = run_qc({
        "video": {"bytes": final.bytes if final else 0,
                  "duration_s": final.duration_s if final else 0,
                  "width": final.width if final else 0,
                  "height": final.height if final else 0,
                  "sha256": final.sha256 if final else "",
                  "provenance": True} if final else None,
        "audio": {"duration_s": audio_dur, "sha256": "mixed" if audio_dur else "",
                  "provenance": True} if audio_dur else None,
        "subtitle": {"sha256": "scenes", "provenance": True} if subs == len(scenes) and scenes else None,
        "character_ok": char_ok, "license_ok": license_ok,
        "disclosure": body.disclosure or None,
    })
    # Use a stable QC job id: latest COMPOSE job or a synthetic one.
    qjob = db.scalar(select(M.Job).where(
        M.Job.project_id == project_id).order_by(M.Job.created_at.desc()))
    qid = qjob.id if qjob else f"JOB-{uuid.uuid4().hex[:8].upper()}"
    persist_qc(db, qid, qc)
    db.commit()
    gate = production_gate(qc, body.require_commercial)
    return {"request_id": rid, "data": {"qc": qc, "gate": gate, "job_id": qid}}


class ExportIn(BaseModel):
    disclosure_text: str = ""
    idempotency_key: str | None = None


@router.post("/projects/{project_id}/export")
def export_project(project_id: str, body: ExportIn, request: Request,
                   db: Session = Depends(get_db)) -> dict:
    """Export enforces Production Gate server-side. No bypass exists."""
    from ...media.qc import GATE_REQUIRED  # noqa
    rid = _rid(request)
    project = _get_story_project(db, project_id)
    if not body.disclosure_text.strip():
        raise AppError("PRODUCTION_BLOCKED", "Export blocked: AI disclosure text required.", 422)
    qc_res = run_project_qc(project_id, QCIn(disclosure=True), request, db)
    gate = qc_res["data"]["gate"]
    if gate["decision"] != "PASS":
        raise AppError("PRODUCTION_BLOCKED",
                       f"Export blocked by Production Gate: {'; '.join(gate['reasons'])}", 422)
    if body.idempotency_key:
        existing = db.scalar(select(M.Export).where(
            M.Export.idempotency_key == body.idempotency_key))
        if existing is not None:
            return {"request_id": rid, "data": {"export_id": existing.id, "replay": True,
                                                "manifest": existing.files_manifest}}
    storage = _storage()
    storage.ensure_project(project_id)
    finals = [a for a in db.scalars(select(M.Artifact).order_by(
        M.Artifact.created_at.desc())).all()
        if a.kind in ("VIDEO", "THUMBNAIL") and a.scene_id is None]
    files = {a.kind: a.path for a in finals}
    manifest = {
        "project_id": project_id, "project_name": project.name,
        "files": files,
        "disclosure_text": body.disclosure_text,
        "qc_verdict": qc_res["data"]["qc"]["verdict"],
        "request_id": rid,
    }
    manifest_rel = "exports/manifest.json"
    storage.resolve(project_id, manifest_rel).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    row = M.Export(id=f"exp_{uuid.uuid4().hex[:12]}",
                   job_id=qc_res["data"]["job_id"],
                   files_manifest=manifest,
                   provenance_uri="exports/manifest.json",
                   idempotency_key=body.idempotency_key or f"im_{uuid.uuid4().hex[:12]}")
    db.add(row)
    db.commit()
    return {"request_id": rid, "data": {"export_id": row.id, "replay": False,
                                       "manifest": manifest}}
