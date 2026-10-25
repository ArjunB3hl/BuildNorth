"""Saved videos keep the summary the user's chosen agent writes through MCP.

Revision ID: 0009
Revises: 0008
"""

from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("rhythm_signals", sa.Column("summary", sa.Text(), nullable=True))
    op.add_column("rhythm_signals", sa.Column("summarized_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("rhythm_signals", sa.Column("summary_by", sa.String(160), nullable=True))


def downgrade() -> None:
    op.drop_column("rhythm_signals", "summary_by")
    op.drop_column("rhythm_signals", "summarized_at")
    op.drop_column("rhythm_signals", "summary")
