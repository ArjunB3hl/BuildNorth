"""YouTube Data API search + details only. No captions endpoint, scraping API or audio download."""

from __future__ import annotations

import html
import json
import re
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from pydantic import ValidationError

from app.rhythm.schemas import VideoMetadata


class ProviderError(Exception):
    pass


def duration_seconds(value: str | None) -> float | None:
    if not value:
        return None
    match = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?", value)
    if not match or not any(match.groups()):
        return None
    seconds = sum(float(v or 0) * weight for v, weight in zip(match.groups(), (3600, 60, 1)))
    return seconds or None  # PT0S commonly means a live/upcoming video whose length is not established.


class YouTube:
    def __init__(self, api_key: str):
        self.api_key = api_key

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _get(self, resource: str, params: dict) -> dict:
        # urllib does not log request URLs (httpx's INFO logger would expose a query-string API key).
        url = f"https://www.googleapis.com/youtube/v3/{resource}?{urlencode({**params, 'key': self.api_key})}"
        try:
            with urlopen(Request(url, headers={"Accept": "application/json"}), timeout=8) as response:
                raw = response.read(1_000_001)
                if len(raw) > 1_000_000:
                    raise ProviderError("YouTube returned an oversized response.")
                decoded = json.loads(raw)
                if not isinstance(decoded, dict):
                    raise ProviderError("YouTube returned an invalid response.")
                return decoded
        except HTTPError as exc:
            if exc.code in (403, 429):
                raise ProviderError("YouTube search is unavailable: check API access or quota. Rhythm will not retry automatically.") from None
            raise ProviderError("YouTube could not return search results.") from None
        except (OSError, ValueError):
            raise ProviderError("YouTube search could not be reached or returned invalid data.") from None

    @staticmethod
    def _items(response: dict) -> list[dict]:
        items = response.get("items", [])
        if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
            raise ProviderError("YouTube returned invalid video metadata.")
        return items

    def search(self, query: str, limit: int, language: str | None) -> list[VideoMetadata]:
        if not self.configured:
            raise ProviderError("Video search is not configured. Add YOUTUBE_API_KEY to the backend environment.")
        params = {"part": "snippet", "type": "video", "q": query, "maxResults": limit, "safeSearch": "moderate"}
        if language:
            params["relevanceLanguage"] = language
        response = self._get("search", params)
        ids = []
        for item in self._items(response)[:limit]:
            identity = item.get("id", {})
            video_id = identity.get("videoId", "") if isinstance(identity, dict) else ""
            if isinstance(video_id, str) and re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id) and video_id not in ids:
                ids.append(video_id)
        if not ids:
            return []
        details = self._get("videos", {"part": "snippet,contentDetails", "id": ",".join(ids)})
        videos = []
        for item in self._items(details)[:limit]:
            if item.get("id") not in ids:
                continue
            snippet = item.get("snippet", {})
            if not isinstance(snippet, dict) or not isinstance(item.get("contentDetails", {}), dict):
                raise ProviderError("YouTube returned invalid video details.")
            try:
                videos.append(VideoMetadata(
                    video_id=item["id"], canonical_url=f"https://www.youtube.com/watch?v={item['id']}",
                    title=html.unescape(snippet["title"])[:300] if "title" in snippet else None,
                    channel_name=html.unescape(snippet["channelTitle"])[:150] if "channelTitle" in snippet else None,
                    description_excerpt=html.unescape(snippet["description"])[:1200] if "description" in snippet else None,
                    duration_seconds=duration_seconds(item.get("contentDetails", {}).get("duration")),
                ))
            except (ValidationError, TypeError):
                raise ProviderError("YouTube returned metadata that could not be validated.") from None
        return videos
