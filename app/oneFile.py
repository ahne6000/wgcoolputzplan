"""
main.py – Minimal lauffähiges FastAPI-Backend für einen digitalen Putzplan

Stack:
- FastAPI + Uvicorn (ASGI)
- SQLAlchemy 2.0 (synchron, SQLite)
- Pydantic v2
- Caddy (als Reverse-Proxy optional)

Funktionen (erste Version, MVP):
- User & Tasks CRUD (inkl. Credits, Profilbilder-Upload)
- Drei Task-Typen:
  1) ROTATING: reihum zwischen Users, periodisch (interval_days)
  2) RECURRING_UNASSIGNED: nicht an User gebunden, wird „dringlicher“ bis jemand ihn erledigt; nach Done wird due_date += interval_days
  3) ONE_OFF: einmalig
- MarkTaskDone: vergibt Punkte / Credits und erzeugt ggf. die nächste Fälligkeit
- Urgency-Votes (+/-) pro User (ein Vote pro User pro Task, änderbar)
- AssignTaskToUser (manuelle Zuweisung offener Instanzen)
- SwitchUserTaskAssignmentTemporarily (temporäre Umbuchung der offenen Instanz)
- Lückenloses Log (ActionLog) plus Undo (Reverse) für ausgewählte Aktionen

Hinweis:
- MVP hält vieles bewusst einfach. Du kannst es später in Module aufteilen und Tests ergänzen.
- Für echte Concurrency/Scaling eher Async-DB (SQLAlchemy async) + Migrations (Alembic) einsetzen.
"""
from __future__ import annotations

import enum
import json
import os
import shutil
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Depends
from fastapi import status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import (
    create_engine, Integer, String, DateTime, Enum, Boolean, ForeignKey, Text,
    func, UniqueConstraint
)
from sqlalchemy.orm import (
    DeclarativeBase, Mapped, mapped_column, relationship, Session, sessionmaker
)

