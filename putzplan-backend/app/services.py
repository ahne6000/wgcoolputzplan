# app/services.py

import math
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any

from sqlalchemy.orm import Session

from .models import (
    Task, TaskType,
    TaskAssignment, AssignmentStatus,
    LogEntry, User,
)

# --- Zeit-Helper -------------------------------------------------------------

def utcnow_naive() -> datetime:
    """Naive (TZ-lose) UTC-Now – passend für SQLite-Spalten ohne TZ."""
    return datetime.now(tz=timezone.utc).replace(tzinfo=None)

# --- Assignment-Listen & Guards ---------------------------------------------

def get_pending_assignments(db: Session, task_id: int) -> List[TaskAssignment]:
    return (
        db.query(TaskAssignment)
        .filter(
            TaskAssignment.task_id == task_id,
            TaskAssignment.status == AssignmentStatus.PENDING,
        )
        .order_by(TaskAssignment.id.asc())
        .all()
    )

def get_single_pending(db: Session, task_id: int) -> Optional[TaskAssignment]:
    rows = get_pending_assignments(db, task_id)
    return rows[0] if len(rows) == 1 else None

def has_any_assignee(pending: Optional[TaskAssignment]) -> bool:
    return bool(pending and pending.user_id is not None)

def ensure_no_other_pending_or_raise(db: Session, task_id: int):
    rows = get_pending_assignments(db, task_id)
    if len(rows) >= 1:
        # In unserer Logik darf es nur 1 offenes Assignment geben.
        # Neue Zuweisungen/Claims sind dann nicht erlaubt.
        raise ValueError("Task already has a pending assignment")

# --- Rotation / „wer ist dran?“ ---------------------------------------------

def next_user_in_rotation(task: Task, last_done_user_id: Optional[int]) -> Optional[int]:
    if task.task_type != TaskType.ROTATING or not task.rotation_user_ids:
        return None
    order = list(task.rotation_user_ids)
    if not order:
        return None
    if last_done_user_id is None or last_done_user_id not in order:
        return order[0]
    idx = order.index(int(last_done_user_id))
    return order[(idx + 1) % len(order)]

def compute_next_assignee_user_id(db: Session, task: Task) -> Optional[int]:
    """
    Wer ist 'gerade dran'?
    1) Wenn es ein offenes Assignment MIT user_id gibt -> dieser User.
    2) Falls ROTATING -> aus letzter DONE + rotation_user_ids den nächsten bestimmen.
    3) Sonst None.
    """
    # 1) offenes Assignment mit user_id?
    row = (
        db.query(TaskAssignment.user_id)
        .filter(
            TaskAssignment.task_id == task.id,
            TaskAssignment.status == AssignmentStatus.PENDING,
            TaskAssignment.user_id.isnot(None),
        )
        .first()
    )
    if row and row[0]:
        return int(row[0])

    # 2) ROTATING -> anhand letzter DONE den nächsten aus rotation_user_ids
    if task.task_type == TaskType.ROTATING and task.rotation_user_ids:
        last_done = (
            db.query(TaskAssignment.user_id)
            .filter(
                TaskAssignment.task_id == task.id,
                TaskAssignment.status == AssignmentStatus.DONE,
                TaskAssignment.user_id.isnot(None),
            )
            .order_by(TaskAssignment.done_at.desc())
            .first()
        )
        order = list(task.rotation_user_ids)
        if not last_done or not last_done[0] or last_done[0] not in order:
            return order[0]
        idx = order.index(int(last_done[0]))
        return order[(idx + 1) % len(order)]

    # 3) kein Kandidat
    return None

# --- Fälligkeit / Resttage ---------------------------------------------------

def compute_rest_days(task: Task) -> Optional[int]:
    if task.task_type == TaskType.ONE_OFF or not task.next_due_at:
        return None
    delta = task.next_due_at - utcnow_naive()
    d = math.ceil(delta.total_seconds() / 86400)
    return max(0, d)

def plan_next_due_for_task(task: Task):
    """Für nicht-ONE_OFF Aufgaben neue Fälligkeit anhand interval_days setzen."""
    if task.interval_days and task.interval_days > 0 and task.task_type != TaskType.ONE_OFF:
        task.next_due_at = utcnow_naive() + timedelta(days=int(task.interval_days))

# --- Erzeuge (sauberes) Pending-Assignment ----------------------------------

def create_pending_assignment(db: Session, task: Task, user_id: Optional[int], due_at: Optional[datetime]) -> TaskAssignment:
    """
    Erzeugt EIN neues offenes Assignment. Falls Altlasten existieren (mehrere PENDING),
    schließt es diese vorher, damit der Zustand konsistent ist.
    """
    rows = get_pending_assignments(db, task.id)
    for r in rows:
        r.status = AssignmentStatus.DONE
        r.done_at = utcnow_naive()
    a = TaskAssignment(task_id=task.id, user_id=user_id, status=AssignmentStatus.PENDING, due_at=due_at)
    db.add(a); db.commit(); db.refresh(a)
    return a

# --- Logging + Reverse -------------------------------------------------------

def log(db: Session, action: str, actor_user_id: Optional[int], details: Dict[str, Any], undo_data: Optional[Dict[str, Any]] = None) -> LogEntry:
    entry = LogEntry(
        action=action,
        actor_user_id=actor_user_id,
        details=details or {},
        undo_data=undo_data or {},
    )
    db.add(entry); db.commit(); db.refresh(entry)
    return entry

def reverse(db: Session, log_id: int) -> bool:
    le = db.query(LogEntry).get(log_id)
    if not le or le.reversed_at:
        return False

    action = le.action
    ud = le.undo_data or {}
    now = utcnow_naive()

    if action in ("ADD_CREDIT", "SUB_CREDIT"):
        user = db.query(User).get(ud.get("user_id"))
        if user is None:
            return False
        delta = ud.get("delta_was") or 0
        user.credits -= delta  # rückgängig
        le.reversed_at = now
        db.commit()
        return True

    if action in ("URG_UP", "URG_DOWN"):
        task = db.query(Task).get(ud.get("task_id"))
        if task is None:
            return False
        delta = ud.get("delta_was") or 0
        task.urgency_score -= delta
        le.reversed_at = now
        db.commit()
        return True

    if action == "ASSIGN_TASK":
        a = db.query(TaskAssignment).get(ud.get("assignment_id"))
        if a and a.status == AssignmentStatus.PENDING:
            db.delete(a)
            le.reversed_at = now
            db.commit()
            return True
        return False

    if action == "SWITCH_ASSIGN":
        a = db.query(TaskAssignment).get(ud.get("assignment_id"))
        prev_user_id = ud.get("prev_user_id")
        if a:
            a.user_id = prev_user_id
            le.reversed_at = now
            db.commit()
            return True
        return False

    if action == "MARK_DONE":
        a = db.query(TaskAssignment).get(ud.get("assignment_id"))
        user = db.query(User).get(ud.get("user_id")) if ud.get("user_id") else None
        task = db.query(Task).get(ud.get("task_id"))
        if a and task:
            a.status = AssignmentStatus.PENDING
            a.done_at = None
            if user:
                user.credits -= int(ud.get("points") or 0)
            prev_due = ud.get("prev_next_due_at")
            task.next_due_at = prev_due
            le.reversed_at = now
            db.commit()
            return True
        return False

    return False
