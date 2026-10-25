"""Rhythm learns interests from activity: consent, what's kept, how it's learned, decay, and deletion."""

from dataclasses import replace
from datetime import timedelta

from conftest import ALICE, BOB, auth
from sqlalchemy import func, select

from app.ai import AIError
from app.main import app
from app.models import RhythmProfile, RhythmSignal, utcnow
from app.rhythm import learn


def settings(revision=0, learning=True, **consent):
    return {
        "expectedRevision": revision,
        "enabledSites": ["youtube"],
        "consent": {"metadata": True, "transcripts": False, "agent": False, "memory": False, "learn": learning, **consent},
    }


def watched(title, n=1, duration=600, description=None, transcript=None):
    video_id = f"vid{n:08d}"
    body = {
        "metadata": {"videoId": video_id, "canonicalUrl": f"https://www.youtube.com/watch?v={video_id}",
                     "title": title, "channelName": "Fixture channel", "descriptionExcerpt": description,
                     "durationSeconds": duration},
        "capturedAt": utcnow().isoformat(),
    }
    if transcript:
        body["transcript"] = {"segments": [{"startSeconds": 0, "text": transcript}]}
    return body


def profile_row(user=ALICE):
    with app.state.session_factory() as db:
        return db.get(RhythmProfile, user)


def signal_count(user=ALICE):
    with app.state.session_factory() as db:
        return db.scalar(select(func.count()).select_from(RhythmSignal).where(RhythmSignal.user_id == user))


def test_learning_needs_the_users_own_switch(client):
    assert client.post("/rhythm/signals", json=watched("Beginner boxing drill")).status_code == 401
    assert client.post("/rhythm/signals", headers=auth(), json=watched("Beginner boxing drill")).json()["status"] == "permission_required"
    saved = client.put("/rhythm/settings", headers=auth(), json=settings(learning=False)).json()
    assert saved["profile"]["profileRevision"] == 1 and not saved["profile"]["confirmed"]
    assert client.post("/rhythm/signals", headers=auth(), json=watched("Beginner boxing drill")).json()["status"] == "permission_required"
    # Nothing learned yet: the profile says so instead of asking for typed-in interests.
    assert "hasn't learned" in client.get("/rhythm/interests", headers=auth()).json()["message"]
    assert signal_count() == 0


def test_only_fitness_health_and_food_videos_are_kept(client, fake_ai):
    client.put("/rhythm/settings", headers=auth(), json=settings())
    assert client.post("/rhythm/signals", headers=auth(), json=watched("Top 10 movie trailers", 1)).json()["status"] == "irrelevant"
    assert client.post("/rhythm/signals", headers=auth(), json=watched("Championship boxing fight highlights", 2)).json()["status"] == "irrelevant"
    assert client.post("/rhythm/signals", headers=auth(), json=watched("BJJ guard passing basics", 3)).json()["status"] == "irrelevant"
    assert client.post("/rhythm/signals", headers=auth(), json=watched("Beginner boxing footwork drill", 4)).json()["status"] == "ok"
    # Re-watching updates the one row rather than adding another.
    assert client.post("/rhythm/signals", headers=auth(), json=watched("Beginner boxing footwork drill", 4)).json()["status"] == "ok"
    assert signal_count() == 1


def test_watched_videos_teach_interests_and_keep_the_switches(client, fake_ai):
    client.put("/rhythm/settings", headers=auth(), json=settings())
    for n, title in enumerate(["Beginner boxing footwork drill", "Boxing jab technique for beginners",
                               "Shadow boxing basics tutorial"], start=1):
        client.post("/rhythm/signals", headers=auth(), json=watched(title, n, duration=600))
    assert learn.refresh(app, ALICE, fake_ai, force=True) == "ok"
    row = profile_row()
    assert row.data["topics"] == ["boxing"]
    assert "learn technique" in row.data["purposes"]
    assert row.data["experience_level"] == "beginner"
    assert row.data["preferred_duration_minutes"] == 10
    assert row.confirmed
    assert row.data["consent"]["learn"] and row.data["consent"]["metadata"] and row.data["enabled_sites"] == ["youtube"]
    revision = row.revision
    # The same evidence again changes nothing, so open tasks aren't made stale for no reason.
    assert learn.refresh(app, ALICE, fake_ai, force=True) == "ok"
    assert profile_row().revision == revision
    # Screening now uses what was learned.
    page = client.post("/rhythm/browsers", headers=auth(), json={
        "metadata": watched("Boxing slip drill tutorial", 9)["metadata"], "capturedAt": utcnow().isoformat(),
        "allowTranscripts": False, "expectedRevision": revision}).json()
    assert page["browser"]["available"]
    # The evidence is available to the user (not displayed in the apps).
    view = client.get("/rhythm/learned", headers=auth()).json()["learned"]
    boxing = next(i for i in view["interests"] if i["topic"] == "boxing")
    assert boxing["state"] == "learned" and boxing["videos"] == 3 and view["counts"]["videos"] == 3
    assert view["experienceLevel"] == {"value": "beginner", "source": "learned"}


