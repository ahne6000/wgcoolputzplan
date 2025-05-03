from sqlmodel import SQLModel
from typing import Optional
from datetime import datetime
from app.models import TaskType, TaskMode

class TaskCreate(SQLModel):
    title: str
    description: Optional[str] = None
    due_date: Optional[datetime] = None
    default_duration_days: int = 7
    credits: int = 1
    task_type: TaskType = TaskType.free
    mode: TaskMode = TaskMode.recurring
    urgency_level: int = 0
    user_id: Optional[int] = None

class TaskRead(SQLModel):
    id: int
    title: str
    description: Optional[str]
    due_date: Optional[datetime]
    default_duration_days: int
    credits: int
    task_type: TaskType
    mode: TaskMode
    urgency_level: int
    escalation_level: int = 0  # default 0, kann erhöht werden

    user_id: Optional[int]
    is_done: bool
    created_at: datetime
    last_completed_at: Optional[datetime]

    class Config:
        from_attributes = True

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
