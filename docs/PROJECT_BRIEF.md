# Project Brief: Advanced Group Polling (working title)

Version 18. Last updated: 9 Oct 2026. Status: The first full version of the product is built and verified: backend (125 tests), web app (149 tests), roster and fields, claim by identifier, poll questions, results export, all checked in real browsers. Next: D1 deployment config (prompt ready) and the deployment guide, then Part 4 (reminders and AI), bot support, Telegram, Discord and finishing.

## 0. How Claude should use this document

Paste this at the start of a new chat. Treat it as the source of truth.

- Everything under "Decided" was stated or confirmed by Inndhar. Do not change or reinterpret it without asking.
- Everything under "Proposed" was suggested by Claude and NOT yet confirmed. Present it as a suggestion, never as settled.
- Everything under "Open questions" is undecided. Ask; do not assume.
- Do not invent features, platforms, or requirements that are not listed here. If an idea seems useful, propose it and label it as new.
- If a request conflicts with this document, point out the conflict before acting.
- Give honest pushback when something seems flawed. Do not just agree.
- Platform rules and free-tier limits change. Verify with a search before relying on section 7.

## 1. Who and what

- Working method (agreed 5 Oct): one prompt, one commit. Start each prompt in a fresh agent session, so earlier context does not clutter it; the repo and docs/ASSUMPTIONS.md carry the memory. The agent must stop and fix any failing test before finishing. Risky prompts (those that change the data model) are verified alone; independent follow-ups may be run back to back and verified together.
- Collaborators (three): Inndhar (developer, makes decisions, runs and tests things), Claude (planning, prompts, reviewing results against this brief), and a coding agent in Antigravity using a Gemini flash-lite model on high (writes the code). Claude credits are limited, so Claude is used for planning and review, and the coding agent does the building.
- Working loop: Claude writes a prompt for one part, the coding agent builds it, Inndhar pastes the agent's summary and test results back to Claude, and Claude checks them against this brief before the next part.
- Product type: a web application with a backend API, plus chat-app bots. Not a library or package. It could later offer its API or an embeddable widget to other developers, but that is not planned now.
- One-liner: a polling tool for group chats that tracks who has voted and who has reached a target, and sends smart reminders.

## 2. Problem and goal

Group chats (WhatsApp and others) have basic polls that cannot show defaulters, track progress, or remind people. Goal: an advanced poll that is easy to plug into any chat app, with maximum scalability and portability.

Example: the goal is to complete an assignment. Option 1 "Yes" is the target, option 2 "Not yet". The creator should get a list of people who haven't voted and a list of people who voted but haven't reached the target.

## 3. Decided features (confirmed by Inndhar)

**Poll basics**
- Every poll has a name and a description.
- The description is entered roughly by the creator, refined by AI, and shown back to the creator to confirm it matches what they meant. The confirmed description is used to write personalised reminders.
- All poll options are chosen by the poll creator.
- Each poll has a toggle: multiple choices allowed or not (single choice only).
- Each option can have a role: target, in progress, excused / needs more time, or not yet. Excuse or "needs more time" is a togglable extra the creator can add.
- Progress uses named stages instead of percentages (for example Part 1, Part 2, Part 3 completed, where "part" is a placeholder for any process). The target is the final stage, or any stage the creator picks. Defaulter lists can be produced for any stage using the same feature.
- Deadlines are supported.
- Multiple languages are supported.
- Results can be exported.

**Groups, members and fields (new requirement, 5 Oct)**
- Excel (bulk) upload for adding members. Multiple attributes instead of only names, because several people can share a name (example: college placements with Register No, Name, resume link and other data).
- The creator adds fields to a group dynamically, adds rows manually or by Excel upload, and can give each field a default value.
- Two levels of data: the group stores the master data for everyone once; when creating a poll the creator can include existing group fields and also add new fields that exist only in that poll (example: willingness to company ABC). The unique identifier field (for example Register No) must be part of every poll.

**Groups and names**
- Each group has its own display names, like WhatsApp's per-group "about" that can differ for each group.
- Identity for link voting (confirmed 29 Sep): the creator pre-loads the member list per group, each member picks their name once from that list, the device remembers it, and the creator can approve or reset a claim. Inndhar will try the full flow himself and request changes afterwards if needed.