def test_coach_chats_teach_interests_in_the_background(client, fake_ai):
    client.put("/rhythm/settings", headers=auth(), json=settings())
    client.post("/coach/messages", headers=auth(), json={"content": "I want to start karate as a beginner, any drills?"})
    row = profile_row()
    assert row.learned_at is not None
    assert row.data["topics"] == ["karate"] and row.data["experience_level"] == "beginner"
    assert client.get("/rhythm/learned", headers=auth()).json()["learned"]["counts"]["chats"] == 1
    # Another account learns nothing from Alice's chats.
    client.put("/rhythm/settings", headers=auth(BOB), json=settings())
    assert learn.refresh(app, BOB, fake_ai, force=True) == "ok"
    assert profile_row(BOB).data["topics"] == []


def test_the_model_corroborates_and_avoidances_must_be_the_users_words(client, fake_ai):
    client.put("/rhythm/settings", headers=auth(), json=settings())
    fake_ai.learn = {"topics": ["food"], "purposes": [], "experience_level": "unknown", "avoid": ["burpees", "weight loss"]}
    client.post("/coach/messages", headers=auth(), json={"content": "Please skip burpees, I want boxing drills"})
    row = profile_row()
    assert row.data["topics"] == ["boxing"]          # the model's 'food' alone isn't enough
    assert row.data["excluded_topics"] == ["burpees"]  # 'weight loss' was never said, so it's dropped
    assert learn.LEARN_SYSTEM in [c["system"] for c in fake_ai.calls]


def test_a_failed_model_still_learns_from_the_vocabulary(client, fake_ai):
    client.put("/rhythm/settings", headers=auth(), json=settings())
    client.post("/rhythm/signals", headers=auth(), json=watched("Easy vegetarian recipe for meal prep", 1))
    fake_ai.error = AIError("timeout", "slow")
    assert learn.refresh(app, ALICE, fake_ai, force=True) == "ok"
    row = profile_row()
    assert row.data["topics"] == ["food"] and row.data["purposes"] == ["find recipes"]
    assert row.learned["model"] == "unavailable (timeout)"


def test_interests_fade_and_old_signals_are_removed(client, fake_ai):
    client.put("/rhythm/settings", headers=auth(), json=settings())
    client.post("/rhythm/signals", headers=auth(), json=watched("Gym strength training workout", 1))
    # ("workout" alone also counts as gym in the shared vocabulary, so this title avoids it.)
    client.post("/rhythm/signals", headers=auth(), json=watched("Bodyweight home exercise with no equipment", 2))
    client.post("/rhythm/signals", headers=auth(), json=watched("Gym leg day workout", 3))
    with app.state.session_factory() as db:
        for row in db.scalars(select(RhythmSignal)):
            if "Gym" in (row.title or ""):
                row.observed_at = utcnow() - timedelta(days=40)
        db.add(RhythmSignal(user_id=ALICE, video_id="vid00000099", title="Karate kata tutorial", topics=["karate"],
                            views=1, observed_at=utcnow() - timedelta(days=61)))
        db.commit()
    assert learn.refresh(app, ALICE, fake_ai, force=True) == "ok"
    row = profile_row()
    assert row.data["topics"] == ["home exercise"]  # six weeks old gym videos have faded
    assert signal_count() == 3                       # the 61-day-old one was removed


