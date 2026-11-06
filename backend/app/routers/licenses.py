"""Software licences: keys, seats bought vs used, renewal dates."""
import csv
import datetime as dt
import io
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..auth import require_roles
from ..database import get_db
from ..models import Asset, License, LicenseAssignment, User

router = APIRouter(prefix="/api/licenses", tags=["licenses"])
staff = require_roles("admin", "technician")

LICENSE_TYPES = ["Subscription", "Perpetual", "Per user", "Per device", "Site / volume", "Open source / free", "Other"]
SOON_DAYS = 60


def _norm(v) -> str:
    return " ".join((v or "").split()).lower()


def person_key(employee_no, name) -> str:
    emp = _norm(employee_no)
    return f"e:{emp}" if emp else f"n:{_norm(name)}"


def mask(key: Optional[str]) -> Optional[str]:
    if not key:
        return None
    k = key.strip()
    return "•" * max(4, len(k) - 4) + k[-4:] if len(k) > 4 else "•" * len(k)


def in_use(lic: License) -> list[LicenseAssignment]:
    return [a for a in lic.assignments if a.released_on is None]


def renewal_state(lic: License, today: dt.date, days: int = SOON_DAYS) -> str:
    if lic.renewal_date is None:
        return "none"
    if lic.renewal_date < today:
        return "expired"
    return "expiring" if lic.renewal_date <= today + dt.timedelta(days=days) else "ok"


def _row(lic: License, today: dt.date) -> dict:
    used = len(in_use(lic))
    return {
        "id": lic.id, "name": lic.name, "publisher": lic.publisher, "license_type": lic.license_type,
        "seats": lic.seats, "used": used, "available": max(0, lic.seats - used), "vendor": lic.vendor,
        "order_number": lic.order_number, "purchase_date": lic.purchase_date.isoformat() if lic.purchase_date else None,
        "purchase_cost": lic.purchase_cost, "renewal_date": lic.renewal_date.isoformat() if lic.renewal_date else None,
        "days_left": (lic.renewal_date - today).days if lic.renewal_date else None,
        "state": renewal_state(lic, today), "status": lic.status, "key_hint": mask(lic.license_key),
        "has_key": bool(lic.license_key),
    }


def _assignment(a: LicenseAssignment) -> dict:
    return {
        "id": a.id, "kind": a.kind, "asset_id": a.asset_id, "assignee_name": a.assignee_name, "employee_no": a.employee_no,
        "assigned_on": a.assigned_on.isoformat(), "released_on": a.released_on.isoformat() if a.released_on else None,
        "assigned_by": a.assigned_by, "released_by": a.released_by, "notes": a.notes, "release_notes": a.release_notes,
    }


class LicenseIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    publisher: Optional[str] = None
    license_type: str = "Subscription"
    license_key: Optional[str] = None
    seats: int = Field(1, ge=1, le=1_000_000)
    vendor: Optional[str] = None
    order_number: Optional[str] = None
    purchase_date: Optional[dt.date] = None
    purchase_cost: Optional[float] = Field(None, ge=0)
    renewal_date: Optional[dt.date] = None
    status: Literal["active", "retired"] = "active"
    notes: Optional[str] = None


def _clean(body: LicenseIn) -> dict:
    d = body.model_dump()
    for k, v in d.items():
        if isinstance(v, str):
            d[k] = (v.strip() if k == "license_key" else " ".join(v.split())) or None
    if not d["name"]:
        raise HTTPException(422, "Name is required")
    if d["license_type"] not in LICENSE_TYPES:
        raise HTTPException(422, f"Licence type must be one of: {', '.join(LICENSE_TYPES)}")
    if d["purchase_date"] and d["renewal_date"] and d["renewal_date"] < d["purchase_date"]:
        raise HTTPException(422, "The renewal date cannot be before the purchase date")
    return d


def _get(db: Session, lid: int) -> License:
    lic = db.scalar(select(License).options(selectinload(License.assignments)).where(License.id == lid))
    if not lic:
        raise HTTPException(404, "Licence not found")
    return lic


# ------------------------------------------------------------------ list / summary
@router.get("/meta")
def meta(_: User = Depends(staff)):
    return {"types": LICENSE_TYPES}


