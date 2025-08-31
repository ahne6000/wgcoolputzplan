from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

SQLALCHEMY_DATABASE_URL = "sqlite:///./putzplan.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Tabellen anlegen (falls fehlen)
Base.metadata.create_all(bind=engine)

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def ensure_schema():
    with engine.begin() as conn:
        # existiert die Tabelle überhaupt?
        has_tasks = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'")
        ).first() is not None
        if not has_tasks:
            # Noch keine tasks-Tabelle -> nichts zu migrieren (frische DB)
            return

        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(tasks)"))]
        if 'archived' not in cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN archived BOOLEAN NOT NULL DEFAULT 0"))
        if 'archived_at' not in cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN archived_at DATETIME NULL"))

# erst anlegen, dann migrieren
ensure_schema()
