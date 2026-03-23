# Getting Started with the Iranti Control Plane

## What is the Iranti Control Plane?

Iranti is a local-first shared memory layer for AI agents. It stores facts, tracks how they change over time, and manages conflicts when multiple agents write contradictory information. Iranti itself runs quietly in the background — but until now, understanding what it knows, what it's doing, and whether it's healthy required raw SQL, scattered CLI commands, or filesystem inspection.

The Iranti Control Plane is the operator surface for Iranti. It gives you a browser-based dashboard where you can inspect the current state of memory, browse the history of any fact, watch the Librarian and Archivist work in real time, and diagnose integration and health problems — without writing a single SQL query. If you've ever opened Adminer to figure out what Iranti is storing, or tailed logs to understand why a write conflicted, this is the tool that replaces those workflows.

---

## What's Available Now

The following views are functional as of v0.7.0+ (Phase 7 complete):

| View | What it does |
|---|---|
| **Memory Explorer** | Browse the live knowledge base (`/memory`). Filter by entity type, entity ID, key, source, agent, and confidence. Expanded fact rows show a **Conflict History** timeline for any fact that has conflict log entries, field-level stability and last-accessed data, and clear "Written by" / "Source" labels. (Wave 4 — CP-T053, PM-accepted 2026-03-21) |
| **Archive Explorer** | Browse superseded and decayed facts (`/archive`). Filter by archived reason, resolution state, and date range. Expanded archive rows also show Conflict History timelines where applicable. |
| **Entity Detail** | Full entity page at `/memory/:entityType/:entityId` — a table of all current KB facts for the entity (key, value summary, confidence, source, agent, validFrom), a collapsible table of archived facts, a flat relationships list, entity alias tokens (Aliases tab), and contributors panel (who has written facts to this entity). A **Contributors** tab lists every agent that has written facts to this entity, ranked by write count, with links to their Agent Registry profiles. Breadcrumb back to Memory Explorer. (Phase 2 — CP-T036; Aliases: Wave 8/9 — CP-T061/CP-T065; Contributors: Wave 5 — CP-T057) |
| **Temporal History** | Per-key fact history at `/memory/:entityType/:entityId/:key` — every interval that key has held, with confidence, validFrom/validUntil, and archivedReason. Click any interval to expand and read the full raw JSON value. The live fact carries a "current" badge. An "As Of" date picker in the header lets you query what value a fact held at any point in the past — the matching historical interval is highlighted in the timeline. Empty state: "No history — this fact has not been superseded or archived." (Phase 2 — CP-T036; asOf picker: Wave 5 — CP-T056) |
| **Staff Activity Stream** | Live event stream of Librarian and Archivist operations (`/activity`). Filterable, real-time via SSE. Includes velocity counter, hover-pause, and Live/Paused badge (Phase 2 — CP-T037). |
| **Health Dashboard** | Structured diagnostic view (`/health`) — database reachability, provider keys, integration file checks, runtime version, memory decay configuration, vector backend status, and Attendant health signal. Includes the **Interactive Diagnostics Panel** (Wave 6 — CP-T059): click "Run Diagnostics" to actively probe Iranti connectivity, API key auth, DB, vector backend, and memory round-trip with actionable fix suggestions. Also reachable from the command palette. (Wave 4/6 — CP-T052, CP-T059, PM-accepted 2026-03-21) |
| **Agent Registry** | Read-only view of all registered agents at `/agents` — last seen, active status, write volume, rejection rate, escalation history, and per-agent detail panel. (Wave 4 — CP-T051, PM-accepted 2026-03-21) |
| **Instance Manager** | Discovered Iranti instances, runtime metadata, project bindings, and Claude/Codex integration status (`/instances`). |
| **Getting Started / Onboarding** | Guided setup checklist at `/getting-started` — 4 steps covering database connection, provider configuration, project binding, and Claude/Codex integration. Auto-shown on first load when setup has never been completed. The sidebar nav item displays a persistent badge with the count of incomplete steps until all steps are resolved. A dismissible setup banner also appears in the page header until setup is complete. (Phase 2 — CP-T035) |
| **Integration Repair Actions** | Repair buttons in Health Dashboard for `.mcp.json` and `CLAUDE.md` issues; Doctor drawer (Phase 2 — CP-T033) |
| **Conflict and Escalation Review** | Review and resolve Resolutionist escalations at `/conflicts` (Phase 2 — CP-T021) |
| **Provider Status** | Provider key presence, reachability, and model list in Health Dashboard (Phase 2 — CP-T034) |
| **Provider Manager** | Standalone provider management at `/providers` — reachability history, warning thresholds (Phase 2 — CP-T046) |
| **Entity Relationship Graph** | Interactive radial graph in the Entity Detail Relationships tab — depth 1 or 2, click to navigate (Phase 2 — CP-T032) |
| **Command Palette** | Global Cmd+K / Ctrl+K palette for navigation and inline shortcuts help (Phase 2 — CP-T024/CP-T042) |
| **Staff Logs** | Persistent, queryable Staff event history at `/logs` — filter by component, date range, severity, agent, and event type; expand rows for full payload; export as JSONL or CSV (Phase 3 — CP-T050) |
| **Archivist History** | Per-fact Archivist event timeline in the Archive Explorer expanded row — every Archivist action on a fact with timestamp, reason, and agent. Flag facts for operator review and restore superseded values. Queue of flagged facts at `/archive?flagged=true` (Phase 3 — CP-T049) |
| **Metrics** | Historical KB growth, per-agent write volume, and activity summary statistics at `/metrics` — SVG-native line and bar charts over 7d/30d periods, 4 summary stat cards (total facts, facts last 24h, active agents last 7d, rejection rate). All data derived from `staff_events` table, no new infrastructure needed. (Wave 7 — CP-T060, PM-accepted 2026-03-21) |
| **Sessions** | Session recovery and checkpointing view at `/sessions` — browse active and completed agent sessions, checkpoints, and recovery state. |
| **Entity Aliases** | Entity Detail page at `/memory/:entityType/:entityId` includes a fourth "Aliases" tab showing all registered human-readable alias tokens for that entity (e.g., `alice` for `user/alice-doe`). Each alias shows the token in monospace, its source (manual/query), a confidence bar, and how long ago it was registered. Operators can register new aliases using a single-field "Alias token" form — the canonical entity is derived automatically from the current page. (Wave 8/9 — CP-T061/CP-T065, PM-accepted 2026-03-21) |
| **KB Full-Text / Semantic Search** | Global cross-KB search input at the top of the Memory Explorer (`/memory`). Type any query to search across all KB facts using Iranti's hybrid lexical + vector search — answer "which entities mention Project Iris?" or "what do agents know about onboarding?" without knowing entity type or ID upfront. Results are ranked by relevance score (shown as a percentage bar). If vector search is unavailable, falls back to lexical-only with a clear note. Requires a global-scope API key. (Wave 9 — CP-T066, PM-accepted 2026-03-21) |
| **Entity Type Browser** | When the Memory Explorer has no entity type filter active, shows a card grid of all distinct entity types in the KB — each with fact count and last updated time. Click "Browse →" to filter to that type. Replaces the previous empty-table initial state with a useful discovery view. Ideal for operators exploring an unfamiliar Iranti instance. (Wave 9 — CP-T067, PM-accepted 2026-03-21) |

