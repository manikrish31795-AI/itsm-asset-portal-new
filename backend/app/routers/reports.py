"""Reports: asset summaries by location, category, age and cost (with CSV export)."""
import csv
import datetime as dt
import io
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import require_roles
from ..database import get_db
from ..locations import NO_LOCATION, location_clause, location_options, norm
from ..models import Asset, User

router = APIRouter(prefix="/api/reports", tags=["reports"])
staff = require_roles("admin", "technician")

AGE_BUCKETS = [("Under 1 year", 0, 1), ("1 – 2 years", 1, 2), ("2 – 3 years", 2, 3),
               ("3 – 5 years", 3, 5), ("5+ years", 5, 999)]
COST_BUCKETS = [("Under ₹10,000", 0, 10_000), ("₹10,000 – 25,000", 10_000, 25_000),
                ("₹25,000 – 50,000", 25_000, 50_000), ("₹50,000 – 1,00,000", 50_000, 100_000),
                ("₹1,00,000 and above", 100_000, float("inf"))]
UNKNOWN_AGE = "No purchase date"
UNKNOWN_COST = "No cost recorded"
INACTIVE = ("Retired", "Lost")


def age_years(purchase: Optional[dt.date], today: dt.date) -> Optional[float]:
    if not purchase:
        return None
    return max(0.0, (today - purchase).days / 365.25)


def age_label(a: Optional[float]) -> str:
    if a is None:
        return UNKNOWN_AGE
    for label, lo, hi in AGE_BUCKETS:
        if lo <= a < hi:
            return label
    return AGE_BUCKETS[-1][0]


def cost_label(c: Optional[float]) -> str:
    if c is None:
        return UNKNOWN_COST
    for label, lo, hi in COST_BUCKETS:
        if lo <= c < hi:
            return label
    return COST_BUCKETS[-1][0]


def _query(db: Session, location: str, category: str, scope: str):
    q = select(Asset.id, Asset.asset_tag, Asset.name, Asset.category, Asset.status, Asset.location,
               Asset.purchase_date, Asset.purchase_cost, Asset.warranty_expiry, Asset.assigned_username,
               Asset.employee_no, Asset.manufacturer, Asset.model)
    if location:
        clause = location_clause(Asset.location, [location])
        if clause is not None:
            q = q.where(clause)
    if category:
        q = q.where(func.lower(func.trim(Asset.category)) == norm(category))
    if scope != "all":
        q = q.where(Asset.status.not_in(INACTIVE))
    return q


def _rows(db, location, category, scope):
    today = dt.date.today()
    out = []
    for r in db.execute(_query(db, location, category, scope)).all():
        a = age_years(r.purchase_date, today)
        out.append({
            "id": r.id, "tag": r.asset_tag, "name": r.name,
            "category": (r.category or "").strip() or "Unspecified",
            "status": r.status, "location": (r.location or "").strip() or "No location",
            "purchase_date": r.purchase_date, "cost": r.purchase_cost, "age": a,
            "age_label": age_label(a), "cost_label": cost_label(r.purchase_cost),
            "warranty": r.warranty_expiry, "user": r.assigned_username, "emp": r.employee_no,
            "make": r.manufacturer, "model": r.model,
        })
    return out


def _canon(rows, field):
    """Merge spellings that differ only by case/space; show the most common spelling."""
    spell = defaultdict(lambda: defaultdict(int))
    for r in rows:
        spell[norm(r[field])][r[field]] += 1
    best = {k: max(v.items(), key=lambda kv: kv[1])[0] for k, v in spell.items()}
    for r in rows:
        r[field] = best[norm(r[field])]


def _group(rows, key, order=None):
    g = defaultdict(lambda: {"count": 0, "cost": 0.0, "with_cost": 0, "in_use": 0, "in_stock": 0,
                             "in_repair": 0, "age_sum": 0.0, "with_age": 0})
    for r in rows:
        x = g[r[key]]
        x["count"] += 1
        if r["cost"] is not None:
            x["cost"] += r["cost"]
            x["with_cost"] += 1
        if r["age"] is not None:
            x["age_sum"] += r["age"]
            x["with_age"] += 1
        if r["status"] == "In Use":
            x["in_use"] += 1
        elif r["status"] == "In Stock":
            x["in_stock"] += 1
        elif r["status"] == "In Repair":
            x["in_repair"] += 1
    items = [{
        "label": k, "count": v["count"], "cost": round(v["cost"], 2),
        "avg_cost": round(v["cost"] / v["with_cost"], 2) if v["with_cost"] else None,
        "avg_age": round(v["age_sum"] / v["with_age"], 1) if v["with_age"] else None,
        "in_use": v["in_use"], "in_stock": v["in_stock"], "in_repair": v["in_repair"],
        "no_cost": v["count"] - v["with_cost"],
    } for k, v in g.items()]
    if order:
        pos = {n: i for i, n in enumerate(order)}
        items.sort(key=lambda i: pos.get(i["label"], 999))
    else:
        items.sort(key=lambda i: (-i["count"], i["label"].lower()))
    return items


