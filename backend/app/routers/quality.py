"""Data quality check: finds duplicates, missing details and inconsistencies in the asset list.

Nothing here changes data except the "standardise spelling" fix (admin only), which only merges spellings that
differ by letter case or spaces, e.g. "chennai hq " -> "Chennai HQ".
"""
import csv
import datetime as dt
import io
import re
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import require_roles
from ..database import get_db
from ..locations import location_clause, norm
from ..models import Asset, AssetHistory, User

router = APIRouter(prefix="/api/quality", tags=["quality"])
staff = require_roles("admin", "technician")
admin = require_roles("admin")

INACTIVE = ("Retired", "Lost")
PLACEHOLDERS = {"", "na", "n/a", "n.a", "none", "null", "nil", "-", "--", "---", "0", "unknown", "tbd", "xxx",
                "not available", "not applicable", "no serial", "to be updated"}

# key, title, group, severity, description
CHECKS = [
    ("dup_serial", "Duplicate serial numbers", "Duplicates", "high",
     "Two or more assets share the same serial number. Usually the same device entered twice."),
    ("dup_mac", "Duplicate MAC addresses", "Duplicates", "high",
     "Two or more assets share a MAC address."),
    ("dup_hostname", "Duplicate hostnames", "Duplicates", "medium",
     "Two or more assets share a hostname."),
    ("in_use_unassigned", "In Use but nobody assigned", "Inconsistent", "high",
     "Status is In Use but there is no person or employee ID on the asset."),
    ("stock_but_assigned", "Assigned but marked In Stock", "Inconsistent", "medium",
     "The asset has a person assigned but its status says In Stock."),
    ("emp_name_conflict", "Same employee ID, different names", "Inconsistent", "high",
     "One employee ID appears with more than one name (a typo, or two people sharing an ID)."),
    ("name_emp_conflict", "Same name, different employee IDs", "Inconsistent", "medium",
     "One person's name appears with more than one employee ID."),
    ("future_purchase", "Purchase date in the future", "Inconsistent", "medium",
     "The purchase date is after today."),
    ("warranty_before_purchase", "Warranty ends before purchase", "Inconsistent", "medium",
     "The warranty expiry date is earlier than the purchase date."),
    ("bad_cost", "Zero or negative cost", "Inconsistent", "low",
     "A cost was entered but it is zero or negative."),
    ("no_location", "No location", "Missing details", "high",
     "Location is blank, so the asset drops out of location reports and audits."),
    ("no_serial", "No serial number", "Missing details", "medium",
     "Serial number is blank or a placeholder such as NA, N/A or '-'."),
    ("no_purchase_date", "No purchase date", "Missing details", "medium",
     "Needed for the age report and depreciation."),
    ("no_cost", "No purchase cost", "Missing details", "medium",
     "Needed for the cost report and total asset value."),
    ("no_warranty", "No warranty date", "Missing details", "low",
     "Without it, warranty alerts cannot work for this asset."),
    ("no_make_model", "No manufacturer or model", "Missing details", "low",
     "Manufacturer or model is blank."),
    ("no_emp_id", "Person assigned but no employee ID", "Missing details", "medium",
     "A person is named on the asset but the employee ID is blank, so Employee ID search will not find it."),
    ("location_variants", "Location spelled several ways", "Spelling", "medium",
     "The same location is written in different letter-case or spacing, e.g. 'Chennai HQ' and 'chennai hq '."),
    ("category_variants", "Category spelled several ways", "Spelling", "medium",
     "The same category is written in different letter-case or spacing."),
]
META = {c[0]: c for c in CHECKS}
GROUP_CHECKS = {"dup_serial", "dup_mac", "dup_hostname", "emp_name_conflict", "name_emp_conflict"}
VARIANT_CHECKS = {"location_variants": "location", "category_variants": "category"}


def _clean(v) -> str:
    return (v or "").strip()


def _real(v) -> str:
    """Normalised value, or '' when it is blank or a placeholder."""
    n = re.sub(r"\s+", " ", _clean(v).lower())
    return "" if n in PLACEHOLDERS else n


def _mac(v) -> str:
    n = re.sub(r"[^0-9a-f]", "", _clean(v).lower())
    return "" if len(n) < 12 or set(n) <= {"0"} or set(n) <= {"f"} else n


def _assignee(a: Asset) -> str:
    return _clean(a.assigned_username) or (a.assigned_to.full_name if a.assigned_to else "")


def _load(db: Session, scope: str, location: str = "", category: str = "") -> list[Asset]:
    stmt = select(Asset)
    if scope != "all":
        stmt = stmt.where(Asset.status.not_in(INACTIVE))
    if location:
        clause = location_clause(Asset.location, [location])
        if clause is not None:
            stmt = stmt.where(clause)
    if category:
        stmt = stmt.where(func.lower(func.trim(Asset.category)) == norm(category))
    return list(db.scalars(stmt.order_by(Asset.asset_tag)).all())


