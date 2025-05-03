from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy.pool import StaticPool

sqlite_file_name = "putzplan.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

engine = create_engine(
    sqlite_url,
    echo=True,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

def get_session():
    return Session(engine)
