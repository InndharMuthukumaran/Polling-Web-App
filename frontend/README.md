# Polling Web App - Frontend (Parts 3A & 3B)

A modern, mobile-first web application for group polling built with React 18, Vite, TypeScript, Tailwind CSS v4, and Vitest.

---

## Prerequisites

- **Node.js**: v18 or newer (tested on Node v25+)
- **PostgreSQL**: Running on `localhost:5432`
- **Backend API**: Running on `http://localhost:8000` (FastAPI backend in `backend/`)

---

## Setup & Installation

From the project root:

```bash
cd frontend
npm install
```

---

## Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Description | Default |
| :--- | :--- | :--- |
| `VITE_API_BASE_URL` | Base URL of the backend API | `http://localhost:8000` |

---

## Available Scripts

### Development Server
Starts the Vite dev server with hot module replacement (HMR):
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### Type Check
Runs strict TypeScript validation without emitting files:
```bash
npm run typecheck
```

### Run Tests
Executes the automated unit and component test suites once via Vitest:
```bash
npm test
```

### Production Build
Typechecks and compiles optimized production assets into `dist/`:
```bash
npm run build
```

### Preview Build
Serves the production build locally for verification:
```bash
npm run preview
```

---

## Pages Implemented

### Member Pages (Part 3A)
- **`/join/:joinCode` (JoinPage)**:
  - Fetches group info via `GET /api/v1/join/{joinCode}`.
  - Verifies stored device identity via `GET /api/v1/me`.
  - For new devices, displays clickable member names with taken names disabled.
  - Allows claiming an available name via `POST /api/v1/join/{joinCode}/claim`.
  - Shows group polls for approved members, or an auto-refreshing (every 10s) waiting panel for pending claims.
- **`/p/:pollId` (PollPage)**:
  - Loads poll details via `GET /api/v1/polls/{pollId}`.
  - Handles inline name claiming when device has no identity or on 401.
  - Single/multiple choice voting with toggle buttons via `POST /api/v1/polls/{pollId}/vote` and `DELETE /api/v1/polls/{pollId}/vote?option_id=...`.
  - Radio indicators for single-choice polls, checkbox indicators for multiple-choice polls.
  - "Clear my vote" action to remove all selections.
  - Notice that the creator can view first and last selected timestamps.
  - Displays collapsible "Your history" section from `GET /api/v1/polls/{pollId}/me`.
  - Read-only banner and frozen selections when poll is closed.
  - Notice when deadline has passed but poll is still open ("vote will be marked late").
- **`*` (NotFoundPage)**: Friendly 404 page with navigation back to home.

### Creator Pages (Part 3B)
- **`/` (HomePage)**:
  - Create a group with Group Name input.
  - "Save your creator access" reveal screen: Group ID and Admin Token with copy buttons, security warning, and "I have saved it" confirmation checkbox.
  - "Your groups" list linking to `/g/:groupId`.
  - "Connect an existing group" with Group ID and Admin Token inputs.
  - Member helper line: "Have a poll link? Just open it."
- **`/g/:groupId` (DashboardPage)**:
  - Share card: Join link with copy button, and toggle for "Require my approval before a member can vote".
  - Roster card: compact summary showing member count, waiting-for-approval badge, custom field count, button to open Roster page, toggle for "Show the list of names on the join page" (`allow_name_list`), and an identifier hint line when an identifier field exists.
  - Polls card: list of polls with Open/Closed badges and deadlines, plus "New poll" button.
  - Automatic reconnection screen when creator token is missing or rejected (401/403).
- **`/g/:groupId/roster` (RosterPage - Part R4)**:
  - Tabbed interface (`Fields`, `Members`, `Import`).
  - **Fields Tab**: Create and edit custom group fields (`text`, `number`, `choice`, `link`), configure choices and defaults, mark/unmark unique identifier field (with offending member reports on conflict), and delete non-identifier fields with value-count confirmation warning.
  - **Members Tab**: Search members by name or identifier, filter by status (`all`, `active`, `inactive`, `pending`, `approved`, `unclaimed`), paginate (50 per page). View in responsive desktop table or mobile cards. Quick-add names in bulk. Add/edit members with per-field inputs. Actions to Approve, Reset claim, Deactivate/Reactivate, and Edit.
  - **Import Tab**: 4-step wizard to import members from Excel (`.xlsx`) or CSV. Download template, upload file (up to 5 MB), map columns (with new field creation from headers), perform dry-run check with row-level error reporting, and execute import with duplicate resolution (skip or reject).
