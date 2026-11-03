"""Asset ID generation: <category letter>-<COMPANY>-<running number>, e.g. L-ESDS-0001 for a Laptop."""
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Asset, AssetIdSeries

COMPANY_CODE = "ESDS"
NUMBER_WIDTH = 4

# Fixed letters for the built-in categories. Any new category gets its first free letter(s) automatically.
DEFAULT_PREFIXES = {
    "laptop": "L", "desktop": "D", "mobile": "M", "network": "N", "server": "S",
    "software": "SW", "peripheral": "P", "other": "O",
}


def norm_text(v) -> str:
    return re.sub(r"\s+", " ", (v or "").strip()).lower()


def norm_mac(v) -> str:
    return re.sub(r"[^0-9a-f]", "", (v or "").lower())


def format_id(prefix: str, number: int) -> str:
    return f"{prefix}-{COMPANY_CODE}-{number:0{NUMBER_WIDTH}d}"


def _pick_prefix(db: Session, category: str) -> str:
    key = norm_text(category)
    if key in DEFAULT_PREFIXES:
        return DEFAULT_PREFIXES[key]
    taken = {p.upper() for p in db.scalars(select(AssetIdSeries.prefix)).all()} | {v for v in DEFAULT_PREFIXES.values()}
    letters = re.sub(r"[^A-Za-z0-9]", "", category).upper() or "X"
    for n in range(1, len(letters) + 1):
        if letters[:n] not in taken:
            return letters[:n]
    n = 2
    while f"{letters[:1]}{n}" in taken:
        n += 1
    return f"{letters[:1]}{n}"


def get_series(db: Session, category: str, create: bool = True):
    """Series row for a category (case-insensitive). Creates it the first time a category is used."""
    key = norm_text(category)
    series = db.scalar(select(AssetIdSeries).where(AssetIdSeries.category_key == key))
    if series or not create:
        return series
    prefix = _pick_prefix(db, category)
    series = AssetIdSeries(category_key=key, category=category.strip(), prefix=prefix, last_number=0)
    db.add(series)
    db.flush()
    return series


def _next_free_number(db: Session, series: AssetIdSeries) -> int:
    n = series.last_number + 1
    existing = set(db.scalars(select(Asset.asset_tag).where(Asset.asset_tag.like(f"{series.prefix}-{COMPANY_CODE}-%"))).all())
    while format_id(series.prefix, n) in existing:  # e.g. tags that came in through an import
        n += 1
    return n


def preview_id(db: Session, category: str) -> dict:
    series = get_series(db, category, create=False)
    prefix = series.prefix if series else (DEFAULT_PREFIXES.get(norm_text(category)) or _pick_prefix(db, category))
    n = _next_free_number(db, series) if series else 1
    if not series:
        existing = set(db.scalars(select(Asset.asset_tag).where(Asset.asset_tag.like(f"{prefix}-{COMPANY_CODE}-%"))).all())
        while format_id(prefix, n) in existing:
            n += 1
    return {"category": category.strip(), "prefix": prefix, "next_id": format_id(prefix, n)}


def allocate_id(db: Session, category: str) -> str:
    """Reserve the next number for the category. Caller commits."""
    series = get_series(db, category)
    n = _next_free_number(db, series)
    series.last_number = n
    return format_id(series.prefix, n)


def find_duplicates(db: Session, serial=None, mac=None, hostname=None) -> list[dict]:
    """Existing assets that already use this serial number, MAC address or hostname."""
    s, m, h = norm_text(serial), norm_mac(mac), norm_text(hostname)
    hits = []
    if not (s or m or h):
        return hits
    for a in db.scalars(select(Asset)).all():
        why = []
        if s and norm_text(a.serial_number) == s:
            why.append("serial number")
        if m and norm_mac(a.mac_address) == m:
            why.append("MAC address")
        if h and norm_text(a.hostname) == h:
            why.append("hostname")
        if why:
            hits.append({"id": a.id, "asset_tag": a.asset_tag, "name": a.name, "matches": why})
    return hits
