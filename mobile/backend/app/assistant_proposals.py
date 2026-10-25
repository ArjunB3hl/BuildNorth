"""Changes proposed by external assistants over MCP, and how they get approved and applied.

Assistants (OpenCode, ChatGPT, Claude) bring their own models and send *structured* proposals:
plan changes, a recipe to save, or a preference to remember. Nothing here calls the app's own AI.
Each proposal is validated with the same rules the app uses, stored for the user who is
authenticated, and shown back as the exact changes. It is applied only after the user approves
it, in the Rhythm app or in the assistant's own approval prompt (MCP elicitation), never
because the assistant says so. Applying is transactional and happens at most once; a proposal
whose targets changed in the meantime is marked stale and nothing is applied.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import preferences as prefs
from app.memory import MemoryService
from app.models import AssistantProposal, PlanItem, Recipe, RememberedPreference, Routine
from app.plan_changes import PlanChangeError, apply_plan_changes
from app.planner import SLOTS, Target, _change, _view_of, build_context, diet_warnings, equipment_warnings, routine_minutes
from app.routers.meals import fill_recipe
from app.schemas import ApplyChange, ChangeItemView, PreferenceIn, RecipeIn

PROPOSAL_LIFETIME = timedelta(hours=48)
MAX_PENDING = 50


class ProposalError(Exception):
    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind  # not_found | invalid | conflict
        self.message = message


# --- inputs from assistants (plain snake_case; unknown fields are rejected) ---------------------

class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlanChangeInput(_Strict):
    op: Literal["add", "move", "replace", "remove"] = Field(description="add a new item, or move/replace/remove an existing one")
    item_id: str | None = Field(default=None, max_length=40, description="Existing plan item ID (move, replace, remove)")
    date: str | None = Field(default=None, description="YYYY-MM-DD. Required for add and move")
    kind: Literal["meal", "activity"] | None = Field(default=None, description="Required for add")
    title: str | None = Field(default=None, max_length=200, description="Name of a new or replacement item")
    time_slot: Literal["morning", "midday", "evening"] | None = Field(default=None, description="Meals: breakfast/lunch/dinner")
    recipe_id: str | None = Field(default=None, max_length=40, description="One of the user's saved recipes (meals)")
    routine_id: str | None = Field(default=None, max_length=40, description="One of the user's saved routines (activities)")
    minutes: int | None = Field(default=None, ge=1, le=600, description="Planned minutes (activities)")
    note: str | None = Field(default=None, max_length=2000, description="Short description, e.g. for a new meal idea")


class IngredientInput(_Strict):
    name: str = Field(min_length=1, max_length=200)
    quantity: float | None = Field(default=None, ge=0, le=100_000)
    unit: str | None = Field(default=None, max_length=20)
    note: str | None = Field(default=None, max_length=200)


class StepInput(_Strict):
    text: str = Field(min_length=1, max_length=2000)
    timer_seconds: int | None = Field(default=None, ge=1, le=86_400)


class RecipeInput(_Strict):
    title: str = Field(min_length=1, max_length=200)
    servings: int = Field(default=1, ge=1, le=100)
    description: str | None = Field(default=None, max_length=2000)
    ingredients: list[IngredientInput] = Field(default_factory=list, max_length=100)
    steps: list[StepInput] = Field(default_factory=list, max_length=100)
    tags: list[str] = Field(default_factory=list, max_length=20)
    notes: str | None = Field(default=None, max_length=4000)


# --- what assistants and the app are shown ------------------------------------------------------

class ChangeLine(BaseModel):
    description: str
    warnings: list[str] = []


class ProposalView(BaseModel):
    id: str
    kind: Literal["plan_changes", "recipe", "preference", "preference_update", "preference_delete"]
    status: Literal["pending", "applied", "rejected", "stale", "expired"]
    summary: str
    changes: list[ChangeLine]
    rejected: list[str]
    details: dict[str, Any] | None
    client: str
    created_at: datetime
    expires_at: datetime
    decided_at: datetime | None
    decided_via: str | None
    result: dict[str, Any] | None
    next_step: str


APPROVAL_HINT = (
    "Nothing has been saved. The user must approve this: in the Rhythm app (Today -> Waiting for your "
    "approval), or by calling apply_proposal, which asks the user directly if this assistant supports approval prompts."
)
NEXT_STEP = {
    "pending": APPROVAL_HINT,
    "applied": "Applied. The user sees it in the app after a refresh.",
    "rejected": "The user rejected this. Nothing was saved.",
    "stale": "Not applied: what it would change was modified after it was proposed. Read the current data again and propose anew.",
    "expired": "Expired without approval. Nothing was saved. Propose it again if it's still wanted.",
}


def now() -> datetime:
    return datetime.now(UTC)


def effective_status(p: AssistantProposal, at: datetime | None = None) -> str:
    if p.status == "pending" and p.expires_at <= (at or now()):
        return "expired"  # computed on read, so reading never writes
    return p.status


def view(p: AssistantProposal) -> ProposalView:
    status = effective_status(p)
    preview = p.preview or {}
    return ProposalView(
        id=p.id,
        kind=p.kind,  # type: ignore[arg-type]
        status=status,  # type: ignore[arg-type]
        summary=p.summary,
        changes=[ChangeLine(**c) for c in preview.get("changes", [])],
        rejected=list(preview.get("rejected", [])),
        details=preview.get("details"),
        client=p.client,
        created_at=p.created_at,
        expires_at=p.expires_at,
        decided_at=p.decided_at,
        decided_via=p.decided_via,
        result=p.result,
        next_step=NEXT_STEP[status],
    )


# --- creating proposals --------------------------------------------------------------------------

def _store(
    db: Session, user_id: str, kind: str, summary: str, payload: dict[str, Any], preview: dict[str, Any],
    request_key: str | None, client: str,
) -> AssistantProposal:
    if request_key:
        existing = db.scalar(
            select(AssistantProposal).where(AssistantProposal.user_id == user_id, AssistantProposal.request_key == request_key)
        )
        if existing is not None:
            return existing  # a retried propose call returns the same proposal
    pending = db.scalars(
        select(AssistantProposal.id).where(AssistantProposal.user_id == user_id, AssistantProposal.status == "pending")
    ).all()
    if len(pending) >= MAX_PENDING:
        raise ProposalError("conflict", "Too many proposals are waiting for approval. Ask the user to review them first.")
    proposal = AssistantProposal(
        user_id=user_id, kind=kind, summary=summary[:500], payload=payload, preview=preview,
        request_key=request_key, client=client[:120], expires_at=now() + PROPOSAL_LIFETIME,
    )
    db.add(proposal)
    try:
        db.commit()
    except IntegrityError:  # a concurrent retry with the same key won
        db.rollback()
        existing = db.scalar(
            select(AssistantProposal).where(AssistantProposal.user_id == user_id, AssistantProposal.request_key == request_key)
        )
        if existing is None:
            raise
        return existing
    return proposal


def _check_date(value: str | None, label: str) -> str:
    if not value:
        raise ProposalError("invalid", f"{label} needs a date (YYYY-MM-DD).")
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise ProposalError("invalid", f"{label}: '{value}' isn't a YYYY-MM-DD date.") from exc


def propose_plan_changes(
    db: Session, user_id: str, changes: list[PlanChangeInput], request_key: str | None = None, client: str = ""
) -> AssistantProposal:
    """Validate structured plan changes against the user's own records and store them for approval."""
    if not changes:
        raise ProposalError("invalid", "Propose at least one change.")
    if len(changes) > 30:
        raise ProposalError("invalid", "Propose at most 30 changes at a time.")
    ctx = build_context(db, user_id, None, [], [])
    recipes = {r.id: r for r in db.scalars(select(Recipe).where(Recipe.user_id == user_id, Recipe.id.in_(
        {c.recipe_id for c in changes if c.recipe_id})))}
    routines = {r.id: r for r in db.scalars(select(Routine).where(Routine.user_id == user_id, Routine.id.in_(
        {c.routine_id for c in changes if c.routine_id})))}
    items = {i.id: i for i in db.scalars(select(PlanItem).where(PlanItem.user_id == user_id, PlanItem.id.in_(
        {c.item_id for c in changes if c.item_id})))}

    plan_changes = []
    apply: list[dict[str, Any]] = []
    expected: dict[str, dict[str, Any]] = {}
    rejected: list[str] = []
    touched: set[str] = set()

    def content(change: PlanChangeInput, kind: str) -> tuple[str, str | None, str | None, int | None, list[str]] | None:
        """Title, recipe_id, routine_id, minutes and warnings for new content, or None (rejected)."""
        warnings: list[str] = []
        if change.recipe_id:
            recipe = recipes.get(change.recipe_id)
            if recipe is None or kind != "meal":
                rejected.append(f"Recipe {change.recipe_id} isn't one of the user's saved recipes (or isn't a meal).")
                return None
            text = " ".join([recipe.title, *(i["name"] for i in recipe.ingredients), *recipe.tags])
            return recipe.title, recipe.id, None, None, diet_warnings(ctx.diets, text)
        if change.routine_id:
            routine = routines.get(change.routine_id)
            if routine is None or kind != "activity":
                rejected.append(f"Routine {change.routine_id} isn't one of the user's saved routines (or isn't an activity).")
                return None
            return routine.name, None, routine.id, change.minutes or routine_minutes(routine.exercises), warnings
        title = " ".join((change.title or "").split())
        if not title:
            rejected.append(f"A {change.op} needs a title, a recipe_id or a routine_id.")
            return None
        if kind == "meal":
            warnings += diet_warnings(ctx.diets, f"{title} {change.note or ''}")
        else:
            warnings += equipment_warnings(ctx.equipment, f"{title} {change.note or ''}")
        return title[:200], None, None, change.minutes if kind == "activity" else None, warnings

    for change in changes:
        target = None
        if change.op != "add":
            item = items.get(change.item_id or "")
            if item is None:
                rejected.append(f"Plan item {change.item_id} wasn't found.")
                continue
            if item.id in touched:
                rejected.append(f"“{item.title}” appears in more than one change; only the first was kept.")
                continue
            if item.status != "planned":
                rejected.append(f"“{item.title}” is already {item.status}, so it can't be changed.")
                continue
            target = Target(item.id, _view_of(item), item.status)
        if change.op == "remove":
            assert target is not None
            plan_changes.append(_change("remove", target, None))
        elif change.op == "move":
            assert target is not None
            new_date = _check_date(change.date, f"Moving “{target.view.title}”")
            slot = change.time_slot if target.view.kind == "meal" and change.time_slot in SLOTS else target.view.time_slot
            if (new_date, slot) == (target.view.date, target.view.time_slot):
                rejected.append(f"“{target.view.title}” is already on {new_date}.")
                continue
            plan_changes.append(_change("move", target, target.view.model_copy(update={"date": new_date, "time_slot": slot})))
        else:
            kind = target.view.kind if target else change.kind
            if kind not in ("meal", "activity"):
                rejected.append("A new item needs kind 'meal' or 'activity'.")
                continue
            new_content = content(change, kind)
            if new_content is None:
                continue
            title, recipe_id, routine_id, minutes, warnings = new_content
            if target is not None:  # replace keeps the item's day and time
                after = target.view.model_copy(update={
                    "title": title, "recipe_id": recipe_id, "routine_id": routine_id, "minutes": minutes, "note": change.note})
                if after == target.view:
                    rejected.append(f"Replacing “{target.view.title}” with the same thing changes nothing.")
                    continue
            else:
                on = _check_date(change.date, f"Adding “{title}”")
                slot = change.time_slot if kind == "meal" else None
                after = ChangeItemView(date=on, kind=kind, title=title, time_slot=slot, recipe_id=recipe_id,
                                       routine_id=routine_id, minutes=minutes, note=change.note)
            plan_changes.append(_change(change.op, target, after, warnings))
        if target is not None:
            touched.add(target.key)
            expected[target.key] = target.view.model_dump()

    if not plan_changes:
        raise ProposalError("invalid", "None of the changes can be applied: " + " ".join(rejected))
    for c in plan_changes:
        apply.append(ApplyChange(op=c.op, target_key=c.target_key, after=c.after).model_dump())
    descriptions = [c.description for c in plan_changes]
    summary = descriptions[0] if len(descriptions) == 1 else f"{len(descriptions)} plan changes: " + "; ".join(descriptions[:3]) + ("…" if len(descriptions) > 3 else "")
    preview = {"changes": [{"description": c.description, "warnings": c.warnings} for c in plan_changes], "rejected": rejected}
    return _store(db, user_id, "plan_changes", summary, {"changes": apply, "expected": expected}, preview, request_key, client)


