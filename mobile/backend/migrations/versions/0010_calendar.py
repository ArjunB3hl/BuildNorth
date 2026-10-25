"""A user-owned journal of completed meals and workouts.

Revision ID: 0010
Revises: 0009
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "calendar_entries",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("user_id", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_minutes", sa.Integer()),
        sa.Column("notes", sa.String(2000)),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("source_key", sa.String(160), nullable=False),
        sa.Column("time_estimated", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "source_key"),
    )
    op.create_index("ix_calendar_entries_user_id", "calendar_entries", ["user_id"])
    op.create_index("ix_calendar_entries_occurred_at", "calendar_entries", ["occurred_at"])


def downgrade() -> None:
    op.drop_table("calendar_entries")
