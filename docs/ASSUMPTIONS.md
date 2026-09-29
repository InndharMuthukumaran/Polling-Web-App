# Assumptions and Design Decisions (Part 1)

This document captures assumptions and design decisions made for Part 1 (Database and rules engine).

## 1. Database and Environment
- **PostgreSQL Focus**: The application is designed for PostgreSQL as mandated by the prompt, utilizing `psycopg` (v3) with the `postgresql+psycopg://` URI scheme.
- **Test Database URL**:
  - The test suite uses the `TEST_DATABASE_URL` environment variable.
  - In development environments where a live PostgreSQL instance is not immediately active (or when running fast local hermetic tests), tests fall back to a SQLite database (`sqlite:///./test_polls.db` or memory) if `TEST_DATABASE_URL` is omitted or unconfigured. When `TEST_DATABASE_URL` is configured with PostgreSQL, tests run against PostgreSQL and clean up all tables between tests.
  - Database schema definitions (UUID, DateTime with timezone, CheckConstraints, UniqueConstraints) are written using generic SQLAlchemy 2.0 types to ensure 100% PostgreSQL fidelity while also being testable across dialects.
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

## 3. Rules Engine & Edge Cases
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
