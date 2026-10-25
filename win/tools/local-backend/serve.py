"""Run the real BuildNorth backend locally with a stand-in for Clerk, for testing the Windows app.

The backend only accepts Clerk session tokens on its REST API, and testing the Windows app's data layer shouldn't
need a real account. This script starts the unchanged FastAPI app (mobile/backend) the way its tests do: the JWKS
lookup is replaced by a local RSA key, so tokens this script signs for a fictional user pass the real verifier.
Everything else (routes, database, migrations, ownership checks) is the real code.

    cd mobile/backend
    .venv/Scripts/python ../../win/tools/local-backend/serve.py

It prints a session token valid for 12 hours. Put it in win/.env.local as EXPO_PUBLIC_DEV_SESSION_TOKEN (with
EXPO_PUBLIC_API_URL=http://localhost:8000) and restart `npm start`. Data lives in win/tools/local-backend/.data
(git-ignored); delete that folder for a fresh database and key. AI and long-term memory are off unless the backend's
own .env configures them.
"""

from __future__ import annotations

import base64
import os
import sys
import time
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
DATA = HERE / ".data"
BACKEND = HERE.parents[2] / "mobile" / "backend"
LOCAL_HOST = "buildnorth-local.clerk.test"
USER_ID = "user_windowsLocalTest"  # fictional; the backend only checks the user_… shape
TOKEN_HOURS = 12

DATA.mkdir(exist_ok=True)
os.environ.setdefault("DATABASE_URL", f"sqlite:///{(DATA / 'buildnorth.db').as_posix()}")
os.environ.setdefault("AUTO_MIGRATE", "true")
os.environ.setdefault("AI_PROVIDER", "none")
# A publishable key for a host that only exists here; the verifier derives its issuer from it.
os.environ["CLERK_PUBLISHABLE_KEY"] = "pk_test_" + base64.b64encode(f"{LOCAL_HOST}$".encode()).decode().rstrip("=")
os.environ.pop("CLERK_AUTHORIZED_PARTIES", None)

import jwt  # noqa: E402  (after the environment is set)
from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402

key_file = DATA / "signing-key.pem"
if key_file.exists():
    signing_key = serialization.load_pem_private_key(key_file.read_bytes(), password=None)
else:
    signing_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    key_file.write_bytes(
        signing_key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        )
    )


class LocalJWKClient:
    """Stands in for jwt.PyJWKClient: every token is checked against the local public key."""

    def __init__(self, *args: object, **kwargs: object) -> None:
        pass

    def get_signing_key_from_jwt(self, token: str) -> SimpleNamespace:
        return SimpleNamespace(key=signing_key.public_key())


jwt.PyJWKClient = LocalJWKClient  # app.auth looks it up when the verifier is created

sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

now = int(time.time())
token = jwt.encode(
    {"sub": USER_ID, "iss": f"https://{LOCAL_HOST}", "iat": now, "nbf": now, "exp": now + TOKEN_HOURS * 3600,
     "sid": "sess_windowsLocalTest"},
    signing_key,
    algorithm="RS256",
    headers={"kid": "local"},
)

(DATA / "dev-token.txt").write_text(token)  # for seed.py
print(f"Local backend for {USER_ID}, data in {DATA}")
print("Session token (12 h), for win/.env.local:")
print(f"EXPO_PUBLIC_DEV_SESSION_TOKEN={token}", flush=True)

import uvicorn  # noqa: E402

from app.main import app  # noqa: E402

uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("PORT", "8000")))
