from fastapi import APIRouter, Depends, Form, HTTPException
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from ..models import LogEntry
from ..schemas import LogOut
from ..services import reverse as reverse_log

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