def test_switching_learning_off_deletes_signals_and_stops_learning(client, fake_ai):
    client.put("/rhythm/settings", headers=auth(), json=settings())
    client.post("/rhythm/signals", headers=auth(), json=watched("Beginner boxing footwork drill", 1))
    assert signal_count() == 1
    revision = profile_row().revision
    client.put("/rhythm/settings", headers=auth(), json=settings(revision=revision, learning=False))
    assert signal_count() == 0
    assert learn.refresh(app, ALICE, fake_ai, force=True) == "off"


def test_deleting_rhythm_data_removes_signals(client, fake_ai):
    client.put("/rhythm/settings", headers=auth(), json=settings())
    client.post("/rhythm/signals", headers=auth(), json=watched("Beginner boxing footwork drill", 1))
    result = client.delete("/rhythm/data", headers=auth()).json()
    assert result["deletedRecords"]["rhythm_signals"] == 1
    assert signal_count() == 0 and profile_row() is None


def test_daily_learning_limit(client, fake_ai, monkeypatch):
    monkeypatch.setattr(learn, "SIGNALS_PER_DAY", 2)
    client.put("/rhythm/settings", headers=auth(), json=settings())
    assert client.post("/rhythm/signals", headers=auth(), json=watched("Boxing drill one", 1)).json()["status"] == "ok"
    assert client.post("/rhythm/signals", headers=auth(), json=watched("Boxing drill two", 2)).json()["status"] == "ok"
    assert client.post("/rhythm/signals", headers=auth(), json=watched("Boxing drill three", 3)).json()["status"] == "budget_exceeded"
    # Re-watching a kept video is still recorded.
    assert client.post("/rhythm/signals", headers=auth(), json=watched("Boxing drill one", 1)).json()["status"] == "ok"


def test_switching_learning_off_forgets_what_was_learned_but_keeps_older_typed_interests(client, fake_ai):
    from test_rhythm import interests
    # An account still holding interests typed into the old form keeps them while learning stays off.
    client.put("/rhythm/interests", headers=auth(BOB), json=interests())
    client.put("/rhythm/settings", headers=auth(BOB), json=settings(revision=1, learning=False, transcripts=True))
    assert profile_row(BOB).data["topics"] == ["boxing", "home exercise"]
    # Learned interests are forgotten when learning goes from on to off.
    client.put("/rhythm/settings", headers=auth(), json=settings())
    client.post("/rhythm/signals", headers=auth(), json=watched("Beginner boxing footwork drill", 1))
    assert learn.refresh(app, ALICE, fake_ai, force=True) == "ok"
    row = profile_row()
    assert row.data["topics"] == ["boxing"] and row.learned
    client.put("/rhythm/settings", headers=auth(), json=settings(revision=row.revision, learning=False))
    row = profile_row()
    assert row.data["topics"] == [] and not row.confirmed and row.learned is None and row.learned_at is None
    assert signal_count() == 0


def test_learning_never_interrupts_an_open_task(client, fake_ai):
    client.put("/rhythm/settings", headers=auth(), json=settings())
    client.post("/rhythm/signals", headers=auth(), json=watched("Beginner boxing footwork drill", 1))
    assert learn.refresh(app, ALICE, fake_ai, force=True) == "ok"
    revision = profile_row().revision
    task = client.post("/rhythm/tasks", headers=auth(), json={
        "action": "recommend", "request": "Boxing drills", "analyzeTranscripts": False, "idempotencyKey": "task-key-1"}).json()
    assert task["task"]["status"] == "active"
    client.post("/rhythm/signals", headers=auth(), json=watched("Easy vegetarian recipe for meal prep", 2))
    client.post("/rhythm/signals", headers=auth(), json=watched("Quick vegetarian dinner recipe", 3))
    assert learn.refresh(app, ALICE, fake_ai, force=True) == "ok"
    row = profile_row()
    assert row.revision == revision and row.learned["deferred"]   # the task keeps working
    assert client.get(f"/rhythm/tasks/{task['taskId']}", headers=auth()).json()["task"]["status"] == "active"
    client.delete(f"/rhythm/tasks/{task['taskId']}", headers=auth())
    assert learn.refresh(app, ALICE, fake_ai) == "ok"                # deferred work isn't throttled
    assert "food" in profile_row().data["topics"]


