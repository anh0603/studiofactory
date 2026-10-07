"""Provider adapters. Router only speaks this interface — never raw HTTP.

Adapter kinds:
- `test`: controlled in-process adapter for unit/integration tests ONLY.
  Results are labeled mock=true and never count as live verification.
- `openai_compatible`: real HTTPS adapter (OpenRouter/OpenAI/Together/Groq/
  custom OpenAI-compatible). Used only when a user credential exists.
- `pollinations`: real HTTPS adapter for the keyless pollinations.ai free
  image tier (flux-based). No secret. Models using it must be registered
  with metadata {"keyless": true} so the router skips the credential gate.
"""
from __future__ import annotations

import ipaddress
import time
import urllib.request
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from urllib.parse import urlparse


@dataclass
class AdapterRequest:
    task: str
    capability: str
    prompt: str = ""
    model_id: str = ""
    timeout_s: float = 20.0


@dataclass
class AdapterResult:
    ok: bool
    output: str = ""
    error_code: str = "SUCCESS"
    error_message: str = ""
    latency_ms: int = 0
    mock: bool = False


class ProviderAdapter(ABC):
    @abstractmethod
    def generate(self, request: AdapterRequest, secret: str) -> AdapterResult: ...

    @abstractmethod
    def test_capability(self, capability: str, model_id: str, secret: str) -> dict: ...

    def generate_media(self, kind: str, request: AdapterRequest,
                       secret: str) -> AdapterResult:
        """Binary media (IMAGE/VIDEO/TTS). Default: unsupported — never fake bytes."""
        return AdapterResult(ok=False, error_code="CAPABILITY_UNSUPPORTED",
                             error_message=f"adapter lacks {kind} support")

    def health(self) -> dict:
        return {"status": "UNKNOWN"}

    @staticmethod
    def classify_http(status: int, body: str = "") -> str:
        if status == 400:
            return "BAD_REQUEST"
        if status == 401:
            return "AUTH_FAILED"
        if status == 403:
            return "PERMISSION_DENIED"
        if status == 404:
            return "MODEL_UNAVAILABLE"
        if status == 429:
            low = body.lower()
            if "quota" in low or "exceed" in low:
                return "QUOTA_EXHAUSTED"
            return "RATE_LIMITED"
        if status == 402:
            # Free/anonymous tiers (pollinations) answer 402 when the shared
            # quota is exhausted. Retryable: another window may serve. Phase C.
            return "QUOTA_EXHAUSTED"
        if status == 408:
            return "TIMEOUT"
        if 500 <= status <= 599:
            return "PROVIDER_UNAVAILABLE"
        return "UNKNOWN_ERROR"


# ---------------------------------------------------------------- SSRF guard

_BLOCKED_HOSTS = ("metadata.google.internal",)
_BLOCKED_SUFFIXES = (".local", ".internal", ".localhost")
# Literal hostnames that always resolve to loopback.
_LOOPBACK_HOSTS = ("localhost",)


def validate_provider_url(base_url: str) -> str:
    """Allow public hosts plus operator-configured loopback gateways.

    Local-first product (project.md #3): the operator pastes the provider URL
    themselves, so 127.0.0.0/8, ::1 and the literal "localhost" are trusted
    (local LLM gateways: Ollama, LM Studio, FreeLLMAPI, ...). Cloud metadata
    endpoints, .local/.internal names and non-loopback private/LAN IPs stay
    blocked. Raises ValueError otherwise.
    """
    parsed = urlparse(base_url)
    if parsed.scheme not in ("https", "http"):
        raise ValueError("provider URL must be http(s)")
    host = (parsed.hostname or "").lower()
    if not host:
        raise ValueError("provider URL needs a host")
    if host in _BLOCKED_HOSTS or host.endswith(_BLOCKED_SUFFIXES):
        raise ValueError("provider host not allowed")
    if host in _LOOPBACK_HOSTS:
        return base_url.rstrip("/")
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_loopback:
            return base_url.rstrip("/")
        if ip.is_private or ip.is_link_local or ip.is_reserved:
            raise ValueError("provider IP not allowed")
    except ValueError as exc:
        # hostname (not IP): block metadata + resolve-time check happens per-request
        if "provider IP not allowed" in str(exc) or "provider host" in str(exc):
            raise
    if host == "169.254.169.254":
        raise ValueError("provider host not allowed")
    if not parsed.path and not base_url.endswith("/"):
        base_url = base_url + "/"
    return base_url.rstrip("/")


# ------------------------------------------------------- test adapter (mock)

