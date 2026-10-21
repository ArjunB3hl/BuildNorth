"""preference source and coach reply context

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-16 18:05:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('remembered_preferences') as batch:
        batch.add_column(sa.Column('source', sa.String(length=20), nullable=False, server_default='app'))
        batch.add_column(sa.Column('source_detail', sa.String(length=160), nullable=True))
    with op.batch_alter_table('coach_messages') as batch:
        batch.add_column(sa.Column('context', sa.JSON(), nullable=True))

    # Preferences saved by approving an assistant's proposal are credited to that assistant.
    bind = op.get_bind()
    proposals = sa.table('assistant_proposals', sa.column('kind', sa.String), sa.column('status', sa.String),
                         sa.column('client', sa.String), sa.column('result', sa.JSON))
    prefs = sa.table('remembered_preferences', sa.column('id', sa.String), sa.column('source', sa.String),
                     sa.column('source_detail', sa.String))
    rows = bind.execute(sa.select(proposals.c.client, proposals.c.result)
                        .where(proposals.c.kind == 'preference', proposals.c.status == 'applied'))
    for client, result in rows:
        pref_id = (result or {}).get('preference_id') if isinstance(result, dict) else None
        if pref_id and not (result or {}).get('note'):
            bind.execute(sa.update(prefs).where(prefs.c.id == pref_id).values(source='assistant', source_detail=(client or '')[:160]))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('coach_messages') as batch:
        batch.drop_column('context')
    with op.batch_alter_table('remembered_preferences') as batch:
        batch.drop_column('source_detail')
        batch.drop_column('source')