def test_videos_matching_the_users_exclusions_are_not_kept(client, fake_ai):
    from test_rhythm import interests
    client.put("/rhythm/interests", headers=auth(), json=interests(consent={"metadata": True, "transcripts": False,
                                                                             "agent": False, "memory": False, "learn": True}))
    assert client.post("/rhythm/signals", headers=auth(), json=watched("Fat burning boxing workout", 1)).json()["status"] == "irrelevant"
    assert client.post("/rhythm/signals", headers=auth(), json=watched("Beginner boxing footwork drill", 2)).json()["status"] == "ok"
    assert signal_count() == 1



def interest(view, topic):
    return next((i for i in view["interests"] if i["topic"] == topic), None)


def test_brief_views_count_less_than_watched_ones(client, fake_ai):
    client.put("/rhythm/settings", headers=auth(), json=settings())
    # One video skimmed for 15 seconds isn't enough to learn an interest; one actually watched is.
    skim = watched("Karate kata tutorial", 1, duration=600)
    skim["engagement"] = {"playedSeconds": 15}
    client.post("/rhythm/signals", headers=auth(), json=skim)
    assert learn.refresh(app, ALICE, fake_ai, force=True) == "ok"
    assert profile_row().data["topics"] == []
    full = watched("Karate kumite drills for beginners", 2, duration=600)
    full["engagement"] = {"playedSeconds": 420}
    client.post("/rhythm/signals", headers=auth(), json=full)
    assert learn.refresh(app, ALICE, fake_ai, force=True) == "ok"
    assert profile_row().data["topics"] == ["karate"]


def test_save_to_rhythm_and_not_interested(client, fake_ai):
    client.put("/rhythm/settings", headers=auth(), json=settings(learning=False))
    # Without learning, "Save to Rhythm" pins what the video is about.
    saved = client.post("/rhythm/reactions", headers=auth(), json={**watched("Beginner boxing footwork drill", 1), "reaction": "more"}).json()
    assert saved["status"] == "ok"
    row = profile_row()
    assert row.data["topics"] == ["boxing"] and row.data["choices"]["pinned"] == ["boxing"] and row.confirmed
    # "Not interested" keeps that video out of tasks, whatever its topic.
    client.post("/rhythm/reactions", headers=auth(), json={**watched("Boxing slip drill tutorial", 2), "reaction": "less"})
    task = client.post("/rhythm/tasks", headers=auth(), json={
        "action": "evaluate", "request": "Check it", "analyzeTranscripts": False, "idempotencyKey": "task-key-2"}).json()
    page = client.post("/rhythm/browsers", headers=auth(), json={
        "metadata": watched("Boxing slip drill tutorial", 2)["metadata"], "capturedAt": utcnow().isoformat(),
        "allowTranscripts": False, "expectedRevision": profile_row().revision}).json()
    added = client.post(f"/rhythm/tasks/{task['taskId']}/selected", headers=auth(), json={"browserSessionId": page["browser"]["id"]}).json()
    assert added["candidates"][0]["relevance"]["status"] == "irrelevant"
    # Reactions need page details allowed, like any page Rhythm reads.
    client.put("/rhythm/settings", headers=auth(BOB), json=settings(learning=False, metadata=False))
    assert client.post("/rhythm/reactions", headers=auth(BOB), json={**watched("Boxing drill", 3), "reaction": "more"}).json()["status"] == "permission_required"


def test_not_interested_counts_against_a_topic_when_learning(client, fake_ai):
    client.put("/rhythm/settings", headers=auth(), json=settings())
    client.post("/rhythm/signals", headers=auth(), json=watched("Easy vegetarian recipe", 1))
    assert learn.refresh(app, ALICE, fake_ai, force=True) == "ok"
    assert profile_row().data["topics"] == ["food"]
    client.post("/rhythm/reactions", headers=auth(), json={**watched("Quick vegetarian recipe for dinner", 2), "reaction": "less"})
    assert profile_row().data["topics"] == []  # 1.0 for the watched one, -2.0 for "not interested"


