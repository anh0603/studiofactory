"""Media pipeline: router-routed generation -> validated bytes -> artifacts.

Every artifact carries provenance {provider, model, request_id, sha256,
cost_class, license_status, mock}. No secrets anywhere.
Media kind -> router task/capability mapping is fixed (no bypass).
"""
from __future__ import annotations

import hashlib
import json
import tempfile
import uuid
from pathlib import Path
from typing import Any

from ..ai.router import RouteInput, Router
from ..storage.local import LocalStorage
from . import ffmpeg
from .validate import (MediaInvalid, build_srt, decode_payload, validate_audio,
                       validate_image, validate_video)

KIND_TASK_CAP = {
    "IMAGE": ("IMAGE_GENERATION", "IMAGE"),
    "VIDEO": ("VIDEO_GENERATION", "VIDEO"),
    "TTS": ("TTS", "TTS"),
}

EXT = {"IMAGE": ".png", "VIDEO": ".mp4", "TTS": ".wav", "SUBTITLE": ".srt",
       "COMPOSE": ".mp4", "THUMBNAIL": ".jpg"}


class PipelineError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _load_registry(db) -> tuple[list, dict, dict, set[str]]:
    from ..api.v1.ai import store as get_store
    from ..db import models as M
    from sqlalchemy import select
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
    return models, providers, {ref: st.get(ref) for ref in refs}, refs


def _record_usage(db, request_id: str, task: str, cap: str, attempts,
                  providers: dict, models: list, job_id: str | None = None) -> bool:
    """Kept for existing importers; delegates to the shared recorder."""
    from ..ai.usage import record_attempts

    return record_attempts(db, request_id=request_id, task=task, capability=cap,
                           attempts=attempts, providers=providers, models=models,
                           job_id=job_id)


def generate_bytes(kind: str, prompt: str, db, request_id: str,
                   strategy: str = "AUTO", manual_model_id: str | None = None,
                   allow_paid: bool = False, require_commercial: bool = False,
                   job_id: str | None = None, timeout_s: float = 60.0,
                   ) -> tuple[bytes, str, dict]:
    """Route + download/decode media. Returns (bytes, mime, trace_meta).

    Raises PipelineError with typed codes. Policy blocks happen pre-network and
    are still recorded as activity (status=BLOCKED, attempt=0).
    """
    task, cap = KIND_TASK_CAP[kind]
    models, providers, secrets, refs = _load_registry(db)
    result = Router().route_media(kind, models, providers, secrets, refs, RouteInput(
        task=task, capability=cap, prompt=prompt, strategy=strategy,
        allow_paid=allow_paid, require_commercial=require_commercial,
        manual_model_id=manual_model_id, job_id=job_id, max_attempts=3,
        timeout_s=timeout_s), request_id)
    from ..ai.usage import record_routing
    mock_any = record_routing(db, request_id=request_id, task=task,
                              capability=cap, result=result, providers=providers,
                              models=models, job_id=job_id)
    db.flush()
    if not result.ok:
        raise PipelineError(result.error_code or "UNKNOWN_ERROR",
                            result.error_message or f"{kind} generation failed.")
    if not isinstance(result.output, str) or not result.output:
        raise PipelineError("INVALID_RESPONSE", "Adapter returned empty payload.")
    try:
        data, _mime = decode_payload(result.output)
    except MediaInvalid as exc:
        raise PipelineError("INVALID_RESPONSE", f"Adapter returned unusable payload: {exc}")
    last = result.attempts[-1]
    meta = {"provider": last.provider, "model": last.model, "mock": mock_any,
            "task": task, "capability": cap}
    # Find cost/license of the winning model for provenance.
    win = next((m for m in models if m["name"] == last.model), {})
    meta["cost_class"] = win.get("cost_class", "UNKNOWN")
    meta["license_status"] = win.get("license_status", "UNVERIFIED")
    return data, _mime, meta


