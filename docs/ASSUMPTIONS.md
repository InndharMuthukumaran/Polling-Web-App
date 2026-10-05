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

# Assumptions and Design Decisions (Part 2B: HTTP API)

This section captures assumptions and design decisions made for Part 2B (FastAPI HTTP API layer).

## 1. Architecture & Thin Routes
- **No Business Logic in API Layer**:
  - The API layer handles HTTP protocol concerns exclusively: header extraction, request validation, calling service functions in `app/services/identity.py` and `app/services/polls.py`, and serializing responses.
  - All voting rules, category calculations, completion time modes, and claim state transitions are delegated directly to the Part 1 and Part 2A service layer.

## 2. Public Poll Access & Join Code Sharing
- **Public Visibility**:
  - `GET /api/v1/polls/{poll_id}` is public (no authentication required).
  - It exposes general poll details, options (labels and positions, strictly excluding option `role`s to avoid disclosing target options before voting), and the group's `name` and `join_code`.
  - **Assumption**: As defined in the brief, anyone possessing a poll link can see the group's join code and join the group.
  - It never returns any member identities, votes, or history.

## 3. Authentication & Error Envelope
- **Headers & Distinction**:
  - `X-Admin-Token` identifies the creator/admin for group and poll management.
  - `X-Member-Token` identifies the member's device.
  - Tokens are verified against database hashes. If an `X-Admin-Token` is valid for another group in the database, the API returns `403 forbidden`. If it does not match any group, it returns `401 invalid_token`.
  - Admin tokens cannot authenticate as member tokens, and member tokens cannot authenticate as admin tokens (both return 401).
- **Standardized Error Envelope**:
  - All errors originating from domain exceptions, authorization guards, not-found conditions, and database conflicts conform strictly to:
    ```json
    {
      "error": {
        "code": "...",
        "message": "..."
      }
    }
    ```
  - FastAPI's default 422 structure is retained specifically for malformed request bodies (`RequestValidationError`).

## 4. Session Scope & Row Lock Safety
- **Per-Request Transaction Lifecycle**:
  - The `get_db` FastAPI dependency yields a single database session per request.
  - Any unhandled exception triggers an immediate `session.rollback()`.
  - Sessions are unconditionally closed in a `finally` block upon request completion, ensuring PostgreSQL row locks (such as `SELECT ... FOR UPDATE` during voting and claim operations) are never left hanging.

# Assumptions and Design Decisions (Part 2C: Race Condition, Privacy, and Default Fixes)

This section captures the three targeted fixes applied following review of Part 2B.

## 1. Concurrency: Preventing Stale Reads on Closed Polls
- **Problem**: When a poll instance had already been loaded into a session's identity map (such as during request dependency evaluation), a concurrent call to `close_poll` in another transaction would commit `status = 'closed'` to the database. While a subsequent `SELECT ... FOR UPDATE` in `cast_vote` or `remove_vote` waited for the lock and saw the updated row on PostgreSQL, SQLAlchemy's default behavior retained the already-loaded `Poll` object with its stale `status == 'open'`, permitting post-closure votes.
- **Resolution**: Both `cast_vote` and `remove_vote` apply `.execution_options(populate_existing=True)` to `select(Poll).where(Poll.id == pid).with_for_update()`. This forces SQLAlchemy to refresh the loaded object's attributes from the freshly locked row, reliably raising `PollClosedError` when a poll has been closed.

## 2. Privacy: Redacting Group Names from 403 Forbidden Errors
- **Problem**: Previously, when an admin token belonging to another group was presented, the 403 error message disclosed both the caller's group name and the target group name, allowing token holders to enumerate group names by ID.
- **Resolution**: `require_admin_for_group` and `require_admin_for_poll` now return a static error message: `"This admin token is not valid for this group."`. No group names, group IDs, or poll details are leaked in forbidden responses.

## 3. Schema: Completion Time Mode Default and Validation
- **Problem**: `PollCreate` in `app/api/schemas.py` previously defaulted `completion_time_mode` to `"first"`, contradicting the agreed service default (`"last"`, evaluating completion when a member settles on the target) and allowed arbitrary strings.
- **Resolution**: `PollCreate.completion_time_mode` now defaults to `"last"` and is typed as `Literal["first", "last"]`, ensuring strict 422 rejection for invalid modes.

# Assumptions and Design Decisions (Part 3A: Web App Foundation & Member Pages)

This section captures assumptions and design decisions made for Part 3A (Frontend Foundation and Member Pages).

