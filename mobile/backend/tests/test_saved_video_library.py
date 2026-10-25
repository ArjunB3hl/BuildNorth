"""Extension saves become account-owned, actionable library notes, even with recommendations disabled."""
from dataclasses import replace
from datetime import timedelta
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import select

from conftest import ALICE, BOB, auth
from app.ai import AIError
from app.main import app
from app.models import ClaudeCredential, RhythmSignal, utcnow
from app.rhythm import saved, summaries
from app.rhythm.policy import Actor, run
from test_rhythm_learning import settings, watched

VIDEO_ID = "vid00000001"


def setup_library(client):
    app.state.rhythm_settings = replace(app.state.rhythm_settings, recommendations=False)
    client.put("/rhythm/settings", headers=auth(), json=settings(learning=False))


def save_video(client, transcript="Add 1 cup of lentils. Simmer for 20 minutes."):
    return client.post("/rhythm/reactions", headers=auth(), json={
        **watched("Easy lentil soup recipe", transcript=transcript), "reaction": "more"})


def row():
    with app.state.session_factory() as db:
        return db.scalar(select(RhythmSignal).where(RhythmSignal.user_id == ALICE))


def clear_notes():
    with app.state.session_factory() as db:
        video = db.scalar(select(RhythmSignal).where(RhythmSignal.user_id == ALICE))
        video.summary = None
        video.summarized_at = None
        db.commit()


def test_save_generates_recipe_notes_with_title_and_canonical_link(client, fake_ai):
    setup_library(client)
    fake_ai.video_notes = {"kind": "cooking", "overview": "Make lentil soup.", "sections": [
        {"heading": "Ingredients", "numbered": False, "items": ["1 cup lentils"]},
        {"heading": "Cooking instructions", "numbered": True, "items": ["Add the lentils.", "Simmer for 20 minutes."]},
        {"heading": "Missing details", "numbered": False, "items": ["Liquid quantity was not stated."]},
    ]}
    assert save_video(client).json()["status"] == "ok"
    video = client.get("/rhythm/saved", headers=auth()).json()["savedVideos"][0]
    assert video["title"] == "Easy lentil soup recipe"
    assert video["url"] == f"https://www.youtube.com/watch?v={VIDEO_ID}"
    assert video["channel"] == "Fixture channel"
    assert "Ingredients\n• 1 cup lentils" in video["summary"]
    assert "2. Simmer for 20 minutes." in video["summary"]
    assert video["summaryState"] == "ready" and video["summarizedAt"]
    assert video["hasTranscript"] and video["transcript"] is None
    model_call = next(c for c in fake_ai.calls if c["schema"] is summaries.SUMMARY_SCHEMA)
    assert "Simmer for 20 minutes" in model_call["messages"][0]["content"]
    assert "Never invent missing" in model_call["system"]
    assert "untrusted data" in model_call["system"]
    # Claude rejects these constraints at the API boundary; local validation still rejects empty/oversized output.
    schema = json.dumps(model_call["schema"])
    assert not any(keyword in schema for keyword in ("minLength", "maxLength", "minItems", "maxItems"))
    # Re-saving the same video doesn't charge for another generation or duplicate its library card.
    save_video(client)
    assert len([c for c in fake_ai.calls if c["schema"] is summaries.SUMMARY_SCHEMA]) == 1
    assert len(client.get("/rhythm/saved", headers=auth()).json()["savedVideos"]) == 1


@pytest.mark.parametrize("kind,heading,items", [
    ("exercise", "Movement steps", ["Stand with feet shoulder width apart.", "Lower into a squat for 8 reps."]),
    ("ideas", "Practical takeaways", ["Use the speaker's shopping checklist."]),
])
def test_notes_keep_content_specific_steps(client, fake_ai, kind, heading, items):
    setup_library(client)
    fake_ai.video_notes = {"kind": kind, "overview": "Useful notes.", "sections": [
        {"heading": heading, "numbered": True, "items": items}]}
    save_video(client)
    summary = client.get("/rhythm/saved", headers=auth()).json()["savedVideos"][0]["summary"]
    assert heading in summary and f"1. {items[0]}" in summary