def propose_recipe(db: Session, user_id: str, recipe: RecipeInput, request_key: str | None = None, client: str = "") -> AssistantProposal:
    """Validate a recipe with the app's own recipe rules; it is saved only after approval."""
    try:
        body = RecipeIn.model_validate({**recipe.model_dump(), "source": "assistant"})
    except ValidationError as exc:
        problems = "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()[:5])
        raise ProposalError("invalid", f"The recipe isn't valid: {problems}") from exc
    if not body.ingredients:
        raise ProposalError("invalid", "A recipe needs at least one ingredient.")
    ctx = build_context(db, user_id, None, [], [])
    warnings = diet_warnings(ctx.diets, " ".join([body.title, *(i.name for i in body.ingredients), *body.tags]))
    same = db.scalar(select(Recipe.id).where(Recipe.user_id == user_id, Recipe.title == body.title))
    if same:
        warnings.append(f"A recipe called “{body.title}” is already saved; approving adds a second one.")
    warnings.append("Recipes from assistants aren't checked for allergens; review the ingredients.")
    details = {
        "title": body.title, "servings": body.servings,
        "ingredients": [" ".join(str(x) for x in (i.quantity, i.unit, i.name) if x not in (None, "")) for i in body.ingredients],
        "steps": [s.text for s in body.steps], "tags": body.tags,
    }
    preview = {"changes": [{"description": f"Save recipe “{body.title}” ({len(body.ingredients)} ingredients, {len(body.steps)} steps)",
                            "warnings": warnings}], "rejected": [], "details": details}
    payload = {"recipe": body.model_dump(mode="json")}
    return _store(db, user_id, "recipe", f"Save recipe “{body.title}”", payload, preview, request_key, client)


