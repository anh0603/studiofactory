"""Phase 6: autopilot_configs, autopilot_runs, schedules."""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005_autopilot_scheduler"
down_revision = "0004_scene_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "autopilot_configs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("project_id", sa.String(64), sa.ForeignKey("projects.id"), index=True),
        sa.Column("enabled", sa.Boolean, server_default="0"),
        sa.Column("daily_target", sa.Integer, server_default="1"),
        sa.Column("frequency_per_day", sa.Integer, server_default="1"),
        sa.Column("window_start", sa.String(8), server_default="00:00"),
        sa.Column("window_end", sa.String(8), server_default="23:59"),
        sa.Column("timezone", sa.String(64), server_default="Asia/Ho_Chi_Minh"),
        sa.Column("topics", sa.JSON, server_default="[]"),
        sa.Column("randomization", sa.Boolean, server_default="1"),
        sa.Column("max_retries_per_job", sa.Integer, server_default="2"),
        sa.Column("max_concurrent_jobs", sa.Integer, server_default="1"),
        sa.Column("allow_paid_models", sa.Boolean, server_default="0"),
        sa.Column("require_approval_before_publish", sa.Boolean, server_default="1"),
        sa.Column("stop_after_consecutive_failures", sa.Integer, server_default="3"),
        sa.Column("model_strategy", sa.String(32), server_default="AUTO"),
        sa.Column("platforms", sa.JSON, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "autopilot_runs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("config_id", sa.String(64), sa.ForeignKey("autopilot_configs.id"), index=True),
        sa.Column("project_id", sa.String(64), sa.ForeignKey("projects.id"), index=True),
        sa.Column("status", sa.String(32), server_default="RUNNING"),
        sa.Column("planned", sa.Integer, server_default="0"),
        sa.Column("completed", sa.Integer, server_default="0"),
        sa.Column("failed", sa.Integer, server_default="0"),
        sa.Column("consecutive_failures", sa.Integer, server_default="0"),
        sa.Column("job_ids", sa.JSON, server_default="[]"),
        sa.Column("schedule_ids", sa.JSON, server_default="[]"),
        sa.Column("note", sa.Text, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "schedules",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("project_id", sa.String(64), sa.ForeignKey("projects.id"), index=True),
        sa.Column("job_id", sa.String(64)),
        sa.Column("run_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("timezone", sa.String(64), server_default="Asia/Ho_Chi_Minh"),
        sa.Column("recurrence", sa.String(32)),
        sa.Column("platforms", sa.JSON, server_default="[]"),
        sa.Column("status", sa.String(32), server_default="SCHEDULED"),
        sa.Column("note", sa.Text, server_default=""),
        sa.Column("idempotency_key", sa.String(128), unique=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    op.drop_table("schedules")
    op.drop_table("autopilot_runs")
    op.drop_table("autopilot_configs")
