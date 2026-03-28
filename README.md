# Iranti Control Plane

Local-first operator dashboard for [Iranti](https://github.com/nfemmanuel/iranti) - inspect memory, watch Staff activity, manage instances, and diagnose your setup without raw SQL.

## Status

Current package version: `0.4.1`.
The operator surface is live and under active UX hardening.

## Install

For the packaged control-plane CLI path (after npm publish, or from a locally packed tarball):

```bash
npm install -g iranti-control-plane
iranti-cp
```

That path uses the bundled server and picks the first free port in `3000-3010` unless `CONTROL_PLANE_PORT` is set.

Useful packaged CLI commands:

```bash
iranti-cp open
iranti-cp start --port 3010
iranti-cp status
iranti-cp doctor --instance my_instance
iranti-cp upgrade self
iranti-cp upgrade iranti --all --dry-run
```

Use `iranti-cp --help` to see the full command list.

## Quick Start

**Prerequisites**: Node.js 20+, a running Iranti instance with a PostgreSQL database.

```bash
# 1. Clone
git clone https://github.com/nfemmanuel/iranti-control-plane
cd iranti-control-plane

# 2. Make sure the repo root has a project binding file (.env.iranti)
#    created by `iranti setup` or `iranti configure project .`

# 3. Install all dependencies (server, client, and root workspace tools)
bash scripts/dev-setup.sh      # macOS/Linux
# or: .\scripts\dev-setup.ps1  # Windows PowerShell
# or manually: npm install && npm run setup

# 4. Run the migration (creates required tables)
npm run migrate

# 5. Start the dev servers (server + client together)
npm run dev
```

Open http://localhost:5173 for the frontend dev server.

### Port model

The control plane has two common local startup modes:

- **From source (`npm run dev`)**: the control-plane server listens on `3002` by default and the Vite frontend listens on `5173`.
- **From the packaged CLI (`iranti-cp`)**: the control plane picks the first free port in `3000-3010` unless you set `CONTROL_PLANE_PORT`.

Iranti runtimes themselves still typically start on `3001`, and local PostgreSQL defaults remain on `5432`.

### Local PostgreSQL with Docker

No system PostgreSQL? Spin one up:

```bash
docker compose up -d
```

This starts a `pgvector/pgvector:pg16` instance on port 5432 with database `iranti`, user `iranti`, password `iranti`. Then set in `.env.iranti`:

```
DATABASE_URL=postgresql://iranti:iranti@localhost:5432/iranti
```

## Project Structure

| Path | Contents |
|---|---|
| `docs/prd/` | Product requirements |
| `docs/specs/` | Architecture and design specs |
| `docs/tickets/` | Ticket breakdown |
| `docs/implementation/` | Backend implementation plans |
| `src/server/` | Express API server (TypeScript) |
| `src/client/` | React frontend (Vite + TypeScript) |
| `scripts/` | Dev setup scripts |
| `public/control-plane/` | Client build output (generated) |

## Development

### Root workspace scripts

The root `package.json` provides convenience scripts that orchestrate both server and client. Run these from the repo root:

| Script | Command | Description |
|---|---|---|
| `dev` | `npm run dev` | Start server and client concurrently with labeled output |
| `build` | `npm run build` | Build client then server for production |
| `start` | `npm run start` | Start the compiled server (production mode) |
| `migrate` | `npm run migrate` | Run database migrations |
| `setup` | `npm run setup` | Install server and client dependencies |

> `npm run dev` uses `concurrently` (a root devDependency). Run `npm install` at the repo root — or use `dev-setup.sh` / `dev-setup.ps1` — before using it.

### Run processes individually

```bash
# Server (port 3002 in source dev, hot-reloaded via tsx watch)
npm run dev --prefix src/server

# Client (port 5173, Vite HMR)
npm run dev --prefix src/client

# Build for production
npm run build --prefix src/client   # outputs to public/control-plane/
npm run build --prefix src/server   # outputs to src/server/dist/

# Run migrations
npm run migrate --prefix src/server

# Type check
cd src/server && npx tsc --noEmit
cd src/client && npx tsc --noEmit
```

## Architecture

The control plane is a standalone Express server + React SPA that connects to the same PostgreSQL database as your Iranti instance. It never writes to Iranti's core tables — all state changes go through Iranti's API.

- **Server**: Express on port `3002` in source development; the packaged binary auto-selects the first free port in `3000-3010` unless `CONTROL_PLANE_PORT` is set
- **Client**: React 18 + Vite, proxies `/api` to the control-plane server at `localhost:3002` in development
- **Database**: Shares the Iranti PostgreSQL instance; reads core tables, writes only to control-plane-owned tables

See `docs/specs/control-plane-api.md` for the full API spec and `docs/prd/control-plane.md` for product requirements.

For release and manual publish checks, see [`docs/guides/releasing.md`](docs/guides/releasing.md).

