"""Phase 3: projects.factory_type + director_plans (versioned, append-only)."""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_story_director"
down_revision = "0002_usage_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("factory_type", sa.String(32), server_default="story"))
    op.create_table(
        "director_plans",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("project_id", sa.String(64), sa.ForeignKey("projects.id"), index=True),
        sa.Column("version", sa.Integer, server_default="1"),
        sa.Column("status", sa.String(32), server_default="DRAFT"),
        sa.Column("origin", sa.String(32), server_default="GENERATED"),
        sa.Column("parent_version", sa.Integer),
        sa.Column("input_snapshot", sa.JSON, server_default="{}"),
        sa.Column("plan", sa.JSON, server_default="{}"),
        sa.Column("provider", sa.String(255), server_default=""),
        sa.Column("model", sa.String(255), server_default=""),
        sa.Column("request_id", sa.String(64), server_default=""),
        sa.Column("mock", sa.Boolean, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    op.drop_table("director_plans")
    op.drop_column("projects", "factory_type")
