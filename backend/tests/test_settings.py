"""Settings export-dir, affiliate script reorder, media file serving."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.api.v1 import ai as ai_api  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db import models as M  # noqa: E402,F401
from app.db.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

    def override_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app = create_app()
    app.dependency_overrides[get_db] = override_db
    import app.credentials.store as store_mod
    fresh = store_mod.FernetCredentialStore(key_file=str(tmp_path / "master.key"),
                                            data_file=str(tmp_path / "creds.enc"))
    monkeypatch.setattr(ai_api, "_store", fresh)
    # Isolated storage jail for file-serving tests.
    from app.storage.local import LocalStorage
    import app.api.v1.files as files_api
    monkeypatch.setattr(files_api, "_storage", lambda: LocalStorage(str(tmp_path / "projects")))
    client = TestClient(app)
    client.testing_session = TestingSession
    return client


def _db(client):
    return client.testing_session()


def test_export_dir_validation(tmp_path, client):
    # Relative path rejected.
    res = client.put("/api/v1/settings", json={"export_dir": "relative/path"})
    assert res.status_code == 422
    # Empty rejected.
    res = client.put("/api/v1/settings", json={"export_dir": "   "})
    assert res.status_code == 422
    # Absolute path accepted and reported OK.
    target = tmp_path / "exports-out"
    res = client.put("/api/v1/settings", json={"export_dir": str(target)})
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["export_dir_state"] == "OK"
    assert target.is_dir()
    # GET reflects it.
    res = client.get("/api/v1/settings")
    assert res.json()["data"]["export_dir_state"] == "OK"
    # Clearing returns to UNSET.
    res = client.delete("/api/v1/settings/export-dir")
    assert res.json()["data"]["export_dir_state"] == "UNSET"


def test_script_reorder(client):
    db = _db(client)
    p = M.AffiliateProduct(id="afp_1", name="P")
    db.add(p)
    for i, sid in enumerate(("s1", "s2", "s3")):
        db.add(M.AffiliateScript(id=sid, product_id="afp_1", style="REVIEW",
                                 body="b", disclosure="d", position=i))
    db.commit()
    db.close()
    # Move last script to front.
    res = client.patch("/api/v1/affiliate/scripts/s3", json={"position": 0})
    assert res.status_code == 200, res.text
    res = client.get("/api/v1/affiliate/products/afp_1/scripts")
    ids = [s["id"] for s in res.json()["data"]]
    assert ids == ["s3", "s1", "s2"], ids
    # Out-of-range clamps to the end.
    res = client.patch("/api/v1/affiliate/scripts/s3", json={"position": 99})
    assert res.status_code == 200
    res = client.get("/api/v1/affiliate/products/afp_1/scripts")
    assert [s["id"] for s in res.json()["data"]] == ["s1", "s2", "s3"]
    # Unknown script 404.
    assert client.patch("/api/v1/affiliate/scripts/nope", json={"position": 0}).status_code == 404


def test_copy_to_export_dir(tmp_path, client):
    from app.api.v1.settings import EXPORT_DIR_KEY, copy_to_export_dir
    dest = tmp_path / "out"
    dest.mkdir()
    db = _db(client)
    db.add(M.Setting(key=EXPORT_DIR_KEY, value_json={"path": str(dest)}))
    db.commit()
    src = tmp_path / "final.mp4"
    src.write_bytes(b"ftyp-fake-bytes")
    out = copy_to_export_dir(db, [(src, "final.mp4")])
    assert out["saved_to"] == str(dest)
    assert out["saved_files"] == ["final.mp4"]
    assert out["save_error"] is None
    assert (dest / "final.mp4").read_bytes() == b"ftyp-fake-bytes"
    db.close()
    # No export dir configured -> no-op, no error.
    db2 = _db(client)
    db2.query(M.Setting).delete()
    db2.commit()
    out = copy_to_export_dir(db2, [(src, "final.mp4")])
    assert out == {"saved_to": None, "saved_files": [], "save_error": None}
    db2.close()


def test_files_guards(client):
    assert client.get("/api/v1/artifacts/nope!/content").status_code == 400
    assert client.get("/api/v1/artifacts/art_missing/content").status_code == 404
    assert client.get("/api/v1/artifacts/art_missing").status_code == 404


def test_artifact_stream_roundtrip(tmp_path, client):
    import app.api.v1.files as files_api
    store = files_api._storage()
    store.ensure_project("prj_t1")
    payload = b"\x89PNG\r\n\x1a\n" + b"IDAT" + b"x" * 100 + b"IEND\xae\x42\x60\x82"
    (store.project_dir("prj_t1") / "renders").mkdir(parents=True, exist_ok=True)
    (store.project_dir("prj_t1") / "renders" / "final.png").write_bytes(payload)
    db = _db(client)
    db.add(M.Job(id="job_t1", project_id="prj_t1", kind="RENDER", status="DONE",
                 stage="READY", progress_percent=100, status_text="ok",
                 idempotency_key="t1"))
    db.add(M.Artifact(id="art_t1", job_id="job_t1", kind="IMAGE",
                      path="renders/final.png", sha256="x", bytes=len(payload),
                      mime="image/png"))
    db.commit()
    db.close()
    res = client.get("/api/v1/artifacts/art_t1/content")
    assert res.status_code == 200
    assert res.content == payload
    # Range request returns 206 with correct slice.
    res = client.get("/api/v1/artifacts/art_t1/content", headers={"Range": "bytes=0-9"})
    assert res.status_code == 206
    assert res.content == payload[:10]
    assert res.headers["content-range"] == f"bytes 0-9/{len(payload)}"
    # Meta endpoint mirrors the row, never the bytes.
    meta = client.get("/api/v1/artifacts/art_t1").json()["data"]
    assert meta["mime"] == "image/png" and meta["bytes"] == len(payload)
