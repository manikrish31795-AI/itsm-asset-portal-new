# AssetDesk – ITSM Asset Portal

A ManageEngine-style IT asset management portal.

**Stack:** FastAPI + SQLAlchemy (SQLite by default) · React + Vite · JWT auth with roles

## Features

- **Asset inventory** – add / edit / delete assets with category, status, serial, location, department, vendor, purchase cost, warranty and assignment
- **Search, filters and pagination** across name, tag, serial, model, category and status
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
