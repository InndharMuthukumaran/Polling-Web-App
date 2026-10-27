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
3. In the Options editor (which starts with two empty rows):
   - Row 1: enter `Yes` (Role defaults to `Target`).
   - Row 2: enter `Not yet` (Role defaults to `Not yet`).
   - Click **+ Add another option**, enter `Need more time`, and select role `Excused / needs more time`.
   - Observe the explanatory help line dynamically updating under each role dropdown.
4. Notice the deadline note explaining that a member is on time if they settled on a target option before the deadline.
5. Click **Create Poll**.
6. The browser navigates to the Admin Poll Page (`/g/:groupId/polls/:pollId`).

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

### 9. Close Poll & Reopen Poll (Creator)
1. Click **Close Poll**.
2. In the confirmation dialog, click **Confirm & Close Poll**.
3. Verify the status updates to `Closed`.
4. In Alice's member window, reload or tap an option; verify the poll displays `"This poll is closed"` with options frozen.
5. In the creator window, verify the Manage section now shows **Reopen poll**.
6. Click **Reopen poll**. In the confirmation dialog, review the prompt ("Members will be able to vote and change their answers again. Their earlier votes and history are kept.") and click **Confirm & Reopen Poll**.
7. Verify the poll status updates back to `Open` without a page reload, and voting works again.

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

### 12. Poll Fields, Identifier in Defaulters, and Results Export Smoke-Test (Part R5b)
1. **Roster Setup**:
   - Ensure the group has custom fields, including an identifier field (e.g. `Register No`) and an extra field (e.g. `Department`), and members with values.
2. **Create a Poll with Columns and Questions (`NewPollPage`)**:
   - From the Dashboard, click **New Poll**.
   - Fill in name and options.
   - In **"Roster columns for your results"**:
     - Verify `Register No` is listed first, checked and locked (`disabled`), with `"Always included so you can tell people apart."`
     - Check `Department`.
   - In **"Questions for members (optional)"**:
     - Click **+ Add question**. Add a question `Preferred Location` of type `Choice list`, enter choices `Bangalore\nHyderabad\nPune`, and select default `Bangalore`.
     - Click **+ Add question** again. Add a question `Expected CTC` of type `Number`.
     - Click **Create Poll**.
3. **Defaulter Lists & Identifier Display (`AdminPollPage`)**:
   - On the poll admin page, verify members in `Not voted`, `Behind target`, `Excused`, and `Done` display their identifier in muted style next to their name (e.g. `Diana Prince  REG004`).
   - Click **Copy defaulters** and **Copy names**: paste into a notepad and verify the format is `Name (identifier)` (e.g. `Diana Prince (REG004)`), ensuring members with identical names are distinguishable.
   - Open **Voting History** and verify identifiers appear next to names.
4. **Vote and Answer as Member**:
   - In a member browser window, vote on the poll and answer `Preferred Location` and `Expected CTC`. Click **Save answers**.
5. **Results Table & File Downloads**:
   - In the creator window, expand the **Results** section.
   - Notice the note: `"Roster values are shown as they are right now."`
   - Verify columns appear in order: `Name`, `Register No`, `Department`, `Preferred Location`, `Expected CTC`, `Status`, `Selected options`, `Late`, and `Answers complete`.
   - Test the search box and status filter (including `"Answers incomplete"`).
   - Test **Download Excel** and **Download CSV**: verify `.xlsx` and `.csv` files download with correct headers and member answers.

### 13. Deletions, Bulk Member Selection, and Roster Export Smoke-Test (Part FB)
1. **Roster Export**:
   - On the Roster Management page (`/g/:groupId/roster`), open the **Download roster** menu in the header.
   - Download both **Excel** (`.xlsx`) and **CSV** (`.csv`).
   - Verify columns: `Name`, then group fields in defined position order, then `Status` (`Not claimed`, `Waiting for approval`, `Claimed`) and `Active` (`Yes` or `No`).
   - Verify spreadsheet formula protection: any field value starting with `=`, `+`, `-`, or `@` is escaped as text.
2. **Bulk Member Selection & Actions**:
   - In the Members tab, use the checkbox column in the table or checkboxes on cards.
   - Check the header checkbox to select all members on the current page.
   - If a search or status filter matches more than 50 members, click `"Select all M matching the current search"` in the action bar.
   - Test the bulk action buttons:
     - **Deactivate**: deactivates selected members.
     - **Reactivate**: reactivates selected members.
     - **Delete selected**: opens confirmation dialog stating `"Delete N members? This permanently deletes them and their votes, history and answers in every poll. This cannot be undone."`
     - Click confirm and verify all selected members and their associated poll data are deleted and selection is cleared.
3. **Single Member Deletion**:
   - In any member row, click **Delete** (next to Edit).
   - Verify confirmation dialog: `"Delete {name}? This permanently deletes them and their votes, history and answers in every poll. Deactivate instead keeps the data."`
   - Confirm deletion and verify the member and their votes disappear immediately.
   - In a member browser holding that member's token, verify future requests return 401 and clear stored identity.
4. **Accessible Dialogs & Escape Key**:
   - Open Add Member, Edit Member, Add Field, or Edit Field dialogs.
   - Press **Escape** and verify the dialog closes without saving.
5. **Delete Poll**:
   - On `AdminPollPage` (`/g/:groupId/polls/:pollId`), locate the **Manage Poll** section.
   - Click the dangerous **Delete poll** button below Close/Reopen.
   - Verify confirmation dialog: `"Delete this poll? This permanently deletes the poll with all votes, history and answers. Download the results first if you need them."`
   - Test the **Download results (Excel)** and **Download results (CSV)** buttons inside the dialog.
   - Confirm deletion: verify the poll is permanently removed and the browser navigates to the group dashboard.
   - Navigating to the deleted poll URL (`/p/:pollId`) shows `"This group or poll no longer exists."` and clears any saved identity for that join code.
6. **Danger Zone & Group Deletion**:
   - On the Dashboard (`/g/:groupId`), navigate to the **Danger zone** card at the bottom.
   - Verify the card displays the count of members and polls, and click **Delete this group**.
   - Verify dialog text: `"This permanently deletes the group, its members, fields, polls, votes and answers. Anyone with the join link or poll links will no longer be able to use them."`
   - Test **Download roster (Excel)** and **Download roster (CSV)** inside the dialog.
   - Verify the delete button remains disabled until typing the exact group name in the confirmation field.
   - Type the exact group name and confirm deletion.
   - Verify saved creator access for this group is cleared from the browser and the browser navigates to `/` with the banner `"Group deleted."`.
   - Accessing the deleted group's join link (`/join/:joinCode`) displays `"This group or poll no longer exists."` and clears saved identity.
