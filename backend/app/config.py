"""Application settings and configuration."""

from typing import Any
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_database_url(url: str | None) -> str | None:
    """Normalise database URLs to postgresql+psycopg scheme if postgresql."""
    if not url:
        return url
    if url.startswith("postgresql+psycopg://"):
        return url
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://") :]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


def normalize_cors_origin(origin: str) -> str:
    """Clean a single CORS origin string: trim spaces, remove one trailing slash."""
    trimmed = origin.strip()
    if trimmed.endswith("/"):
        trimmed = trimmed[:-1]
    return trimmed


def parse_cors_origins(raw: str | list[str]) -> list[str]:
    """Parse comma-separated CORS origins: trim spaces, drop empty items, remove one trailing slash."""
    if isinstance(raw, list):
        items = raw
    else:
        items = raw.split(",")
    result: list[str] = []
    for item in items:
        cleaned = normalize_cors_origin(item)
        if cleaned:
            result.append(cleaned)
    return result


class Settings(BaseSettings):
    """Application settings loaded from environment variables and .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = Field(
        default="postgresql+psycopg://postgres:postgres@localhost:5432/polls_db",
        alias="DATABASE_URL",
    )
    test_database_url: str = Field(
        default="postgresql+psycopg://postgres:postgres@localhost:5432/polls_test_db",
        alias="TEST_DATABASE_URL",
    )
    cors_origins: str = Field(
        default="http://localhost:5173",
        alias="CORS_ORIGINS",
    )
    trusted_proxy_count: int = Field(
        default=0,
        alias="TRUSTED_PROXY_COUNT",
    )
    lookup_limit_per_ip: int = Field(
        default=30,
        alias="LOOKUP_LIMIT_PER_IP",
    )
    lookup_limit_per_code: int = Field(
        default=300,
        alias="LOOKUP_LIMIT_PER_CODE",
    )

    @field_validator("database_url", "test_database_url", mode="before")
    @classmethod
    def _normalize_db_url(cls, v: Any) -> Any:
        if isinstance(v, str):
            return normalize_database_url(v)
        return v

    @property
    def cors_origins_list(self) -> list[str]:
        """Return CORS origins as a trimmed list of strings."""
        return parse_cors_origins(self.cors_origins)


settings = Settings()
