"""Employee view (everything one person holds) and exit clearance (checklist of returns)."""
import datetime as dt
from collections import Counter
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..allocation_service import return_allocation
from ..auth import require_roles
from ..database import get_db
from ..models import Allocation, Asset, Clearance, ClearanceItem, User

router = APIRouter(prefix="/api/employees", tags=["employees"])
clearance_router = APIRouter(prefix="/api/clearances", tags=["clearances"])
staff = require_roles("admin", "technician")

REASONS = ["Resignation", "Termination", "Retirement", "Transfer", "Contract end", "Other"]
RETURN_STATUSES = ["In Stock", "In Repair", "Retired"]
CONDITIONS = ["Good", "Damaged", "Needs repair"]


def _norm(v) -> str:
    return " ".join((v or "").split()).lower()


def _key(a: Allocation) -> str:
    emp = _norm(a.employee_no)
    return f"e:{emp}" if emp else a.person


def _allocs_for(db: Session, key: str, only_open=False):
    """Allocations (newest first) belonging to a person key: e:<employee id> | u:<user id> | n:<name>."""
    kind, _, value = key.partition(":")
    stmt = select(Allocation).options(selectinload(Allocation.asset))
    if kind == "e" and value:
        stmt = stmt.where(func.lower(func.trim(Allocation.employee_no)) == value)
    elif kind == "u" and value.isdigit():
        stmt = stmt.where(Allocation.user_id == int(value))
    elif kind == "n" and value:
        stmt = stmt.where(Allocation.user_id.is_(None), func.lower(func.trim(Allocation.assignee_name)) == value)
    else:
        raise HTTPException(400, "Invalid employee")
    if only_open:
        stmt = stmt.where(Allocation.returned_on.is_(None))
    return db.scalars(stmt.order_by(Allocation.returned_on.is_(None).desc(), Allocation.allocated_on.desc(), Allocation.id.desc())).all()


def _item_out(it: ClearanceItem, alloc_returned: bool) -> dict:
    return {
        "id": it.id, "asset_id": it.asset_id, "asset_tag": it.asset_tag, "asset_name": it.asset_name, "category": it.category,
        "serial_number": it.serial_number, "allocated_on": it.allocated_on.isoformat() if it.allocated_on else None,
        "result": it.result, "return_status": it.return_status, "condition": it.condition, "notes": it.notes,
        "checked_by": it.checked_by, "checked_at": it.checked_at.isoformat() if it.checked_at else None,
        "final": it.final, "already_returned": alloc_returned,
    }


def _counts(c: Clearance) -> dict:
    n = Counter(i.result for i in c.items)
    return {"total": len(c.items), "pending": n["pending"], "returned": n["returned"], "not_returned": n["not_returned"]}


def _clearance_out(db: Session, c: Clearance, with_items=True) -> dict:
    out = {
        "id": c.id, "person_key": c.person_key, "employee_name": c.employee_name, "employee_no": c.employee_no,
        "department": c.department, "manager": c.manager, "job_title": c.job_title, "reason": c.reason,
        "last_working_day": c.last_working_day.isoformat() if c.last_working_day else None, "notes": c.notes,
        "status": c.status, "outcome": c.outcome, "created_by": c.created_by, "created_at": c.created_at.isoformat(),
        "completed_by": c.completed_by, "completed_at": c.completed_at.isoformat() if c.completed_at else None,
        "counts": _counts(c),
    }
    if with_items:
        ret = {a.id for a in db.scalars(select(Allocation).where(
            Allocation.id.in_([i.allocation_id for i in c.items]), Allocation.returned_on.is_not(None))).all()} if c.items else set()
        out["items"] = [_item_out(i, i.allocation_id in ret and i.final is None) for i in c.items]
    return out


# ------------------------------------------------------------------ employees
@router.get("")
def search(q: Optional[str] = None, only_with_assets: bool = False, limit: int = Query(50, ge=1, le=200),
           db: Session = Depends(get_db), _: User = Depends(staff)):
    people: dict[str, dict] = {}
    for a in db.scalars(select(Allocation).options(selectinload(Allocation.asset))).all():
        p = people.setdefault(_key(a), {"key": _key(a), "name": a.assignee_name, "employee_no": None, "department": None,
                                        "active_count": 0, "total_count": 0})
        p["total_count"] += 1
        if a.employee_no:
            p.setdefault("_spell", Counter())[" ".join(a.employee_no.split())] += 1
        if a.returned_on is None:
            p["active_count"] += 1
            p["name"] = a.assignee_name
            p["department"] = p["department"] or a.asset.department
    open_c = {c.person_key: c.id for c in db.scalars(select(Clearance).where(Clearance.status == "open")).all()}
    rows = list(people.values())
    for r in rows:
        sp = r.pop("_spell", None)
        r["employee_no"] = sp.most_common(1)[0][0] if sp else None
        r["open_clearance_id"] = open_c.get(r["key"])
    if only_with_assets:
        rows = [r for r in rows if r["active_count"]]
    if q and q.strip():
        ql = _norm(q)
        rows = [r for r in rows if ql in _norm(r["name"]) or ql in _norm(r["employee_no"])]
        # exact Employee ID first
        rows.sort(key=lambda r: (_norm(r["employee_no"]) != ql, r["active_count"] == 0, r["name"].lower()))
    else:
        rows.sort(key=lambda r: (r["active_count"] == 0, r["name"].lower()))
    return {"items": rows[:limit], "total": len(rows)}