def test_the_users_choices_always_win(client, fake_ai):
    client.put("/rhythm/settings", headers=auth(), json=settings())
    for n, title in enumerate(["Beginner boxing footwork drill", "Boxing jab technique", "Easy vegetarian recipe"], start=1):
        client.post("/rhythm/signals", headers=auth(), json=watched(title, n))
    assert learn.refresh(app, ALICE, fake_ai, force=True) == "ok"
    assert set(profile_row().data["topics"]) == {"boxing", "food"}
    revision = profile_row().revision
    chosen = client.put("/rhythm/choices", headers=auth(), json={
        "expectedRevision": revision, "pinned": ["karate"], "blocked": ["food"], "experienceLevel": "intermediate",
        "preferredDurationMinutes": 20, "availableEquipment": ["dumbbells"]}).json()
    row = profile_row()
    assert row.data["topics"] == ["karate", "boxing"]
    assert row.data["experience_level"] == "intermediate" and row.data["preferred_duration_minutes"] == 20
    assert row.data["available_equipment"] == ["dumbbells"]
    assert interest(chosen["learned"], "food")["state"] == "blocked"
    assert interest(chosen["learned"], "karate")["state"] == "pinned"
    assert chosen["learned"]["experienceLevel"]["source"] == "you"
    # Learning again keeps the choices on top of what it infers.
    assert learn.refresh(app, ALICE, fake_ai, force=True) == "ok"
    assert profile_row().data["topics"] == ["karate", "boxing"]
    # Unpinning removes a pin that has no evidence; unblocking brings learned food back.
    client.put("/rhythm/choices", headers=auth(), json={"expectedRevision": profile_row().revision, "pinned": [], "blocked": []})
    assert learn.refresh(app, ALICE, fake_ai, force=True) == "ok"
    assert set(profile_row().data["topics"]) == {"boxing", "food"}
    assert client.put("/rhythm/choices", headers=auth(), json={"expectedRevision": 0, "pinned": ["food"], "blocked": ["food"]}).status_code == 422


def test_suggestion_and_forget_this(client, fake_ai):
    client.put("/rhythm/settings", headers=auth(), json=settings())
    for n, title in enumerate(["Beginner boxing footwork drill", "Boxing footwork for beginners"], start=1):
        client.post("/rhythm/signals", headers=auth(), json=watched(title, n))
    assert learn.refresh(app, ALICE, fake_ai, force=True) == "ok"
    view = client.get("/rhythm/learned", headers=auth()).json()["learned"]
    assert view["suggestion"] == {"topic": "boxing",
                                  "text": "You've watched 2 beginner boxing videos recently. Want more boxing drills and technique videos?"}
    # "Yes" pins it and the prompt doesn't come back.
    yes = client.put("/rhythm/choices", headers=auth(), json={
        "expectedRevision": profile_row().revision, "pinned": ["boxing"], "acknowledged": ["boxing"]}).json()
    assert yes["learned"]["suggestion"] is None
    # "Forget this" deletes the videos behind it and unpins it.
    forgot = client.post("/rhythm/forget", headers=auth(), json={"topic": "boxing"}).json()
    assert forgot["status"] == "ok" and signal_count() == 0
    assert profile_row().data["topics"] == []
    assert learn.refresh(app, ALICE, fake_ai, force=True) == "ok"
    assert profile_row().data["topics"] == []


def test_agents_get_limited_evidence_with_the_profile(client, fake_ai):
    client.put("/rhythm/settings", headers=auth(), json=settings())
    client.post("/rhythm/signals", headers=auth(), json=watched("Beginner boxing footwork drill", 1))
    assert learn.refresh(app, ALICE, fake_ai, force=True) == "ok"
    summary = client.get("/rhythm/interests", headers=auth()).json()["learned"]
    assert summary["learning"] and summary["why"]["boxing"]["videos"] == 1
    assert "title" not in str(summary).lower()  # no video titles or watch history, just counts



def test_choices_change_only_what_is_sent_and_survive_learning_off(client, fake_ai):
    client.put("/rhythm/settings", headers=auth(), json=settings())
    client.post("/rhythm/signals", headers=auth(), json=watched("Beginner boxing footwork drill", 1))
    assert learn.refresh(app, ALICE, fake_ai, force=True) == "ok"
    client.put("/rhythm/choices", headers=auth(), json={"expectedRevision": profile_row().revision,
                                                        "pinned": ["karate"], "preferredDurationMinutes": 20})
    # A later save of one field leaves the others alone.
    client.put("/rhythm/choices", headers=auth(), json={"expectedRevision": profile_row().revision, "experienceLevel": "advanced"})
    row = profile_row()
    assert row.data["choices"]["pinned"] == ["karate"] and row.data["preferred_duration_minutes"] == 20
    assert row.data["experience_level"] == "advanced"
    # Learning off forgets what was learned (boxing) but keeps the user's own choices in force.
    client.put("/rhythm/settings", headers=auth(), json=settings(revision=row.revision, learning=False))
    row = profile_row()
    assert row.data["topics"] == ["karate"] and row.confirmed
    assert row.data["experience_level"] == "advanced" and row.data["preferred_duration_minutes"] == 20
    # With learning off, "learn it" clears a value that only came from the user's choice.
    client.put("/rhythm/choices", headers=auth(), json={"expectedRevision": row.revision, "experienceLevel": None})
    assert profile_row().data["experience_level"] is None
    assert profile_row().data["preferred_duration_minutes"] == 20



