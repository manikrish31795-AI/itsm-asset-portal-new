import datetime as dt
import random
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, inspect, select, text

from .auth import hash_password
from .database import Base, SessionLocal, engine
from .models import Asset, AssetHistory, User
from .allocation_service import backfill_allocations
from .importer import migrate_audit_dates
from .routers import allocations, assets, audits, dashboard, imports, users


def seed():
    """Create default users and some demo assets on first run."""
    with SessionLocal() as db:
        if db.scalar(select(func.count(User.id))):
            return
        admin = User(email="admin@example.com", full_name="Admin User", role="admin",
                     password_hash=hash_password("Admin@123"))
        tech = User(email="tech@example.com", full_name="Tina Technician", role="technician",
                    password_hash=hash_password("Tech@123"))
        req = User(email="user@example.com", full_name="Ravi Requester", role="requester",
                   password_hash=hash_password("User@123"))
        db.add_all([admin, tech, req])
        db.flush()

        random.seed(7)
        catalog = [
            ("Laptop", "Dell", "Latitude 5440"), ("Laptop", "Lenovo", "ThinkPad T14"),
            ("Laptop", "HP", "EliteBook 840"), ("Desktop", "Dell", "OptiPlex 7010"),
            ("Server", "HPE", "ProLiant DL380"), ("Network", "Cisco", "Catalyst 9200"),
            ("Mobile", "Apple", "iPhone 15"), ("Peripheral", "Logitech", "MX Master 3"),
            ("Software", "Microsoft", "Office 365 E3"),
        ]
        locations = ["Chennai HQ", "Bengaluru", "Mumbai", "Remote"]
        statuses = ["In Use", "In Use", "In Use", "In Stock", "In Repair", "Retired"]
        today = dt.date.today()
        for i in range(1, 41):
            cat, make, model = random.choice(catalog)
            purchase = today - dt.timedelta(days=random.randint(30, 1400))
            warranty = purchase + dt.timedelta(days=random.choice([365, 730, 1095]))
            st = "In Use" if i % 6 == 0 else random.choice(statuses)
            a = Asset(
                asset_tag=f"AST-{i:04d}", name=f"{make} {model}", category=cat, status=st,
                manufacturer=make, model=model, serial_number=f"SN{random.randint(10**7, 10**8 - 1)}",
                location=random.choice(locations), department=random.choice(["IT", "Finance", "HR", "Sales"]),
                vendor="Acme Distributors", purchase_date=purchase, purchase_cost=random.randint(5, 150) * 1000.0,
                warranty_expiry=warranty, assigned_to_id=req.id if i % 6 == 0 else None,
            )
            a.history.append(AssetHistory(action="Asset created", performed_by="System seed"))
            db.add(a)
        db.commit()


def ensure_columns():
    """Tiny auto-migration: add columns introduced by newer versions to an existing database."""
    existing = {c["name"] for c in inspect(engine).get_columns("assets")}
    with engine.begin() as conn:
        for col in Asset.__table__.columns:
            if col.name not in existing:
                ctype = col.type.compile(dialect=engine.dialect)
                conn.execute(text(f'ALTER TABLE assets ADD COLUMN "{col.name}" {ctype}'))


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    ensure_columns()
    seed()
    with SessionLocal() as db:
        migrate_audit_dates(db)  # 'Last Audit' / 'Next Audit Date' columns imported by older versions
        backfill_allocations(db)  # existing assignments get a ledger entry
    yield


app = FastAPI(title="ITSM Asset Portal", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router)
app.include_router(imports.router)  # before assets: static paths must match before /{asset_id}
app.include_router(assets.router)
app.include_router(allocations.router)
app.include_router(audits.router)
app.include_router(dashboard.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
