"""Opt-in integration check; only runs against an explicitly named disposable database."""
from concurrent.futures import ThreadPoolExecutor
import os
import secrets

from fastapi import HTTPException
import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.db import migrate
from app.routers.mac_sign_in import limit


def test_rate_counter_is_shared_and_atomic_on_postgres():
    url = os.getenv('RHYTHM_TEST_POSTGRES_URL', '')
    if not url:
        pytest.skip('No disposable PostgreSQL test database configured')
    parsed = make_url(url)
    socket = parsed.query.get('host', '')
    if (parsed.get_backend_name() != 'postgresql' or parsed.database != 'rhythm_auth_test'
            or not isinstance(socket, str) or not socket.startswith('/tmp/rhythm-pg-review.')):
        pytest.fail('Refusing to use a non-disposable database')
    migrate(url)
    engine = create_engine(url, pool_size=12)
    sessions = sessionmaker(engine)
    identity = secrets.token_hex(16)
    def attempt(_):
        with sessions() as db:
            try:
                limit(db, [('integration-shared', identity, 5, 600)])
                return 200
            except HTTPException as exc:
                return exc.status_code
    try:
        with ThreadPoolExecutor(max_workers=10) as workers:
            results = list(workers.map(attempt, range(20)))
        assert results.count(200) == 5
        assert results.count(429) == 15
    finally:
        engine.dispose()
