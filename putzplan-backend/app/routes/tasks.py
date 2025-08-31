from fastapi import APIRouter, Depends, HTTPException, Form, Query
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime, timedelta, timezone
from ..database import get_db
from ..models import Task, TaskType, TaskAssignment, AssignmentStatus
from ..schemas import TaskCreate, TaskEdit, TaskOut
from ..services import (
    compute_next_assignee_user_id,
    compute_rest_days,
    utcnow_naive,
    create_pending_assignment,
    archive_task as archive_task_core
)


router = APIRouter()

@router.get("/ListAllTasks", response_model=List[TaskOut])
def list_all_tasks(include_archived: bool = Query(False), db: Session = Depends(get_db)):
    q = db.query(Task)
    if not include_archived:
        q = q.filter(Task.archived == False)
    tasks = q.order_by(Task.id.asc()).all()
    out = []
    for t in tasks:
        d = TaskOut.model_validate(t).model_dump()
        d["next_assignee_user_id"] = compute_next_assignee_user_id(db, t)
        d["rest_days"] = compute_rest_days(t)
        out.append(TaskOut(**d))
    return out


@router.get("/Task/{task_id}", response_model=TaskOut)
def get_task(task_id: int, db: Session = Depends(get_db)):
    t = db.query(Task).get(task_id)
    if not t: raise HTTPException(404, "Task not found")
    d = TaskOut.from_orm(t).dict()
    d["next_assignee_user_id"] = compute_next_assignee_user_id(db, t)
    d["rest_days"] = compute_rest_days(t)
    return TaskOut(**d)

@router.post("/CreateTask", response_model=TaskOut)
def create_task(data: TaskCreate, db: Session = Depends(get_db)):
    # Fälligkeit initial bestimmen:
    # ONE_OFF ohne angegebenes Intervall → Standard 7 Tage
    interval = data.interval_days
    first_due = None

    if interval and interval > 0:
        # Standard: jetzt + Intervall
        first_due = utcnow_naive() + timedelta(days=int(interval))
    elif data.task_type == TaskType.RECURRING_UNASSIGNED:
        # Wenn kein Intervall gesetzt: sofort (besser wäre: Intervall required machen)
        first_due = utcnow_naive()
    # else: bleibt None (z. B. ROTATING ohne Intervall)


    # Task anlegen
    task = Task(
        title=data.title.strip(),
        description=(data.description or None),
        task_type=data.task_type,
        interval_days=interval,
        points=data.points or 1,
        rotation_user_ids=data.rotation_user_ids if data.task_type == TaskType.ROTATING else None,
        next_due_at=first_due
    )

    if task.task_type == TaskType.ONE_OFF and (task.interval_days or 0) > 0 and not first_due:
        first_due = utcnow_naive() + timedelta(days=int(task.interval_days))
        task.next_due_at = first_due

    db.add(task)
    db.commit()
    db.refresh(task)

    # Initiale Pending-Assignment je nach Typ:
    if task.task_type == TaskType.RECURRING_UNASSIGNED:
        # sofort aktiv: unassigned pending
        due = task.next_due_at or utcnow_naive()
        create_pending_assignment(db, task, user_id=None, due_at=due)

    elif task.task_type == TaskType.ROTATING and task.rotation_user_ids:
        # erstes Assignment an den ersten in der Rotation
        first_uid = int(task.rotation_user_ids[0])
        due = task.next_due_at or utcnow_naive()
        create_pending_assignment(db, task, user_id=first_uid, due_at=due)

    elif task.task_type == TaskType.ONE_OFF:
        # einmalig, claimbar; falls Intervall gesetzt wurde, haben wir next_due_at
        create_pending_assignment(db, task, user_id=None, due_at=task.next_due_at)

    else:
        # sonstiger Fall (z. B. ROTATING ohne Liste): claimbar, ohne Fälligkeitsdatum
        create_pending_assignment(db, task, user_id=None, due_at=None)

    # Response anreichern
    d = TaskOut.from_orm(task).dict() if hasattr(TaskOut, "from_orm") else TaskOut.model_validate(task).model_dump()
    d["next_assignee_user_id"] = compute_next_assignee_user_id(db, task)
    d["rest_days"] = compute_rest_days(task)
    return TaskOut(**d)

