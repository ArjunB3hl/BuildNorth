from datetime import UTC, datetime
import pytest
from conftest import auth
from app.assistant import COACH_SCHEMA


@pytest.fixture(autouse=True)
def fixed_calendar_clock(monkeypatch):
    monkeypatch.setattr('app.calendar.utcnow', lambda: datetime(2026, 10, 25, 16, tzinfo=UTC))


def entry(**patch):
    return {"kind":"meal", "title":"Oats & berries", "occurredAt":"2026-10-20T12:15:00Z", "clientKey":"meal-one", **patch}


def test_scoped_retryable_editable_deleted_with_account(client):
    a, b = auth(), auth('user_2aBcd')
    one = client.post('/calendar', headers=a, json=entry()).json()
    assert client.post('/calendar', headers=a, json=entry()).json()['id'] == one['id']
    assert client.get('/calendar?start=2026-10-20&timezone=America/Toronto', headers=a).json()[0]['localTime'] == '08:15'
    assert client.get('/calendar?start=2026-10-20', headers=b).json() == []
    body = entry(title='Toast'); body.pop('clientKey')
    assert client.put('/calendar/'+one['id'], headers=b, json=body).status_code == 404
    assert client.delete('/calendar/'+one['id'], headers=b).status_code == 404
    assert client.put('/calendar/'+one['id'], headers=a, json=body).json()['title'] == 'Toast'
    client.delete('/account/data', headers=a)
    assert client.get('/calendar?start=2026-10-20', headers=a).json() == []


def test_timezone_boundaries_and_validation(client):
    a = auth()
    for body in [entry(occurredAt='2026-10-20T12:00:00'), entry(userId='victim'), entry(title=' '),
                 entry(occurredAt="2026-10-26T12:00:00Z")]:
        assert client.post('/calendar', headers=a, json=body).status_code == 422
    client.post('/calendar', headers=a, json=entry(occurredAt='2026-03-09T03:30:00Z'))
    rows = client.get('/calendar?start=2026-03-08&days=1&timezone=America/Toronto', headers=a).json()
    assert rows[0]['localDate'] == '2026-03-08' and rows[0]['localTime'] == '23:30'
    assert client.get('/calendar?start=2026-03-09&days=1&timezone=America/Toronto', headers=a).json() == []
    for q in ['start=2026-02-30','start=2026-10-20&timezone=bogus','start=2026-10-20&days=365']:
        assert client.get('/calendar?'+q, headers=a).status_code == 422


def test_demo_scoped_and_cleanup_preserves_real(client):
    for _ in range(2):
        assert client.post('/calendar/demo', headers=auth(), json={'date':'2026-10-20','timezone':'America/Toronto'}).status_code == 200
    assert len(client.get('/calendar?start=2026-10-14&days=7&timezone=America/Toronto', headers=auth()).json()) == 28
    assert client.get('/calendar?start=2026-10-14', headers=auth('user_other')).json() == []
    client.post('/calendar', headers=auth(), json=entry())
    client.delete('/calendar/demo/all', headers=auth())
    rows = client.get('/calendar?start=2026-10-14', headers=auth()).json()
    assert len(rows) == 1 and rows[0]['source'] == 'manual'


def test_session_automatically_projects(client):
    from app.models import ActivitySession
    with client.app.state.session_factory() as db:
        db.add(ActivitySession(user_id='user_2abCd', routine_name='Camera workout', local_date='2026-10-20',
            started_at=datetime(2026,10,20,21,tzinfo=UTC), finished_at=datetime(2026,10,20,21,30,tzinfo=UTC),
            duration_seconds=1800, entries=[]))
        db.commit()
    rows = client.get('/calendar?start=2026-10-20&timezone=America/Toronto', headers=auth()).json()
    assert len(rows) == 1 and rows[0]['source'] == 'session' and rows[0]['localTime'] == '17:00'
    assert rows[0]['durationMinutes'] == 30 and not rows[0]['editable']


@pytest.mark.parametrize('message,expected', [
    ('I ate oats at 8:15 this morning.',1), ('Could I eat oats tomorrow?',0),
    ('I did not eat oats today.',0), ('If I ate oats at 8:15, would that be good?',0),
])
def test_coach_only_logs_current_completed_reports(client, fake_ai, message, expected):
    original = fake_ai.generate_json
    def generate(**kw):
        if kw['schema'] is COACH_SCHEMA:
            return {'reply':'Thanks for checking in.', 'suggestions':[], 'calendar_entries':[
                {'kind':'meal','title':'Oats','date':'2026-10-20','time':'08:15','duration_minutes':None,'evidence':message}]}
        return original(**kw)
    fake_ai.generate_json = generate
    body = {'content':message,'localDate':'2026-10-20','timezone':'America/Toronto','clientKey':'turn-one'}
    for _ in range(2):
        res = client.post('/coach/messages', headers=auth(), json=body)
        assert res.status_code == 200, res.text
    assert len(client.get('/calendar?start=2026-10-20', headers=auth()).json()) == expected


