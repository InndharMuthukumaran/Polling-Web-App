# Polling App Backend (Part 1: Database and Rules Engine)

Core backend database schema, Alembic migrations, service layer rules engine, and automated tests for the group-chat polling tool.

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
```

To set environment variables in your active shell:
- **Linux/macOS bash**:
  ```bash
  export DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/polls_db"
  export TEST_DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/polls_test_db"
  ```
- **Windows PowerShell**:
  ```powershell
  $env:DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/polls_db"
  $env:TEST_DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/polls_test_db"
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

## 4. Running Tests

Automated tests require a running PostgreSQL instance and a dedicated test database specified via `TEST_DATABASE_URL`:
- `TEST_DATABASE_URL` must be set in your environment. If unset, pytest exits immediately.
- `TEST_DATABASE_URL` must connect to a reachable PostgreSQL database; connection errors cause the test run to fail.
- `TEST_DATABASE_URL` must not be the same as `DATABASE_URL` because test cleanup truncates all tables between test executions.

Run the test suite:
```bash
cd backend
pytest
```
Or:
```bash
python -m pytest
```
