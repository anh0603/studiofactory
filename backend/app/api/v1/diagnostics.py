"""GET /api/v1/diagnostics (+ POST /diagnostics/run). Real probes only."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from ...core.config import settings
from ...db.session import get_db
from ...diagnostics.service import run_diagnostics
from ...storage.local import LocalStorage

router = APIRouter()


def _payload(request: Request, db: Session) -> dict:
    storage = LocalStorage(settings.projects_root)
    checks = run_diagnostics(db, settings.database_url, storage.health())
    return {"request_id": getattr(request.state, "request_id", "req_unknown"), "checks": checks}


@router.get("/diagnostics")
def get_diagnostics(request: Request, db: Session = Depends(get_db)) -> dict:
    return _payload(request, db)


@router.post("/diagnostics/run")
def run_diagnostics_endpoint(request: Request, db: Session = Depends(get_db)) -> dict:
    return _payload(request, db)
