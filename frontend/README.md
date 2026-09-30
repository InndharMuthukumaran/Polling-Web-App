# Polling Web App - Frontend (Part 3A)

A modern, mobile-first web application for group polling built with React 18, Vite, TypeScript, Tailwind CSS v4, and Vitest.

---

## Prerequisites

- **Node.js**: v18 or newer (tested on Node v25+)
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

## Pages Implemented (Part 3A)

- **`/` (HomePage)**: Placeholder card directing members to open poll links.
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
  - "Clear my vote" action to remove all selections.
  - Shows notice that the creator can view first and last selected timestamps.
  - Displays collapsible "Your history" section from `GET /api/v1/polls/{pollId}/me`.
  - Read-only banner and frozen selections when poll is closed.
  - Notice when deadline has passed but poll is still open ("vote will be marked late").
- **`*` (NotFoundPage)**: Friendly 404 page with navigation back to home.

---

## How to Smoke-Test Against the Backend

1. **Start the PostgreSQL database and backend**:
   ```bash
   cd backend
   # Ensure virtual environment is active and DATABASE_URL is set
   alembic upgrade head
   uvicorn app.main:app --reload --port 8000
   ```

2. **Verify backend is healthy**:
   ```bash
   curl http://localhost:8000/api/v1/health
   # Returns: {"status": "ok"}
   ```

3. **Start the frontend development server**:
   ```bash
   cd ../frontend
   npm run dev
   ```

4. **Test the flow**:
   - Create a group and poll via backend API or curl/python script. Note the `join_code` and `poll_id`.
   - Open `http://localhost:5173/join/<join_code>`:
     - Verify member names appear. Select your name, click "Confirm & continue", and verify your identity is recognized.
   - Open `http://localhost:5173/p/<poll_id>`:
     - Tap options to vote and verify selections update.
     - Tap selected option or "Clear my vote" to remove selections.
     - Expand "Your history" to view timestamp records.
