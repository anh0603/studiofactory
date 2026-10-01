"""Phase 9 tests: real aggregations, empty-honest, no secrets, no invented cost."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.db.base import Base  # noqa: E402
from app.db import models as M  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402


def make_client(tmp_path):
    db_file = tmp_path / "t.db"
    engine = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    TS = sessionmaker(bind=engine, future=True)

    def odb():
        db = TS()
        try:
            yield db
        finally:
            db.close()

    app = create_app()
    app.dependency_overrides[get_db] = odb
    return TestClient(app), TS


def test_empty_analytics_honest(tmp_path):
    client, _ = make_client(tmp_path)
    data = client.get("/api/v1/analytics/overview").json()["data"]
    assert data["production"]["videos"] == 0
    assert data["production"]["jobs_total"] == 0
    assert data["ai"]["requests"] == 0
    assert data["ai"]["cost"] is None and data["ai"]["cost_state"] == "UNKNOWN"
    assert data["publishing"]["confirmed"] == 0
    assert data["affiliate"]["products"] == 0


def test_aggregations_match_stored_rows(tmp_path):
    client, TS = make_client(tmp_path)
    db = TS()
    try:
        db.add(M.Job(id="JOB-1", project_id="p", kind="FULL_PIPELINE",
                     status="SUCCEEDED", idempotency_key="k1"))
        db.add(M.Job(id="JOB-2", project_id="p", kind="FULL_PIPELINE",
                     status="FAILED", idempotency_key="k2"))
        db.add(M.QCResult(id="qc1", job_id="JOB-1", verdict="BLOCKED", checks=[]))
        db.add(M.Artifact(id="a1", job_id="JOB-1", kind="VIDEO", path="renders/final.mp4",
                          sha256="x" * 64, bytes=10, mime="video/mp4",
                          provider="p", model="m", request_id="r"))
        db.add(M.UsageEvent(id="u1", request_id="r1", task="TTS", capability="TTS",
                            provider="P", model="M", status="SUCCESS", latency_ms=100))
        db.add(M.UsageEvent(id="u2", request_id="r2", task="TTS", capability="TTS",
                            provider="P", model="M", status="FAILED",
                            error_category="TIMEOUT", fallback_reason="fallback",
                            latency_ms=200))
        db.add(M.PublishAttempt(id="pa1", publish_job_id="pj", platform="youtube",
                                status="CONFIRMED_PUBLISHED", platform_post_id="yt1"))
        db.add(M.AffiliateProduct(id="afp", name="E"))
        db.commit()
    finally:
        db.close()
    data = client.get("/api/v1/analytics/overview").json()["data"]
    assert data["production"]["jobs_total"] == 2
    assert data["production"]["jobs_failed"] == 1
    assert data["production"]["qc_blocked"] == 1
    assert data["production"]["videos"] == 1
    assert data["ai"]["requests"] == 2 and data["ai"]["fallbacks"] == 1
    assert data["ai"]["by_error"] == [{"code": "TIMEOUT", "count": 1}]
    assert data["publishing"]["confirmed"] == 1
    assert data["publishing"]["by_platform"] == [{"platform": "youtube", "count": 1}]
    assert data["affiliate"]["products"] == 1
    assert data["ai"]["cost_state"] == "UNKNOWN"
    assert "sk-" not in str(data)


def test_date_range_and_validation(tmp_path):
    client, TS = make_client(tmp_path)
    db = TS()
    try:
        import datetime as _dt
        old = _dt.datetime(2020, 1, 1, tzinfo=_dt.timezone.utc)
        db.add(M.Job(id="JOB-O", project_id="p", kind="FULL_PIPELINE",
                     status="SUCCEEDED", idempotency_key="ko"))
        db.flush()
        job = db.get(M.Job, "JOB-O")
        job.created_at = old
        db.commit()
    finally:
        db.close()
    all_data = client.get("/api/v1/analytics/overview").json()["data"]
    assert all_data["production"]["jobs_total"] == 1
    ranged = client.get("/api/v1/analytics/overview",
                        params={"from": "2025-01-01T00:00:00Z"}).json()["data"]
    assert ranged["production"]["jobs_total"] == 0  # old row excluded, honestly
    bad = client.get("/api/v1/analytics/overview", params={"from": "not-a-date"})
    assert bad.status_code == 400
