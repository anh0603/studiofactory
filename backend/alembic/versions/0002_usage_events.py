"""Phase 2: add usage_events (frozen contract table missing from 0001)."""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002_usage_events"
down_revision = "0001_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "usage_events",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("request_id", sa.String(64), index=True, server_default=""),
        sa.Column("job_id", sa.String(64)),
        sa.Column("task", sa.String(64), server_default=""),
        sa.Column("capability", sa.String(64), server_default=""),
        sa.Column("provider", sa.String(255), server_default=""),
        sa.Column("model", sa.String(255), server_default=""),
        sa.Column("attempt", sa.Integer, server_default="0"),
        sa.Column("latency_ms", sa.Integer, server_default="0"),
        sa.Column("status", sa.String(32), server_default=""),
        sa.Column("error_category", sa.String(64)),
        sa.Column("fallback_reason", sa.String(255)),
        sa.Column("cost", sa.Float),
        sa.Column("cost_state", sa.String(16), server_default="UNKNOWN"),
        sa.Column("mock", sa.Boolean, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    op.drop_table("usage_events")
