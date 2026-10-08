"""Affiliate rendered video: video_path + duration on affiliate_videos."""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0009_affiliate_video"
down_revision = "0008_script_position"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("affiliate_videos", sa.Column("video_path", sa.String(1024), server_default=""))
    op.add_column("affiliate_videos", sa.Column("duration_s", sa.Float(), server_default="0"))


def downgrade() -> None:
    op.drop_column("affiliate_videos", "duration_s")
    op.drop_column("affiliate_videos", "video_path")
