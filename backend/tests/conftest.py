"""Pytest fixtures and database setup for the polling test suite."""

import os
from pathlib import Path
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from alembic.config import Config
from app.config import settings
from app.db import Base


def pytest_configure(config):
    """Validate that TEST_DATABASE_URL is properly configured before running tests."""
    test_db_url = os.environ.get("TEST_DATABASE_URL")
    if not test_db_url:
        pytest.exit(
            "TEST_DATABASE_URL is not set. Tests require a PostgreSQL test database.",
            returncode=1,
        )

    app_db_url = os.environ.get("DATABASE_URL", settings.database_url)
    if test_db_url == app_db_url:
        pytest.exit(
            "TEST_DATABASE_URL must not be the same as DATABASE_URL. Test cleanup deletes all rows.",
            returncode=1,
        )


@pytest.fixture(scope="session")
def test_engine_and_url():
    """Create test engine and apply Alembic migrations to head on PostgreSQL."""
    test_db_url = os.environ.get("TEST_DATABASE_URL")
    if not test_db_url:
        pytest.exit(
            "TEST_DATABASE_URL is not set. Tests require a PostgreSQL test database.",
            returncode=1,
        )

    app_db_url = os.environ.get("DATABASE_URL", settings.database_url)
    if test_db_url == app_db_url:
        pytest.exit(
            "TEST_DATABASE_URL must not be the same as DATABASE_URL. Test cleanup deletes all rows.",
            returncode=1,
        )

    # Connect to PostgreSQL - any failure raises an exception and fails the test run
    engine = create_engine(test_db_url, echo=False)
    with engine.connect() as connection:
        pass

    # Run Alembic migrations to create schema on the test engine connection
    backend_dir = Path(__file__).resolve().parent.parent
    alembic_ini_path = backend_dir / "alembic.ini"
    alembic_cfg = Config(str(alembic_ini_path))
    alembic_cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", test_db_url)

    with engine.begin() as connection:
        alembic_cfg.attributes["connection"] = connection
        command.upgrade(alembic_cfg, "head")

    yield engine, test_db_url

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
