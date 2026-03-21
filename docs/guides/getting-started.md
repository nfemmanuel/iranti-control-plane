# Getting Started with the Iranti Control Plane

## What is the Iranti Control Plane?

Iranti is a local-first shared memory layer for AI agents. It stores facts, tracks how they change over time, and manages conflicts when multiple agents write contradictory information. Iranti itself runs quietly in the background — but until now, understanding what it knows, what it's doing, and whether it's healthy required raw SQL, scattered CLI commands, or filesystem inspection.

The Iranti Control Plane is the operator surface for Iranti. It gives you a browser-based dashboard where you can inspect the current state of memory, browse the history of any fact, watch the Librarian and Archivist work in real time, and diagnose integration and health problems — without writing a single SQL query. If you've ever opened Adminer to figure out what Iranti is storing, or tailed logs to understand why a write conflicted, this is the tool that replaces those workflows.

---

## What's Available Now

The following views are functional as of 2026-03-20:

| View | What it does |
|---|---|
| **Memory Explorer** | Browse the live knowledge base (`/memory`). Filter by entity type, entity ID, key, source, agent, and confidence. |
| **Archive Explorer** | Browse superseded and decayed facts (`/archive`). Filter by archived reason, resolution state, and date range. |
| **Entity Detail** | Full entity page at `/memory/:entityType/:entityId` — a table of all current KB facts for the entity (key, value summary, confidence, source, agent, validFrom), a collapsible table of archived facts, a flat relationships list, and a breadcrumb back to Memory Explorer. (Phase 2 — CP-T036) |
| **Temporal History** | Per-key fact history at `/memory/:entityType/:entityId/:key` — every interval that key has held, with confidence, validFrom/validUntil, and archivedReason. Click any interval to expand and read the full raw JSON value. The live fact carries a "current" badge. Empty state: "No history — this fact has not been superseded or archived." (Phase 2 — CP-T036) |
| **Staff Activity Stream** | Live event stream of Librarian and Archivist operations (`/activity`). Filterable, real-time via SSE. Includes velocity counter, hover-pause, and Live/Paused badge (Phase 2 — CP-T037). |
| **Health Dashboard** | Structured diagnostic view (`/health`) — database reachability, provider keys, integration file checks, and runtime version. |
| **Instance Manager** | Discovered Iranti instances, runtime metadata, project bindings, and Claude/Codex integration status (`/instances`). |
| **Getting Started / Onboarding** | Guided setup checklist at `/getting-started` — 4 steps covering database connection, provider configuration, project binding, and Claude/Codex integration. Auto-shown on first load when setup has never been completed. The sidebar nav item displays a persistent badge with the count of incomplete steps until all steps are resolved. A dismissible setup banner also appears in the page header until setup is complete. (Phase 2 — CP-T035) |
| **Integration Repair Actions** | Repair buttons in Health Dashboard for `.mcp.json` and `CLAUDE.md` issues; Doctor drawer (Phase 2 — CP-T033) |
| **Conflict and Escalation Review** | Review and resolve Resolutionist escalations at `/conflicts` (Phase 2 — CP-T021) |
| **Provider Status** | Provider key presence, reachability, and model list in Health Dashboard (Phase 2 — CP-T034) |
| **Provider Manager** | Standalone provider management at `/providers` — reachability history, warning thresholds (Phase 2 — CP-T046) |
| **Entity Relationship Graph** | Interactive radial graph in the Entity Detail Relationships tab — depth 1 or 2, click to navigate (Phase 2 — CP-T032) |
| **Command Palette** | Global Cmd+K / Ctrl+K palette for navigation and inline shortcuts help (Phase 2 — CP-T024/CP-T042) |
| **Staff Logs** | Persistent, queryable Staff event history at `/logs` — filter by component, date range, severity, agent, and event type; expand rows for full payload; export as JSONL or CSV (Phase 3 — CP-T050) |

---

## Prerequisites

Before you start, you need the following already running:

