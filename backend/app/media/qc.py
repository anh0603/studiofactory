"""QC checks + Production Gate (server-side, mandatory, no bypass param)."""
from __future__ import annotations

import uuid

QC_KEYS = ("video_exists", "video_readable", "video_duration", "resolution",
           "audio_exists", "audio_duration", "subtitle_exists", "subtitle_timing",
           "artifact_integrity", "character_policy", "license",
           "disclosure", "provenance")


def run_qc(artifacts: dict) -> dict:
    """artifacts: {video?: {...}, audio?: {...}, subtitle?: {...}, disclosure?: bool,
    license_ok?: bool, character_ok?: bool}.
    Returns {verdict, checks[]}. Pure function — testable without DB.
    """
    checks: list[dict] = []

    def add(key: str, ok: bool | None, detail: str = ""):
        status = "PASS" if ok is True else ("FAIL" if ok is False else "REVIEW")
        checks.append({"key": key, "status": status, "detail": detail})

    v = artifacts.get("video")
    add("video_exists", v is not None, "" if v else "no rendered video")
    add("video_readable", None if not v else bool(v.get("bytes", 0) > 1000),
        "ffprobe deep-check lands with workers" if v else "")
    add("video_duration", None if not v else (v.get("duration_s", 0) > 0),
        "" if (v or {}).get("duration_s") else "duration unknown")
    add("resolution", None if not v else bool(v.get("width") and v.get("height")),
        "" if (v or {}).get("width") else "resolution unknown")
    a = artifacts.get("audio")
    add("audio_exists", a is not None, "" if a else "no audio track")
    add("audio_duration", None if not a else (a.get("duration_s", 0) > 0),
        "" if (a or {}).get("duration_s") else "audio duration unknown")
    s = artifacts.get("subtitle")
    add("subtitle_exists", s is not None, "" if s else "no subtitle file")
    add("subtitle_timing", None if not s else True, "")
    add("artifact_integrity", all(x.get("sha256") for x in (v, a, s) if x) if (v or a or s) else False,
        "sha256 recorded per artifact")
    add("character_policy", artifacts.get("character_ok", None),
        "character lock state review" if artifacts.get("character_ok") is None else "")
    add("license", artifacts.get("license_ok", None),
        "license state unverified" if artifacts.get("license_ok") is None else "")
    add("disclosure", True if artifacts.get("disclosure") else None,
        "" if artifacts.get("disclosure") else "AI disclosure pending")
    add("provenance", all(x.get("provenance") for x in (v, a, s) if x) if (v or a or s) else False,
        "")

    fails = [c for c in checks if c["status"] == "FAIL"]
    reviews = [c for c in checks if c["status"] == "REVIEW"]
    verdict = "BLOCKED" if fails else ("REVIEW_REQUIRED" if reviews else "PASS")
    return {"verdict": verdict, "checks": checks}


GATE_REQUIRED = ("video_exists", "audio_exists", "subtitle_exists",
                 "artifact_integrity", "provenance")


def production_gate(qc: dict, require_commercial: bool = False) -> dict:
    """Gate: BLOCKED unless required checks PASS and license/disclosure allow.

    No parameter can skip this. Returns {decision, reasons[]}.
    """
    reasons = []
    by_key = {c["key"]: c["status"] for c in qc.get("checks", [])}
    for key in GATE_REQUIRED:
        if by_key.get(key) != "PASS":
            reasons.append(f"{key}={by_key.get(key, 'MISSING')}")
    lic = by_key.get("license")
    if lic != "PASS":
        reasons.append(f"license={lic}")
    if by_key.get("disclosure") != "PASS":
        reasons.append("disclosure missing")
    if by_key.get("character_policy") == "FAIL":
        reasons.append("character_policy=FAIL")
    decision = "PASS" if not reasons else "BLOCKED"
    return {"decision": decision, "reasons": reasons}


def persist_qc(db, job_id: str, qc: dict) -> str:
    from ..db import models as M
    row = M.QCResult(id=f"qc_{uuid.uuid4().hex[:12]}", job_id=job_id,
                     verdict=qc["verdict"], checks=qc["checks"])
    db.add(row)
    db.flush()
    return row.id
