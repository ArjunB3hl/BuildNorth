"""Model provider adapters. All model calls stay on the backend.

Every provider exposes one operation: produce JSON that matches a JSON schema.
Callers validate the result again with Pydantic, so a provider that ignores the
schema is caught rather than trusted. Configure with AI_PROVIDER / AI_MODEL /
AI_BASE_URL / AI_API_KEY (see backend/.env.example).
"""

from __future__ import annotations

import json
import logging
from typing import Any, Literal, Protocol

import httpx

from app.config import Settings

log = logging.getLogger(__name__)

ErrorKind = Literal["unavailable", "timeout", "rate_limited", "bad_output", "refused", "upstream"]

DEFAULT_MODELS = {"ollama": "gemma3:4b", "anthropic": "claude-opus-5-5"}
DEFAULT_BASE_URLS = {"ollama": "http://localhost:11434", "openai": "https://api.openai.com/v1"}


class AIError(Exception):
    def __init__(self, kind: ErrorKind, message: str) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message


class AIProvider(Protocol):
    name: str
    model: str

    def generate_json(
        self,
        *,
        system: str,
        messages: list[dict[str, str]],
        schema: dict[str, Any],
        temperature: float = 0.2,
        max_tokens: int = 4000,
    ) -> dict[str, Any]: ...


def _parse_json_object(text: str) -> dict[str, Any]:
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError) as exc:
        raise AIError("bad_output", "The model returned text that isn't valid JSON.") from exc
    if not isinstance(data, dict):
        raise AIError("bad_output", "The model returned JSON in an unexpected shape.")
    return data


class OllamaProvider:
    """Local models served by Ollama (https://ollama.com) with schema-constrained output."""

    name = "ollama"

    def __init__(self, base_url: str, model: str, timeout: float) -> None:
        self.model = model
        self.base_url = base_url
        self._client = httpx.Client(base_url=base_url, timeout=httpx.Timeout(timeout, connect=5.0))

    def generate_json(self, *, system, messages, schema, temperature=0.2, max_tokens=4000):  # type: ignore[no-untyped-def]
        body: dict[str, Any] = {
            "model": self.model,
            "stream": False,
            "format": schema,
            "options": {"temperature": temperature, "num_predict": max_tokens},
            "messages": [{"role": "system", "content": system}, *messages],
        }
        if self.model.startswith("qwen3"):
            body["think"] = False  # reasoning traces would only slow down structured output
        response = self._post(body)
        if response.status_code == 500 and "repeat limit" in response.text:
            # Small models occasionally loop under a JSON grammar; one retry with more variety usually recovers.
            body["options"] = {**body["options"], "temperature": min(temperature + 0.4, 1.0), "repeat_penalty": 1.15}
            response = self._post(body)
            if response.status_code == 500 and "repeat limit" in response.text:
                raise AIError("bad_output", "The local model got stuck on that request. Try rephrasing it.")
        if response.status_code == 404:
            raise AIError("unavailable", f"Ollama doesn't have the model '{self.model}' (run: ollama pull {self.model}).")
        if response.status_code == 429:
            raise AIError("rate_limited", "The local model is busy. Try again shortly.")
        if response.status_code >= 400:
            raise AIError("upstream", f"Ollama returned an error ({response.status_code}).")
        payload = response.json()
        if payload.get("done_reason") == "length":
            raise AIError("bad_output", "The model's answer was cut off before it finished.")
        return _parse_json_object(payload.get("message", {}).get("content", ""))

    def _post(self, body: dict[str, Any]) -> httpx.Response:
        try:
            return self._client.post("/api/chat", json=body)
        except httpx.TimeoutException as exc:
            raise AIError("timeout", "The local model took too long to respond.") from exc
        except httpx.TransportError as exc:
            raise AIError("unavailable", f"Can't reach Ollama at {self.base_url}. Is it running?") from exc