def _clean_preference(text: str) -> str:
    try:
        clean = PreferenceIn(text=text).text
    except ValidationError as exc:
        raise ProposalError("invalid", "A preference must be 1–500 characters.") from exc
    phrase = prefs.temporary_reason(clean)
    if phrase:
        raise ProposalError("invalid", f"“{phrase}” makes this a one-off request, not a lasting preference, so it can't be "
                                       "remembered. For a one-off change, propose plan changes instead.")
    return clean


def propose_preference(db: Session, user_id: str, text: str, request_key: str | None = None, client: str = "") -> AssistantProposal:
    """A preference to remember long-term. Only stored after the user approves it."""
    clean = _clean_preference(text)
    existing = {p.text.strip().lower() for p in db.scalars(select(RememberedPreference).where(RememberedPreference.user_id == user_id))}
    if clean.lower() in existing:
        raise ProposalError("conflict", "That preference is already remembered.")
    preview = {"changes": [{"description": f"Remember: “{clean}”", "warnings": []}], "rejected": [],
               "details": {"text": clean}}
    return _store(db, user_id, "preference", f"Remember “{clean[:80]}”", {"text": clean}, preview, request_key, client)


def _owned_preference(db: Session, user_id: str, preference_id: str) -> RememberedPreference:
    pref = db.scalar(select(RememberedPreference).where(
        RememberedPreference.id == preference_id, RememberedPreference.user_id == user_id))
    if pref is None:
        raise ProposalError("not_found", "Saved preference not found. Use get_user_context for current preference IDs.")
    return pref