def test_an_update_in_the_same_visit_is_not_a_second_view(client, fake_ai):
    client.put("/rhythm/settings", headers=auth(), json=settings())
    first = watched("Beginner boxing footwork drill", 1)
    first["engagement"] = {"playedSeconds": 70}
    client.post("/rhythm/signals", headers=auth(), json=first)
    later = watched("Beginner boxing footwork drill", 1)
    later["engagement"] = {"playedSeconds": 400}
    client.post("/rhythm/signals", headers=auth(), json=later)
    with app.state.session_factory() as db:
        row = db.scalar(select(RhythmSignal))
        assert row.views == 1 and row.played_seconds == 400
        row.observed_at = utcnow() - timedelta(days=1)  # a visit on another day is a new view
        db.commit()
    client.post("/rhythm/signals", headers=auth(), json=watched("Beginner boxing footwork drill", 1))
    with app.state.session_factory() as db:
        assert db.scalar(select(RhythmSignal)).views == 2


def test_learning_off_keeps_the_users_own_reactions(client, fake_ai):
    client.put("/rhythm/settings", headers=auth(), json=settings())
    client.post("/rhythm/signals", headers=auth(), json=watched("Beginner boxing footwork drill", 1))
    client.post("/rhythm/reactions", headers=auth(), json={**watched("Boxing slip drill tutorial", 2), "reaction": "less"})
    client.put("/rhythm/settings", headers=auth(), json=settings(revision=profile_row().revision, learning=False))
    assert signal_count() == 1  # only the "Not interested", which keeps that video out of tasks
    # Page details off removes reactions too.
    client.put("/rhythm/settings", headers=auth(), json=settings(revision=profile_row().revision, learning=False, metadata=False))
    assert signal_count() == 0



def test_reaction_messages_say_what_changed_while_recommendations_are_off(client):
    client.put("/rhythm/settings", headers=auth(), json=settings(learning=False))
    app.state.rhythm_settings = replace(app.state.rhythm_settings, recommendations=False)
    saved = client.post("/rhythm/reactions", headers=auth(), json={**watched("Beginner boxing footwork drill", 1), "reaction": "more"}).json()
    assert saved["message"] == "Saved to Rhythm. It counts toward your interest in boxing."
    passed = client.post("/rhythm/reactions", headers=auth(), json={**watched("Boxing slip drill tutorial", 2), "reaction": "less"}).json()
    assert passed["message"] == "Got it. It counts against boxing in what Rhythm learns."


def test_saving_a_video_keeps_its_transcript(client):
    client.put("/rhythm/settings", headers=auth(), json=settings(learning=False))
    # The title alone doesn't place this video; its transcript does.
    saved = client.post("/rhythm/reactions", headers=auth(), json={
        **watched("Morning session", 1, transcript="Today we drill the karate front kick. Chamber the knee."), "reaction": "more"}).json()
    assert saved["status"] == "ok"
    with app.state.session_factory() as db:
        row = db.scalar(select(RhythmSignal).where(RhythmSignal.user_id == ALICE, RhythmSignal.video_id == "vid00000001"))
        assert row.topics == ["karate"] and row.reaction == "more"
        assert row.transcript == "Today we drill the karate front kick. Chamber the knee."
    # A later reaction without a transcript keeps the one already saved.
    client.post("/rhythm/reactions", headers=auth(), json={**watched("Morning session karate", 1), "reaction": "less"})
    with app.state.session_factory() as db:
        row = db.scalar(select(RhythmSignal).where(RhythmSignal.video_id == "vid00000001"))
        assert row.reaction == "less" and row.transcript.startswith("Today we drill")
