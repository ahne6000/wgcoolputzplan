from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime
from enum import Enum

# Pydantic v1
try:
    # Pydantic v2
    from pydantic import ConfigDict
    class ConfigORM(BaseModel):
        model_config = ConfigDict(from_attributes=True)
except Exception:
    # Fallback: Pydantic v1
    class ConfigORM(BaseModel):
        class Config:
            orm_mode = True

class TaskType(str, Enum):
    ROTATING = "ROTATING"
    RECURRING_UNASSIGNED = "RECURRING_UNASSIGNED"
    ONE_OFF = "ONE_OFF"

class AssignmentStatus(str, Enum):
    PENDING = "PENDING"
    DONE = "DONE"

# Users
class UserOut(ConfigORM):
    id: int
    name: str
    credits: int
    profile_picture_url: Optional[str] = None

class UserCreate(BaseModel):
    name: str

class AmountIn(BaseModel):
    amount: int

# Tasks
class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    task_type: TaskType
    interval_days: Optional[int] = None
    points: int = 1
    rotation_user_ids: Optional[List[int]] = None
    first_due_at: Optional[datetime] = None

class TaskEdit(BaseModel):
    id: int
    title: Optional[str] = None
    description: Optional[str] = None
    interval_days: Optional[int] = None
    points: Optional[int] = None
    rotation_user_ids: Optional[List[int]] = None

class TaskOut(ConfigORM):
    id: int
    title: str
    description: Optional[str]
    task_type: TaskType
    interval_days: Optional[int]
    points: int
    urgency_score: int
    rotation_user_ids: Optional[List[int]]
    next_due_at: Optional[datetime]
    # angereichert:
    next_assignee_user_id: Optional[int] = None
    rest_days: Optional[int] = None

# Assignments
class AssignmentOut(ConfigORM):
    id: int
    task_id: int
    user_id: Optional[int]
    status: AssignmentStatus
    due_at: Optional[datetime]
    done_at: Optional[datetime]
    task_title: Optional[str] = None

# Logs
class LogOut(ConfigORM):
    id: int
    timestamp: datetime
    action: str
    actor_user_id: Optional[int]
    details: Optional[Any]

class TaskOut(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    task_type: TaskType
    interval_days: Optional[int] = None
    points: int
    rotation_user_ids: Optional[List[int]] = None
    next_due_at: Optional[datetime] = None
    urgency_score: int = 0

    # NEU:
    archived: bool = False
    archived_at: Optional[datetime] = None

    # abgeleitete Felder:
    next_assignee_user_id: Optional[int] = None
    rest_days: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)
