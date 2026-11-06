import datetime as dt
from sqlalchemy import String, Integer, Float, Date, DateTime, ForeignKey, Text, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="requester")  # admin | technician | requester
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_tag: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    category: Mapped[str] = mapped_column(String(50), index=True)  # Laptop, Desktop, Server, Network, Software, Mobile, Peripheral
    status: Mapped[str] = mapped_column(String(30), default="In Stock", index=True)  # In Use, In Stock, In Repair, Retired, Lost
    manufacturer: Mapped[str | None] = mapped_column(String(100))
    model: Mapped[str | None] = mapped_column(String(100))
    serial_number: Mapped[str | None] = mapped_column(String(100), index=True)
    location: Mapped[str | None] = mapped_column(String(100))
    department: Mapped[str | None] = mapped_column(String(100))
    vendor: Mapped[str | None] = mapped_column(String(100))
    purchase_date: Mapped[dt.date | None] = mapped_column(Date)
    purchase_cost: Mapped[float | None] = mapped_column(Float)
    warranty_expiry: Mapped[dt.date | None] = mapped_column(Date, index=True)
    notes: Mapped[str | None] = mapped_column(Text)

    # --- extended fields ---
    company: Mapped[str | None] = mapped_column(String(150), index=True)
    model_no: Mapped[str | None] = mapped_column(String(100))
    hostname: Mapped[str | None] = mapped_column(String(150), index=True)
    order_number: Mapped[str | None] = mapped_column(String(100))
    warranty_months: Mapped[int | None] = mapped_column(Integer)
    eol_date: Mapped[dt.date | None] = mapped_column(Date)
    allocated_date: Mapped[dt.date | None] = mapped_column(Date)
    last_audited_on: Mapped[dt.date | None] = mapped_column(Date)  # set when an audit that verified it is closed
    next_audit_date: Mapped[dt.date | None] = mapped_column(Date, index=True)
    assigned_username: Mapped[str | None] = mapped_column(String(150), index=True)  # free text; may not be a portal user
    employee_no: Mapped[str | None] = mapped_column(String(50), index=True)
    manager: Mapped[str | None] = mapped_column(String(150))
    job_title: Mapped[str | None] = mapped_column(String(150))
    mac_address: Mapped[str | None] = mapped_column(String(50), index=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), index=True)
    os: Mapped[str | None] = mapped_column(String(100))
    processor: Mapped[str | None] = mapped_column(String(150))
    ram: Mapped[str | None] = mapped_column(String(50))
    storage: Mapped[str | None] = mapped_column(String(100))
    # anything else from an import / category-specific details (AD, Antivirus, SwitchPort, Printer Type ...)
    attributes: Mapped[dict | None] = mapped_column(JSON)

    assigned_to_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    assigned_to: Mapped["User | None"] = relationship()
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow)

    history: Mapped[list["AssetHistory"]] = relationship(
        back_populates="asset", cascade="all, delete-orphan", order_by="AssetHistory.created_at.desc()"
    )
    allocations: Mapped[list["Allocation"]] = relationship(
        back_populates="asset", cascade="all, delete-orphan",
        order_by="Allocation.allocated_on.desc(), Allocation.id.desc()",
    )
    audit_items: Mapped[list["AuditItem"]] = relationship(back_populates="asset", cascade="all, delete-orphan")


class AssetHistory(Base):
    __tablename__ = "asset_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id"))
    action: Mapped[str] = mapped_column(String(255))
    performed_by: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    asset: Mapped[Asset] = relationship(back_populates="history")


