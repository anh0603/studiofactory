"""GET /api/v1/diagnostics (+ POST /diagnostics/run). Real probes only."""
from __future__ import annotations

from fastapi import APIRouter, Request

from ...core.config import settings
from ...diagnostics.service import run_diagnostics
from ...storage.local import LocalStorage

router = APIRouter()


def _payload(request: Request) -> dict:
    storage = LocalStorage(settings.projects_root)
    checks = run_diagnostics(settings.database_url, storage.health())
    return {"request_id": getattr(request.state, "request_id", "req_unknown"), "checks": checks}


@router.get("/diagnostics")
def get_diagnostics(request: Request) -> dict:
    return _payload(request)


@router.post("/diagnostics/run")
def run_diagnostics_endpoint(request: Request) -> dict:
    return _payload(request)