## 1. Technology & Architecture
- **Framework & Build**: Built with Vite, React 18, strict TypeScript, and Tailwind CSS v4 using `@tailwindcss/vite`.
- **Zero Heavy Dependencies**: Native browser `fetch` is used instead of Axios or external UI component libraries; SVG icons are declared inline.
- **Routing**: `react-router-dom` handles client-side routes for `/` (`HomePage`), `/join/:joinCode` (`JoinPage`), `/p/:pollId` (`PollPage`), and `*` (`NotFoundPage`).

## 2. API Client & Error Handling
- **Request Wrapper**:
  - Automatically prepends `VITE_API_BASE_URL` (defaulting to `http://localhost:8000`).
  - Serializes JSON payloads and attaches `Content-Type: application/json`.
  - Attaches `X-Member-Token` when an authentication token is provided.
- **Error Normalization**:
  - The API error envelope `{"error": {"code", "message"}}` is parsed into an `ApiError` instance holding `status`, `code`, and `message`.
  - Network and offline errors (`Failed to fetch`) are normalized to `ApiError` with `status: 0` and `code: "network_error"`.
  - `getFriendlyErrorMessage` translates error codes (`name_already_claimed`, `poll_closed`, `claim_not_approved`, `invalid_token`, `member_inactive`, `not_found`, `forbidden`, `network_error`) into clear user-facing language.

## 3. Storage & Device Identity
- **Key Convention**: Device member identity is stored under `pollapp.member.<joinCode>` as `{ memberToken, memberId, displayName }`.
- **Fault-Tolerant Fallback**:
  - All access to `window.localStorage` is wrapped in `try/catch`.
  - If `localStorage` throws (e.g. storage disabled, private browsing, quota exceeded), an in-memory Map fallback is seamlessly used.
  - Corrupt or malformed JSON is caught and treated as `null` (empty).
- **Session Revocation**:
  - If a member token returns `401 Unauthorized` or `invalid_token` during identity verification or voting, the stored identity for that join code is immediately cleared from storage and the user is prompted to claim their name again.

## 4. UI/UX & Accessibility
- **Design System & Layout**:
  - Mobile-first layout centered in a single column with `max-w-md` (~28rem) and neutral slate/zinc palette accented with indigo.
  - Minimum tap target size of 44px on all interactive buttons and inputs.
  - Visible focus rings (`focus-visible:ring-2`) and disabled styling.
  - Live regions (`role="alert"`, `aria-live="assertive"`) announce errors and status updates.
- **Timezone & Deadline Calculations**:
  - Datetimes are rendered in the member's local time zone via `Intl.DateTimeFormat`.
  - `describeDeadline` calculates human-friendly relative summaries ("Due in 2 hours", "Due tomorrow at 5:00 PM", "Deadline passed 3 hours ago").
- **Real-Time Polling for Pending Claims**:
  - When a name claim is `pending` approval from the creator, the page automatically re-checks `GET /api/v1/me` every 10 seconds and stops polling when the component unmounts.

# Assumptions and Design Decisions (Part 3A cleanup)

This section documents the three targeted cleanup fixes applied following review of Part 3A:

## 1. Build Artifact Untracking
- **Problem**: `frontend/tsconfig.tsbuildinfo` is a generated TypeScript incremental build artifact and was mistakenly committed to git.
- **Resolution**: Added `*.tsbuildinfo` to the root `.gitignore` and removed `frontend/tsconfig.tsbuildinfo` from the git cache (`git rm --cached frontend/tsconfig.tsbuildinfo`) without deleting the local file.

## 2. Generic Error Message for Cross-Group Poll Access
- **Problem**: In `backend/app/api/deps.py`, when an approved member attempted to access a poll belonging to another group, the error message previously exposed both group UUIDs (`Member belongs to group {member.group_id}, but poll belongs to group {poll.group_id}.`).
- **Resolution**: Replaced the message with static text: `"This poll belongs to a different group."`. The exception type (`MemberGroupMismatchError`), HTTP status (403), and error code (`"forbidden"`) remain identical. Added `test_vote_poll_different_group_error_message_generic` in `backend/tests/test_api_polls.py` asserting 403, `forbidden`, and absence of either group ID in the response body.

