from datetime import UTC, datetime

import pytest
from fastapi import HTTPException
from app.deps import get_coach_ai
from app.models import ActivitySession, ElevenLabsCredential
from conftest import auth, ALICE, BOB

KEY = "made-up-elevenlabs-key-for-tests-1234"
AGENT = "agent_test_placeholder"


@pytest.fixture
def eleven(monkeypatch):
    calls = []
    def get(key, path, params=None):
        calls.append((key, path, params))
        return {"name": "Demo coach", "signed_url": "wss://api.elevenlabs.io/v1/convai/conversation?test=made-up"}
    monkeypatch.setattr('app.routers.elevenlabs.eleven_get', get)
    return calls


def connect(client):
    return client.put('/connections/elevenlabs', headers=auth(), json={"apiKey": KEY, "agentId": AGENT})


def test_verified_connection_is_scoped_encrypted_and_revocable(client, eleven):
    client.app.dependency_overrides.pop(get_coach_ai, None)
    assert client.post('/connections/elevenlabs/session', headers=auth()).status_code == 403
    assert not client.get('/connections/access', headers=auth()).json()['linked']
    # Creating a token/opening setup is not a usable built-in AI connection.
    client.post('/connections/tokens', headers=auth(), json={'label': 'ChatGPT setup'})
    assert not client.get('/connections/access', headers=auth()).json()['linked']
    assert client.post('/coach/messages', headers=auth(), json={'content': 'Hello'}).status_code == 403
    response = connect(client)
    assert response.status_code == 200 and KEY not in response.text and AGENT not in response.text
    assert len(eleven) == 2
    assert response.headers['cache-control'] == 'no-store'
    with client.app.state.session_factory() as db:
        row = db.get(ElevenLabsCredential, ALICE)
        assert KEY not in row.ciphertext
    access = client.get('/connections/access', headers=auth()).json()
    assert access['linked'] and access['camera'] and access['elevenlabs'] and not access['textChat']
    assert not client.get('/connections/access', headers=auth(BOB)).json()['linked']
    assert client.post('/connections/elevenlabs/session', headers=auth(BOB)).status_code == 403
    session = client.post('/connections/elevenlabs/session', headers=auth())
    assert session.status_code == 200 and session.headers['cache-control'] == 'no-store'
    assert KEY not in session.text
    client.delete('/connections/elevenlabs', headers=auth())
    assert not client.get('/connections/access', headers=auth()).json()['linked']
    assert client.post('/connections/elevenlabs/session', headers=auth()).status_code == 403


def test_failed_replace_and_erasure(client, eleven, monkeypatch):
    assert connect(client).status_code == 200
    def fail(*args): raise HTTPException(400, 'Not accepted')
    monkeypatch.setattr('app.routers.elevenlabs.eleven_get', fail)
    assert connect(client).status_code == 400
    assert client.get('/connections/elevenlabs', headers=auth()).json()['configured']
    client.delete('/account/data', headers=auth())
    assert not client.get('/connections/elevenlabs', headers=auth()).json()['configured']


@pytest.mark.parametrize('body', [KEY, [KEY], {'apiKey': KEY, 'agentId': '../bad'}, {'apiKey': KEY, 'agentId': AGENT, 'userId': BOB}])
def test_no_secret_in_validation(client, body):
    response = client.put('/connections/elevenlabs', headers=auth(), json=body)
    assert response.status_code == 422 and KEY not in response.text


def watch_body():
    return {'sleepMinutes': 420, 'sleepPattern': {'startedAt': '2026-10-19T23:00:00Z', 'endedAt': '2026-10-20T06:20:00Z',
        'coreMinutes': 250, 'deepMinutes': 80, 'remMinutes': 90, 'awakeMinutes': 20}, 'complete': True,
        'workouts': [{'externalId': 'test-workout', 'activityType': 'running', 'startedAt': '2026-10-20T14:00:00Z',
                     'durationMinutes': 25, 'averageHeartRateBpm': 140, 'minHeartRateBpm': 90, 'maxHeartRateBpm': 165}]}


def test_watch_pattern_calendar_and_monthly_report(client, monkeypatch):
    monkeypatch.setattr('app.monthly_report.utcnow', lambda: datetime(2026, 11, 1, 12, tzinfo=UTC))
    for _ in range(2):
        assert client.put('/watch/health/2026-10-20', headers=auth(), json=watch_body()).status_code == 200
    body = watch_body(); body.update(sleepMinutes=900, complete=False); body['workouts'] = []
    client.put('/watch/health/2026-10-21', headers=auth(), json=body)
    client.post('/calendar/demo', headers=auth(), json={'date': '2026-10-20', 'timezone': 'UTC'})
    with client.app.state.session_factory() as db:
        db.add(ActivitySession(user_id=ALICE, routine_name='Camera workout', local_date='2026-10-20',
            started_at=datetime(2026,10,20,14,tzinfo=UTC), finished_at=datetime(2026,10,20,14,25,tzinfo=UTC),
            duration_seconds=1500, entries=[{'name': 'Squats', 'sets': [{'reps': 10}, {'reps': 8}]}]))
        db.commit()
    rows = client.get('/calendar?start=2026-10-20&days=1&timezone=UTC', headers=auth()).json()
    sleep = next(e for e in rows if e['kind'] == 'sleep')
    workout = next(e for e in rows if e['workout'])
    assert sleep['sleepPattern']['deepMinutes'] == 80 and sleep['durationMinutes'] == 420
    assert workout['workout']['maxHeartRateBpm'] == 165
    r = client.get('/calendar/report?month=2026-10', headers=auth()).json()
    assert r['status'] == 'monthEnded' and r['reportDate'] == '2026-10-31'
    assert r['sleep'] == {'average': 420.0, 'min': 420, 'max': 420, 'samples': 1}
    assert r['steps']['average'] is None and r['watchDays'] == 2 and r['completeWatchDays'] == 1
    assert r['watchWorkouts'] == 1 and r['appWorkouts'] == 1 and r['recordedSets'] == 2
    assert r['demoEntriesExcluded'] == 28 and r['meals'] == 0
    other = client.get('/calendar/report?month=2026-10', headers=auth(BOB)).json()
    assert other['healthDays'] == [] and other['recordedDays'] == 0
    assert client.get('/calendar/report?month=2026-13', headers=auth()).status_code == 422
    assert client.get('/calendar/report?month=2026-12', headers=auth()).status_code == 422
    assert client.get('/calendar/report?month=2026-10').status_code == 401
    client.delete('/account/data', headers=auth())
    assert client.get('/calendar/report?month=2026-10', headers=auth()).json()['healthDays'] == []


def test_old_watch_upload_preserves_pattern_and_report_partial_timezone(client, monkeypatch):
    client.put('/watch/health/2026-10-20', headers=auth(), json=watch_body())
    body = watch_body(); body.pop('sleepPattern')
    client.put('/watch/health/2026-10-20', headers=auth(), json=body)
    assert client.get('/watch/health?end=2026-10-20', headers=auth()).json()['days'][0]['sleepPattern']['remMinutes'] == 90
    monkeypatch.setattr('app.monthly_report.utcnow', lambda: datetime(2026, 11, 1, 2, tzinfo=UTC))
    r = client.get('/calendar/report?month=2026-10&timezone=America/Toronto', headers=auth()).json()
    assert r['status'] == 'inProgress' and r['through'] == '2026-10-31'
