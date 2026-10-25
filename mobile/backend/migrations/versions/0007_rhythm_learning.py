"""Rhythm learns interests from activity: watched-video signals and the learned profile's evidence.

Revision ID: 0007
Revises: 0006
"""

from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("rhythm_profiles", sa.Column("learned", sa.JSON(), nullable=True))
    op.add_column("rhythm_profiles", sa.Column("learned_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "rhythm_signals",
        sa.Column("id", sa.String(32), nullable=False),
        sa.Column("user_id", sa.String(64), nullable=False),
        sa.Column("video_id", sa.String(11), nullable=False),
        sa.Column("title", sa.String(300), nullable=True),
        sa.Column("channel", sa.String(150), nullable=True),
        sa.Column("description", sa.String(1200), nullable=True),
        sa.Column("transcript", sa.Text(), nullable=True),
        sa.Column("duration_seconds", sa.Float(), nullable=True),
        sa.Column("topics", sa.JSON(), nullable=False),
        sa.Column("views", sa.Integer(), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "video_id"),
    )
    op.create_index("ix_rhythm_signals_user_id", "rhythm_signals", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_rhythm_signals_user_id", table_name="rhythm_signals")
    op.drop_table("rhythm_signals")
    op.drop_column("rhythm_profiles", "learned_at")
    op.drop_column("rhythm_profiles", "learned")
