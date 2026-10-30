import csv
import datetime as dt
import io
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..allocation_service import BLOCKED_STATUSES, find_portal_user, open_allocation
from ..auth import require_roles
from ..database import get_db
from ..models import Allocation, Asset, AssetHistory, User
from ..schemas import AllocateIn, AllocationOut, AllocationPage, AssetBrief, ReturnIn

router = APIRouter(prefix="/api/allocations", tags=["allocations"])
staff = require_roles("admin", "technician")

TZ_SLACK = dt.timedelta(days=1)  # tolerate the browser and server being in different time zones


def _check_not_future(d: dt.date, label: str):
    if d > dt.date.today() + TZ_SLACK:
        raise HTTPException(400, f"{label} cannot be in the future")


def _filtered(status: str, person: Optional[str], asset_id: Optional[int], q: Optional[str]):
    stmt = select(Allocation).join(Asset, Allocation.asset_id == Asset.id)
    if status == "active":
        stmt = stmt.where(Allocation.returned_on.is_(None))
    elif status == "returned":
        stmt = stmt.where(Allocation.returned_on.is_not(None))
    if person:
        kind, _, value = person.partition(":")
        if kind == "u" and value.isdigit():
            stmt = stmt.where(Allocation.user_id == int(value))
        elif kind == "n":
            stmt = stmt.where(Allocation.user_id.is_(None), func.lower(Allocation.assignee_name) == value)
        else:
            raise HTTPException(400, "Invalid person")
    if asset_id:
        stmt = stmt.where(Allocation.asset_id == asset_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                Allocation.assignee_name.ilike(like), Allocation.employee_no.ilike(like),
                Asset.asset_tag.ilike(like), Asset.name.ilike(like), Asset.serial_number.ilike(like),
                Asset.hostname.ilike(like),
            )
        )
    return stmt


def _order(stmt):
    return stmt.order_by(Allocation.returned_on.is_(None).desc(), Allocation.allocated_on.desc(), Allocation.id.desc())


# ------------------------------------------------------------------ read
@router.get("", response_model=AllocationPage)
def list_allocations(
    status: Literal["all", "active", "returned"] = "all",
    person: Optional[str] = None,
    asset_id: Optional[int] = None,
    q: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(staff),
):
    stmt = _filtered(status, person, asset_id, q)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    items = db.scalars(
        _order(stmt).options(selectinload(Allocation.asset)).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return AllocationPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/people")
def people(
    q: Optional[str] = None,
    only_with_assets: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(staff),
):
    """Everyone who can hold assets: all active portal users plus anyone currently holding assets."""
    rows: dict[str, dict] = {}
    for u in db.scalars(select(User).where(User.is_active.is_(True))).all():
        rows[f"u:{u.id}"] = {
            "key": f"u:{u.id}", "name": u.full_name, "email": u.email, "user_id": u.id,
            "employee_no": None, "active_count": 0, "is_portal_user": True,
        }
    for a in db.scalars(select(Allocation).where(Allocation.returned_on.is_(None))).all():
        row = rows.setdefault(
            a.person,
            {"key": a.person, "name": a.assignee_name, "email": None, "user_id": a.user_id,
             "employee_no": None, "active_count": 0, "is_portal_user": bool(a.user_id)},
        )
        row["active_count"] += 1
        if a.employee_no and not row["employee_no"]:
            row["employee_no"] = a.employee_no
    result = list(rows.values())
    if only_with_assets:
        result = [r for r in result if r["active_count"] > 0]
    if q:
        ql = q.lower()
        result = [r for r in result if ql in r["name"].lower() or ql in (r["email"] or "").lower()
                  or ql in (r["employee_no"] or "").lower()]
    result.sort(key=lambda r: (r["active_count"] == 0, r["name"].lower()))
    return result


@router.get("/available", response_model=list[AssetBrief])
def available_assets(
    q: Optional[str] = None,
    limit: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(staff),
):
    """Assets nobody holds and that are in a state where they can be handed out."""
    stmt = select(Asset).where(
        Asset.assigned_to_id.is_(None),
        or_(Asset.assigned_username.is_(None), Asset.assigned_username == ""),
        ~func.lower(Asset.status).in_(BLOCKED_STATUSES),
        ~Asset.allocations.any(Allocation.returned_on.is_(None)),
    )
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(Asset.name.ilike(like), Asset.asset_tag.ilike(like), Asset.serial_number.ilike(like),
                Asset.model.ilike(like), Asset.hostname.ilike(like), Asset.category.ilike(like))
        )
    # assets marked "In Stock" first, then the rest alphabetically
    stmt = stmt.order_by(func.lower(Asset.status) != "in stock", Asset.name, Asset.asset_tag).limit(limit)
    return db.scalars(stmt).all()