def _shared(assets, keyfn):
    groups = defaultdict(list)
    for a in assets:
        k = keyfn(a)
        if k:
            groups[k].append(a)
    return {k: v for k, v in groups.items() if len(v) > 1}


def _detect(assets: list[Asset], today: dt.date) -> tuple[dict[str, list[tuple[Asset, str]]], dict[str, list[dict]]]:
    """-> (flags, variants). flags[check] = [(asset, detail)], variants[check] = [{label, variants, total}]."""
    flags: dict[str, list[tuple[Asset, str]]] = {c[0]: [] for c in CHECKS}

    for key, fn, label in (("dup_serial", lambda a: _real(a.serial_number), "Serial"),
                           ("dup_mac", lambda a: _mac(a.mac_address), "MAC"),
                           ("dup_hostname", lambda a: _real(a.hostname), "Hostname")):
        for _, grp in sorted(_shared(assets, fn).items()):
            shown = _clean(getattr(grp[0], {"dup_serial": "serial_number", "dup_mac": "mac_address",
                                            "dup_hostname": "hostname"}[key]))
            for a in grp:
                others = ", ".join(x.asset_tag for x in grp if x.id != a.id)
                flags[key].append((a, f"{label} {shown} also on {others}"))

    emp_names = defaultdict(lambda: defaultdict(list))
    name_emps = defaultdict(lambda: defaultdict(list))
    for a in assets:
        emp, who = _real(a.employee_no), _assignee(a)
        if emp and who:
            emp_names[emp][norm(who)].append(a)
            name_emps[norm(who)][emp].append(a)
    for emp, names in sorted(emp_names.items()):
        if len(names) > 1:
            shown = " / ".join(sorted({_assignee(x) for v in names.values() for x in v}))
            for v in names.values():
                for a in v:
                    flags["emp_name_conflict"].append((a, f"Employee ID {_clean(a.employee_no)} used by: {shown}"))
    for who, emps in sorted(name_emps.items()):
        if len(emps) > 1:
            shown = " / ".join(sorted({_clean(x.employee_no) for v in emps.values() for x in v}))
            for v in emps.values():
                for a in v:
                    flags["name_emp_conflict"].append((a, f"{_assignee(a)} has several IDs: {shown}"))

    for a in assets:
        who = _assignee(a)
        if a.status == "In Use" and not who and not _real(a.employee_no):
            flags["in_use_unassigned"].append((a, "Status In Use, no assignee"))
        if a.status == "In Stock" and who:
            flags["stock_but_assigned"].append((a, f"In Stock but assigned to {who}"))
        if a.purchase_date and a.purchase_date > today:
            flags["future_purchase"].append((a, f"Purchase date {a.purchase_date.isoformat()}"))
        if a.purchase_date and a.warranty_expiry and a.warranty_expiry < a.purchase_date:
            flags["warranty_before_purchase"].append(
                (a, f"Bought {a.purchase_date.isoformat()}, warranty ends {a.warranty_expiry.isoformat()}"))
        if a.purchase_cost is not None and a.purchase_cost <= 0:
            flags["bad_cost"].append((a, f"Cost {a.purchase_cost:g}"))
        if not _clean(a.location):
            flags["no_location"].append((a, "Location blank"))
        if not _real(a.serial_number):
            flags["no_serial"].append((a, "Blank" if not _clean(a.serial_number) else f"Placeholder '{_clean(a.serial_number)}'"))
        if not a.purchase_date:
            flags["no_purchase_date"].append((a, "Purchase date blank"))
        if a.purchase_cost is None:
            flags["no_cost"].append((a, "Cost blank"))
        if not a.warranty_expiry:
            flags["no_warranty"].append((a, "Warranty date blank"))
        if not _clean(a.manufacturer) or not (_clean(a.model) or _clean(a.model_no)):
            miss = [n for n, ok in (("manufacturer", _clean(a.manufacturer)), ("model", _clean(a.model) or _clean(a.model_no))) if not ok]
            flags["no_make_model"].append((a, "Missing " + " and ".join(miss)))
        if who and not _real(a.employee_no):
            flags["no_emp_id"].append((a, f"{who} has no employee ID"))

    variants: dict[str, list[dict]] = {}
    for check, field in VARIANT_CHECKS.items():
        spell = defaultdict(lambda: defaultdict(int))
        for a in assets:
            v = _clean(getattr(a, field))
            if v:
                spell[norm(re.sub(r"\s+", " ", v))][v] += 1
        out = []
        for _, forms in spell.items():
            if len(forms) > 1:
                items = sorted(forms.items(), key=lambda kv: (-kv[1], kv[0]))
                out.append({"label": items[0][0], "suggested": items[0][0], "total": sum(forms.values()),
                            "variants": [{"name": n, "count": c} for n, c in items]})
        out.sort(key=lambda g: g["label"].lower())
        variants[check] = out
    return flags, variants


def _count(check, flags, variants):
    return len(variants[check]) if check in VARIANT_CHECKS else len(flags[check])


