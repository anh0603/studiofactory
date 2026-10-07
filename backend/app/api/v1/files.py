"""Serve generated media bytes for in-app preview (video player, images).

All paths stay inside the project/affiliate jails. Video uses manual HTTP
Range support so <video> can seek. No secrets, no directory listing.
"""
from __future__ import annotations

import mimetypes
import re
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.config import settings
from ...core.exceptions import AppError
from ...db import models as M
from ...db.session import get_db
from ...storage.local import LocalStorage, PathJailError

router = APIRouter()

_CHUNK = 1024 * 256
_ID_SAFE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "req_unknown")


def _storage() -> LocalStorage:
    return LocalStorage(settings.projects_root)


def _check_id(value: str, what: str) -> str:
    if not _ID_SAFE.match(value or ""):
        raise AppError("BAD_REQUEST", f"invalid {what} id.", 400)
    return value


def _range_response(path: Path, mime: str, request: Request) -> StreamingResponse:
    size = path.stat().st_size
    if size <= 0:
        raise AppError("INVALID_RESPONSE", "Media file is empty.", 502)
    headers = {"Accept-Ranges": "bytes", "Content-Length": str(size)}
    status = 200
    start, end = 0, size - 1
    range_header = request.headers.get("range")
    if range_header:
        m = re.match(r"bytes=(\d*)-(\d*)$", range_header.strip())
        if not m or (not m.group(1) and not m.group(2)):
            raise AppError("BAD_REQUEST", "Invalid Range header.", 416)
        if m.group(1):
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else size - 1
        else:
            start = max(size - int(m.group(2)), 0)
        if start >= size or end < start:
            raise AppError("BAD_REQUEST", "Range out of bounds.", 416)
        end = min(end, size - 1)
        status = 206
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        headers["Content-Length"] = str(end - start + 1)

    def gen():
        with open(path, "rb") as f:
            f.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = f.read(min(_CHUNK, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    if request.method == "HEAD":
        return StreamingResponse(iter([]), status_code=status, media_type=mime, headers=headers)
    return StreamingResponse(gen(), status_code=status, media_type=mime, headers=headers)


def _artifact_path(db: Session, artifact_id: str) -> tuple[Path, str]:
    a = db.get(M.Artifact, _check_id(artifact_id, "artifact"))
    if a is None:
        raise AppError("NOT_FOUND", "Artifact not found.", 404)
    job = db.get(M.Job, a.job_id) if a.job_id else None
    if job is None:
        raise AppError("NOT_FOUND", "Artifact job not found.", 404)
    try:
        path = _storage().resolve(job.project_id, a.path)
    except PathJailError:
        raise AppError("BAD_REQUEST", "Artifact path escapes jail.", 400)
    if not path.is_file():
        raise AppError("NOT_FOUND", "Artifact file missing on disk.", 404)
    mime = a.mime or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return path, mime


@router.get("/artifacts/{artifact_id}")
def artifact_meta(artifact_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    a = db.get(M.Artifact, _check_id(artifact_id, "artifact"))
    if a is None:
        raise AppError("NOT_FOUND", "Artifact not found.", 404)
    return {"request_id": _rid(request), "data": {
        "id": a.id, "kind": a.kind, "mime": a.mime, "bytes": a.bytes,
        "width": a.width, "height": a.height, "duration_s": a.duration_s,
        "provider": a.provider, "model": a.model, "created_at": a.created_at}}


@router.api_route("/artifacts/{artifact_id}/content", methods=["GET", "HEAD"])
def artifact_content(artifact_id: str, request: Request, db: Session = Depends(get_db)):
    path, mime = _artifact_path(db, artifact_id)
    return _range_response(path, mime, request)


def _affiliate_file(product_id: str, rel: str | None, db: Session) -> tuple[Path, str]:
    from .affiliate import _get_product
    p = _get_product(db, _check_id(product_id, "product"))
    if not rel:
        raise AppError("NOT_FOUND", "No file attached yet.", 404)
    try:
        path = _storage().resolve_affiliate(p.id, rel)
    except PathJailError:
        raise AppError("BAD_REQUEST", "Path escapes jail.", 400)
    if not path.is_file():
        raise AppError("NOT_FOUND", "File missing on disk.", 404)
    return path, mimetypes.guess_type(path.name)[0] or "application/octet-stream"


@router.api_route("/affiliate/products/{product_id}/image/content",
                  methods=["GET", "HEAD"])
def affiliate_image_content(product_id: str, request: Request,
                            db: Session = Depends(get_db)):
    from .affiliate import _get_product
    p = _get_product(db, _check_id(product_id, "product"))
    path, mime = _affiliate_file(p.id, p.image_path, db)
    return _range_response(path, mime, request)


@router.api_route("/affiliate/videos/{video_id}/visual/content",
                  methods=["GET", "HEAD"])
def affiliate_visual_content(video_id: str, request: Request,
                             db: Session = Depends(get_db)):
    v = db.get(M.AffiliateVideo, _check_id(video_id, "video"))
    if v is None:
        raise AppError("NOT_FOUND", "Video not found.", 404)
    path, mime = _affiliate_file(v.product_id, v.visual_artifact_id, db)
    return _range_response(path, mime, request)