@router.get("/export.csv")
def export_csv(
    status: Literal["all", "active", "returned"] = "all",
    person: Optional[str] = None,
    asset_id: Optional[int] = None,
    q: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(staff),
):
    rows = db.scalars(_order(_filtered(status, person, asset_id, q)).options(selectinload(Allocation.asset))).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["asset_tag", "asset_name", "category", "serial_number", "assigned_to", "employee_no", "allocated_on",
                "returned_on", "state", "status_on_return", "allocated_by", "returned_by", "notes", "return_notes"])
    for a in rows:
        w.writerow([
            a.asset.asset_tag, a.asset.name, a.asset.category, a.asset.serial_number or "", a.assignee_name,
            a.employee_no or "", a.allocated_on, a.returned_on or "", "Returned" if a.returned_on else "Active",
            a.return_status or "", a.allocated_by, a.returned_by or "", a.notes or "", a.return_notes or "",
        ])
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=allocations.csv"},
    )


# ------------------------------------------------------------------ write
@router.post("", response_model=list[AllocationOut], status_code=201)
def allocate(body: AllocateIn, db: Session = Depends(get_db), me: User = Depends(staff)):
    typed_name = (body.assignee_name or "").strip()
    if bool(body.user_id) == bool(typed_name):
        raise HTTPException(400, "Choose either a portal user or type an employee name (not both)")

    target = None
    if body.user_id:
        target = db.get(User, body.user_id)
        if not target:
            raise HTTPException(404, "User not found")
        if not target.is_active:
            raise HTTPException(400, "That user is deactivated")
    else:
        target = find_portal_user(db.scalars(select(User).where(User.is_active.is_(True))).all(), typed_name)
    name = target.full_name if target else typed_name

    on = body.allocated_on or dt.date.today()
    _check_not_future(on, "Allocation date")
    emp = (body.employee_no or "").strip() or None

    ids = list(dict.fromkeys(body.asset_ids))
    assets = db.scalars(select(Asset).where(Asset.id.in_(ids))).all()
    if len(assets) != len(ids):
        raise HTTPException(404, "One or more assets were not found")

    problems = []
    for a in sorted(assets, key=lambda x: x.asset_tag):
        if a.assigned_to_id or (a.assigned_username or "").strip() or open_allocation(a):
            problems.append(f"{a.asset_tag} is already allocated")
        elif (a.status or "").lower() in BLOCKED_STATUSES:
            problems.append(f"{a.asset_tag} is '{a.status}' and cannot be allocated")
    if problems:  # nothing is changed unless every asset can be allocated
        raise HTTPException(409, "; ".join(problems))

    created = []
    for a in assets:
        old_status = a.status
        a.assigned_to_id = target.id if target else None
        a.assigned_username = None if target else name
        a.employee_no = emp
        a.allocated_date = on
        a.status = "In Use"
        alloc = Allocation(
            user_id=target.id if target else None, assignee_name=name, employee_no=emp, allocated_on=on,
            allocated_by=me.full_name, notes=(body.notes or "").strip() or None,
        )
        a.allocations.append(alloc)
        created.append(alloc)
        a.history.append(AssetHistory(
            action=f"Allocated to {name}" + (f" (status {old_status} → In Use)" if old_status != "In Use" else ""),
            performed_by=me.full_name,
        ))
    db.commit()
    return sorted(created, key=lambda x: x.id)


@router.post("/return", response_model=list[AllocationOut])
def return_assets(body: ReturnIn, db: Session = Depends(get_db), me: User = Depends(staff)):
    ids = list(dict.fromkeys(body.allocation_ids))
    allocs = db.scalars(
        select(Allocation).where(Allocation.id.in_(ids)).options(selectinload(Allocation.asset))
    ).all()
    if len(allocs) != len(ids):
        raise HTTPException(404, "One or more allocations were not found")

    status = (body.return_status or "").strip() or "In Stock"
    if status.lower() == "in use":
        raise HTTPException(400, "Choose the status the asset has after it is returned (e.g. In Stock)")
    if len(status) > 30:
        raise HTTPException(400, "Status is too long")
    on = body.returned_on or dt.date.today()
    _check_not_future(on, "Return date")

    already = [a.asset.asset_tag for a in allocs if a.returned_on]
    if already:
        raise HTTPException(409, f"Already returned: {', '.join(sorted(already))}")
    early = [a.asset.asset_tag for a in allocs if on < a.allocated_on]
    if early:
        raise HTTPException(400, f"The return date is before the allocation date for: {', '.join(sorted(early))}")

    notes = (body.notes or "").strip() or None
    for a in allocs:
        asset = a.asset
        a.returned_on, a.returned_by, a.return_status, a.return_notes = on, me.full_name, status, notes
        asset.assigned_to_id = None
        asset.assigned_username = None
        asset.employee_no = None
        asset.manager = None
        asset.job_title = None
        asset.allocated_date = None
        old_status = asset.status
        asset.status = status
        asset.history.append(AssetHistory(
            action=f"Returned by {a.assignee_name}" + (f" (status {old_status} → {status})" if old_status != status else ""),
            performed_by=me.full_name,
        ))
    db.commit()
    return sorted(allocs, key=lambda x: x.id)
