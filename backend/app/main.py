"""FastAPI application initialization, middleware, routes, and error handlers."""

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_error_handlers
from app.api.routes import fields, groups, health, imports, join, me, polls
from app.config import settings

app = FastAPI(
    title="Polling App API",
    description="HTTP API for advanced group polling tool",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register custom exception handlers for domain and integrity errors
register_error_handlers(app)

# Health router (root level: /health, /health/db)
app.include_router(health.router)

# API v1 Router
api_v1 = APIRouter(prefix="/api/v1")
api_v1.include_router(groups.router)
api_v1.include_router(fields.router)
api_v1.include_router(imports.router)
api_v1.include_router(join.router)
api_v1.include_router(me.router)
api_v1.include_router(polls.router)

app.include_router(api_v1)
