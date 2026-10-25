"""Fill the local test backend's fictional account with something to look at, through the real API.

    cd mobile/backend
    .venv/Scripts/python ../../win/tools/local-backend/seed.py

Run it while serve.py is running (it reads the token serve.py saved). It adds two recipes, a routine, today's
plan, a preference, a shopping list and the backend's own demo Calendar week. Running it again adds them again.
"""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

import httpx

DATA = Path(__file__).resolve().parent / ".data"
API = "http://127.0.0.1:8000"
token = (DATA / "dev-token.txt").read_text().strip()
client = httpx.Client(base_url=API, headers={"Authorization": f"Bearer {token}"}, timeout=30)
today = dt.date.today().isoformat()


def call(method: str, path: str, body: dict | None = None) -> dict:
    response = client.request(method, path, json=body)
    if response.status_code >= 400:
        sys.exit(f"{method} {path} -> {response.status_code}: {response.text}")
    return response.json() if response.content else {}


call("PUT", "/profile", {
    "preferredName": "Sam", "goals": ["Eat more plants", "Move 3 times a week"],
    "dietaryPreferences": ["Mostly vegetarian"], "equipment": ["Dumbbells", "Yoga mat"],
    "experienceLevel": "beginner", "routineTimes": ["morning", "evening"], "onboardingCompleted": True,
})
curry = call("POST", "/recipes", {
    "title": "Chickpea and spinach curry", "servings": 4, "description": "A one-pan weeknight curry.",
    "ingredients": [
        {"name": "chickpeas, drained", "quantity": 800, "unit": "g"},
        {"name": "baby spinach", "quantity": 200, "unit": "g"},
        {"name": "coconut milk", "quantity": 400, "unit": "ml"},
    ],
    "steps": [{"text": "Soften the onion and spices.", "timerSeconds": 300},
              {"text": "Add chickpeas and coconut milk; simmer.", "timerSeconds": 900}],
    "tags": ["vegetarian", "batch cook"],
})
oats = call("POST", "/recipes", {
    "title": "Greek yogurt overnight oats", "servings": 1,
    "ingredients": [{"name": "rolled oats", "quantity": 50, "unit": "g"},
                    {"name": "Greek yogurt", "quantity": 150, "unit": "g"}],
    "steps": [{"text": "Mix and leave in the fridge overnight.", "timerSeconds": None}],
    "tags": ["breakfast"],
})
routine = call("POST", "/routines", {
    "name": "Full body at home",
    "exercises": [{"name": "Bodyweight squats", "sets": 3, "reps": 12},
                  {"name": "Push-ups", "sets": 3, "reps": 8},
                  {"name": "Plank", "sets": 3, "durationSeconds": 30}],
})
for item in (
    {"date": today, "kind": "meal", "title": oats["title"], "timeSlot": "morning", "recipeId": oats["id"]},
    {"date": today, "kind": "activity", "title": routine["name"], "timeSlot": "evening", "routineId": routine["id"],
     "minutes": 30},
    {"date": today, "kind": "meal", "title": curry["title"], "timeSlot": "evening", "recipeId": curry["id"]},
):
    call("POST", "/plan", item)
call("POST", "/preferences", {"text": "I prefer short workouts on weekdays", "source": "app"})
call("POST", f"/recipes/{curry['id']}/shopping", {"servings": 4})
call("POST", "/calendar/demo", {"date": today, "timezone": "UTC"})
print(f"Seeded the local account for {today}.")
