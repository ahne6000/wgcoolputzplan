# app/services.py

import math
from datetime import datetime, timedelta, timezone, date
from typing import Optional, List, Dict, Any
from collections.abc import Mapping

from sqlalchemy.orm import Session
from .models import RotationSkip
from .models import RotationOrderTemp
from .models import (
    Task, TaskType,
    TaskAssignment, AssignmentStatus,
    LogEntry, User
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
    # 1) offenes Assignment mit user_id → der ist dran
    row = (db.query(TaskAssignment.user_id)
             .filter(TaskAssignment.task_id == task.id,
                     TaskAssignment.status == AssignmentStatus.PENDING,
                     TaskAssignment.user_id.isnot(None))
             .first())
    if row and row[0]:
        return int(row[0])

    # 2) ROTATING: Vorschau (Skips berücksichtigen, aber NICHT abbuchen)
    if task.task_type == TaskType.ROTATING and task.rotation_user_ids:
        return peek_next_rotating_user(db, task, consume_skips=False)

    return None


# --- Fälligkeit / Resttage ---------------------------------------------------
def compute_rest_days(task: Task) -> Optional[int]:
    if not task.next_due_at:
        return None
    delta = task.next_due_at - utcnow_naive()
    d = math.ceil(delta.total_seconds() / 86400)
    return max(0, d)


def plan_next_due_for_task(task: Task):
    """Für nicht-ONE_OFF Aufgaben neue Fälligkeit anhand interval_days setzen."""
    if task.interval_days and task.interval_days > 0 and task.task_type != TaskType.ONE_OFF:
        task.next_due_at = utcnow_naive() + timedelta(days=int(task.interval_days))

# --- Erzeuge (sauberes) Pending-Assignment ----------------------------------
'''
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
'''
# --- Logging + Reverse -------------------------------------------------------

def log(db: Session, action: str, actor_user_id: int | None = None, *,
        details: dict | None = None, undo_data: dict | None = None):
    entry = LogEntry(
        timestamp=utcnow_naive(),
        action=action,
        actor_user_id=actor_user_id,
        details=_to_jsonable(details) if details is not None else None,
        undo_data=_to_jsonable(undo_data) if undo_data is not None else None,
        reversed_at=None,
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


def get_skip_count(db: Session, task_id: int, user_id: int) -> int:
    rs = db.query(RotationSkip).filter(RotationSkip.task_id==task_id, RotationSkip.user_id==user_id).first()
    return int(rs.count) if rs else 0

def inc_skip(db: Session, task_id: int, user_id: int, delta: int = 1) -> None:
    rs = db.query(RotationSkip).filter(RotationSkip.task_id==task_id, RotationSkip.user_id==user_id).first()
    if not rs:
        rs = RotationSkip(task_id=task_id, user_id=user_id, count=0)
        db.add(rs)
    rs.count = max(0, int(rs.count) + int(delta))
    db.commit()

def consume_skip_if_any(db: Session, task_id: int, user_id: int) -> bool:
    rs = db.query(RotationSkip).filter(RotationSkip.task_id==task_id, RotationSkip.user_id==user_id).first()
    if rs and rs.count > 0:
        rs.count -= 1
        db.commit()
        return True
    return False

def last_done_user_id(db: Session, task_id: int) -> Optional[int]:
    row = (db.query(TaskAssignment.user_id)
             .filter(TaskAssignment.task_id==task_id,
                     TaskAssignment.status==AssignmentStatus.DONE,
                     TaskAssignment.user_id.isnot(None))
             .order_by(TaskAssignment.done_at.desc())
             .first())
    return int(row[0]) if row and row[0] is not None else None

def peek_next_rotating_user(db: Session, task: Task, consume_skips: bool) -> Optional[int]:
    """Ermittelt den nächsten User in der Rotation, berücksichtigt Skip-Tokens.
       Wenn consume_skips=True, werden Skips der übersprungenen User abgebucht."""
    if task.task_type != TaskType.ROTATING or not task.rotation_user_ids:
        return None
    order = list(task.rotation_user_ids)
    if not order: return None

    last_uid = last_done_user_id(db, task.id)
    start_idx = 0 if last_uid is None or last_uid not in order else (order.index(last_uid)+1) % len(order)

    # Einmal um den Kreis laufen
    for k in range(len(order)):
        uid = int(order[(start_idx + k) % len(order)])
        if get_skip_count(db, task.id, uid) > 0:
            if consume_skips:
                consume_skip_if_any(db, task.id, uid)  # abbuchen und weiter
            continue
        return uid

    # Falls alle Skips > 0 hatten: nimm Start-User (ohne Skips zu verbrennen)
    return int(order[start_idx])




def set_one_cycle_swap(db: Session, task: Task, original_order: list[int]) -> None:
    """Merkt sich die Originalreihenfolge und setzt remaining = len(order)."""
    rot_len = len(original_order)
    if rot_len <= 1:
        return
    row = db.query(RotationOrderTemp).filter(RotationOrderTemp.task_id == task.id).first()
    if not row:
        row = RotationOrderTemp(task_id=task.id, original_order=list(original_order), remaining=rot_len)
        db.add(row)
    else:
        # Wenn schon aktiv: Original so lassen, aber „remaining“ neu starten
        row.remaining = rot_len
    db.commit()

def tick_one_cycle_swap(db: Session, task: Task) -> None:
    """
    Zählt nach JEDEM Abschluss (ROTATING) einen „Turn“ runter.
    Wenn remaining == 0 → Rotation auf original_order zurücksetzen und Temp-Eintrag löschen.
    """
    row = db.query(RotationOrderTemp).filter(RotationOrderTemp.task_id == task.id).first()
    if not row:
        return
    row.remaining = max(0, int(row.remaining) - 1)
    if row.remaining == 0:
        # Reihenfolge zurück
        task.rotation_user_ids = list(row.original_order or [])
        db.delete(row)
    db.commit()
'''
def create_pending_assignment(db: Session, task: Task, user_id: Optional[int], due_at: Optional[datetime]) -> Optional[TaskAssignment]:
    if getattr(task, "archived", False):
        return None
    a = TaskAssignment(task_id=task.id, user_id=user_id, status=AssignmentStatus.PENDING, due_at=due_at)
    db.add(a); db.commit(); db.refresh(a)
    return a
'''
def is_one_off(task: Task) -> bool:
    """Erkennt ONE_OFF robust, auch wenn alte Daten 'ONE_TIME' o.ä. enthalten."""
    tt = getattr(task, "task_type", None)
    if tt is None:
        return False
    # Enum-Name oder String harmonisieren
    name = getattr(tt, "name", None) or str(tt)
    name = name.upper()
    return name in {"ONE_OFF", "ONE_TIME", "ONEOFF", "ONE-TIME"}


def archive_task(db: Session, task: Task, exclude_assignment_id: Optional[int] = None) -> None:
    task.archived = True
    task.archived_at = utcnow_naive()
    q = db.query(TaskAssignment).filter(
        TaskAssignment.task_id == task.id,
        TaskAssignment.status == AssignmentStatus.PENDING
    )
    if exclude_assignment_id is not None:
        q = q.filter(TaskAssignment.id != exclude_assignment_id)
    q.delete(synchronize_session=False)

def _to_jsonable(o):
    if isinstance(o, (datetime, date)):
        # ISO 8601 ohne TZ (du nutzt ohnehin utcnow_naive)
        return o.isoformat()
    if isinstance(o, Mapping):
        return {k: _to_jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple, set)):
        return [_to_jsonable(v) for v in o]
    try:
        # einfache Typen (int, float, str, bool, None) gehen durch
        import json
        json.dumps(o)
        return o
    except Exception:
        # Fallback: String-Repräsentation
        return str(o)


# --- Undo / Reverse helpers -----------------------------------


def _parse_iso_or_none(val):
    if not val:
        return None
    if isinstance(val, str):
        try:
            return datetime.fromisoformat(val)
        except Exception:
            return None
    return val  # falls schon datetime

def reverse_log_entry(db: Session, entry: LogEntry):
    """
    Macht eine Log-Aktion rückgängig auf Basis von entry.action und entry.undo_data.
    Unterstützt: MARK_DONE, URG_UP, URG_DOWN, (einfaches) ARCHIVE_TASK.
    """
    action = entry.action or ""
    ud = entry.undo_data or {}

    if action == "MARK_DONE":
        a_id = ud.get("assignment_id")
        t_id = ud.get("task_id")
        points = ud.get("points") or 0
        prev_due = _parse_iso_or_none(ud.get("prev_next_due_at"))

        a = db.query(TaskAssignment).get(a_id) if a_id else None
        t = db.query(Task).get(t_id) if t_id else None

        # Assignment wieder auf PENDING setzen
        if a and a.status == AssignmentStatus.DONE:
            a.status = AssignmentStatus.PENDING
            a.done_at = None

        # Task-Zustand zurückdrehen
        if t and prev_due is not None:
            t.next_due_at = prev_due

        # Falls ONE_OFF automatisch archiviert wurde: pragmatisch reaktivieren,
        # wenn es zeitlich plausibel ist (nach der ursprünglichen Aktion).
        if t and t.task_type == TaskType.ONE_OFF and t.archived:
            t.archived = False
            t.archived_at = None

        # Credits zurücknehmen
        if a and a.user_id:
            u = db.query(User).get(a.user_id)
            if u:
                u.credits = (u.credits or 0) - int(points)

    elif action == "URG_UP":
        # Dringlichkeit zurücknehmen
        t_id = (ud.get("task_id") if ud.get("task_id") else (entry.details or {}).get("task_id"))
        delta = int(ud.get("delta_was", 1))
        t = db.query(Task).get(t_id) if t_id else None
        if t:
            t.urgency_score = int(t.urgency_score or 0) - delta

    elif action == "URG_DOWN":
        t_id = (ud.get("task_id") if ud.get("task_id") else (entry.details or {}).get("task_id"))
        delta = abs(int(ud.get("delta_was", 1)))
        t = db.query(Task).get(t_id) if t_id else None
        if t:
            t.urgency_score = int(t.urgency_score or 0) + delta

    elif action == "ARCHIVE_TASK":
        # ganz schlicht: wieder aktivieren
        t_id = (ud.get("task_id") if ud.get("task_id") else (entry.details or {}).get("task_id"))
        t = db.query(Task).get(t_id) if t_id else None
        if t:
            t.archived = False
            t.archived_at = None

    else:
        # Nicht-unterstützte Aktionen ignorieren
        pass

    entry.reversed_at = utcnow_naive()
    db.commit()

def find_last_undoable_log(db: Session, window_sec: int = 60) -> LogEntry | None:
    cutoff = utcnow_naive() - timedelta(seconds=window_sec)
    undoable = ("MARK_DONE", "URG_UP", "URG_DOWN", "ARCHIVE_TASK")
    q = (
        db.query(LogEntry)
        .filter(LogEntry.reversed_at == None)
        .filter(LogEntry.action.in_(undoable))
        .order_by(LogEntry.id.desc())
    )
    last = q.first()
    if last and (last.timestamp is None or last.timestamp >= cutoff):
        return last
    return None


# --- Consolidation: max. 1 PENDING pro Task -------------------------------

def consolidate_pendings(db: Session, task_id: int, keep_id: int | None = None) -> int | None:
    """
    Sorgt dafür, dass es pro Task höchstens EIN PENDING gibt.
    - Wenn keep_id gesetzt ist, bleibt genau dieses PENDING erhalten.
    - Sonst wählen wir das „beste“ PENDING (früheste due_at, dann kleinste id).
    Alle übrigen werden auf CANCELLED gesetzt.
    Returns: id des behaltenen PENDINGs (oder None, wenn keins existiert).
    """
    pendings = (
        db.query(TaskAssignment)
          .filter(TaskAssignment.task_id == task_id,
                  TaskAssignment.status == AssignmentStatus.PENDING)
          .order_by(
              TaskAssignment.due_at.is_(None).asc(),  # due_at vorhanden hat Vorrang
              TaskAssignment.due_at.asc(),
              TaskAssignment.id.asc(),
          )
          .all()
    )
    if not pendings:
        return None

    if keep_id is not None:
        keeper = next((a for a in pendings if a.id == keep_id), None)
        if not keeper:
            # Wenn keep_id nicht unter den Pendings ist, fallen wir auf Standardauswahl zurück
            keeper = pendings[0]
    else:
        keeper = pendings[0]

    for a in pendings:
        if a.id == keeper.id:
            continue
        a.status = AssignmentStatus.CANCELLED
        a.done_at = utcnow_naive()  # wir haben kein cancelled_at Feld
    db.commit()
    return keeper.id


# --- Erzeuge (sauberes) Pending-Assignment ---------------------------------

def create_pending_assignment(db: Session, task: Task, user_id: Optional[int], due_at: Optional[datetime]) -> Optional[TaskAssignment]:
    """
    Erzeugt EIN neues offenes Assignment. Vorher wird garantiert: max. 1 PENDING je Task.
    (Killt Altlasten, falls sie existieren.)
    """
    if getattr(task, "archived", False):
        return None
    # Vor dem Anlegen sicherstellen, dass keine doppelten PENDINGs existieren
    consolidate_pendings(db, task.id)

    a = TaskAssignment(task_id=task.id, user_id=user_id, status=AssignmentStatus.PENDING, due_at=due_at)
    db.add(a); db.commit(); db.refresh(a)
    return a
