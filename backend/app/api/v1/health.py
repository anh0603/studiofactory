"""GET /api/v1/health — real backend status (no mock)."""
from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/health")
def health(request: Request) -> dict:
    return {
        "status": "ok",
        "service": "studiofactory-backend",
        "request_id": getattr(request.state, "request_id", "req_unknown"),
    }
