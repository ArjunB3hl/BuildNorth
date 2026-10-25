"""Create an isolated, explicitly labelled profile/task FIXTURE for a real MCP client check.

No application authentication is bypassed or changed. This operator-only script seeds a NEW
scratch database and a normal revocable Rhythm bearer credential. It does not claim a phone
sign-in, YouTube search, transcript extraction, or SurrealDB connection was tested.
"""

import argparse
import json
import os
from datetime import datetime
from pathlib import Path

from app.db import make_engine, make_session_factory, migrate
from app.models import RhythmTask
from app.rhythm import grants, profile, tasks
from app.rhythm.config import RhythmSettings
from app.rhythm.policy import Actor, Policy
from app.rhythm.schemas import AgentApproval, InterestsInput, TaskInput, VideoMetadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True, help="Private scratch directory; its rhythm.db must not exist.")
    parser.add_argument("--metadata", type=Path, required=True, help="JSON with metadata and capturedAt from an observed watch page.")
    args = parser.parse_args()
    directory = args.directory.resolve()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    database = directory / "rhythm.db"
    if database.exists():
        raise SystemExit("Refusing to seed an existing database. Choose a new scratch directory.")
    capture = json.loads(args.metadata.read_text())
    metadata = VideoMetadata.model_validate(capture["metadata"])
    database_url = f"sqlite:///{database}"
    migrate(database_url)
    engine = make_engine(database_url)
    factory = make_session_factory(engine)
    user = "user_RhythmFixture"
    settings = RhythmSettings()
    try:
        with factory() as db:
            p = Policy(db, Actor(user), settings)
            profile.save_interests(p, InterestsInput(
                expected_revision=0, original_goal_text="[DEMO FIXTURE] Beginner boxing and home workouts without equipment; skip fight news, BJJ and weight loss.",
                topics=["boxing", "home exercise"], purposes=["learn technique", "follow a workout"],
                experience_level="beginner", preferred_duration_minutes=10, available_equipment=["No equipment"],
                excluded_topics=["BJJ", "weight loss"], excluded_content_types=["fight highlights", "news"],
                enabled_sites=["youtube"], consent={"metadata": True, "transcripts": True, "agent": True, "memory": False},
            ))
            token, agent = grants.mint_token(p, "Isolated MCP client check",
                AgentApproval(capabilities=["interests", "page", "search", "transcripts", "recommend", "memory", "feedback"]))
            task = tasks.create(p, TaskInput(
                action="evaluate", request="[DEMO FIXTURE] Recommend this observed video from metadata only; explain missing information.",
                analyze_transcripts=False, agent_id=agent.id, idempotency_key="isolated-fixture-task",
            )).task
            row = p.owned(RhythmTask, task.id)
            candidate = tasks.add_candidate(p, row, metadata, "selected_page")
            candidate.captured_at = datetime.fromisoformat(capture["capturedAt"].replace("Z", "+00:00"))
            db.commit()
        token_file = directory / "mcp-token"
        descriptor = os.open(token_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as file:
            file.write(token)
        manifest = {"fixture": True, "userId": user, "taskId": task.id, "candidateId": candidate.id,
                    "videoId": metadata.video_id, "databaseUrl": database_url}
        (directory / "demo.json").write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"FIXTURE created: {database}")
        print(f"Credential written privately to {token_file}; its value is not printed.")
        print(f"Task: {task.id}; candidate: {candidate.id}. Profile is a fixture; source metadata is supplied by the operator.")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
