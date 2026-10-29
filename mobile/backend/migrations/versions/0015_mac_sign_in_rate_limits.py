"""Shared counters for Mac browser sign-in rate limits."""
from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("mac_sign_in_rate_buckets",
        sa.Column("key_hash", sa.String(64), primary_key=True),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.BigInteger(), nullable=False))
    op.create_index("ix_mac_sign_in_rate_buckets_expires_at", "mac_sign_in_rate_buckets", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_mac_sign_in_rate_buckets_expires_at", table_name="mac_sign_in_rate_buckets")
    op.drop_table("mac_sign_in_rate_buckets")
