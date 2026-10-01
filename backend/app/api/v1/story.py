"""Story domain: projects / characters (+references upload) / scenes.

Factory isolation: story endpoints reject factory_type != story.
No media generation here (Phase 4+).
"""
from __future__ import annotations

import hashlib
import struct
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...core.exceptions import AppError
from ...db import models as M
from ...db.session import get_db
from ...storage.local import LocalStorage, PathJailError
from ...core.config import settings

router = APIRouter()

PROJECT_STATUSES = ("DRAFT", "GENERATING", "REVIEW", "READY", "EXPORTING",
                    "COMPLETED", "FAILED", "ARCHIVED")
SCENE_STATUSES = ("DRAFT", "PLANNED", "REVIEW_REQUIRED", "APPROVED")
CHARACTER_KINDS = ("MAIN", "SUPPORTING")
LOCK_STATES = ("REVIEW_REQUIRED", "UNSUPPORTED", "LOCKED")
# NOTE: no LOCKED_VERIFIED — no visual verification engine exists yet.

ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_IMAGE_MIME = {"image/jpeg", "image/png", "image/webp"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "req_unknown")


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


# ------------------------------------------------------------------ projects

class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = ""
    factory_type: str = "story"
    language: str = "vi"
    style: str = ""
    audience: str = ""
    duration_target: float = 30.0


class ProjectPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    language: str | None = None
    style: str | None = None
    audience: str | None = None
    duration_target: float | None = None
    status: str | None = None


def _project_out(p: M.Project) -> dict:
    return {"id": p.id, "name": p.name, "description": p.description,
            "factory_type": p.factory_type, "language": p.language,
            "style": p.style, "audience": p.audience,
            "duration_target": p.duration_target, "status": p.status,
            "created_at": p.created_at, "updated_at": p.updated_at}


def _get_story_project(db: Session, project_id: str) -> M.Project:
    p = db.get(M.Project, project_id)
    if p is None:
        raise AppError("NOT_FOUND", "Project not found.", 404)
    if p.factory_type != "story":
        raise AppError("BAD_REQUEST", "Not a Story Factory project.", 400)
    return p


