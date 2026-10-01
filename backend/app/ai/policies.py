"""Cost/license policy gates. Pure functions — run BEFORE any network call."""
from __future__ import annotations

FREE_COST = {"LOCAL", "FREE", "FREE_WITH_LIMIT"}
BLOCKED_COST = {"TRIAL", "PAID", "UNKNOWN"}

COMMERCIAL_OK = {"VERIFIED_COMMERCIAL"}

# Errors that allow fallback to the next model.
RETRYABLE = {
    "RATE_LIMITED",
    "QUOTA_EXHAUSTED",
    "TIMEOUT",
    "PROVIDER_UNAVAILABLE",
    "MODEL_UNAVAILABLE",
    "NETWORK_ERROR",
    "UNKNOWN_ERROR",
    "INVALID_RESPONSE",
}

# Errors that must NOT trigger blind fallback.
NON_RETRYABLE = {
    "BAD_REQUEST",
    "AUTH_FAILED",
    "PERMISSION_DENIED",
    "CONTENT_POLICY_BLOCK",
    "CREDENTIAL_MISSING",
    "LICENSE_BLOCKED",
    "PAID_MODEL_BLOCKED",
    "CAPABILITY_UNSUPPORTED",
}


def cost_allowed(cost_class: str, allow_paid: bool) -> bool:
    if allow_paid:
        return True
    return cost_class in FREE_COST


def license_allowed(license_status: str, require_commercial: bool) -> bool:
    if not require_commercial:
        return True
    return license_status in COMMERCIAL_OK