def propose_preference_change(
    db: Session, user_id: str, preference_id: str, text: str | None, request_key: str | None = None, client: str = ""
) -> AssistantProposal:
    """Correct (text given) or forget (text None) a saved preference. Applied only after the user approves it."""
    pref = _owned_preference(db, user_id, preference_id)
    if text is None:
        preview = {"changes": [{"description": f"Forget: “{pref.text}”", "warnings": []}], "rejected": [],
                   "details": {"preference_id": pref.id, "current": pref.text}}
        payload = {"preference_id": pref.id, "expected_text": pref.text}
        return _store(db, user_id, "preference_delete", f"Forget “{pref.text[:80]}”", payload, preview, request_key, client)
    clean = _clean_preference(text)
    if clean == pref.text:
        raise ProposalError("invalid", "That's already exactly what's saved.")
    preview = {"changes": [{"description": f"Change “{pref.text}” to “{clean}”", "warnings": []}], "rejected": [],
               "details": {"preference_id": pref.id, "current": pref.text, "corrected": clean}}
    payload = {"preference_id": pref.id, "expected_text": pref.text, "text": clean}
    return _store(db, user_id, "preference_update", f"Correct “{pref.text[:60]}”", payload, preview, request_key, client)


# --- reading -------------------------------------------------------------------------------------

def get_owned(db: Session, user_id: str, proposal_id: str) -> AssistantProposal:
    p = db.scalar(select(AssistantProposal).where(AssistantProposal.id == proposal_id, AssistantProposal.user_id == user_id))
    if p is None:
        raise ProposalError("not_found", "Proposal not found.")
    return p


def list_owned(db: Session, user_id: str, status: str | None = None, limit: int = 50) -> list[AssistantProposal]:
    query = select(AssistantProposal).where(AssistantProposal.user_id == user_id).order_by(AssistantProposal.created_at.desc())
    rows = list(db.scalars(query.limit(200)))
    if status:
        rows = [p for p in rows if effective_status(p) == status]
    return rows[:limit]


# --- deciding ------------------------------------------------------------------------------------

