"""Typed error contract (frozen by docs/API_SPEC.md)."""
from __future__ import annotations

from typing import Literal

ErrorCode = Literal[
    "BAD_REQUEST",
    "NOT_FOUND",
    "CONFLICT",
    "VALIDATION_FAILED",
    "NOT_CONFIGURED",
    "CREDENTIAL_MISSING",
    "AUTH_FAILED",
    "PERMISSION_DENIED",
    "RATE_LIMITED",
    "QUOTA_EXHAUSTED",
    "TIMEOUT",
    "PROVIDER_UNAVAILABLE",
    "MODEL_UNAVAILABLE",
    "INVALID_RESPONSE",
    "CONTENT_POLICY_BLOCK",
    "NETWORK_ERROR",
    "LICENSE_BLOCKED",
    "PAID_MODEL_BLOCKED",
    "CAPABILITY_UNSUPPORTED",
    "PRODUCTION_BLOCKED",
    "PUBLISH_NOT_SUPPORTED",
    "PUBLISH_CONFIG_REQUIRED",
    "DUPLICATE_PUBLISH_BLOCKED",
    "APPROVAL_REQUIRED",
    "IDEMPOTENCY_REPLAY",
    "UNKNOWN_ERROR",
]


def error_body(code: str, message: str, request_id: str) -> dict:
    return {"error": {"code": code, "message": message, "request_id": request_id}}
