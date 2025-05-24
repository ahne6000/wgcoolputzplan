from sqlmodel import SQLModel, Field, Session
from typing import Any, Dict, Optional
from datetime import datetime
from enum import Enum
from sqlmodel import SQLModel, Field
from typing import Optional, List
from sqlalchemy import Column, select
from sqlmodel import JSON
from app.enums import TaskMode, TaskType


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
    iteration: int = 0  # iteration of that task (everytime anything has changed, increasing this number)

    default_duration_days: int = 7
    credits: int = 1
    task_type: TaskType = TaskType.free
    mode: TaskMode = TaskMode.recurring
    escalation_level: int = 0  # default 0, kann erhöht werden
    duration_modifier: int = 0  # NEU

    last_completed_at: Optional[datetime] = None
    last_done_by: Optional[int] = Field(default=None, foreign_key="user.id")
    before_last_done_by: Optional[int] = Field(default=None, foreign_key="user.id")
    times_completed: int = 0
    remaining_days : int = 0

    blacklist: Optional[List[int]] = Field(default_factory=list, sa_column=Column(JSON))

    user_id: Optional[int] = Field(default=None, foreign_key="user.id")


    def get_blacklist(self) -> List[int]:
            return self.blacklist or []

    def is_user_blacklisted(self, user_id: int) -> bool:
        return user_id in (self.blacklist or [])

    def add_to_blacklist(self, user_id: int):
        if not self.blacklist:
            self.blacklist = []
        if user_id not in self.blacklist:
            self.blacklist.append(user_id)

    def remove_from_blacklist(self, user_id: int):
        if self.blacklist and user_id in self.blacklist:
            self.blacklist.remove(user_id)

    def get_version_no(self) -> int:
        return self.iteration
    
    def get_next_version(self) -> int: 
        return self.iteration+1
    '''
    def get_next_version(self, session: Session) -> int:
        latest_version = session.exec(
            select(TaskVersion)
            .where(TaskVersion.task_id == self.id)
            .order_by(TaskVersion.version.desc())
        ).first()
        return latest_version.version + 1 if latest_version else 1
    '''


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


class TaskVersion(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="task.id")
    version: int
    user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    user_name: Optional[str] = None
    action: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)  # ✅ korrekt!
    data: Dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
