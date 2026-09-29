# Polling App Backend (Database, Rules Engine, and HTTP API)

Core backend database schema, Alembic migrations, service layer rules engine, FastAPI HTTP API, and automated tests for the group-chat polling tool.

---

## 1. Installation

Requires Python 3.12+ (tested on Python 3.14).

Create and activate a virtual environment (optional but recommended):
```bash
cd backend
python -m venv .venv

# On Linux/macOS:
source .venv/bin/activate

# On Windows PowerShell:
.\.venv\Scripts\Activate.ps1
```

Install the dependencies (including development/test dependencies):
```bash
pip install -e ".[dev]"
```

---

## 2. Environment Variables

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
(On Windows PowerShell):
```powershell
Copy-Item .env.example .env
```

Configure the environment variables in `.env` or in your shell:
```ini
# Production / development database URL
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/polls_db

# Test database URL (must be separate from DATABASE_URL)
TEST_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/polls_test_db

# CORS Allowed Origins (comma-separated list)
CORS_ORIGINS=http://localhost:5173
```

To set environment variables in your active shell:
- **Linux/macOS bash**:
  ```bash
  export DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/polls_db"
  export TEST_DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/polls_test_db"
  export CORS_ORIGINS="http://localhost:5173"
  ```
- **Windows PowerShell**:
  ```powershell
  $env:DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/polls_db"
  $env:TEST_DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/polls_test_db"
  $env:CORS_ORIGINS="http://localhost:5173"
  ```

---

## 3. Running Database Migrations

Apply all migrations up to `head` on an empty database:
```bash
cd backend
alembic upgrade head
```
Or run using python module:
```bash
python -m alembic upgrade head
```

To downgrade back to base:
```bash
python -m alembic downgrade base
```

---

## 4. Running the HTTP API

Start the FastAPI development server with auto-reload:
```bash
cd backend
uvicorn app.main:app --reload
```

Or using the Python module:
```bash
python -m uvicorn app.main:app --reload
```

Once running:
- **Interactive OpenAPI Documentation (Swagger UI)**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Alternative API Documentation (ReDoc)**: [http://localhost:8000/redoc](http://localhost:8000/redoc)
- **Health Check**: [http://localhost:8000/health](http://localhost:8000/health)
- **Database Health Check**: [http://localhost:8000/health/db](http://localhost:8000/health/db)

---

## 5. Running Tests

Automated tests require a running PostgreSQL instance and a dedicated test database specified via `TEST_DATABASE_URL`:
- `TEST_DATABASE_URL` must be set in your environment. If unset, pytest exits immediately.
- `TEST_DATABASE_URL` must connect to a reachable PostgreSQL database; connection errors cause the test run to fail.
- `TEST_DATABASE_URL` must not be the same as `DATABASE_URL` because test cleanup truncates all tables between test executions.

Run the entire test suite (Part 1, Part 2A, and Part 2B):
```bash
cd backend
pytest
```
Or:
```bash
python -m pytest
```
