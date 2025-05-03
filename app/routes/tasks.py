from http.client import HTTPException
from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from datetime import datetime, timedelta
from app.models import Task, AssignmentQueue, User
from app.schemas import TaskCreate, TaskRead
from app.database import get_session
from app.utils.logging import log_task_action
import random


router = APIRouter()

# --- Hilfsfunktion ---
def calculate_urgency(task: Task):
    if not task.due_date or not task.default_duration_days:
        base = 0
    else:
        ratio = (task.due_date - datetime.utcnow()).days / task.default_duration_days
        base = 2 if ratio <= 0.2 else 1 if ratio <= 0.5 else 0

    score = base + (task.urgency_level or 0)
    if score >= 2:
        return "red"
    elif score == 1:
        return "yellow"
    else:
        return "green"

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
    return task




@router.get("/", response_model=list[TaskRead])
def list_tasks(session: Session = Depends(get_session)):
    tasks = session.exec(select(Task)).all()
    return tasks

@router.patch("/{task_id}/done", response_model=TaskRead)
def mark_done(task_id: int, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    if not task:
        return task

    task.last_completed_at = datetime.utcnow()
    task.last_done_by = task.user_id
    task.times_completed += 1
    if task.mode in ("recurring"):
        task.due_date = datetime.utcnow() + timedelta(days=task.default_duration_days)


    if task.mode == "one_time":
        task.is_done = True

    # reset dre Putzen flags 
    task.escalation_level = 0

    # ZUFALLS-ROTATION FÜR ASSIGNED-TASKS
    if task.task_type == "assigned":
        queue_entry = session.exec(
            select(AssignmentQueue).where(AssignmentQueue.task_id == task.id)
        ).first()

        if queue_entry and queue_entry.slot_queue:
            next_slot = queue_entry.slot_queue.pop(0)
            session.add(queue_entry)

            next_user = session.exec(
                select(User).where(User.slot == next_slot, User.active == True, User.is_slot_user == True)
            ).first()

            if next_user:
                task.user_id = next_user.id
                log_task_action(session, task.id, action=f"assigned_to_slot_{next_slot}", user_id=None)

        else:
            slot_users = session.exec(
                select(User).where(User.active == True, User.is_slot_user == True, User.slot != None)
            ).all()

            slot_ids = [u.slot for u in slot_users if u.slot != task.slot]
            random.shuffle(slot_ids)

            if slot_ids:
                next_slot = slot_ids[0]
                next_user = session.exec(
                    select(User).where(User.slot == next_slot)
                ).first()

                if next_user:
                    task.user_id = next_user.id
                    queue = AssignmentQueue(task_id=task.id, slot_queue=slot_ids[1:])
                    session.add(queue)
                    log_task_action(session, task.id, action=f"assigned_random_to_slot_{next_slot}", user_id=None)


    log_task_action(session, task.id, action="done", user_id=None)
    session.add(task)
    session.commit()
    session.refresh(task)
    return task



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

#    elif task.mode == "persistent":
#        task.last_completed_at = now
        # no due_date, no change to is_done

    log_task_action(session, task.id, action="reset", user_id=None)

    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.post("/{task_id}/vote-up")
def vote_up(task_id: int, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    if task:
        task.urgency_level = min((task.urgency_level or 0) + 1, 2)
        session.add(task)
        session.commit()
        log_task_action(session, task.id, action="voted_up", user_id=None)


    return {"urgency_level": task.urgency_level}

@router.post("/{task_id}/vote-down")
def vote_down(task_id: int, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    if task:
        task.urgency_level = max((task.urgency_level or 0) - 1, -2)
        session.add(task)
        session.commit()
        log_task_action(session, task.id, action="voted_down", user_id=None)


    return {"urgency_level": task.urgency_level}

@router.post("/{task_id}/vote-escalate")
def vote_escalate(task_id: int, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    if task:
        task.escalation_level += 1
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

    if direction == "up":
        task.urgency_votes += 1
    elif direction == "down" and task.urgency_votes > 0:
        task.urgency_level -= 1
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
    if task:
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

