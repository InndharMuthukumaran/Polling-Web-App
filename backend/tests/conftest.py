"""Pytest fixtures and database setup for the polling test suite."""

import os
from pathlib import Path
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from alembic.config import Config
from app.db import Base
from app.models import Group, Member, Poll, PollOption, Vote, VoteHistory


def get_test_engine():
    """Determine test database engine using TEST_DATABASE_URL or in-memory fallback."""
    test_db_url = os.environ.get("TEST_DATABASE_URL")

    if test_db_url:
        try:
            engine = create_engine(test_db_url, echo=False)
            with engine.connect() as conn:
                pass
            return engine, test_db_url
        except Exception:
            pass

    # Hermetic in-memory SQLite database with StaticPool
    fallback_url = "sqlite+pysqlite:///:memory:"
    from sqlalchemy.pool import StaticPool
    engine = create_engine(
        fallback_url,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        echo=False,
    )
    return engine, fallback_url


@pytest.fixture(scope="session")
def test_engine_and_url():
    """Create test engine and apply Alembic migrations to head."""
    engine, db_url = get_test_engine()

    # Enable foreign keys for SQLite
    if "sqlite" in db_url:
        @event.listens_for(engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    # Run Alembic migrations to create schema on the test engine connection
    backend_dir = Path(__file__).resolve().parent.parent
    alembic_ini_path = backend_dir / "alembic.ini"
    alembic_cfg = Config(str(alembic_ini_path))
    alembic_cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", db_url)

    with engine.begin() as connection:
        alembic_cfg.attributes["connection"] = connection
        command.upgrade(alembic_cfg, "head")

    yield engine, db_url

    engine.dispose()


@pytest.fixture(scope="session")
def test_engine(test_engine_and_url):
    """Provide the initialized test engine."""
    engine, _ = test_engine_and_url
    return engine


@pytest.fixture
def db_session(test_engine):
    """Provide an isolated database session that leaves no data behind after each test."""
    session_factory = sessionmaker(bind=test_engine, autocommit=False, autoflush=False)
    session: Session = session_factory()

    yield session

    session.rollback()
    session.close()

    # Clean up all data from tables in reverse dependency order
    with test_engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())
