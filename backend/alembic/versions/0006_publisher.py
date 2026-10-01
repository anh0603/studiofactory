"""Phase 7: social_connections, publish_jobs, publish_attempts."""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_publisher"
down_revision = "0005_autopilot_scheduler"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "social_connections",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("platform", sa.String(32), index=True, nullable=False),
        sa.Column("account_label", sa.String(255), server_default=""),
        sa.Column("status", sa.String(32), server_default="NOT_CONNECTED"),
        sa.Column("scopes", sa.JSON, server_default="[]"),
        sa.Column("token_ref", sa.String(64), server_default=""),
        sa.Column("token_expiry", sa.DateTime(timezone=True)),
        sa.Column("oauth_state", sa.String(128)),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "publish_jobs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("project_id", sa.String(64), sa.ForeignKey("projects.id"), index=True),
        sa.Column("job_id", sa.String(64)),
        sa.Column("schedule_id", sa.String(64)),
        sa.Column("mode", sa.String(16), server_default="NOW"),
        sa.Column("title", sa.String(255), server_default=""),
        sa.Column("description", sa.Text, server_default=""),
        sa.Column("hashtags", sa.JSON, server_default="[]"),
        sa.Column("platforms", sa.JSON, server_default="[]"),
        sa.Column("idempotency_key", sa.String(128), unique=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "publish_attempts",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("publish_job_id", sa.String(64), sa.ForeignKey("publish_jobs.id"), index=True),
        sa.Column("platform", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), server_default="QUEUED"),
        sa.Column("platform_post_id", sa.String(255)),
        sa.Column("reason", sa.String(255)),
        sa.Column("next_retry_at", sa.DateTime(timezone=True)),
        sa.Column("attempts", sa.Integer, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    op.drop_table("publish_attempts")
    op.drop_table("publish_jobs")
    op.drop_table("social_connections")
