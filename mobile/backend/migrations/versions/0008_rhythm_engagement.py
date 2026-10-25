"""Rhythm signals record engagement (seconds actually played) and the user's own reaction.

Revision ID: 0008
Revises: 0007
"""

from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("rhythm_signals", sa.Column("played_seconds", sa.Float(), nullable=True))
    op.add_column("rhythm_signals", sa.Column("reaction", sa.String(10), nullable=True))


def downgrade() -> None:
    op.drop_column("rhythm_signals", "reaction")
    op.drop_column("rhythm_signals", "played_seconds")
