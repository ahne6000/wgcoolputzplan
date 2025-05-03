from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime
from enum import Enum
from sqlmodel import SQLModel, Field
from typing import Optional, List
from sqlalchemy import Column
from sqlmodel import JSON

# --- Enums ---
class TaskType(str, Enum):
    free = "free"
    assigned = "assigned"

class TaskMode(str, Enum):
    one_time = "one_time"
    recurring = "recurring"
#    persistent = "persistent"

# --- Models ---
class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    active: bool = True
#    slot: Optional[int] = None  # wenn du View-Zuordnung brauchst
    points: int = 0
#    is_slot_user: bool = False
    profile_image_url: Optional[str] = None  # 🔥



class Task(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    due_date: Optional[datetime] = None
    is_done: bool = False

    default_duration_days: int = 7
    credits: int = 1
    task_type: TaskType = TaskType.free
    mode: TaskMode = TaskMode.recurring
    urgency_level: int = 0
    urgency_votes :int = 0
    escalation_level: int = 0  # default 0, kann erhöht werden

    last_completed_at: Optional[datetime] = None

    last_done_by: Optional[int] = Field(default=None, foreign_key="user.id")
    before_last_done_by: Optional[int] = Field(default=None, foreign_key="user.id")
    times_completed: int = 0

    user_id: Optional[int] = Field(default=None, foreign_key="user.id")


class TaskLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="task.id")
    user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    user_name: Optional[str] = None  # 👈 NEU
    action: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class AssignmentQueue(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="task.id", unique=True, index=True)
    user_queue: List[int] = Field(default_factory=list, sa_column=Column(JSON))  # ✅ Neu!
