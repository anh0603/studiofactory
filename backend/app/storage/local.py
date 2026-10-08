"""Local storage abstraction with path-jail protection."""
from __future__ import annotations

from pathlib import Path

SUBDIRS = (
    "assets",
    "characters",
    "scenes",
    "audio",
    "subtitles",
    "renders",
    "exports",
    "provenance",
    "logs",
)

PROJECT_ID_SAFE = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")


class PathJailError(ValueError):
    pass


def _check_project_id(project_id: str) -> None:
    if not project_id or any(c not in PROJECT_ID_SAFE for c in project_id):
        raise PathJailError("invalid project_id")


class LocalStorage:
    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        # Affiliate factory uses a sibling jail: <root>/../affiliate.
        self.affiliate_root = (self.root.parent / "affiliate").resolve()

    def project_dir(self, project_id: str) -> Path:
        _check_project_id(project_id)
        path = (self.root / project_id).resolve()
        if path != self.root / project_id or self.root not in path.parents:
            raise PathJailError("project path escapes jail")
        return path

    def ensure_project(self, project_id: str) -> Path:
        base = self.project_dir(project_id)
        for sub in SUBDIRS:
            (base / sub).mkdir(parents=True, exist_ok=True)
        return base

    def resolve(self, project_id: str, *parts: str) -> Path:
        """Resolve a path inside the project jail. Rejects .., absolute, escapes."""
        _check_project_id(project_id)
        if any(Path(p).is_absolute() for p in parts):
            raise PathJailError("absolute path not allowed")
        base = self.project_dir(project_id)
        candidate = (base.joinpath(*parts)).resolve()
        if candidate != base and base not in candidate.parents:
            raise PathJailError("path escapes project jail")
        return candidate

    def health(self) -> dict:
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            probe = self.root / ".write_probe"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
            return {"status": "HEALTHY", "root": str(self.root)}
        except Exception as exc:  # noqa: BLE001 - report, don't crash diagnostics
            return {"status": "UNAVAILABLE", "root": str(self.root), "reason": type(exc).__name__}

    # ------------------------------------------------------- affiliate jail
    def affiliate_dir(self, product_id: str) -> Path:
        _check_project_id(product_id)  # same safe charset
        path = (self.affiliate_root / product_id).resolve()
        if path != self.affiliate_root / product_id or self.affiliate_root not in path.parents:
            raise PathJailError("affiliate path escapes jail")
        return path

    def ensure_affiliate(self, product_id: str) -> Path:
        base = self.affiliate_dir(product_id)
        for sub in ("images", "visuals", "videos", "exports", "logs"):
            (base / sub).mkdir(parents=True, exist_ok=True)
        return base

    def resolve_affiliate(self, product_id: str, *parts: str) -> Path:
        _check_project_id(product_id)
        if any(Path(p).is_absolute() for p in parts):
            raise PathJailError("absolute path not allowed")
        base = self.affiliate_dir(product_id)
        candidate = (base.joinpath(*parts)).resolve()
        if candidate != base and base not in candidate.parents:
            raise PathJailError("path escapes affiliate jail")
        return candidate
