"""Real diagnostics: backend/db/storage/ffmpeg/AI registry/scheduler/publisher.

Rules kept honest (PASS 8):
- Nothing reports HEALTHY without evidence gathered in this call.
- A missing provider/model/credential/connection is CONFIG_REQUIRED, never "fine".
- The probes use the caller's DB session, so they always read the same database
  the API is serving, and a probe failure degrades to UNKNOWN instead of a 500.
- No secret, token, ref value or fingerprint is ever placed in a check detail.
  Counts and enum states only.
"""
from __future__ import annotations

import shutil
import sqlite3
from urllib.parse import urlparse

UNKNOWN = "UNKNOWN"
HEALTHY = "HEALTHY"
CONFIG_REQUIRED = "CONFIG_REQUIRED"
UNAVAILABLE = "UNAVAILABLE"


def _check_db(database_url: str) -> dict:
    try:
        if database_url.startswith("sqlite"):
            # sqlite:///./file.db or sqlite:///:memory:
            path = database_url.split("sqlite:///", 1)[-1]
            if path in ("", ":memory:"):
                conn = sqlite3.connect(":memory:")
                conn.execute("SELECT 1")
                conn.close()
                return {"status": HEALTHY, "detail": "sqlite memory reachable"}
            conn = sqlite3.connect(path)
            conn.execute("SELECT 1")
            conn.close()
            return {"status": HEALTHY, "detail": f"sqlite reachable: {path}"}
        parsed = urlparse(database_url)
        return {"status": UNKNOWN, "detail": f"non-sqlite scheme: {parsed.scheme or '?'} (not probed)"}
    except Exception as exc:  # noqa: BLE001
        return {"status": UNAVAILABLE, "detail": type(exc).__name__}


def _binary(name: str, label: str) -> dict:
    exe = shutil.which(name)
    if not exe:
        return {"status": UNAVAILABLE, "detail": f"{label} binary not found on PATH"}
    return {"status": HEALTHY, "detail": exe}


