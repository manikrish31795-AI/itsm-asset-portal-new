"""Bulk import of assets from CSV / Excel files.

Columns that match a built-in field (see FIELD_ALIASES) go into that field.
Every other column is kept per asset under "additional details" (Asset.attributes),
so nothing in your export is lost.
"""
import calendar
import csv
import datetime as dt
import io
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from .allocation_service import sync_allocation
from .constants import ASSET_COLUMNS, CATEGORIES, STATUSES
from .models import Asset, AssetHistory, User

MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 5000
MAX_ERRORS_RETURNED = 200

TEMPLATE_COLUMNS = ASSET_COLUMNS

TEXT_FIELDS = (
    "company", "manufacturer", "model", "model_no", "serial_number", "hostname", "location", "department",
    "vendor", "order_number", "employee_no", "manager", "job_title", "mac_address", "ip_address", "os",
    "processor", "ram", "storage", "notes",
)
DATE_FIELDS = ("purchase_date", "warranty_expiry", "eol_date", "allocated_date", "last_audited_on", "next_audit_date")

# Accepted header spellings (lower-cased, punctuation turned into "_")
FIELD_ALIASES = {
    "asset_tag": {"asset_id", "tag", "asset_no", "asset_number", "assettag", "asset_code"},
    "name": {"asset_name", "asset"},
    "category": {"asset_category"},
    "status": {"asset_status"},  # NOT "state": that is an address column in many exports
    "company": {"organisation", "organization", "business_unit"},
    "manufacturer": {"make", "brand"},
    "model": {"model_name"},
    "model_no": {"model_number", "model_num"},
    "serial_number": {"serial", "serial_no", "serial_num", "sn", "service_tag"},
    "hostname": {"devicename", "device_name", "host_name", "computer_name"},
    "location": {"site", "office"},
    "department": {"dept"},
    "vendor": {"supplier"},
    "order_number": {"order_no", "po_number", "po", "purchase_order"},
    "purchase_date": {"purchased_on", "date_of_purchase", "bought_on", "purchased_date"},
    "purchase_cost": {"cost", "price", "purchase_price", "amount"},
    "warranty_months": {"warranty", "warranty_period"},
    "warranty_expiry": {"warranty_expires", "warranty_end", "warranty_end_date", "warranty_expiry_date"},
    "eol_date": {"eol", "end_of_life"},
    "allocated_date": {"allocatted_date", "allocation_date", "checkout_date"},
    "last_audited_on": {"last_audit", "last_audit_date", "last_audited", "audited_on"},
    "next_audit_date": {"next_audit", "next_audit_due", "next_audit_on"},
    "assigned_to": {"username", "user_name", "owner", "assignee", "assigned_user", "user", "assigned_to_email"},
    "employee_no": {"employee_number", "employeeid", "employee_id", "emp_id", "emp_no"},
    "manager": set(),
    "job_title": {"title", "designation"},
    "mac_address": {"mac", "mac_addr"},
    "ip_address": {"ipaddr", "ip", "ip_addr"},
    "os": {"operating_system"},
    "processor": {"cpu"},
    "ram": {"memory"},
    "storage": {"hdd", "disk", "hard_disk"},
    "notes": {"remarks", "comments", "description"},
}
ALIAS_LOOKUP: dict[str, str] = {}
for _field in ASSET_COLUMNS:
    ALIAS_LOOKUP[_field] = _field
for _field, _aliases in FIELD_ALIASES.items():
    for _a in _aliases:
        ALIAS_LOOKUP[_a] = _field
ALIAS_LOOKUP["warranty_months"] = "warranty_months"

# If several columns map to one of these, the first non-empty value wins (e.g. "Serial" and "Serial Number")
COALESCE_FIELDS = {"serial_number", "employee_no", "hostname"}
# Repeated address columns (Location + Default Location) are prefixed so they stay distinguishable
ADDRESS_PARTS = {"address", "city", "state", "country", "zip", "zip_code", "postcode"}

