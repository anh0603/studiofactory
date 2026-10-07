"""User settings: export folder on this machine, theme preference passthrough.

Local-first: the backend runs on the same PC, so it can copy finished
exports to a folder the user picks in Settings. The browser sandbox cannot
do that — the copy happens server-side with strict validation.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.errors import error_body  # noqa: F401  (keeps error contract import surface stable)
from ...core.exceptions import AppError
from ...db import models as M
from ...db.session import get_db

router = APIRouter(prefix="/settings")

EXPORT_DIR_KEY = "export_dir"


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "req_unknown")


def _system_dirs() -> list[Path]:
    import os
    import sys
    bad: list[Path] = []
    if sys.platform == "win32":
        windir = os.environ.get("SystemRoot", r"C:\Windows")
        bad += [Path(windir), Path(windir) / "System32"]
    else:
        bad += [Path("/etc"), Path("/sys"), Path("/proc"), Path("/root")]
    return [p for p in bad]


def resolve_export_dir(raw: str) -> Path:
    """Validate a user-picked export folder. Raises AppError on rejection."""
    text = (raw or "").strip()
    if not text:
        raise AppError("VALIDATION_FAILED", "Export folder must not be empty.", 422)
    if "\x00" in text:
        raise AppError("VALIDATION_FAILED", "Export folder contains invalid characters.", 422)
    p = Path(text).expanduser()
    if not p.is_absolute():
        raise AppError("VALIDATION_FAILED", "Export folder must be an absolute path.", 422)
    try:
        resolved = p.resolve()
    except Exception:  # noqa: BLE001
        raise AppError("VALIDATION_FAILED", "Export folder cannot be resolved.", 422)
    for bad in _system_dirs():
        try:
            if resolved == bad or bad in resolved.parents:
                raise AppError("VALIDATION_FAILED", "System folders cannot be used for export.", 422)
        except OSError:
            pass
    try:
        resolved.mkdir(parents=True, exist_ok=True)
    except Exception:  # noqa: BLE001
        raise AppError("VALIDATION_FAILED", "Export folder cannot be created.", 422)
    probe = resolved / ".write_probe"
    try:
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        raise AppError("VALIDATION_FAILED", "Export folder is not writable.", 422)
    return resolved


def get_export_dir(db: Session) -> Path | None:
    row = db.get(M.Setting, EXPORT_DIR_KEY)
    if row is None:
        return None
    path = ((row.value_json or {}).get("path") or "").strip()
    if not path:
        return None
    try:
        resolved = Path(path).expanduser().resolve()
    except Exception:  # noqa: BLE001
        return None
    if not resolved.is_dir():
        return None
    return resolved


def export_dir_state(db: Session) -> dict:
    row = db.get(M.Setting, EXPORT_DIR_KEY)
    path = ((row.value_json or {}).get("path") or "").strip() if row else ""
    if not path:
        return {"export_dir": None, "export_dir_state": "UNSET"}
    try:
        resolved = Path(path).expanduser().resolve()
    except Exception:  # noqa: BLE001
        return {"export_dir": path, "export_dir_state": "INVALID"}
    if not resolved.is_dir():
        return {"export_dir": path, "export_dir_state": "MISSING"}
    import os
    if not os.access(resolved, os.W_OK):
        return {"export_dir": path, "export_dir_state": "NOT_WRITABLE"}
    return {"export_dir": str(resolved), "export_dir_state": "OK"}


def copy_to_export_dir(db: Session, items: list[tuple[Path, str]]) -> dict:
    """Copy finished files to the user's export folder. Never raises for
    copy problems — returns (saved_to, saved_files, save_error) honestly."""
    dest = get_export_dir(db)
    if dest is None:
        return {"saved_to": None, "saved_files": [], "save_error": None}
    saved: list[str] = []
    try:
        for src, name in items:
            safe = Path(name).name
            if not safe or safe in (".", ".."):
                continue
            shutil.copy2(src, dest / safe)
            saved.append(safe)
    except Exception as exc:  # noqa: BLE001
        return {"saved_to": str(dest), "saved_files": saved,
                "save_error": f"Could not copy to export folder: {type(exc).__name__}"}
    return {"saved_to": str(dest), "saved_files": saved, "save_error": None}


class ExportDirIn(BaseModel):
    export_dir: str = Field(min_length=1, max_length=1024)


@router.get("")
def get_settings(request: Request, db: Session = Depends(get_db)) -> dict:
    return {"request_id": _rid(request), "data": export_dir_state(db)}


@router.put("", status_code=200)
def put_settings(body: ExportDirIn, request: Request, db: Session = Depends(get_db)) -> dict:
    resolved = resolve_export_dir(body.export_dir)
    row = db.get(M.Setting, EXPORT_DIR_KEY)
    if row is None:
        row = M.Setting(key=EXPORT_DIR_KEY, value_json={"path": str(resolved)})
        db.add(row)
    else:
        row.value_json = {"path": str(resolved)}
    db.commit()
    return {"request_id": _rid(request), "data": export_dir_state(db)}


@router.delete("/export-dir", status_code=200)
def clear_export_dir(request: Request, db: Session = Depends(get_db)) -> dict:
    row = db.get(M.Setting, EXPORT_DIR_KEY)
    if row is not None:
        db.delete(row)
        db.commit()
    return {"request_id": _rid(request), "data": export_dir_state(db)}
