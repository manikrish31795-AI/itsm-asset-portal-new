# AssetDesk – ITSM Asset Portal

A ManageEngine-style IT asset management portal.

**Stack:** FastAPI + SQLAlchemy (SQLite by default) · React + Vite · JWT auth with roles

## Features

- **Asset inventory** – add / edit / delete assets with category, status, serial, location, department, vendor, purchase cost, warranty and assignment
- **Search, filters and pagination** across name, tag, serial, model, category and status. A separate **Employee ID** box finds every asset held by that employee (partial IDs work, upper/lower case doesn't matter) and the Assets list shows an Employee ID column; Employee ID is also searchable in Audit, Alerts, Labels and Allocation
- **Audit history** – every field change is recorded per asset
- **Dashboard** – totals, purchase value, warranty expiring/expired, breakdown by category / status / location
- **CSV export** of the filtered asset list
- **Bulk import** from CSV or Excel (.xlsx) – download the template, upload your file, review a preview (nothing is saved yet), then confirm. Handles common column names ("Serial No", "Cost", "Owner"…), `DD/MM/YYYY` or `YYYY-MM-DD` dates, existing-tag handling (skip or update) and row-by-row error messages
- **Rich asset records** – company, model no., hostname, MAC / IP, OS, processor, RAM, storage, employee no., manager, order number, warranty months (expiry is calculated), EOL date and more. Any other column in an import (Antivirus, SwitchPort, Printer Type, …) is stored as an **additional detail** on the asset, and new categories/statuses are created automatically
- Existing databases are upgraded automatically on startup (new columns are added; no data is lost)
- **Allocation tab** (admin / technician) – see who holds what and manage it:
  - **By user:** pick a person to see their assets, allocate more (several at once, to a portal user or to any employee by name), return one or many (e.g. when someone leaves) with the status the asset gets back (In Stock / In Repair / Retired / Lost), and print a **handover form** for signature
  - **Allocation history:** every allocation and return with dates and who did it, searchable, filterable and exportable to CSV; each asset page also shows its own allocation history
  - Assets that are already assigned (from earlier versions, imports, or edited on the asset form) are kept in step with the allocation records automatically; assets that are In Repair, Retired or Lost can't be handed out
- **Location filter** – the Assets tab has a Location dropdown (with asset counts, plus "No location"). Spelling/case variants such as "mumbai " and "Mumbai" are treated as one place. Dashboard location bars link straight to the filtered list, and the asset form suggests existing locations
- **Asset audit tab** (admin / technician) – physical verification:
  - **Start an audit** for one or more locations and/or categories (optional due date); the portal snapshots what each asset should be and where
  - **Check assets** by scanning / typing the asset tag or serial number (barcode scanners work as a keyboard), or with Found / Missing buttons, bulk select, and a details dialog (found at a different location, condition Good / Damaged / Needs repair, notes). An asset scanned that isn't on the list is added and flagged
  - **Progress** overall and per location; filter by result, location, category
  - **Close the audit**: verified assets get a "last audited" date, you choose whether unchecked assets stay as they are or become missing, whether assets found elsewhere get their location updated, and whether missing assets are marked Lost. A summary is kept and the full report exports to CSV
  - Each asset page shows its last audit date and audit history; imports understand "Last Audit" / "Next Audit Date" columns
- **Asset ID tab** (admin / technician) – when an asset is purchased, enter its details and the asset ID is created automatically from the category: Laptop → `L-ESDS-0001`, Desktop → `D-ESDS-0001`, Mobile → `M-`, Server → `S-`, Network → `N-`, Peripheral → `P-`, Software → `SW-`, Other → `O-`. A new category gets its own letter automatically. Numbers run on per category and are never re-used. The asset is saved in the inventory as **In Stock**. A serial number, MAC address or hostname that already exists is refused (and warned about as you type), so the same asset can't be registered twice. After saving, the purchase details stay in the form so you can enter the next unit of the same order. Change the company code in `backend/app/asset_ids.py` (`COMPANY_CODE`)
- **Labels tab** (admin / technician) – print QR-code or barcode labels for assets. Filter and tick assets (or "select all matching"), choose the label size (50×25 mm roll, 75×50 mm roll, A4 sheet 3×8 or 4×10), show/hide company name, asset name and location, set copies, and print. The code contains the asset ID, so scanning a label in an **Audit** marks the asset found. "Print label" buttons are also on the asset page and in the Asset ID tab (right after creating an ID, or for all recently created IDs). When printing set Scale = 100% and Margins = None
- **Alerts & reminders** (admin / technician) – the **Alerts** tab lists what needs action: warranties expiring (30 / 60 / 90 / 180 / 365 days ahead), warranties already expired, end-of-life dates, assets whose next audit date is due or passed, and open audits past their due date. Filter by category / location, search, and export each list to CSV. A red count badge sits on the menu item and a "Needs attention" panel is on the Dashboard (tiles link straight to the list). Retired and Lost assets are ignored. Fill the "Next Audit Date", "Warranty Expires" and "EOL" columns when importing to get the most from this
- **Employees tab** (admin / technician) – type an **Employee ID** or name to see everything that person holds on one page (details, assets held now, previously held assets), and print a **handover form**. The Employee ID on an asset page links here
- **Exit clearance** – from the employee page click *Start exit clearance* (reason, last working day). A checklist lists every asset the person holds; mark each one **Returned** (choose the status it gets back: In Stock / In Repair / Retired, and its condition) or **Not returned**. Nothing changes in the asset records until you click *Complete clearance*; then returned assets leave the employee and get their new status. Assets not returned can stay with the employee (certificate says **NOT CLEARED**) or be written off as **Lost**. Print the **clearance certificate** with signature lines for the employee, IT and HR. All clearances are listed under *Exit clearances*, and both that list and *Find employee* can be filtered by **location** (and searched by Employee ID)
- **Licences tab** (admin / technician) – track software licences: name, publisher, type (subscription, perpetual, per user, per device …), **licence key** (hidden until you click Show; never in lists or CSV), **seats bought**, supplier, order number, cost and **renewal date**. Give a seat to a **person** (pick from employees by Employee ID or name) or to a **device** (asset); the portal blocks a second seat for the same person/device and refuses when no seats are free, and shows seats in use against seats bought with history of who had each seat. Filter by type or status (seats available, all seats used, renewing within 60 days, expired, retired) and export to CSV. Renewals due appear in **Alerts**, on the Dashboard and in the menu badge. A person's seats are freed automatically when their **exit clearance** is completed, and an asset's seats are freed when the asset is deleted. Keys are stored as plain text in the database, so restrict access to the database/server
- **Reports**: asset summaries by location, category, age of asset and purchase cost (count, in use / in stock / in repair, total and average cost, average age), a location × category grid, filters for location, category and active-only / all assets, CSV export of each report or of the full asset list, and a print view
- **Roles** – `admin` (everything), `technician` (manage assets, view dashboard), `requester` (sees only assets assigned to them)
- **User management** (admin) – create users, change roles, deactivate

## Run it

### 1. Backend (port 8000)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export SECRET_KEY="a-long-random-string"   # Windows: set SECRET_KEY=...
uvicorn app.main:app --reload
```

API docs: http://localhost:8000/docs
On first start the database `itsm.db` is created and seeded with demo users and 40 demo assets.

### 2. Frontend (port 5173)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

### Demo logins

| Role        | Email              | Password  |
|-------------|--------------------|-----------|
| Admin       | admin@example.com  | Admin@123 |
| Technician  | tech@example.com   | Tech@123  |
| Requester   | user@example.com   | User@123  |

**Change these passwords and set `SECRET_KEY` before any real use.**

## Project layout

```
backend/app
  main.py          app, CORS, startup seed
  database.py      engine/session (change DATABASE_URL for PostgreSQL)
  models.py        User, Asset, AssetHistory
  schemas.py       Pydantic request/response models
  auth.py          password hashing, JWT, role guards
  routers/         users.py, assets.py, dashboard.py
frontend/src
  api.js, auth.jsx, App.jsx
  pages/           Login, Dashboard, Assets, AssetForm, AssetDetail, Users
```

## Next modules to add (to get closer to ServiceDesk Plus)

1. **Incident / service-request tickets** – `Ticket` model with priority, SLA due date, assignee, status workflow, comments; link tickets to assets.
2. **Asset discovery** – agent or script (WMI / SNMP / osquery) posting hardware and software inventory to a `POST /api/assets/discovery` endpoint.
3. **Software licenses** – license model with seat counts, expiry, compliance view.
4. **Contracts and vendors** – AMC / lease tracking with renewal reminders.
5. **Email alerts** – scheduled job (APScheduler / Celery) for warranty and license expiry.
6. **Barcode / QR labels** – generate asset-tag labels, scan from mobile.
7. **Production hardening** – PostgreSQL + Alembic migrations, HTTPS, rate-limited login, Docker Compose.