@router.patch("/EditTask")
def edit_task(data: TaskEdit, db: Session = Depends(get_db)):
    t = db.query(Task).get(data.id)
    if not t: raise HTTPException(404, "Task not found")
    if data.title is not None: t.title = data.title
    if data.description is not None: t.description = data.description
    if data.interval_days is not None: t.interval_days = data.interval_days
    if data.points is not None: t.points = data.points
    if data.rotation_user_ids is not None: t.rotation_user_ids = data.rotation_user_ids
    db.commit()
    return {"ok": True}

@router.post("/VoteTaskUrgencyUp_do")
def vote_up(task_id: int = Form(...), user_id: int = Form(...), db: Session = Depends(get_db)):
    from ..services import log
    t = db.query(Task).get(int(task_id))
    if not t: raise HTTPException(404, "Task not found")
    t.urgency_score += 1
    db.commit()
    log(db, "URG_UP", actor_user_id=int(user_id), details={"task_id": t.id, "delta": +1}, undo_data={"task_id": t.id, "delta_was": +1})
    return {"ok": True, "urgency": t.urgency_score}

@router.post("/VoteTaskUrgencyDown_do")
def vote_down(task_id: int = Form(...), user_id: int = Form(...), db: Session = Depends(get_db)):
    from ..services import log
    t = db.query(Task).get(int(task_id))
    if not t: raise HTTPException(404, "Task not found")
    t.urgency_score -= 1
    db.commit()
    log(db, "URG_DOWN", actor_user_id=int(user_id), details={"task_id": t.id, "delta": -1}, undo_data={"task_id": t.id, "delta_was": -1})
    return {"ok": True, "urgency": t.urgency_score}

@router.post("/ArchiveTask")
def archive_task(task_id: int = Form(...), db: Session = Depends(get_db)):
    t = db.query(Task).get(int(task_id))
    if not t:
        raise HTTPException(404, "Task not found")
    archive_task_core(db, t)   # ← ruft die Service-Logik
    db.commit()
    return {"ok": True}

@router.post("/UnarchiveTask")
def unarchive_task(task_id: int = Form(...), db: Session = Depends(get_db)):
    t = db.query(Task).get(int(task_id))
    if not t: raise HTTPException(404, "Task not found")
    t.archived = False
    t.archived_at = None
    t.urgency_score = 0  # beim Reaktivieren Dringlichkeit zurücksetzen

    # Nach dem Reaktivieren: wieder in einen zuweisbaren Zustand bringen,
    # falls kein Pending existiert.
    from ..services import (
        utcnow_naive,
        get_pending_assignments,
        plan_next_due_for_task,
        create_pending_assignment,
        peek_next_rotating_user,
        is_one_off,
    )
    pendings = get_pending_assignments(db, t.id)
    if not pendings:
        if t.task_type == TaskType.RECURRING_UNASSIGNED:
            plan_next_due_for_task(t)
            due = t.next_due_at or utcnow_naive()
            create_pending_assignment(db, t, user_id=None, due_at=due)
        elif t.task_type == TaskType.ROTATING and t.rotation_user_ids:
            plan_next_due_for_task(t)
            due = t.next_due_at or utcnow_naive()
            uid = peek_next_rotating_user(db, t, consume_skips=False)
            create_pending_assignment(db, t, user_id=uid, due_at=due)
        else:
            # ONE_OFF oder sonstige: wenn möglich mit due_at neu starten
            if t.task_type == TaskType.ONE_OFF:
                due = t.next_due_at
                if not due and (t.interval_days or 0) > 0:
                    due = utcnow_naive() + timedelta(days=int(t.interval_days))
                    t.next_due_at = due
                create_pending_assignment(db, t, user_id=None, due_at=due)
            else:
                create_pending_assignment(db, t, user_id=None, due_at=None)

    db.commit()
    return {"ok": True}

@router.post("/DeleteTask")
def delete_task(task_id: int = Form(...), db: Session = Depends(get_db)):
    t = db.query(Task).get(int(task_id))
    if not t: return {"ok": True}
    # Assignments entfernen
    db.query(TaskAssignment).filter(TaskAssignment.task_id == t.id).delete(synchronize_session=False)
    db.delete(t)
    db.commit()
    return {"ok": True}