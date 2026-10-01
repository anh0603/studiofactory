"""Media byte validation. Only real, parseable artifacts are accepted."""
from __future__ import annotations

import base64
import struct
import urllib.request

MAX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_AUDIO_BYTES = 50 * 1024 * 1024
MAX_VIDEO_BYTES = 500 * 1024 * 1024


class MediaInvalid(ValueError):
    pass


def decode_payload(output: str, timeout_s: float = 30.0) -> tuple[bytes, str]:
    """Accept data: URLs or http(s) URLs. Returns (bytes, declared_mime)."""
    if output.startswith("data:"):
        header, _, b64 = output.partition(",")
        mime = header[5:].split(";")[0] or "application/octet-stream"
        try:
            return base64.b64decode(b64, validate=True), mime
        except Exception:
            raise MediaInvalid("invalid base64 payload")
    if output.startswith(("http://", "https://")):
        req = urllib.request.Request(output, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                return resp.read(), resp.headers.get_content_type()
        except Exception as exc:  # noqa: BLE001
            raise MediaInvalid(f"download failed: {type(exc).__name__}")
    raise MediaInvalid("media payload must be data: or http(s) URL")


def validate_image(data: bytes) -> tuple[str, int, int]:
    if len(data) > MAX_IMAGE_BYTES or not data:
        raise MediaInvalid("image size out of range")
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        w = h = 0
        if len(data) >= 33:
            w, h = struct.unpack(">II", data[16:24])
        # Structural check: truncated PNGs hang decoders (image -loop retries
        # forever). Require at least one IDAT chunk and the IEND trailer.
        if b"IDAT" not in data or b"IEND\xae\x42\x60\x82" not in data[-12:]:
            raise MediaInvalid("truncated png (missing IDAT/IEND)")
        return "image/png", w, h
    if data[:2] == b"\xff\xd8":
        if not data.rstrip().endswith(b"\xff\xd9"):
            raise MediaInvalid("truncated jpeg (missing EOI)")
        return "image/jpeg", 0, 0
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", 0, 0
    raise MediaInvalid("bytes are not a supported image (png/jpeg/webp)")


def validate_audio(data: bytes) -> tuple[str, float]:
    if len(data) > MAX_AUDIO_BYTES or not data:
        raise MediaInvalid("audio size out of range")
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        try:
            # Minimal WAV parse: find fmt chunk.
            audio_fmt, channels, rate = struct.unpack("<HHI", data[20:28])
            bits = struct.unpack("<H", data[34:36])[0]
            data_len = struct.unpack("<I", data[40:44])[0]
            duration = data_len / max(rate * channels * (bits // 8), 1)
            return "audio/wav", duration
        except Exception:
            raise MediaInvalid("malformed wav header")
    if data[:3] == b"ID3" or data[:2] == b"\xff\xfb":
        return "audio/mpeg", 0.0  # duration unknown without full parse
    raise MediaInvalid("bytes are not supported audio (wav/mp3)")


def validate_video(data: bytes) -> tuple[str, int]:
    if len(data) > MAX_VIDEO_BYTES or not data:
        raise MediaInvalid("video size out of range")
    if len(data) > 12 and data[4:8] == b"ftyp":
        return "video/mp4", len(data)
    raise MediaInvalid("bytes are not a supported video (mp4)")


def build_srt(cues: list[tuple[float, float, str]]) -> str:
    """cues: (start_s, end_s, text). Validates ordering and non-emptiness."""
    if not cues:
        raise MediaInvalid("no subtitle cues")
    lines = []
    prev_end = -1.0
    for i, (start, end, text) in enumerate(cues, 1):
        if end <= start or start < prev_end or not text.strip():
            raise MediaInvalid(f"invalid cue #{i}")
        prev_end = end
        lines.append(f"{i}\n{_ts(start)} --> {_ts(end)}\n{text.strip()}\n")
    return "\n".join(lines)


def _ts(s: float) -> str:
    ms = int(s * 1000)
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    sec, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{sec:02},{ms:03}"
