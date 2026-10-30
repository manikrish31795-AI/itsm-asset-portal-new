"""Asset audits: a physical check that assets are where the records say they are.

Flow: create an audit (pick locations / categories) -> every matching asset is listed with a snapshot of
where it should be -> staff mark each one Found / Missing / Found elsewhere (or scan its tag) ->
close the audit, which stamps "last audited" on verified assets and, if chosen, updates moved locations
and marks missing assets as Lost.
"""
import csv
import datetime as dt
import io
from collections import defaultdict
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..auth import require_roles
from ..database import get_db
from ..locations import NO_LOCATION, location_clause, norm
from ..models import Asset, AssetHistory, Audit, AuditItem, User
from ..schemas import (
    AuditBulkIn, AuditCloseIn, AuditCreate, AuditItemOut, AuditItemPage, AuditItemUpdate, AuditPreviewIn,
    AuditScanIn,
)

router = APIRouter(prefix="/api/audits", tags=["audits"])
staff = require_roles("admin", "technician")

CONDITIONS = ("Good", "Damaged", "Needs repair")
INACTIVE = ("retired", "lost")
TZ_SLACK = dt.timedelta(days=1)  # browser and server may be in different time zones


# ------------------------------------------------------------------ helpers
def _history(asset: Asset, text: str, who: str):
    asset.history.append(AssetHistory(action=text[:255], performed_by=who))


def _holder(asset: Asset):
    if asset.assigned_to:
        return asset.assigned_to.full_name
    return (asset.assigned_username or "").strip() or None


def _scope_stmt(locations: list[str], categories: list[str], include_inactive: bool):
    stmt = select(Asset)
    clause = location_clause(Asset.location, locations)
    if clause is not None:
        stmt = stmt.where(clause)
    cats = [norm(c) for c in categories if norm(c)]
    if cats:
        stmt = stmt.where(func.lower(func.trim(Asset.category)).in_(cats))
    if not include_inactive:
        stmt = stmt.where(~func.lower(Asset.status).in_(INACTIVE))
    return stmt


def _snapshot(audit_id: Optional[int], asset: Asset, unexpected: bool = False) -> AuditItem:
    return AuditItem(
        audit_id=audit_id, asset_id=asset.id, asset_tag=asset.asset_tag, asset_name=asset.name,
        category=asset.category, serial_number=asset.serial_number, expected_location=asset.location,
        expected_holder=_holder(asset), expected_status=asset.status, unexpected=unexpected,
    )


def _counts(db: Session, audit_ids: list[int]) -> dict[int, dict]:
    out = {i: {"total": 0, "pending": 0, "found": 0, "missing": 0, "moved": 0, "unexpected": 0} for i in audit_ids}
    if audit_ids:
        rows = db.execute(
            select(AuditItem.audit_id, AuditItem.result, AuditItem.unexpected, func.count())
            .where(AuditItem.audit_id.in_(audit_ids))
            .group_by(AuditItem.audit_id, AuditItem.result, AuditItem.unexpected)
        ).all()
        for aid, result, unexpected, n in rows:
            c = out[aid]
            c["total"] += n
            c[result] = c.get(result, 0) + n
            if unexpected:
                c["unexpected"] += n
    for c in out.values():
        c["audited"] = c["total"] - c["pending"]
    return out


def _audit_dict(a: Audit, counts: dict) -> dict:
    return {
        "id": a.id, "name": a.name, "status": a.status, "locations": a.scope_locations or [],
        "categories": a.scope_categories or [], "include_inactive": bool(a.include_inactive),
        "due_date": a.due_date, "notes": a.notes, "created_by": a.created_by, "created_at": a.created_at,
        "closed_by": a.closed_by, "closed_at": a.closed_at, "close_summary": a.close_summary,
        "is_overdue": bool(a.status == "open" and a.due_date and a.due_date < dt.date.today()),
        "counts": counts,
    }


def _get_audit(db: Session, audit_id: int) -> Audit:
    audit = db.get(Audit, audit_id)
    if not audit:
        raise HTTPException(404, "Audit not found")
    return audit


def _get_open_audit(db: Session, audit_id: int) -> Audit:
    audit = _get_audit(db, audit_id)
    if audit.status != "open":
        raise HTTPException(409, "This audit is closed and can no longer be changed")
    return audit


def _get_item(db: Session, audit_id: int, item_id: int) -> AuditItem:
    item = db.get(AuditItem, item_id)
    if not item or item.audit_id != audit_id:
        raise HTTPException(404, "Audit item not found")
    return item


