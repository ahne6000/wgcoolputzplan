from http.client import HTTPException
from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from datetime import datetime, timedelta
from app.models import Task, AssignmentQueue, TaskVersion, User
from app.schemas import TaskCreate, TaskRead, TaskUpdate
from app.database import get_session
from app.utils.logging import auto_serialize, log_task_action, log_task_version_auto
from typing import List, Optional
from sqlalchemy.orm.attributes import flag_modified
import random

from app.utils.undo import apply_task_version



router = APIRouter()

def calculate_remaining_days(task: Task) -> int:
    days_since_last_done = (datetime.utcnow().date() - task.last_completed_at.date()).days if task.last_completed_at else 0
    return max(task.default_duration_days + task.duration_modifier - days_since_last_done, 0)

def calculate_urgency_class(task: Task, remaining_days: int) -> str:
    # Immer rot, wenn Eskalation aktiv ist
    if task.escalation_level >= 1:
        return 'red'

    # Wenn keine Dauer definiert ist (zur Sicherheit)
    if not task.default_duration_days or task.default_duration_days == 0:
        return 'green'  # fallback: keine Info = unkritisch

    # Berechne den Prozentsatz
    percentage_left = (remaining_days / task.default_duration_days) * 100

    if percentage_left < 15:
        return 'red'
    elif percentage_left < 40:
        return 'yellow'
    else:
        return 'green'

def get_next_active_user(task: Task, session: Session) -> Optional[User]:
    queue = session.exec(select(AssignmentQueue).where(AssignmentQueue.task_id == task.id)).first()
    if not queue or not queue.user_queue:
        return None

    queue_list = queue.user_queue
    current_user_id = task.user_id

    try:
        current_index = queue_list.index(current_user_id)
    except ValueError:
        return None  # Aktueller User nicht in der Queue

    for offset in range(1, len(queue_list) + 1):
        next_index = (current_index + offset) % len(queue_list)
        next_user_id = queue_list[next_index]
        potential_user = session.get(User, next_user_id)

        if (potential_user and potential_user.active and
            not task.is_user_blacklisted(next_user_id)):
            return potential_user

    return None


# --- Routen ---
@router.post("/", response_model=TaskRead)
def create_task(task_data: TaskCreate, session: Session = Depends(get_session)):
    task = Task(**task_data.dict())
    session.add(task)
    session.commit()
    session.refresh(task)

    #Queue erstellen mit 100 Einträgen egal ob aktiv oder nicht 
    # Erzeuge eine Liste von 1 bis 100
    user_ids = list(range(1, 101))
    random.shuffle(user_ids)

    queue_list = user_ids  # genau 100 IDs, alle einmal, randomisiert

    queue = AssignmentQueue(task_id=task.id, user_queue=queue_list)
    session.add(queue)
    session.commit()

    log_task_action(session, task.id, action="created", user_id=None)


    remaining_days = calculate_remaining_days(task)
    urgency_class = calculate_urgency_class(task, remaining_days)
    task_data = task.dict()
    task_data["remaining_days"] = remaining_days
    task_data["urgency_class"] = urgency_class

    return task_data


@router.get("/", response_model=List[TaskRead])
def list_tasks(session: Session = Depends(get_session)):
    tasks = session.exec(select(Task)).all()

    tasks_with_remaining = []
    for task in tasks:
        remaining_days = calculate_remaining_days(task)
        urgency_class = calculate_urgency_class(task, remaining_days)
        task_data = task.dict()
        task_data["remaining_days"] = remaining_days
        task_data["urgency_class"] = urgency_class
        tasks_with_remaining.append(task_data)

    return tasks_with_remaining


