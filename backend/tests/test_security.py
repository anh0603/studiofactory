"""Phase 10 security regression: secrets/tokens absent from every surface."""
from __future__ import annotations

import json
import logging
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.ai import adapters as A  # noqa: E402
import app.ai.circuit as circuit_mod  # noqa: E402
from app.api.v1 import ai as ai_api  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db import models as M  # noqa: E402
from app.db.session import get_db  # noqa: E402
import app.engine.runner as R  # noqa: E402
from app.main import create_app  # noqa: E402
import app.publisher.service as pub  # noqa: E402

SECRET = "sk-sec-sentinel-7777"
TOKEN = "tok-sentinel-8888"


def make_client(tmp_path, monkeypatch):
    db_file = tmp_path / "t.db"
    engine = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    TS = sessionmaker(bind=engine, future=True)
    monkeypatch.setattr(R, "SessionFactory", TS)
    monkeypatch.setattr(R, "PROJECTS_ROOT", str(tmp_path / "p"))
    monkeypatch.setattr(R, "AUTO_DISPATCH", False)
    monkeypatch.setattr(pub, "SessionFactory", TS)
    monkeypatch.setattr(pub, "PROJECTS_ROOT", str(tmp_path / "p"))
    monkeypatch.setattr(pub, "PUB_AUTO_DISPATCH", False)

    def odb():
        db = TS()
        try:
            yield db
        finally:
            db.close()

    app = create_app()
    app.dependency_overrides[get_db] = odb
    import app.credentials.store as sm
    monkeypatch.setattr(ai_api, "_store", sm.FernetCredentialStore(
        key_file=str(tmp_path / "k"), data_file=str(tmp_path / "c")))
    monkeypatch.setattr(circuit_mod.breaker, "_entries", {})
    import app.api.v1.story as stm, app.api.v1.media as mm, app.api.v1.affiliate as aff
    from types import SimpleNamespace as NS
    for mod in (stm, mm):
        monkeypatch.setattr(mod, "settings", NS(projects_root=str(tmp_path / "p")))
    monkeypatch.setattr(aff, "settings", NS(projects_root=str(tmp_path / "p")))
    A._ADAPTERS.clear()
    A._ADAPTERS["test"] = A.TestAdapter()
    return TestClient(app), TS


def test_no_secret_anywhere(tmp_path, monkeypatch, caplog):
    client, TS = make_client(tmp_path, monkeypatch)
    with caplog.at_level(logging.INFO, logger="studiofactory"):
        p = client.post("/api/v1/ai/providers",
                        json={"name": "P", "adapter_key": "test"}).json()["data"]
        client.post("/api/v1/ai/credentials",
                    json={"provider_id": p["id"], "secret": SECRET})
        m = client.post("/api/v1/ai/models", json={
            "provider_id": p["id"], "name": "M", "model_id": "mid",
            "capabilities": ["STORY", "TEXT", "IMAGE"],
            "cost_class": "FREE", "license_status": "VERIFIED_COMMERCIAL"}).json()["data"]
        prj = client.post("/api/v1/projects", json={"name": "P"}).json()["data"]
        # Failing director (malformed) exercises error paths with secrets loaded.
        A._ADAPTERS["test"].queue(True, "garbage{{{")
        client.post(f"/api/v1/projects/{prj['id']}/director", json={"idea": "x"})
        # Media failure path.
        scn = client.post(f"/api/v1/projects/{prj['id']}/scenes", json={
            "order": 1, "description": "d", "dialogue": "hi"}).json()["data"]
        A._ADAPTERS["test"].queue_media(False, "down", "PROVIDER_UNAVAILABLE")
        client.post(f"/api/v1/projects/{prj['id']}/scenes/{scn['id']}/image", json={})
        # OAuth token stored, then every read surface scanned.
        db = TS()
        try:
            db.add(M.SocialConnection(id="soc_youtube", platform="youtube",
                                      status="CONNECTED", token_ref="tok_youtube"))
            db.commit()
        finally:
            db.close()
        import app.credentials.store as sm  # noqa
        ai_api._store.save("tok_youtube", json.dumps({"access": TOKEN, "expiry": 9999999999}))
        bodies = [
            client.get("/api/v1/ai/providers").text,
            client.get("/api/v1/ai/models").text,
            client.get("/api/v1/ai/credentials").text,
            client.get("/api/v1/ai/activity").text,
            client.get("/api/v1/ai/usage").text,
            client.get("/api/v1/ai/router/eligible").text,
            client.get(f"/api/v1/projects/{prj['id']}/director").text,
            client.get(f"/api/v1/projects/{prj['id']}/artifacts").text,
            client.get("/api/v1/analytics/overview").text,
            client.get("/api/v1/connections").text,
            client.get("/api/v1/publisher/platforms").text,
            client.get(f"/api/v1/jobs?status=QUEUED").text,
            client.get("/api/v1/does-not-exist").text,
            client.get(f"/api/v1/projects/{prj['id']}/scheduler/schedules").text,
        ]
        for b in bodies:
            assert SECRET not in b, b[:200]
            assert TOKEN not in b, b[:200]
        assert SECRET not in caplog.text
        assert TOKEN not in caplog.text
        # Ciphertext at rest contains no plaintext either.
        raw_store = (tmp_path / "c").read_text(encoding="utf-8")
        assert SECRET not in raw_store and TOKEN not in raw_store
