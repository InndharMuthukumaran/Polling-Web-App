"""Application settings and configuration."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    @property
    def cors_origins_list(self) -> list[str]:
        """Return CORS origins as a trimmed list of strings."""
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