**Defaulters**
- One-click lists: people who haven't voted, and people who voted but haven't reached the target.

**Reminders**
- Automated, with a duration the creator sets (for example every 2 or 6 hours).
- Personalised using the confirmed poll description.
- The system detects when everyone has reached the target.

**History tracking**
- For each person and each option, track only the first and last time they selected it, with timestamps. Example: a person selects Yes at 2:00, 3:00 and 4:00 PM; only 2:00 and 4:00 PM are kept for Yes. Same rule for every other option.
- Tracking continues until the creator closes the poll.

**Closing**
- The poll ends only when the creator presses a close button.
- It does not auto-end, even if everyone reaches the target. In that case the creator gets a reminder or notification.

**Late completers**
- Marked as late, but still counted toward the target.

**Platforms**
- Must work for WhatsApp through a workaround, and also for other chat apps. Built as one shared core with a connector per platform.
- WhatsApp approach: shared link. The poll lives on a lightweight page, the creator posts the link into the group, members tap it and vote there. Reminders are copy-and-paste text (no WhatsApp approval needed). Cost: one extra tap for members.
- Native bots for Telegram and Discord. Inndhar's view (29 Sep): native, in-chat polling holds more value than dashboard-only management. Agreed split: in the chat apps, creators create polls, members vote, the creator asks for the defaulter list (reply visible only to the creator) and reminders are posted natively; the web app handles the heavy work (member list setup, settings, per-person history, export) and is the only full route for WhatsApp.

**Tech stack**
- Frontend: React with Vite and Tailwind (confirmed 29 Sep). Backend: FastAPI (Python). Database: PostgreSQL on a non-expiring free host (not MongoDB Atlas).
- LLM: a free Gemini API key for now.
- Deployment for now: Vercel (frontend) and Render (backend).

## 4. Proposed (Claude's suggestions, not yet confirmed)

- Frontend details chosen by Claude: TypeScript, Tailwind v4 through the Vite plugin, React Router, Vitest for tests, no other UI or state libraries. Member tokens and admin tokens are kept in the browser's local storage.
- In Telegram and Discord, members are already identified by the platform, so name-claiming can be one tap. This needs new backend pieces (step 5 below): a trusted credential for the bot, links between a chat and a group and between a platform user and a member, and a way to send reminders through the bot. Telegram and Discord also have their own native poll objects, but they may limit the number of options or need a permanent connection; check current rules before the bot prompts, and consider buttons in a normal message instead. Do not post the defaulter list to the whole group by default.
- Database host: Neon (plain Postgres, free, no card, scales to zero). Use two databases or branches, one for the app and one for tests.
- Render free tier sleeps after 15 minutes, so use an external timer (UptimeRobot, cron-job.org or similar) calling a "send due reminders" address every 5 minutes. This keeps the server awake and drives reminders, with the database as the source of truth for what is due; missed reminders go out on the next tick. Move to a paid always-on backend before real users.
- No Redis in the first version. Write the reminder code as a self-contained piece so a queue can be added later.
- Do not send real member names to the LLM (the free Gemini tier may use content to improve Google's products). The LLM writes text with a placeholder like {name}; the app fills it in. Keep the LLM behind one swappable piece of code, with a fixed-template fallback if it fails.
- Roster design details (Claude's proposals, not yet confirmed): field types text, number, choice list and link; "default value" fills a blank cell on a manual add or an upload, and gives existing rows a value when a new field is added later; roster fields are creator-side data (shown in the creator's results table, copy text, export and reminders), not shown to other members; poll-only fields are optional extra questions members answer beside the vote (saved with a separate Save button, editable until the poll closes, only the last-updated time is kept); roster values are read live while a poll is open; file parsing is done on the backend with size and row limits; members claim their row by typing the identifier, with the public name list off by default for uploaded rosters and kept as a setting for small groups; keep roster data visible to the creator only and add a way to delete a group's data (India's DPDP Act is worth reading if used beyond small groups).
- Identity is honor-system level; phone verification could be an optional later upgrade.
- Part 2 identity mechanics (chosen by Claude, not yet confirmed): no user accounts; creating a group returns a one-time admin token (whoever holds it is the creator for that group, one token per group, stored only as a hash); joining uses an unguessable join code; claiming a name returns a one-time member token that the device stores; the group has a setting "require claim approval" (off by default: first claim wins; on: claims stay pending until the creator approves); resetting a claim frees the name but keeps its votes and history, so the next claimant inherits them; a poll link also reveals the group's join code, so anyone with a poll link can join the group.
- Show current status alongside history ("Yes: first 2:00, last 4:00, currently not selected").
- History visible only to the creator by default; members told it is recorded. Defaulter lists visible to the creator or admins by default, shareable if the creator chooses.
- When everyone reaches the target: reminders stop, creator gets a "close the poll?" notice, one gentle follow-up later if ignored. Optional auto-close toggle, off by default.
- A deadline passing does not close the poll.
- Reminders: quiet hours, automatic stop for people who reached the target, tone options.
- Later ideas: recurring polls, streaks or a light leaderboard, "nudge only this person" button.
- Rules chosen as defaults in Part 1 (change any of these if wrong):
  - The multiple-choice toggle is set when the poll is created and cannot be changed afterwards.
  - Deadline time defaults to the last time the member selected the target (when they settled on it), which stops ticking early and unticking. Each poll can switch to "first time" instead.
  - Removing all of a member's selections counts as "not voted", but history keeps its earlier times.
  - In multiple-choice polls, a member's status follows their selected options in this order: any target option means at target; otherwise any excused option means excused; otherwise any in-progress or not-yet option means behind target; no selections means not voted.
  - With several target options selected, the completion time is the earliest of them.
  - Excused members do not block "everyone reached the target".