def test_library_is_private_and_agent_permissions_still_apply(client, fake_ai):
    setup_library(client)
    save_video(client)
    assert client.get("/rhythm/saved").status_code == 401
    assert client.get("/rhythm/saved", headers=auth(BOB)).json()["savedVideos"] == []
    assert client.post(f"/rhythm/saved/{VIDEO_ID}/summary", headers=auth(BOB)).json()["status"] == "not_found"
    assert run(app, Actor(ALICE, "unapproved-agent"), lambda p: saved.listing(p, False, 10)).status == "permission_required"
    assert client.post("/rhythm/saved/not-a-video-id/summary", headers=auth()).status_code == 422


def test_no_transcript_keeps_metadata_without_inventing_instructions(client, fake_ai):
    setup_library(client)
    save_video(client, transcript=None)
    video = client.get("/rhythm/saved", headers=auth()).json()["savedVideos"][0]
    assert video["summary"] is None and video["summaryState"] == "no_transcript"
    assert video["url"].endswith(VIDEO_ID)
    assert not any(c["schema"] is summaries.SUMMARY_SCHEMA for c in fake_ai.calls)
    assert client.post(f"/rhythm/saved/{VIDEO_ID}/summary", headers=auth()).json()["status"] == "transcript_unavailable"
    save_video(client)
    assert row().summary is not None


def test_failed_generation_can_be_retried_and_has_no_false_ready_status(client, fake_ai):
    setup_library(client)
    fake_ai.error = AIError("unavailable", "AI unavailable.")
    assert save_video(client).json()["status"] == "ok"
    assert row().summary is None and row().summary_requested_at is None
    assert client.get("/rhythm/saved", headers=auth()).json()["savedVideos"][0]["summaryState"] == "not_ready"
    fake_ai.error = None
    assert client.post(f"/rhythm/saved/{VIDEO_ID}/summary", headers=auth()).json()["status"] == "ok"
    assert row().summary


def test_duplicate_and_expired_generation_claims(client, fake_ai):
    setup_library(client)
    save_video(client)
    clear_notes()
    with app.state.session_factory() as db:
        video = db.get(RhythmSignal, row().id)
        video.summary_requested_at = utcnow()
        db.commit()
    count = len(fake_ai.calls)
    assert summaries.summarize(app, ALICE, VIDEO_ID, fake_ai).status == "pending"
    assert len(fake_ai.calls) == count
    with app.state.session_factory() as db:
        video = db.get(RhythmSignal, row().id)
        video.summary_requested_at = utcnow() - timedelta(minutes=11)
        db.commit()
    assert summaries.summarize(app, ALICE, VIDEO_ID, fake_ai).status == "ok"


@pytest.mark.parametrize("change", ["delete", "transcript", "agent", "unsave"])
def test_inflight_result_never_resurrects_or_overwrites_changed_data(client, fake_ai, change):
    setup_library(client)
    save_video(client)
    clear_notes()

    def generate(**kwargs):
        if change == "agent":
            run(app, Actor(ALICE), lambda p: saved.save_summary(p, VIDEO_ID, "New notes from the chosen agent."))
        else:
            with app.state.session_factory() as db:
                video = db.get(RhythmSignal, row().id)
                if change == "delete":
                    db.delete(video)
                elif change == "unsave":
                    video.reaction = "less"
                else:
                    video.transcript = "A different transcript."
                db.commit()
        return fake_ai.video_notes

    result = summaries.summarize(app, ALICE, VIDEO_ID, SimpleNamespace(generate_json=generate))
    assert result.status == "stale_context"
    if change == "delete":
        assert row() is None
    else:
        assert row().summary == ("New notes from the chosen agent." if change == "agent" else None)
        assert row().summary_requested_at is None


def test_connected_account_key_is_used_and_closed(client, fake_ai, monkeypatch):
    setup_library(client)
    save_video(client)
    clear_notes()
    with app.state.session_factory() as db:
        db.add(ClaudeCredential(user_id=ALICE, ciphertext="test-only", hint="test", model="test"))
        db.commit()
    personal = SimpleNamespace(generate_json=Mock(return_value=fake_ai.video_notes), _client=SimpleNamespace(close=Mock()))
    factory = Mock(return_value=personal)
    monkeypatch.setattr(summaries, "personal_provider", factory)
    assert summaries.summarize(app, ALICE, VIDEO_ID, None).status == "ok"
    assert factory.call_args.args[1].user_id == ALICE
    personal.generate_json.assert_called_once()
    personal._client.close.assert_called_once()


def test_invalid_model_output_is_not_published(client, fake_ai):
    setup_library(client)
    fake_ai.video_notes = {"kind": "cooking", "overview": "", "sections": []}
    save_video(client)
    assert row().summary is None and row().summary_requested_at is None