class Allocation(Base):
    """One row per period an asset is held by a person. returned_on is NULL while it is still held."""

    __tablename__ = "asset_allocations"

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    assignee_name: Mapped[str] = mapped_column(String(255), index=True)  # name at the time (also for non-portal staff)
    employee_no: Mapped[str | None] = mapped_column(String(50))
    allocated_on: Mapped[dt.date] = mapped_column(Date, default=dt.date.today)
    returned_on: Mapped[dt.date | None] = mapped_column(Date, index=True)
    allocated_by: Mapped[str] = mapped_column(String(255))
    returned_by: Mapped[str | None] = mapped_column(String(255))
    return_status: Mapped[str | None] = mapped_column(String(30))  # status the asset got on return, or "Reassigned"
    notes: Mapped[str | None] = mapped_column(Text)
    return_notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    asset: Mapped[Asset] = relationship(back_populates="allocations")
    user: Mapped["User | None"] = relationship()

    @property
    def person(self) -> str:
        return f"u:{self.user_id}" if self.user_id else f"n:{(self.assignee_name or '').strip().lower()}"


class Audit(Base):
    """A physical verification round: 'go and check that these assets are where the records say'."""

    __tablename__ = "audits"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150))
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)  # open | closed
    scope_locations: Mapped[list | None] = mapped_column(JSON)   # what was selected when it was created
    scope_categories: Mapped[list | None] = mapped_column(JSON)
    include_inactive: Mapped[bool] = mapped_column(Boolean, default=False)
    due_date: Mapped[dt.date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    closed_by: Mapped[str | None] = mapped_column(String(255))
    closed_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    close_summary: Mapped[dict | None] = mapped_column(JSON)  # what closing changed (lost / moved / verified ...)

    items: Mapped[list["AuditItem"]] = relationship(back_populates="audit", cascade="all, delete-orphan")


class AuditItem(Base):
    """One asset inside an audit. The 'expected_*' columns are a snapshot taken when the audit was created,
    so the audit still reads correctly even if the asset record changes afterwards."""

    __tablename__ = "audit_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    audit_id: Mapped[int] = mapped_column(ForeignKey("audits.id"), index=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id"), index=True)
    asset_tag: Mapped[str] = mapped_column(String(50), index=True)
    asset_name: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(50))
    serial_number: Mapped[str | None] = mapped_column(String(100))
    expected_location: Mapped[str | None] = mapped_column(String(100))
    expected_holder: Mapped[str | None] = mapped_column(String(255))
    expected_status: Mapped[str | None] = mapped_column(String(30))
    unexpected: Mapped[bool] = mapped_column(Boolean, default=False)  # found during the audit but not on its list

    result: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending|found|missing|moved
    found_location: Mapped[str | None] = mapped_column(String(100))  # only when result == "moved"
    condition: Mapped[str | None] = mapped_column(String(30))
    notes: Mapped[str | None] = mapped_column(Text)
    audited_by: Mapped[str | None] = mapped_column(String(255))
    audited_at: Mapped[dt.datetime | None] = mapped_column(DateTime)

    audit: Mapped[Audit] = relationship(back_populates="items")
    asset: Mapped[Asset] = relationship(back_populates="audit_items")


class AssetIdSeries(Base):
    """One numbering series per category: Laptop -> L, Desktop -> D ... gives L-ESDS-0001, L-ESDS-0002 ..."""
    __tablename__ = "asset_id_series"

    id: Mapped[int] = mapped_column(primary_key=True)
    category_key: Mapped[str] = mapped_column(String(50), unique=True, index=True)  # lower-case category
    category: Mapped[str] = mapped_column(String(50))
    prefix: Mapped[str] = mapped_column(String(10), unique=True)
    last_number: Mapped[int] = mapped_column(Integer, default=0)  # numbers are never re-used


