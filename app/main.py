from fastapi import FastAPI
from app.database import create_db_and_tables, set_logging_sql
from app.routes import users, tasks, logs, backup
from app.utils.logging import log_task_action
import logging
app = FastAPI()


putzplanVersion="0.7.dev"

@app.on_event("startup")
def on_startup():
    set_logging_sql(logging.WARNING)  # oder logging.DEBUG
    create_db_and_tables()


app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(tasks.router, prefix="/api/tasks", tags=["tasks"])
app.include_router(logs.router, prefix="/api/logs", tags=["logs"])
app.include_router(backup.router, prefix="/api/backup", tags=["backup"])


@app.get("/api/putzplanVersion")
def getPutzplanVersion():
    return {"message": putzplanVersion}

@app.get("/api/ping")
def ping():
    return {"message": "pong"}