CATEGORY_ALIASES = {
    "notebook": "Laptop", "pc": "Desktop", "workstation": "Desktop", "phone": "Mobile", "smartphone": "Mobile",
    "tablet": "Mobile", "license": "Software", "licence": "Software",
}
STATUS_ALIASES = {
    "active": "In Use", "assigned": "In Use", "deployed": "In Use", "in service": "In Use",
    "available": "In Stock", "spare": "In Stock", "stock": "In Stock", "in storage": "In Stock",
    "ready to deploy": "In Stock", "repair": "In Repair", "under repair": "In Repair", "faulty": "In Repair",
    "out for repair": "In Repair", "out for diagnostics": "In Repair", "archived": "Retired",
    "disposed": "Retired", "scrapped": "Retired", "decommissioned": "Retired", "missing": "Lost",
    "lost/stolen": "Lost",
}

DATE_FORMATS = (
    "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d %b %Y", "%d %B %Y", "%b %d, %Y", "%Y/%m/%d",
    "%d-%b-%Y", "%d-%b-%y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d-%m-%Y %H:%M:%S",
)


class ImportFileError(ValueError):
    """The uploaded file itself is unusable (wrong type, no header, etc.)."""


# ---------------------------------------------------------------- value helpers
def _norm_header(h) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(h or "").strip().lower()).strip("_")


def _clean(v):
    if v is None:
        return None
    if isinstance(v, dt.datetime):
        return v.date().isoformat() if v.time() == dt.time(0) else v.strftime("%Y-%m-%d %H:%M")
    if isinstance(v, dt.date):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip()
    return s or None


def _parse_date(v):
    if v is None:
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    s = str(v).strip()
    if not s:
        return None
    for fmt in DATE_FORMATS:
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"unrecognised date '{s}' (use YYYY-MM-DD or DD/MM/YYYY)")


def _parse_cost(v):
    if v is None or str(v).strip() == "":
        return None
    if isinstance(v, (int, float)):
        cost = float(v)
    else:
        try:
            cost = float(re.sub(r"[^\d.\-]", "", str(v)))
        except ValueError:
            raise ValueError(f"invalid cost '{v}'")
    if cost < 0:
        raise ValueError("cost cannot be negative")
    return cost


def _parse_months(v):
    if v is None or str(v).strip() == "":
        return None
    if isinstance(v, (int, float)):
        months = float(v)
    else:
        m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(months?|mos?|m|years?|yrs?|y)?", str(v).strip().lower())
        if not m:
            raise ValueError(f"invalid warranty period '{v}' (use a number of months, e.g. 36)")
        months = float(m.group(1))
        if (m.group(2) or "").startswith("y"):
            months *= 12
    if months < 0:
        raise ValueError("warranty period cannot be negative")
    return int(round(months))


def _add_months(d: dt.date, months: int) -> dt.date:
    year_offset, month0 = divmod(d.month - 1 + months, 12)
    year, month = d.year + year_offset, month0 + 1
    return dt.date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def _resolve(value: str, known: dict[str, str], aliases: dict[str, str]):
    """Return (canonical value, is_new). Unknown values are kept (so new categories can be created)."""
    value = re.sub(r"\s+", " ", value.strip())
    key = value.lower()
    if key in known:
        return known[key], False
    if key in aliases:
        return aliases[key], False
    known[key] = value
    return value, True


# ---------------------------------------------------------------- file reading
def _map_columns(header):
    core: dict[str, list[int]] = {}
    extra: dict[int, str] = {}
    used: set[str] = set()
    group = None

    def unique(base: str) -> str:
        key, n = base, 2
        while key in used:
            key, n = f"{base} ({n})", n + 1
        used.add(key)
        return key

    for idx, h in enumerate(header):
        label = _clean(h)
        if not label:
            continue
        norm = _norm_header(label)
        if norm == "location":
            group = "Location"
        elif norm == "default_location":
            group = "Default Location"
        field = ALIAS_LOOKUP.get(norm)
        if field and (field not in core or field in COALESCE_FIELDS):
            core.setdefault(field, []).append(idx)
        elif norm in ADDRESS_PARTS and group:
            extra[idx] = unique(f"{group} {label}")
        else:
            extra[idx] = unique(label)
    return core, extra


