"""AI Router: eligibility → policy gates (pre-network) → strategy → execute → fallback → trace."""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field

from .adapters import AdapterRequest, get_adapter
from .circuit import CircuitBreaker
from .policies import NON_RETRYABLE, RETRYABLE, cost_allowed, license_allowed

STRATEGIES = ("AUTO", "PRIORITY", "WEIGHTED", "FASTEST", "CHEAPEST")

_COST_RANK = {"LOCAL": 0, "FREE": 1, "FREE_WITH_LIMIT": 2, "TRIAL": 3, "UNKNOWN": 4, "PAID": 5}


@dataclass
class RouteInput:
    task: str
    capability: str
    prompt: str = ""
    strategy: str = "AUTO"
    allow_paid: bool = False
    require_commercial: bool = False
    manual_model_id: str | None = None
    job_id: str | None = None
    max_attempts: int = 3
    timeout_s: float = 20.0


@dataclass
class AttemptTrace:
    attempt: int
    provider: str
    model: str
    status: str
    error_code: str = "SUCCESS"
    fallback_reason: str = ""
    latency_ms: int = 0


@dataclass
class RouteResult:
    ok: bool
    output: str = ""
    error_code: str = "SUCCESS"
    error_message: str = ""
    attempts: list[AttemptTrace] = field(default_factory=list)
    strategy_resolved: str = "PRIORITY"
    network_calls: int = 0


