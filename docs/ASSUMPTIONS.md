# Assumptions and Design Decisions (Part 1)

This document captures assumptions and design decisions made for Part 1 (Database and rules engine).

## 1. Database and Environment
- **PostgreSQL Requirement**: PostgreSQL is strictly required for both application execution and automated test runs. The application utilizes `psycopg` (v3) with the `postgresql+psycopg://` URI scheme.
- **Test Database Configuration**:
  - The test suite requires the `TEST_DATABASE_URL` environment variable.
  - Tests run exclusively on PostgreSQL. There is no SQLite fallback:
    - If `TEST_DATABASE_URL` is unset, `pytest` terminates immediately via `pytest.exit`.
    - If connecting to `TEST_DATABASE_URL` fails, the connection error is raised and tests fail.
    - If `TEST_DATABASE_URL` is identical to `DATABASE_URL`, `pytest` terminates immediately to protect the application database from test truncation.
  - All test data is wiped across all tables in reverse topological order between tests.
- **Python Version**: The host environment runs Python 3.14.3. Code adheres strictly to Python 3.12+ typed standards (`datetime | None`, `list[str]`, typed ORM `Mapped[...]`).

## 2. Data Model & Integrity
- **UUID Primary Keys**: Every table uses a UUID primary key generated via standard `uuid.uuid4`.
- **Created At**: Every table includes a `created_at` timestamp with timezone (`DateTime(timezone=True)`), defaulting to UTC (`datetime.now(timezone.utc)`).
- **Vote History Constraints**:
  - `vote_history` records one row per `(poll_id, member_id, option_id)`.
  - When an option is voted on for the first time, `first_selected_at` and `last_selected_at` are set to `now`.
  - On subsequent re-selections of the same option (after switching away or removing), only `last_selected_at` is updated to `now`.
  - If a member re-selects an already active option, it is treated as a no-op: no timestamps or rows are modified.
- **Current Votes (`votes`)**:
  - Contains only the currently selected option(s) for a member in a given poll.
  - When an option is deselected (or replaced in single-choice mode), the corresponding `Vote` row is deleted. The `vote_history` row remains untouched.
- **Cascading Deletes**:
  - Child records (`poll_options`, `votes`, `vote_history`) use `ON DELETE CASCADE` referencing their parent `polls` and `members`.

## 3. Rules Engine & Concurrency
- **Concurrency & Row Locking**:
  - In `cast_vote` and `remove_vote`, the poll row is locked at the start of the transaction via `select(Poll).where(Poll.id == pid).with_for_update()`.
  - This serializes concurrent vote operations on the poll, ensuring that simultaneous requests from the same member cannot bypass single-choice constraints and leave multiple active selections.
- **Option Validation**:
  - Poll creation requires at least 2 options.
  - Option labels within a poll must be unique (case-sensitive check).
  - At least one option must have the role `target`.
  - Roles are restricted to: `target`, `in_progress`, `excused`, `not_yet`.
- **Active Member Scope**:
  - Only active members (`is_active == True`) belonging to the poll's group (`member.group_id == poll.group_id`) are considered in status categorization and `all_reached`.
  - Inactive members or members from different groups are rejected when casting votes (`MemberInactiveError`, `MemberGroupMismatchError`).
- **Poll Status Categorization**:
  - Order of precedence is strictly applied:
    1. `at_target`: member currently holds at least one option with role `target`.
    2. `excused`: member currently holds at least one option with role `excused`.
    3. `behind_target`: member currently holds at least one option with role `in_progress` or `not_yet`.
    4. `not_voted`: member has no active selections.
  - If a member in multiple-choice mode selects both `target` and `excused`, `at_target` wins.
  - If a member selects both `excused` and `not_yet`, `excused` wins.
  - If a member selects both `in_progress` and `not_yet`, they appear in `behind_target`.
- **Completion Time and Lateness Calculation**:
  - For members categorized as `at_target`, all currently selected `target` options are examined.
  - For each such option, the relevant timestamp from `vote_history` is taken:
    - If `poll.completion_time_mode == 'first'`, uses `first_selected_at`.
    - If `poll.completion_time_mode == 'last'`, uses `last_selected_at`.
  - If multiple `target` options are selected, `completed_at` is the earliest (`min`) of those timestamps.
  - `late` is evaluated as `poll.deadline is not None and completed_at > poll.deadline`.
- **All Reached**:
  - Evaluated on active members only.
  - Returns `False` if there are 0 active members in the group.
  - Returns `False` if 0 members are `at_target` (e.g. everyone is excused).
  - Returns `True` if every active member is in either `at_target` or `excused`, and at least one is in `at_target`.
