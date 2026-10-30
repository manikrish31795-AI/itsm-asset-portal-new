"""Allocation rules shared by the allocation endpoints, asset edits and bulk import.

The asset record (assigned_to_id / assigned_username) always says who holds an asset *now*.
The Allocation table is the ledger of who held it and when. sync_allocation() keeps the two
consistent, whichever screen changed the assignment.
"""
import datetime as dt

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .models import Allocation, Asset, User

# Assets in these states cannot be handed to someone
BLOCKED_STATUSES = ("retired", "lost", "in repair")


def person_key(user_id, name) -> str:
    if user_id:
        return f"u:{user_id}"
    return f"n:{(name or '').strip().lower()}"


def find_portal_user(users, name):
    """Match a typed name / email / email-prefix to a portal user, so assets show up in their own login."""
    key = (name or "").strip().lower()
    if not key:
        return None
    for u in users:
        if key in (u.email.lower(), u.full_name.lower(), u.email.split("@")[0].lower()):
            return u
    return None


def asset_assignee(db: Session, asset: Asset):
    """(user_id, name) of whoever the asset record says holds it, or None."""
    if asset.assigned_to_id:
        u = db.get(User, asset.assigned_to_id)
        name = u.full_name if u else (asset.assigned_username or f"User #{asset.assigned_to_id}")
        return asset.assigned_to_id, name
    if (asset.assigned_username or "").strip():
        return None, asset.assigned_username.strip()
    return None


def open_allocation(asset: Asset):
    return next((a for a in asset.allocations if a.returned_on is None), None)


def sync_allocation(db: Session, asset: Asset, performer: str, today=None, default_start=None) -> None:
    """Make the ledger match the asset record: close a stale open allocation, open a missing one."""
    today = today or dt.date.today()
    who = asset_assignee(db, asset)
    cur = open_allocation(asset)
    cur_key = person_key(cur.user_id, cur.assignee_name) if cur else None
    new_key = person_key(*who) if who else None

    if cur_key == new_key:
        if cur and asset.employee_no and cur.employee_no != asset.employee_no:
            cur.employee_no = asset.employee_no
        return

    if cur:
        cur.returned_on = max(today, cur.allocated_on)
        cur.returned_by = performer
        cur.return_status = "Reassigned" if who else (asset.status or "Returned")
        cur.return_notes = "Changed on the asset record"
    if who:
        start = today if cur else (asset.allocated_date or default_start or today)
        asset.allocations.append(
            Allocation(
                user_id=who[0], assignee_name=who[1], employee_no=asset.employee_no,
                allocated_on=min(start, today), allocated_by=performer,
            )
        )


def backfill_allocations(db: Session) -> int:
    """On startup: give every existing assignment (from earlier versions or imports) a ledger entry."""
    with_assignee = select(Asset).where(
        or_(Asset.assigned_to_id.is_not(None), Asset.assigned_username.is_not(None))
    )
    with_open = select(Asset).join(Allocation).where(Allocation.returned_on.is_(None))
    assets = {a.id: a for a in db.scalars(with_assignee).all()}
    assets.update({a.id: a for a in db.scalars(with_open).all()})
    changed = 0
    for a in assets.values():
        before = open_allocation(a)
        sync_allocation(db, a, "System (migration)", default_start=a.created_at.date() if a.created_at else None)
        if open_allocation(a) is not before:
            changed += 1
    db.commit()
    return changed
