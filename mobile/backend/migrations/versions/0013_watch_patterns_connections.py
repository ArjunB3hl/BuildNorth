"""Watch sleep patterns and account-owned ElevenLabs connections."""
from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("health_days", sa.Column("sleep_pattern", sa.JSON(), nullable=True))
    op.create_table("elevenlabs_credentials",
        sa.Column("user_id", sa.String(64), primary_key=True),
        sa.Column("ciphertext", sa.Text(), nullable=False),
        sa.Column("hint", sa.String(4), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("agent_name", sa.String(120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))


def downgrade() -> None:
    op.drop_table("elevenlabs_credentials")
    op.drop_column("health_days", "sleep_pattern")
