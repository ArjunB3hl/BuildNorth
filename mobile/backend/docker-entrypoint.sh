#!/bin/sh
set -eu

# Require an explicit database so a deployment cannot silently use ephemeral SQLite.
: "${DATABASE_URL:?Set DATABASE_URL to the Render Postgres Internal Database URL}"
: "${AI_CREDENTIAL_ENCRYPTION_KEY:?Set a persistent AI_CREDENTIAL_ENCRYPTION_KEY in Render}"

# Run migrations once before accepting requests, then let Uvicorn receive shutdown signals.
python -m alembic upgrade head
export AUTO_MIGRATE=false
exec python -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-10000}" --workers 1
