from fastapi import APIRouter, Depends, Form, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from ..models import LogEntry
from ..schemas import LogOut
from ..services import reverse as reverse_log, find_last_undoable_log, reverse_log_entry



router = APIRouter()

@router.get("/ShowLog", response_model=List[LogOut])
def show_log(db: Session = Depends(get_db)):
    logs = db.query(LogEntry).order_by(LogEntry.id.desc()).all()
    return logs

@router.post("/Reverse")
def reverse(log_id: int = Form(...), db: Session = Depends(get_db)):
    ok = reverse_log(db, int(log_id))
    if not ok:
        raise HTTPException(400, "Reverse not possible")
    return {"ok": True}

@router.post("/UndoLastRecent")
def undo_last_recent(window_sec: int = Query(60, ge=1, le=600), db: Session = Depends(get_db)):
    """
    Macht die letzte reversible Aktion innerhalb des Zeitfensters rückgängig.
    Standard: 60s.
    """
    entry = find_last_undoable_log(db, window_sec=window_sec)
    if not entry:
        raise HTTPException(404, "Keine rückgängig-machbare Aktion gefunden.")
    reverse_log_entry(db, entry)
    return {"ok": True, "undone_action": entry.action, "log_id": entry.id}
