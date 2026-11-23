# Repo map

One line per file: what it's for. Update this file whenever files are added, removed, or change role.
Not listed: `node_modules/`, `__pycache__/`, `.pytest_cache/`, `dist/`, `.venv/`, `backend/polling_backend.egg-info/` (generated), `backend/alembic/versions/*` (migrations — see the list at the end instead), `frontend/package-lock.json`, `frontend/tsconfig.tsbuildinfo` (generated), `*.test.ts(x)` are listed next to the file they test, not separately described.

## Root

- `.gitignore` — ignored paths (build artifacts, node_modules, venvs, tsbuildinfo).
- `render.yaml` — Render blueprint: backend web service (free plan), build/start commands, env vars.
- `scripts/smoke_test.py` — standalone script to check a deployed API + web app (health, CORS, a real group round-trip).
- `docs/PROJECT_BRIEF.md` — the living spec: decisions, open questions, status log. Read this first in a new session.
- `docs/ASSUMPTIONS.md` — per-part log of choices the coding agent made where the prompt was ambiguous.
- `docs/DEPLOYMENT.md` — human step-by-step guide: Neon + Render + Vercel.
- `docs/REPO_MAP.md` — this file.

## Backend (`backend/`) — FastAPI + SQLAlchemy + PostgreSQL

- `pyproject.toml` — package metadata and dependencies (`pip install .` for prod deps, `.[dev]` adds pytest).
- `alembic.ini`, `alembic/env.py`, `alembic/script.py.mako` — migration runner config/template.
- `alembic/versions/` — ordered migrations: `001_initial_schema` (groups/members/polls/votes/history) → `002_identity` (tokens, join codes, claims) → `003_group_fields` (custom fields, identifier) → `004_claim_settings` (allow_name_list) → `005_display_format` (built-in Name field, display_format). Always add new ones here, never edit old ones.
- `.env.example` — `DATABASE_URL`, `TEST_DATABASE_URL`, `CORS_ORIGINS`, `TRUSTED_PROXY_COUNT`.
- `README.md` — install/run/test commands.

### `app/`
- `main.py` — FastAPI app, CORS, router mounting, error handlers.
- `config.py` — settings (pydantic-settings); normalises `postgres://`→`postgresql+psycopg://` and `CORS_ORIGINS`.
- `db.py` — engine/session factory.
- `models.py` — SQLAlchemy models: Group, Member, Poll, PollOption, Vote, VoteHistory, GroupField, PollField, PollIncludedField, PollAnswer. All group/poll/member foreign keys are `ON DELETE CASCADE`.
- `errors.py` — domain exceptions (`PollValidationError`, `GroupNotFoundError`, `PollClosedError`, `ClaimConflictError`, etc.), each mapped to an HTTP status in `api/errors.py`.
- `security.py` — token generation/hashing (admin + member tokens), join-code generation.
- `ratelimit.py` — in-memory rate limiter used by the identifier-lookup endpoint (counts only failed lookups; per-IP and per-join-code windows; periodic cleanup).
- `limits.py` — single source of truth for every numeric cap (field/question/choice counts, import size, members-per-request); exposed read-only via `/api/v1/limits`.

### `app/services/` — all business rules live here, never in routes
- `polls.py` — poll/option/vote/history rules: cast/remove vote, status categories (at_target/behind_target/excused/not_voted), lateness, all_reached, close/reopen, poll delete, results rows (JSON/CSV/XLSX with formula-injection protection).
- `identity.py` — groups, admin/member auth, member CRUD, claim/approve/reset/release, member delete (single + bulk), group delete (name-confirmation required).
- `fields.py` — group field CRUD + value validation per type (text/number/choice/link), identifier marking, **built-in `_name` field**, **display_format validation + `compute_display_name`**, public-label masking.
- `importer.py` — xlsx/csv parsing (openpyxl/csv), column-mapping suggestion, dry-run/real import, new-field-from-column creation, roster export, template generation.

### `app/api/`
- `deps.py` — FastAPI dependencies: DB session per request, admin-token auth (group/poll scoped), member-token auth, client-IP resolution (trusted-proxy aware).
- `schemas.py` — all Pydantic request/response models.
- `errors.py` — maps domain exceptions → HTTP status + `{"error":{"code","message","details"?}}`.
- `routes/health.py` — `/health` (no DB), `/health/db` (pings DB).
- `routes/groups.py` — group CRUD, settings (`require_claim_approval`, `allow_name_list`, `display_format`), member CRUD incl. bulk add/delete, approve/reset, group delete, roster export.
- `routes/fields.py` — group field CRUD.
- `routes/join.py` — public join-info, identifier lookup (rate-limited), claim, release.
- `routes/me.py` — member identity (`/me`), member's polls.
- `routes/polls.py` — poll create/list/get, vote/remove-vote, answers (poll-only fields), status, history, results, close/reopen/delete.
- `routes/imports.py` — template download, import preview, import.
- `routes/limits.py` — `GET /api/v1/limits` (public).

