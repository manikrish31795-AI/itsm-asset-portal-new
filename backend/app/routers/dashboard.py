import datetime as dt

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import require_roles
from ..database import get_db
from ..models import Asset, User

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("")
def dashboard(db: Session = Depends(get_db), _: User = Depends(require_roles("admin", "technician"))):
    today = dt.date.today()
    soon = today + dt.timedelta(days=60)

    def grouped(col):
        rows = db.execute(select(col, func.count()).group_by(col).order_by(func.count().desc())).all()
        return [{"label": r[0] or "Unspecified", "count": r[1]} for r in rows]

    total = db.scalar(select(func.count(Asset.id))) or 0
    total_value = db.scalar(select(func.coalesce(func.sum(Asset.purchase_cost), 0.0))) or 0.0

    expiring = db.scalars(
        select(Asset)
        .where(Asset.warranty_expiry.is_not(None), Asset.warranty_expiry >= today, Asset.warranty_expiry <= soon)
        .order_by(Asset.warranty_expiry)
        .limit(10)
    ).all()
    expired_count = db.scalar(
        select(func.count(Asset.id)).where(Asset.warranty_expiry < today, Asset.status != "Retired")
    ) or 0

    return {
        "total_assets": total,
        "total_value": round(total_value, 2),
        "warranty_expired": expired_count,
        "warranty_expiring_soon": len(expiring),
        "by_category": grouped(Asset.category),
        "by_status": grouped(Asset.status),
        "by_location": grouped(Asset.location),
        "expiring_assets": [
            {"id": a.id, "asset_tag": a.asset_tag, "name": a.name, "warranty_expiry": a.warranty_expiry.isoformat()}
            for a in expiring
        ],
    }
