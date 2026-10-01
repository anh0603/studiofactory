"""Phase 8: affiliate_products, affiliate_scripts, affiliate_videos (story-FK-free)."""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007_affiliate"
down_revision = "0006_publisher"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "affiliate_products",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, server_default=""),
        sa.Column("price", sa.String(64), server_default=""),
        sa.Column("affiliate_url", sa.String(1024), server_default=""),
        sa.Column("image_path", sa.String(1024)),
        sa.Column("image_sha256", sa.String(128), server_default=""),
        sa.Column("audience", sa.String(128), server_default=""),
        sa.Column("tone", sa.String(128), server_default=""),
        sa.Column("style", sa.String(128), server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "affiliate_scripts",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("product_id", sa.String(64), sa.ForeignKey("affiliate_products.id"), index=True),
        sa.Column("style", sa.String(64), server_default="REVIEW"),
        sa.Column("hook", sa.Text, server_default=""),
        sa.Column("body", sa.Text, server_default=""),
        sa.Column("cta", sa.Text, server_default=""),
        sa.Column("disclosure", sa.Text, server_default=""),
        sa.Column("disclosure_injected", sa.Boolean, server_default="0"),
        sa.Column("provider", sa.String(255), server_default=""),
        sa.Column("model", sa.String(255), server_default=""),
        sa.Column("request_id", sa.String(64), server_default=""),
        sa.Column("mock", sa.Boolean, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "affiliate_videos",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("product_id", sa.String(64), sa.ForeignKey("affiliate_products.id"), index=True),
        sa.Column("script_id", sa.String(64), sa.ForeignKey("affiliate_scripts.id")),
        sa.Column("status", sa.String(32), server_default="DRAFT"),
        sa.Column("visual_artifact_id", sa.String(64)),
        sa.Column("export_manifest", sa.JSON, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    op.drop_table("affiliate_videos")
    op.drop_table("affiliate_scripts")
    op.drop_table("affiliate_products")