### `tests/` (PostgreSQL only — no SQLite fallback; `TEST_DATABASE_URL` required and must differ from `DATABASE_URL`)
- `conftest.py` — DB session fixture + FastAPI `TestClient` fixture, cleans all tables between tests.
- `test_polls.py` — Part 1 rules engine.
- `test_identity.py`, `test_api_groups.py`, `test_api_join_me.py`, `test_api_release.py`, `test_claim_identifier.py` — Part 2A/2B/3C/R1b: tokens, claims, identifier lookup, release, rate limiting basics.
- `test_fields.py`, `test_api_fields.py`, `test_importer.py`, `test_api_import.py` — Part R1a/R2: custom fields, bulk import.
- `test_poll_fields.py`, `test_api_poll_fields.py` — Part R3: poll-included fields, poll-only fields, answers, results.
- `test_ratelimit.py` — Part R2c: failed-lookup-only counting, trusted-proxy IP resolution, cleanup.
- `test_config.py` — Part D1: URL/CORS normalisation.
- `test_part_fa.py` — Part FA: limits constants, reopen.
- `test_part_fb.py` — Part FB: member/poll/group delete, bulk delete, roster export.
- `test_display_format.py`, `test_api_display_format.py` — Part C1: built-in field, display_format, compute_display_name, public masking.

## Frontend (`frontend/`) — React + Vite + TypeScript + Tailwind (no other UI/state libs)

- `package.json`, `vite.config.ts`, `tsconfig.json` — build/test config (Vitest + Testing Library).
- `vercel.json` — SPA rewrite (all paths → index.html) + security headers.
- `.env.example`, `.env.production.example` — `VITE_API_BASE_URL`.
- `index.html`, `src/main.tsx`, `src/vite-env.d.ts`, `src/index.css` — app bootstrap.
- `src/App.tsx` — router: `/`, `/g/:groupId`, `/g/:groupId/roster`, `/g/:groupId/polls/new`, `/g/:groupId/polls/:pollId`, `/join/:joinCode`, `/p/:pollId`, 404.
- `README.md` — install/run + manual smoke-test scripts (one section added per part).

### `src/api/`
- `client.ts` (+ `.test.ts`) — `fetch` wrapper, `ApiError` (status/code/details), FormData/blob support, trailing-slash-safe base URL.
- `types.ts` — every request/response TypeScript type (kept in lockstep with `backend/app/api/schemas.py`).
- `endpoints.ts` — one typed function per backend endpoint.

### `src/lib/` — pure, unit-tested helper functions (no React)
- `storage.ts` / `adminStorage.ts` — member identity / admin-token persistence (localStorage with in-memory fallback, cross-tab `storage` event sync).
- `time.ts` — date formatting, deadline description.
- `pollForm.ts` — poll-creation validation + payload building (free-form options with roles, included fields, poll-only fields).
- `rosterForm.ts` — member add/edit form validation per field type.
- `importMapping.ts` — column→field mapping request building + validation for the import wizard.
- `results.ts` — results-table filtering, column value lookup, copy-line formatting (`Name (identifier)`).
- `messages.ts` — "Copy announcement"/"Copy reminder" text builders.
- `answersForm.ts` — poll-only-field answer form: defaults, validation, full-payload building.

### `src/components/`
- `Button.tsx`, `Card.tsx`, `Badge.tsx`, `Banner.tsx`, `Spinner.tsx` — small generic UI pieces.
- `ConfirmDialog.tsx` (+ `.test.tsx`) — shared accessible confirm/destructive-action dialog (Escape/backdrop/Cancel, focus management). Used for all deletes, close/reopen, reset.
- `NameClaimList.tsx` — pick-a-name-from-a-list claim UI (used when `claim_mode` is "list" or `allow_name_list` is on).
- `IdentifierClaim.tsx` (+ `.test.tsx`) — "type your identifier → is this you? → claim" flow (used when `claim_mode` is "identifier").
- `SwitchNameAction.tsx` — "Not you? Switch name" (releases the current claim).
- `PollAnswersCard.tsx` — member-facing form for a poll's own questions (poll_fields), shown on `PollPage`.
- `roster/FieldsTab.tsx` — group fields manager (add/edit/delete, identifier toggle, built-in Name field handling).
- `roster/MembersTab.tsx` — member table/cards: search, filter, pagination, bulk select, delete/deactivate, quick-add.
- `roster/MemberModal.tsx` — add/edit-member dialog (one input per field type).
- `roster/ImportTab.tsx` — spreadsheet import wizard (upload → map → check (dry run) → import).

### `src/pages/`
- `HomePage.tsx` (+ `.test.tsx`) — create group / connect to existing group (admin token entry, "save your access" screen).
- `DashboardPage.tsx` (+ `.test.tsx`) — group overview: share links, settings (approval/name-list toggles), roster summary, polls list, danger zone (delete group).
- `RosterPage.tsx` (+ `.test.tsx`) — hosts the three roster tabs (Fields/Members/Import) + roster export menu.
- `NewPollPage.tsx` (+ `.test.tsx`) — poll creation form (free-form options+roles, deadline note, included roster columns, poll-only questions).
- `AdminPollPage.tsx` (+ `.test.tsx`) — creator poll view: share/copy templates, status counts, defaulter lists (with identifiers), results table + export, voting history, close/reopen/delete.
- `JoinPage.tsx` (+ `.test.tsx`) — public `/join/:joinCode`: claim flow (list or identifier mode) + "your polls" once recognised.
- `PollPage.tsx` (+ `.test.tsx`) — public `/p/:pollId`: claim-if-needed, vote, poll-only-questions answer card, history, closed state.
- `NotFoundPage.tsx` — 404.
- `PartFB.test.tsx` — cross-cutting tests for Part FB (delete flows) spanning more than one page/component.

### `src/test/setup.ts` — Vitest/Testing Library global setup.

## Status

Written against commit `ac198f6` (feat(backend): built-in Name field and customisable display name format), immediately after the 3 test fixes in this same patch. Known not-yet-built feedback items (filters/sorting, poll audiences) and other open questions are tracked in `docs/PROJECT_BRIEF.md`, not here — this file only maps what exists.
