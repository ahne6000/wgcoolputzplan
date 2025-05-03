from fastapi import APIRouter, Response, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
import os
import shutil

router = APIRouter()


DB_FILE_PATH = "putzplan.db"  # ggf. anpassen auf ./data/putzplan.db oder absoluter Pfad


@router.get("/export")
def export_db():
    """Ermöglicht den Download der aktuellen SQLite-Datenbank."""
    if os.path.exists(DB_FILE_PATH):
        return FileResponse(
            path=DB_FILE_PATH,
            filename="putzplan_backup.db",
            media_type="application/octet-stream"
        )
    raise HTTPException(status_code=404, detail="Database file not found")


@router.post("/import")
def import_db(
    file: UploadFile = File(...),
    confirm_1: bool = False,
    confirm_2: bool = False
):
    """
    Importiert eine neue SQLite-Datenbankdatei.
    Es muss zweimal bestätigt werden, um versehentliches Überschreiben zu vermeiden.
    """
    if not (confirm_1 and confirm_2):
        raise HTTPException(
            status_code=400,
            detail="Import abgebrochen. Du musst zweimal bestätigen (confirm_1=true & confirm_2=true)."
        )

    backup_path = f"{DB_FILE_PATH}.backup"

    # Sicherung der alten Datei
    if os.path.exists(DB_FILE_PATH):
        shutil.copy(DB_FILE_PATH, backup_path)

    # Neue Datei speichern
    with open(DB_FILE_PATH, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {"message": "Neue Datenbank importiert. Alte Version gesichert als .backup"}