def _filtered(db: Session, q, type_, status, days):
    today = dt.date.today()
    rows = db.scalars(select(License).options(selectinload(License.assignments)).order_by(License.name)).all()
    out = []
    for lic in rows:
        r = _row(lic, today)
        if q:
            hay = " ".join(x or "" for x in (lic.name, lic.publisher, lic.vendor, lic.order_number, lic.notes)).lower()
            if _norm(q) not in hay:
                continue
        if type_ and lic.license_type != type_:
            continue
        active = lic.status == "active"
        ok = {
            "all": True, "active": active, "retired": not active,
            "available": active and r["available"] > 0, "full": active and r["available"] == 0,
            "expiring": active and renewal_state(lic, today, days) == "expiring",
            "expired": active and r["state"] == "expired",
        }.get(status)
        if ok is None:
            raise HTTPException(422, "Unknown status filter")
        if ok:
            out.append(r)
    return out


@router.get("")
def list_licenses(q: Optional[str] = None, type: Optional[str] = None, status: str = "active",
                  days: int = Query(SOON_DAYS, ge=1, le=730), db: Session = Depends(get_db), _: User = Depends(staff)):
    return {"items": _filtered(db, q, type, status, days)}


@router.get("/summary")
def summary(days: int = Query(SOON_DAYS, ge=1, le=730), db: Session = Depends(get_db), _: User = Depends(staff)):
    rows = _filtered(db, None, None, "active", days)
    return {
        "licenses": len(rows), "seats": sum(r["seats"] for r in rows), "used": sum(r["used"] for r in rows),
        "available": sum(r["available"] for r in rows),
        "expiring": sum(1 for r in rows if r["state"] == "expiring"), "expired": sum(1 for r in rows if r["state"] == "expired"),
        "full": sum(1 for r in rows if r["available"] == 0),
    }


@router.get("/export.csv")
def export(q: Optional[str] = None, type: Optional[str] = None, status: str = "active",
           days: int = Query(SOON_DAYS, ge=1, le=730), db: Session = Depends(get_db), _: User = Depends(staff)):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["name", "publisher", "type", "seats", "in_use", "available", "renewal_date", "days_left", "purchase_date",
                "purchase_cost", "supplier", "order_number", "status"])
    for r in _filtered(db, q, type, status, days):
        w.writerow([r["name"], r["publisher"] or "", r["license_type"], r["seats"], r["used"], r["available"],
                    r["renewal_date"] or "", "" if r["days_left"] is None else r["days_left"], r["purchase_date"] or "",
                    "" if r["purchase_cost"] is None else r["purchase_cost"], r["vendor"] or "", r["order_number"] or "", r["status"]])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="licences.csv"'})


@router.get("/for-asset/{asset_id}")
def for_asset(asset_id: int, db: Session = Depends(get_db), _: User = Depends(staff)):
    rows = db.scalars(select(LicenseAssignment).options(selectinload(LicenseAssignment.license)).where(
        LicenseAssignment.asset_id == asset_id, LicenseAssignment.released_on.is_(None))).all()
    return [{"assignment_id": a.id, "license_id": a.license.id, "name": a.license.name, "license_type": a.license.license_type,
             "assigned_on": a.assigned_on.isoformat(), "renewal_date": a.license.renewal_date.isoformat() if a.license.renewal_date else None}
            for a in rows]


def licenses_of_person(db: Session, key: str, employee_no: Optional[str] = None) -> list[LicenseAssignment]:
    """Seats in use by a person (matched by person key or Employee ID)."""
    rows = db.scalars(select(LicenseAssignment).options(selectinload(LicenseAssignment.license)).where(
        LicenseAssignment.released_on.is_(None), LicenseAssignment.kind == "user")).all()
    emp = _norm(employee_no)
    return [a for a in rows if a.person_key == key or (emp and _norm(a.employee_no) == emp)]


# ------------------------------------------------------------------ create / edit
@router.post("", status_code=201)
def create(body: LicenseIn, db: Session = Depends(get_db), me: User = Depends(staff)):
    lic = License(**_clean(body), created_by=me.full_name)
    db.add(lic)
    db.commit()
    return _detail(_get(db, lic.id))


@router.get("/{lid}")
def detail(lid: int, db: Session = Depends(get_db), _: User = Depends(staff)):
    return _detail(_get(db, lid))