def _guard(fn, fallback_detail: str):
    """A diagnostics probe must never break the diagnostics endpoint."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return {"status": UNKNOWN, "detail": f"{fallback_detail}: {type(exc).__name__}"}


def _check_ai_registry(db) -> dict:
    from sqlalchemy import func, select

    from ..db.models import AIProvider

    def probe() -> dict:
        total = db.scalar(select(func.count()).select_from(AIProvider)) or 0
        if not total:
            return {"status": CONFIG_REQUIRED,
                    "detail": "chưa đăng ký nhà cung cấp AI nào — Director, hình ảnh và TTS sẽ bị chặn"}
        enabled = db.scalar(select(func.count()).select_from(AIProvider)
                            .where(AIProvider.enabled.is_(True))) or 0
        return {"status": HEALTHY if enabled else CONFIG_REQUIRED,
                "detail": f"{enabled}/{total} nhà cung cấp đang bật"}

    return _guard(probe, "không đọc được danh sách nhà cung cấp")


def _check_ai_models(db) -> dict:
    from sqlalchemy import select

    from ..ai.router import RouteInput, Router
    from ..db.models import AIModel

    def probe() -> dict:
        rows = db.scalars(select(AIModel)).all()
        if not rows:
            return {"status": CONFIG_REQUIRED,
                    "detail": "chưa đăng ký mô hình nào — bộ định tuyến sẽ báo MODEL_UNAVAILABLE"}
        models = [{"id": m.id, "provider_id": m.provider_id,
                   "credential_ref": m.credential_ref, "name": m.name,
                   "model_id": m.model_id, "capabilities": m.capabilities,
                   "priority": m.priority, "enabled": m.enabled,
                   "cost_class": m.cost_class, "license_status": m.license_status,
                   "health_status": m.health_status} for m in rows]
        refs = {m["credential_ref"] for m in models if m["credential_ref"]}
        r = Router()
        by_cap = {}
        for cap in ("STORY", "TEXT", "IMAGE", "TTS", "VIDEO"):
            eligible, _excluded = r.eligible(models, refs,
                                             RouteInput(task="INSPECT", capability=cap))
            by_cap[cap] = len(eligible)
        detail = f"{len(models)} mô hình · " + ", ".join(f"{c}={n}" for c, n in by_cap.items())
        if not any(by_cap.values()):
            return {"status": CONFIG_REQUIRED,
                    "detail": detail + " — chưa năng lực nào dùng được (chi phí/giấy phép/credential)"}
        return {"status": HEALTHY, "detail": detail}

    return _guard(probe, "không đọc được danh sách mô hình")


def _check_credentials(db) -> dict:
    """Existence only. Never the value, never the fingerprint, never the ref."""
    from sqlalchemy import func, select

    from ..db.models import Credential

    def probe() -> dict:
        total = db.scalar(select(func.count()).select_from(Credential)) or 0
        if not total:
            return {"status": CONFIG_REQUIRED,
                    "detail": "chưa lưu khoá truy cập nào — thêm khoá ở Trung tâm mô hình AI"}
        return {"status": HEALTHY,
                "detail": f"{total} khoá đã lưu (mã hoá, không hiển thị giá trị)"}

    return _guard(probe, "không đọc được danh sách khoá")


def _check_scheduler(db) -> dict:
    from sqlalchemy import func, select

    from ..db.models import Schedule

    def probe() -> dict:
        total = db.scalar(select(func.count()).select_from(Schedule)) or 0
        if not total:
            return {"status": HEALTHY, "detail": "bộ lập lịch sẵn sàng · chưa có lịch đăng nào"}
        pending = db.scalar(select(func.count()).select_from(Schedule)
                            .where(Schedule.status == "SCHEDULED")) or 0
        return {"status": HEALTHY, "detail": f"{pending}/{total} lịch đăng đang chờ"}

    return _guard(probe, "không đọc được lịch đăng")


def _check_publisher(db) -> dict:
    from sqlalchemy import func, select

    from ..db.models import SocialConnection

    def probe() -> dict:
        total = db.scalar(select(func.count()).select_from(SocialConnection)) or 0
        if not total:
            return {"status": CONFIG_REQUIRED,
                    "detail": "chưa kết nối tài khoản đăng bài (YouTube/TikTok/Facebook)"}
        connected = db.scalar(select(func.count()).select_from(SocialConnection)
                              .where(SocialConnection.status == "CONNECTED")) or 0
        return {"status": HEALTHY if connected else CONFIG_REQUIRED,
                "detail": f"{connected}/{total} tài khoản đã kết nối"}

    return _guard(probe, "không đọc được kết nối đăng bài")


def _safe(fn):
    """Belt-and-braces: no probe may break the diagnostics endpoint."""
    try:
        result = fn()
    except Exception as exc:  # noqa: BLE001
        return {"status": UNKNOWN, "detail": f"probe failed: {type(exc).__name__}"}
    if not isinstance(result, dict) or "status" not in result:
        return {"status": UNKNOWN, "detail": "probe returned no status"}
    return result


def run_diagnostics(db, database_url: str, storage_health: dict) -> dict:
    """`db` is the request's session — same database the API is serving."""
    return {
        "backend": {"status": HEALTHY, "detail": "fastapi running"},
        "database": _safe(lambda: _check_db(database_url)),
        "storage": storage_health,
        "ffmpeg": _safe(lambda: _binary("ffmpeg", "ffmpeg")),
        "ffprobe": _safe(lambda: _binary("ffprobe", "ffprobe")),
        "ai_providers": _safe(lambda: _check_ai_registry(db)),
        "ai_models": _safe(lambda: _check_ai_models(db)),
        "ai_credentials": _safe(lambda: _check_credentials(db)),
        "scheduler": _safe(lambda: _check_scheduler(db)),
        "publisher": _safe(lambda: _check_publisher(db)),
    }