def persist_artifact(db, storage: LocalStorage, project_id: str, subdir: str,
                     filename: str, data: bytes, kind: str, mime: str,
                     meta: dict, request_id: str, job_id: str | None = None,
                     scene_id: str | None = None, duration_s: float = 0.0,
                     width: int = 0, height: int = 0) -> dict:
    from ..db import models as M
    digest = hashlib.sha256(data).hexdigest()
    rel = f"{subdir}/{filename}"
    dest = storage.resolve(project_id, rel)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    row = M.Artifact(
        id=f"art_{uuid.uuid4().hex[:12]}", job_id=job_id or f"JOB-{request_id[:8]}",
        scene_id=scene_id, kind=kind, path=rel, sha256=digest, bytes=len(data),
        mime=mime, width=width, height=height, duration_s=duration_s,
        provider=meta.get("provider", ""), model=meta.get("model", ""),
        request_id=request_id, cost_class=meta.get("cost_class", "UNKNOWN"),
        license_status=meta.get("license_status", "UNVERIFIED"))
    db.add(row)
    # Provenance sidecar (no secrets by construction).
    prov = {"artifact_id": row.id, "sha256": digest, "bytes": len(data), "mime": mime,
            "kind": kind, "provider": meta.get("provider"), "model": meta.get("model"),
            "task": meta.get("task"), "capability": meta.get("capability"),
            "cost_class": meta.get("cost_class"), "license_status": meta.get("license_status"),
            "mock": meta.get("mock", False), "request_id": request_id,
            "job_id": job_id, "scene_id": scene_id}
    prov_path = storage.resolve(project_id, f"provenance/{row.id}.json")
    prov_path.write_text(json.dumps(prov, ensure_ascii=False, indent=2), encoding="utf-8")
    db.flush()
    return {"id": row.id, "path": rel, "sha256": digest, "bytes": len(data),
            "mime": mime, "provider": row.provider, "model": row.model,
            "provenance": f"provenance/{row.id}.json"}


def make_srt(subdir_cues: list[tuple[float, float, str]]) -> str:
    return build_srt(subdir_cues)


def render_project(project_id: str, scene_files: list[dict], storage: LocalStorage,
                   width: int = 720, height: int = 1280,
                   timeout_s: float = 180.0) -> dict:
    """Compose per-scene mp4s then concat. scene_files: [{video: rel_path}]."""
    if not scene_files:
        raise PipelineError("BAD_REQUEST", "no scenes to render")
    if ffmpeg.executable() is None:
        raise PipelineError("FFMPEG_UNAVAILABLE", "ffmpeg binary not found on PATH")
    tmp = Path(tempfile.mkdtemp(prefix="sf_render_"))
    try:
        parts = []
        for i, sf in enumerate(scene_files):
            src = storage.resolve(project_id, sf["video"])
            dst = tmp / f"part_{i:03}.mp4"
            # Normalize each part (scale/pad + faststart) for safe concat.
            code, err = ffmpeg.run([
                "-i", str(src), "-vf",
                f"scale={width}:{height}:force_original_aspect_ratio=increase,"
                f"crop={width}:{height}",
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-movflags", "+faststart", str(dst)], timeout_s)
            if code != 0 or not dst.exists():
                raise PipelineError("RENDER_FAILED", f"scene part {i} failed")
            parts.append(dst)
        # Concat in tmp, then move into project exports.
        tmp_out = tmp / "final.mp4"
        ffmpeg.concat(parts, tmp_out, timeout_s)
        data = tmp_out.read_bytes()
        thumb = tmp / "thumb.jpg"
        try:
            ffmpeg.thumbnail(tmp_out, thumb)
            thumb_bytes = thumb.read_bytes()
        except RuntimeError:
            thumb_bytes = b""
        return {"video": data, "thumbnail": thumb_bytes}
    finally:
        import shutil as _sh
        _sh.rmtree(tmp, ignore_errors=True)
