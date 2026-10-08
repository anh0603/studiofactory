"""PASS 8 contract locks — NOT behavior changes.

Two PASS 7 findings are locked here so nobody "fixes" them silently later:

1. `SceneIn` does NOT forbid unknown fields. A typo (`idx`, `duration_s`) is
   dropped by pydantic and the API answers 201 with `order=0`, `duration=0`.
   API_SPEC.md does not mandate strict input for this endpoint, so the behavior
   is FROZEN as-is (changing it would alter API semantics). The frontend sends
   the correct names (`order`, `duration`) — asserted below.

2. `CharacterReference` is stored but never read by media generation.
   `reference_asset_id` is a DB column with no consumer; `POST .../scenes/{id}
/   image` builds its prompt from `body.prompt or visual_prompt or description`
   only. So the honest state is:
       REFERENCE_STORED / GENERATION_REFERENCE_INTEGRATION_PENDING
   Any future claim that image generation used the reference must first break
   this test.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.api.v1 import ai as ai_api  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db import models as _models  # noqa: E402,F401
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
    import app.ai.circuit as circuit_mod
    monkeypatch.setattr(circuit_mod.breaker, "_entries", {})
    yield TestClient(app)


# ---------------------------------------------------- scene input validation

def test_scene_unknown_fields_are_dropped_not_rejected(client):
    """Frozen behavior: unknown keys are ignored, response is 201."""
    proj = client.post("/api/v1/projects", json={"name": "P"}).json()["data"]
    res = client.post(f"/api/v1/projects/{proj['id']}/scenes", json={
        "idx": 7,                      # wrong name for `order`
        "duration_s": 9,                # wrong name for `duration`
        "description": "d",
    })
    assert res.status_code == 201, res.text
    data = res.json()["data"]
    assert data["order"] == 0, "typo'd `idx` must not silently become order"
    assert data["duration"] == 0.0, "typo'd `duration_s` must not silently become duration"


def test_scene_correct_field_names_are_honoured(client):
    proj = client.post("/api/v1/projects", json={"name": "P"}).json()["data"]
    res = client.post(f"/api/v1/projects/{proj['id']}/scenes", json={
        "order": 3, "duration": 9, "description": "d", "dialogue": "line",
    })
    assert res.status_code == 201, res.text
    data = res.json()["data"]
    assert data["order"] == 3
    assert data["duration"] == 9.0


def test_scene_invalid_values_are_rejected(client):
    """Known fields are still validated — dropping unknowns is not lax validation."""
    proj = client.post("/api/v1/projects", json={"name": "P"}).json()["data"]
    bad_status = client.post(f"/api/v1/projects/{proj['id']}/scenes",
                             json={"order": 1, "status": "NOT_A_STATUS"})
    assert bad_status.status_code == 400, bad_status.text
    bad_duration = client.post(f"/api/v1/projects/{proj['id']}/scenes",
                               json={"order": 1, "duration": 9999})
    assert bad_duration.status_code == 400, bad_duration.text


def test_frontend_scene_payload_uses_contract_field_names():
    """Guard the client against the typo that caused the PASS 7 finding."""
    import re
    from pathlib import Path

    src = Path(__file__).resolve().parents[2] / "frontend" / "src" / "story" / "workspaces.tsx"
    text = src.read_text(encoding="utf-8")
    call = re.search(r"createScene\(\{(.*?)\}\)", text, re.S)
    assert call, "manual scene creation must call createScene with an object"
    payload = call.group(1)
    assert "order:" in payload, payload
    assert "idx:" not in payload, payload
    assert "duration_s:" not in payload, payload


# ------------------------------------------- character reference: honest state

def test_reference_is_stored_but_generation_does_not_read_it(client):
    proj = client.post("/api/v1/projects", json={"name": "P"}).json()["data"]
    ch = client.post(f"/api/v1/projects/{proj['id']}/characters",
                     json={"name": "Hero", "kind": "MAIN",
                           "visual_identity": "brown fur"}).json()["data"]
    assert ch["reference_asset_id"] is None

    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
        "890000000a49444154789c6360000002000100ffff03000006000557bfabd400"
        "00000049454e44ae426082")
    up = client.post(f"/api/v1/characters/{ch['id']}/references",
                     files={"file": ("ref.png", png, "image/png")})
    assert up.status_code == 201, up.text
    assert up.json()["data"]["id"].startswith("cref_")

    after = client.get(f"/api/v1/characters/{ch['id']}").json()["data"]
    assert after["reference_asset_id"], "REFERENCE_STORED: id must be persisted"

    # Generation is still refused (no provider). When a provider exists, the
    # prompt is built ONLY from prompt/visual_prompt/description — the reference
    # is not part of it. Assert the code shape so integration cannot be faked.
    from app.api.v1.media import gen_image
    import inspect
    src = inspect.getsource(gen_image)
    assert "reference_asset_id" not in src, (
        "gen_image now reads the character reference — update the honest state in "
        "the PASS 8 report and re-verify provider support before claiming it")
    assert "body.prompt or s.visual_prompt or s.description" in src


def test_router_contract_cannot_carry_media_reference():
    """RouteInput/AdapterRequest are text-only, EXCEPT the explicit `images`
    allow-list: a bounded list (max 4) of data-URL strings for VISION_ANALYSIS
    only. Raw bytes, file paths/objects, reference ids and plain URLs stay
    forbidden — character-reference smuggling stays impossible."""
    from app.ai.adapters import AdapterRequest
    from app.ai.router import RouteInput

    for cls in (RouteInput, AdapterRequest):
        fields = set(getattr(cls, "__dataclass_fields__", {}))
        leaked = {f for f in fields
                  if any(k in f.lower() for k in ("image", "reference", "bytes", "file", "url"))}
        assert leaked <= {"images"}, (
            f"{cls.__name__} unexpectedly carries media fields: {leaked}")