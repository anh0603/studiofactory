"""Foundation entities. Fields/relationships frozen by docs/DATA_MODEL.md.

Phase 1 creates tables for foundation runtime. Business-logic tables for
autopilot/scheduler/publisher/affiliate follow the same contract in later
phases (models below already match the frozen contract; no logic attached).
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class Project(Base, TimestampMixin):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    # Phase 3: factory isolation (story | affiliate). Default story, backfilled.
    factory_type: Mapped[str] = mapped_column(String(32), default="story")
    language: Mapped[str] = mapped_column(String(16), default="vi")
    style: Mapped[str] = mapped_column(String(64), default="")
    audience: Mapped[str] = mapped_column(String(64), default="")
    duration_target: Mapped[float] = mapped_column(Float, default=30.0)
    status: Mapped[str] = mapped_column(String(32), default="DRAFT")


class Character(Base, TimestampMixin):
    __tablename__ = "characters"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    kind: Mapped[str] = mapped_column(String(32), default="MAIN")
    name: Mapped[str] = mapped_column(String(255), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    visual_identity: Mapped[str] = mapped_column(Text, default="")
    lock: Mapped[dict] = mapped_column(JSON, default=dict)
    lock_state: Mapped[str] = mapped_column(String(32), default="REVIEW_REQUIRED")
    reference_asset_id: Mapped[str | None] = mapped_column(String(64), nullable=True)


class CharacterReference(Base):
    __tablename__ = "character_references"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    character_id: Mapped[str] = mapped_column(ForeignKey("characters.id"), index=True)
    asset_path: Mapped[str] = mapped_column(String(1024))
    sha256: Mapped[str] = mapped_column(String(128), default="")
    mime: Mapped[str] = mapped_column(String(64), default="")
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Scene(Base, TimestampMixin):
    __tablename__ = "scenes"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    idx: Mapped[int] = mapped_column(Integer, default=0)
    # Phase 3 amendment (migration 0004): description + characters_json.
    description: Mapped[str] = mapped_column(Text, default="")
    characters_json: Mapped[list] = mapped_column(JSON, default=list)
    duration_s: Mapped[float] = mapped_column(Float, default=0.0)
    camera: Mapped[str] = mapped_column(String(128), default="")
    motion: Mapped[str] = mapped_column(String(128), default="")
    environment: Mapped[str] = mapped_column(String(255), default="")
    dialogue: Mapped[str] = mapped_column(Text, default="")
    visual_prompt: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="DRAFT")
    approved: Mapped[bool] = mapped_column(Boolean, default=False)


class AIProvider(Base):
    __tablename__ = "ai_providers"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    base_url: Mapped[str] = mapped_column(String(1024), default="")
    adapter_key: Mapped[str] = mapped_column(String(64), default="custom")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    health: Mapped[str] = mapped_column(String(32), default="UNKNOWN")
    last_probe_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Credential(Base, TimestampMixin):
    __tablename__ = "credentials"
    # NOTE: secret ciphertext is stored server-side only, never serialized.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    provider_id: Mapped[str] = mapped_column(ForeignKey("ai_providers.id"), index=True)
    ref: Mapped[str] = mapped_column(String(64), unique=True)
    secret_encrypted: Mapped[str] = mapped_column(Text)
    algo: Mapped[str] = mapped_column(String(32), default="fernet-v1")
    fingerprint: Mapped[str] = mapped_column(String(64), default="")
    configured: Mapped[bool] = mapped_column(Boolean, default=True)
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AIModel(Base, TimestampMixin):
    __tablename__ = "ai_models"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    provider_id: Mapped[str] = mapped_column(ForeignKey("ai_providers.id"), index=True)
    credential_ref: Mapped[str] = mapped_column(String(64), default="")
    name: Mapped[str] = mapped_column(String(255))
    model_id: Mapped[str] = mapped_column(String(255))
    capabilities: Mapped[list] = mapped_column(JSON, default=list)
    priority: Mapped[int] = mapped_column(Integer, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    cost_class: Mapped[str] = mapped_column(String(32), default="UNKNOWN")
    license_status: Mapped[str] = mapped_column(String(32), default="UNVERIFIED")
    context_window: Mapped[int] = mapped_column(Integer, default=0)
    extra_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    health_status: Mapped[str] = mapped_column(String(32), default="UNKNOWN")
    last_test_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Job(Base, TimestampMixin):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    kind: Mapped[str] = mapped_column(String(32), default="FULL_PIPELINE")
    status: Mapped[str] = mapped_column(String(32), default="QUEUED")
    stage: Mapped[str] = mapped_column(String(64), default="QUEUED")
    provider: Mapped[str] = mapped_column(String(255), default="")
    model: Mapped[str] = mapped_column(String(255), default="")
    progress_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    status_text: Mapped[str] = mapped_column(String(512), default="")
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)


class WorkflowNode(Base):
    __tablename__ = "workflow_nodes"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id"), index=True)
    type: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="PENDING")
    deps: Mapped[list] = mapped_column(JSON, default=list)
    input_hash: Mapped[str] = mapped_column(String(128), default="")
    provider: Mapped[str] = mapped_column(String(255), default="")
    model: Mapped[str] = mapped_column(String(255), default="")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    output_artifact_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class JobEvent(Base):
    __tablename__ = "job_events"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id"), index=True)
    node_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    event: Mapped[str] = mapped_column(String(128))
    provider: Mapped[str] = mapped_column(String(255), default="")
    model: Mapped[str] = mapped_column(String(255), default="")
    attempt: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="")
    error_category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fallback_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Artifact(Base):
    __tablename__ = "artifacts"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id"), index=True)
    scene_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    kind: Mapped[str] = mapped_column(String(32))
    path: Mapped[str] = mapped_column(String(1024))
    sha256: Mapped[str] = mapped_column(String(128))
    bytes: Mapped[int] = mapped_column(Integer, default=0)
    mime: Mapped[str] = mapped_column(String(64), default="")
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    duration_s: Mapped[float] = mapped_column(Float, default=0.0)
    provider: Mapped[str] = mapped_column(String(255), default="")
    model: Mapped[str] = mapped_column(String(255), default="")
    request_id: Mapped[str] = mapped_column(String(64), default="")
    cost_class: Mapped[str] = mapped_column(String(32), default="UNKNOWN")
    license_status: Mapped[str] = mapped_column(String(32), default="UNVERIFIED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class QCResult(Base):
    __tablename__ = "qc_results"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id"), index=True)
    verdict: Mapped[str] = mapped_column(String(32))
    checks: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Export(Base):
    __tablename__ = "exports"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id"), index=True)
    files_manifest: Mapped[dict] = mapped_column(JSON, default=dict)
    provenance_uri: Mapped[str] = mapped_column(String(1024), default="")
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value_json: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class UsageEvent(Base):
    """Append-only AI activity record. Never updated. No secrets."""
    __tablename__ = "usage_events"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(64), index=True, default="")
    job_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    task: Mapped[str] = mapped_column(String(64), default="")
    capability: Mapped[str] = mapped_column(String(64), default="")
    provider: Mapped[str] = mapped_column(String(255), default="")
    model: Mapped[str] = mapped_column(String(255), default="")
    attempt: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="")
    error_category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fallback_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_state: Mapped[str] = mapped_column(String(16), default="UNKNOWN")
    mock: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AutopilotConfig(Base, TimestampMixin):
    """Phase 6: singleton-per-project automation policy. allow_paid defaults false."""
    __tablename__ = "autopilot_configs"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    daily_target: Mapped[int] = mapped_column(Integer, default=1)
    frequency_per_day: Mapped[int] = mapped_column(Integer, default=1)
    window_start: Mapped[str] = mapped_column(String(8), default="00:00")
    window_end: Mapped[str] = mapped_column(String(8), default="23:59")
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Ho_Chi_Minh")
    topics: Mapped[list] = mapped_column(JSON, default=list)
    randomization: Mapped[bool] = mapped_column(Boolean, default=True)
    max_retries_per_job: Mapped[int] = mapped_column(Integer, default=2)
    max_concurrent_jobs: Mapped[int] = mapped_column(Integer, default=1)
    allow_paid_models: Mapped[bool] = mapped_column(Boolean, default=False)
    require_approval_before_publish: Mapped[bool] = mapped_column(Boolean, default=True)
    stop_after_consecutive_failures: Mapped[int] = mapped_column(Integer, default=3)
    model_strategy: Mapped[str] = mapped_column(String(32), default="AUTO")
    platforms: Mapped[list] = mapped_column(JSON, default=list)


class AutopilotRun(Base, TimestampMixin):
    """Phase 6: one automation run. Status machine enforced in service."""
    __tablename__ = "autopilot_runs"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    config_id: Mapped[str] = mapped_column(ForeignKey("autopilot_configs.id"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="RUNNING")
    planned: Mapped[int] = mapped_column(Integer, default=0)
    completed: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0)
    job_ids: Mapped[list] = mapped_column(JSON, default=list)
    schedule_ids: Mapped[list] = mapped_column(JSON, default=list)
    note: Mapped[str] = mapped_column(Text, default="")


class Schedule(Base, TimestampMixin):
    """Phase 6: timezone-aware publish slots. run_at stored UTC."""
    __tablename__ = "schedules"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    job_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Ho_Chi_Minh")
    recurrence: Mapped[str | None] = mapped_column(String(32), nullable=True)
    platforms: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(32), default="SCHEDULED")
    note: Mapped[str] = mapped_column(Text, default="")
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True)


class SocialConnection(Base, TimestampMixin):
    """Phase 7: OAuth platform connections. Tokens live in CredentialStore
    (token_ref); this row never holds secrets."""
    __tablename__ = "social_connections"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    platform: Mapped[str] = mapped_column(String(32), index=True)  # youtube|tiktok|facebook
    account_label: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[str] = mapped_column(String(32), default="NOT_CONNECTED")
    scopes: Mapped[list] = mapped_column(JSON, default=list)
    token_ref: Mapped[str] = mapped_column(String(64), default="")
    token_expiry: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    oauth_state: Mapped[str | None] = mapped_column(String(128), nullable=True)


class PublishJob(Base, TimestampMixin):
    """Phase 7: one publish request across platforms. Idempotent by key."""
    __tablename__ = "publish_jobs"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    job_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    schedule_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mode: Mapped[str] = mapped_column(String(16), default="NOW")
    title: Mapped[str] = mapped_column(String(255), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    hashtags: Mapped[list] = mapped_column(JSON, default=list)
    platforms: Mapped[list] = mapped_column(JSON, default=list)
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True)


class PublishAttempt(Base, TimestampMixin):
    """Phase 7: per-platform attempt. post_id ONLY when confirmed."""
    __tablename__ = "publish_attempts"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    publish_job_id: Mapped[str] = mapped_column(ForeignKey("publish_jobs.id"), index=True)
    platform: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="QUEUED")
    platform_post_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)


class AffiliateProduct(Base, TimestampMixin):
    """Phase 8: isolated from Story (no story FKs by design)."""
    __tablename__ = "affiliate_products"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    price: Mapped[str] = mapped_column(String(64), default="")
    affiliate_url: Mapped[str] = mapped_column(String(1024), default="")
    image_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    image_sha256: Mapped[str] = mapped_column(String(128), default="")
    audience: Mapped[str] = mapped_column(String(128), default="")
    tone: Mapped[str] = mapped_column(String(128), default="")
    style: Mapped[str] = mapped_column(String(128), default="")


class AffiliateScript(Base):
    """Phase 8: versioned by created order. disclosure always present."""
    __tablename__ = "affiliate_scripts"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("affiliate_products.id"), index=True)
    style: Mapped[str] = mapped_column(String(64), default="REVIEW")
    hook: Mapped[str] = mapped_column(Text, default="")
    body: Mapped[str] = mapped_column(Text, default="")
    cta: Mapped[str] = mapped_column(Text, default="")
    disclosure: Mapped[str] = mapped_column(Text, default="")
    disclosure_injected: Mapped[bool] = mapped_column(Boolean, default=False)
    provider: Mapped[str] = mapped_column(String(255), default="")
    model: Mapped[str] = mapped_column(String(255), default="")
    request_id: Mapped[str] = mapped_column(String(64), default="")
    mock: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AffiliateVideo(Base, TimestampMixin):
    """Phase 8: product video. No autopilot/scheduler/publisher links."""
    __tablename__ = "affiliate_videos"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("affiliate_products.id"), index=True)
    script_id: Mapped[str] = mapped_column(ForeignKey("affiliate_scripts.id"))
    status: Mapped[str] = mapped_column(String(32), default="DRAFT")
    visual_artifact_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    video_path: Mapped[str] = mapped_column(String(1024), default="")
    duration_s: Mapped[float] = mapped_column(Float, default=0.0)
    export_manifest: Mapped[dict] = mapped_column(JSON, default=dict)


class DirectorPlan(Base):
    """Phase 3: versioned AI Director plans. One row per version, never overwritten.

    status: DRAFT -> REVIEW -> APPROVED | REJECTED.
    origin: GENERATED | REGENERATED | SECTION_REGENERATED | USER_EDITED.
    """
    __tablename__ = "director_plans"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(32), default="DRAFT")
    origin: Mapped[str] = mapped_column(String(32), default="GENERATED")
    parent_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    plan: Mapped[dict] = mapped_column(JSON, default=dict)
    provider: Mapped[str] = mapped_column(String(255), default="")
    model: Mapped[str] = mapped_column(String(255), default="")
    request_id: Mapped[str] = mapped_column(String(64), default="")
    mock: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
