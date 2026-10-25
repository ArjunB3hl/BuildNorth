"""Encrypted personal Claude keys, separate from chat, memory and connector tokens."""
from __future__ import annotations

import json
import os
from pathlib import Path

import anthropic
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from sqlalchemy.engine import make_url

from app.ai import AnthropicProvider
from app.config import Settings
from app.models import ClaudeCredential


def credential_cipher(settings: Settings) -> Fernet | None:
    """Production uses an operator-provided key. Local SQLite keeps a private key beside its DB."""
    if settings.ai_credential_key:
        try:
            return Fernet(settings.ai_credential_key.encode())
        except (ValueError, TypeError):
            return None
    url = make_url(settings.database_url)
    if url.get_backend_name() != "sqlite" or not url.database or url.database == ":memory:":
        return None
    path = Path(url.database).resolve().parent / "ai-credentials.key"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(fd, "wb") as out:
                out.write(Fernet.generate_key())
        return Fernet(path.read_bytes().strip())
    except (OSError, ValueError):
        return None


def seal(cipher: Fernet, user_id: str, key: str) -> str:
    return cipher.encrypt(json.dumps({"owner": user_id, "key": key}).encode()).decode()


def personal_provider(cipher: Fernet | None, row: ClaudeCredential, timeout: float) -> AnthropicProvider:
    try:
        if cipher is None:
            raise ValueError("unavailable cipher")
        payload = json.loads(cipher.decrypt(row.ciphertext.encode()))
        if payload["owner"] != row.user_id:
            raise ValueError("credential owner mismatch")
        return AnthropicProvider(payload["key"], row.model, timeout, base_url="https://api.anthropic.com")
    except (InvalidToken, KeyError, ValueError, TypeError):
        raise HTTPException(503, "Your Claude key could not be unlocked. Reconnect it in AI connections.") from None


def verify_key(key: str, model: str) -> str:
    """Checks authentication/model access without generating a paid message. Never expose upstream bodies."""
    try:
        with anthropic.Anthropic(api_key=key, timeout=15, max_retries=0, base_url="https://api.anthropic.com") as client:
            return client.models.retrieve(model).id
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError):
        raise HTTPException(400, "Claude rejected that key or its permissions. Check your Anthropic Console key.") from None
    except anthropic.NotFoundError:
        raise HTTPException(400, "That Claude model is not available to this key. Check the model name.") from None
    except anthropic.RateLimitError:
        raise HTTPException(429, "Claude is rate limiting verification. Try again shortly.") from None
    except (anthropic.APIError, ValueError):
        raise HTTPException(502, "Could not verify the Claude key. Check your connection and try again.") from None
