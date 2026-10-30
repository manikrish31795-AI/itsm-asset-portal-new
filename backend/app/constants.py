"""Shared constants for assets."""

CATEGORIES = ["Laptop", "Desktop", "Server", "Network", "Mobile", "Peripheral", "Software", "Other"]
STATUSES = ["In Use", "In Stock", "In Repair", "Retired", "Lost"]

# Order used for the import template and CSV export (export can be re-imported as-is).
ASSET_COLUMNS = [
    "asset_tag", "name", "category", "status", "company", "manufacturer", "model", "model_no", "serial_number",
    "hostname", "location", "department", "assigned_to", "employee_no", "manager", "job_title", "vendor",
    "order_number", "purchase_date", "purchase_cost", "warranty_months", "warranty_expiry", "eol_date",
    "allocated_date", "last_audited_on", "next_audit_date", "mac_address", "ip_address", "os", "processor",
    "ram", "storage", "notes",
]