class Router:
    def __init__(self, breaker: CircuitBreaker | None = None):
        from .circuit import breaker as default_breaker
        self.breaker = breaker or default_breaker

    # ------------------------------------------------------------ eligibility
    def eligible(self, models: list, credentials_exist: set[str], inp: RouteInput) -> tuple[list, list]:
        """Returns (eligible, excluded[{model, reason}]). No network here."""
        eligible, excluded = [], []
        for m in models:
            reason = ""
            if inp.manual_model_id and m["id"] != inp.manual_model_id:
                reason = "MANUAL_SELECTION"
            elif not m.get("enabled", True):
                reason = "DISABLED"
            elif inp.capability not in (m.get("capabilities") or []):
                reason = "CAPABILITY_MISMATCH"
            elif m.get("credential_ref") not in credentials_exist:
                reason = "CREDENTIAL_MISSING"
            elif not cost_allowed(m.get("cost_class", "UNKNOWN"), inp.allow_paid):
                reason = "PAID_MODEL_BLOCKED"
            elif not license_allowed(m.get("license_status", "UNVERIFIED"), inp.require_commercial):
                reason = "LICENSE_BLOCKED"
            elif (m.get("health_status") in ("DISABLED", "AUTH_FAILED", "QUOTA_EXHAUSTED", "UNAVAILABLE")):
                reason = f"UNHEALTHY_{m.get('health_status')}"
            else:
                ok, state = self.breaker.can_use(m["id"])
                if not ok:
                    reason = f"CIRCUIT_{state}"
            if reason:
                excluded.append({"model": m.get("name", m["id"]), "reason": reason})
            else:
                eligible.append(m)
        return eligible, excluded

    # --------------------------------------------------------------- ordering
    def order(self, models: list, strategy: str) -> tuple[list, str]:
        if strategy == "AUTO":
            strategy = "PRIORITY"
        if strategy == "PRIORITY" or strategy not in STRATEGIES:
            ordered = sorted(models, key=lambda m: (-m.get("priority", 0), m.get("name", "")))
            return ordered, "PRIORITY"
        if strategy == "WEIGHTED":
            # Deterministic weighted interleave by priority share (no RNG in Phase 2).
            total = sum(max(m.get("priority", 0), 0) for m in models) or 1
            ordered = sorted(models, key=lambda m: (-max(m.get("priority", 0), 0) / total, m.get("name", "")))
            return ordered, "WEIGHTED"
        if strategy == "FASTEST":
            ordered = sorted(models, key=lambda m: (m.get("avg_latency_ms", 10**9), -m.get("priority", 0)))
            return ordered, "FASTEST"
        if strategy == "CHEAPEST":
            ordered = sorted(models, key=lambda m: (_COST_RANK.get(m.get("cost_class", "UNKNOWN"), 9), -m.get("priority", 0)))
            return ordered, "CHEAPEST"
        return list(models), strategy

    # ---------------------------------------------------------------- execute
    def route(self, models: list, providers: dict, secrets: dict,
              credentials_exist: set[str], inp: RouteInput, request_id: str) -> RouteResult:
        started_all = time.monotonic()
        eligible, excluded = self.eligible(models, credentials_exist, inp)
        if not eligible:
            if not excluded:
                return RouteResult(ok=False, error_code="MODEL_UNAVAILABLE",
                                   error_message="No models registered.", attempts=[])
            reasons = {e["reason"] for e in excluded}
            if reasons <= {"PAID_MODEL_BLOCKED"} or "PAID_MODEL_BLOCKED" in reasons and inp.manual_model_id:
                return RouteResult(ok=False, error_code="PAID_MODEL_BLOCKED",
                                   error_message="Paid model blocked by policy.", attempts=[])
            if "LICENSE_BLOCKED" in reasons:
                return RouteResult(ok=False, error_code="LICENSE_BLOCKED",
                                   error_message="License policy blocked all models.", attempts=[])
            if "CREDENTIAL_MISSING" in reasons and len(excluded) == len(models):
                return RouteResult(ok=False, error_code="CREDENTIAL_MISSING",
                                   error_message="No model has a configured credential.", attempts=[])
            return RouteResult(ok=False, error_code="MODEL_UNAVAILABLE",
                               error_message="No eligible model.", attempts=[])

        ordered, resolved = self.order(eligible, inp.strategy)
        result = RouteResult(ok=False, strategy_resolved=resolved)
        budget = max(1, min(inp.max_attempts, len(ordered)))
        for i, m in enumerate(ordered[:budget]):
            provider = providers.get(m["provider_id"], {})
            secret = secrets.get(m.get("credential_ref", ""), "")
            attempt_no = i + 1
            try:
                adapter = get_adapter(_Obj(provider), provider.get("base_url", ""))
            except ValueError:
                last = i == budget - 1
                result.attempts.append(AttemptTrace(attempt_no, provider.get("name", "?"),
                                                   m.get("name", "?"), "FAILED",
                                                   "MODEL_UNAVAILABLE",
                                                   "" if last else "fallback: no adapter"))
                result.error_code = "MODEL_UNAVAILABLE"
                result.error_message = "No adapter for provider."
                continue
            t0 = time.monotonic()
            res = adapter.generate(AdapterRequest(task=inp.task, capability=inp.capability,
                                                  prompt=inp.prompt, model_id=m.get("model_id", ""),
                                                  timeout_s=inp.timeout_s), secret)
            result.network_calls += 0 if res.mock and provider.get("adapter_key") == "test" else 1
            latency = res.latency_ms or int((time.monotonic() - t0) * 1000)
            if res.ok:
                self.breaker.record_success(m["id"])
                result.attempts.append(AttemptTrace(attempt_no, provider.get("name", "?"),
                                                   m.get("name", "?"), "SUCCESS", latency_ms=latency))
                result.ok = True
                result.output = res.output
                result.error_code = "SUCCESS"
                return result
            self.breaker.record_failure(m["id"])
            retryable = res.error_code in RETRYABLE and res.error_code not in NON_RETRYABLE
            reason = "" if i == budget - 1 else ("fallback" if retryable else "terminal; no fallback")
            result.attempts.append(AttemptTrace(attempt_no, provider.get("name", "?"),
                                               m.get("name", "?"), "FAILED", res.error_code,
                                               reason, latency))
            result.error_code = res.error_code
            result.error_message = res.error_message
            if not retryable:
                break
        return result


    # ---------------------------------------------------------- media routing
    def route_media(self, kind: str, models: list, providers: dict, secrets: dict,
                    credentials_exist: set[str], inp: RouteInput,
                    request_id: str) -> RouteResult:
        """Same gates as route(), but executes adapter.generate_media(kind).

        Policy blocks happen pre-network identically; media bytes are validated
        by the caller (pipeline), never trusted from the adapter.
        """
        eligible, excluded = self.eligible(models, credentials_exist, inp)
        if not eligible:
            if not excluded:
                return RouteResult(ok=False, error_code="MODEL_UNAVAILABLE",
                                   error_message="No models registered.", attempts=[])
            reasons = {e["reason"] for e in excluded}
            if "PAID_MODEL_BLOCKED" in reasons and len(reasons) == 1:
                return RouteResult(ok=False, error_code="PAID_MODEL_BLOCKED",
                                   error_message="Paid model blocked by policy.", attempts=[])
            if "LICENSE_BLOCKED" in reasons:
                return RouteResult(ok=False, error_code="LICENSE_BLOCKED",
                                   error_message="License policy blocked all models.", attempts=[])
            return RouteResult(ok=False, error_code="MODEL_UNAVAILABLE",
                               error_message="No eligible model.", attempts=[])

        ordered, resolved = self.order(eligible, inp.strategy)
        result = RouteResult(ok=False, strategy_resolved=resolved)
        budget = max(1, min(inp.max_attempts, len(ordered)))
        for i, m in enumerate(ordered[:budget]):
            provider = providers.get(m["provider_id"], {})
            secret = secrets.get(m.get("credential_ref", ""), "")
            attempt_no = i + 1
            try:
                adapter = get_adapter(_Obj(provider), provider.get("base_url", ""))
            except ValueError:
                last = i == budget - 1
                result.attempts.append(AttemptTrace(attempt_no, provider.get("name", "?"),
                                                   m.get("name", "?"), "FAILED",
                                                   "MODEL_UNAVAILABLE",
                                                   "" if last else "fallback: no adapter"))
                result.error_code = "MODEL_UNAVAILABLE"
                result.error_message = "No adapter for provider."
                continue
            t0 = time.monotonic()
            res = adapter.generate_media(kind, AdapterRequest(
                task=inp.task, capability=inp.capability, prompt=inp.prompt,
                model_id=m.get("model_id", ""), timeout_s=inp.timeout_s), secret)
            result.network_calls += 0 if res.mock and provider.get("adapter_key") == "test" else 1
            latency = res.latency_ms or int((time.monotonic() - t0) * 1000)
            if res.ok:
                self.breaker.record_success(m["id"])
                result.attempts.append(AttemptTrace(attempt_no, provider.get("name", "?"),
                                                   m.get("name", "?"), "SUCCESS", latency_ms=latency))
                result.ok = True
                result.output = res.output
                result.error_code = "SUCCESS"
                return result
            self.breaker.record_failure(m["id"])
            retryable = res.error_code in RETRYABLE and res.error_code not in NON_RETRYABLE
            reason = "" if i == budget - 1 else ("fallback" if retryable else "terminal; no fallback")
            result.attempts.append(AttemptTrace(attempt_no, provider.get("name", "?"),
                                               m.get("name", "?"), "FAILED", res.error_code,
                                               reason, latency))
            result.error_code = res.error_code
            result.error_message = res.error_message
            if not retryable:
                break
        return result


class _Obj:
    def __init__(self, d: dict):
        self.__dict__.update(d)