---

## Prerequisites

Before you start, you need the following already running:

- **Node.js 18 or later.** The control plane is a Node.js server and frontend build. Run `node --version` to confirm. If you need to install or upgrade Node, use [nvm](https://github.com/nvm-sh/nvm) or download from [nodejs.org](https://nodejs.org).

- **A running Iranti instance.** The control plane reads from Iranti's PostgreSQL database. You need a working Iranti install at `http://localhost:3001` (or your configured port). If Iranti isn't set up yet, refer to the Iranti installation documentation to get a local instance running before continuing.

- **PostgreSQL with pgvector.** Iranti stores facts in PostgreSQL and uses pgvector for semantic search. Both must be running. In the default local setup, Iranti's database is named `iranti`, running on `localhost:5432`, accessible as the `postgres` user with no password. If you're using Docker, the container is typically named `iranti_db`.

- **An Iranti runtime root at `~/.iranti-runtime`.** The control plane discovers instances by scanning `~/.iranti-runtime/instances/<name>/`. Each instance directory must contain a `.env` file — that file is the authoritative runtime config for that instance (database URL, provider keys, port).

  The project directory also contains a `.env.iranti` binding file. This is a **pointer only** — it tells the control plane which instance to connect to via `IRANTI_INSTANCE_ENV`. It is not a config source.

  Critical distinction:

  - `DATABASE_URL`, `LLM_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` belong in the **instance env** (`~/.iranti-runtime/instances/<name>/.env`), created by `iranti init`.
  - `.env.iranti` in the project root contains only connection metadata: `IRANTI_URL`, `IRANTI_API_KEY`, `IRANTI_AGENT_ID`, `IRANTI_INSTANCE`, and `IRANTI_INSTANCE_ENV` (the path to the instance env).
  - Never put provider API keys or `DATABASE_URL` in `.env.iranti` — they have no effect there.

  See [docs/guides/config-authority-model.md](config-authority-model.md) for a full explanation of this two-file model.

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

Ensure your project root has a `.env.iranti` binding file pointing at your Iranti instance. If you ran `iranti init`, this file was created for you. It should look like:

```dotenv
IRANTI_URL=http://localhost:3001
IRANTI_API_KEY=<your-instance-api-key>
IRANTI_AGENT_ID=<your-agent-id>
IRANTI_INSTANCE=local
IRANTI_INSTANCE_ENV=C:\Users\<user>\.iranti-runtime\instances\local\.env
```

The `IRANTI_INSTANCE_ENV` path is how the control plane finds your instance's runtime config (database URL, provider keys, port). The `DATABASE_URL` and provider keys live in the instance env — not here.

The control plane server runs on port `3002` by default in development. You can change this with the `CONTROL_PLANE_PORT` variable in `.env.iranti`.

---

## Running the Migration

The control plane adds one table to your Iranti database: `staff_events`. This table stores the structured event stream that powers the Staff Activity view.

As of v0.7.0, migrations run automatically on startup. You do not need to run them manually on a fresh install.

If the Health dashboard shows a `staff_events` warning after startup, restart the control plane — the migration will retry. If the warning persists, run it manually from the server directory:

```bash
cd src/server
npm run migrate
```

This creates the `staff_events` table and its indexes. It does not touch any existing Iranti tables (`knowledge_base`, `archive`, `entity_relationships`). If the table already exists, the migration is a no-op and is safe to re-run.

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

You'll land on the **Memory Explorer** by default. Use the sidebar on the left to navigate between views. The sidebar lists all live sections in order:

1. **Memory Explorer** (`/memory`) — browse the live knowledge base
2. **Archive** (`/archive`) — browse superseded and decayed facts
3. **Activity** (`/activity`) — live Staff event stream
4. **Logs** (`/logs`) — persistent, queryable Staff event history with export
5. **Metrics** (`/metrics`) — historical KB growth, agent write volume, and activity statistics
6. **Sessions** (`/sessions`) — session recovery and checkpointing view
7. **Instances** (`/instances`) — discovered Iranti instances and project bindings
8. **Health** (`/health`) — diagnostics and integration checks
9. **Conflicts** (`/conflicts`) — review and resolve Resolutionist escalations
10. **Providers** (`/providers`) — provider reachability and model management
11. **Agents** (`/agents`) — registered agent registry with health stats
12. **Getting Started** (`/getting-started`) — guided first-run setup checklist

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
| **Claude API Key** | Is `ANTHROPIC_API_KEY` present in the selected instance env? `warn` if missing while `LLM_PROVIDER=claude`. |
| **OpenAI Key** | Same check for `OPENAI_API_KEY` when `LLM_PROVIDER=openai`. |
| **Default Provider** | Is `LLM_PROVIDER` set to a valid value (`claude` or `openai`) in the selected instance env? If not set or set to an invalid value (e.g., `anthropic`), runtime routing is ambiguous. |
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

### Run `iranti doctor` first

Before diving into specific errors, run Iranti's built-in diagnostics:

```bash
iranti doctor --debug
```

Available since Iranti v0.2.12, `iranti doctor` checks database connectivity, environment variables, provider keys, and project bindings in one pass. The `--debug` flag outputs the full check log including values (with secrets masked). This is the fastest way to confirm whether an issue is with Iranti itself, the connection between the control plane and Iranti, or the control plane configuration.

```bash
iranti --debug          # verbose flag for any iranti subcommand
iranti doctor           # health check without verbose output
iranti doctor --debug   # full diagnostic output — recommended starting point
```

If `iranti doctor` reports green across the board but the control plane still shows errors, the issue is in the control plane's own `.env` file or network binding.

---

### "DB unreachable" error on the Health dashboard

The control plane cannot connect to PostgreSQL. Things to check:

1. Is PostgreSQL running? On most local setups: `pg_isready -h localhost -p 5432`. If not running, start it — or if you use Docker, start the `iranti_db` container.
2. Does `DATABASE_URL` in the selected instance env match the actual PostgreSQL connection for that instance? A common mismatch is the database name (`iranti` vs `iranti_dev`) or the port.
3. Does the PostgreSQL user in `DATABASE_URL` have read access to the `iranti` database? The control plane is read-only, but it still needs `SELECT` permissions on all tables.

### "No provider key found" warning

The Health dashboard shows `warn` for `anthropic_key` and `openai_key`. This means the selected instance is missing the credential required by its active provider.

The control plane itself does not make LLM calls — this is a warning about Iranti's runtime configuration. Without a provider key, Iranti's write operations that require an LLM call will fail. Fix it in the selected instance env, typically `~/.iranti-runtime/instances/<name>/.env`, or use the Provider Manager:

```
ANTHROPIC_API_KEY=sk-ant-...
LLM_PROVIDER=claude
```

Then restart the instance and reload the Health dashboard.

### "No instances found" on the Instances page

The control plane discovers Iranti instances by scanning `~/.iranti-runtime/instances/` and reading each instance directory directly. It does not require a separate registry file.

If the Instances page shows an empty list:

1. Check whether `~/.iranti-runtime/instances/` exists.
2. Confirm that each instance directory contains a `.env` file.
3. If you launched Iranti with a custom runtime root, set `IRANTI_HOME` before starting the control plane so discovery points at the right directory.

Even with no instances found, the Health dashboard and Memory Explorer still work — they connect directly to the database specified in the control plane's own `.env` file.

### "staff_events table not found" warning

Migrations run automatically on startup. If you see this warning, restart the control plane — the migration will retry on the next startup. If it persists, run `npm run migrate` manually from `src/server/` (not the project root).

---

## Phase 2 — Complete (v0.2.0-beta)

Phase 2 shipped as v0.2.0-beta on 2026-03-20. All 18 Phase 2 tickets were PM-accepted. The following features are live:

| Feature | Ticket | Status |
|---|---|---|
| **Embedded Chat Panel** | CP-T020 | Complete — live Iranti chat, all 12 ACs |
| **Conflict and Escalation Review** | CP-T021 | Complete — review and resolve Resolutionist escalations |
| **Provider and Model Manager** | CP-T022 | Complete — read-only view; write path is Phase 3 |
| **CLI Setup Wizard** (`iranti setup`) | CP-T023 | Complete — 10 ACs, macOS verified |
| **Command Palette** | CP-T024 / CP-T042 | Complete — Cmd+K navigation, inline shortcuts help |
| **Native Staff Emitter Injection** (Attendant + Resolutionist events) | CP-T025 | Upstream PR submitted — enables full 4-component coverage |
| **Entity Detail + Temporal History** | CP-T036 | Complete |
| **Staff Activity Stream Live Mode** | CP-T037 | Complete — velocity counter, hover-pause, Live/Paused badge |
| **Integration Repair Actions** | CP-T033 | Complete |
| **Provider Credit and Quota Visibility** | CP-T034 | Complete |
| **Getting Started / First-Run Onboarding** | CP-T035 | Complete |
| **Entity Relationship Graph** | CP-T032 | Complete — SVG radial graph |
| **Provider Manager** | CP-T046 | Complete — `/providers` view, warning thresholds |

**Note on the Staff Activity Stream:** Event coverage for all four Staff components remains partial until CP-T025 (native emitter injection) is accepted upstream. Librarian and Archivist events are live; Attendant and Resolutionist events are labeled as "Phase 2 upstream" in the stream UI.

---

## Phase 3 — In Progress

Phase 3 advanced operator features began shipping on 2026-03-20.

| Feature | Ticket | Status |
|---|---|---|
| **Staff Logs View** | CP-T050 | Complete — persistent, queryable Staff event history with export |
| **Archivist Decision Transparency** | CP-T049 | Complete — Archivist History per fact, flag for review, restore |
| **Platform Installer Packages** | CP-T048 | In progress — implementation complete; clean-machine testing (AC-11) pending |
| **Agent Registry View** | CP-T051 | PM-accepted 2026-03-21 |
| **Health Extensions (Decay, Vector Backend, Attendant)** | CP-T052 | PM-accepted 2026-03-21 |
| **Memory Explorer: Conflict History + Field Label Fixes** | CP-T053 | PM-accepted 2026-03-21 |

---

## Known Issues

For a full list of current known issues, workarounds, and severities, see the [troubleshooting guide](troubleshooting.md). That guide covers the most common failure modes in detail, including instance discovery failures, provider key write issues, health check false positives, and database connectivity problems.
