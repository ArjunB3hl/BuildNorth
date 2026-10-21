"""Progress figures computed only from records the user actually saved."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date, timedelta

from app.models import ActivitySession, CheckIn, PlanItem
from app.schemas import ProgressDay, ProgressOut, ProgressWindow


def _window(today: date, days: int) -> set[str]:
    return {(today - timedelta(days=offset)).isoformat() for offset in range(days)}


def _avg(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def _summary(days: int, today: date, sessions, checkins, plan_items) -> ProgressWindow:  # type: ignore[no-untyped-def]
    window = _window(today, days)
    in_sessions = [s for s in sessions if s.local_date in window]
    in_checkins = [c for c in checkins if c.date in window]
    in_plan = [p for p in plan_items if p.date in window]
    return ProgressWindow(
        days=days,
        sessions_completed=len(in_sessions),
        active_minutes=round(sum(s.duration_seconds for s in in_sessions) / 60),
        plan_done=sum(1 for p in in_plan if p.status == "done"),
        plan_skipped=sum(1 for p in in_plan if p.status == "skipped"),
        check_ins=len(in_checkins),
        average_energy=_avg([c.energy for c in in_checkins]),
        average_mood=_avg([c.mood for c in in_checkins]),
        average_sleep_hours=_avg([c.sleep_hours for c in in_checkins if c.sleep_hours is not None]),
    )


def compute_progress(
    today_str: str,
    sessions: Iterable[ActivitySession],
    checkins: Iterable[CheckIn],
    plan_items: Iterable[PlanItem],
) -> ProgressOut:
    today = date.fromisoformat(today_str)
    sessions, checkins, plan_items = list(sessions), list(checkins), list(plan_items)

    active_days = {s.local_date for s in sessions} | {c.date for c in checkins} | {p.date for p in plan_items if p.status == "done"}
    # A streak still counts if today has nothing logged yet.
    cursor = today if today.isoformat() in active_days else today - timedelta(days=1)
    streak = 0
    while cursor.isoformat() in active_days:
        streak += 1
        cursor -= timedelta(days=1)

    by_checkin = {c.date: c for c in checkins}
    last7 = []
    for offset in range(6, -1, -1):
        day = (today - timedelta(days=offset)).isoformat()
        day_sessions = [s for s in sessions if s.local_date == day]
        checkin = by_checkin.get(day)
        last7.append(
            ProgressDay(
                date=day,
                sessions=len(day_sessions),
                active_minutes=round(sum(s.duration_seconds for s in day_sessions) / 60),
                energy=checkin.energy if checkin else None,
                mood=checkin.mood if checkin else None,
            )
        )

    return ProgressOut(
        today=today.isoformat(),
        week=_summary(7, today, sessions, checkins, plan_items),
        month=_summary(30, today, sessions, checkins, plan_items),
        streak_days=streak,
        last7=last7,
    )