def _set_result(item: AuditItem, result: str, found_location, condition, who: str, now: dt.datetime):
    """Record (or reset) the outcome for one asset, enforcing the rules in one place."""
    if result == "pending":
        item.result, item.found_location, item.condition = "pending", None, None
        item.audited_by = item.audited_at = None
        return
    if result == "moved":
        loc = (found_location or "").strip()
        if not loc:
            raise HTTPException(400, "Say where the asset was found")
        if norm(loc) == norm(item.expected_location):
            raise HTTPException(400, "That is where the asset is already registered — choose 'Found' instead")
        item.found_location = loc[:100]
    else:
        item.found_location = None
    cond = (condition or "").strip() or None
    if cond and cond not in CONDITIONS:
        raise HTTPException(400, f"Condition must be one of: {', '.join(CONDITIONS)}")
    item.result = result
    item.condition = cond if result in ("found", "moved") else None
    item.audited_by, item.audited_at = who, now


# ------------------------------------------------------------------ create / list
@router.post("/preview")
def preview(body: AuditPreviewIn, db: Session = Depends(get_db), _: User = Depends(staff)):
    stmt = _scope_stmt(body.locations, body.categories, body.include_inactive)
    return {"count": db.scalar(select(func.count()).select_from(stmt.subquery())) or 0}


@router.post("", status_code=201)
def create_audit(body: AuditCreate, db: Session = Depends(get_db), me: User = Depends(staff)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Give the audit a name")
    if body.due_date and body.due_date < dt.date.today() - TZ_SLACK:
        raise HTTPException(400, "The due date cannot be in the past")

    assets = db.scalars(
        _scope_stmt(body.locations, body.categories, body.include_inactive)
        .options(selectinload(Asset.assigned_to)).order_by(Asset.asset_tag)
    ).all()
    if not assets:
        raise HTTPException(400, "No assets match those locations / categories, so there is nothing to audit")

    audit = Audit(
        name=name, status="open", scope_locations=body.locations or None, scope_categories=body.categories or None,
        include_inactive=body.include_inactive, due_date=body.due_date,
        notes=(body.notes or "").strip() or None, created_by=me.full_name,
    )
    audit.items = [_snapshot(None, a) for a in assets]  # audit_id is filled in by the relationship
    db.add(audit)
    db.commit()
    db.refresh(audit)
    return _audit_dict(audit, _counts(db, [audit.id])[audit.id])


@router.get("")
def list_audits(
    status: Literal["all", "open", "closed"] = "all",
    db: Session = Depends(get_db),
    _: User = Depends(staff),
):
    stmt = select(Audit)
    if status != "all":
        stmt = stmt.where(Audit.status == status)
    audits = db.scalars(stmt.order_by(Audit.status.desc(), Audit.created_at.desc(), Audit.id.desc())).all()
    counts = _counts(db, [a.id for a in audits])
    return [_audit_dict(a, counts[a.id]) for a in audits]


@router.get("/asset/{asset_id}")
def audits_of_asset(asset_id: int, db: Session = Depends(get_db), _: User = Depends(staff)):
    rows = db.execute(
        select(AuditItem, Audit).join(Audit, Audit.id == AuditItem.audit_id)
        .where(AuditItem.asset_id == asset_id).order_by(Audit.created_at.desc(), Audit.id.desc())
    ).all()
    return [
        {
            "audit_id": a.id, "audit_name": a.name, "audit_status": a.status, "result": i.result,
            "found_location": i.found_location, "expected_location": i.expected_location,
            "condition": i.condition, "audited_by": i.audited_by, "audited_at": i.audited_at, "unexpected": i.unexpected,
        }
        for i, a in rows
    ]


# ------------------------------------------------------------------ one audit
@router.get("/{audit_id}")
def get_audit(audit_id: int, db: Session = Depends(get_db), _: User = Depends(staff)):
    audit = _get_audit(db, audit_id)
    out = _audit_dict(audit, _counts(db, [audit.id])[audit.id])

    # progress per (expected) location, with case-insensitive merging of spellings
    rows = db.execute(
        select(AuditItem.expected_location, AuditItem.result, func.count())
        .where(AuditItem.audit_id == audit_id).group_by(AuditItem.expected_location, AuditItem.result)
    ).all()
    groups: dict[str, dict] = {}
    for loc, result, n in rows:
        key = norm(loc)
        g = groups.setdefault(key, {"spellings": defaultdict(int), "total": 0, "pending": 0, "found": 0, "missing": 0, "moved": 0})
        g["total"] += n
        g[result] = g.get(result, 0) + n
        g["spellings"][(loc or "").strip()] += n
    by_location = []
    for key, g in groups.items():
        name = max(g["spellings"].items(), key=lambda kv: kv[1])[0] if key else ""
        by_location.append({
            "name": name or "No location", "key": name or NO_LOCATION, "total": g["total"],
            "audited": g["total"] - g["pending"], "found": g["found"], "missing": g["missing"], "moved": g["moved"],
        })
    by_location.sort(key=lambda r: (r["key"] == NO_LOCATION, r["name"].lower()))
    out["by_location"] = by_location
    return out


@router.delete("/{audit_id}", status_code=204)
def delete_audit(audit_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles("admin"))):
    db.delete(_get_audit(db, audit_id))
    db.commit()


