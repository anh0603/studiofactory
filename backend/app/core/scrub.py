"""Secret scrubbing. Must run before any log/response/error serialize."""
from __future__ import annotations

import re
from typing import Any

_SENSITIVE_KEYS = {
    "api_key",
    "apikey",
    "apiKey",
    "secret",
    "client_secret",
    "token",
    "token_value",
    "access_token",
    "refresh_token",
    "authorization",
    "password",
    "credential",
    "credential_value",
}

_PATTERN = re.compile(
    r"(?i)(api[_-]?key|secret|passwd|password|bearer|token)\s*[:=]\s*([^\s,}]+)"
)


def _scrub_key(key: str) -> bool:
    return key.lower() in _SENSITIVE_KEYS


def scrub(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {
            k: ("***REDACTED***" if _scrub_key(str(k)) else scrub(v))
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [scrub(v) for v in obj]
    if isinstance(obj, str):
        return _PATTERN.sub(r"\1=***REDACTED***", obj)
    return obj
