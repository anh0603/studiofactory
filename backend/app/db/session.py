"""DB session management (SQLite default, PostgreSQL-compatible URL)."""
from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from ..core.config import settings


def _connect_args(url: str) -> dict:
    if url.startswith("sqlite"):
        # check_same_thread: engine worker + autopilot threads share the file.
        # timeout: wait on writer locks instead of failing instantly (Phase C:
        # background autopilot thread + engine worker contend on SQLite).
        return {"check_same_thread": False, "timeout": 30.0}
    return {}


engine = create_engine(settings.database_url, connect_args=_connect_args(settings.database_url), future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
