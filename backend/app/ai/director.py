"""AI Director: prompt building + structured-output validation.

Director ALWAYS goes through AI Router (never direct provider calls).
Malformed AI output is NEVER saved as SUCCESS — typed error instead.
Prompts contain character ids + descriptive text only (no bytes, no secrets).
"""
from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field, ValidationError


class PlanScene(BaseModel):
    scene_number: int
    description: str = ""
    dialogue: str = ""
    visual_prompt: str = ""
    camera: str = ""
    duration: float = 0.0
    characters: list[str] = Field(default_factory=list)


class PlanCharacter(BaseModel):
    name: str
    role: str = ""
    description: str = ""


class DirectorPlanSchema(BaseModel):
    title: str
    concept: str = ""
    hook: str = ""
    audience: str = ""
    tone: str = ""
    story_structure: str = ""
    characters: list[PlanCharacter] = Field(default_factory=list)
    scenes: list[PlanScene] = Field(default_factory=list)
    visual_style: str = ""
    camera_style: str = ""
    voice_style: str = ""
    duration: float = 0.0
    ending: str = ""
    cta: str = ""


SECTIONS = ("title", "hook", "concept", "story_structure", "scenes",
            "visual_style", "camera_style", "voice_style", "ending", "cta")


def build_prompt(idea: str, audience: str, tone: str, duration: float,
                 language: str, style: str,
                 characters: list[dict[str, Any]]) -> str:
    char_block = ""
    if characters:
        lines = [f"- id={c['id']} name={c.get('name','')} kind={c.get('kind','')}: "
                 f"{c.get('description','')} | visual: {c.get('visual_identity','')}".strip()
                 for c in characters]
        char_block = "Characters (reference by id in scenes):\n" + "\n".join(lines) + "\n"
    return (
        "You are an AI video director for short videos. "
        "Respond with ONE JSON object only, no markdown fences, no commentary. "
        "Keys: title, concept, hook, audience, tone, story_structure, "
        "characters [{name, role, description}], "
        "scenes [{scene_number, description, dialogue, visual_prompt, camera, "
        "duration, characters [character ids or names]}], "
        "visual_style, camera_style, voice_style, duration (seconds number), "
        "ending, cta.\n"
        "Types: every value MUST be a string, except scene_number and duration "
        "which MUST be numbers. Never use null — use an empty string when a "
        "scene has no dialogue. Arrays must not be empty.\n"
        f"Idea: {idea}\nAudience: {audience}\nTone: {tone}\n"
        f"Target duration: {duration}s\nLanguage: {language}\nStyle: {style}\n"
        f"{char_block}"
    )


def build_section_prompt(section: str, current: dict[str, Any], idea: str,
                         language: str) -> str:
    return (
        "You are an AI video director. Respond with ONE JSON object only: "
        f'{{"section": "{section}", "value": <new value>}}. '
        f"For 'scenes', value is a full scenes array "
        "[{scene_number, description, dialogue, visual_prompt, camera, duration, characters}]. "
        f"For other sections value is a string (duration: number).\n"
        f"Original idea: {idea}\nLanguage: {language}\n"
        f"Current plan (context, do not repeat unless asked): {json.dumps(current)[:4000]}"
    )


def extract_json(text: str) -> Any:
    """Parse model output, tolerating markdown fences. Raises ValueError."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError("empty model output")
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [ln for ln in lines if not ln.strip().startswith("```")]
        cleaned = "\n".join(lines).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON object in model output")
    return json.loads(cleaned[start:end + 1])


def _coerce_null_strings(node: Any) -> Any:
    """Free-tier models emit explicit nulls for "no dialogue" despite being
    told to use "". A null carries no information, so normalize it to the
    schema default ("") BEFORE validation. Anything that is neither a string
    nor null (lists, objects, numbers) still fails loudly in validate_plan —
    this coerces nothing else. Phase B.
    """
    if isinstance(node, dict):
        return {k: ("" if v is None else _coerce_null_strings(v))
                for k, v in node.items()}
    if isinstance(node, list):
        return [("" if v is None else _coerce_null_strings(v)) for v in node]
    return node


def validate_plan(data: Any) -> DirectorPlanSchema:
    try:
        return DirectorPlanSchema.model_validate(_coerce_null_strings(data))
    except ValidationError as exc:
        raise ValueError(f"plan schema invalid: {exc.errors()[0]['loc']}:{exc.errors()[0]['msg']}")
