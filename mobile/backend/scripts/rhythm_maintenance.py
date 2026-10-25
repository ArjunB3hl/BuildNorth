"""Purge expired Rhythm content, retry private-memory erasures and re-learn interests (so they fade). No agents or video IO."""

from types import SimpleNamespace

from sqlalchemy import select, union

from app.ai import build_provider
from app.config import load_settings
from app.db import make_engine, make_session_factory, migrate
from app.models import RhythmBrowser, RhythmMemory, RhythmProfile, RhythmTask, RhythmTranscript, RhythmUsage
from app.rhythm.config import RhythmSettings
from app.rhythm.learn import refresh_all
from app.rhythm.memory import Registry, synchronize
from app.rhythm.policy import Actor, Policy, cleanup


def main():
    settings = load_settings()
    rhythm = RhythmSettings.load()
    migrate(settings.database_url)
    engine = make_engine(settings.database_url)
    factory = make_session_factory(engine)
    registry = Registry(rhythm.memory_contexts_json, settings.spectron_url, settings.spectron_context_id,
                        app_api_key=settings.spectron_api_key, app_user_id=settings.spectron_owner_user_id)
    app = SimpleNamespace(state=SimpleNamespace(session_factory=factory, rhythm_settings=rhythm, rhythm_memory=registry))
    try:
        with factory() as db:
            users = list(db.scalars(union(*(select(table.user_id) for table in (
                RhythmProfile, RhythmTask, RhythmTranscript, RhythmMemory, RhythmUsage, RhythmBrowser,
            )))))
        states: dict[str, int] = {}
        for user in users:
            with factory() as db:
                Policy(db, Actor(user), rhythm)  # same row lock as foreground requests
                cleanup(db, user, rhythm.timezone)
                db.commit()
            state = synchronize(app, user)
            states[state] = states.get(state, 0) + 1
        print(f"Retention processed for {len(users)} user(s). Private-memory outcomes: {states}")
        ai, _reason = build_provider(settings)
        print(f"Interests re-learned: {refresh_all(app, ai)}")
    finally:
        registry.close()
        engine.dispose()


if __name__ == "__main__":
    main()
