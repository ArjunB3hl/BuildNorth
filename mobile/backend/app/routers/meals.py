"""Recipes (with AI extraction from pasted text) and the shopping list."""

from __future__ import annotations

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import delete, select

from app.ai import AIError
from app.assistant import extract_recipe
from app.deps import AI, CurrentUser, Db, ai_failure, not_found
from app.models import Recipe, ShoppingItem
from app.schemas import (
    AddToShoppingIn,
    AddToShoppingOut,
    ExtractIn,
    RecipeDraftOut,
    RecipeIn,
    RecipeOut,
    ShoppingItemIn,
    ShoppingItemOut,
    ShoppingItemPatch,
    ShoppingListOut,
)
from app.units import Line, scale, try_combine

router = APIRouter(tags=["meals"])


def _search_text(body: RecipeIn) -> str:
    parts = [body.title, *(i.name for i in body.ingredients), *body.tags]
    return " ".join(parts).lower()


def fill_recipe(recipe: Recipe, body: RecipeIn) -> None:
    recipe.title = body.title
    recipe.servings = body.servings
    recipe.description = body.description
    recipe.ingredients = [i.model_dump() for i in body.ingredients]
    recipe.steps = [s.model_dump() for s in body.steps]
    recipe.tags = body.tags
    recipe.notes = body.notes
    recipe.source = body.source
    recipe.nutrition = body.nutrition.model_dump() if body.nutrition else None
    recipe.search_text = _search_text(body)


def _owned_recipe(db: Db, user_id: str, recipe_id: str) -> Recipe:
    recipe = db.scalar(select(Recipe).where(Recipe.id == recipe_id, Recipe.user_id == user_id))
    if recipe is None:
        raise not_found("Recipe")
    return recipe


@router.get("/recipes")
def list_recipes(user: CurrentUser, db: Db, q: str | None = Query(default=None, max_length=100)) -> list[RecipeOut]:
    query = select(Recipe).where(Recipe.user_id == user.user_id)
    if q and q.strip():
        query = query.where(Recipe.search_text.contains(q.strip().lower(), autoescape=True))
    return [RecipeOut.model_validate(r) for r in db.scalars(query.order_by(Recipe.updated_at.desc()))]


@router.post("/recipes", status_code=status.HTTP_201_CREATED)
def create_recipe(body: RecipeIn, user: CurrentUser, db: Db) -> RecipeOut:
    recipe = Recipe(user_id=user.user_id)
    fill_recipe(recipe, body)
    db.add(recipe)
    db.commit()
    return RecipeOut.model_validate(recipe)


@router.get("/recipes/{recipe_id}")
def get_recipe(recipe_id: str, user: CurrentUser, db: Db) -> RecipeOut:
    return RecipeOut.model_validate(_owned_recipe(db, user.user_id, recipe_id))


@router.put("/recipes/{recipe_id}")
def update_recipe(recipe_id: str, body: RecipeIn, user: CurrentUser, db: Db) -> RecipeOut:
    recipe = _owned_recipe(db, user.user_id, recipe_id)
    fill_recipe(recipe, body)
    db.commit()
    return RecipeOut.model_validate(recipe)


@router.delete("/recipes/{recipe_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recipe(recipe_id: str, user: CurrentUser, db: Db) -> Response:
    db.delete(_owned_recipe(db, user.user_id, recipe_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/recipes/extract")
def extract(body: ExtractIn, user: CurrentUser, ai: AI) -> RecipeDraftOut:
    """Turn pasted text into a draft recipe. Nothing is saved until the user confirms."""
    try:
        draft, warnings = extract_recipe(ai, body.text)
    except AIError as exc:
        raise ai_failure(exc) from exc
    return RecipeDraftOut(draft=draft, warnings=warnings)


# --- shopping list ---------------------------------------------------------------------------

def _shopping(db: Db, user_id: str) -> list[ShoppingItemOut]:
    items = db.scalars(
        select(ShoppingItem).where(ShoppingItem.user_id == user_id).order_by(ShoppingItem.checked, ShoppingItem.created_at)
    )
    return [ShoppingItemOut.model_validate(i) for i in items]


def _owned_item(db: Db, user_id: str, item_id: str) -> ShoppingItem:
    item = db.scalar(select(ShoppingItem).where(ShoppingItem.id == item_id, ShoppingItem.user_id == user_id))
    if item is None:
        raise not_found("Shopping item")
    return item


def _merge_into_list(db: Db, user_id: str, line: Line, recipe_id: str | None) -> bool:
    """Add a line, combining it with an unchecked item when units allow. Returns True if combined."""
    for existing in db.scalars(select(ShoppingItem).where(ShoppingItem.user_id == user_id, ShoppingItem.checked.is_(False))):
        combined = try_combine(Line(existing.name, existing.quantity, existing.unit), line)
        if combined is not None:
            existing.quantity, existing.unit = combined.quantity, combined.unit
            return True
    db.add(ShoppingItem(user_id=user_id, name=line.name, quantity=line.quantity, unit=line.unit, recipe_id=recipe_id))
    db.flush()
    return False


@router.get("/shopping")
def shopping_list(user: CurrentUser, db: Db) -> ShoppingListOut:
    return ShoppingListOut(items=_shopping(db, user.user_id))


@router.post("/shopping", status_code=status.HTTP_201_CREATED)
def add_shopping_item(body: ShoppingItemIn, user: CurrentUser, db: Db) -> ShoppingListOut:
    _merge_into_list(db, user.user_id, Line(body.name, body.quantity, body.unit or None), None)
    db.commit()
    return ShoppingListOut(items=_shopping(db, user.user_id))


@router.post("/recipes/{recipe_id}/shopping")
def add_recipe_to_shopping(recipe_id: str, body: AddToShoppingIn, user: CurrentUser, db: Db) -> AddToShoppingOut:
    recipe = _owned_recipe(db, user.user_id, recipe_id)
    factor = (body.servings or recipe.servings) / max(recipe.servings, 1)
    added = combined = 0
    for ingredient in recipe.ingredients:
        line = Line(ingredient["name"], scale(ingredient.get("quantity"), factor), ingredient.get("unit"))
        if _merge_into_list(db, user.user_id, line, recipe.id):
            combined += 1
        else:
            added += 1
    db.commit()
    return AddToShoppingOut(items=_shopping(db, user.user_id), added=added, combined=combined)


@router.patch("/shopping/{item_id}")
def update_shopping_item(item_id: str, body: ShoppingItemPatch, user: CurrentUser, db: Db) -> ShoppingItemOut:
    item = _owned_item(db, user.user_id, item_id)
    if body.name is not None:
        item.name = body.name
    if body.clear_quantity:
        item.quantity, item.unit = None, None
    else:
        if body.quantity is not None:
            item.quantity = body.quantity
        if body.unit is not None:
            item.unit = body.unit.strip() or None
    if body.checked is not None:
        item.checked = body.checked
    db.commit()
    return ShoppingItemOut.model_validate(item)


@router.delete("/shopping/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shopping_item(item_id: str, user: CurrentUser, db: Db) -> Response:
    db.delete(_owned_item(db, user.user_id, item_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/shopping")
def clear_checked(user: CurrentUser, db: Db) -> ShoppingListOut:
    db.execute(delete(ShoppingItem).where(ShoppingItem.user_id == user.user_id, ShoppingItem.checked.is_(True)))
    db.commit()
    return ShoppingListOut(items=_shopping(db, user.user_id))
