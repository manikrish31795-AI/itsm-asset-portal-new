import csv
import io

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..auth import require_roles
from ..database import get_db
from ..importer import ImportFileError, TEMPLATE_COLUMNS, read_table, run_import
from ..models import User

# NOTE: this router must be registered BEFORE the assets router so that
# /api/assets/import-template.csv is not captured by /api/assets/{asset_id}.
router = APIRouter(prefix="/api/assets", tags=["bulk import"])

SAMPLE = {
    "asset_tag": "AST-1001", "name": "Dell Latitude 5440", "category": "Laptop", "status": "In Use",
    "company": "Acme Pvt Ltd", "manufacturer": "Dell", "model": "Latitude 5440", "model_no": "5440",
    "serial_number": "SN12345678", "hostname": "CHN-LT-1001", "location": "Chennai HQ", "department": "IT",
    "assigned_to": "user@example.com", "employee_no": "E1001", "manager": "Priya Nair", "job_title": "Engineer",
    "vendor": "Acme Distributors", "order_number": "PO-2025-014", "purchase_date": "2025-01-15",
    "purchase_cost": "85000", "warranty_months": "36", "warranty_expiry": "", "eol_date": "2029-01-15",
    "allocated_date": "2025-01-20", "mac_address": "AA:BB:CC:DD:EE:FF", "ip_address": "10.0.0.25",
    "os": "Windows 11 Pro", "processor": "Intel i7", "ram": "16 GB", "storage": "512 GB SSD",
    "notes": "Sample row - delete me",
}


@router.get("/import-template.csv")
def import_template(_: User = Depends(require_roles("admin", "technician"))):
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(TEMPLATE_COLUMNS)
    writer.writerow([SAMPLE.get(c, "") for c in TEMPLATE_COLUMNS])
    return Response(
        buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=asset-import-template.csv"},
    )


@router.post("/import")
async def import_assets(
    file: UploadFile = File(...),
    on_duplicate: str = Query("skip", pattern="^(skip|update)$"),
    dry_run: bool = Query(False),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "technician")),
):
    content = await file.read()
    try:
        spec, rows = read_table(file.filename or "", content)
    except ImportFileError as e:
        raise HTTPException(400, str(e))
    return run_import(db, spec, rows, on_duplicate, dry_run, user.full_name)