## 5. Build parts (proposed order)

1. Data and rules engine: tables, voting and history rules, defaulter lists, lateness, closing, tests. No API or UI. DONE (built, cleaned up, verified on PostgreSQL: 13 tests).
2A. Identity layer: admin and member tokens, join codes, name claiming with approve and reset, member management, migration and tests. No HTTP. DONE (verified: 24 tests).
2B. HTTP API: FastAPI endpoints for groups, members, joining, polls, voting, status and history, with error handling and tests. DONE (22 endpoints, verified end to end on a running server: 39 tests).
2C. Three small fixes found in review: a vote could be accepted in the instant after a poll was closed (stale read), a 403 message revealed group names, and the API defaulted the deadline-time mode to "first" instead of the agreed "last". DONE (verified: 42 tests; each new test fails when its fix is undone).
3A. Web app, member side: React foundation, API client, the join page and the shared poll page (claim a name, vote, see your own history). DONE (typecheck, build and 25 tests pass; the API client was also run against the live backend and matched). Cleanup done (build file untracked, generic group-mismatch error, radio indicator for single choice).
3B. Web app, creator side: create a group, member list management, create a poll, poll page with defaulter lists, history, share text and the close button. DONE (55 frontend tests; verified end to end in real browsers with a creator and four members).
3C. Name-claiming fixes found in local testing: the name list stayed stale after a conflict, a second tab in the same browser silently overwrote the saved identity (locking the first name), and members had no way to release a wrong name. Adds a member self-release endpoint plus frontend fixes. DONE (verified 5 Oct: 47 backend and 62 frontend tests; replayed in real browsers: a second tab follows the first tab's identity and cannot overwrite it, a stale claim shows "just taken" and disables the name, the list refreshes on returning to the tab, and "Not you? Switch name" frees the name). Cosmetic nit for later: on narrow phones the switch-name confirmation box sits cramped beside the "Recognized member" badge.
R. Roster and fields redesign (Inndhar's requirement, 5 Oct; steps proposed by Claude):
   R1a (backend): group fields with type, required, default value and one unique identifier field; members hold values for each field; duplicate names allowed once an identifier exists; existing names stay as the built-in display name. Built and reviewed 5 Oct: with the missing import added, 62 backend tests pass three runs in a row and 62 frontend tests still pass; live checks of defaults, backfill, identifier rules, row-level errors, the 30-field limit and a six-way concurrent add all behaved correctly.
   R1b (backend): claim by typing the identifier (a lookup endpoint that returns the name to confirm), the public name list hidden by default when an identifier exists with a group setting to allow it, and the identifier shown in status and history entries. DONE (verified 5 Oct); includes the import fix and a lookup rate limit. Note: until R5, the current web app cannot claim in a group that has an identifier unless the group's allow_name_list setting is on.
   R2 (backend): upload of .xlsx and .csv with column mapping, a preview with row-level problems, bulk add, a downloadable template, and an option to create fields from the sheet's headers. DONE (verified 5 Oct with real xlsx and csv uploads). Add-only (existing members are never changed by an upload); all or nothing; openpyxl and python-multipart added.
   R2c (backend): DONE (verified 7 Oct): lookup limiter counts only failed lookups (30 a minute per address, 300 a minute per join code), trusts only TRUSTED_PROXY_COUNT proxies from the right of X-Forwarded-For, frees old entries, and uploads are read with a size cap (a 50 MB upload is refused in under a second). On Render set TRUSTED_PROXY_COUNT=1.
   R3 (backend): DONE (verified 7 Oct): polls can include group fields and define poll-only fields; members save answers (PUT /polls/{id}/answers); results come as JSON, CSV or Excel with formula protection; group fields are never exposed to members. Behaviour to remember for R5: answers are saved as a partial update, so defaults fill in only for keys that are sent blank; the member form must pre-fill each default and send every field when saving.
   R4 (frontend): DONE (verified 8 Oct): roster page with Members, Fields and Import tabs, dashboard roster summary and allow-name-list switch, phone layout fix. Minor note: the member edit and add dialogs do not close on the Escape key.
   R5a (frontend, member side): DONE (verified 9 Oct): claim by typing the identifier with 'Is this you?' confirmation and clear messages for not found, already claimed and too many attempts; the optional name list shows masked hints only; the answer card pre-fills defaults, validates, and saves every field.
   R5b (frontend, creator side): DONE (verified 9 Oct): poll creation with included roster columns and poll-only questions; identifier shown next to names and in copied text ('Asha K (21001)'); results table with search, status filter, pages, Excel and CSV download; no sideways scroll on phones. Note: poll-only questions cannot be changed after a poll is created.
D1. Deployment (Neon database, Render free backend, Vercel free web app): configuration files (vercel.json with a catch-all rewrite and security headers, render.yaml, migrations run at start because Render's free plan has no pre-deploy step), database URL and CORS normalisation, a smoke test script. Prompt ready (part-d1-prompt.md); the step-by-step human guide is deploy-guide.md (to be saved as docs/DEPLOYMENT.md).
4. Reminders and AI: the external timer, due-reminder logic, description refining with confirmation, personalised messages, template fallback, quiet hours, the "everyone reached the target" notice, languages. Copy-paste text for WhatsApp.
5. Bot support in the backend (new): bot credential, chat-to-group and platform-user-to-member links, outgoing messages.
6. Telegram bot: native creation, voting, private defaulter list.
7. Discord bot.
8. Finishing: export, recurring polls, paid hosting switch, privacy text.

Order confirmed by Inndhar on 29 Sep. The web app comes first because it is the only full route for WhatsApp, lets Inndhar try the whole flow, and the bots sit on the same API.

## 6. Open questions

1. Is one extra tap (link voting) acceptable, or must the experience feel fully native from the start?
2. Which group type is first: classrooms, project teams, clubs, or study/fitness groups?
3. Confirm or change the default rules listed at the end of section 4 and the Part 2 identity mechanics.
4. Data retention and deletion rules for history and member lists.
5. What happens if a creator loses the admin token (no recovery exists yet), and how a second admin is added (they would have to share the token for now).
6. Is it acceptable that a poll link also lets a visitor join the group?
6b. (Resolved 5 Oct: Inndhar approved the proposal.) A poll-only field such as "willingness to ABC" can be the main vote (the options) or an extra field answered next to a vote; both are supported, and the main vote stays as it is.
7. The API does not return option roles after a poll is created, so the creator's poll page cannot show which options count as the target. Add an endpoint later if wanted.

## 7. Platform and hosting notes (as of Sep 2026, verify before relying)

- WhatsApp: you cannot add a bot to an ordinary existing group. Meta's official Groups API exists for Official Business Accounts only, with invite-only groups created through the API, a maximum of 8 participants, and no interactive messages (so no tap-to-vote buttons). Unofficial automation of personal numbers breaks WhatsApp's terms and risks bans. One-to-one business messages need opt-in and pre-approved templates.
- Telegram, Discord, Slack, Microsoft Teams: bots or apps can be added to existing groups. Discord can send slash commands and button clicks to a web address, so it does not need a permanent connection for this use.
- Render free tier: web services sleep after about 15 minutes of no traffic and take about a minute to wake; 750 free hours a month covers one always-on service; free Postgres there expires after 30 days, so it is not used.
- Neon free: about 0.5 GB, suspends after about 5 minutes idle and wakes quickly. Supabase free pauses after a week of inactivity.
- MongoDB Atlas free (M0) was considered and rejected: the data is relational and the "who is missing" lists fit Postgres better.

## 8. Out of scope unless Inndhar says otherwise

- Unofficial WhatsApp automation.
- Selling or offering the API to other developers.
- Redis or queues in the first version.
- Anything not listed in sections 3, 4 and 5.

## 9. Documentation to maintain

1. Product vision and target users
2. Feature spec (first release vs later)
3. User roles and permissions (creator, admin, member)
4. User flows: create poll, vote, close, remind
5. Rules document: option roles, single vs multiple choice, defaulter lists, late status, history timestamps, deadlines, edge cases such as removed votes
6. Identity and privacy: what is tracked, who sees it, retention, deletion
7. Reminder rules: intervals, quiet hours, stop conditions, tone
8. Per-platform notes and compliance
9. API reference and architecture overview
10. Security and abuse notes (impersonation, spam links)
11. Testing plan, deployment guide, decisions log (what was decided, when, why)
12. Roadmap, glossary, terms and privacy policy drafts

## 10. Status log

- 2026-09-29: ideation and feasibility finished. Decisions in section 3 confirmed, including the multiple-choice toggle, Postgres on a free non-expiring host, and building with a coding agent. Part 1 prompt written. Nothing built.
- 2026-09-29: Part 1 built by the coding agent, reviewed by Claude, and cleaned up (tests now run only on PostgreSQL, row lock added for concurrent votes). Verified: migration works on an empty database and all 13 tests pass on a real PostgreSQL server. Repo: github.com/InndharMuthukumaran/Polling-Web-App.
- 2026-09-29: Identity approach confirmed. Part 2 split into 2A (identity layer) and 2B (HTTP API); both prompts written.
- 2026-09-29: Part 2A built and reviewed: migration works on empty and populated databases, 24 tests pass, no plain tokens stored.
- 2026-09-29: Part 2B built and reviewed: 39 tests pass, full flow verified on a running server (create group, add members, claim, vote, status, history, close, permission checks, CORS). Review found two small issues, fixed by the Part 2C prompt.
- 2026-09-29: Review of Part 2B found a third small issue (API default for the deadline-time mode) and it was added to the 2C prompt. Native in-chat polling agreed as the direction for the bots; part order updated and confirmed; React with Vite and Tailwind confirmed. Part 3 split into 3A and 3B; prompts written.
- 2026-09-29: Part 2C built and reviewed: 42 tests pass three runs in a row on PostgreSQL, and each new test fails when its fix is removed. One small leftover: the member-vs-poll group mismatch error still includes both group IDs in its message; to be replaced with a generic message in the next backend prompt.
- 2026-09-29: Part 3A reviewed: typecheck, build and 25 tests pass, no extra libraries, backend untouched, and the frontend API functions ran correctly against the real backend (claim, vote, toggle off, history, closed poll). Three small leftovers go into part-3a-cleanup-prompt.md: a committed build file, group IDs in one error message, and a checkbox-style indicator on single-choice polls.
- 2026-09-30: Part 3B reviewed. Typecheck, build and 55 frontend tests pass; 43 backend tests pass. Ran the whole app in real headless browsers (creator plus four members): group creation, member list, poll creation with a past deadline, claiming names, voting, toggling a vote off and on, history, late marking, Copy defaulters (Ben and Diya), the all-reached banner after auto-refresh, closing, and the closed view for a member all worked, with no browser errors. Screens are clean and mobile friendly. Known gaps: no deployment config yet (the web app needs a rewrite rule on Vercel so links like /p/<id> open directly); reminders are plain copy-paste text; option roles are not shown to the creator after a poll is created.
- 2026-09-30: Inndhar finished basic local testing. Two issues reproduced in a headless browser and confirmed as real (not local-only): after a claim conflict the taken name stayed selectable, and three tabs of one browser share one saved identity per group, so the last claim overwrites the others (the earlier names stay claimed on the server and need a creator Reset). One browser is meant to be one person per group; the fix adds a clear message, a self-service switch-name action and protection against overwriting. Part 3C prompt written.
- 2026-10-05: Inndhar had not yet run Part 3C (GitHub showed no new commit). Inndhar asked for Excel upload and dynamic fields; refined idea of group master data plus per-poll field choices and poll-only fields, with the identifier required in every poll. Plan R1 to R5 recorded; 3C should still run first because it fixes the identity-overwrite problem and adds switch name, which the redesign keeps.
- 2026-10-05: Part 3C verified (see section 5). Schedule agreed to be reordered: R1 to R5, then deployment, then Part 4 and the bots.
- 2026-10-05: R1 split into R1a and R1b to keep each prompt small; R1a prompt written.
- 2026-10-05: R1a reviewed. All behaviour correct; the pushed commit lacked one import, so the app failed to start until it was added. R1b and R2 prompts written to run back to back.
- 2026-10-05: R1b and R2 verified: 100 backend tests pass three runs in a row, frontend unchanged (62 tests). Live checks: field creation from a sheet, first-upload identifier, dry run, all-or-nothing with spreadsheet row numbers, skip mode, csv with BOM and semicolon, file type and size limits, template with dropdowns, hidden name list, masked hints, generic lookup 404, taken lookup without a name, status entries with identifier. Two weaknesses found and put in R2c. R3 prompt written.
- 2026-10-06: Independent re-check of R1b and R2 against the pushed repo: 100 backend tests passed three runs in a row, 62 frontend tests passed, and live checks with real xlsx and csv uploads (preview, mapping, dry run, all-or-nothing errors with spreadsheet row numbers, duplicates, skip mode, fields and identifier created from a sheet, templates, size and file-type limits, zip bomb, a cell at row 1,000,000) all behaved correctly. The same review found that the lookup limiter counted successful lookups; R2c was amended rather than adding a separate prompt. Deployment note: set TRUSTED_PROXY_COUNT=1 on Render.
- 2026-10-07: R2c and R3 verified: 125 backend tests passed three runs in a row, migrations and downgrade work, 62 frontend tests pass. Live checks all behaved correctly: poll creation with included and poll-only fields (other groups' fields refused, name clashes refused), answers, results in JSON, CSV and Excel (a name starting with = is protected), results admin-only, deleted fields disappearing, closed polls rejecting answers, 60 successful lookups never limited, failed lookups limited at the 31st even with a faked header. Clearing a field default works by sending an empty string (null is ignored). R4 prompt written.
- 2026-10-08: R4 verified: typecheck and build pass, 87 frontend tests and 125 backend tests pass, no 'any', no new libraries, backend untouched. In real browsers with a real Excel file: template download, import with fields and the identifier created from the sheet, a dry run that shows '4 rows ready', the members table telling two people named Asha K apart by Register No, search by identifier, per-field edit form, a bad file reporting spreadsheet rows 3, 4 and 5 and saving nothing, the identifier's delete button disabled, the dashboard switch saved on the server, and no sideways scrolling at phone width. R5a and R5b prompts written.
- 2026-10-09: R5a and R5b verified: typecheck and build pass, 149 frontend tests and 125 backend tests pass, no 'any', no new libraries, backend untouched. Real-browser run of the placement scenario: poll created with Department and Resume as roster columns plus two questions; members claim by Register No (a wrong number and an already-claimed number give clear messages and reveal nothing); two people named Asha K are told apart everywhere; defaulters copy as 'Name (identifier)'; results table, Excel and CSV downloads correct; answers saved with defaults and validation; name list with masked hints. Render's free plan was confirmed to have no pre-deploy command, so migrations run in the start command.