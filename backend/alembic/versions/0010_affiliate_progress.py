"""Affiliate render progress percent (real ffmpeg progress, polled by UI)."""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0010_affiliate_progress"
down_revision = "0009_affiliate_video"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("affiliate_videos", sa.Column("progress", sa.Integer(), server_default="0"))


def downgrade() -> None:
    op.drop_column("affiliate_videos", "progress")
