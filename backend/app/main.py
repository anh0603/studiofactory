"""FastAPI composition root. Thin by design; domain lives in submodules."""
from __future__ import annotations

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from contextlib import asynccontextmanager

from .api.v1.router import router as v1_router
from .core.config import settings
from .core.errors import error_body
from .core.exceptions import AppError, app_error_handler, unhandled_handler
from .core.logging import configure_logging
from .core.request_id import RequestIdMiddleware
from .ws.manager import manager

configure_logging()


async def http_typed_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """Framework HTTP errors (404 etc.) mapped into the frozen typed contract."""
    request_id = getattr(request.state, "request_id", "req_unknown")
    code = "NOT_FOUND" if exc.status_code == 404 else "BAD_REQUEST"
    message = "Not found." if exc.status_code == 404 else (str(exc.detail) or "Bad request.")
    return JSONResponse(
        status_code=exc.status_code,
        content=error_body(code, message, request_id),
        headers={"X-Request-Id": request_id},
    )


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            from .engine.runner import ensure_worker, recover_stuck
            recover_stuck()
            ensure_worker()
        except Exception:  # noqa: BLE001 - startup must not crash on recovery
            pass
        yield

    app = FastAPI(title=settings.app_name, docs_url="/docs",
                  openapi_url="/openapi.json", lifespan=lifespan)
    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-Request-Id", "Idempotency-Key"],
    )
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_typed_handler)
    app.add_exception_handler(Exception, unhandled_handler)
    app.include_router(v1_router, prefix=settings.api_prefix)

    @app.websocket("/ws")
    async def ws_root(ws: WebSocket):
        await manager.connect(ws)
        try:
            await manager.send(ws, {"event": "connected", "future_events": [
                "job.stage_changed", "job.status_changed", "job.log",
                "job.completed", "job.failed",
            ]})
            while True:
                msg = await ws.receive_text()
                if msg == "ping":
                    await manager.send(ws, {"event": "pong"})
        except WebSocketDisconnect:
            manager.disconnect(ws)

    return app


app = create_app()
