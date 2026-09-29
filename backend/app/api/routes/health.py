"""Health check endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.schemas import HealthResponse

router = APIRouter(tags=["Health"])


@router.get("/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    """Liveness probe. Does not touch the database."""
    return HealthResponse(status="ok")


@router.get("/health/db", response_model=HealthResponse)
def health_db_check(session: Session = Depends(get_db)) -> HealthResponse:
    """Readiness probe. Executes a lightweight query against PostgreSQL."""
    session.execute(text("SELECT 1"))
    return HealthResponse(status="ok")