def read_table(filename: str, content: bytes):
    """Parse the file. Returns ((core_columns, extra_columns), rows)
    where rows is a list of (sheet_row_number, [cell values])."""
    if len(content) > MAX_BYTES:
        raise ImportFileError("File is larger than 5 MB")
    name = (filename or "").lower()

    if name.endswith(".csv"):
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = content.decode("cp1252", errors="replace")
        try:
            dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        raw_rows = [list(r) for r in csv.reader(io.StringIO(text), dialect)]
    elif name.endswith(".xlsx"):
        import openpyxl

        try:
            wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
            raw_rows = [list(r) for r in wb.active.iter_rows(values_only=True)]
            wb.close()
        except Exception:
            raise ImportFileError("Could not read the Excel file. Make sure it is a valid .xlsx workbook")
    else:
        raise ImportFileError("Unsupported file type. Upload a .csv or .xlsx file")

    numbered = [(i + 1, r) for i, r in enumerate(raw_rows) if any(c is not None and str(c).strip() for c in r)]
    if not numbered:
        raise ImportFileError("The file is empty")

    header = numbered[0][1]
    core, extra = _map_columns(header)

    missing = [f for f in ("asset_tag", "category") if f not in core]
    if not any(f in core for f in ("name", "hostname", "model")):
        missing.append("name")
    if missing:
        found = ", ".join(str(h).strip() for h in header if _clean(h)) or "none"
        raise ImportFileError(
            f"Missing required column(s): {', '.join(missing)} "
            f"(e.g. Asset ID, Asset Name / DeviceName / Model, Category). Columns found: {found}"
        )

    data_rows = numbered[1:]
    if not data_rows:
        raise ImportFileError("The file has a header row but no data rows")
    if len(data_rows) > MAX_ROWS:
        raise ImportFileError(f"Too many rows ({len(data_rows)}). Split the file into chunks of {MAX_ROWS} or fewer")
    return (core, extra), data_rows


