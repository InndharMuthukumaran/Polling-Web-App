"""Database connection and session handling."""

from collections.abc import Generator
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy declarative models."""

    pass


engine = create_engine(settings.database_url, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_session() -> Generator[Session, None, None]:
    """Provide a transactional database session."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def create_engine_for_url(database_url: str):
    """Create an engine for a custom database URL."""
    return create_engine(database_url, echo=False)


def create_session_factory(engine_instance):
    """Create a sessionmaker for a specific engine."""
    return sessionmaker(autocommit=False, autoflush=False, bind=engine_instance)
