from datetime import datetime
from sqlalchemy import select
from sqlmodel import Session
from app.models import TaskLog
from typing import Optional

from app.models import TaskVersion



def log_task_action(session, task_id: int, action: str, user_name: Optional[str] = None, user_id: Optional[int] = None):
    log_entry = TaskLog(
        task_id=task_id,
        user_id=user_id,
        user_name=user_name,
        action=action,
        timestamp=datetime.utcnow()
    )
    session.add(log_entry)

def auto_serialize(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    elif isinstance(obj, list):
        return [auto_serialize(item) for item in obj]
    elif isinstance(obj, dict):
        return {key: auto_serialize(val) for key, val in obj.items()}
    else:
        return obj

def log_task_version_auto(task, session, action: str, user_id: int = None, user_name: str = None):
    task.iteration += 1
    task_version = TaskVersion(
        task_id=task.id,
        version=task.iteration,
        user_id=user_id,
        user_name=user_name,
        action=action,
        data=auto_serialize(task.dict())
    )
    session.add(task_version)
    session.add(task)
    session.commit()