class Clearance(Base):
    """Exit / handover clearance: every asset an employee holds must be returned (or accounted for)."""
    __tablename__ = "clearances"

    id: Mapped[int] = mapped_column(primary_key=True)
    person_key: Mapped[str] = mapped_column(String(300), index=True)
    employee_name: Mapped[str] = mapped_column(String(255))
    employee_no: Mapped[str | None] = mapped_column(String(50), index=True)
    department: Mapped[str | None] = mapped_column(String(100))
    manager: Mapped[str | None] = mapped_column(String(255))
    job_title: Mapped[str | None] = mapped_column(String(150))
    location: Mapped[str | None] = mapped_column(String(100), index=True)  # where the employee sits (from the assets held)
    reason: Mapped[str] = mapped_column(String(50), default="Resignation")
    last_working_day: Mapped[dt.date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)  # open | completed | cancelled
    outcome: Mapped[str | None] = mapped_column(String(30))  # cleared | cleared_with_loss | not_cleared
    created_by: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    completed_by: Mapped[str | None] = mapped_column(String(255))
    completed_at: Mapped[dt.datetime | None] = mapped_column(DateTime)

    items: Mapped[list["ClearanceItem"]] = relationship(
        back_populates="clearance", cascade="all, delete-orphan", order_by="ClearanceItem.id")


class ClearanceItem(Base):
    __tablename__ = "clearance_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    clearance_id: Mapped[int] = mapped_column(ForeignKey("clearances.id"), index=True)
    allocation_id: Mapped[int] = mapped_column(ForeignKey("asset_allocations.id"))
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id"))
    asset_tag: Mapped[str] = mapped_column(String(50))
    asset_name: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(50))
    serial_number: Mapped[str | None] = mapped_column(String(100))
    allocated_on: Mapped[dt.date | None] = mapped_column(Date)

    result: Mapped[str] = mapped_column(String(20), default="pending")  # pending | returned | not_returned
    return_status: Mapped[str | None] = mapped_column(String(30))  # In Stock / In Repair / Retired
    condition: Mapped[str | None] = mapped_column(String(30))
    notes: Mapped[str | None] = mapped_column(Text)
    checked_by: Mapped[str | None] = mapped_column(String(255))
    checked_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    final: Mapped[str | None] = mapped_column(String(20))  # set on completion: returned | lost | outstanding

    clearance: Mapped[Clearance] = relationship(back_populates="items")


class License(Base):
    """A software licence: how many seats were bought, the key, and when it must be renewed."""
    __tablename__ = "licenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    publisher: Mapped[str | None] = mapped_column(String(150))
    license_type: Mapped[str] = mapped_column(String(40), default="Subscription")
    license_key: Mapped[str | None] = mapped_column(Text)
    seats: Mapped[int] = mapped_column(Integer, default=1)
    vendor: Mapped[str | None] = mapped_column(String(150))       # supplier / reseller
    order_number: Mapped[str | None] = mapped_column(String(100))
    purchase_date: Mapped[dt.date | None] = mapped_column(Date)
    purchase_cost: Mapped[float | None] = mapped_column(Float)
    renewal_date: Mapped[dt.date | None] = mapped_column(Date, index=True)  # empty = never expires (perpetual)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)  # active | retired
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow)

    assignments: Mapped[list["LicenseAssignment"]] = relationship(
        back_populates="license", cascade="all, delete-orphan", order_by="LicenseAssignment.id")


class LicenseAssignment(Base):
    """One seat in use: given to a person or installed on an asset. released_on is empty while the seat is in use."""
    __tablename__ = "license_assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    license_id: Mapped[int] = mapped_column(ForeignKey("licenses.id"), index=True)
    kind: Mapped[str] = mapped_column(String(10))  # user | asset
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id"), index=True)
    assignee_name: Mapped[str] = mapped_column(String(255))  # person's name, or "TAG · asset name"
    employee_no: Mapped[str | None] = mapped_column(String(50), index=True)
    person_key: Mapped[str] = mapped_column(String(300), index=True)  # e:<employee id> | n:<name> | a:<asset id>
    assigned_on: Mapped[dt.date] = mapped_column(Date, default=dt.date.today)
    released_on: Mapped[dt.date | None] = mapped_column(Date, index=True)
    assigned_by: Mapped[str | None] = mapped_column(String(255))
    released_by: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    release_notes: Mapped[str | None] = mapped_column(Text)

    license: Mapped[License] = relationship(back_populates="assignments")
