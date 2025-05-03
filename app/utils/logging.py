from datetime import datetime
from app.models import TaskLog
from typing import Optional


def log_task_action(session, task_id: int, action: str, user_name: Optional[str] = None, user_id: Optional[int] = None):
    log_entry = TaskLog(
        task_id=task_id,
        user_id=user_id,
        user_name=user_name,
        action=action,
        timestamp=datetime.utcnow()
    )
    session.add(log_entry)

