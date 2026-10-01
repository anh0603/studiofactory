"""CredentialStore interface + Fernet file-backed implementation.

Decision (Phase 1): Fernet (`cryptography`) with a 32-byte master key from
`CREDENTIAL_MASTER_KEY` env or a local key file `./.credential_master.key`
(created once, file-only). No secret ever leaves via API/log/manifest.
"""
from __future__ import annotations

import base64
import hashlib
import os
import secrets
from abc import ABC, abstractmethod
from pathlib import Path


class CredentialStore(ABC):
    @abstractmethod
    def save(self, ref: str, secret: str) -> None: ...
    @abstractmethod
    def get(self, ref: str) -> str: ...
    @abstractmethod
    def delete(self, ref: str) -> None: ...
    @abstractmethod
    def exists(self, ref: str) -> bool: ...
    @abstractmethod
    def metadata(self, ref: str) -> dict: ...


def fingerprint(secret: str) -> str:
    digest = hashlib.sha256(secret.encode("utf-8")).hexdigest()
    return f"sha256:{digest[:16]}:last4:{secret[-4:] if len(secret) >= 4 else '****'}"


class FernetCredentialStore(CredentialStore):
    """Encrypted store. Secrets kept in memory-mapped dict + persisted ciphertext file."""

    def __init__(self, master_key_b64: str = "", key_file: str = "./.credential_master.key",
                 data_file: str = "./.credentials.enc"):
        from cryptography.fernet import Fernet

        key = self._resolve_key(master_key_b64, key_file)
        self._fernet = Fernet(key)
        self._data_file = Path(data_file)
        self._items: dict[str, str] = {}
        if self._data_file.exists():
            for line in self._data_file.read_text(encoding="utf-8").splitlines():
                if ":" in line:
                    ref, token = line.split(":", 1)
                    self._items[ref.strip()] = token.strip()

    @staticmethod
    def _resolve_key(master_key_b64: str, key_file: str) -> bytes:
        from cryptography.fernet import Fernet

        if master_key_b64:
            return master_key_b64.encode()
        path = Path(key_file)
        if path.exists():
            return path.read_bytes().strip()
        key = Fernet.generate_key()
        path.write_bytes(key)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        return key

    def _persist(self) -> None:
        self._data_file.write_text(
            "\n".join(f"{k}:{v}" for k, v in self._items.items()), encoding="utf-8"
        )

    def save(self, ref: str, secret: str) -> None:
        if not ref or not secret:
            raise ValueError("ref and secret required")
        token = self._fernet.encrypt(secret.encode("utf-8")).decode("utf-8")
        self._items[ref] = token
        self._persist()

    def get(self, ref: str) -> str:
        token = self._items.get(ref)
        if token is None:
            raise KeyError(ref)
        return self._fernet.decrypt(token.encode("utf-8")).decode("utf-8")

    def delete(self, ref: str) -> None:
        self._items.pop(ref, None)
        self._persist()

    def exists(self, ref: str) -> bool:
        return ref in self._items

    def metadata(self, ref: str) -> dict:
        # Never include secret or full fingerprint hash.
        if ref not in self._items:
            raise KeyError(ref)
        return {"configured": True, "ref": ref}


def masked() -> dict:
    return {"configured": True, "value": "sk-****"}
