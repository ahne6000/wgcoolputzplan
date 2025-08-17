from fastapi import APIRouter, Depends, HTTPException, Form, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import timedelta

from ..database import get_db
from ..models import TaskAssignment, Task, AssignmentStatus, TaskType, User
from ..schemas import AssignmentOut
from ..services import (
    utcnow_naive,
    plan_next_due_for_task,
    log,
    get_single_pending,
    has_any_assignee,
    ensure_no_other_pending_or_raise,  # falls genutzt
    create_pending_assignment,         # falls genutzt
    next_user_in_rotation,             # falls genutzt
)

router = APIRouter()

@router.get("/ListAssignments", response_model=List[AssignmentOut])
def list_assignments(
    user_id: Optional[int] = Query(None),
    task_id: Optional[int] = Query(None),
    status: Optional[AssignmentStatus] = Query(None),
    db: Session = Depends(get_db)
):
    q = db.query(TaskAssignment, Task.title).join(Task, Task.id == TaskAssignment.task_id)
    if user_id is not None:
        q = q.filter(TaskAssignment.user_id == user_id)
    if task_id is not None:
        q = q.filter(TaskAssignment.task_id == task_id)
    if status is not None:
        q = q.filter(TaskAssignment.status == status)
    rows = q.all()
    out = []
    for a, title in rows:
        d = AssignmentOut.from_orm(a).dict()
        d["task_title"] = title
        out.append(AssignmentOut(**d))
    return out

@router.post("/AssignTaskToUser")
def assign_task_to_user(
    task_id: int = Form(...),
    user_id: int = Form(...),
    due_days: int = Form(7),
    db: Session = Depends(get_db)
):
    task = db.query(Task).get(int(task_id))
    user = db.query(User).get(int(user_id))
    if not task or not user:
        raise HTTPException(404, "Task or User not found")

    from ..services import utcnow_naive, ensure_no_other_pending_or_raise, create_pending_assignment
    try:
        ensure_no_other_pending_or_raise(db, task.id)
    except ValueError:
        # Es gibt bereits eine Pending-Zuweisung → 409
        raise HTTPException(status_code=409, detail="Task already assigned")

    due = utcnow_naive() + timedelta(days=int(due_days))
    a = create_pending_assignment(db, task, user_id=user.id, due_at=due)

    log(db, "ASSIGN_TASK", actor_user_id=None,
        details={"assignment_id": a.id, "task_id": task.id, "user_id": user.id, "due_at": str(due)},
        undo_data={"assignment_id": a.id})

    return {"ok": True, "assignment_id": a.id}

@router.post("/MarkTaskDone")
def mark_task_done(
    assignment_id: int = Form(...),
    db: Session = Depends(get_db)
):
    a = db.query(TaskAssignment).get(int(assignment_id))
    if not a:
        raise HTTPException(404, "Assignment not found")
    if a.status != AssignmentStatus.PENDING:
        raise HTTPException(400, "Assignment not pending")

    task = db.query(Task).get(a.task_id)
    user = db.query(User).get(a.user_id) if a.user_id else None
    if not task:
        raise HTTPException(404, "Task not found")

    prev_due = task.next_due_at

    # Abschließen
    a.status = AssignmentStatus.DONE
    a.done_at = utcnow_naive()

    # Credits
    if user:
        user.credits += int(task.points or 0)

    # NEU: Escalation zurücksetzen – erst durch „Erledigt“ wird gecleart
    task.urgency_score = 0

    # Nächsten Zustand planen:
    if task.task_type == TaskType.ROTATING:
        # nächster User + neue Pending-Zuweisung
        last_user = a.user_id
        nxt = next_user_in_rotation(task, last_done_user_id=last_user)
        # neue Fälligkeit:
        plan_next_due_for_task(task)
        create_pending_assignment(db, task, user_id=nxt, due_at=task.next_due_at)
    elif task.task_type == TaskType.RECURRING_UNASSIGNED:
        # neue unassigned Pending-Zuweisung
        plan_next_due_for_task(task)
        create_pending_assignment(db, task, user_id=None, due_at=task.next_due_at)
    else:
        # ONE_OFF: nichts mehr planen
        task.next_due_at = None

    db.commit()

    log(db, "MARK_DONE", actor_user_id=a.user_id,
        details={"assignment_id": a.id, "task_id": a.task_id, "user_id": a.user_id, "points": task.points if task else 0},
        undo_data={"assignment_id": a.id, "task_id": a.task_id, "user_id": a.user_id, "points": task.points if task else 0, "prev_next_due_at": prev_due})

    return {"ok": True}


@router.post("/SwitchUserTaskAssignmentTemporarily")
def switch_user_assignment_temporarily(
    assignment_id: int = Form(...),
    new_user_id: int = Form(...),
    until_timestamp: Optional[str] = Form(None),  # optional ISO
    db: Session = Depends(get_db)
):
    a = db.query(TaskAssignment).get(int(assignment_id))
    if not a: raise HTTPException(404, "Assignment not found")
    if a.status != AssignmentStatus.PENDING: raise HTTPException(400, "Assignment not pending")
    prev = a.user_id
    a.user_id = int(new_user_id)
    db.commit()

    log(db, "SWITCH_ASSIGN", actor_user_id=None,
        details={"assignment_id": a.id, "new_user_id": a.user_id, "until": until_timestamp},
        undo_data={"assignment_id": a.id, "prev_user_id": prev})

    return {"ok": True}


@router.post("/ClaimTask")
def claim_task(
    task_id: int = Form(...),
    user_id: int = Form(...),
    db: Session = Depends(get_db)
):
    task = db.query(Task).get(int(task_id))
    user = db.query(User).get(int(user_id))
    if not task or not user:
        raise HTTPException(404, "Task or User not found")

    from ..services import get_single_pending, has_any_assignee
    pend = get_single_pending(db, task.id)
    if not pend:
        raise HTTPException(409, "No pending assignment to claim")
    if has_any_assignee(pend):
        raise HTTPException(409, "Task is already assigned")

    pend.user_id = user.id
    db.commit()

    log(db, "ASSIGN_TASK", actor_user_id=user.id,
        details={"assignment_id": pend.id, "task_id": task.id, "user_id": user.id, "claimed": True},
        undo_data={"assignment_id": pend.id})
    return {"ok": True, "assignment_id": pend.id}
