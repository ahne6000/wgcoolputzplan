from enum import Enum

class TaskType(str, Enum):
    free = "free_rotating"
    assigned = "assigned_rotating"
    one_time = "one_time"