def test_watch_read_only_and_revocation(client):
    token = client.post('/watch/tokens', headers=auth(), json={'label':'Calendar test'}).json()['token']
    h = {'Authorization':'Bearer '+token}
    client.post('/calendar', headers=auth(), json=entry())
    assert len(client.get('/watch/calendar?start=2026-10-20', headers=h).json()) == 1
    assert client.post('/calendar', headers=h, json=entry()).status_code == 401
    client.delete('/watch/tokens', headers=auth())
    assert client.get('/watch/calendar?start=2026-10-20', headers=h).status_code == 401


def test_completed_meal_and_watch_workout_project_without_duplicate_writes(client):
    from app.models import HealthDay, PlanItem
    with client.app.state.session_factory() as db:
        db.add(PlanItem(user_id='user_2abCd', date='2026-10-20', kind='meal', title='Lunch', status='done',
                       completed_at=datetime(2026,10,20,16,30,tzinfo=UTC)))
        db.add(HealthDay(user_id='user_2abCd', date='2026-10-20', workouts=[{
            'external_id':'watch-one','activity_type':'running','started_at':'2026-10-20T21:00:00Z','duration_minutes':25.0}]))
        db.commit()
    rows = client.get('/calendar?start=2026-10-20&timezone=America/Toronto', headers=auth()).json()
    assert [(e['source'],e['localTime']) for e in rows] == [('plan','12:30'),('watch','17:00')]
    assert client.get('/calendar?start=2026-10-20', headers=auth('user_other')).json() == []


def test_coach_does_not_substitute_food_or_invent_time_duration(client, fake_ai):
    original = fake_ai.generate_json
    def generate(**kw):
        if kw['schema'] is COACH_SCHEMA:
            return {'reply':'Thanks.', 'suggestions':[], 'calendar_entries':[
                {'kind':'meal','title':'Omelette','date':'2026-10-20','time':'08:15','duration_minutes':30,
                 'evidence':'I ate an oatmeal bowl today.'}]}
        return original(**kw)
    fake_ai.generate_json = generate
    result = client.post('/coach/messages', headers=auth(), json={
        'content':'I ate an oatmeal bowl today.', 'localDate':'2026-10-20', 'clientKey':'grounding-test'})
    assert result.status_code == 200
    row = client.get('/calendar?start=2026-10-20', headers=auth()).json()[0]
    assert 'oatmeal' in row['title'] and 'Omelette' not in row['title']
    assert row['timeEstimated'] and row['durationMinutes'] is None
    assert row['notes'] == 'I ate an oatmeal bowl today'
    assert row['localDate'] == '2026-10-25'


def test_grounding_handles_am_pm_and_durations():
    from app.calendar import grounded_time, grounded_duration
    assert grounded_time('17:30', 'I ran at 5:30 pm.') == '17:30'
    assert grounded_time('05:30', 'I ran at 5:30 pm.') == '17:30'
    assert grounded_time('08:10', 'I ate oats at 08:10 today.') == '08:10'
    assert grounded_time('08:00', 'I did 8 sets.') is None
    assert grounded_duration(30, 'I did a 30-minute walk.') == 30
    assert grounded_duration(60, 'I ran for 1 hour.') == 60
    assert grounded_duration(10, 'I did 10 squats.') is None


def test_title_edit_preserves_unknown_time_until_time_is_corrected(client):
    from app.models import CalendarEntry
    with client.app.state.session_factory() as db:
        row = CalendarEntry(user_id='user_2abCd', kind='meal', title='Oats', occurred_at=datetime(2026,10,20,12,tzinfo=UTC),
                            source='coach', source_key='coach:unknown-time', time_estimated=True)
        db.add(row); db.commit(); entry_id = row.id
    body = {'kind':'meal', 'title':'Oats with berries', 'occurredAt':'2026-10-20T12:00:00Z'}
    assert client.put('/calendar/'+entry_id, headers=auth(), json=body).json()['timeEstimated']
    body['occurredAt'] = '2026-10-20T12:15:00Z'
    assert not client.put('/calendar/'+entry_id, headers=auth(), json=body).json()['timeEstimated']


def test_truncated_model_evidence_retains_the_reported_time(client, fake_ai):
    original = fake_ai.generate_json
    def generate(**kw):
        if kw['schema'] is COACH_SCHEMA:
            return {'reply':'Thanks.', 'suggestions':[], 'calendar_entries':[
                {'kind':'meal','title':'yogurt','date':'2026-10-25','time':None,'duration_minutes':None,
                 'evidence':'I ate yogurt'}]}
        return original(**kw)
    fake_ai.generate_json = generate
    result = client.post('/coach/messages', headers=auth(), json={
        'content':'I ate yogurt at 08:45 today.', 'timezone':'America/Toronto', 'clientKey':'time-grounding'})
    assert result.status_code == 200
    row = client.get('/calendar?start=2026-10-25&timezone=America/Toronto', headers=auth()).json()[0]
    assert row['title'] == 'yogurt' and row['localTime'] == '08:45' and not row['timeEstimated']


def test_time_grounding_keeps_separate_reported_events_separate():
    from app.calendar import reported_clause, grounded_time
    message = 'I ate oats at 08:15 and I ate lunch at 12:30.'
    assert grounded_time(None, reported_clause('I ate oats', message)) == '08:15'
    assert grounded_time(None, reported_clause('I ate lunch', message)) == '12:30'
