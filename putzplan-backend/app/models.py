from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum as SAEnum, Text, Index
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.sqlite import JSON as SAJSON
from enum import Enum
from datetime import datetime
from sqlalchemy import UniqueConstraint, Boolean, DateTime
from sqlalchemy.dialects.sqlite import JSON as SAJSON

from .database import Base

class TaskType(str, Enum):
    ROTATING = "ROTATING"
    RECURRING_UNASSIGNED = "RECURRING_UNASSIGNED"
    ONE_OFF = "ONE_OFF"

class AssignmentStatus(str, Enum):
    PENDING = "PENDING"
    DONE = "DONE"

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    credits = Column(Integer, nullable=False, default=0)
    profile_picture_url = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

class Task(Base):
    __tablename__ = "tasks"
    id = Column(Integer, primary_key=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    task_type = Column(SAEnum(TaskType), nullable=False)
    interval_days = Column(Integer, nullable=True)
    points = Column(Integer, nullable=False, default=1)
    urgency_score = Column(Integer, nullable=False, default=0)
    rotation_user_ids = Column(SAJSON, nullable=True)  # nur bei ROTATING
    next_due_at = Column(DateTime, nullable=True)
    archived = Column(Boolean, nullable=False, default=False)
    archived_at = Column(DateTime, nullable=True)
    assignments = relationship("TaskAssignment", back_populates="task")

class TaskAssignment(Base):
    __tablename__ = "task_assignments"
    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    status = Column(SAEnum(AssignmentStatus), nullable=False, default=AssignmentStatus.PENDING)
    due_at = Column(DateTime, nullable=True)
    done_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    task = relationship("Task", back_populates="assignments")

Index("ix_task_assign_status", TaskAssignment.task_id, TaskAssignment.status)
Index("ix_task_assign_doneat", TaskAssignment.task_id, TaskAssignment.done_at)

class LogEntry(Base):
    __tablename__ = "logs"
    id = Column(Integer, primary_key=True)
    timestamp = Column(DateTime, nullable=False, default=datetime.utcnow)
    action = Column(String, nullable=False)  # z.B. MARK_DONE, ASSIGN_TASK, ADD_CREDIT, URG_UP ...
    actor_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    details = Column(SAJSON, nullable=True)   # freies JSON
    undo_data = Column(SAJSON, nullable=True) # was zum Rückgängig-machen nötig ist
    reversed_at = Column(DateTime, nullable=True)

class RotationSkip(Base):
    __tablename__ = "rotation_skips"
    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    count = Column(Integer, nullable=False, default=0)



class RotationOrderTemp(Base):
    __tablename__ = "rotation_order_temp"
    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False, index=True, unique=True)
    original_order = Column(SAJSON, nullable=False)  # z.B. [1,2,3,4]
    remaining = Column(Integer, nullable=False, default=0)  # noch so viele „Turns“, bis revert

    __table_args__ = (UniqueConstraint('task_id', name='uq_rotation_order_temp_task'), )

