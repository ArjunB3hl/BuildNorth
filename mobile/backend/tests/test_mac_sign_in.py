from concurrent.futures import ThreadPoolExecutor
import hashlib
import secrets
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from sqlalchemy import update

from app.models import MacSignInHandoff, MacSignInRateBucket
from app.routers import mac_sign_in
from conftest import ALICE, BOB, auth

real_peer = mac_sign_in.peer


@pytest.fixture
def setup_handoff(client, monkeypatch):
    monkeypatch.setenv("MAC_BROWSER_SIGN_IN_ENABLED", "true")
    monkeypatch.setattr(mac_sign_in, "peer", lambda request: "test-network")
    client.app.state.settings = replace(client.app.state.settings, clerk_secret_key="test-only")
    issued = []

    class FakeClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, *, headers, json):
            issued.append(json)
            class Result:
                status_code = 200
                def json(self): return {"token": "disposable-ticket"}
            return Result()
    monkeypatch.setattr(mac_sign_in.httpx, "AsyncClient", FakeClient)
    return issued


def new(client):
    proof = secrets.token_urlsafe(32)
    result = client.post('/mac-sign-in/start', json={'challenge': hashlib.sha256(proof.encode()).hexdigest()})
    assert result.status_code == 200
    return result.json()['code'], proof


def test_handoff_is_disabled_by_default(client, monkeypatch):
    monkeypatch.delenv('MAC_BROWSER_SIGN_IN_ENABLED', raising=False)
    result = client.post('/mac-sign-in/start', json={'challenge': 'a' * 64})
    assert result.status_code == 503


def redeem(client, code, proof):
    return client.post('/mac-sign-in/redeem', json={'code': code, 'proof': proof})


def approval(code, user=ALICE):
    return {'code': code, 'expected_user_id': user, 'expected_session_id': 'sess_1'}


def test_bound_single_use_and_account_switch(client, setup_handoff):
    code, proof = new(client)
    assert redeem(client, code, secrets.token_urlsafe(32)).status_code == 410
    assert redeem(client, code, proof).json() == {'status': 'pending'}
    assert client.post('/mac-sign-in/approve', json={'code': code}).status_code == 401
    assert client.post('/mac-sign-in/approve', json=approval(code, ALICE), headers=auth(ALICE)).status_code == 200
    assert client.post('/mac-sign-in/approve', json=approval(code, BOB), headers=auth(BOB)).status_code == 410
    assert redeem(client, code, proof).json() == {'status': 'ready', 'ticket': 'disposable-ticket'}
    assert setup_handoff == [{'user_id': ALICE, 'expires_in_seconds': 60}]
    assert redeem(client, code, proof).status_code == 410
    next_code, next_proof = new(client)
    assert client.post('/mac-sign-in/approve', json=approval(next_code, BOB), headers=auth(BOB)).status_code == 200
    assert redeem(client, next_code, next_proof).status_code == 200
    assert setup_handoff[-1]['user_id'] == BOB


def test_cancel_expiry_and_wrong_instance(client, setup_handoff):
    code, proof = new(client)
    other_code, other_proof = new(client)
    client.post('/mac-sign-in/approve', json=approval(code), headers=auth())
    assert redeem(client, code, other_proof).status_code == 410
    client.post('/mac-sign-in/cancel', json={'code': code, 'proof': other_proof})
    client.post('/mac-sign-in/cancel', json={'code': code, 'proof': proof})
    assert redeem(client, code, proof).status_code == 410
    with client.app.state.session_factory() as db:
        db.execute(update(MacSignInHandoff).where(MacSignInHandoff.code_hash == mac_sign_in.digest(other_code))
                   .values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
        db.commit()
    assert client.post('/mac-sign-in/approve', json=approval(other_code), headers=auth()).status_code == 410
    assert redeem(client, other_code, other_proof).status_code == 410
    assert not setup_handoff


def test_simultaneous_redemptions_issue_one_ticket(client, setup_handoff):
    code, proof = new(client)
    client.post('/mac-sign-in/approve', json=approval(code), headers=auth())
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(lambda _: redeem(client, code, proof), range(2)))
    assert sorted(r.status_code for r in results) == [200, 410]
    assert len(setup_handoff) == 1


