# app/routes/cooking.py
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Form, Query
from sqlalchemy.orm import Session
from datetime import datetime

from ..database import get_db
from ..models import CookingEvent, User
from ..schemas import CookingEventOut
from ..services import utcnow_naive
try:
    from ..services import log  # falls du Logging hast
except Exception:
    def log(*args, **kwargs):
        return None

router = APIRouter()

@router.post("/CookAdd", response_model=CookingEventOut)
def cook_add(
    cooker_user_id: int = Form(...),
    eater_user_ids: List[int] = Form(default=[]),   # mehrere Form-Keys "eater_user_ids"
    title: Optional[str] = Form(None),
    cooked_at: Optional[str] = Form(None),          # ISO-String optional
    credits: Optional[int] = Form(None),            # optional override
    db: Session = Depends(get_db)
):
    cooker = db.query(User).get(int(cooker_user_id))
    if not cooker:
        raise HTTPException(404, "Koch-User nicht gefunden")

    # Zeit
    when = utcnow_naive()
    if cooked_at:
        try:
            when = datetime.fromisoformat(cooked_at.replace("Z", "+00:00")).replace(tzinfo=None)
        except Exception:
            raise HTTPException(400, "Ungültiges cooked_at-Format (ISO erwartet)")

    # Credits-Regel (MVP): auto = 2 Punkte pro Mitesser, mindestens 2
    event_credits = int(credits) if credits is not None else max(2, 2 * len(eater_user_ids))

    ev = CookingEvent(
        cooker_user_id=int(cooker_user_id),
        eater_user_ids=list(map(int, eater_user_ids or [])),
        title=title,
        cooked_at=when,
        credits_awarded=event_credits,
    )
    db.add(ev)

    # Credits dem Koch gutschreiben
    cooker.credits = int(cooker.credits or 0) + event_credits

    db.commit()
    db.refresh(ev)

    log(db, "COOK_ADD", actor_user_id=int(cooker_user_id),
        details={"event_id": ev.id, "eaters": ev.eater_user_ids, "title": title, "credits": event_credits})

    return ev

@router.get("/ListCookingEvents", response_model=List[CookingEventOut])
def list_cooking_events(
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db)
):
    rows = db.query(CookingEvent).order_by(CookingEvent.cooked_at.desc()).limit(limit).all()
    return rows

@router.post("/DeleteCookingEvent")
def delete_cooking_event(
    event_id: int = Form(...),
    db: Session = Depends(get_db)
):
    ev = db.query(CookingEvent).get(int(event_id))
    if not ev:
        return {"ok": True}
    cooker = db.query(User).get(int(ev.cooker_user_id))
    if cooker:
        cooker.credits = int(cooker.credits or 0) - int(ev.credits_awarded or 0)
    db.delete(ev)
    db.commit()
    log(db, "COOK_DELETE", actor_user_id=int(ev.cooker_user_id) if cooker else None, details={"event_id": event_id})
    return {"ok": True}
