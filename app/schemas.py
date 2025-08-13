from sqlmodel import SQLModel, Field, JSON
from datetime import datetime
from typing import Optional, Any, List
from typing import Optional, Any

from app.enums import TaskType

class TaskCreate(SQLModel):
    title: str
    description: Optional[str] = None
    due_date: Optional[datetime] = None
    default_duration_days: int = 7
    credits: int = 1
    task_type: TaskType = TaskType.free
    urgency_level: int = 0
    user_id: Optional[int] = None

class TaskRead(SQLModel):
    id: int
    title: str
    description: Optional[str]
    iteration: int
    due_date: Optional[datetime]
    default_duration_days: int
    credits: int
    task_type: TaskType
    remaining_days: int
    escalation_level: int = 0  # default 0, kann erhöht werden

    user_id: Optional[int]
    is_done: bool
    created_at: datetime
    last_completed_at: Optional[datetime]
    remaining_days: int
    urgency_class: str  # NEU: 'green', 'yellow', 'red'
    duration_modifier: int = 0  # NEU
    class Config:
        from_attributes = True
    blacklist: List[int] = []

class UserRead(SQLModel):
    id: int
    name: str
    active: bool
    points: int
#    slot: Optional[int] = None
#    is_slot_user: bool = False
    profile_image_url: Optional[str] = None

    class Config:
        from_attributes = True


class UserUpdate(SQLModel):
    name: Optional[str] = None
    active: Optional[bool] = None
#    slot: Optional[int] = None
    points: Optional[int] = None
#    is_slot_user: Optional[bool] = None
    profile_image_url: Optional[str] = None

class UserCreate(SQLModel):
    name: str


class TaskUpdate(SQLModel):
    user_id: Optional[int] = None
    credits: Optional[int] = None
    task_type: Optional[str] = None
    mode: Optional[str] = None
    default_duration_days: Optional[int] = None  # NEU
