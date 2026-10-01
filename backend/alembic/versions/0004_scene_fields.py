"""Phase 3 amendment: scenes.description + scenes.characters_json (Scene contract)."""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_scene_fields"
down_revision = "0003_story_director"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("scenes", sa.Column("description", sa.Text, server_default=""))
    op.add_column("scenes", sa.Column("characters_json", sa.JSON, server_default="[]"))


def downgrade() -> None:
    op.drop_column("scenes", "characters_json")
    op.drop_column("scenes", "description")