def _build(rows):
    _canon(rows, "category")
    _canon(rows, "location")
    total = len(rows)
    costs = [r["cost"] for r in rows if r["cost"] is not None]
    ages = [r["age"] for r in rows if r["age"] is not None]
    cats = sorted({r["category"] for r in rows}, key=str.lower)
    locs = sorted({r["location"] for r in rows}, key=str.lower)
    matrix = defaultdict(lambda: defaultdict(int))
    for r in rows:
        matrix[r["location"]][r["category"]] += 1
    return {
        "totals": {
            "assets": total, "cost": round(sum(costs), 2),
            "avg_cost": round(sum(costs) / len(costs), 2) if costs else None,
            "avg_age": round(sum(ages) / len(ages), 1) if ages else None,
            "no_cost": total - len(costs), "no_purchase_date": total - len(ages),
            "over_5_years": sum(1 for a in ages if a >= 5),
            "locations": len(locs), "categories": len(cats),
        },
        "by_location": _group(rows, "location"),
        "by_category": _group(rows, "category"),
        "by_status": _group(rows, "status"),
        "by_age": _group(rows, "age_label", [b[0] for b in AGE_BUCKETS] + [UNKNOWN_AGE]),
        "by_cost": _group(rows, "cost_label", [b[0] for b in COST_BUCKETS] + [UNKNOWN_COST]),
        "matrix": {"categories": cats, "rows": [
            {"label": l, "cells": [matrix[l].get(c, 0) for c in cats], "total": sum(matrix[l].values())} for l in locs]},
    }


@router.get("/summary")
def summary(location: str = "", category: str = "", scope: str = Query("active", pattern="^(active|all)$"),
            db: Session = Depends(get_db), _: User = Depends(staff)):
    data = _build(_rows(db, location, category, scope))
    locs, none_n = location_options(db.execute(select(Asset.location, func.count()).group_by(Asset.location)).all())
    cats = [c for c in db.scalars(select(Asset.category).distinct()).all() if (c or "").strip()]
    seen, cat_opts = set(), []
    for c in sorted(cats, key=lambda s: s.lower()):
        if norm(c) not in seen:
            seen.add(norm(c))
            cat_opts.append(c.strip())
    data["options"] = {"locations": [o["name"] for o in locs], "has_no_location": none_n > 0, "categories": cat_opts,
                       "no_location_value": NO_LOCATION}
    data["generated_on"] = dt.date.today().isoformat()
    return data


def _csv(name, header, lines):
    buf = io.StringIO()
    buf.write("﻿")  # so Excel opens the ₹ and other characters correctly
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(lines)
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{name}-{dt.date.today().isoformat()}.csv"'})


@router.get("/export.csv")
def export(report: str = Query("location", pattern="^(location|category|age|cost|matrix|assets)$"),
           location: str = "", category: str = "", scope: str = Query("active", pattern="^(active|all)$"),
           db: Session = Depends(get_db), _: User = Depends(staff)):
    rows = _rows(db, location, category, scope)
    data = _build(rows)
    if report == "matrix":
        m = data["matrix"]
        return _csv("assets-location-by-category", ["Location", *m["categories"], "Total"],
                    [[r["label"], *r["cells"], r["total"]] for r in m["rows"]])
    if report == "assets":
        return _csv("assets-report", ["Asset ID", "Name", "Category", "Status", "Location", "Manufacturer", "Model",
                                      "Assigned to", "Employee ID", "Purchase date", "Age (years)", "Cost (INR)",
                                      "Warranty expiry"],
                    [[r["tag"], r["name"], r["category"], r["status"], r["location"], r["make"] or "", r["model"] or "",
                      r["user"] or "", r["emp"] or "", r["purchase_date"] or "",
                      round(r["age"], 1) if r["age"] is not None else "", r["cost"] if r["cost"] is not None else "",
                      r["warranty"] or ""] for r in sorted(rows, key=lambda r: r["tag"])])
    key, title = {"location": ("by_location", "Location"), "category": ("by_category", "Category"),
                  "age": ("by_age", "Age"), "cost": ("by_cost", "Cost band")}[report]
    return _csv(f"assets-by-{report}", [title, "Assets", "In use", "In stock", "In repair", "Total cost (INR)",
                                        "Average cost (INR)", "Average age (years)", "Assets without cost"],
                [[i["label"], i["count"], i["in_use"], i["in_stock"], i["in_repair"], i["cost"],
                  i["avg_cost"] if i["avg_cost"] is not None else "",
                  i["avg_age"] if i["avg_age"] is not None else "", i["no_cost"]] for i in data[key]])