## 3. Radio Indicator for Single-Choice Polls
- **Problem**: `frontend/src/pages/PollPage.tsx` previously used a square checkbox indicator for both single-choice and multiple-choice polls.
- **Resolution**: Single-choice polls (`allow_multiple == false`) now render a round radio indicator (`rounded-full` with an inner filled circle dot when selected, and `data-indicator="radio"`). Multiple-choice polls retain the square checkbox (`rounded-md` with checkmark icon and `data-indicator="checkbox"`). Deselection behavior remains intact. Added a unit test in `frontend/src/pages/PollPage.test.tsx` asserting indicator distinction.

# Assumptions and Design Decisions (Part 3B: Creator Pages)

This section documents the assumptions, choices, and architectural decisions made for Part 3B (Creator Pages).

## 1. Creator Identity & Local Storage
- **Key Convention**: Creator tokens and group metadata are stored under `pollapp.admin.<groupId>` as JSON `{ adminToken, groupName }`.
- **Fault-Tolerant Scanning**:
  - `listAdminGroups()` iterates over all keys matching `pollapp.admin.` in `localStorage` and the in-memory fallback.
  - Corrupt, invalid, or empty JSON records are safely ignored and excluded from group lists.
- **Access Invalidation**:
  - If any admin endpoint call returns HTTP 401 Unauthorized or 403 Forbidden, the page presents: `"Your creator access for this group is not valid on this device"` with a reconnect form to input a valid Admin Token.

## 2. API Design & Known Gaps
- **Option Roles Post-Creation**:
  - The public poll endpoint (`GET /polls/{id}`) and admin status endpoint (`GET /polls/{id}/status`) intentionally omit option `role` values (`target`, `in_progress`, `excused`, `not_yet`) to avoid premature disclosure of target options.
  - The frontend relies directly on the server's categorized lists (`at_target`, `behind_target`, `excused`, `not_voted`) returned by `GET /polls/{id}/status` rather than attempting to calculate roles client-side.

## 3. UI/UX & Workflow Details
- **Token Reveal Screen**:
  - Upon group creation (`POST /groups`), the returned `admin_token` is saved locally and presented to the creator with a clear warning: `"This is the only time the token is shown. There is no way to recover it. Anyone who has it can manage this group."`
  - The `"Go to my group"` button is disabled until the creator explicitly checks `"I have saved it"`.
- **Defaulters Copy Action**:
  - The primary `"Copy defaulters"` button calculates the combined count of `not_voted` and `behind_target` members, copying their names separated by newlines.
  - Clipboard operations use `navigator.clipboard.writeText` with an automatic fallback to an off-screen `textarea` and `document.execCommand('copy')`.
- **Poll Deadline & Lateness Modes**:
  - Deadlines selected via `datetime-local` inputs in the viewer's local timezone are converted to UTC ISO 8601 strings (`new Date(deadlineLocal).toISOString()`) before sending to `POST /groups/{id}/polls`.
  - `completion_time_mode` is always explicitly submitted as either `'last'` (default: settled on target) or `'first'` (first selected target).
- **Auto-Refresh**:
  - `AdminPollPage` refreshes status every 15 seconds while the poll is open and the document is visible (`document.visibilityState === 'visible'`).
  - Refresh occurs immediately after administrative actions (closing poll, approving claims, resetting claims, adding members).

# Assumptions and Design Decisions (Part 3C: Name-Claiming Fixes)

This section documents assumptions and architectural decisions made for Part 3C (Name-claiming flow fixes).

## 1. Member Self-Release Backend Service & Endpoint
- **Service Function**:
  - `release_own_claim(session, member) -> Member` in `backend/app/services/identity.py` delegates directly to `reset_claim(session, member.group_id, member.id)` to avoid duplicated state management.
  - Transitions `claim_status` back to `'unclaimed'`, nulls `member_token_hash` and `claimed_at`, and preserves all existing votes and history for subsequent claimants.
- **Endpoint**:
  - `POST /api/v1/me/release` uses `get_current_member` dependency (requires `X-Member-Token`), permitting self-release for both `pending` and `approved` members without requiring approval.
  - Returns HTTP 200 with `{"status": "unclaimed"}` on success.
  - Returns HTTP 401 `missing_token` or `invalid_token` when header is absent or invalid.

## 2. Claim Conflict Handling & Freshness
- **Conflict Handling**:
  - When `claimMember` fails with error code `name_already_claimed`, the member list is immediately refreshed via `getJoinInfo(joinCode)`, the active selection is cleared, and user-facing message `"{name} was just taken by someone else. Please pick another name."` is shown.
  - Roster entries with `taken: true` are rendered disabled with strikethrough.
  - `NameClaimList` detects when a selected member becomes taken following reload and automatically resets selection.