def _detail(lic: License) -> dict:
    today = dt.date.today()
    r = _row(lic, today)
    r.update(license_key=lic.license_key, notes=lic.notes, created_by=lic.created_by,
             created_at=lic.created_at.isoformat(),
             assignments=[_assignment(a) for a in lic.assignments if a.released_on is None],
             history=[_assignment(a) for a in reversed(lic.assignments) if a.released_on is not None])
    return r


@router.put("/{lid}")
def update(lid: int, body: LicenseIn, db: Session = Depends(get_db), _: User = Depends(staff)):
    lic = _get(db, lid)
    d = _clean(body)
    used = len(in_use(lic))
    if d["seats"] < used:
        raise HTTPException(409, f"{used} seats are in use. Release some before reducing the seats to {d['seats']}.")
    for k, v in d.items():
        setattr(lic, k, v)
    db.commit()
    return _detail(_get(db, lid))


@router.delete("/{lid}", status_code=204)
def delete(lid: int, db: Session = Depends(get_db), _: User = Depends(require_roles("admin"))):
    lic = _get(db, lid)
    db.delete(lic)
    db.commit()


# ------------------------------------------------------------------ seats
class AssignIn(BaseModel):
    kind: Literal["user", "asset"]
    asset_id: Optional[int] = None
    assignee_name: Optional[str] = None
    employee_no: Optional[str] = None
    assigned_on: Optional[dt.date] = None
    notes: Optional[str] = None


class ReleaseIn(BaseModel):
    assignment_ids: list[int] = Field(min_length=1, max_length=500)
    notes: Optional[str] = None


@router.post("/{lid}/assign", status_code=201)
def assign(lid: int, body: AssignIn, db: Session = Depends(get_db), me: User = Depends(staff)):
    lic = _get(db, lid)
    if lic.status != "active":
        raise HTTPException(409, "This licence is retired – seats can't be assigned")
    today = dt.date.today()
    if lic.renewal_date and lic.renewal_date < today:
        raise HTTPException(409, f"This licence expired on {lic.renewal_date}. Update the renewal date first.")
    if len(in_use(lic)) >= lic.seats:
        raise HTTPException(409, f"No free seats: all {lic.seats} are in use. Release one or increase the seats.")
    on = body.assigned_on or today
    if on > today + dt.timedelta(days=1):
        raise HTTPException(400, "The assigned date cannot be in the future")

    if body.kind == "asset":
        asset = db.get(Asset, body.asset_id) if body.asset_id else None
        if not asset:
            raise HTTPException(404, "Choose an asset")
        if asset.status in ("Retired", "Lost"):
            raise HTTPException(400, f"{asset.asset_tag} is {asset.status} – it can't hold a licence")
        key, label, emp, aid = f"a:{asset.id}", f"{asset.asset_tag} · {asset.name}", None, asset.id
    else:
        name = " ".join((body.assignee_name or "").split())
        if not name:
            raise HTTPException(422, "Enter the person's name")
        emp = " ".join((body.employee_no or "").split()) or None
        key, label, aid = person_key(emp, name), name, None
    if any(a.person_key == key for a in in_use(lic)):
        raise HTTPException(409, f"{label} already has a seat of this licence")

    a = LicenseAssignment(license_id=lic.id, kind=body.kind, asset_id=aid, assignee_name=label, employee_no=emp, person_key=key,
                          assigned_on=on, assigned_by=me.full_name, notes=(body.notes or "").strip() or None)
    lic.assignments.append(a)
    db.commit()
    return _detail(_get(db, lid))


@router.post("/{lid}/release")
def release(lid: int, body: ReleaseIn, db: Session = Depends(get_db), me: User = Depends(staff)):
    lic = _get(db, lid)
    mine = {a.id: a for a in in_use(lic)}
    bad = [i for i in body.assignment_ids if i not in mine]
    if bad:
        raise HTTPException(404, "One or more seats were not found or are already released")
    today = dt.date.today()
    for i in set(body.assignment_ids):
        a = mine[i]
        a.released_on, a.released_by, a.release_notes = max(today, a.assigned_on), me.full_name, (body.notes or "").strip() or None
    db.commit()
    return _detail(_get(db, lid))
