import datetime as dt
import calendar
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..asset_ids import COMPANY_CODE, DEFAULT_PREFIXES, allocate_id, find_duplicates, norm_text, preview_id, get_series
from ..auth import require_roles
from ..constants import CATEGORIES
from ..database import get_db
from ..models import Asset, AssetHistory, AssetIdSeries, User
from ..schemas import AssetOut

router = APIRouter(prefix="/api/asset-ids", tags=["asset-ids"])
staff = require_roles("admin", "technician")

# serial numbers are mandatory for these; software / other items may not have one
NO_SERIAL_NEEDED = {"software", "other"}


class AssetIdCreate(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    category: str
    name: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    model_no: Optional[str] = None
    serial_number: Optional[str] = None
    hostname: Optional[str] = None
    mac_address: Optional[str] = None
    company: Optional[str] = None
    vendor: Optional[str] = None
    order_number: Optional[str] = None
    purchase_date: Optional[dt.date] = None
    purchase_cost: Optional[float] = None
    warranty_months: Optional[int] = None
    warranty_expiry: Optional[dt.date] = None
    location: Optional[str] = None
    department: Optional[str] = None
    os: Optional[str] = None
    processor: Optional[str] = None
    ram: Optional[str] = None
    storage: Optional[str] = None
    notes: Optional[str] = None


def _clean(v):
    if isinstance(v, str):
        v = " ".join(v.split())
        return v or None
    return v


def _add_months(d: dt.date, months: int) -> dt.date:
    y, m0 = divmod(d.month - 1 + months, 12)
    y, m = d.year + y, m0 + 1
    return dt.date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


@router.get("/series")
def series(db: Session = Depends(get_db), _: User = Depends(staff)):
    """Every category with its letter and the ID that will be given next."""
    cats = {c.lower(): c for c in CATEGORIES}
    for c in db.scalars(select(Asset.category).distinct()).all():
        cats.setdefault(c.lower(), c)
    for s in db.scalars(select(AssetIdSeries)).all():
        cats.setdefault(s.category_key, s.category)
    out = []
    for key, name in sorted(cats.items()):
        p = preview_id(db, name)
        out.append({"category": name, "prefix": p["prefix"], "next_id": p["next_id"]})
    return {"company": COMPANY_CODE, "series": out}


@router.get("/preview")
def preview(category: str = Query(..., min_length=1), db: Session = Depends(get_db), _: User = Depends(staff)):
    return preview_id(db, category)


@router.get("/check")
def check(serial_number: Optional[str] = None, mac_address: Optional[str] = None, hostname: Optional[str] = None,
          db: Session = Depends(get_db), _: User = Depends(staff)):
    return {"duplicates": find_duplicates(db, serial_number, mac_address, hostname)}


@router.get("/recent")
def recent(limit: int = Query(15, ge=1, le=100), db: Session = Depends(get_db), _: User = Depends(staff)):
    rows = db.execute(
        select(Asset, AssetHistory)
        .join(AssetHistory, AssetHistory.asset_id == Asset.id)
        .where(AssetHistory.action.like("Asset ID generated%"))
        .order_by(AssetHistory.id.desc()).limit(limit)
    ).all()
    return [
        {"id": a.id, "asset_tag": a.asset_tag, "name": a.name, "category": a.category, "serial_number": a.serial_number,
         "location": a.location, "created_by": h.performed_by, "created_at": h.created_at.isoformat()}
        for a, h in rows
    ]


@router.post("", response_model=AssetOut, status_code=201)
def create(body: AssetIdCreate, db: Session = Depends(get_db), user: User = Depends(staff)):
    data = {k: _clean(v) for k, v in body.model_dump().items()}
    category = data.pop("category")
    if not category:
        raise HTTPException(422, "Category is required")
    known = {c.lower(): c for c in CATEGORIES} | {c.lower(): c for c in db.scalars(select(Asset.category).distinct()).all()}
    category = known.get(norm_text(category), category)  # keep the existing spelling ("laptop" -> "Laptop")

    if norm_text(category) not in NO_SERIAL_NEEDED and not data.get("serial_number"):
        raise HTTPException(422, "Serial number is required for this category")
    if not (data.get("name") or data.get("manufacturer") or data.get("model")):
        raise HTTPException(422, "Enter the manufacturer and model (or an asset name)")
    data["name"] = data.get("name") or " ".join(x for x in (data.get("manufacturer"), data.get("model")) if x)

    dups = find_duplicates(db, data.get("serial_number"), data.get("mac_address"), data.get("hostname"))
    if dups:
        d = dups[0]
        raise HTTPException(409, f"Already registered: {d['asset_tag']} ({d['name']}) has the same {' and '.join(d['matches'])}. "
                                 "No new asset ID was created.")

    if data.get("purchase_date") and data.get("warranty_months") and not data.get("warranty_expiry"):
        data["warranty_expiry"] = _add_months(data["purchase_date"], data["warranty_months"])

    tag = allocate_id(db, category)
    asset = Asset(asset_tag=tag, category=category, status="In Stock", **data)
    asset.history.append(AssetHistory(action=f"Asset ID generated: {tag}", performed_by=user.full_name))
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset
