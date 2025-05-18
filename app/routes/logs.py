from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from app.database import get_session
from app.models import TaskLog
from typing import Optional


router = APIRouter()


@router.get("/")
def list_logs(limit: Optional[int] = 1000, session: Session = Depends(get_session)):
    stmt = select(TaskLog).order_by(TaskLog.timestamp.desc())
    if limit:
        stmt = stmt.limit(limit)
    return session.exec(stmt).all()

