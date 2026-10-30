"""Location helpers shared by the asset list filter and audits.

Locations are free text (imports bring in all sorts of spellings), so matching ignores case and
surrounding spaces: "chennai hq " and "Chennai HQ" are the same place.
"""
from collections import defaultdict

from sqlalchemy import func, or_

NO_LOCATION = "__none__"  # filter value meaning "assets that have no location"


def norm(value) -> str:
    return (value or "").strip().lower()


def location_clause(column, values):
    """SQL condition: column matches ANY of the given locations (NO_LOCATION matches blank/NULL)."""
    parts = []
    for v in values:
        if v == NO_LOCATION:
            parts.append(or_(column.is_(None), func.trim(column) == ""))
        elif norm(v):
            parts.append(func.lower(func.trim(column)) == norm(v))
    if not parts:
        return None
    return parts[0] if len(parts) == 1 else or_(*parts)


def location_options(rows):
    """rows: iterable of (location, count) -> ([{name, count}] sorted by name, count_without_location).

    Spellings that differ only by case/spacing are merged; the most common spelling is shown."""
    merged: dict[str, dict] = defaultdict(lambda: {"count": 0, "spellings": defaultdict(int)})
    none_count = 0
    for loc, n in rows:
        key = norm(loc)
        if not key:
            none_count += n
            continue
        merged[key]["count"] += n
        merged[key]["spellings"][(loc or "").strip()] += n
    options = [
        {"name": max(m["spellings"].items(), key=lambda kv: kv[1])[0], "count": m["count"]}
        for m in merged.values()
    ]
    options.sort(key=lambda o: o["name"].lower())
    return options, none_count
