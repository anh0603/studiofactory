"""Phase 1 foundation migration: create all frozen foundation tables."""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001_foundation"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, server_default=""),
        sa.Column("language", sa.String(16), server_default="vi"),
        sa.Column("style", sa.String(64), server_default=""),
        sa.Column("audience", sa.String(64), server_default=""),
        sa.Column("duration_target", sa.Float, server_default="30"),
        sa.Column("status", sa.String(32), server_default="DRAFT"),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "characters",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("project_id", sa.String(64), sa.ForeignKey("projects.id"), index=True),
        sa.Column("kind", sa.String(32), server_default="MAIN"),
        sa.Column("name", sa.String(255), server_default=""),
        sa.Column("description", sa.Text, server_default=""),
        sa.Column("visual_identity", sa.Text, server_default=""),
        sa.Column("lock", sa.JSON, server_default="{}"),
        sa.Column("lock_state", sa.String(32), server_default="REVIEW_REQUIRED"),
        sa.Column("reference_asset_id", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "character_references",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("character_id", sa.String(64), sa.ForeignKey("characters.id"), index=True),
        sa.Column("asset_path", sa.String(1024), nullable=False),
        sa.Column("sha256", sa.String(128), server_default=""),
        sa.Column("mime", sa.String(64), server_default=""),
        sa.Column("width", sa.Integer, server_default="0"),
        sa.Column("height", sa.Integer, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "scenes",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("project_id", sa.String(64), sa.ForeignKey("projects.id"), index=True),
        sa.Column("idx", sa.Integer, server_default="0"),
        sa.Column("duration_s", sa.Float, server_default="0"),
        sa.Column("camera", sa.String(128), server_default=""),
        sa.Column("motion", sa.String(128), server_default=""),
        sa.Column("environment", sa.String(255), server_default=""),
        sa.Column("dialogue", sa.Text, server_default=""),
        sa.Column("visual_prompt", sa.Text, server_default=""),
        sa.Column("status", sa.String(32), server_default="DRAFT"),
        sa.Column("approved", sa.Boolean, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "ai_providers",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("base_url", sa.String(1024), server_default=""),
        sa.Column("adapter_key", sa.String(64), server_default="custom"),
        sa.Column("enabled", sa.Boolean, server_default="1"),
        sa.Column("health", sa.String(32), server_default="UNKNOWN"),
        sa.Column("last_probe_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "credentials",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("provider_id", sa.String(64), sa.ForeignKey("ai_providers.id"), index=True),
        sa.Column("ref", sa.String(64), unique=True, nullable=False),
        sa.Column("secret_encrypted", sa.Text, nullable=False),
        sa.Column("algo", sa.String(32), server_default="fernet-v1"),
        sa.Column("fingerprint", sa.String(64), server_default=""),
        sa.Column("configured", sa.Boolean, server_default="1"),
        sa.Column("last_verified_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "ai_models",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("provider_id", sa.String(64), sa.ForeignKey("ai_providers.id"), index=True),
        sa.Column("credential_ref", sa.String(64), server_default=""),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("model_id", sa.String(255), nullable=False),
        sa.Column("capabilities", sa.JSON, server_default="[]"),
        sa.Column("priority", sa.Integer, server_default="100"),
        sa.Column("enabled", sa.Boolean, server_default="1"),
        sa.Column("cost_class", sa.String(32), server_default="UNKNOWN"),
        sa.Column("license_status", sa.String(32), server_default="UNVERIFIED"),
        sa.Column("context_window", sa.Integer, server_default="0"),
        sa.Column("metadata", sa.JSON, server_default="{}"),
        sa.Column("health_status", sa.String(32), server_default="UNKNOWN"),
        sa.Column("last_test_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "jobs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("project_id", sa.String(64), sa.ForeignKey("projects.id"), index=True),
        sa.Column("kind", sa.String(32), server_default="FULL_PIPELINE"),
        sa.Column("status", sa.String(32), server_default="QUEUED"),
        sa.Column("stage", sa.String(64), server_default="QUEUED"),
        sa.Column("provider", sa.String(255), server_default=""),
        sa.Column("model", sa.String(255), server_default=""),
        sa.Column("progress_percent", sa.Float),
        sa.Column("status_text", sa.String(512), server_default=""),
        sa.Column("idempotency_key", sa.String(128), unique=True, nullable=False),
        sa.Column("attempts", sa.Integer, server_default="0"),
        sa.Column("error_code", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "workflow_nodes",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("job_id", sa.String(64), sa.ForeignKey("jobs.id"), index=True),
        sa.Column("type", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), server_default="PENDING"),
        sa.Column("deps", sa.JSON, server_default="[]"),
        sa.Column("input_hash", sa.String(128), server_default=""),
        sa.Column("provider", sa.String(255), server_default=""),
        sa.Column("model", sa.String(255), server_default=""),
        sa.Column("attempts", sa.Integer, server_default="0"),
        sa.Column("output_artifact_id", sa.String(64)),
        sa.Column("error_code", sa.String(64)),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "job_events",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("job_id", sa.String(64), sa.ForeignKey("jobs.id"), index=True),
        sa.Column("node_id", sa.String(64)),
        sa.Column("event", sa.String(128), nullable=False),
        sa.Column("provider", sa.String(255), server_default=""),
        sa.Column("model", sa.String(255), server_default=""),
        sa.Column("attempt", sa.Integer, server_default="0"),
        sa.Column("latency_ms", sa.Integer, server_default="0"),
        sa.Column("status", sa.String(32), server_default=""),
        sa.Column("error_category", sa.String(64)),
        sa.Column("fallback_reason", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "artifacts",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("job_id", sa.String(64), sa.ForeignKey("jobs.id"), index=True),
        sa.Column("scene_id", sa.String(64)),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("path", sa.String(1024), nullable=False),
        sa.Column("sha256", sa.String(128), nullable=False),
        sa.Column("bytes", sa.Integer, server_default="0"),
        sa.Column("mime", sa.String(64), server_default=""),
        sa.Column("width", sa.Integer, server_default="0"),
        sa.Column("height", sa.Integer, server_default="0"),
        sa.Column("duration_s", sa.Float, server_default="0"),
        sa.Column("provider", sa.String(255), server_default=""),
        sa.Column("model", sa.String(255), server_default=""),
        sa.Column("request_id", sa.String(64), server_default=""),
        sa.Column("cost_class", sa.String(32), server_default="UNKNOWN"),
        sa.Column("license_status", sa.String(32), server_default="UNVERIFIED"),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "qc_results",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("job_id", sa.String(64), sa.ForeignKey("jobs.id"), index=True),
        sa.Column("verdict", sa.String(32), nullable=False),
        sa.Column("checks", sa.JSON, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "exports",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("job_id", sa.String(64), sa.ForeignKey("jobs.id"), index=True),
        sa.Column("files_manifest", sa.JSON, server_default="{}"),
        sa.Column("provenance_uri", sa.String(1024), server_default=""),
        sa.Column("idempotency_key", sa.String(128), unique=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "settings",
        sa.Column("key", sa.String(128), primary_key=True),
        sa.Column("value_json", sa.JSON, server_default="{}"),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    for table in (
        "settings", "exports", "qc_results", "artifacts", "job_events",
        "workflow_nodes", "jobs", "ai_models", "credentials", "ai_providers",
        "scenes", "character_references", "characters", "projects",
    ):
        op.drop_table(table)
