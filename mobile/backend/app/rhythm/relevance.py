"""Deterministic metadata screening; shares its vocabulary with the extension. No model or network calls."""

import json
import re
import unicodedata
from pathlib import Path

from app.rhythm.schemas import Relevance, VideoMetadata

RULES = json.loads(Path(__file__).with_name("relevance-rules.json").read_text())


def normalize(text: str) -> str:
    return re.sub(r"[^\w]+", " ", unicodedata.normalize("NFKC", text).casefold().replace("_", " ")).strip()


def contains(text: str, phrase: str) -> bool:
    return f" {normalize(phrase)} " in f" {text} "


def screen(profile: dict, metadata: VideoMetadata) -> Relevance:
    text = normalize(" ".join(v for v in (metadata.title, metadata.description_excerpt) if v))
    limitations = []
    for field, label in (("title", "Title"), ("channel_name", "Channel"), ("description_excerpt", "Description"),
                         ("duration_seconds", "Duration")):
        if getattr(metadata, field) is None:
            limitations.append(f"{label} is unavailable.")
    if profile.get("preferred_languages"):
        limitations.append("Spoken language is not established by page metadata.")
    if not text:
        return Relevance(status="uncertain", reasons=["There is not enough visible metadata."], limitations=limitations)

    for phrase in RULES["outOfScope"]:
        if contains(text, phrase):
            return Relevance(status="irrelevant", reasons=["This topic is outside Rhythm's selected activities."], limitations=limitations)
    for excluded in profile.get("excluded_topics", []) + profile.get("excluded_content_types", []):
        words = RULES["exclusions"].get(normalize(excluded), [excluded])
        if any(contains(text, word) for word in words):
            return Relevance(status="irrelevant", reasons=[f"Excluded by you: {excluded}."], limitations=limitations)
    if any(contains(text, word) for word in RULES["spectator"]):
        return Relevance(status="irrelevant", reasons=["This is spectator content, not technique practice, a workout or a recipe."],
                         limitations=limitations)

    topics = [topic for topic in profile.get("topics", [])
              if any(contains(text, word) for word in RULES["topics"].get(topic, []))]
    purposes = [purpose for purpose in profile.get("purposes", [])
                if any(contains(text, word) for word in RULES["purposes"].get(purpose, []))]
    if not topics or not purposes:
        other = any(contains(text, word) for key, words in RULES["topics"].items()
                    if key not in profile.get("topics", []) for word in words)
        return Relevance(status="irrelevant" if other and not topics else "uncertain",
                         reasons=["The metadata does not establish both a selected interest and your intended activity."],
                         limitations=limitations)
    equipment = [normalize(v) for v in profile.get("available_equipment", [])]
    for name, words in RULES["equipment"].items():
        required = any(contains(text, word) and not any(contains(text, f"{neg} {word}") for neg in ("no", "without"))
                       for word in words)
        if required and equipment and name not in equipment and "gym access" not in equipment:
            return Relevance(status="irrelevant", reasons=[f"Mentions equipment you did not select: {name}."], limitations=limitations)
    duration = metadata.duration_seconds
    preferred = profile.get("preferred_duration_minutes")
    if profile.get("strict_duration") and (duration is None or duration > preferred * 60):
        return Relevance(status="uncertain" if duration is None else "irrelevant",
                         reasons=["The strict duration limit cannot be verified." if duration is None else "Exceeds your strict duration limit."],
                         limitations=limitations)
    reasons = [f"Matches your interest: {v}." for v in topics] + [f"Matches your purpose: {v}." for v in purposes]
    matches = topics + purposes
    score = 10 * len(matches)
    if profile.get("experience_level") and contains(text, profile["experience_level"]):
        reasons.append(f"Described as {profile['experience_level']}.")
        matches.append(profile["experience_level"])
        score += 3
    else:
        limitations.append("Experience level needs review.")
    if duration is not None and preferred:
        if duration <= preferred * 60:
            reasons.append("Within your preferred duration.")
            score += 2
        else:
            limitations.append("Longer than your preferred duration (a preference, not a strict limit).")
    if "no equipment" in equipment and any(contains(text, word) for word in ("no equipment", "without equipment", "bodyweight")):
        reasons.append("Described as requiring no equipment.")
        score += 3
    else:
        limitations.append("Equipment requirements may be incomplete.")
    return Relevance(status="relevant", reasons=reasons, matching_preferences=matches, limitations=limitations, score=score)
