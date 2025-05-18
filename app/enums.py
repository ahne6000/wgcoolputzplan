from enum import Enum

class TaskType(str, Enum):
    free = "free"
    assigned = "assigned"

class TaskMode(str, Enum):
    one_time = "one_time"
    recurring = "recurring"

