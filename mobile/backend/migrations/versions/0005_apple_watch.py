"""apple watch tokens, health days and health sharing

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-21 09:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('health_days',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('user_id', sa.String(length=64), nullable=False),
    sa.Column('date', sa.String(length=10), nullable=False),
    sa.Column('sleep_minutes', sa.Integer(), nullable=True),
    sa.Column('resting_heart_rate_bpm', sa.Integer(), nullable=True),
    sa.Column('hrv_sdnn_ms', sa.Float(), nullable=True),
    sa.Column('steps', sa.Integer(), nullable=True),
    sa.Column('active_energy_kcal', sa.Float(), nullable=True),
    sa.Column('workouts', sa.JSON(), nullable=False),
    sa.Column('complete', sa.Boolean(), nullable=False),
    sa.Column('source', sa.String(length=20), nullable=False),
    sa.Column('memory_status', sa.String(length=20), nullable=False),
    sa.Column('memory_scope', sa.String(length=200), nullable=True),
    sa.Column('memory_text', sa.String(length=500), nullable=True),
    sa.Column('revision', sa.String(length=32), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'date', name='uq_health_days_user_date')
    )
    with op.batch_alter_table('health_days', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_health_days_user_id'), ['user_id'], unique=False)

    op.create_table('watch_tokens',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('user_id', sa.String(length=64), nullable=False),
    sa.Column('label', sa.String(length=80), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('hint', sa.String(length=12), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_hash')
    )
    with op.batch_alter_table('watch_tokens', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_watch_tokens_user_id'), ['user_id'], unique=False)

    # Off for everyone until they turn it on in the app.
    with op.batch_alter_table('profiles', schema=None) as batch_op:
        batch_op.add_column(sa.Column('share_health', sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('profiles', schema=None) as batch_op:
        batch_op.drop_column('share_health')

    with op.batch_alter_table('watch_tokens', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_watch_tokens_user_id'))

    op.drop_table('watch_tokens')
    with op.batch_alter_table('health_days', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_health_days_user_id'))

    op.drop_table('health_days')