def test_upstream_failure_consumes_request_and_does_not_retry(client, setup_handoff, monkeypatch):
    code, proof = new(client)
    client.post('/mac-sign-in/approve', json=approval(code), headers=auth())
    calls = []
    class FailingClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, *args, **kwargs):
            calls.append(1)
            raise mac_sign_in.httpx.ReadTimeout('unknown outcome')
    monkeypatch.setattr(mac_sign_in.httpx, 'AsyncClient', FailingClient)
    assert redeem(client, code, proof).status_code == 502
    assert redeem(client, code, proof).status_code == 410
    assert len(calls) == 1


def test_start_limit_ignores_untrusted_forwarded_headers(client, setup_handoff, monkeypatch):
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 1, 1, 0, 0, 1, tzinfo=UTC)
    monkeypatch.setattr(mac_sign_in, 'datetime', FrozenDateTime)
    for _ in range(10):
        new(client)
    response = client.post('/mac-sign-in/start', json={'challenge': 'a' * 64},
                           headers={'X-Forwarded-For': '198.51.100.123'})
    assert response.status_code == 429
    assert int(response.headers['retry-after']) > 0


def test_shared_rate_limit_is_atomic_across_sessions(client, setup_handoff):
    def attempt(_):
        with client.app.state.session_factory() as db:
            try:
                mac_sign_in.limit(db, [('test-shared', 'same-peer', 5, 600)])
                return 200
            except HTTPException as exc:
                return exc.status_code
    with ThreadPoolExecutor(max_workers=10) as workers:
        results = list(workers.map(attempt, range(20)))
    assert results.count(200) == 5
    assert results.count(429) == 15


def test_ticket_issuance_limit_fails_before_claiming_handoff(client, setup_handoff):
    code, proof = new(client)
    assert client.post('/mac-sign-in/approve', json=approval(code), headers=auth()).status_code == 200
    with client.app.state.session_factory() as db:
        for _ in range(10):
            mac_sign_in.limit(db, [('issue-user', ALICE, 10, 600)])
    assert redeem(client, code, proof).status_code == 429
    assert not setup_handoff


def test_account_change_and_restart_without_proof_fail_closed(client, setup_handoff):
    code, proof = new(client)
    assert client.post('/mac-sign-in/approve', json=approval(code, ALICE), headers=auth(BOB)).status_code == 409
    wrong_session = {**approval(code), 'expected_session_id': 'sess_other'}
    assert client.post('/mac-sign-in/approve', json=wrong_session, headers=auth(ALICE)).status_code == 409
    assert client.post('/mac-sign-in/approve', json=approval(code), headers=auth(ALICE)).status_code == 200
    assert redeem(client, code, secrets.token_urlsafe(32)).status_code == 410
    assert not setup_handoff
    assert redeem(client, code, proof).status_code == 200


def proxy_request(socket, headers):
    return Request({'type': 'http', 'method': 'POST', 'path': '/', 'scheme': 'https',
                    'server': ('example.com', 443), 'client': (socket, 1234),
                    'headers': [(k.lower().encode(), v.encode()) for k, v in headers]})


def test_render_client_address_requires_verified_proxy_and_one_global_ip(monkeypatch):
    monkeypatch.setenv('MAC_SIGN_IN_TRUSTED_PROXY_CIDRS', '10.3.4.5/32')
    normal = [('CF-Connecting-IP', '8.8.8.8'), ('X-Forwarded-For', '1.1.1.1')]
    assert mac_sign_in.peer(proxy_request('10.3.4.5', normal)) == '8.8.8.8'
    assert mac_sign_in.peer(proxy_request('10.3.4.5', [('CF-Connecting-IP', '::ffff:8.8.8.8')])) == '8.8.8.8'
    for socket, headers in [('10.3.4.6', normal), ('10.3.4.5', []),
                            ('10.3.4.5', [('CF-Connecting-IP', 'bad')]),
                            ('10.3.4.5', [('CF-Connecting-IP', '8.8.8.8, 1.1.1.1')]),
                            ('10.3.4.5', [('CF-Connecting-IP', '8.8.8.8'), ('CF-Connecting-IP', '1.1.1.1')]),
                            ('10.3.4.5', [('CF-Connecting-IP', '127.0.0.1')])]:
        with pytest.raises(HTTPException) as exc:
            mac_sign_in.peer(proxy_request(socket, headers))
        assert exc.value.status_code == 503
    monkeypatch.setenv('MAC_SIGN_IN_TRUSTED_PROXY_CIDRS', '0.0.0.0/0')
    with pytest.raises(HTTPException):
        mac_sign_in.peer(proxy_request('10.3.4.5', normal))


