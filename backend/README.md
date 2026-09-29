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

Install the dependencies:
```bash
pip install -e .
```
Or install via requirements directly:
```bash
pip install "sqlalchemy>=2.0.0" "alembic>=1.13.0" "psycopg[binary]>=3.1.0" "pydantic-settings>=2.0.0" "pytest>=8.0.0"
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

# Test database URL
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

Run the full pytest suite:
```bash
cd backend
pytest
```
Or:
```bash
python -m pytest
```

When `TEST_DATABASE_URL` is set to a PostgreSQL database, tests execute against that database and wipe all data in reverse topological order between test runs. If `TEST_DATABASE_URL` is omitted or PostgreSQL is unreachable, the test suite falls back to an isolated in-memory database to allow immediate hermetic local verification.