- **Poll Closing**:
  - Calling `close_poll` sets `status = 'closed'` and `closed_at = now`.
  - Closing an already closed poll is idempotent: it does not raise an error and leaves timestamps intact.
  - Once closed, `cast_vote` and `remove_vote` raise `PollClosedError`.
  - Reads (`get_poll_status`, `get_member_history`, `all_reached`) remain functional after closing.
- **Timezone Standardization**:
  - All timestamps passed into or generated by the service layer are normalized to timezone-aware UTC.

# Assumptions and Design Decisions (Part 2A: Identity Layer)

This section captures assumptions and design decisions made for Part 2A (Identity Layer).

## 1. Token Security & Hashing
- **Generation**:
  - Admin tokens and member tokens are cryptographically secure random strings generated via `secrets.token_urlsafe(32)`.
  - Group join codes are unguessable URL-safe strings generated via `secrets.token_urlsafe(9)`.
- **Zero Plain-Text Token Storage**:
  - Plain tokens are returned only upon initial creation/claim and are never stored in the database, logged, or exposed in any subsequent query.
  - Only fast cryptographic digests (`hashlib.sha256(token.encode('utf-8')).hexdigest()`) are stored in `groups.admin_token_hash` and `members.member_token_hash`.
  - Comparison of computed hashes against stored hashes in Python uses `hmac.compare_digest` to prevent timing side-channel attacks.
- **Join Codes**:
  - Join codes are stored as plain text strings with unique constraints on the `groups` table, enabling direct lookup via `get_group_by_join_code`.

## 2. Database Schema & Migration (002_identity)
- **Groups Table**:
  - `join_code`: String, unique, non-null. The migration first adds `join_code` as nullable, generates unique join codes in Python for any pre-existing groups, and then alters the column to `nullable=False` and applies a unique index.
  - `admin_token_hash`: String, nullable. Groups created via the legacy `create_group` have `admin_token_hash=None`.
  - `require_claim_approval`: Boolean, default `False`, non-null.
- **Members Table**:
  - `claim_status`: String, default `'unclaimed'`, non-null, with a check constraint enforcing values in `('unclaimed', 'pending', 'approved')`.
  - `member_token_hash`: String, nullable, unique.
  - `claimed_at`: Timestamp with timezone (`DateTime(timezone=True)`), nullable.
- **Downgrade Compatibility**:
  - Migration downgrade cleanly removes the added columns and constraints, returning the schema to `001_initial_schema`.

## 3. Claim Lifecycle & State Machine
- **Immediate vs Approval-Required Claims**:
  - When `group.require_claim_approval == False`, claiming a member immediately sets `claim_status = 'approved'`.
  - When `group.require_claim_approval == True`, claiming a member sets `claim_status = 'pending'`.
- **Approval Flow (`approve_claim`)**:
  - Transitions `claim_status` from `'pending'` to `'approved'`.
  - Calling `approve_claim` on a member already in `'approved'` state is idempotent and safe (no-op).
  - Calling `approve_claim` on an `'unclaimed'` member raises `ClaimStateError`.
- **Reset Flow (`reset_claim`)**:
  - Creator can reset any member claim regardless of current status (`'unclaimed'`, `'pending'`, or `'approved'`).
  - Resets `claim_status = 'unclaimed'`, clears `member_token_hash = None`, and clears `claimed_at = None`.
  - This immediately revokes and invalidates any previously issued member token (`authenticate_member` will raise `InvalidTokenError`).
  - **Vote & History Preservation**: Resetting a claim does NOT delete or alter any existing `votes` or `vote_history` records. Whoever claims the name next inherits the member's complete voting history.

## 4. Concurrency & Row Locking
- **Member Claim Concurrency**:
  - In `claim_member`, `approve_claim`, and `reset_claim`, the member row is locked using `select(Member).where(...).with_for_update()`.
  - Under PostgreSQL's default `Read Committed` isolation level, if two threads attempt to claim the same unclaimed member concurrently, the second thread blocks until the first transaction commits.
  - Once the first transaction commits (transitioning the member to `'approved'` or `'pending'`), the second transaction unblocks, re-evaluates the updated row, detects `claim_status != 'unclaimed'`, and cleanly raises `ClaimConflictError`.
  - Verified via a multi-threaded PostgreSQL test (`test_concurrent_claims_on_same_member`).

## 5. Member Scoping & Validation
- **Bulk Add (`add_members_bulk`)**:
  - All-or-nothing validation: input names are trimmed; empty/whitespace names, duplicate names within the request list, or names matching existing members in the group raise `PollValidationError` and insert 0 rows.
- **Update Member (`update_member`)**:
  - Renaming validates that the trimmed name is non-empty and does not collide with another member in the same group.
  - Updating without modifying attributes (`display_name=None, is_active=None`) returns the member unchanged without error.
  - Accessing a member belonging to a different group raises `PermissionDeniedError`.