- **Focus & Visibility Freshness**:
  - While the claim list is visible (`!identity`), event listeners on `document.addEventListener('visibilitychange')` (when `visibilityState === 'visible'`) and `window.addEventListener('focus')` reload `getJoinInfo(joinCode)`.
  - No background polling timers are used.

## 3. Browser Identity Protection & Cross-Tab Sync
- **Overwrite Protection**:
  - Immediately prior to invoking `claimMember`, `getMemberIdentity(joinCode)` is re-read from storage.
  - If an identity exists (e.g. another tab claimed in the meantime), `claimMember` is aborted, the recognized view is loaded, and notice `"This browser is already signed in as {name}."` is displayed.
- **Cross-Tab Storage Synchronization**:
  - Both `JoinPage` and `PollPage` register a window `'storage'` event listener targeting `pollapp.member.<joinCode>`.
  - When another tab adds or alters the stored identity, the page transitions to the recognized view and refreshes poll/vote status.
  - When another tab clears the stored identity, the page transitions back to the claim list and refreshes the member roster.
  - Listeners are cleanly unregistered on component unmount.

## 4. Self-Service Switch Name Action
- **UI & Flow**:
  - Reusable `SwitchNameAction` component is integrated on the recognized member view of `JoinPage` and on the `"Voting as {name}"` header line of `PollPage` (as well as the pending claim view).
  - Confirmation prompt warns: `"This frees the name {name} so you or someone else can claim it again. Votes already made stay with that name."`
  - On confirm: calls `releaseClaim(memberToken)`, purges `clearMemberIdentity(joinCode)`, and refreshes member list.
  - If the release API returns HTTP 401 (e.g. creator already reset the claim), local identity is cleared and the claim list is presented.
  - If the release API fails due to network or other errors, an error message is displayed and the local identity is retained.
- **Rule Explanation**:
  - Recognized view includes helper text: `"This browser is signed in as {name}. To let someone else use this device, tap 'Not you? Switch name'."`


# Assumptions and Design Decisions (Part R1a: Group Custom Fields and Identifier)

This section documents assumptions and architectural decisions made for Part R1a (Custom group fields, values, defaults, identifier, and admin API).

## 1. Database Schema & Migration (003_group_fields)
- **Table `group_fields`**:
  - `id`: UUID primary key.
  - `group_id`: UUID foreign key to `groups.id` with `ON DELETE CASCADE`.
  - `key`: String(80), immutable generated key.
  - `name`: String(60), trimmed display name.
  - `field_type`: String(20), constrained by check constraint `field_type IN ('text', 'number', 'choice', 'link')`.
  - `is_required`: Boolean, default `False`.
  - `default_value`: Text, nullable.
  - `choices`: JSONB list of strings, nullable.
  - `is_identifier`: Boolean, default `False`.
  - `position`: Integer, 1-based creation order.
  - `created_at`: UTC timestamp with timezone.
  - **Constraints**:
    - Unique constraint on `(group_id, key)`.
    - Partial unique index on `(group_id, lower(name))`.
    - Partial unique index on `group_id` where `is_identifier IS TRUE` (enforcing at most one identifier per group).
- **Table `members`**:
  - `field_values`: JSONB, not null, server default `'{}'`.
  - `identifier_value`: String(500), nullable, stores the normalized identifier.
  - **Constraint Changes**:
    - Dropped unique constraint `uq_members_group_display_name`.
    - Added partial unique index `ix_members_group_identifier` on `(group_id, identifier_value)` where `identifier_value IS NOT NULL`.
- **Downgrade Compatibility**:
  - Downgrade cleanly reverses all schema changes: drops `group_fields` table, drops partial unique index on `(group_id, identifier_value)`, drops columns `identifier_value` and `field_values`, and re-creates `uq_members_group_display_name`.
  - **Note on Downgrade**: If multiple members in a group were created with identical display names under Part R1a (allowed when an identifier field exists), re-adding the unique constraint on `(group_id, display_name)` during downgrade will fail until duplicate names are manually resolved.

## 2. Field Definitions & Keys
- **Name**: 1 to 60 characters trimmed, case-insensitive unique within the group.
- **Key Generation**:
  - Generated at field creation by lowercasing the name, converting runs of non-alphanumeric characters to `_`, and trimming `_`.
  - Collision handling: if a key already exists in the group (e.g. "Register No" vs "Register  No"), numerical suffixes `_2`, `_3`, etc. are appended.
  - Keys are immutable and never change upon renaming the field.