def _claim(db: Session, p: AssistantProposal, via: str) -> bool:
    """Atomically move a pending proposal to applied (within the caller's transaction)."""
    result = db.execute(
        update(AssistantProposal)
        .where(AssistantProposal.id == p.id, AssistantProposal.user_id == p.user_id, AssistantProposal.status == "pending")
        .values(status="applied", decided_at=now(), decided_via=via)
    )
    return result.rowcount == 1


def _finish(db: Session, p: AssistantProposal, status: str, via: str | None, result: dict[str, Any] | None = None) -> None:
    db.execute(
        update(AssistantProposal)
        .where(AssistantProposal.id == p.id, AssistantProposal.status == "pending")
        .values(status=status, decided_at=now(), decided_via=via, result=result)
    )
    db.commit()


def approve(db: Session, memory: MemoryService | None, user_id: str, proposal_id: str, via: Literal["app", "client_prompt"]) -> AssistantProposal:
    """Apply a proposal the user approved. Safe to repeat: an applied proposal is returned unchanged."""
    p = get_owned(db, user_id, proposal_id)
    status = effective_status(p)
    if status == "applied":
        return p
    if status == "expired":
        _finish(db, p, "expired", None)
        db.refresh(p)
        return p
    if status != "pending":
        return p

    if p.kind == "plan_changes":
        changes = [ApplyChange.model_validate(c) for c in p.payload["changes"]]
        expected = {k: ChangeItemView.model_validate(v) for k, v in p.payload.get("expected", {}).items()}
        if not _claim(db, p, via):
            db.rollback()
            db.refresh(p)
            return p
        try:
            already, touched = apply_plan_changes(db, user_id, p.id, changes, expected)
        except PlanChangeError as exc:
            # apply_plan_changes rolled back, including the claim above.
            _finish(db, p, "stale" if exc.kind in ("stale", "not_found") else "rejected", via, {"error": exc.message})
            db.refresh(p)
            return p
        db.execute(update(AssistantProposal).where(AssistantProposal.id == p.id).values(
            result={"items": [{"id": i.id, "date": i.date, "title": i.title} for i in touched], "already_applied": already}))
        db.commit()
    elif p.kind == "recipe":
        if not _claim(db, p, via):
            db.rollback()
            db.refresh(p)
            return p
        recipe = Recipe(user_id=user_id)
        fill_recipe(recipe, RecipeIn.model_validate(p.payload["recipe"]))
        db.add(recipe)
        db.flush()
        db.execute(update(AssistantProposal).where(AssistantProposal.id == p.id).values(
            result={"recipe_id": recipe.id, "title": recipe.title}))
        db.commit()
    elif p.kind == "preference":
        if not _claim(db, p, via):
            db.rollback()
            db.refresh(p)
            return p
        text = p.payload["text"]
        same = db.scalar(select(RememberedPreference).where(
            RememberedPreference.user_id == user_id, RememberedPreference.text == text))
        if same is None:
            pref = prefs.create_preference(db, memory, user_id, text, "assistant", p.client)  # commits, including the claim
            result = {"preference_id": pref.id, "memory_status": pref.memory_status}
        else:
            result = {"preference_id": same.id, "memory_status": same.memory_status, "note": "already remembered"}
        db.execute(update(AssistantProposal).where(AssistantProposal.id == p.id).values(result=result))
        db.commit()
    else:  # preference_update | preference_delete
        current = db.scalar(select(RememberedPreference).where(
            RememberedPreference.id == p.payload["preference_id"], RememberedPreference.user_id == user_id))
        if current is None or current.text != p.payload["expected_text"]:
            _finish(db, p, "stale", via, {"error": "The preference was changed or deleted after this was proposed."})
            db.refresh(p)
            return p
        if not _claim(db, p, via):
            db.rollback()
            db.refresh(p)
            return p
        if p.kind == "preference_update":
            # Erases the old memory scope (or tombstones it) and commits the claim with the corrected row.
            pref = prefs.update_preference(db, memory, current, p.payload["text"], "assistant", p.client)
            result = {"preference_id": pref.id, "replaced": p.payload["preference_id"], "memory_status": pref.memory_status}
        else:
            prefs.delete_preference(db, memory, current)
            result = {"deleted": p.payload["preference_id"]}
        db.execute(update(AssistantProposal).where(AssistantProposal.id == p.id).values(result=result))
        db.commit()
    db.refresh(p)
    return p


def reject(db: Session, user_id: str, proposal_id: str) -> AssistantProposal:
    p = get_owned(db, user_id, proposal_id)
    if effective_status(p) == "pending":
        _finish(db, p, "rejected", "app")
        db.refresh(p)
    return p