- **`/g/:groupId/polls/new` (NewPollPage)**:
  - Name, description, multiple-choice switch, local deadline input, and completion time mode radio ("last" recommended vs "first").
  - Options editor with role selection (Target, In progress, Excused, Not yet).
  - Quick-fill templates: "Yes / Not yet", "Stages", and "Add 'Need more time' option".
  - Full client-side validation mirroring backend rules.
- **`/g/:groupId/polls/:pollId` (AdminPollPage)**:
  - Share card: voting link copy, "Copy announcement", and "Copy reminder" buttons.
  - Summary metrics: Done, Behind, Excused, Not voted, plus Late count.
  - All-reached banner when every active member reaches target or is excused.
  - Defaulter lists: sections for Not voted, Behind, Excused, and Done (with Late badges & completion times); prominent "Copy defaulters" button.
  - Collapsible voting history per member.
  - Close poll action with confirmation prompt.
  - Auto-refresh every 15 seconds while poll is open and window is visible.

---

## Full Manual Smoke-Test Script

Follow these steps to smoke-test the complete workflow from group creation to member voting and closing:

### 1. Start Database & Backend
```bash
cd backend
# Ensure PostgreSQL is running on localhost:5432
alembic upgrade head
python -m uvicorn app.main:app --reload --port 8000
```
Verify health:
```bash
curl http://localhost:8000/api/v1/health
# Returns: {"status": "ok"}
```

### 2. Start Frontend
```bash
cd ../frontend
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your primary browser.

### 3. Create a Group (Creator)
1. On the Home Page, enter a group name (e.g. `Weekend Football`) and click **Create**.
2. On the **Save your creator access** screen:
   - Copy the Group ID and Admin Token.
   - Tick the **"I have saved it"** checkbox.
   - Click **Go to my group**.

### 4. Add Members & Share (Creator Dashboard)
1. On the group dashboard (`/g/:groupId`):
   - In the **Add members** section, paste names:
     ```
     Alice Cooper
     Bob Smith
     Charlie Brown
     ```
   - Click **Add Members** and verify all 3 appear in the list with `Not claimed` badges.
2. In the **Group Invitation** card:
   - Click **Copy** to copy the join link (`http://localhost:5173/join/<joinCode>`).

### 5. Claim a Name (Member Device)
1. Open a **second browser profile** or **incognito window**.
2. Paste the join link (`http://localhost:5173/join/<joinCode>`).
3. Click **Alice Cooper**.
4. Review `"This is me: Alice Cooper"` and click **Confirm**.
5. Verify the screen displays `"Recognized Member: You are Alice Cooper in Weekend Football"`.

### 6. Create a Poll (Creator)
1. In the first browser (Creator Dashboard), click **New poll**.
2. Enter Poll Name: `Match Attendance`.
3. Click the **"Yes / Not yet"** quick-fill button.
4. Click **Add "Need more time" option**.
5. Leave completion time mode as `"When the member settled on the target"`.
6. Click **Create Poll**.
7. The browser navigates to the Admin Poll Page (`/g/:groupId/polls/:pollId`).