@router.get("/projects")
def list_projects(request: Request, factory_type: str = "story",
                  db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(select(M.Project).where(
        M.Project.factory_type == factory_type).order_by(M.Project.created_at.desc())).all()
    return {"request_id": _rid(request), "data": [_project_out(p) for p in rows]}


@router.post("/projects", status_code=201)
def create_project(body: ProjectIn, request: Request, db: Session = Depends(get_db)) -> dict:
    if body.factory_type != "story":
        raise AppError("BAD_REQUEST", "Story API only creates story projects.", 400)
    p = M.Project(id=_new_id("prj"), name=body.name, description=body.description,
                  factory_type="story", language=body.language, style=body.style,
                  audience=body.audience, duration_target=body.duration_target, status="DRAFT")
    db.add(p)
    db.commit()
    LocalStorage(settings.projects_root).ensure_project(p.id)
    return {"request_id": _rid(request), "data": _project_out(p)}


@router.get("/projects/{project_id}")
def get_project(project_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    return {"request_id": _rid(request), "data": _project_out(_get_story_project(db, project_id))}


@router.patch("/projects/{project_id}")
def patch_project(project_id: str, body: ProjectPatch, request: Request,
                  db: Session = Depends(get_db)) -> dict:
    p = _get_story_project(db, project_id)
    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in PROJECT_STATUSES:
        raise AppError("BAD_REQUEST", "unknown status", 400)
    for k, v in data.items():
        setattr(p, k, v)
    db.commit()
    return {"request_id": _rid(request), "data": _project_out(p)}


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    p = _get_story_project(db, project_id)
    # Delete children (scenes, characters+refs, director plans) — no media jobs exist in Phase 3.
    for sc in db.scalars(select(M.Scene).where(M.Scene.project_id == p.id)).all():
        db.delete(sc)
    for ch in db.scalars(select(M.Character).where(M.Character.project_id == p.id)).all():
        for ref in db.scalars(select(M.CharacterReference).where(
                M.CharacterReference.character_id == ch.id)).all():
            db.delete(ref)
        db.delete(ch)
    for plan in db.scalars(select(M.DirectorPlan).where(
            M.DirectorPlan.project_id == p.id)).all():
        db.delete(plan)
    db.delete(p)
    db.commit()
    return {"request_id": _rid(request), "data": {"deleted": project_id}}


# ---------------------------------------------------------------- characters

class CharacterIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    kind: str = "MAIN"
    description: str = ""
    visual_identity: str = ""
    face: str = ""
    hair: str = ""
    clothes: str = ""
    colors: str = ""
    defining_features: str = ""
    lock_state: str = "REVIEW_REQUIRED"


class CharacterPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    visual_identity: str | None = None
    face: str | None = None
    hair: str | None = None
    clothes: str | None = None
    colors: str | None = None
    defining_features: str | None = None
    lock_state: str | None = None


def _char_out(c: M.Character) -> dict:
    lock = c.lock or {}
    return {"id": c.id, "project_id": c.project_id, "kind": c.kind, "name": c.name,
            "description": c.description, "visual_identity": c.visual_identity,
            "face": lock.get("face", ""), "hair": lock.get("hair", ""),
            "clothes": lock.get("clothes", ""), "colors": lock.get("colors", ""),
            "defining_features": lock.get("defining_features", ""),
            "lock_state": c.lock_state, "reference_asset_id": c.reference_asset_id,
            "created_at": c.created_at, "updated_at": c.updated_at}


def _get_character(db: Session, character_id: str) -> M.Character:
    c = db.get(M.Character, character_id)
    if c is None:
        raise AppError("NOT_FOUND", "Character not found.", 404)
    _get_story_project(db, c.project_id)  # enforce factory isolation
    return c


@router.get("/projects/{project_id}/characters")
def list_characters(project_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    _get_story_project(db, project_id)
    rows = db.scalars(select(M.Character).where(M.Character.project_id == project_id)).all()
    return {"request_id": _rid(request), "data": [_char_out(c) for c in rows]}


@router.post("/projects/{project_id}/characters", status_code=201)
def create_character(project_id: str, body: CharacterIn, request: Request,
                     db: Session = Depends(get_db)) -> dict:
    _get_story_project(db, project_id)
    if body.kind not in CHARACTER_KINDS:
        raise AppError("BAD_REQUEST", "unknown kind", 400)
    if body.lock_state not in LOCK_STATES:
        raise AppError("BAD_REQUEST", "unknown lock_state (LOCKED_VERIFIED unavailable)", 400)
    c = M.Character(id=_new_id("chr"), project_id=project_id, kind=body.kind, name=body.name,
                    description=body.description, visual_identity=body.visual_identity,
                    lock={"face": body.face, "hair": body.hair, "clothes": body.clothes,
                          "colors": body.colors, "defining_features": body.defining_features},
                    lock_state=body.lock_state)
    db.add(c)
    db.commit()
    return {"request_id": _rid(request), "data": _char_out(c)}


@router.get("/characters/{character_id}")
def get_character(character_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    return {"request_id": _rid(request), "data": _char_out(_get_character(db, character_id))}


@router.patch("/characters/{character_id}")
def patch_character(character_id: str, body: CharacterPatch, request: Request,
                    db: Session = Depends(get_db)) -> dict:
    c = _get_character(db, character_id)
    data = body.model_dump(exclude_unset=True)
    if "lock_state" in data and data["lock_state"] not in LOCK_STATES:
        raise AppError("BAD_REQUEST", "unknown lock_state (LOCKED_VERIFIED unavailable)", 400)
    lock = dict(c.lock or {})
    for k in ("face", "hair", "clothes", "colors", "defining_features"):
        if k in data:
            lock[k] = data.pop(k)
    c.lock = lock
    for k, v in data.items():
        setattr(c, k, v)
    # Any manual edit drops a user-asserted LOCKED back to REVIEW_REQUIRED honesty:
    # user edits mean identity changed since lock assertion.
    if any(k in data for k in ("description", "visual_identity")) and c.lock_state == "LOCKED":
        c.lock_state = "REVIEW_REQUIRED"
    db.commit()
    return {"request_id": _rid(request), "data": _char_out(c)}


@router.delete("/characters/{character_id}")
def delete_character(character_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    c = _get_character(db, character_id)
    for ref in db.scalars(select(M.CharacterReference).where(
            M.CharacterReference.character_id == c.id)).all():
        db.delete(ref)
    db.delete(c)
    db.commit()
    return {"request_id": _rid(request), "data": {"deleted": character_id}}


# ------------------------------------------------------- reference upload

def _sniff_image(data: bytes, filename: str, content_type: str) -> tuple[str, str, int, int]:
    """Returns (ext, mime, width, height). Raises AppError on invalid content."""
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_IMAGE_EXT:
        raise AppError("VALIDATION_FAILED", f"extension not allowed: {ext or '(none)'}", 400)
    if content_type not in ALLOWED_IMAGE_MIME:
        raise AppError("VALIDATION_FAILED", f"mime not allowed: {content_type}", 400)
    if len(data) > MAX_UPLOAD_BYTES:
        raise AppError("VALIDATION_FAILED", "file too large (max 10MB)", 400)
    width = height = 0
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        mime = "image/png"
        if len(data) >= 33:
            width, height = struct.unpack(">II", data[16:24])
    elif data[:2] == b"\xff\xd8":
        mime = "image/jpeg"
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        mime = "image/webp"
    else:
        raise AppError("VALIDATION_FAILED", "magic bytes do not match a supported image", 400)
    if mime != content_type and not (ext in (".jpg", ".jpeg") and mime == "image/jpeg"):
        raise AppError("VALIDATION_FAILED", "mime/extension/content mismatch", 400)
    return ext, mime, width, height


@router.post("/characters/{character_id}/references", status_code=201)
async def upload_reference(character_id: str, request: Request,
                           file: UploadFile = File(...),
                           db: Session = Depends(get_db)) -> dict:
    rid = _rid(request)
    c = _get_character(db, character_id)
    data = await file.read()
    ext, mime, width, height = _sniff_image(data, file.filename or "", file.content_type or "")
    digest = hashlib.sha256(data).hexdigest()
    storage = LocalStorage(settings.projects_root)
    try:
        storage.ensure_project(c.project_id)
        # Dedupe by hash: same bytes -> same filename, no duplicate write.
        rel = f"characters/{digest}{ext}"
        dest = storage.resolve(c.project_id, rel)
        if not dest.exists():
            dest.write_bytes(data)
    except PathJailError:
        raise AppError("BAD_REQUEST", "invalid storage path", 400)
    ref = M.CharacterReference(id=_new_id("cref"), character_id=c.id, asset_path=rel,
                               sha256=digest, mime=mime, width=width, height=height)
    db.add(ref)
    c.reference_asset_id = ref.id
    db.commit()
    return {"request_id": rid, "data": {"id": ref.id, "asset_path": rel, "sha256": digest,
                                       "mime": mime, "width": width, "height": height}}


@router.get("/characters/{character_id}/references")
def list_references(character_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    c = _get_character(db, character_id)
    rows = db.scalars(select(M.CharacterReference).where(
        M.CharacterReference.character_id == c.id)).all()
    return {"request_id": _rid(request), "data": [
        {"id": r.id, "asset_path": r.asset_path, "sha256": r.sha256,
         "mime": r.mime, "width": r.width, "height": r.height,
         "created_at": r.created_at} for r in rows]}


# --------------------------------------------------------------------- scenes

class SceneIn(BaseModel):
    order: int = 0
    description: str = ""
    dialogue: str = ""
    visual_prompt: str = ""
    camera: str = ""
    motion: str = ""
    environment: str = ""
    duration: float = 0.0
    characters: list[str] = Field(default_factory=list)
    status: str = "DRAFT"


class ScenePatch(BaseModel):
    order: int | None = None
    description: str | None = None
    dialogue: str | None = None
    visual_prompt: str | None = None
    camera: str | None = None
    motion: str | None = None
    environment: str | None = None
    duration: float | None = None
    characters: list[str] | None = None
    status: str | None = None


def _scene_out(s: M.Scene) -> dict:
    return {"id": s.id, "project_id": s.project_id, "order": s.idx,
            "description": s.description, "dialogue": s.dialogue,
            "visual_prompt": s.visual_prompt, "camera": s.camera,
            "motion": s.motion, "environment": s.environment,
            "duration": s.duration_s, "characters": s.characters_json or [],
            "status": s.status, "created_at": s.created_at, "updated_at": s.updated_at}


def _get_scene(db: Session, scene_id: str) -> M.Scene:
    s = db.get(M.Scene, scene_id)
    if s is None:
        raise AppError("NOT_FOUND", "Scene not found.", 404)
    _get_story_project(db, s.project_id)
    return s


@router.get("/projects/{project_id}/scenes")
def list_scenes(project_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    _get_story_project(db, project_id)
    rows = db.scalars(select(M.Scene).where(
        M.Scene.project_id == project_id).order_by(M.Scene.idx)).all()
    return {"request_id": _rid(request), "data": [_scene_out(s) for s in rows]}


@router.post("/projects/{project_id}/scenes", status_code=201)
def create_scene(project_id: str, body: SceneIn, request: Request,
                 db: Session = Depends(get_db)) -> dict:
    _get_story_project(db, project_id)
    if body.status not in SCENE_STATUSES:
        raise AppError("BAD_REQUEST", "unknown status", 400)
    if body.duration < 0 or body.duration > 600:
        raise AppError("BAD_REQUEST", "duration out of range 0..600s", 400)
    # Character ids must belong to this project (isolation).
    for cid in body.characters:
        ch = db.get(M.Character, cid)
        if ch is None or ch.project_id != project_id:
            raise AppError("BAD_REQUEST", f"character not in project: {cid}", 400)
    s = M.Scene(id=_new_id("scn"), project_id=project_id, idx=body.order,
                description=body.description, characters_json=body.characters,
                dialogue=body.dialogue, visual_prompt=body.visual_prompt,
                camera=body.camera, motion=body.motion, environment=body.environment,
                duration_s=body.duration, status=body.status)
    db.add(s)
    db.commit()
    return {"request_id": _rid(request), "data": _scene_out(s)}


@router.get("/scenes/{scene_id}")
def get_scene(scene_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    return {"request_id": _rid(request), "data": _scene_out(_get_scene(db, scene_id))}


@router.patch("/scenes/{scene_id}")
def patch_scene(scene_id: str, body: ScenePatch, request: Request,
                db: Session = Depends(get_db)) -> dict:
    s = _get_scene(db, scene_id)
    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in SCENE_STATUSES:
        raise AppError("BAD_REQUEST", "unknown status", 400)
    if "duration" in data and (data["duration"] < 0 or data["duration"] > 600):
        raise AppError("BAD_REQUEST", "duration out of range 0..600s", 400)
    if "characters" in data:
        for cid in data["characters"]:
            ch = db.get(M.Character, cid)
            if ch is None or ch.project_id != s.project_id:
                raise AppError("BAD_REQUEST", f"character not in project: {cid}", 400)
        s.characters_json = data.pop("characters")
    for k, v in data.items():
        if k == "order":
            s.idx = v
        elif k == "duration":
            s.duration_s = v
        else:
            setattr(s, k, v)
    db.commit()
    return {"request_id": _rid(request), "data": _scene_out(s)}


@router.delete("/scenes/{scene_id}")
def delete_scene(scene_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    s = _get_scene(db, scene_id)
    db.delete(s)
    db.commit()
    return {"request_id": _rid(request), "data": {"deleted": scene_id}}
