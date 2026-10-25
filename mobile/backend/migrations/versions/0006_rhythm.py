"""Phone interests, scoped browser/agent grants, bounded video tasks and private caches.

Revision ID: 0006
Revises: 0005
"""

from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def timestamps():
    return [sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False)]


def col(name, type_, nullable=False):
    return sa.Column(name, type_, nullable=nullable)


def create(name, *columns, constraints=()):
    op.create_table(name, col("id", sa.String(32)), col("user_id", sa.String(64)),
                    *columns, sa.PrimaryKeyConstraint("id"), *constraints)
    op.create_index(f"ix_{name}_user_id", name, ["user_id"])


def upgrade():
    with op.batch_alter_table("connection_tokens") as table:
        table.add_column(sa.Column("purpose", sa.String(20), nullable=False, server_default="buildnorth"))
    op.create_table("rhythm_profiles", col("user_id", sa.String(64)), col("revision", sa.Integer()),
                    col("confirmed", sa.Boolean()), col("data", sa.JSON()), *timestamps(),
                    sa.PrimaryKeyConstraint("user_id"))
    create("rhythm_agents", col("client_id", sa.String(500)), col("label", sa.String(160)),
           col("status", sa.String(20)), col("capabilities", sa.JSON()), *timestamps(),
           constraints=[sa.UniqueConstraint("user_id", "client_id")])
    create("rhythm_browsers", col("label", sa.String(80)), col("status", sa.String(20)),
           col("page_ref", sa.String(32)), col("video_id", sa.String(11)), col("page_metadata", sa.JSON(), True),
           col("captured_at", sa.DateTime(timezone=True)), col("last_seen_at", sa.DateTime(timezone=True)),
           col("allow_transcripts", sa.Boolean()), *timestamps())
    create("rhythm_tasks", col("agent_id", sa.String(32), True), col("browser_session_id", sa.String(32), True),
           col("action", sa.String(20)), col("request", sa.String(600)), col("status", sa.String(20)),
           col("profile_revision", sa.Integer()), col("analyze_transcripts", sa.Boolean()),
           col("idempotency_key", sa.String(100)), col("candidate_checks", sa.Integer()),
           col("transcript_attempts", sa.Integer()), col("cache_hits", sa.Integer()),
           col("search_requests", sa.Integer()), col("candidate_reservations", sa.Integer()), col("search_state", sa.JSON()),
           col("expires_at", sa.DateTime(timezone=True)), *timestamps(),
           constraints=[sa.UniqueConstraint("user_id", "idempotency_key")])
    create("rhythm_candidates", col("task_id", sa.String(32)), col("video_id", sa.String(11)),
           col("page_metadata", sa.JSON(), True), col("relevance", sa.JSON()), col("source", sa.String(20)),
           col("captured_at", sa.DateTime(timezone=True)), col("shortlisted", sa.Boolean()),
           col("transcript_id", sa.String(32), True), col("delivered_segments", sa.JSON()),
           constraints=[sa.UniqueConstraint("task_id", "video_id")])
    op.create_index("ix_rhythm_candidates_task_id", "rhythm_candidates", ["task_id"])
    create("rhythm_transcripts", col("video_id", sa.String(11)), col("language", sa.String(30), True),
           col("source", sa.String(30)), col("completeness", sa.String(20)), col("browser_session_id", sa.String(32), True),
           col("page_ref", sa.String(32), True), col("segments", sa.JSON()), col("limitation", sa.String(300)),
           col("captured_at", sa.DateTime(timezone=True)), col("expires_at", sa.DateTime(timezone=True)))
    op.create_index("ix_rhythm_transcripts_video_id", "rhythm_transcripts", ["video_id"])
    create("rhythm_browser_requests", col("task_id", sa.String(32)), col("candidate_id", sa.String(32)),
           col("browser_session_id", sa.String(32)), col("page_ref", sa.String(32)), col("video_id", sa.String(11)),
           col("language", sa.String(30), True), col("profile_revision", sa.Integer()), col("status", sa.String(30)),
           col("created_at", sa.DateTime(timezone=True)), col("expires_at", sa.DateTime(timezone=True)),
           constraints=[sa.UniqueConstraint("task_id", "candidate_id")])
    create("rhythm_recommendations", col("task_id", sa.String(32)), col("video_id", sa.String(11)),
           col("profile_revision", sa.Integer()), col("data", sa.JSON()), col("feedback", sa.String(20), True),
           col("feedback_reason", sa.String(300)), col("created_at", sa.DateTime(timezone=True)),
           col("displayed_at", sa.DateTime(timezone=True), True), col("displayed_browser_id", sa.String(32), True),
           constraints=[sa.UniqueConstraint("task_id", "video_id")])
    create("rhythm_memories", col("text", sa.String(500)), col("evidence_ref", sa.String(32), True),
           col("status", sa.String(20)), col("memory_status", sa.String(20)), col("scope", sa.String(255), True),
           col("context_id", sa.String(200), True),
           *timestamps())
    create("rhythm_usage", col("day", sa.String(10)), col("candidate_checks", sa.Integer()),
           col("transcript_attempts", sa.Integer()), col("cache_hits", sa.Integer()),
           col("blocked_requests", sa.Integer()), col("provider_failures", sa.Integer()), col("search_requests", sa.Integer()),
           constraints=[sa.UniqueConstraint("user_id", "day")])


def downgrade():
    for name in ("usage", "memories", "recommendations", "browser_requests", "transcripts", "candidates",
                 "tasks", "browsers", "agents", "profiles"):
        op.drop_table(f"rhythm_{name}")
    with op.batch_alter_table("connection_tokens") as table:
        table.drop_column("purpose")
