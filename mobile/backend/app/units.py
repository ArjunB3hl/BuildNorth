"""Ingredient units and shopping-list combination.

Quantities are combined only when their units are compatible: mass with mass,
volume with volume, plain counts with counts, or the identical unit for things
like "clove" or "can". Everything else stays a separate line so nothing is
silently converted between incompatible units (e.g. cups of flour into grams).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

MASS = {"mg": 0.001, "g": 1.0, "kg": 1000.0, "oz": 28.3495, "lb": 453.592}
VOLUME = {
    "ml": 1.0,
    "l": 1000.0,
    "tsp": 4.92892,
    "tbsp": 14.7868,
    "fl oz": 29.5735,
    "cup": 236.588,
    "pint": 473.176,
    "quart": 946.353,
    "gallon": 3785.41,
}

ALIASES = {
    "milligram": "mg", "milligrams": "mg",
    "gram": "g", "grams": "g", "gr": "g",
    "kilogram": "kg", "kilograms": "kg", "kgs": "kg",
    "ounce": "oz", "ounces": "oz",
    "pound": "lb", "pounds": "lb", "lbs": "lb",
    "millilitre": "ml", "milliliter": "ml", "millilitres": "ml", "milliliters": "ml", "mls": "ml",
    "litre": "l", "liter": "l", "litres": "l", "liters": "l",
    "teaspoon": "tsp", "teaspoons": "tsp", "tsps": "tsp",
    "tablespoon": "tbsp", "tablespoons": "tbsp", "tbsps": "tbsp", "tbs": "tbsp",
    "fluid ounce": "fl oz", "fluid ounces": "fl oz", "floz": "fl oz",
    "cups": "cup", "c": "cup",
    "pints": "pint", "quarts": "quart", "qt": "quart", "gallons": "gallon", "gal": "gallon",
    "piece": "", "pieces": "", "pc": "", "pcs": "", "whole": "", "x": "",
}


def normalize_unit(unit: str | None) -> str:
    """Canonical unit string; "" means a plain count."""
    if not unit:
        return ""
    cleaned = re.sub(r"[.\s]+", " ", unit.strip().lower()).strip()
    return ALIASES.get(cleaned, cleaned)


def dimension(unit: str | None) -> str:
    canonical = normalize_unit(unit)
    if canonical in MASS:
        return "mass"
    if canonical in VOLUME:
        return "volume"
    if canonical == "":
        return "count"
    return f"unit:{canonical}"


def normalize_name(name: str) -> str:
    """Key used to decide whether two lines are the same ingredient."""
    key = re.sub(r"[^a-z0-9 ]+", " ", name.lower())
    key = re.sub(r"\s+", " ", key).strip()
    words = [w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w for w in key.split(" ")]
    return " ".join(words)


@dataclass
class Line:
    name: str
    quantity: float | None
    unit: str | None


def _to_base(quantity: float, unit: str | None) -> float:
    canonical = normalize_unit(unit)
    return quantity * MASS.get(canonical, VOLUME.get(canonical, 1.0))


def _display(base_quantity: float, dim: str, preferred_unit: str | None) -> tuple[float, str | None]:
    """Express a base quantity in the existing line's unit when possible, else a sensible metric unit."""
    preferred = normalize_unit(preferred_unit)
    if dim == "mass":
        if preferred in MASS:
            return round(base_quantity / MASS[preferred], 3), preferred
        return (round(base_quantity / 1000, 3), "kg") if base_quantity >= 1000 else (round(base_quantity, 1), "g")
    if dim == "volume":
        if preferred in VOLUME:
            return round(base_quantity / VOLUME[preferred], 3), preferred
        return (round(base_quantity / 1000, 3), "l") if base_quantity >= 1000 else (round(base_quantity, 1), "ml")
    return round(base_quantity, 3), (preferred_unit or None)


def try_combine(existing: Line, incoming: Line) -> Line | None:
    """Combined line, or None when the two lines must stay separate."""
    if normalize_name(existing.name) != normalize_name(incoming.name):
        return None
    if existing.quantity is None and incoming.quantity is None:
        return Line(existing.name, None, existing.unit or incoming.unit)
    if existing.quantity is None or incoming.quantity is None:
        return None  # "salt to taste" + "5 g salt": keep both rather than guess
    dim = dimension(existing.unit)
    if dim != dimension(incoming.unit):
        return None
    total = _to_base(existing.quantity, existing.unit) + _to_base(incoming.quantity, incoming.unit)
    quantity, unit = _display(total, dim, existing.unit)
    return Line(existing.name, quantity, unit)


def scale(quantity: float | None, factor: float) -> float | None:
    return None if quantity is None else round(quantity * factor, 3)
