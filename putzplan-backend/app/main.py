from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from .database import Base, engine
from .routes import users, tasks, assignments, logs, swaps

# DB-Tabellen erstellen
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Putzplan API")

# CORS (lokales Frontend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # bei Bedarf einschränken
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static für Uploads
Path("static/uploads").mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory="static/uploads"), name="uploads")

# Routen registrieren
app.include_router(users.router)
app.include_router(tasks.router)
app.include_router(assignments.router)
app.include_router(logs.router)
app.include_router(swaps.router)

@app.get("/")
def root():
    return {"ok": True, "service": "putzplan-backend"}
