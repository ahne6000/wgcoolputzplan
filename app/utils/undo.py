from datetime import datetime
from sqlmodel import Session
from typing import Any

def apply_task_version(task, version_obj, session: Session):
    """
    Überträgt die gespeicherten Felder aus einer TaskVersion zurück auf das Task-Objekt.
    Unterstützt automatische Konvertierung von ISO-Strings in datetime.
    """
    data: dict[str, Any] = version_obj.data

    for key, value in data.items():
        if hasattr(task, key):
            # Optional: ISO8601-String zu datetime
            if isinstance(value, str) and "T" in value:
                try:
                    value = datetime.fromisoformat(value)
                except ValueError:
                    pass  # kein gültiges Datum, lass es als String
            setattr(task, key, value)

    session.add(task)
    session.commit()
    session.refresh(task)
