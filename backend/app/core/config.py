"""App settings. stdlib-only (no extra settings dep)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


@dataclass(frozen=True)
class Settings:
    app_name: str = "AI Short Factory Web Pro"
    api_prefix: str = "/api/v1"
    # SQLite file lives under backend/ by default; overridable for tests.
    database_url: str = field(default_factory=lambda: _env("DATABASE_URL", "sqlite:///./studiofactory.db"))
    projects_root: str = field(default_factory=lambda: _env("PROJECTS_ROOT", "./projects"))
    credential_master_key: str = field(default_factory=lambda: _env("CREDENTIAL_MASTER_KEY", ""))
    credential_key_file: str = field(default_factory=lambda: _env("CREDENTIAL_KEY_FILE", "./.credential_master.key"))
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    environment: str = field(default_factory=lambda: _env("APP_ENV", "development"))


settings = Settings()
