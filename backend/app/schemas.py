import datetime as dt
from typing import Optional, Literal
from pydantic import BaseModel, EmailStr, ConfigDict

Role = Literal["admin", "technician", "requester"]


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    role: Role = "requester"


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[Role] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: EmailStr
    full_name: str
    role: str
    is_active: bool


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class AssetBase(BaseModel):
    model_config = ConfigDict(protected_namespaces=())  # allow a field called "model_no"

    asset_tag: str
    name: str
    category: str
    status: str = "In Stock"
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    location: Optional[str] = None
    department: Optional[str] = None
    vendor: Optional[str] = None
    purchase_date: Optional[dt.date] = None
    purchase_cost: Optional[float] = None
    warranty_expiry: Optional[dt.date] = None
    notes: Optional[str] = None
    assigned_to_id: Optional[int] = None
    company: Optional[str] = None
    model_no: Optional[str] = None
    hostname: Optional[str] = None
    order_number: Optional[str] = None
    warranty_months: Optional[int] = None
    eol_date: Optional[dt.date] = None
    allocated_date: Optional[dt.date] = None
    last_audited_on: Optional[dt.date] = None
    next_audit_date: Optional[dt.date] = None
    assigned_username: Optional[str] = None
    employee_no: Optional[str] = None
    manager: Optional[str] = None
    job_title: Optional[str] = None
    mac_address: Optional[str] = None
    ip_address: Optional[str] = None
    os: Optional[str] = None
    processor: Optional[str] = None
    ram: Optional[str] = None
    storage: Optional[str] = None
    attributes: Optional[dict[str, str]] = None


class AssetCreate(AssetBase):
    pass


class AssetUpdate(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    asset_tag: Optional[str] = None
    name: Optional[str] = None
    category: Optional[str] = None
    status: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    location: Optional[str] = None
    department: Optional[str] = None
    vendor: Optional[str] = None
    purchase_date: Optional[dt.date] = None
    purchase_cost: Optional[float] = None
    warranty_expiry: Optional[dt.date] = None
    notes: Optional[str] = None
    assigned_to_id: Optional[int] = None
    company: Optional[str] = None
    model_no: Optional[str] = None
    hostname: Optional[str] = None
    order_number: Optional[str] = None
    warranty_months: Optional[int] = None
    eol_date: Optional[dt.date] = None
    allocated_date: Optional[dt.date] = None
    last_audited_on: Optional[dt.date] = None
    next_audit_date: Optional[dt.date] = None
    assigned_username: Optional[str] = None
    employee_no: Optional[str] = None
    manager: Optional[str] = None
    job_title: Optional[str] = None
    mac_address: Optional[str] = None
    ip_address: Optional[str] = None
    os: Optional[str] = None
    processor: Optional[str] = None
    ram: Optional[str] = None
    storage: Optional[str] = None
    attributes: Optional[dict[str, str]] = None


class HistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    action: str
    performed_by: str
    created_at: dt.datetime


class AssetOut(AssetBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    assigned_to: Optional[UserOut] = None
    created_at: dt.datetime
    updated_at: dt.datetime


class AssetDetail(AssetOut):
    history: list[HistoryOut] = []


class AssetPage(BaseModel):
    items: list[AssetOut]
    total: int
    page: int
    page_size: int


# ------------------------------------------------------------------ allocations
from pydantic import Field  # noqa: E402


class AssetBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())
    id: int
    asset_tag: str
    name: str
    category: str
    model: Optional[str] = None
    serial_number: Optional[str] = None
    status: str
    location: Optional[str] = None


class AllocateIn(BaseModel):
    asset_ids: list[int] = Field(min_length=1, max_length=100)
    user_id: Optional[int] = None          # a portal user ...
    assignee_name: Optional[str] = None    # ... or any employee, by name
    employee_no: Optional[str] = None
    allocated_on: Optional[dt.date] = None
    notes: Optional[str] = None


class ReturnIn(BaseModel):
    allocation_ids: list[int] = Field(min_length=1, max_length=200)
    return_status: str = "In Stock"
    returned_on: Optional[dt.date] = None
    notes: Optional[str] = None


class AllocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    person: str
    asset: AssetBrief
    user_id: Optional[int] = None
    assignee_name: str
    employee_no: Optional[str] = None
    allocated_on: dt.date
    returned_on: Optional[dt.date] = None
    allocated_by: str
    returned_by: Optional[str] = None
    return_status: Optional[str] = None
    notes: Optional[str] = None
    return_notes: Optional[str] = None


class AllocationPage(BaseModel):
    items: list[AllocationOut]
    total: int
    page: int
    page_size: int


# ------------------------------------------------------------------ audits
AuditResult = Literal["pending", "found", "missing", "moved"]


class AuditCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    locations: list[str] = []        # empty = every location; "__none__" = assets without a location
    categories: list[str] = []       # empty = every category
    include_inactive: bool = False   # also audit Retired / Lost assets
    due_date: Optional[dt.date] = None
    notes: Optional[str] = None


class AuditPreviewIn(BaseModel):
    locations: list[str] = []
    categories: list[str] = []
    include_inactive: bool = False


class AuditItemUpdate(BaseModel):
    result: AuditResult
    found_location: Optional[str] = None
    condition: Optional[str] = None
    notes: Optional[str] = None


class AuditBulkIn(BaseModel):
    item_ids: list[int] = Field(min_length=1, max_length=500)
    result: Literal["pending", "found", "missing"]


class AuditScanIn(BaseModel):
    code: str = Field(min_length=1, max_length=100)  # asset tag (or serial number)
    found_location: Optional[str] = None


class AuditCloseIn(BaseModel):
    pending_action: Literal["leave", "missing"] = "leave"  # what to do with assets nobody checked
    mark_missing_lost: bool = False                        # set status of missing assets to Lost
    apply_moves: bool = False                              # update location of assets found elsewhere


class AuditItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    audit_id: int
    asset_id: int
    asset_tag: str
    asset_name: str
    category: str
    serial_number: Optional[str] = None
    expected_location: Optional[str] = None
    expected_holder: Optional[str] = None
    expected_status: Optional[str] = None
    unexpected: bool = False
    result: str
    found_location: Optional[str] = None
    condition: Optional[str] = None
    notes: Optional[str] = None
    audited_by: Optional[str] = None
    audited_at: Optional[dt.datetime] = None


class AuditItemPage(BaseModel):
    items: list[AuditItemOut]
    total: int
    page: int
    page_size: int