- **Node.js 18 or later.** The control plane is a Node.js server and frontend build. Run `node --version` to confirm. If you need to install or upgrade Node, use [nvm](https://github.com/nvm-sh/nvm) or download from [nodejs.org](https://nodejs.org).

- **A running Iranti instance.** The control plane reads from Iranti's PostgreSQL database. You need a working Iranti install at `http://localhost:3001` (or your configured port). If Iranti isn't set up yet, refer to the Iranti installation documentation to get a local instance running before continuing.

- **PostgreSQL with pgvector.** Iranti stores facts in PostgreSQL and uses pgvector for semantic search. Both must be running. In the default local setup, Iranti's database is named `iranti`, running on `localhost:5432`, accessible as the `postgres` user with no password. If you're using Docker, the container is typically named `iranti_db`.

- **Your `.env.iranti` file at the project root.** The control plane reads `.env.iranti` from the `iranti-control-plane/` project root at startup. This file must contain `DATABASE_URL` at minimum. Provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) are read for health checks but are never displayed.

  **Important:** If you have Iranti installed, your credentials are at `~/.iranti/instances/local/.env` (or `~/.iranti/.env.iranti` in older installs). You must copy them to the project root:

  ```bash
  cp ~/.iranti/instances/local/.env .env.iranti
  ```

  If the file is missing or `DATABASE_URL` is absent, all data views will fail with a database connection error. See KI-008 in `docs/reference/known-issues.md` for details.

---

## Installation

Clone the repository:

```bash
git clone https://github.com/your-org/iranti-control-plane.git
cd iranti-control-plane
```

Install dependencies for both the server and client. The root `package.json` provides a convenience script for this:

```bash
npm run setup
```

This is equivalent to `npm install --prefix src/server && npm install --prefix src/client`. Running `npm install` at the root alone is not sufficient — it only installs `concurrently` (the dev runner) and does not install the server or client dependencies.

Copy the example environment file and edit it to point at your Iranti database:

```bash
cp .env.example .env
```

Open `.env` and set the `DATABASE_URL` to match your Iranti PostgreSQL connection. Example:

```
DATABASE_URL=postgresql://postgres@localhost:5432/iranti
CONTROL_PLANE_PORT=3002
```

The control plane server runs on port `3002` by default. You can change this with the `CONTROL_PLANE_PORT` variable.

---

## Running the Migration

The control plane adds one table to your Iranti database: `staff_events`. This table stores the structured event stream that powers the Staff Activity view. Without it, the events endpoints return a clear error and the Activity Stream tab will show a "migration not applied" warning.

Run the migration once, after `npm run setup`:

```bash
npm run migrate
```

This creates the `staff_events` table and its indexes. It does not touch any existing Iranti tables (`knowledge_base`, `archive`, `entity_relationships`). If the table already exists, the migration is a no-op.

You only need to run this once. After that, the table persists across restarts.

---

## Starting the Development Server

From the project root, run:

```bash
npm run dev
```

This uses `concurrently` to start both processes simultaneously:

- **Server** (`src/server`): Express API server at `http://localhost:3002`
- **Client** (`src/client`): Vite dev server at `http://localhost:5173`

When both are running, you'll see output from both processes interleaved in your terminal:

```
[0] [iranti-cp] Control plane running at http://localhost:3002
[0] [iranti-cp] API at http://localhost:3002/api/control-plane/
[1]   VITE v5.x.x  ready in 300 ms
[1]   ➜  Local:   http://localhost:5173/
```

If you prefer to run the two processes separately (useful for debugging one without the other):

```bash
# Terminal 1 — server only
cd src/server && npm run dev

# Terminal 2 — client only
cd src/client && npm run dev
```

If you see a database connection error, confirm that PostgreSQL is running and that `DATABASE_URL` in your `.env` matches your Iranti setup.

---

## Opening the Control Plane

**In development:** Navigate to `http://localhost:5173` in your browser.

**In production (built frontend served by server):** Navigate to `http://localhost:3002/control-plane`.

You'll land on the **Memory Explorer** by default. Use the sidebar on the left to navigate between views. The sidebar lists all nine live sections in order:

1. **Memory Explorer** (`/memory`) — browse the live knowledge base
2. **Archive** (`/archive`) — browse superseded and decayed facts
3. **Activity** (`/activity`) — live Staff event stream
4. **Logs** (`/logs`) — persistent, queryable Staff event history with export
5. **Instances** (`/instances`) — discovered Iranti instances and project bindings
6. **Health** (`/health`) — diagnostics and integration checks
7. **Conflicts** (`/conflicts`) — review and resolve Resolutionist escalations
8. **Providers** (`/providers`) — provider reachability and model management
9. **Getting Started** (`/getting-started`) — guided first-run setup checklist

**Settings** is a Phase 2 item — it appears in the sidebar as a disabled placeholder and is not yet functional.

---

## First-Run Behavior and Setup Status

On a fresh install — before any setup steps have been completed and before the `.iranti-cp-setup-complete` flag file exists — the app automatically redirects to `/getting-started` on first load. This happens regardless of which URL you navigate to. It is not a hard block: clicking "Skip for now" on the Getting Started page dismisses the screen for the current session (it does not persist across page reloads until setup is marked complete).

