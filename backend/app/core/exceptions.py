"""AppError + exception handlers. Never leak stacktrace/secret to client."""
from __future__ import annotations

import logging

from fastapi import Request
from fastapi.responses import JSONResponse

from .errors import error_body
from .scrub import scrub

log = logging.getLogger("studiofactory")


class AppError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "req_unknown")
    log.warning(
        "app error",
        extra={"event": "app.error", "request_id": request_id, "extra": scrub({"code": exc.code})},
    )
    return JSONResponse(
        status_code=exc.status,
        content=error_body(exc.code, exc.message, request_id),
        headers={"X-Request-Id": request_id},
    )


async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "req_unknown")
    # Log class name only; never str(exc) raw (may contain secrets/paths).
    log.error("unhandled", extra={"event": "app.unhandled", "request_id": request_id})
    return JSONResponse(
        status_code=500,
        content=error_body("UNKNOWN_ERROR", "Internal error. See server logs with request_id.", request_id),
        headers={"X-Request-Id": request_id},
    )
