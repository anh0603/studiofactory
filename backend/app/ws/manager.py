"""WebSocket hub. Phase 5: engine broadcasts real job events. No fake progress."""
from __future__ import annotations

import asyncio
import threading

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = threading.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        with self._lock:
            self._connections.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        with self._lock:
            self._connections.discard(ws)

    async def send(self, ws: WebSocket, payload: dict) -> None:
        await ws.send_json(payload)

    async def broadcast(self, payload: dict) -> None:
        with self._lock:
            targets = list(self._connections)
        dead = []
        for ws in targets:
            try:
                await ws.send_json(payload)
            except Exception:  # noqa: BLE001 - drop dead sockets
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    def broadcast_sync(self, payload: dict) -> None:
        """Best-effort from sync worker threads. Never raises, never blocks."""
        with self._lock:
            targets = list(self._connections)
        for ws in targets:
            _schedule(ws, payload)


def _schedule(ws: WebSocket, payload: dict) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return  # worker thread without loop: skip rather than corrupt state
    loop.create_task(_safe_send(ws, payload))


async def _safe_send(ws: WebSocket, payload: dict) -> None:
    try:
        await ws.send_json(payload)
    except Exception:  # noqa: BLE001
        manager.disconnect(ws)


manager = ConnectionManager()

# Future event names (frozen, not emitted in Phase 1):
FUTURE_EVENTS = (
    "job.stage_changed",
    "job.status_changed",
    "job.log",
    "job.completed",
    "job.failed",
)