class TestAdapter(ProviderAdapter):
    """Scripted in-process adapter for tests. mock=True always."""

    def __init__(self) -> None:
        self.calls: list[AdapterRequest] = []
        self.script: list[tuple[bool, str, str]] = []  # (ok, output|message, error_code)

    def queue(self, ok: bool, output_or_message: str = "", error_code: str = "SUCCESS") -> None:
        self.script.append((ok, output_or_message, error_code))

    def generate(self, request: AdapterRequest, secret: str) -> AdapterResult:
        self.calls.append(request)
        if self.script:
            ok, text, code = self.script.pop(0)
        else:
            ok, text, code = True, f"test-output:{request.prompt[:32]}", "SUCCESS"
        return AdapterResult(ok=ok, output=text if ok else "",
                             error_code="SUCCESS" if ok else code,
                             error_message="" if ok else text,
                             latency_ms=1, mock=True)

    def test_capability(self, capability: str, model_id: str, secret: str) -> dict:
        return {"state": "CAPABILITY_VERIFIED", "capability": capability,
                "checks": {"reachable": True, "authenticated": True}, "mock": True}

    # ------------------------------------------------- scripted media (mock)
    def queue_media(self, ok: bool, payload_or_message: str = "",
                    error_code: str = "SUCCESS") -> None:
        self.script.append((ok, f"media:{payload_or_message}", error_code))

    def generate_media(self, kind: str, request: AdapterRequest,
                       secret: str) -> AdapterResult:
        self.calls.append(request)
        if self.script:
            ok, text, code = self.script.pop(0)
            payload = text[len("media:"):] if text.startswith("media:") else text
        else:
            ok, payload, code = True, "", "SUCCESS"
        return AdapterResult(ok=ok, output=payload if ok else "",
                             error_code="SUCCESS" if ok else code,
                             error_message="" if ok else payload,
                             latency_ms=1, mock=True)


# ------------------------------------------------- openai-compatible adapter