@router.get("/profile")
def profile(key: str, db: Session = Depends(get_db), _: User = Depends(staff)):
    allocs = _allocs_for(db, key)
    if not allocs:
        raise HTTPException(404, "No employee found")
    active = [a for a in allocs if a.returned_on is None]
    first = (active or allocs)[0]
    assets = [a.asset for a in active]
    dept = Counter(x.department for x in assets if x.department).most_common(1)
    spellings = Counter(" ".join(a.employee_no.split()) for a in allocs if a.employee_no)
    emp_no = spellings.most_common(1)[0][0] if spellings else None  # most used spelling of the Employee ID

    def brief(a: Allocation):
        s = a.asset
        return {"allocation_id": a.id, "asset_id": s.id, "asset_tag": s.asset_tag, "name": s.name, "category": s.category,
                "serial_number": s.serial_number, "status": s.status, "location": s.location, "model": s.model,
                "manufacturer": s.manufacturer, "allocated_on": a.allocated_on.isoformat(),
                "returned_on": a.returned_on.isoformat() if a.returned_on else None, "return_status": a.return_status}

    clearances = db.scalars(select(Clearance).options(selectinload(Clearance.items)).where(Clearance.person_key == (
        f"e:{_norm(emp_no)}" if emp_no else first.person)).order_by(Clearance.id.desc())).all()
    return {
        "key": f"e:{_norm(emp_no)}" if emp_no else first.person,
        "name": first.assignee_name, "employee_no": emp_no, "department": dept[0][0] if dept else None,
        "manager": next((x.manager for x in assets if x.manager), None),
        "job_title": next((x.job_title for x in assets if x.job_title), None),
        "location": next((x.location for x in assets if x.location), None),
        "email": first.user.email if first.user else None,
        "assets": [brief(a) for a in active],
        "history": [brief(a) for a in allocs if a.returned_on is not None],
        "clearances": [{"id": c.id, "status": c.status, "outcome": c.outcome, "reason": c.reason,
                        "created_at": c.created_at.isoformat(), "counts": _counts(c)} for c in clearances],
    }


# ------------------------------------------------------------------ clearances
class StartIn(BaseModel):
    person: str
    reason: str = "Resignation"
    last_working_day: Optional[dt.date] = None
    notes: Optional[str] = None


class ItemIn(BaseModel):
    result: Literal["pending", "returned", "not_returned"]
    return_status: Optional[str] = None
    condition: Optional[str] = None
    notes: Optional[str] = None


class CompleteIn(BaseModel):
    mark_lost: bool = False


@clearance_router.post("", status_code=201)
def start(body: StartIn, db: Session = Depends(get_db), me: User = Depends(staff)):
    prof = profile(body.person, db, me)
    if db.scalar(select(Clearance).where(Clearance.person_key == prof["key"], Clearance.status == "open")):
        raise HTTPException(409, "There is already a clearance in progress for this employee")
    if body.reason not in REASONS:
        raise HTTPException(422, f"Reason must be one of: {', '.join(REASONS)}")
    c = Clearance(person_key=prof["key"], employee_name=prof["name"], employee_no=prof["employee_no"],
                  department=prof["department"], manager=prof["manager"], job_title=prof["job_title"], reason=body.reason,
                  last_working_day=body.last_working_day, notes=(body.notes or "").strip() or None, created_by=me.full_name)
    for a in sorted(_allocs_for(db, prof["key"], only_open=True), key=lambda x: x.asset.asset_tag.lower()):
        s = a.asset
        c.items.append(ClearanceItem(allocation_id=a.id, asset_id=s.id, asset_tag=s.asset_tag, asset_name=s.name,
                                     category=s.category, serial_number=s.serial_number, allocated_on=a.allocated_on))
    db.add(c)
    db.commit()
    db.refresh(c)
    return _clearance_out(db, c)


