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