### Setup badge on the nav item

The **Getting Started** sidebar nav item shows a persistent numeric badge with the count of incomplete or warning setup steps. The badge updates in real time as you complete steps and appears on every page — not only on `/getting-started`. Once all four steps reach a `complete` or `not_applicable` status, the badge disappears.

### Setup banner in the page header

A banner reading "Setup incomplete — N steps remaining" appears at the top of the content area on every page until setup is complete. The banner links to `/getting-started`. You can dismiss it for the current session by clicking the `×` button — the dismissal is stored in React component state only and resets on page reload. The banner does not reappear within a session once dismissed, even if you navigate away and return.

---

## Navigation Tips

### Keyboard Shortcuts

The control plane ships with a command palette and keyboard navigation support as of Phase 2 (CP-T042).

**Opening the command palette:**

Press `Cmd+K` (macOS) or `Ctrl+K` (Windows / Linux) from any view to open the command palette. The palette is available everywhere — you do not need to be on a specific page.

The palette lists all views by name with a short description of each. To navigate:

- **Type** to search — the list filters as you type. Partial matches work: typing `mem` shows Memory Explorer and Archive Explorer.
- **`↑` / `↓` arrow keys** — move the highlight up and down through the results.
- **`Enter`** — navigate to the highlighted view.
- **`Esc`** — close the palette without navigating.

**Viewing all available shortcuts:**

Type `?` in the palette input, or click the `⌨ shortcuts` link at the bottom of the palette, to see a full list of keyboard shortcuts available in the current view. The shortcut reference updates depending on which view you are on — Activity Stream shortcuts (like toggling pause) appear only when you are on the Activity Stream page.

---

## The Health Dashboard

The Health dashboard (`/health`) shows a list of checks run against your local setup:

| Check | What it means |
|---|---|
| **DB Reachability** | Can the control plane connect to PostgreSQL? If this is `error`, nothing else works. |
| **DB Schema Version** | Is the database schema up to date? A `warn` here means you may be running a newer version of the control plane against an older Iranti schema. |
| **Vector Backend** | Is pgvector configured and reachable? Required for Iranti's semantic search. |
| **Anthropic Key** | Is `ANTHROPIC_API_KEY` present in `.env.iranti`? `warn` if missing — Iranti will fall back to another provider or fail writes that require LLM calls. |
| **OpenAI Key** | Same check for `OPENAI_API_KEY`. |
| **Default Provider** | Is `IRANTI_DEFAULT_PROVIDER` set? If not, Iranti uses a built-in fallback. |
| **MCP Integration** | Does your project have a `.mcp.json` with an Iranti server entry? |
| **CLAUDE.md Integration** | Does your project have a `CLAUDE.md` that references Iranti? |
| **Runtime Version** | What version of Iranti is running? |
| **Staff Events Table** | Does the `staff_events` table exist? If `warn`, run `npm run migrate`. |

A fully healthy setup shows all checks as **ok** with an overall status of **healthy** (shown in green). If you see **degraded** (amber), at least one check is a warning but nothing is broken. If you see **error** (red), at least one check failed and requires attention before you can use the full control plane.

---

## Entity Detail and Temporal History Views

Two views were added in Phase 2 (CP-T036, PM-accepted 2026-03-20) to close a Phase 1 gap:

### Entity Detail — `/memory/:entityType/:entityId`

Navigate to any entity's detail page by clicking "View Related Entities" in the Memory Explorer expanded row, or by typing the URL directly. The Entity Detail page shows:

- A header with entityType, entityId, fact count, and last-updated timestamp
- A table of all current facts for this entity (key, value summary, confidence, source, agent, validFrom)
- A collapsible table of all archived facts for this entity (same columns plus archivedReason and archivedAt)
- A flat list of all entity relationships — what this entity relates to, with relationship type and confidence
- A breadcrumb back to the Memory Explorer

**Note on the entity field:** The `entity` field in the API response is always `null` in Phase 1. The `entities` table does not yet exist in the current Iranti schema. Entity information is derived from the fact rows themselves (entityType, entityId).

### Temporal History — `/memory/:entityType/:entityId/:key`

Click any fact's key from the Entity Detail page to open its full temporal history. This view shows every interval that key has held for this entity, from the current live value back through all archived and superseded values:

- Each interval shows: value summary, confidence, source, agent, validFrom, validUntil, archivedReason (if archived), supersededBy (if applicable), and a "current" badge for the live fact
- Click any interval to expand it and read the full raw JSON value
- Empty state: "No history — this fact has not been superseded or archived" when there is only one interval