@router.patch("/{task_id}/done", response_model=TaskRead)
def mark_done(task_id: int, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    log_task_version_auto(task, session, action="mark_done", user_id=task.user_id)

    # Update task properties
    task.last_completed_at = datetime.utcnow()
    task.last_done_by = task.user_id
    task.times_completed += 1

    if task.mode == "recurring":
        task.due_date = datetime.utcnow() + timedelta(days=task.default_duration_days)
    elif task.mode == "one_time":
        task.is_done = True

    # Reset Flags
    task.escalation_level = 0
    task.duration_modifier = 0

    # Assign next user for 'assigned' tasks
    if task.task_type == "assigned":
        if task.user_id is None:
            log_task_action(session, task.id, action="no_current_user_set_cannot_assign_next", user_id=None)
        else:
            next_user = get_next_active_user(task, session)
            if next_user:
                task.user_id = next_user.id
                log_task_action(session, task.id, action=f"assigned_to_{next_user.id}", user_id=None)
            else:
                log_task_action(session, task.id, action="no_next_active_user_found", user_id=None)

    log_task_action(session, task.id, action="done", user_id=None)
    session.add(task)
    session.commit()
    session.refresh(task)

    remaining_days = calculate_remaining_days(task)
    urgency_class = calculate_urgency_class(task, remaining_days)
    task_data = task.dict()
    task_data["remaining_days"] = remaining_days
    task_data["urgency_class"] = urgency_class

    return task_data


@router.patch("/{task_id}/reset")
def reset_task(task_id: int, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    if not task:
        return {"error": "Task not found"}

    now = datetime.utcnow()

    if task.mode == "one_time": 
        return {"error": "Cannot reset one-time tasks."}

    elif task.mode == "recurring":
        task.due_date = now + timedelta(days=task.default_duration_days)
        task.last_completed_at = now
        task.is_done = False  # optional, kannst du auch weglassen


    log_task_action(session, task.id, action="reset", user_id=None)

    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.post("/{task_id}/vote-escalate")
def vote_escalate(task_id: int, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    log_task_version_auto(task, session, action="vote_putzen", user_id=task.user_id)
    if task:
        task.escalation_level += 1
        if task.escalation_level > 2:task.escalation_level=2
        session.add(task)
        log_task_action(session, task.id, action="escalated", user_id=None)
        session.commit()
        session.refresh(task)
    


    return task

@router.patch("/{task_id}/vote-urgency")
def vote_urgency(task_id: int, direction: str, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # ✅ Vor der Änderung: Zustand loggen
    log_task_version_auto(task, session, action="modify_remaining_days", user_id=task.user_id)

    # 🔧 Änderung durchführen
    if direction == "up":
        task.duration_modifier -= 1
    elif direction == "down":
        task.duration_modifier += 1
    else:
        raise HTTPException(status_code=400, detail="Invalid direction")

    session.add(task)
    session.commit()

    log_task_action(session, task.id, action=f"urgency_{direction}", user_id=None)
    return task



@router.delete("/{task_id}")
def delete_task(task_id: int, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    if task:
        log_task_action(session, task.id, action="deleted", user_id=None)
        session.delete(task)
        session.commit()
    return {"message": f"Task {task_id} gelöscht"}


@router.post("/{task_id}/assign/{user_id}")
def assign_task(task_id: int, user_id: int, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # ✅ Zustand vorher loggen (user_id ist noch der "alte")
    log_task_version_auto(task, session, action="assign_user", user_id=task.user_id)

    # 🔧 Jetzt erst Änderung durchführen
    task.user_id = user_id
    session.add(task)

    log_task_action(session, task.id, action=f"assigned_to_{user_id}", user_id=None)
    session.commit()
    session.refresh(task)
    return task


@router.get("/queue/{task_id}")
def get_assignment_queue(task_id: int, session: Session = Depends(get_session)):
    queue = session.exec(select(AssignmentQueue).where(AssignmentQueue.task_id == task_id)).first()
    if not queue:
        raise HTTPException(status_code=404, detail="Queue not found")

    return {"task_id": task_id, "slot_queue": queue.user_queue}

@router.patch("/queue/{task_id}/shuffle")
def shuffle_assignment_queue(task_id: int, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=400, detail="Invalid task")

    # IDs von 1 bis 100
    user_ids = list(range(1, 101))
    random.shuffle(user_ids)

    queue = session.exec(
        select(AssignmentQueue).where(AssignmentQueue.task_id == task_id)
    ).first()

    if queue:
        queue.user_queue = user_ids  # ✅ neu!
    else:
        queue = AssignmentQueue(task_id=task_id, user_queue=user_ids)
        session.add(queue)

    session.commit()

    log_task_action(session, task.id, action="queue_shuffled", user_id=None)
    return {"task_id": task_id, "new_queue": user_ids}


@router.get("/queue/{task_id}/active")
def get_active_assignment_queue(task_id: int, session: Session = Depends(get_session)):
    queue = session.exec(select(AssignmentQueue).where(AssignmentQueue.task_id == task_id)).first()
    if not queue:
        raise HTTPException(status_code=404, detail="Queue not found")

    active_users = session.exec(select(User).where(User.active == True)).all()
    active_user_ids = {u.id for u in active_users}

    filtered_queue = [user_id for user_id in queue.user_queue if user_id in active_user_ids]

    return {
        "task_id": task_id,
        "active_user_queue": filtered_queue,
        "active_user_count": len(filtered_queue)
    }


@router.get("/queue/{task_id}/active-filtered")
def get_filtered_assignment_queue(task_id: int, session: Session = Depends(get_session)):
    queue = session.exec(select(AssignmentQueue).where(AssignmentQueue.task_id == task_id)).first()
    if not queue:
        raise HTTPException(status_code=404, detail="Queue not found")

    active_users = session.exec(select(User).where(User.active == True)).all()
    active_user_ids = {u.id for u in active_users}

    task = session.get(Task, task_id)
    blacklist = task.blacklist or []

    filtered_queue = [
        user_id for user_id in queue.user_queue
        if user_id in active_user_ids and user_id not in blacklist
    ]

    return {
        "task_id": task_id,
        "active_user_queue": filtered_queue,
        "active_user_count": len(filtered_queue)
    }


@router.patch("/{task_id}", response_model=TaskRead)
def update_task(task_id: int, task_update: TaskUpdate, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    log_task_version_auto(task, session, action="update_task", user_id=task.user_id)

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    update_data = task_update.dict(exclude_unset=True)

    for key, value in update_data.items():
        setattr(task, key, value)

    session.add(task)
    session.commit()
    session.refresh(task)

    log_task_action(session, task.id, action="updated", user_id=None)
    return task

@router.post("/{task_id}/blacklist/{user_id}")
def add_to_blacklist(task_id: int, user_id: int, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.add_to_blacklist(user_id)
    flag_modified(task, "blacklist") 
    session.add(task)
    session.commit()
    return {"message": f"User {user_id} added to blacklist"}


@router.delete("/{task_id}/blacklist/{user_id}")
def remove_from_blacklist(task_id: int, user_id: int, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.remove_from_blacklist(user_id)
    flag_modified(task, "blacklist") 
    session.add(task)
    session.commit()
    return {"message": f"User {user_id} removed from blacklist"}


@router.post("/undo/{task_id}")
def undo_task(task_id: int, session: Session = Depends(get_session)):
    stmt = (
        select(TaskVersion)
        .where(TaskVersion.task_id == task_id)
        .order_by(TaskVersion.version.desc())
    )
    latest_version = session.exec(stmt).first()

    if not latest_version:
        raise HTTPException(status_code=404, detail="No versions found to undo")

    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    apply_task_version(task, latest_version, session)

    return {"message": "Task undone successfully"}


@router.get("/tasks/versions/", response_model=List[TaskVersion])
def get_all_task_versions(session: Session = Depends(get_session)):
    # Query all task versions, ordered by task_id and version
    stmt = select(TaskVersion).order_by(TaskVersion.task_id, TaskVersion.version)
    task_versions = session.exec(stmt).all()
    return task_versions

@router.get("/versions/{task_id}", response_model=List[TaskVersion])
def get_recent_task_versions(task_id: int, session: Session = Depends(get_session)):
    stmt = (
        select(TaskVersion)
        .where(TaskVersion.task_id == task_id)
        .order_by(TaskVersion.timestamp.desc())
        .limit(3)
    )
    versions = session.exec(stmt).all()
    return versions

