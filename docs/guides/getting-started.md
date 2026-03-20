# Getting Started with the Iranti Control Plane

## What is the Iranti Control Plane?

Iranti is a local-first shared memory layer for AI agents. It stores facts, tracks how they change over time, and manages conflicts when multiple agents write contradictory information. Iranti itself runs quietly in the background — but until now, understanding what it knows, what it's doing, and whether it's healthy required raw SQL, scattered CLI commands, or filesystem inspection.

The Iranti Control Plane is the operator surface for Iranti. It gives you a browser-based dashboard where you can inspect the current state of memory, browse the history of any fact, watch the Librarian and Archivist work in real time, and diagnose integration and health problems — without writing a single SQL query. If you've ever opened Adminer to figure out what Iranti is storing, or tailed logs to understand why a write conflicted, this is the tool that replaces those workflows.

---

## Prerequisites

Before you start, you need the following already running:

- **Node.js 18 or later.** The control plane is a Node.js server and frontend build. Run `node --version` to confirm. If you need to install or upgrade Node, use [nvm](https://github.com/nvm-sh/nvm) or download from [nodejs.org](https://nodejs.org).

- **A running Iranti instance.** The control plane reads from Iranti's PostgreSQL database. You need a working Iranti install at `http://localhost:3001` (or your configured port). If Iranti isn't set up yet, refer to the Iranti installation documentation to get a local instance running before continuing.

- **PostgreSQL with pgvector.** Iranti stores facts in PostgreSQL and uses pgvector for semantic search. Both must be running. In the default local setup, Iranti's database is named `iranti`, running on `localhost:5432`, accessible as the `postgres` user with no password. If you're using Docker, the container is typically named `iranti_db`.

- **Your `.env.iranti` file.** The control plane reads this file to connect to Iranti's database and check provider key presence. It should be in your Iranti runtime root (typically `~/.iranti/.env.iranti`). At minimum, it needs `DATABASE_URL` set. Provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) are read for health checks but are never displayed.

---

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/your-org/iranti-control-plane.git
cd iranti-control-plane
npm install
```

Copy the example environment file and edit it to point at your Iranti database:

```bash
cp .env.example .env
```

Open `.env` and set the `DATABASE_URL` to match your Iranti PostgreSQL connection. Example:

```
DATABASE_URL=postgresql://postgres@localhost:5432/iranti
PORT=4000
```

The control plane runs on port `4000` by default to avoid conflicting with Iranti's own port (`3001`). You can change this with the `PORT` variable.

Start the development server:

```bash
npm run dev
```

When it's working, you'll see output like this in your terminal:

```
[control-plane] Server running on http://localhost:4000
[control-plane] Connected to PostgreSQL at localhost:5432/iranti
[control-plane] API ready at http://localhost:4000/api/control-plane
```

If you see a database connection error instead, confirm that PostgreSQL is running and that `DATABASE_URL` in your `.env` matches your Iranti setup.

---

## Running the Migration

The control plane adds one table to your Iranti database: `staff_events`. This table stores the structured event stream that powers the Staff Activity view. Without it, the events endpoints return a clear error and the Activity Stream tab will show a "migration not applied" warning.

Run the migration once, after `npm install`:

```bash
npm run migrate
```

This creates the `staff_events` table and its indexes. It does not touch any existing Iranti tables (`knowledge_base`, `archive`, `entity_relationships`). If the table already exists, the migration is a no-op.

You only need to run this once. After that, the table persists across restarts.

---

## Opening the Control Plane

Navigate to `http://localhost:4000` in your browser. You'll land on the **Health** dashboard — this is the first screen by design.

The Health dashboard shows a list of checks run against your local setup:

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

The sidebar on the left gives you access to the other views: Memory Explorer, Archive, Staff Activity, Instances, and Health.

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
