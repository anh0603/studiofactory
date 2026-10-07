"""AI activity recording: one append-only row per provider attempt, plus one
row for an operation that was refused BEFORE any network call.

Why this exists (PASS 8 fix): `Router.route()`/`route_media()` return
`attempts == []` when eligibility/policy gates reject everything. Callers used
to only persist per-attempt traces, so a user pressing "Generate" on an
unconfigured system produced ZERO activity rows and `/ai/usage` reported
`requests: 0`. The operation was invisible.

Semantics kept honest:

- `status="SUCCESS"`  -> a provider answered; network was called.
- `status="FAILED"`   -> a provider attempt happened and failed (or the adapter
                         could not be resolved after routing started).
- `status="BLOCKED"`  -> refused pre-network. `attempt=0`, `latency_ms=0`,
                         `provider=""`, `model=""`, `mock=false`. This is NOT a
                         provider request and must never be counted as one.

No secret is ever written: only provider/model display names, a typed error
code, and counters.
"""
from __future__ import annotations

import uuid

SUCCESS = "SUCCESS"
FAILED = "FAILED"
BLOCKED = "BLOCKED"


def is_mock_attempt(providers: dict, models: list, model_name: str) -> bool:
    """True only when the attempt's provider runs the in-process `test` adapter."""
    provider_id = next((m["provider_id"] for m in models if m["name"] == model_name), "")
    return providers.get(provider_id, {}).get("adapter_key") == "test"


def _new_event(db, **fields):
    from ..db import models as M

    db.add(M.UsageEvent(id=f"uev_{uuid.uuid4().hex[:12]}", cost=None,
                        cost_state="UNKNOWN", **fields))


def record_attempts(db, *, request_id: str, task: str, capability: str,
                    attempts: list, providers: dict, models: list,
                    job_id: str | None = None) -> bool:
    """Persist one row per provider attempt. Returns True if any attempt was mock.

    `attempts` is the Router's AttemptTrace list (network may have been called).
    """
    mock_any = False
    for a in attempts:
        is_mock = is_mock_attempt(providers, models, a.model)
        mock_any = mock_any or is_mock
        _new_event(
            db, request_id=request_id, job_id=job_id, task=task,
            capability=capability, provider=a.provider, model=a.model,
            attempt=a.attempt, latency_ms=a.latency_ms, status=a.status,
            error_category=a.error_code if a.status != SUCCESS else None,
            fallback_reason=a.fallback_reason or None,
            mock=is_mock,
        )
    return mock_any


def record_block(db, *, request_id: str, task: str, capability: str,
                 error_code: str, job_id: str | None = None) -> None:
    """Persist one row for an operation refused before any network call.

    `attempt=0` and `latency_ms=0` are what make "no provider was contacted"
    derivable by readers of the API.
    """
    _new_event(
        db, request_id=request_id, job_id=job_id, task=task, capability=capability,
        provider="", model="", attempt=0, latency_ms=0, status=BLOCKED,
        error_category=error_code or "UNKNOWN_ERROR", fallback_reason=None,
        mock=False,
    )


def record_routing(db, *, request_id: str, task: str, capability: str, result,
                   providers: dict, models: list, job_id: str | None = None) -> bool:
    """Record whatever a Router call produced: attempts, or a pre-network block.

    Returns True if any provider attempt was mock. Never records secrets.
    """
    if result.ok or result.attempts:
        return record_attempts(db, request_id=request_id, task=task,
                               capability=capability, attempts=result.attempts,
                               providers=providers, models=models, job_id=job_id)
    record_block(db, request_id=request_id, task=task, capability=capability,
                 error_code=result.error_code, job_id=job_id)
    return False