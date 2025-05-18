from fastapi import APIRouter, Depends, HTTPException
from app.routes.tasks import get_next_active_user
from sqlmodel import Session, select
from app.database import get_session
from app.models import User, Task, AssignmentQueue
from app.schemas import UserRead, UserUpdate, UserCreate
from typing import Optional
from fastapi import UploadFile, File
import shutil, os

from app.utils.logging import log_task_action

router = APIRouter()

@router.get("/", response_model=list[UserRead])
def list_users(active: Optional[bool] = None, session: Session = Depends(get_session)):
    query = select(User)
    if active is not None:
        query = query.where(User.active == active)
    users = session.exec(query).all()
    return users

@router.patch("/{user_id}", response_model=UserRead)
def update_user(user_id: int, user_update: UserUpdate, session: Session = Depends(get_session)):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    update_data = user_update.dict(exclude_unset=True)

    # 🧠 Sonderlogik: Slot gesetzt → automatisch Slot-User
    #if "slot" in update_data and update_data["slot"] is not None:
    #    update_data["is_slot_user"] = True

    for key, value in update_data.items():
        setattr(user, key, value)

    session.commit()
    session.refresh(user)
    return user


@router.post("/{user_id}/upload-photo")
def upload_photo(user_id: int, file: UploadFile = File(...), session: Session = Depends(get_session)):
    filename = f"/var/www/putzplan/media/profiles/{user_id}.jpg"
    os.makedirs("/var/www/putzplan/media/profiles", exist_ok=True)
    
    with open(filename, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.profile_image_url = f"/var/www//putzplan/media/profiles/{user_id}.jpg"
    session.add(user)
    session.commit()
    log_task_action(session, 0, action="picture upload", user_id=user_id)
    session.commit()
    return {"message": "Foto gespeichert", "url": user.profile_image_url}

@router.post("/", response_model=UserRead)
def create_user(user: UserCreate, session: Session = Depends(get_session)):
    new_user = User(**user.dict())
    session.add(new_user)
    session.commit()
    session.refresh(new_user)
    log_task_action(session, 0, action="created user", user_id=None)
    session.commit()
    return new_user

@router.get("/{user_id}", response_model=UserRead)
def get_user(user_id: int, session: Session = Depends(get_session)):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@router.get("/{task_id}/next-recurring-user", response_model=dict)
def get_next_recurring_user(task_id: int, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.mode != "recurring":
        raise HTTPException(status_code=400, detail="Task is not recurring")

    # Holt den aktuellen User (falls vorhanden)
    current_user = session.get(User, task.user_id) if task.user_id else None

    # 👉 Verwende jetzt die zentrale Funktion, die alles berücksichtigt (inkl. Blacklist!)
    next_user = get_next_active_user(task, session)

    # Optional: Queue-Vorschau holen
    queue = session.exec(
        select(AssignmentQueue).where(AssignmentQueue.task_id == task_id)
    ).first()
    queue_preview = queue.user_queue[:10] if queue and queue.user_queue else []

    return {
        "task_id": task_id,
        "current_user": UserRead.model_validate(current_user) if current_user else None,
        "next_user": UserRead.model_validate(next_user) if next_user else None,
        "queue_preview": queue_preview
    }