@router.get("/summary")
def summary(scope: str = Query("active", pattern="^(active|all)$"), location: str = "", category: str = "",
            db: Session = Depends(get_db), _: User = Depends(staff)):
    assets = _load(db, scope, location, category)
    flags, variants = _detect(assets, dt.date.today())
    bad = {a.id for check, rows in flags.items() for a, _ in rows}
    # spelling checks list groups, so count the assets written the unusual way toward the clean score
    for check, field in VARIANT_CHECKS.items():
        odd = {v["name"] for g in variants[check] for v in g["variants"][1:]}  # all but the most common spelling
        bad |= {a.id for a in assets if _clean(getattr(a, field)) in odd}
    total = len(assets)
    checks = [{"key": k, "title": t, "group": g, "severity": s, "description": d,
               "count": _count(k, flags, variants), "fixable": k in VARIANT_CHECKS}
              for k, t, g, s, d in CHECKS]
    return {
        "total_assets": total, "assets_with_issues": len(bad),
        "clean_percent": round(100 * (total - len(bad)) / total, 1) if total else 100.0,
        "checks": checks, "checks_failing": sum(1 for c in checks if c["count"]),
        "generated_on": dt.date.today().isoformat(),
    }


def _item(a: Asset, detail: str) -> dict:
    return {"id": a.id, "asset_tag": a.asset_tag, "name": a.name, "category": a.category, "status": a.status,
            "location": _clean(a.location) or None, "assigned_to": _assignee(a) or None,
            "employee_no": _clean(a.employee_no) or None, "detail": detail}


@router.get("/items")
def items(check: str, scope: str = Query("active", pattern="^(active|all)$"), location: str = "", category: str = "",
          q: Optional[str] = None, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=200),
          db: Session = Depends(get_db), _: User = Depends(staff)):
    if check not in META:
        raise HTTPException(422, "Unknown check")
    assets = _load(db, scope, location, category)
    flags, variants = _detect(assets, dt.date.today())
    if check in VARIANT_CHECKS:
        groups = variants[check]
        return {"kind": "variants", "field": VARIANT_CHECKS[check], "groups": groups, "total": len(groups),
                "page": 1, "page_size": len(groups) or 1}
    rows = flags[check]
    if q and q.strip():
        s = q.strip().lower()
        rows = [(a, d) for a, d in rows if s in " ".join(
            [a.asset_tag or "", a.name or "", a.serial_number or "", a.employee_no or "", _assignee(a), d]).lower()]
    total = len(rows)
    chunk = rows[(page - 1) * page_size: page * page_size]
    return {"kind": "assets", "items": [_item(a, d) for a, d in chunk], "total": total, "page": page,
            "page_size": page_size}


@router.get("/export.csv")
def export(check: str = "all", scope: str = Query("active", pattern="^(active|all)$"), location: str = "",
           category: str = "", db: Session = Depends(get_db), _: User = Depends(staff)):
    if check != "all" and check not in META:
        raise HTTPException(422, "Unknown check")
    assets = _load(db, scope, location, category)
    flags, variants = _detect(assets, dt.date.today())
    buf = io.StringIO()
    buf.write("﻿")
    w = csv.writer(buf)
    w.writerow(["Check", "Severity", "Asset ID", "Name", "Category", "Status", "Location", "Assigned to",
                "Employee ID", "Problem"])
    for key, title, _g, sev, _d in CHECKS:
        if check not in ("all", key):
            continue
        if key in VARIANT_CHECKS:
            for g in variants[key]:
                w.writerow([title, sev, "", "", "", "", "", "", "",
                            " | ".join(f"{v['name']} ({v['count']})" for v in g["variants"])])
            continue
        for a, d in flags[key]:
            w.writerow([title, sev, a.asset_tag, a.name, a.category, a.status, _clean(a.location), _assignee(a),
                        _clean(a.employee_no), d])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={
        "Content-Disposition": f'attachment; filename="data-quality-{check}-{dt.date.today().isoformat()}.csv"'})


class SpellingFix(BaseModel):
    field: str
    canonical: str


@router.post("/fix-spelling")
def fix_spelling(body: SpellingFix, db: Session = Depends(get_db), me: User = Depends(admin)):
    """Rewrite every spelling of a location/category that matches `canonical` ignoring case and spaces."""
    if body.field not in ("location", "category"):
        raise HTTPException(422, "field must be location or category")
    target = re.sub(r"\s+", " ", _clean(body.canonical))
    if not target:
        raise HTTPException(422, "Choose the spelling to keep")
    key = norm(target)
    changed = 0
    for a in db.scalars(select(Asset)).all():
        cur = _clean(getattr(a, body.field))
        if cur and norm(re.sub(r"\s+", " ", cur)) == key and getattr(a, body.field) != target:
            old = getattr(a, body.field)
            setattr(a, body.field, target)
            a.history.append(AssetHistory(
                action=f"{body.field.title()} standardised: '{old}' → '{target}'", performed_by=me.full_name))
            changed += 1
    db.commit()
    return {"changed": changed, "canonical": target}
