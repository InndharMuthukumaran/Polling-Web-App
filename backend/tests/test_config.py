"""Tests for configuration URL and CORS normalisation."""

import pytest
from app.config import (
    Settings,
    normalize_cors_origin,
    normalize_database_url,
    parse_cors_origins,
)


class TestDatabaseUrlNormalisation:
    def test_postgres_scheme_rewritten(self):
        raw = "postgres://user:secret@ep-demo.neon.tech/mydb"
        expected = "postgresql+psycopg://user:secret@ep-demo.neon.tech/mydb"
        assert normalize_database_url(raw) == expected

    def test_postgresql_scheme_rewritten(self):
        raw = "postgresql://user:secret@ep-demo.neon.tech/mydb"
        expected = "postgresql+psycopg://user:secret@ep-demo.neon.tech/mydb"
        assert normalize_database_url(raw) == expected

    def test_already_correct_scheme_preserved(self):
        raw = "postgresql+psycopg://user:secret@localhost:5432/polls_db"
        assert normalize_database_url(raw) == raw

    def test_extra_query_parameters_preserved(self):
        raw_postgres = (
            "postgres://user:secret@ep-demo.neon.tech/mydb?sslmode=require&channel_binding=require"
        )
        expected_postgres = (
            "postgresql+psycopg://user:secret@ep-demo.neon.tech/mydb?sslmode=require&channel_binding=require"
        )
        assert normalize_database_url(raw_postgres) == expected_postgres

        raw_postgresql = (
            "postgresql://user:secret@ep-demo.neon.tech/mydb?sslmode=require&application_name=polling"
        )
        expected_postgresql = (
            "postgresql+psycopg://user:secret@ep-demo.neon.tech/mydb?sslmode=require&application_name=polling"
        )
        assert normalize_database_url(raw_postgresql) == expected_postgresql

    def test_other_drivers_untouched(self):
        assert normalize_database_url("sqlite:///test.db") == "sqlite:///test.db"
        assert normalize_database_url("mysql://user:pass@localhost/db") == "mysql://user:pass@localhost/db"
        assert (
            normalize_database_url("mysql+pymysql://user:pass@localhost/db")
            == "mysql+pymysql://user:pass@localhost/db"
        )

    def test_none_or_empty_preserved(self):
        assert normalize_database_url(None) is None
        assert normalize_database_url("") == ""

    def test_settings_normalises_database_and_test_database_urls(self, monkeypatch):
        s = Settings(
            DATABASE_URL="postgres://neon_user:pw@neon.tech/prod",
            TEST_DATABASE_URL="postgresql://neon_user:pw@neon.tech/test",
        )
        assert s.database_url == "postgresql+psycopg://neon_user:pw@neon.tech/prod"
        assert s.test_database_url == "postgresql+psycopg://neon_user:pw@neon.tech/test"


class TestCorsOriginsNormalisation:
    def test_default_cors_origins(self):
        s = Settings()
        assert s.cors_origins_list == ["http://localhost:5173"]

    def test_spaces_trimmed(self):
        raw = "   http://localhost:5173   ,   https://poll.example.com   "
        assert parse_cors_origins(raw) == [
            "http://localhost:5173",
            "https://poll.example.com",
        ]

    def test_trailing_slashes_removed(self):
        raw = "http://localhost:5173/,https://poll.example.com/"
        assert parse_cors_origins(raw) == [
            "http://localhost:5173",
            "https://poll.example.com",
        ]

    def test_removes_only_one_trailing_slash(self):
        raw = "https://poll.example.com//"
        assert parse_cors_origins(raw) == ["https://poll.example.com/"]

    def test_empty_items_dropped(self):
        raw = "http://localhost:5173, , ,, https://poll.example.com, "
        assert parse_cors_origins(raw) == [
            "http://localhost:5173",
            "https://poll.example.com",
        ]

    def test_empty_string_yields_empty_list(self):
        assert parse_cors_origins("") == []
        assert parse_cors_origins("   ,   ") == []

    def test_normalize_cors_origin_helper(self):
        assert normalize_cors_origin("  https://my-origin.com/  ") == "https://my-origin.com"
        assert normalize_cors_origin("https://my-origin.com") == "https://my-origin.com"

    def test_settings_cors_origins_property(self):
        s = Settings(CORS_ORIGINS=" https://app.vercel.app/ , http://localhost:5173/ ")
        assert s.cors_origins_list == [
            "https://app.vercel.app",
            "http://localhost:5173",
        ]


class TestDeploymentConfigs:
    def test_render_yaml_valid_and_matches_spec(self):
        import json
        from pathlib import Path

        try:
            import yaml
            has_yaml = True
        except ImportError:
            has_yaml = False

        root_dir = Path(__file__).resolve().parent.parent.parent
        render_path = root_dir / "render.yaml"
        assert render_path.exists(), "render.yaml must exist at repo root"

        content = render_path.read_text(encoding="utf-8")
        if has_yaml:
            data = yaml.safe_load(content)
            assert "services" in data
            assert len(data["services"]) == 1
            service = data["services"][0]
            assert service["type"] == "web"
            assert service["runtime"] == "python"
            assert service["plan"] == "free"
            assert service["region"] == "singapore"
            assert service["rootDir"] == "backend"
            assert service["buildCommand"] == "pip install ."
            assert service["startCommand"] == (
                "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT"
            )
            assert service["healthCheckPath"] == "/health"

            env_vars = {item["key"]: item for item in service["envVars"]}
            assert str(env_vars["PYTHON_VERSION"]["value"]) == "3.12.8"
            assert int(env_vars["TRUSTED_PROXY_COUNT"]["value"]) == 1
            assert env_vars["DATABASE_URL"]["sync"] is False
            assert env_vars["CORS_ORIGINS"]["sync"] is False
        else:
            assert "type: web" in content
            assert "runtime: python" in content
            assert "plan: free" in content
            assert "region: singapore" in content
            assert "rootDir: backend" in content
            assert "buildCommand: pip install ." in content
            assert (
                "startCommand: alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT"
                in content
            )
            assert "healthCheckPath: /health" in content
            assert "PYTHON_VERSION" in content
            assert "3.12.8" in content
            assert "TRUSTED_PROXY_COUNT" in content
            assert "sync: false" in content

    def test_vercel_json_valid_and_matches_spec(self):
        import json
        from pathlib import Path

        root_dir = Path(__file__).resolve().parent.parent.parent
        vercel_path = root_dir / "frontend" / "vercel.json"
        assert vercel_path.exists(), "frontend/vercel.json must exist"

        content = vercel_path.read_text(encoding="utf-8")
        data = json.loads(content)

        assert "rewrites" in data
        assert any(r.get("destination") == "/index.html" for r in data["rewrites"])

        assert "headers" in data
        all_headers = {}
        for block in data["headers"]:
            for h in block.get("headers", []):
                all_headers[h["key"]] = h["value"]

        assert all_headers.get("X-Content-Type-Options") == "nosniff"
        assert all_headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
        assert all_headers.get("X-Frame-Options") == "DENY"

    def test_env_production_example_exists_and_matches_spec(self):
        from pathlib import Path

        root_dir = Path(__file__).resolve().parent.parent.parent
        example_path = root_dir / "frontend" / ".env.production.example"
        assert example_path.exists(), "frontend/.env.production.example must exist"
        content = example_path.read_text(encoding="utf-8")
        assert "VITE_API_BASE_URL=https://your-api-name.onrender.com" in content
