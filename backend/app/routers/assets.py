import csv
import io
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select, func
from sqlalchemy.orm import Session, selectinload

from ..allocation_service import sync_allocation
from ..auth import get_current_user, require_roles
from ..constants import ASSET_COLUMNS, CATEGORIES, STATUSES
from ..database import get_db
from ..locations import location_clause, location_options
from ..models import Asset, AssetHistory, User
from ..schemas import AssetCreate, AssetDetail, AssetOut, AssetPage, AssetUpdate

router = APIRouter(prefix="/api/assets", tags=["assets"])


def _merged(defaults: list[str], column) -> list[str]:
    """Built-in values plus whatever already exists in the database (e.g. categories created by an import)."""
    return sorted(set(defaults) | {v for v in column if v}, key=str.lower)


@router.get("/meta")
def meta(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    cats = db.scalars(select(Asset.category).distinct()).all()
    stats = db.scalars(select(Asset.status).distinct()).all()
    loc_query = select(Asset.location, func.count()).group_by(Asset.location)
    if user.role == "requester":  # requesters only ever see (and count) their own assets
        loc_query = loc_query.where(Asset.assigned_to_id == user.id)
    locations, no_location = location_options(db.execute(loc_query).all())
    return {
        "categories": _merged(CATEGORIES, cats),
        "statuses": _merged(STATUSES, stats),
        "locations": locations,            # [{name, count}] - spellings that differ only by case are merged
        "no_location_count": no_location,  # assets with a blank location (filter value "__none__")
    }


def _filtered(q: Optional[str], category: Optional[str], status: Optional[str], location: Optional[str]):
    stmt = select(Asset)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                Asset.name.ilike(like), Asset.asset_tag.ilike(like), Asset.serial_number.ilike(like),
                Asset.model.ilike(like), Asset.manufacturer.ilike(like), Asset.hostname.ilike(like),
                Asset.mac_address.ilike(like), Asset.ip_address.ilike(like), Asset.employee_no.ilike(like),
                Asset.assigned_username.ilike(like), Asset.company.ilike(like),
            )
        )
    if category:
        stmt = stmt.where(Asset.category == category)
    if status:
        stmt = stmt.where(Asset.status == status)
    if location:
        clause = location_clause(Asset.location, [location])  # case-insensitive; "__none__" = no location
        if clause is not None:
            stmt = stmt.where(clause)
    return stmt


@router.get("", response_model=AssetPage)
def list_assets(
    q: Optional[str] = None,
    category: Optional[str] = None,
    status: Optional[str] = None,
    location: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = _filtered(q, category, status, location)
    if user.role == "requester":  # requesters only see assets assigned to them
        stmt = stmt.where(Asset.assigned_to_id == user.id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    items = db.scalars(
        stmt.options(selectinload(Asset.assigned_to))
        .order_by(Asset.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return AssetPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/export.csv")
def export_csv(
    q: Optional[str] = None,
    category: Optional[str] = None,
    status: Optional[str] = None,
    location: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "technician")),
):
    rows = db.scalars(_filtered(q, category, status, location).options(selectinload(Asset.assigned_to))).all()
    extra_keys = sorted({k for a in rows for k in (a.attributes or {})}, key=str.lower)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(ASSET_COLUMNS + extra_keys)  # same headings the importer understands
    for a in rows:
        values = []
        for col in ASSET_COLUMNS:
            if col == "assigned_to":
                values.append(a.assigned_to.full_name if a.assigned_to else (a.assigned_username or ""))
            else:
                v = getattr(a, col, None)
                values.append("" if v is None else v)
        values += [(a.attributes or {}).get(k, "") for k in extra_keys]
        writer.writerow(values)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=assets.csv"},
    )


@router.get("/{asset_id}", response_model=AssetDetail)
def get_asset(asset_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    asset = db.get(Asset, asset_id)
    if not asset or (user.role == "requester" and asset.assigned_to_id != user.id):
        raise HTTPException(404, "Asset not found")
    return asset


@router.post("", response_model=AssetOut, status_code=201)
def create_asset(body: AssetCreate, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "technician"))):
    if db.scalar(select(Asset).where(Asset.asset_tag == body.asset_tag)):
        raise HTTPException(409, "Asset tag already exists")
    asset = Asset(**body.model_dump())
    asset.history.append(AssetHistory(action="Asset created", performed_by=user.full_name))
    sync_allocation(db, asset, user.full_name)  # created already assigned -> ledger entry
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


@router.put("/{asset_id}", response_model=AssetOut)
def update_asset(
    asset_id: int, body: AssetUpdate, db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "technician")),
):
    asset = db.get(Asset, asset_id)
    if not asset:
        raise HTTPException(404, "Asset not found")
    data = body.model_dump(exclude_unset=True)
    if "asset_tag" in data and data["asset_tag"] != asset.asset_tag:
        if db.scalar(select(Asset).where(Asset.asset_tag == data["asset_tag"])):
            raise HTTPException(409, "Asset tag already exists")
    for field, new in data.items():
        old = getattr(asset, field)
        if old == new:
            continue
        if field == "attributes":
            o, n = old or {}, new or {}
            keys = sorted(k for k in set(o) | set(n) if o.get(k) != n.get(k))
            if not keys:
                continue
            action = f"Additional details changed: {', '.join(keys)}"
        else:
            action = f"{field} changed: {old or '—'} → {new or '—'}"
        asset.history.append(AssetHistory(action=action, performed_by=user.full_name))
        setattr(asset, field, new)
    sync_allocation(db, asset, user.full_name)  # assignment edited here -> keep the allocation ledger in step
    db.commit()
    db.refresh(asset)
    return asset


@router.delete("/{asset_id}", status_code=204)
def delete_asset(asset_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles("admin"))):
    asset = db.get(Asset, asset_id)
    if not asset:
        raise HTTPException(404, "Asset not found")
    db.delete(asset)
    db.commit()