Full values are returned without truncation in the history view — unlike the list views where `valueRaw` is capped at 4 KB.

---

## Troubleshooting Your First Run

### "DB unreachable" error on the Health dashboard

The control plane cannot connect to PostgreSQL. Things to check:

1. Is PostgreSQL running? On most local setups: `pg_isready -h localhost -p 5432`. If not running, start it — or if you use Docker, start the `iranti_db` container.
2. Does `DATABASE_URL` in your `.env` file match exactly what Iranti uses in its `.env.iranti`? A common mismatch is the database name (`iranti` vs `iranti_dev`) or the port.
3. Does the PostgreSQL user in `DATABASE_URL` have read access to the `iranti` database? The control plane is read-only, but it still needs `SELECT` permissions on all tables.

### "No provider key found" warning

The Health dashboard shows `warn` for `anthropic_key` and `openai_key`. This means neither `ANTHROPIC_API_KEY` nor `OPENAI_API_KEY` was found in your `.env.iranti` file.

The control plane itself does not make LLM calls — this is a warning about Iranti's own configuration. Without a provider key, Iranti's write operations that require an LLM call will fail. To fix it, open your `.env.iranti` file (typically at `~/.iranti/.env.iranti`) and add:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Then reload the Health dashboard.

### "No instances found" on the Instances page

The control plane discovers Iranti instances by reading a registry file at `~/.iranti/instances.json` (on macOS/Linux) or `%USERPROFILE%\.iranti\instances.json` (on Windows). If that file doesn't exist, it falls back to scanning a short list of candidate paths for a `.env.iranti` file.

If the Instances page shows an empty list:

1. Check whether `~/.iranti/instances.json` exists. If it doesn't, Iranti hasn't written its registry yet. This is common if you installed Iranti before this feature was added.
2. Confirm that your Iranti runtime root (the directory containing `.env.iranti`) is one of the scanned candidates: `~/.iranti/`, `~/iranti/`, or the control plane's working directory.
3. If your Iranti instance lives somewhere else, you can manually add an entry to `~/.iranti/instances.json`. See the schema in the architecture overview for the expected format.

Even with no instances found, the Health dashboard and Memory Explorer still work — they connect directly to the database specified in the control plane's own `.env` file.

### "staff_events table not found" warning

Run `npm run migrate` from the project root. This creates the `staff_events` table that the Activity Stream depends on. It is a one-time operation.

---

## Phase 2 — In Progress

Phase 2 is currently in progress as of 2026-03-20. The following features are actively being developed or are pending:

| Feature | Ticket | Status |
|---|---|---|
| **Embedded Chat Panel** | CP-T020 | In progress — panel shell in development |
| **Provider and Model Manager write path** | CP-T022 | Phase 3 — read-only provider status already shipped (CP-T034/CP-T046) |
| **CLI Setup Wizard** (`iranti setup`) | CP-T023 | In progress |
| **Native Staff Emitter Injection** (Attendant + Resolutionist events) | CP-T025 | Upstream PR pending — enables live Attendant + Resolutionist events |

**Note on the Staff Activity Stream:** The live mode UI (status badge, velocity counter, hover-pause) has shipped in Phase 2 (CP-T037). Event coverage for all four Staff components remains partial: Librarian and Archivist events are emitted; Attendant and Resolutionist events will not appear until native emitter injection ships (CP-T025). The stream UI labels this limitation explicitly.

**v0.1.0 shipped 2026-03-20.** The column naming defects (CP-D001, CP-D002) identified in QA are resolved in commit `bbdb6ee`. All regression tests pass. Design partner handoff is unblocked.

---

## Known Issues

Before filing a bug report, check [`docs/reference/known-issues.md`](../reference/known-issues.md) for the full list of confirmed issues in v0.1.0.

Key items to be aware of:

- **CP-D001** (KI-001): The column naming defect affecting all data read paths is **fixed in v0.1.0** (commit `8e5479c`).
- **KI-002**: The `entity` field in entity detail responses is always `null` — the `entities` table is not yet in the Iranti schema.
- **KI-003**: The Staff Activity Stream covers Librarian and Archivist events only. Attendant and Resolutionist events require Phase 2 native emitter injection (CP-T025).
- **KI-005**: The `staff_events` migration must be run manually once with `npm run migrate`.

See the [full known-issues list](../reference/known-issues.md) for severities, workarounds, and Phase 2 fix timelines.
