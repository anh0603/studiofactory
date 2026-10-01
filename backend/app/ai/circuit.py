"""Circuit breaker. In-memory per process; thresholds from settings keys."""
from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class _Entry:
    failures: int = 0
    state: str = "HEALTHY"  # HEALTHY | DEGRADED | OPEN | HALF_OPEN
    opened_at: float = 0.0


class CircuitBreaker:
    def __init__(self, threshold: int = 3, cooldown_s: float = 60.0):
        self.threshold = threshold
        self.cooldown_s = cooldown_s
        self._entries: dict[str, _Entry] = {}

    def _get(self, key: str) -> _Entry:
        return self._entries.setdefault(key, _Entry())

    def can_use(self, key: str) -> tuple[bool, str]:
        e = self._get(key)
        if e.state == "OPEN":
            if time.monotonic() - e.opened_at >= self.cooldown_s:
                e.state = "HALF_OPEN"
                return True, "HALF_OPEN"
            return False, "OPEN"
        return True, e.state

    def record_success(self, key: str) -> str:
        e = self._get(key)
        e.failures = 0
        e.state = "HEALTHY"
        return e.state

    def record_failure(self, key: str) -> str:
        e = self._get(key)
        e.failures += 1
        if e.failures >= self.threshold:
            e.state = "OPEN"
            e.opened_at = time.monotonic()
        elif e.failures >= 2:
            e.state = "DEGRADED"
        return e.state

    def snapshot(self) -> dict[str, str]:
        return {k: v.state for k, v in self._entries.items()}


breaker = CircuitBreaker()
