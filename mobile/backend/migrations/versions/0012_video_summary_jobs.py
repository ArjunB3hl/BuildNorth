"""Recoverable, per-video claims for automatic library summaries."""
from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("rhythm_signals", sa.Column("summary_requested_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("rhythm_signals", "summary_requested_at")