def test_different_networks_and_users_on_same_network(client, setup_handoff, monkeypatch):
    monkeypatch.setattr(mac_sign_in, 'peer', lambda request: request.headers.get('x-test-network', 'wifi'))
    proof = secrets.token_urlsafe(32)
    code = client.post('/mac-sign-in/start', headers={'x-test-network': 'wifi'},
                       json={'challenge': hashlib.sha256(proof.encode()).hexdigest()}).json()['code']
    assert client.post('/mac-sign-in/approve', json=approval(code), headers={**auth(ALICE), 'x-test-network': 'cell'}).status_code == 200
    assert client.post('/mac-sign-in/redeem', json={'code': code, 'proof': proof}, headers={'x-test-network': 'wifi'}).status_code == 200
    code2, proof2 = new(client)
    assert client.post('/mac-sign-in/approve', json=approval(code2, BOB), headers=auth(BOB)).status_code == 200
    assert redeem(client, code2, proof2).status_code == 200
    assert [x['user_id'] for x in setup_handoff] == [ALICE, BOB]


def test_global_counter_counts_requests_rejected_by_narrower_limit(client, setup_handoff):
    with client.app.state.session_factory() as db:
        mac_sign_in.limit(db, [('global-check', 'all', 2, 600), ('narrow-check', 'one', 1, 600)])
        with pytest.raises(HTTPException):
            mac_sign_in.limit(db, [('global-check', 'all', 2, 600), ('narrow-check', 'one', 1, 600)])
        with pytest.raises(HTTPException):
            mac_sign_in.limit(db, [('global-check', 'all', 2, 600)])


def test_challenge_rate_limit_cannot_be_evaded_by_changing_network(client, setup_handoff, monkeypatch):
    monkeypatch.setattr(mac_sign_in, 'peer', lambda request: request.headers.get('x-test-network', 'wifi'))
    challenge = hashlib.sha256(secrets.token_urlsafe(32).encode()).hexdigest()
    for i in range(4):
        assert client.post('/mac-sign-in/start', headers={'x-test-network': str(i)}, json={'challenge': challenge}).status_code == 200
    assert client.post('/mac-sign-in/start', headers={'x-test-network': 'other'}, json={'challenge': challenge}).status_code == 429


def test_missing_proxy_configuration_fails_closed(client, setup_handoff, monkeypatch):
    monkeypatch.setattr(mac_sign_in, 'peer', real_peer)
    monkeypatch.delenv('MAC_SIGN_IN_TRUSTED_PROXY_CIDRS', raising=False)
    # Explicitly supply server-side settings; no user data or remote call occurs.
    client.app.state.settings = replace(client.app.state.settings, clerk_secret_key='test-only')
    assert client.post('/mac-sign-in/start', json={'challenge': 'a' * 64}).status_code == 503


def test_unauthenticated_approval_counts_against_endpoint_limit(client, setup_handoff):
    now = int(datetime.now(UTC).timestamp())
    assert client.post('/mac-sign-in/approve', json={'code': 'a' * 43}).status_code == 401
    with client.app.state.session_factory() as db:
        keys = [mac_sign_in.digest(f'approve-global:all:{bucket}') for bucket in (now // 60, int(datetime.now(UTC).timestamp()) // 60)]
        assert any(db.get(MacSignInRateBucket, key) is not None for key in keys)
