"""Reminders: warranties, end-of-life and audit dates that need action. Retired and Lost assets are ignored."""
import csv
import datetime as dt
import io
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..auth import require_roles
from ..database import get_db
from ..locations import location_clause
from ..models import Asset, Audit, AuditItem, User

router = APIRouter(prefix="/api/alerts", tags=["alerts"])
staff = require_roles("admin", "technician")

INACTIVE = ("Retired", "Lost")
TYPES = {
    "warranty_expiring": ("warranty_expiry", "Warranty expiring"),
    "warranty_expired": ("warranty_expiry", "Warranty expired"),
    "eol": ("eol_date", "End of life"),
    "audit_due": ("next_audit_date", "Audit due"),
}


def _condition(kind: str, today: dt.date, days: int):
    col = getattr(Asset, TYPES[kind][0])
    horizon = today + dt.timedelta(days=days)
    if kind == "warranty_expiring":
        return col.is_not(None), col >= today, col <= horizon
    if kind == "warranty_expired":
        return col.is_not(None), col < today
    return col.is_not(None), col <= horizon  # eol / audit_due include dates already passed


def _base(kind, today, days, category=None, location=None, q=None):
    stmt = select(Asset).where(Asset.status.not_in(INACTIVE), *_condition(kind, today, days))
    if category:
        stmt = stmt.where(Asset.category == category)
    if location:
        clause = location_clause(Asset.location, [location])
        if clause is not None:
            stmt = stmt.where(clause)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(Asset.asset_tag).like(like), func.lower(Asset.name).like(like),
                              func.lower(Asset.serial_number).like(like), func.lower(Asset.employee_no).like(like),
                              func.lower(Asset.hostname).like(like)))
    return stmt


def _row(a: Asset, kind: str, today: dt.date) -> dict:
    d = getattr(a, TYPES[kind][0])
    return {
        "id": a.id, "asset_tag": a.asset_tag, "name": a.name, "category": a.category, "status": a.status,
        "location": a.location, "assigned_to": (a.assigned_to.full_name if a.assigned_to else a.assigned_username),
        "date": d.isoformat(), "days_left": (d - today).days,
    }


@router.get("/summary")
def summary(days: int = Query(60, ge=1, le=730), db: Session = Depends(get_db), _: User = Depends(staff)):
    today = dt.date.today()
    counts = {k: db.scalar(select(func.count()).select_from(_base(k, today, days).subquery())) or 0 for k in TYPES}

    overdue = []
    for a in db.scalars(select(Audit).where(Audit.status == "open", Audit.due_date.is_not(None), Audit.due_date < today)
                        .order_by(Audit.due_date)).all():
        done = db.scalar(select(func.count()).where(AuditItem.audit_id == a.id, AuditItem.result != "pending")) or 0
        total = db.scalar(select(func.count()).where(AuditItem.audit_id == a.id)) or 0
        overdue.append({"id": a.id, "name": a.name, "due_date": a.due_date.isoformat(),
                        "days_overdue": (today - a.due_date).days, "checked": done, "total": total})
    return {"days": days, **counts, "overdue_audits": overdue,
            "total": sum(counts.values()) + len(overdue)}


@router.get("/items")
def items(
    type: str = Query(...), days: int = Query(60, ge=1, le=730), category: Optional[str] = None,
    location: Optional[str] = None, q: Optional[str] = None, page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200), db: Session = Depends(get_db), _: User = Depends(staff),
):
    if type not in TYPES:
        raise HTTPException(422, f"type must be one of {', '.join(TYPES)}")
    today = dt.date.today()
    base = _base(type, today, days, category, location, q)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    col = getattr(Asset, TYPES[type][0])
    rows = db.scalars(base.options(selectinload(Asset.assigned_to)).order_by(col, Asset.asset_tag)
                      .offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [_row(a, type, today) for a in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/export.csv")
def export(type: str = Query(...), days: int = Query(60, ge=1, le=730), category: Optional[str] = None,
           location: Optional[str] = None, db: Session = Depends(get_db), _: User = Depends(staff)):
    if type not in TYPES:
        raise HTTPException(422, f"type must be one of {', '.join(TYPES)}")
    today = dt.date.today()
    col = getattr(Asset, TYPES[type][0])
    rows = db.scalars(_base(type, today, days, category, location).options(selectinload(Asset.assigned_to))
                      .order_by(col, Asset.asset_tag)).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["asset_tag", "name", "category", "status", "location", "assigned_to", TYPES[type][1], "days_left"])
    for a in rows:
        r = _row(a, type, today)
        w.writerow([r["asset_tag"], r["name"], r["category"], r["status"], r["location"] or "", r["assigned_to"] or "",
                    r["date"], r["days_left"]])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="alerts-{type}.csv"'})