class OpenAICompatibleProvider:
    """Any endpoint implementing the OpenAI Chat Completions API with json_schema output."""

    name = "openai"

    def __init__(self, base_url: str, api_key: str, model: str, timeout: float) -> None:
        self.model = model
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self._client = httpx.Client(base_url=base_url, headers=headers, timeout=httpx.Timeout(timeout, connect=5.0))
        self.base_url = base_url

    def generate_json(self, *, system, messages, schema, temperature=0.2, max_tokens=4000):  # type: ignore[no-untyped-def]
        body = {
            "model": self.model,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "messages": [{"role": "system", "content": system}, *messages],
            "response_format": {"type": "json_schema", "json_schema": {"name": "response", "schema": schema, "strict": True}},
        }
        try:
            response = self._client.post("/chat/completions", json=body)
        except httpx.TimeoutException as exc:
            raise AIError("timeout", "The AI service took too long to respond.") from exc
        except httpx.TransportError as exc:
            raise AIError("unavailable", f"Can't reach the AI service at {self.base_url}.") from exc
        if response.status_code in (401, 403):
            raise AIError("unavailable", "The AI service rejected the server's API key.")
        if response.status_code == 429:
            raise AIError("rate_limited", "The AI service is rate limiting requests. Try again shortly.")
        if response.status_code >= 400:
            raise AIError("upstream", f"The AI service returned an error ({response.status_code}).")
        choice = (response.json().get("choices") or [{}])[0]
        if choice.get("finish_reason") == "length":
            raise AIError("bad_output", "The model's answer was cut off before it finished.")
        return _parse_json_object((choice.get("message") or {}).get("content", ""))


class AnthropicProvider:
    """Claude via the official Anthropic SDK with structured outputs (output_config.format)."""

    name = "anthropic"

    def __init__(self, api_key: str, model: str, timeout: float, *, base_url: str | None = None) -> None:
        import anthropic

        self._anthropic = anthropic
        self.model = model
        self._client = anthropic.Anthropic(api_key=api_key, timeout=timeout, max_retries=2,
                                           **({"base_url": base_url} if base_url else {}))

    def generate_json(self, *, system, messages, schema, temperature=0.2, max_tokens=4000):  # type: ignore[no-untyped-def]
        anthropic = self._anthropic
        try:
            # Server-side refusal fallback: a declined request is retried on a fallback model in the same call.
            response = self._client.beta.messages.create(
                model=self.model,
                max_tokens=max(max_tokens, 4000),
                system=system,
                messages=messages,
                output_config={"format": {"type": "json_schema", "schema": schema}, "effort": "low"},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APITimeoutError as exc:
            raise AIError("timeout", "The AI service took too long to respond.") from exc
        except anthropic.RateLimitError as exc:
            raise AIError("rate_limited", "The AI service is rate limiting requests. Try again shortly.") from exc
        except anthropic.AuthenticationError as exc:
            raise AIError("unavailable", "The AI service rejected the server's API key.") from exc
        except anthropic.APIStatusError as exc:
            raise AIError("upstream", f"The AI service returned an error ({exc.status_code}).") from exc
        except anthropic.APIConnectionError as exc:
            raise AIError("unavailable", "Can't reach the AI service.") from exc
        if response.stop_reason == "refusal":
            raise AIError("refused", "The AI declined this request. Try rephrasing it.")
        if response.stop_reason == "max_tokens":
            raise AIError("bad_output", "The model's answer was cut off before it finished.")
        text = next((block.text for block in response.content if block.type == "text"), "")
        return _parse_json_object(text)


def build_provider(settings: Settings) -> tuple[AIProvider | None, str | None]:
    """The configured provider, or (None, precise reason) when AI is unavailable."""
    provider = settings.ai_provider
    model = settings.ai_model or DEFAULT_MODELS.get(provider, "")
    if provider == "none":
        return None, "AI isn't configured on the server (set AI_PROVIDER in backend/.env)."
    if provider == "ollama":
        base_url = settings.ai_base_url or DEFAULT_BASE_URLS["ollama"]
        return OllamaProvider(base_url, model, settings.ai_timeout_seconds), None
    if provider == "openai":
        if not model:
            return None, "AI_PROVIDER=openai needs AI_MODEL in backend/.env."
        base_url = settings.ai_base_url or DEFAULT_BASE_URLS["openai"]
        if not settings.ai_api_key and base_url == DEFAULT_BASE_URLS["openai"]:
            return None, "AI_PROVIDER=openai needs AI_API_KEY (or OPENAI_API_KEY) in backend/.env."
        return OpenAICompatibleProvider(base_url, settings.ai_api_key, model, settings.ai_timeout_seconds), None
    if provider == "anthropic":
        if not settings.ai_api_key:
            return None, "AI_PROVIDER=anthropic needs AI_API_KEY (or ANTHROPIC_API_KEY) in backend/.env."
        return AnthropicProvider(settings.ai_api_key, model, settings.ai_timeout_seconds), None
    return None, f"Unknown AI_PROVIDER '{provider}'."