### 7. Share & Vote (Member)
1. In the creator view, copy the voting link (`http://localhost:5173/p/:pollId`).
2. In the second browser (Alice's window), open the poll link.
3. Verify Alice is recognized (`Voting as Alice Cooper`).
4. Tap **Yes** (radio indicator fills).
5. Open **Your history** to view the recorded timestamp.

### 8. Watch Creator Dashboard Update & Copy Defaulters
1. In the creator window (`/g/:groupId/polls/:pollId`), watch the counts update:
   - Done: 1 (Alice Cooper)
   - Not voted: 2 (Bob Smith, Charlie Brown)
2. Click **Copy defaulters (2)**.
3. Paste into a text editor and verify Bob Smith and Charlie Brown are copied.

### 9. Close Poll (Creator)
1. Click **Close Poll**.
2. In the confirmation dialog, click **Confirm & Close Poll**.
3. Verify the status updates to `Closed`.
4. In Alice's member window, reload or tap an option; verify the poll displays `"This poll is closed"` with options frozen.

### 10. Roster & Spreadsheet Import Smoke-Test (Part R4)
1. Navigate back to the Creator Dashboard (`/g/:groupId`).
2. Notice the **Roster** card showing member counts, custom fields count, and the **"Show the list of names on the join page"** toggle switch. Toggle it and verify the setting persists on refresh.
3. Click **Manage Roster & Fields** to open the Roster page (`/g/:groupId/roster`).
4. **Fields Tab**:
   - Click **Add Field**. Enter Name `Register No`, Type `text`. Note that setting it as Identifier is disabled while members exist without identifiers. Click **Save Field**.
   - Click **Add Field** again. Enter Name `Department`, Type `choice`, Choices: `Computer Science, Mechanical, Electrical`, Default: `Computer Science`. Click **Save Field**.
   - Verify both fields appear in the fields list with their type badges and position order.
5. **Members Tab**:
   - In the Members tab, verify existing members display their custom field values (pre-filled with `Computer Science` default where applicable).
   - Click **Edit** on `Alice Cooper`. Enter `Register No`: `REG001`. Click **Save Changes**.
   - Click **Edit** on `Bob Smith`. Enter `Register No`: `REG002`. Click **Save Changes**.
   - Click **Edit** on `Charlie Brown`. Enter `Register No`: `REG003`. Click **Save Changes**.
   - Return to the **Fields Tab**, click **Edit** on `Register No`, check **"Use this field as the unique identifier"**, and click **Save Changes**. Verify the field receives the `Identifier` badge.
6. **Import Tab (Spreadsheet Wizard)**:
   - Go to the **Import** tab.
   - Click **Download .xlsx Template** and open it in Excel/Sheets. Observe the columns `Name`, `Register No`, and `Department` with dropdown choices.
   - Fill in two new rows:
     - `Diana Prince`, `REG004`, `Mechanical`
     - `Evan Wright`, `REG005`, `Electrical`
   - Save the file and upload it in **Step 1: Choose File**.
   - In **Step 2: Preview & Map**, verify `Name` mapped to `Name`, `Register No` mapped to `Register No`, and `Department` mapped to `Department`.
   - Click **Check file (dry-run)**. Verify **Step 3** shows `2 rows ready to import` and `0 errors`.
   - Click **Import 2 members**. Verify successful import and transition to the **Members Tab**.
7. **Search, Filter & Member Actions**:
   - Use the search bar to type `REG004` or `Diana`; verify instant filtering.
   - Filter by status (`Active`, `Unclaimed`, etc.).
   - Test member actions: click **Reset claim** on a member and verify confirmation prompt; test **Deactivate** / **Reactivate**.

### 11. Claim by Identifier & Poll Answers Smoke-Test (Part R5a)
1. **Identifier Claim Flow (`JoinPage`)**:
   - In a separate browser profile or incognito window, open `/join/:joinCode`.
   - When the group has an identifier field (e.g. `Register No`) and `allow_name_list` is false:
     - Verify the screen displays only the `Register No` input with **Find me** button.
     - Type a non-existent identifier (e.g. `UNKNOWN_123`) and click **Find me**. Verify error banner: `"We could not find that Register No. Check it and try again."`
     - Type an existing unclaimed identifier (e.g. `REG004`) and click **Find me**.
     - Verify the confirmation box appears: `"Is this you? Diana Prince"` with **Yes, that's me** and **No, try again**.
     - Click **No, try again** and verify the confirmation clears so you can edit the input.
     - Re-search `REG004` and click **Yes, that's me**. Verify the device transitions to the recognized member view (`"You are Diana Prince"`).
   - In another browser tab, search `REG004` again. Verify error banner: `"That Register No is already claimed. If it is you on a new phone, ask the group creator to reset it."`
   - On the creator dashboard, toggle on **"Show the list of names on the join page"**. Reload the join page and verify the name list appears below the divider `"Or pick your name from the list"`, displaying masked hints (e.g. `•••001`).

2. **Poll-Only Fields & Answers Form (`PollPage`)**:
   - As an approved member, open a poll with poll fields.
   - Below the voting area and above "Your history", verify the card **"Your details for this poll"** is displayed.
   - If required fields lack saved values, verify the reminder banner: `"Please fill in the required details so the poll creator has everything."`
   - Verify voting works independently even before saving answers.
   - Enter answers (text, numeric values like `14.5`, select dropdown options, and link URLs starting with `https://`).
   - Click **Save answers**. Verify the button disables while saving, then shows `"Saved [timestamp]"`, and the reminder banner disappears.
   - When the creator closes the poll, verify the card becomes read-only with a `"This poll is closed."` notice and no Save button.


