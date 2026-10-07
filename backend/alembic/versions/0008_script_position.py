"""Affiliate script ordering: position column backfilled by created_at."""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0008_script_position"
down_revision = "0007_affiliate"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("affiliate_scripts", sa.Column("position", sa.Integer(), server_default="0"))
    # Backfill: order of creation per product, 0-based.
    op.execute(sa.text(
        "UPDATE affiliate_scripts SET position = ("
        "SELECT rn FROM ("
        "SELECT id, ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY created_at, id) - 1 AS rn "
        "FROM affiliate_scripts) WHERE id = affiliate_scripts.id)"
    ))


def downgrade() -> None:
    op.drop_column("affiliate_scripts", "position")