# ------------------------------
# DB Setup
# ------------------------------
DB_URL = os.environ.get("DATABASE_URL", "sqlite:///./app.db")
engine = create_engine(DB_URL, echo=False, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


# ------------------------------
# Enums & Constants
# ------------------------------
class TaskType(str, enum.Enum):
    ROTATING = "ROTATING"
    RECURRING_UNASSIGNED = "RECURRING_UNASSIGNED"
    ONE_OFF = "ONE_OFF"


class AssignmentStatus(str, enum.Enum):
    PENDING = "PENDING"
    DONE = "DONE"
    CANCELED = "CANCELED"


# ------------------------------
# ORM Modelle
# ------------------------------
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    credits: Mapped[int] = mapped_column(Integer, default=0)
    profile_picture_path: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    assignments: Mapped[List[TaskAssignment]] = relationship(back_populates="user")
    votes: Mapped[List[TaskUrgencyVote]] = relationship(back_populates="user")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    task_type: Mapped[TaskType] = mapped_column(Enum(TaskType), default=TaskType.ONE_OFF)
    interval_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # für ROTATING & RECURRING_UNASSIGNED
    points: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Für ROTATING: fest eingefrorene Reihenfolge + aktueller Index
    rotation_frozen: Mapped[bool] = mapped_column(Boolean, default=False)
    next_rotation_index: Mapped[int] = mapped_column(Integer, default=0)

    # Für RECURRING_UNASSIGNED: Startfälligkeit (optional)
    next_due_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    assignments: Mapped[List[TaskAssignment]] = relationship(back_populates="task")
    rotation_order: Mapped[List[TaskRotation]] = relationship(back_populates="task", cascade="all, delete-orphan")
    votes: Mapped[List[TaskUrgencyVote]] = relationship(back_populates="task", cascade="all, delete-orphan")


class TaskRotation(Base):
    __tablename__ = "task_rotation"
    __table_args__ = (UniqueConstraint("task_id", "position", name="uq_taskrotation_task_pos"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)  # 0..n-1

    task: Mapped[Task] = relationship(back_populates="rotation_order")
    # Hinweis: User-Relation nur bei Bedarf nachladen


class TaskAssignment(Base):
    __tablename__ = "task_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    status: Mapped[AssignmentStatus] = mapped_column(Enum(AssignmentStatus), default=AssignmentStatus.PENDING)
    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    done_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Für temporäre Umbuchung: optionales Ablaufdatum
    temporary_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    credits_awarded: Mapped[int] = mapped_column(Integer, default=0)

    task: Mapped[Task] = relationship(back_populates="assignments")
    user: Mapped[Optional[User]] = relationship(back_populates="assignments")


class TaskUrgencyVote(Base):
    __tablename__ = "task_urgency_votes"
    __table_args__ = (UniqueConstraint("task_id", "user_id", name="uq_vote_task_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    value: Mapped[int] = mapped_column(Integer, default=0)  # -1, 0, +1

    task: Mapped[Task] = relationship(back_populates="votes")
    user: Mapped[User] = relationship(back_populates="votes")


class ActionLog(Base):
    __tablename__ = "action_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    actor_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    action: Mapped[str] = mapped_column(String(100))
    details_json: Mapped[str] = mapped_column(Text)  # frei, für Undo wichtig


# ------------------------------
# Pydantic Schemas
# ------------------------------
class UserCreate(BaseModel):
    name: str


class UserEdit(BaseModel):
    name: Optional[str] = None


class UserOut(BaseModel):
    id: int
    name: str
    credits: int
    profile_picture_url: Optional[str] = None

    class Config:
        from_attributes = True


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    task_type: TaskType
    interval_days: Optional[int] = Field(default=None, ge=1)
    points: int = 1
    rotation_user_ids: Optional[List[int]] = None  # nur für ROTATING
    first_due_at: Optional[datetime] = None        # für RECURRING_UNASSIGNED


class TaskEdit(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    task_type: Optional[TaskType] = None
    interval_days: Optional[int] = Field(default=None, ge=1)
    points: Optional[int] = None
    is_active: Optional[bool] = None
    rotation_user_ids: Optional[List[int]] = None
    first_due_at: Optional[datetime] = None


class TaskOut(BaseModel):
    id: int
    title: str
    description: Optional[str]
    task_type: TaskType
    interval_days: Optional[int]
    points: int
    is_active: bool
    next_due_at: Optional[datetime]
    rotation_order_user_ids: Optional[List[int]] = None
    urgency_score: int

    class Config:
        from_attributes = True


class AssignmentOut(BaseModel):
    id: int
    task_id: int
    user_id: Optional[int]
    status: AssignmentStatus
    due_at: Optional[datetime]
    done_at: Optional[datetime]
    temporary_until: Optional[datetime]
    credits_awarded: int

    class Config:
        from_attributes = True


# ------------------------------
# App Setup
# ------------------------------
app = FastAPI(title="Cleaning Plan API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Optional: Static für Profilbilder
UPLOAD_DIR = os.path.abspath("./uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ------------------------------
# Hilfsfunktionen
# ------------------------------

def task_urgency_score(db: Session, task_id: int) -> int:
    votes = db.query(TaskUrgencyVote).filter(TaskUrgencyVote.task_id == task_id).all()
    return sum(v.value for v in votes)


def serialize_task(db: Session, task: Task) -> TaskOut:
    order = None
    if task.task_type == TaskType.ROTATING:
        order = [tr.user_id for tr in sorted(task.rotation_order, key=lambda r: r.position)]
    return TaskOut(
        id=task.id,
        title=task.title,
        description=task.description,
        task_type=task.task_type,
        interval_days=task.interval_days,
        points=task.points,
        is_active=task.is_active,
        next_due_at=task.next_due_at,
        rotation_order_user_ids=order,
        urgency_score=task_urgency_score(db, task.id),
    )


def log_action(db: Session, action: str, details: dict, actor_user_id: Optional[int] = None):
    db.add(ActionLog(action=action, details_json=json.dumps(details), actor_user_id=actor_user_id))
    db.commit()


def award_credits(db: Session, user_id: int, delta: int, reason: str, task_id: Optional[int] = None):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    before = user.credits
    user.credits += delta
    db.commit()
    log_action(db, "CREDITS_CHANGE", {"user_id": user_id, "before": before, "delta": delta, "after": user.credits, "reason": reason, "task_id": task_id})


def ensure_rotation_frozen(db: Session, task: Task):
    if task.task_type != TaskType.ROTATING:
        return
    if task.rotation_frozen:
        return
    # Wenn keine Reihenfolge definiert, alle User alphabetisch sammeln
    if not task.rotation_order:
        users = db.query(User).order_by(User.name.asc()).all()
        for idx, u in enumerate(users):
            db.add(TaskRotation(task_id=task.id, user_id=u.id, position=idx))
        db.commit()
    # Einmalig „frost“ markieren
    task.rotation_frozen = True
    db.commit()


def schedule_next_for_rotating(db: Session, task: Task):
    """Erzeugt eine neue PENDING-Assignment für den nächsten User in der Rotation."""
    ensure_rotation_frozen(db, task)
    order = sorted(task.rotation_order, key=lambda r: r.position)
    if not order:
        return
    idx = task.next_rotation_index % len(order)
    user_id = order[idx].user_id
    due_at = datetime.utcnow() + timedelta(days=task.interval_days or 7)
    assignment = TaskAssignment(task_id=task.id, user_id=user_id, status=AssignmentStatus.PENDING, due_at=due_at)
    db.add(assignment)
    task.next_rotation_index = (task.next_rotation_index + 1) % len(order)
    task.next_due_at = due_at
    db.commit()
    log_action(db, "SCHEDULE_ROTATING", {"task_id": task.id, "created_assignment_id": assignment.id, "user_id": user_id, "due_at": due_at.isoformat()})


def schedule_next_for_recurring_unassigned(db: Session, task: Task, base_time: Optional[datetime] = None):
    """Erzeugt/aktualisiert die nächste PENDING-Assignment ohne User. (Nur 1 offen halten.)"""
    if task.interval_days is None:
        raise HTTPException(400, detail="interval_days required for RECURRING_UNASSIGNED")
    open_existing = (
        db.query(TaskAssignment)
        .filter(TaskAssignment.task_id == task.id, TaskAssignment.status == AssignmentStatus.PENDING)
        .order_by(TaskAssignment.due_at.asc().nulls_last())
        .first()
    )
    if open_existing:
        return  # bereits eine offen
    base = base_time or task.next_due_at or datetime.utcnow()
    due_at = base if task.next_due_at else base + timedelta(days=task.interval_days)
    assignment = TaskAssignment(task_id=task.id, user_id=None, status=AssignmentStatus.PENDING, due_at=due_at)
    db.add(assignment)
    task.next_due_at = due_at
    db.commit()
    log_action(db, "SCHEDULE_RECURRING_UNASSIGNED", {"task_id": task.id, "assignment_id": assignment.id, "due_at": due_at.isoformat()})


# ------------------------------
# Routes – Users
# ------------------------------
@app.post("/CreateUser", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.name == payload.name).first():
        raise HTTPException(400, detail="User name already exists")
    u = User(name=payload.name)
    db.add(u)
    db.commit()
    db.refresh(u)
    log_action(db, "CREATE_USER", {"user_id": u.id, "name": u.name})
    return user_out_with_url(u)


def user_out_with_url(u: User) -> UserOut:
    url = f"/uploads/{os.path.basename(u.profile_picture_path)}" if u.profile_picture_path else None
    return UserOut(id=u.id, name=u.name, credits=u.credits, profile_picture_url=url)


@app.get("/ListAllUser", response_model=List[UserOut])
def list_all_user(db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.name.asc()).all()
    return [user_out_with_url(u) for u in users]


@app.patch("/EditUser/{user_id}", response_model=UserOut)
def edit_user(user_id: int, payload: UserEdit, db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, detail="User not found")
    if payload.name is not None:
        if db.query(User).filter(User.name == payload.name, User.id != user_id).first():
            raise HTTPException(400, detail="User name already exists")
        u.name = payload.name
    db.commit()
    log_action(db, "EDIT_USER", {"user_id": u.id, "fields": payload.model_dump(exclude_none=True)})
    return user_out_with_url(u)


@app.post("/UploadProfilePicture/{user_id}", response_model=UserOut)
def upload_profile_picture(user_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, detail="User not found")
    ext = os.path.splitext(file.filename)[1].lower() or ".jpg"
    dst = os.path.join(UPLOAD_DIR, f"user_{user_id}{ext}")
    with open(dst, "wb") as f:
        shutil.copyfileobj(file.file, f)
    u.profile_picture_path = dst
    db.commit()
    log_action(db, "UPLOAD_PROFILE_PICTURE", {"user_id": user_id, "path": dst})
    return user_out_with_url(u)


@app.get("/ShowUserCredit/{user_id}")
def show_user_credit(user_id: int, db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, detail="User not found")
    return {"user_id": user_id, "credits": u.credits}


@app.post("/AddUserCredit/{user_id}")
def add_user_credit(user_id: int, amount: int = Form(...), db: Session = Depends(get_db)):
    award_credits(db, user_id, amount, reason="manual_add")
    return show_user_credit(user_id, db)


@app.post("/SubstractUserCredits/{user_id}")
def substract_user_credits(user_id: int, amount: int = Form(...), db: Session = Depends(get_db)):
    award_credits(db, user_id, -abs(amount), reason="manual_subtract")
    return show_user_credit(user_id, db)


# ------------------------------
# Routes – Tasks
# ------------------------------
@app.post("/CreateTask", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(payload: TaskCreate, db: Session = Depends(get_db)):
    t = Task(
        title=payload.title,
        description=payload.description,
        task_type=payload.task_type,
        interval_days=payload.interval_days,
        points=payload.points,
        next_due_at=payload.first_due_at,
    )
    db.add(t)
    db.commit()
    db.refresh(t)

    # Rotation einfrieren + Reihenfolge speichern (zufällig/fest – hier: übergebe Reihenfolge, sonst alphabetical)
    if t.task_type == TaskType.ROTATING:
        order_ids = payload.rotation_user_ids
        if order_ids is None:
            users = db.query(User).order_by(User.name.asc()).all()
            order_ids = [u.id for u in users]
        for pos, uid in enumerate(order_ids):
            db.add(TaskRotation(task_id=t.id, user_id=uid, position=pos))
        t.rotation_frozen = True
        db.commit()
        # Sofort erste Zuweisung planen
        schedule_next_for_rotating(db, t)

    if t.task_type == TaskType.RECURRING_UNASSIGNED:
        schedule_next_for_recurring_unassigned(db, t, base_time=payload.first_due_at)

    log_action(db, "CREATE_TASK", {"task_id": t.id, "payload": payload.model_dump()})
    t = db.get(Task, t.id)
    return serialize_task(db, t)


@app.get("/ListAllTasks", response_model=List[TaskOut])
def list_all_tasks(db: Session = Depends(get_db)):
    tasks = db.query(Task).order_by(Task.created_at.desc()).all()
    return [serialize_task(db, t) for t in tasks]


@app.patch("/EditTask/{task_id}", response_model=TaskOut)
def edit_task(task_id: int, payload: TaskEdit, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, detail="Task not found")

    data = payload.model_dump(exclude_none=True)
    for field in ["title", "description", "task_type", "interval_days", "points", "is_active"]:
        if field in data:
            setattr(t, field, data[field])

    db.commit()

    if "rotation_user_ids" in data:
        # Rotation vollständig neu setzen (feste Reihenfolge)
        db.query(TaskRotation).filter(TaskRotation.task_id == t.id).delete()
        for pos, uid in enumerate(data["rotation_user_ids"]):
            db.add(TaskRotation(task_id=t.id, user_id=uid, position=pos))
        t.rotation_frozen = True
        db.commit()

    if t.task_type == TaskType.RECURRING_UNASSIGNED and "first_due_at" in data:
        t.next_due_at = data["first_due_at"]
        db.commit()
        schedule_next_for_recurring_unassigned(db, t, base_time=t.next_due_at)

    log_action(db, "EDIT_TASK", {"task_id": t.id, "fields": data})
    t = db.get(Task, t.id)
    return serialize_task(db, t)


# ------------------------------
# Assignments & Completion
# ------------------------------
@app.post("/AssignTaskToUser")
def assign_task_to_user(task_id: int = Form(...), user_id: int = Form(...), due_days: Optional[int] = Form(None), db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, detail="Task not found")
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, detail="User not found")

    due_at = datetime.utcnow() + timedelta(days=due_days or (t.interval_days or 7))
    a = TaskAssignment(task_id=t.id, user_id=u.id, status=AssignmentStatus.PENDING, due_at=due_at)
    db.add(a)
    db.commit()
    log_action(db, "ASSIGN_TASK", {"task_id": t.id, "user_id": u.id, "due_at": due_at.isoformat()})
    return {"assignment_id": a.id}


@app.post("/MarkTaskDone")
def mark_task_done(assignment_id: int = Form(...), actor_user_id: Optional[int] = Form(None), db: Session = Depends(get_db)):
    a = db.get(TaskAssignment, assignment_id)
    if not a or a.status != AssignmentStatus.PENDING:
        raise HTTPException(404, detail="Pending assignment not found")

    t = db.get(Task, a.task_id)
    a.status = AssignmentStatus.DONE
    a.done_at = datetime.utcnow()
    a.temporary_until = None
    a.credits_awarded = t.points
    db.commit()

    # Credits verbuchen (an den ausführenden User – falls zugewiesen, sonst actor)
    credit_user_id = a.user_id or actor_user_id
    if credit_user_id:
        award_credits(db, credit_user_id, t.points, reason="task_done", task_id=t.id)

    # Folgeinstanzen planen
    if t.task_type == TaskType.ROTATING:
        schedule_next_for_rotating(db, t)
    elif t.task_type == TaskType.RECURRING_UNASSIGNED:
        # nächste Fälligkeit ab jetzt + interval
        t.next_due_at = a.done_at + timedelta(days=t.interval_days or 7)
        db.commit()
        schedule_next_for_recurring_unassigned(db, t, base_time=t.next_due_at)

    log_action(db, "MARK_DONE", {"assignment_id": a.id, "task_id": t.id, "actor_user_id": actor_user_id})
    return {"ok": True}


@app.post("/SwitchUserTaskAssignmentTemporarily")
def switch_user_task_assignment_temporarily(
    assignment_id: int = Form(...),
    new_user_id: int = Form(...),
    until_timestamp: Optional[datetime] = Form(None),
    db: Session = Depends(get_db),
):
    a = db.get(TaskAssignment, assignment_id)
    if not a or a.status != AssignmentStatus.PENDING:
        raise HTTPException(404, detail="Pending assignment not found")
    if db.get(User, new_user_id) is None:
        raise HTTPException(404, detail="New user not found")

    before_user = a.user_id
    a.user_id = new_user_id
    a.temporary_until = until_timestamp
    db.commit()

    log_action(db, "SWITCH_TEMP", {"assignment_id": assignment_id, "before_user": before_user, "new_user": new_user_id, "until": until_timestamp.isoformat() if until_timestamp else None})
    return {"ok": True}


# ------------------------------
# Urgency Voting
# ------------------------------
@app.post("/VoteTaskUrgencyUp")
@app.post("/VoteTaskUrgencyDown")
def vote_task_urgency(task_id: int = Form(...), user_id: int = Form(...), request_path: str = "", db: Session = Depends(get_db)):
    # Ermitteln ob Up oder Down anhand des aufgerufenen Pfades
    # FastAPI übergibt hier nicht automatisch; Workaround: separate Routen-Wrapper unten
    raise HTTPException(500, detail="Direct call not allowed")


@app.post("/VoteTaskUrgencyUp_do")
def vote_up(task_id: int = Form(...), user_id: int = Form(...), db: Session = Depends(get_db)):
    return _set_vote(db, task_id, user_id, +1)


@app.post("/VoteTaskUrgencyDown_do")
def vote_down(task_id: int = Form(...), user_id: int = Form(...), db: Session = Depends(get_db)):
    return _set_vote(db, task_id, user_id, -1)


def _set_vote(db: Session, task_id: int, user_id: int, value: int):
    if not db.get(Task, task_id):
        raise HTTPException(404, detail="Task not found")
    if not db.get(User, user_id):
        raise HTTPException(404, detail="User not found")

    vote = db.query(TaskUrgencyVote).filter_by(task_id=task_id, user_id=user_id).first()
    if not vote:
        vote = TaskUrgencyVote(task_id=task_id, user_id=user_id, value=value)
        db.add(vote)
    else:
        vote.value = value
    db.commit()

    log_action(db, "URGENCY_VOTE", {"task_id": task_id, "user_id": user_id, "value": value})
    return {"task_id": task_id, "urgency_score": task_urgency_score(db, task_id)}


# ------------------------------
# Logs & Undo
# ------------------------------
@app.get("/ShowLog")
def show_log(limit: int = 100, db: Session = Depends(get_db)):
    rows = db.query(ActionLog).order_by(ActionLog.id.desc()).limit(limit).all()
    return [
        {
            "id": r.id,
            "timestamp": r.timestamp,
            "actor_user_id": r.actor_user_id,
            "action": r.action,
            "details": json.loads(r.details_json),
        }
        for r in rows
    ]


@app.post("/Reverse")
def reverse_action(log_id: int = Form(...), db: Session = Depends(get_db)):
    r = db.get(ActionLog, log_id)
    if not r:
        raise HTTPException(404, detail="Log entry not found")
    details = json.loads(r.details_json)

    if r.action == "MARK_DONE":
        assignment_id = details.get("assignment_id")
        a = db.get(TaskAssignment, assignment_id)
        if not a:
            raise HTTPException(404, detail="Assignment not found")
        if a.status != AssignmentStatus.DONE:
            raise HTTPException(400, detail="Assignment not in DONE state")
        # Credits zurücknehmen, wenn zuvor vergeben
        if a.credits_awarded and a.user_id:
            award_credits(db, a.user_id, -a.credits_awarded, reason="undo_done", task_id=a.task_id)
        a.status = AssignmentStatus.PENDING
        a.done_at = None
        a.credits_awarded = 0
        db.commit()
        log_action(db, "UNDO_MARK_DONE", {"assignment_id": assignment_id})
        return {"ok": True}

    if r.action == "CREDITS_CHANGE":
        # Für Kredite ist der Undo fallabhängig – hier: inverser Eintrag
        user_id = details.get("user_id")
        delta = details.get("delta")
        if user_id is None or delta is None:
            raise HTTPException(400, detail="Cannot undo this credits change")
        award_credits(db, user_id, -int(delta), reason="undo_credits")
        log_action(db, "UNDO_CREDITS_CHANGE", {"original_log_id": r.id})
        return {"ok": True}

    raise HTTPException(400, detail=f"Undo not supported for action {r.action}")


# ------------------------------
# Bootstrap & Root
# ------------------------------
@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(engine)


@app.get("/")
def root():
    return {"status": "ok", "service": "Cleaning Plan API"}


"""
# --- Start (Dev) ---
# uvicorn main:app --host 127.0.0.1 --port 8000 --reload --proxy-headers

# --- Beispiel-Caddyfile (Dev) ---
# Speichere als Caddyfile im Projektordner und starte mit:
#   caddy run --config ./Caddyfile
#
# Inhalt:
# localhost:3000 {
#     encode gzip zstd
#     reverse_proxy 127.0.0.1:8000
# }
#
# Variante mit statischem Frontend-Build und API unter /api:
# localhost:3000 {
#     root * ./frontend/dist
#     file_server
#     reverse_proxy /api/* 127.0.0.1:8000
# }
"""
# Patch-Snippet für main.py (FastAPI)
# Füge diese Routen irgendwo NACH den ORM-Definitionen und Hilfsfunktionen ein,
# z. B. direkt vor dem Abschnitt "# Urgency Voting" oder am Ende der Datei.

from typing import Optional
from sqlalchemy.orm import Session



@app.get("/ListAssignments")
def list_assignments(user_id: Optional[int] = None, status: Optional[AssignmentStatus] = None,
                     task_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Liste von Assignments, optional gefiltert nach user_id und Status.
    Gibt zusätzlich den Task-Titel zurück, um das Frontend zu vereinfachen.
    """
    q = db.query(TaskAssignment, Task.title).join(Task, Task.id == TaskAssignment.task_id)
    if user_id is not None:
        q = q.filter(TaskAssignment.user_id == user_id)
    if status is not None:
        q = q.filter(TaskAssignment.status == status)
    if task_id is not None:
        q = q.filter(TaskAssignment.task_id == task_id)

    rows = q.order_by(TaskAssignment.due_at.asc().nulls_last(), TaskAssignment.id.desc()).all()

    def to_dict(ta: TaskAssignment, title: str):
        return {
            "id": ta.id,
            "task_id": ta.task_id,
            "task_title": title,
            "user_id": ta.user_id,
            "status": ta.status,
            "due_at": ta.due_at,
            "done_at": ta.done_at,
            "temporary_until": ta.temporary_until,
            "credits_awarded": ta.credits_awarded,
        }

    return [to_dict(a, t) for (a, t) in rows]


@app.get("/ListAssignmentsForUser/{user_id}")
def list_assignments_for_user(user_id: int, status: Optional[AssignmentStatus] = None, db: Session = Depends(get_db)):
    return list_assignments(user_id=user_id, status=status, db=db)
