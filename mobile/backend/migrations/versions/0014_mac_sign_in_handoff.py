"""Short-lived Mac browser sign-in handoffs."""
from alembic import op
import sqlalchemy as sa

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("mac_sign_in_handoffs",
        sa.Column("code_hash", sa.String(64), primary_key=True),
        sa.Column("proof_hash", sa.String(64), nullable=False),
        sa.Column("user_id", sa.String(64), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_mac_sign_in_handoffs_expires_at", "mac_sign_in_handoffs", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_mac_sign_in_handoffs_expires_at", table_name="mac_sign_in_handoffs")
    op.drop_table("mac_sign_in_handoffs")