- **Field Type**: Immutable after creation. Supported types: `text`, `number`, `choice`, `link`.
- **Choices**:
  - Required and permitted only for `choice` fields: 2 to 50 unique items (ignoring case), each 1 to 100 characters trimmed.
  - Non-choice types must not have `choices`.
- **Field Limit**: Enforced maximum of 30 fields per group.
- **Default Value**:
  - Validated according to the field type. For `choice` fields, must match one of the defined choices.
  - Identifier fields cannot have a default value.

## 3. Values & Validation
- Stored as a JSON object in `members.field_values` mapping `{key: value}`.
- In SQLAlchemy, mutations always assign a newly constructed dictionary (`member.field_values = {**old, ...}`) to guarantee SQLAlchemy ORM change detection on JSONB columns.
- **Blank Definition**: A value is blank if it is missing, `None`, or consists entirely of whitespace.
- **Type Validation Rules**:
  - `text`: string, trimmed, maximum 500 characters.
  - `link`: string, trimmed, maximum 2000 characters, no whitespace, must start with `http://` or `https://`.
  - `choice`: case-insensitive match against field choices, stored as the canonical choice string.
  - `number`: finite number (NaN, Infinity, and booleans rejected); accepted as JSON number or numeric string; stored as JSON number (integer when whole).
- **Defaults & Updates**:
  - On member creation or update, any blank value for a field with a default is filled with that default.
  - A blank value for a required field without a default raises `PollValidationError`.
  - Unknown keys in `values` raise `PollValidationError`.
  - Partial updates: only provided keys are altered; sending a blank resets the key to the default (or deletes the key if no default exists, provided the field is not required).

## 4. Identifier Field Rules
- Only a `text` field can be marked as the identifier.
- An identifier field is always required (`is_required=True`) and cannot have a default.
- **Normalization**: Trim, collapse inner whitespace sequences to a single space, and `casefold()`. Stored in `members.identifier_value`; original text is stored in `members.field_values`.
- **Display Name Uniqueness**: Display names are unique within a group only while the group has NO identifier field. Once an identifier field exists, duplicate display names are allowed.
- **Existing Members Lifecycle**:
  - A new field cannot be created as the identifier while members exist. The creator adds a regular text field, populates values, and then updates it to be the identifier.
  - Marking as identifier validates that every member has a non-blank value and that normalized values are unique; failures return row-level details identifying offending members. On success, `identifier_value` is set for all members and the field becomes required.
  - Unmarking the identifier clears `identifier_value` for all members; the field remains required.
  - Deleting an identifier field is rejected (must be unmarked first).
  - Replacing choices fails if any member currently holds a value not present in the new list.
  - Modifying `default_value` never alters existing member rows.

## 5. Concurrency & Error Responses
- **Concurrency Locking**:
  - Every service function that writes fields or members first locks the group row using `select(Group).where(...).with_for_update()`.
  - Prevents race conditions during uniqueness and existence validations. Database unique indexes act as the final safety net, translating any concurrent index conflict into an HTTP 409 `conflict`.
  - Validated with multi-threaded test `test_concurrent_members_same_identifier`.
- **Row-Level Error Details**:
  - `PollValidationError` and API error responses support an optional `details` list:
    `{"error": {"code": "validation_error", "message": "...", "details": [{"row": 3, "field": "Register No", "message": "..."}]}}`
  - Rows are 1-based within the request batch. Errors without details retain the exact existing envelope.

## 6. Admin API Endpoints
- All field management endpoints require `X-Admin-Token` authentication for the specific group.
- `GET /api/v1/groups/{group_id}/fields`: List fields ordered by position.
- `POST /api/v1/groups/{group_id}/fields`: Create custom field (`name`, `field_type`, `is_required`, `default_value`, `choices`).
- `PATCH /api/v1/groups/{group_id}/fields/{field_id}`: Partial field update.
- `DELETE /api/v1/groups/{group_id}/fields/{field_id}`: Delete custom field (returns 204, removes key from member values).
- `POST /api/v1/groups/{group_id}/members`: Accepts either `{display_names: [...]}` or `{members: [{display_name, values?}]}` (up to 2000 rows, all-or-nothing with row-level details).
- `PATCH /api/v1/groups/{group_id}/members/{member_id}`: Accepts optional `values` dictionary for partial update.
- `GET /api/v1/groups/{group_id}`: Adds `fields` list, and adds member `values` object and `identifier` (original text or null).







