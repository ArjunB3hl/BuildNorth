"""On-demand month-end report from owned records; no model, scheduled job or inferred medical advice."""
from calendar import monthrange
from datetime import date, datetime, time, timedelta
from statistics import mean

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.calendar import feed, zone
from app.models import ActivitySession, CheckIn, HealthDay, PlanItem, utcnow
from app.schemas import HealthDayOut


def metric(values: list) -> dict:
    measured = [v for v in values if v is not None]
    return {"average": round(mean(measured), 1) if measured else None,
            "min": min(measured) if measured else None, "max": max(measured) if measured else None,
            "samples": len(measured)}


def report(db: Session, user_id: str, month: str, timezone: str) -> dict:
    tz = zone(timezone)
    try:
        first = date.fromisoformat(month + "-01")
        total = monthrange(first.year, first.month)[1]
        last = first + timedelta(days=total - 1)
    except (ValueError, OverflowError):
        raise HTTPException(422, "Choose a month in YYYY-MM format.") from None
    today = utcnow().astimezone(tz).date()
    if first > today:
        raise HTTPException(422, "Reports are available for this month and earlier months.")
    end = min(last, today)
    entries = feed(db, user_id, first.isoformat(), (end - first).days + 1, timezone)
    real = [e for e in entries if e.source != "demo"]
    health = list(db.scalars(select(HealthDay).where(HealthDay.user_id == user_id,
        HealthDay.date >= first.isoformat(), HealthDay.date <= end.isoformat()).order_by(HealthDay.date)))
    complete = [h for h in health if h.complete]
    checkins = list(db.scalars(select(CheckIn).where(CheckIn.user_id == user_id,
        CheckIn.date >= first.isoformat(), CheckIn.date <= end.isoformat())))
    plans = list(db.scalars(select(PlanItem).where(PlanItem.user_id == user_id,
        PlanItem.date >= first.isoformat(), PlanItem.date <= end.isoformat())))
    sessions = list(db.scalars(select(ActivitySession).where(ActivitySession.user_id == user_id,
        ActivitySession.started_at >= datetime.combine(first, time(), tz),
        ActivitySession.started_at < datetime.combine(end + timedelta(days=1), time(), tz))))
    workouts = [e.workout for e in real if e.workout]
    types: dict[str, dict] = {}
    for w in workouts:
        group = types.setdefault(w.activity_type, {"type": w.activity_type, "count": 0, "minutes": 0, "rates": []})
        group["count"] += 1
        group["minutes"] += w.duration_minutes
        group["rates"].append(w.average_heart_rate_bpm)
    for group in types.values():
        group["heartRate"] = metric(group.pop("rates"))
        group["minutes"] = round(group["minutes"], 1)
    return {
        "month": month, "through": end.isoformat(), "reportDate": last.isoformat(), "timezone": timezone,
        "status": "monthEnded" if today > last else "inProgress", "generatedAt": utcnow().isoformat(),
        "recordedDays": len({e.local_date for e in real} | {h.date for h in health} | {c.date for c in checkins}),
        "daysInPeriod": (end - first).days + 1, "demoEntriesExcluded": len(entries) - len(real),
        "meals": len([e for e in real if e.kind == "meal"]),
        # App sessions and Watch workouts may describe the same exercise. Never sum their minutes together.
        "appWorkouts": len([e for e in real if e.kind == "activity" and e.source != "watch"]),
        "appMinutes": sum(e.duration_minutes or 0 for e in real if e.kind == "activity" and e.source != "watch"),
        "recordedSets": sum(len(e.get("sets", [])) for s in sessions for e in s.entries if not e.get("skipped")),
        "watchWorkouts": len(workouts), "watchMinutes": round(sum(w.duration_minutes for w in workouts), 1),
        "workoutTypes": list(types.values()),
        "watchDays": len(health), "completeWatchDays": len(complete),
        "sleep": metric([h.sleep_minutes for h in complete]),
        "restingHeartRate": metric([h.resting_heart_rate_bpm for h in complete]),
        "hrv": metric([h.hrv_sdnn_ms for h in complete]),
        "steps": metric([h.steps for h in complete]),
        "activeEnergy": metric([h.active_energy_kcal for h in complete]),
        "checkIns": len(checkins), "energy": metric([c.energy for c in checkins]),
        "mood": metric([c.mood for c in checkins]), "reportedSleep": metric([c.sleep_hours for c in checkins]),
        "plans": {"total": len(plans), "done": sum(p.status == "done" for p in plans),
                  "skipped": sum(p.status == "skipped" for p in plans)},
        "healthDays": [HealthDayOut.model_validate(h).model_dump(mode="json", by_alias=True) for h in health],
        "notes": ["Recorded data only, not a medical assessment. Missing readings are not zero.",
            "Watch daily averages use complete uploaded days. Partial days remain visible in the daily detail.",
            "App workouts and Watch workouts are separate: they may describe the same workout.",
            "Sleep stages may overlap between HealthKit sources; their durations are not additive.",
            "Meal counts do not estimate nutrition or calories. Later syncs update this report."],
    }
