"""Shared test fixtures: REAL valid media bytes (decodable, never truncated)."""
from __future__ import annotations

import base64
import binascii
import struct
import zlib


def _chunk(ctype: bytes, payload: bytes) -> bytes:
    return (struct.pack(">I", len(payload)) + ctype + payload +
            struct.pack(">I", binascii.crc32(ctype + payload) & 0xFFFFFFFF))


def valid_png_bytes(w: int = 8, h: int = 6) -> bytes:
    row = b"\x00" + b"\x80\x80\x80" * w
    return (b"\x89PNG\r\n\x1a\n"
            + _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + _chunk(b"IDAT", zlib.compress(row * h))
            + _chunk(b"IEND", b""))


def valid_wav_bytes(duration_s: float = 1.0, rate: int = 8000) -> bytes:
    n = int(duration_s * rate)
    return (b"RIFF" + struct.pack("<I", 36 + n) + b"WAVE" + b"fmt " +
            struct.pack("<IHHIIHH", 16, 1, 1, rate, rate, 1, 8) + b"data" +
            struct.pack("<I", n) + b"\x00" * n)


def data_url(mime: str, raw: bytes) -> str:
    return f"data:{mime};base64," + base64.b64encode(raw).decode()