class OpenAICompatibleAdapter(ProviderAdapter):
    def __init__(self, base_url: str):
        self.base_url = validate_provider_url(base_url)

    def _headers(self, secret: str) -> dict:
        return {"Authorization": f"Bearer {secret}", "Content-Type": "application/json"}

    def generate(self, request: AdapterRequest, secret: str) -> AdapterResult:
        import json as _json

        started = time.monotonic()
        body = _json.dumps({
            "model": request.model_id,
            "messages": [{"role": "user", "content": request.prompt}],
            # Structured outputs (Director Plan JSON) need headroom; a low cap
            # truncates them mid-JSON into INVALID_RESPONSE. Vietnamese output
            # is token-hungry, so allow up to 8k. Phase B.
            "max_tokens": 8192,
        }).encode()
        req = urllib.request.Request(
            self.base_url + "/chat/completions", data=body,
            headers=self._headers(secret), method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=request.timeout_s) as resp:
                data = _json.loads(resp.read().decode())
                text = data["choices"][0]["message"].get("content") or ""
                if not text.strip():
                    return AdapterResult(ok=False, error_code="INVALID_RESPONSE",
                                         error_message="provider returned empty content",
                                         latency_ms=int((time.monotonic() - started) * 1000))
                return AdapterResult(ok=True, output=text,
                                     latency_ms=int((time.monotonic() - started) * 1000))
        except urllib.error.HTTPError as exc:  # type: ignore[attr-defined]
            import urllib.error as _e
            assert isinstance(exc, _e.HTTPError)
            payload = exc.read().decode(errors="replace")[:500]
            code = self.classify_http(exc.code, payload)
            return AdapterResult(ok=False, error_code=code, error_message=f"HTTP {exc.code}",
                                 latency_ms=int((time.monotonic() - started) * 1000))
        except TimeoutError:
            return AdapterResult(ok=False, error_code="TIMEOUT", error_message="timeout")
        except Exception as exc:  # noqa: BLE001
            return AdapterResult(ok=False, error_code="NETWORK_ERROR",
                                 error_message=type(exc).__name__)

    def test_capability(self, capability: str, model_id: str, secret: str) -> dict:
        """Three-step verification: reachable → authenticated → capability match.

        A bare model list is NEVER capability proof.
        """
        import json as _json

        # Step 1: reachable?
        try:
            req = urllib.request.Request(self.base_url + "/models",
                                         headers=self._headers(secret), method="GET")
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = _json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:  # type: ignore[attr-defined]
            import urllib.error as _e
            assert isinstance(exc, _e.HTTPError)
            if exc.code in (401, 403):
                return {"state": "FAILED", "capability": capability,
                        "checks": {"reachable": True, "authenticated": False},
                        "error": "AUTH_FAILED", "mock": False}
            return {"state": "FAILED", "capability": capability,
                    "checks": {"reachable": True, "authenticated": False},
                    "error": self.classify_http(exc.code), "mock": False}
        except Exception:  # noqa: BLE001
            return {"state": "FAILED", "capability": capability,
                    "checks": {"reachable": False, "authenticated": False},
                    "error": "NETWORK_ERROR", "mock": False}

        # Step 2: model listed?
        ids = [m.get("id") for m in data.get("data", [])] if isinstance(data, dict) else []
        if model_id and ids and model_id not in ids:
            return {"state": "AUTHENTICATED", "capability": capability,
                    "checks": {"reachable": True, "authenticated": True,
                               "model_listed": False},
                    "note": "model list reachable; generation NOT verified", "mock": False}
        # Step 3: only a minimal generation proves capability. We do NOT run it
        # implicitly here — caller must opt in via verify_generation=true.
        return {"state": "AUTHENTICATED", "capability": capability,
                "checks": {"reachable": True, "authenticated": True},
                "note": "list-only; generation NOT verified", "mock": False}

    # ------------------------------------------------ real media (OpenAI API)
    def generate_media(self, kind: str, request: AdapterRequest,
                       secret: str) -> AdapterResult:
        import json as _json

        started = time.monotonic()
        try:
            if kind == "IMAGE":
                body = _json.dumps({"model": request.model_id, "prompt": request.prompt,
                                    "n": 1, "response_format": "b64_json"}).encode()
                data = self._post("/images/generations", body, secret, request.timeout_s)
                b64 = data["data"][0]["b64_json"]
                return AdapterResult(ok=True, output=f"data:image/png;base64,{b64}",
                                     latency_ms=int((time.monotonic() - started) * 1000))
            if kind == "TTS":
                tts_body: dict = {"model": request.model_id, "input": request.prompt,
                                  "response_format": "wav"}
                # OpenAI voices (alloy, …) are rejected by other providers
                # (e.g. Google Gemini TTS needs its own voice names). Only send
                # an explicit voice for OpenAI tts-* models; otherwise let the
                # gateway pick its default. Phase B8.
                if (request.model_id or "").startswith("tts-"):
                    tts_body["voice"] = "alloy"
                body = _json.dumps(tts_body).encode()
                raw = self._post_bytes("/audio/speech", body, secret, request.timeout_s)
                import base64 as _b64
                return AdapterResult(
                    ok=True,
                    output="data:audio/wav;base64," + _b64.b64encode(raw).decode(),
                    latency_ms=int((time.monotonic() - started) * 1000))
        except _AdapterHTTPError as exc:
            return AdapterResult(ok=False, error_code=self.classify_http(exc.status, exc.body),
                                 error_message=f"HTTP {exc.status}",
                                 latency_ms=int((time.monotonic() - started) * 1000))
        except TimeoutError:
            return AdapterResult(ok=False, error_code="TIMEOUT", error_message="timeout")
        except Exception as exc:  # noqa: BLE001
            return AdapterResult(ok=False, error_code="NETWORK_ERROR",
                                 error_message=type(exc).__name__)
        return AdapterResult(ok=False, error_code="CAPABILITY_UNSUPPORTED",
                             error_message=f"{kind} not supported by OpenAI adapter")

    def _post(self, path: str, body: bytes, secret: str, timeout_s: float) -> dict:
        import json as _json
        req = urllib.request.Request(self.base_url + path, data=body,
                                     headers=self._headers(secret), method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                return _json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:  # type: ignore[attr-defined]
            import urllib.error as _e
            assert isinstance(exc, _e.HTTPError)
            raise _AdapterHTTPError(exc.code, exc.read().decode(errors="replace")[:500])

    def _post_bytes(self, path: str, body: bytes, secret: str, timeout_s: float) -> bytes:
        req = urllib.request.Request(self.base_url + path, data=body,
                                     headers=self._headers(secret), method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:  # type: ignore[attr-defined]
            import urllib.error as _e
            assert isinstance(exc, _e.HTTPError)
            raise _AdapterHTTPError(exc.code, exc.read().decode(errors="replace")[:500])


class _AdapterHTTPError(Exception):
    def __init__(self, status: int, body: str):
        super().__init__(f"HTTP {status}")
        self.status = status
        self.body = body


# ------------------------------------------- pollinations (keyless free image)

class PollinationsAdapter(ProviderAdapter):
    """Real image generation via the keyless pollinations.ai free tier.

    No secret is used (anonymous free API, flux-based). Bytes are returned
    as a data: URI; the media pipeline validates magic bytes/dimensions,
    never trusting the adapter. TEXT/TTS/VIDEO report CAPABILITY_UNSUPPORTED.
    """

    DEFAULT_BASE = "https://image.pollinations.ai"

    def __init__(self, base_url: str = ""):
        self.base_url = (base_url or self.DEFAULT_BASE).rstrip("/")

    def generate(self, request: AdapterRequest, secret: str) -> AdapterResult:
        return AdapterResult(ok=False, error_code="CAPABILITY_UNSUPPORTED",
                             error_message="pollinations adapter serves IMAGE only")

    def test_capability(self, capability: str, model_id: str, secret: str) -> dict:
        if capability != "IMAGE":
            return {"state": "FAILED", "capability": capability,
                    "checks": {"reachable": True, "authenticated": True,
                               "capability_match": False},
                    "note": "pollinations serves IMAGE only", "mock": False}
        res = self.generate_media(
            "IMAGE", AdapterRequest(task="TEST", capability="IMAGE",
                                    prompt="small red circle on white",
                                    model_id=model_id, timeout_s=120.0), "")
        if not res.ok:
            return {"state": "FAILED", "capability": capability,
                    "error": res.error_code, "checks": {"reachable": False},
                    "mock": False}
        return {"state": "CAPABILITY_VERIFIED", "capability": capability,
                "checks": {"reachable": True, "authenticated": True,
                           "capability_match": True},
                "note": "real tiny probe image generated", "mock": False}

    def generate_media(self, kind: str, request: AdapterRequest,
                       secret: str) -> AdapterResult:
        import base64 as _b64
        import random as _random
        import urllib.parse as _parse

        started = time.monotonic()
        if kind != "IMAGE":
            return AdapterResult(ok=False, error_code="CAPABILITY_UNSUPPORTED",
                                 error_message=f"pollinations lacks {kind} support")
        prompt = (request.prompt or "").strip()[:1500]
        if not prompt:
            return AdapterResult(ok=False, error_code="BAD_REQUEST",
                                 error_message="empty image prompt")
        url = (f"{self.base_url}/prompt/{_parse.quote(prompt)}"
               f"?width=1024&height=1024&seed={_random.randint(0, 10**9)}"
               f"&model=flux&nologo=true")
        req = urllib.request.Request(url, method="GET",
                                     headers={"Accept": "image/*"})
        try:
            with urllib.request.urlopen(req,
                                        timeout=request.timeout_s) as resp:
                ctype = resp.headers.get_content_type()
                raw = resp.read()
        except urllib.error.HTTPError as exc:  # type: ignore[attr-defined]
            import urllib.error as _e
            assert isinstance(exc, _e.HTTPError)
            return AdapterResult(ok=False,
                                 error_code=self.classify_http(exc.code, ""),
                                 error_message=f"HTTP {exc.code}",
                                 latency_ms=int((time.monotonic() - started) * 1000))
        except TimeoutError:
            return AdapterResult(ok=False, error_code="TIMEOUT",
                                 error_message="timeout")
        except Exception as exc:  # noqa: BLE001
            return AdapterResult(ok=False, error_code="NETWORK_ERROR",
                                 error_message=type(exc).__name__)
        if not ctype.startswith("image/"):
            return AdapterResult(ok=False, error_code="INVALID_RESPONSE",
                                 error_message=f"unexpected content-type: {ctype}")
        if not raw:
            return AdapterResult(ok=False, error_code="INVALID_RESPONSE",
                                 error_message="empty image body")
        return AdapterResult(
            ok=True,
            output="data:" + ctype + ";base64," + _b64.b64encode(raw).decode(),
            latency_ms=int((time.monotonic() - started) * 1000))
        self.body = body


_ADAPTERS: dict[str, ProviderAdapter] = {}


def register_adapter(key: str, adapter: ProviderAdapter) -> None:
    _ADAPTERS[key] = adapter


def get_adapter(provider: object, base_url: str = "") -> ProviderAdapter:
    """Resolve adapter by provider.adapter_key. Unknown → raise, never fake."""
    key = getattr(provider, "adapter_key", "custom")
    if key in _ADAPTERS:
        return _ADAPTERS[key]
    if key == "pollinations":
        return PollinationsAdapter(base_url or PollinationsAdapter.DEFAULT_BASE)
    if key in ("openai_compatible", "openrouter", "openai", "together", "groq", "custom"):
        return OpenAICompatibleAdapter(base_url or "https://api.example.invalid")
    raise ValueError(f"no adapter for key: {key}")