# ------------------------------------------------------------------ items
def _items_filter(
    audit_id: int, result: str, q: Optional[str], location: Optional[str], category: Optional[str]
):
    stmt = select(AuditItem).where(AuditItem.audit_id == audit_id)
    if result == "audited":
        stmt = stmt.where(AuditItem.result != "pending")
    elif result == "unexpected":
        stmt = stmt.where(AuditItem.unexpected.is_(True))
    elif result == "issues":  # what needs a decision before closing
        stmt = stmt.where(or_(AuditItem.result.in_(("missing", "moved")), AuditItem.condition.in_(("Damaged", "Needs repair"))))
    elif result != "all":
        stmt = stmt.where(AuditItem.result == result)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(
            AuditItem.asset_tag.ilike(like), AuditItem.asset_name.ilike(like), AuditItem.serial_number.ilike(like),
            AuditItem.expected_holder.ilike(like),
        ))
    if location:
        clause = location_clause(AuditItem.expected_location, [location])
        if clause is not None:
            stmt = stmt.where(clause)
    if category:
        stmt = stmt.where(func.lower(AuditItem.category) == norm(category))
    return stmt


ItemFilter = Literal["all", "pending", "audited", "found", "missing", "moved", "unexpected", "issues"]


@router.get("/{audit_id}/items", response_model=AuditItemPage)
def list_items(
    audit_id: int,
    result: ItemFilter = "all",
    q: Optional[str] = None,
    location: Optional[str] = None,
    category: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(staff),
):
    _get_audit(db, audit_id)
    stmt = _items_filter(audit_id, result, q, location, category)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.scalars(
        stmt.order_by(func.lower(func.coalesce(func.nullif(func.trim(AuditItem.expected_location), ""), "~")), AuditItem.asset_tag)
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    return AuditItemPage(items=items, total=total, page=page, page_size=page_size)


@router.put("/{audit_id}/items/{item_id}", response_model=AuditItemOut)
def update_item(
    audit_id: int, item_id: int, body: AuditItemUpdate, db: Session = Depends(get_db), me: User = Depends(staff)
):
    _get_open_audit(db, audit_id)
    item = _get_item(db, audit_id, item_id)
    sent = body.model_fields_set
    # fields left out of the request keep their stored value (so a quick "Found" click never wipes a recorded condition)
    found_location = body.found_location if "found_location" in sent else item.found_location
    condition = body.condition if "condition" in sent else item.condition
    _set_result(item, body.result, found_location, condition, me.full_name, dt.datetime.utcnow())
    if "notes" in sent:
        item.notes = (body.notes or "").strip() or None
    db.commit()
    db.refresh(item)
    return item


@router.post("/{audit_id}/items/bulk")
def bulk_update(audit_id: int, body: AuditBulkIn, db: Session = Depends(get_db), me: User = Depends(staff)):
    _get_open_audit(db, audit_id)
    ids = list(dict.fromkeys(body.item_ids))
    items = db.scalars(select(AuditItem).where(AuditItem.audit_id == audit_id, AuditItem.id.in_(ids))).all()
    if len(items) != len(ids):
        raise HTTPException(404, "One or more items are not part of this audit")
    now = dt.datetime.utcnow()
    for it in items:
        keep = it.condition if it.result in ("found", "moved") else None  # don't wipe a recorded condition
        _set_result(it, body.result, None, keep if body.result == "found" else None, me.full_name, now)
    db.commit()
    return {"updated": len(items)}


@router.post("/{audit_id}/scan")
def scan(audit_id: int, body: AuditScanIn, db: Session = Depends(get_db), me: User = Depends(staff)):
    """Verify an asset by typing / scanning its tag (or serial number)."""
    _get_open_audit(db, audit_id)
    code = body.code.strip()
    key = code.lower()
    item = db.scalar(select(AuditItem).where(AuditItem.audit_id == audit_id, func.lower(AuditItem.asset_tag) == key))
    if not item:
        item = db.scalar(select(AuditItem).where(AuditItem.audit_id == audit_id, func.lower(AuditItem.serial_number) == key))

    added = False
    if not item:  # not on this audit's list: add it, flagged, if it exists at all
        asset = db.scalar(select(Asset).where(func.lower(Asset.asset_tag) == key)) or db.scalar(
            select(Asset).where(func.lower(Asset.serial_number) == key)
        )
        if not asset:
            raise HTTPException(404, f"No asset with tag or serial number '{code}' exists")
        item = _snapshot(audit_id, asset, unexpected=True)
        db.add(item)
        added = True

    previous = item.result
    where = (body.found_location or "").strip() or None
    moved = bool(where) and norm(where) != norm(item.expected_location)
    result = "moved" if moved else "found"
    if previous == result and (result == "found" or norm(item.found_location) == norm(where)):
        pass  # already recorded exactly like this
    else:
        keep = item.condition if previous in ("found", "moved") else None
        _set_result(item, result, where, keep, me.full_name, dt.datetime.utcnow())
    db.commit()
    db.refresh(item)
    return {"item": AuditItemOut.model_validate(item), "added": added, "previous": previous}


# ------------------------------------------------------------------ close / export
@router.post("/{audit_id}/close")
def close_audit(audit_id: int, body: AuditCloseIn, db: Session = Depends(get_db), me: User = Depends(staff)):
    audit = _get_open_audit(db, audit_id)
    now = dt.datetime.utcnow()
    who = me.full_name
    items = db.scalars(
        select(AuditItem).where(AuditItem.audit_id == audit_id).options(selectinload(AuditItem.asset))
    ).all()

    s = {"verified": 0, "found_elsewhere": 0, "missing": 0, "not_audited": 0,
         "unchecked_marked_missing": 0, "marked_lost": 0, "locations_updated": 0, "need_attention": 0}
    for it in items:
        asset = it.asset
        if it.result == "pending" and body.pending_action == "missing":
            _set_result(it, "missing", None, None, who, now)
            it.notes = it.notes or "Marked missing when the audit was closed (not checked)"
            s["unchecked_marked_missing"] += 1

        if it.result in ("found", "moved"):
            s["verified"] += 1
            asset.last_audited_on = (it.audited_at or now).date()
            line = f"Verified in audit '{audit.name}'"
            if it.result == "moved":
                s["found_elsewhere"] += 1
                line += f" — found at {it.found_location} (registered: {it.expected_location or 'no location'})"
            if it.condition in ("Damaged", "Needs repair"):
                s["need_attention"] += 1
                line += f" — condition: {it.condition}"
            _history(asset, line, who)
            if it.result == "moved" and body.apply_moves and norm(asset.location) != norm(it.found_location):
                _history(asset, f"location changed: {asset.location or '—'} → {it.found_location} (audit '{audit.name}')", who)
                asset.location = it.found_location
                s["locations_updated"] += 1
        elif it.result == "missing":
            s["missing"] += 1
            _history(asset, f"Not found in audit '{audit.name}'", who)
            if body.mark_missing_lost and (asset.status or "").lower() not in INACTIVE:
                _history(asset, f"status changed: {asset.status or '—'} → Lost (audit '{audit.name}')", who)
                asset.status = "Lost"
                s["marked_lost"] += 1
        else:
            s["not_audited"] += 1

    audit.status, audit.closed_by, audit.closed_at, audit.close_summary = "closed", who, now, s
    db.commit()
    db.refresh(audit)
    return _audit_dict(audit, _counts(db, [audit.id])[audit.id])


@router.get("/{audit_id}/export.csv")
def export_items(audit_id: int, db: Session = Depends(get_db), _: User = Depends(staff)):
    audit = _get_audit(db, audit_id)
    rows = db.scalars(
        select(AuditItem).where(AuditItem.audit_id == audit_id)
        .order_by(func.lower(func.coalesce(func.nullif(func.trim(AuditItem.expected_location), ""), "~")), AuditItem.asset_tag)
    ).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["asset_tag", "asset_name", "category", "serial_number", "registered_location", "registered_holder",
                "registered_status", "result", "found_location", "condition", "on_audit_list", "notes",
                "audited_by", "audited_at"])
    label = {"pending": "Not checked", "found": "Found", "missing": "Missing", "moved": "Found elsewhere"}
    for i in rows:
        w.writerow([
            i.asset_tag, i.asset_name, i.category, i.serial_number or "", i.expected_location or "",
            i.expected_holder or "", i.expected_status or "", label.get(i.result, i.result), i.found_location or "",
            i.condition or "", "No" if i.unexpected else "Yes", i.notes or "", i.audited_by or "",
            i.audited_at.strftime("%Y-%m-%d %H:%M") if i.audited_at else "",
        ])
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in audit.name)[:60] or "audit"
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=audit-{safe}.csv"},
    )
