from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy.pool import StaticPool
import logging

sqlite_file_name = "putzplan.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

def set_logging_sql(logging_level: int):
    logger = logging.getLogger("sqlalchemy.engine")
    logger.setLevel(logging_level)
    if not logger.hasHandlers():
        handler = logging.StreamHandler()
        handler.setLevel(logging_level)
        formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
        handler.setFormatter(formatter)
        logger.addHandler(handler)

engine = create_engine(
    sqlite_url,
    #echo=True,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    logging_name="sqlalchemy.engine",
)


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

def get_session():
    return Session(engine)