@clearance_router.get("")
def list_clearances(status: str = "all", q: Optional[str] = None, db: Session = Depends(get_db), _: User = Depends(staff)):
    stmt = select(Clearance).options(selectinload(Clearance.items)).order_by(Clearance.id.desc())
    if status != "all":
        stmt = stmt.where(Clearance.status == status)
    rows = db.scalars(stmt).all()
    if q and q.strip():
        ql = _norm(q)
        rows = [c for c in rows if ql in _norm(c.employee_name) or ql in _norm(c.employee_no)]
    return [_clearance_out(db, c, with_items=False) for c in rows]


def _get(db: Session, cid: int) -> Clearance:
    c = db.scalar(select(Clearance).options(selectinload(Clearance.items)).where(Clearance.id == cid))
    if not c:
        raise HTTPException(404, "Clearance not found")
    return c


@clearance_router.get("/{cid}")
def get_clearance(cid: int, db: Session = Depends(get_db), _: User = Depends(staff)):
    return _clearance_out(db, _get(db, cid))


@clearance_router.put("/{cid}/items/{item_id}")
def set_item(cid: int, item_id: int, body: ItemIn, db: Session = Depends(get_db), me: User = Depends(staff)):
    c = _get(db, cid)
    if c.status != "open":
        raise HTTPException(409, "This clearance is closed")
    it = next((i for i in c.items if i.id == item_id), None)
    if not it:
        raise HTTPException(404, "Item not found")
    if body.result == "returned":
        st = (body.return_status or "In Stock").strip()
        if st not in RETURN_STATUSES:
            raise HTTPException(422, f"Status after return must be one of: {', '.join(RETURN_STATUSES)}")
        if body.condition and body.condition not in CONDITIONS:
            raise HTTPException(422, f"Condition must be one of: {', '.join(CONDITIONS)}")
        it.return_status, it.condition = st, body.condition or None
    else:
        it.return_status, it.condition = None, None
    it.result = body.result
    it.notes = (body.notes or "").strip() or None
    it.checked_by, it.checked_at = (me.full_name, dt.datetime.utcnow()) if body.result != "pending" else (None, None)
    db.commit()
    return _clearance_out(db, c)


@clearance_router.post("/{cid}/items/bulk-returned")
def all_returned(cid: int, db: Session = Depends(get_db), me: User = Depends(staff)):
    """Shortcut: every undecided item came back in good condition."""
    c = _get(db, cid)
    if c.status != "open":
        raise HTTPException(409, "This clearance is closed")
    for it in c.items:
        if it.result == "pending":
            it.result, it.return_status, it.condition = "returned", "In Stock", "Good"
            it.checked_by, it.checked_at = me.full_name, dt.datetime.utcnow()
    db.commit()
    return _clearance_out(db, c)


@clearance_router.post("/{cid}/complete")
def complete(cid: int, body: CompleteIn, db: Session = Depends(get_db), me: User = Depends(staff)):
    c = _get(db, cid)
    if c.status != "open":
        raise HTTPException(409, "This clearance is already closed")
    allocs = {a.id: a for a in db.scalars(select(Allocation).options(selectinload(Allocation.asset))
                                          .where(Allocation.id.in_([i.allocation_id for i in c.items]))).all()} if c.items else {}
    undecided = [i for i in c.items if i.result == "pending" and allocs[i.allocation_id].returned_on is None]
    if undecided:
        raise HTTPException(409, f"{len(undecided)} item(s) still need a decision: returned or not returned")
    today = dt.date.today()
    note = f"Exit clearance #{c.id}"
    for i in c.items:
        a = allocs[i.allocation_id]
        if a.returned_on is not None:               # already handed back through the Allocation tab
            i.final = "returned"
            continue
        extra = " · ".join(x for x in (i.condition and f"condition {i.condition}", i.notes) if x)
        if i.result == "returned":
            return_allocation(a, i.return_status or "In Stock", max(today, a.allocated_on), me.full_name, f"{note}" + (f" – {extra}" if extra else ""))
            i.final = "returned"
        elif body.mark_lost:
            return_allocation(a, "Lost", max(today, a.allocated_on), me.full_name, f"{note} – not returned, written off as lost" + (f" – {i.notes}" if i.notes else ""))
            i.final = "lost"
        else:
            i.final = "outstanding"
    finals = {i.final for i in c.items}
    c.outcome = "not_cleared" if "outstanding" in finals else ("cleared_with_loss" if "lost" in finals else "cleared")
    c.status, c.completed_by, c.completed_at = "completed", me.full_name, dt.datetime.utcnow()
    db.commit()
    return _clearance_out(db, _get(db, cid))


@clearance_router.post("/{cid}/cancel")
def cancel(cid: int, db: Session = Depends(get_db), _: User = Depends(staff)):
    c = _get(db, cid)
    if c.status != "open":
        raise HTTPException(409, "Only a clearance in progress can be cancelled")
    c.status = "cancelled"
    db.commit()
    return _clearance_out(db, c)
