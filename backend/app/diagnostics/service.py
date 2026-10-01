"""Real diagnostics: backend/db/storage/ffmpeg. Never fake healthy."""
from __future__ import annotations

import shutil
import sqlite3
from urllib.parse import urlparse


def _check_db(database_url: str) -> dict:
    try:
        if database_url.startswith("sqlite"):
            # sqlite:///./file.db or sqlite:///:memory:
            path = database_url.split("sqlite:///", 1)[-1]
            if path in ("", ":memory:"):
                conn = sqlite3.connect(":memory:")
                conn.execute("SELECT 1")
                conn.close()
                return {"status": "HEALTHY", "detail": "sqlite memory reachable"}
            conn = sqlite3.connect(path)
            conn.execute("SELECT 1")
            conn.close()
            return {"status": "HEALTHY", "detail": f"sqlite reachable: {path}"}
        parsed = urlparse(database_url)
        return {"status": "UNKNOWN", "detail": f"non-sqlite scheme: {parsed.scheme or '?'} (not probed)"}
    except Exception as exc:  # noqa: BLE001
        return {"status": "UNAVAILABLE", "detail": type(exc).__name__}


def _check_ffmpeg() -> dict:
    exe = shutil.which("ffmpeg")
    if not exe:
        return {"status": "UNAVAILABLE", "detail": "ffmpeg binary not found on PATH"}
    return {"status": "HEALTHY", "detail": exe}


def run_diagnostics(database_url: str, storage_health: dict) -> dict:
    return {
        "backend": {"status": "HEALTHY", "detail": "fastapi running"},
        "database": _check_db(database_url),
        "storage": storage_health,
        "ffmpeg": _check_ffmpeg(),
        # Router/publisher/scheduler report CONFIG_REQUIRED until Phase 2+.
        "ai_router": {"status": "CONFIG_REQUIRED", "detail": "router lands in Phase 2"},
        "publisher": {"status": "CONFIG_REQUIRED", "detail": "adapters land in Phase 7"},
        "scheduler": {"status": "CONFIG_REQUIRED", "detail": "engine lands in Phase 6"},
    }