# ---------------------------------------------------------------- import
def run_import(db: Session, spec, rows, on_duplicate: str, dry_run: bool, performer: str) -> dict:
    core, extra = spec

    users = db.scalars(select(User)).all()
    by_email = {u.email.lower(): u for u in users}
    by_name = {u.full_name.lower(): u for u in users}
    by_local = {u.email.split("@")[0].lower(): u for u in users}
    existing = {a.asset_tag: a for a in db.scalars(select(Asset)).all()}

    known_cats = {c.lower(): c for c in CATEGORIES}
    known_stats = {s.lower(): s for s in STATUSES}
    for a in existing.values():
        known_cats.setdefault(a.category.lower(), a.category)
        if a.status:
            known_stats.setdefault(a.status.lower(), a.status)
    new_categories: set[str] = set()
    new_statuses: set[str] = set()

    seen: dict[str, int] = {}
    errors = []
    created = updated = skipped = failed = 0

    for rownum, cells in rows:
        def cell(i):
            return cells[i] if i < len(cells) else None

        raw = {}
        for field, idxs in core.items():
            raw[field] = next((cell(i) for i in idxs if _clean(cell(i)) is not None), None)
        attrs = {key: _clean(cell(i)) for i, key in extra.items() if _clean(cell(i)) is not None}

        errs = []
        tag = _clean(raw.get("asset_tag"))
        name = _clean(raw.get("name")) or _clean(raw.get("hostname")) or _clean(raw.get("model"))
        if not tag:
            errs.append("asset_tag is required")
        if not name:
            errs.append("name is required (Asset Name, DeviceName or Model must have a value)")

        category = None
        cat_new = status_new = False
        cat_raw = _clean(raw.get("category"))
        if not cat_raw:
            errs.append("category is required")
        else:
            category, cat_new = _resolve(cat_raw, known_cats, CATEGORY_ALIASES)

        status = None
        status_raw = _clean(raw.get("status"))
        if status_raw:
            status, status_new = _resolve(status_raw, known_stats, STATUS_ALIASES)

        data = {}
        for f in TEXT_FIELDS:
            v = _clean(raw.get(f))
            if v is not None:
                data[f] = v
        for f in DATE_FIELDS:
            try:
                d = _parse_date(raw.get(f))
                if d is not None:
                    data[f] = d
            except ValueError as e:
                errs.append(f"{f}: {e}")
        try:
            cost = _parse_cost(raw.get("purchase_cost"))
            if cost is not None:
                data["purchase_cost"] = cost
        except ValueError as e:
            errs.append(f"purchase_cost: {e}")
        try:
            months = _parse_months(raw.get("warranty_months"))
            if months is not None:
                data["warranty_months"] = months
        except ValueError as e:
            errs.append(f"warranty_months: {e}")

        if not errs and "warranty_expiry" not in data and "purchase_date" in data and data.get("warranty_months"):
            data["warranty_expiry"] = _add_months(data["purchase_date"], data["warranty_months"])

        assignee = _clean(raw.get("assigned_to"))
        if assignee:
            data["assigned_username"] = assignee
            user = by_email.get(assignee.lower()) or by_name.get(assignee.lower()) or by_local.get(assignee.lower())
            if user:  # link to a portal login when we can; otherwise just keep the name as text
                data["assigned_to_id"] = user.id

        if tag:
            if tag in seen:
                errs.append(f"duplicate asset_tag '{tag}' in this file (first on row {seen[tag]})")
            else:
                seen[tag] = rownum

        if errs:
            failed += 1
            if len(errors) < MAX_ERRORS_RETURNED:
                errors.append({"row": rownum, "asset_tag": tag, "message": "; ".join(errs)})
            continue

        if cat_new:
            new_categories.add(category)
        if status_new:
            new_statuses.add(status)

        data.update(asset_tag=tag, name=name, category=category)
        if status:
            data["status"] = status

        current = existing.get(tag)
        if current is None:
            created += 1
            if not dry_run:
                asset = Asset(**{"status": "In Stock", **data}, attributes=attrs or None)
                asset.history.append(AssetHistory(action="Asset created via bulk import", performed_by=performer))
                sync_allocation(db, asset, performer)
                db.add(asset)
                existing[tag] = asset
        elif on_duplicate == "update":
            changed = [f for f, new in data.items() if getattr(current, f) != new]
            merged_attrs = {**(current.attributes or {}), **attrs}
            if attrs and merged_attrs != (current.attributes or {}):
                changed.append("additional details")
            if changed:
                updated += 1
                if not dry_run:
                    for f in changed:
                        if f != "additional details":
                            setattr(current, f, data[f])
                    if "additional details" in changed:
                        current.attributes = merged_attrs
                    sync_allocation(db, current, performer)
                    current.history.append(
                        AssetHistory(action=f"Updated via bulk import: {', '.join(changed)}", performed_by=performer)
                    )
            else:
                skipped += 1
        else:
            skipped += 1

    if not dry_run:
        db.commit()

    return {
        "dry_run": dry_run,
        "total_rows": len(rows),
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "failed": failed,
        "errors": errors,
        "errors_truncated": failed > len(errors),
        "new_categories": sorted(new_categories, key=str.lower),
        "new_statuses": sorted(new_statuses, key=str.lower),
        "extra_columns": list(extra.values()),
    }


def migrate_audit_dates(db: Session) -> int:
    """Older versions kept "Last Audit" / "Next Audit Date" import columns as additional details.
    Move them into the real audit-date fields (once; safe to run on every start)."""
    moved = 0
    for asset in db.scalars(select(Asset)).all():
        if not asset.attributes:
            continue
        attrs = dict(asset.attributes)
        changed = False
        for key in list(attrs):
            field = ALIAS_LOOKUP.get(_norm_header(key))
            if field not in ("last_audited_on", "next_audit_date") or getattr(asset, field) is not None:
                continue
            try:
                value = _parse_date(attrs[key])
            except ValueError:
                continue  # leave unreadable values where they are
            if value is None:
                continue
            setattr(asset, field, value)
            del attrs[key]
            changed = True
            moved += 1
        if changed:
            asset.attributes = attrs or None
    db.commit()
    return moved
