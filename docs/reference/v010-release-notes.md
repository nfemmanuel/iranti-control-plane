# Iranti Control Plane — v0.1.0 Release Notes

**Version:** v0.1.0
**Date:** 2026-03-20
**Phase:** Phase 1 complete + CP-T036

---

## What is v0.1.0?

v0.1.0 is the first installable release of the Iranti Control Plane. It represents the completion of Phase 1 — the Operability MVP — plus CP-T036 (Entity Detail and Temporal History Views), which was added in Phase 2 to close a significant frontend gap before design partner handoff.

The control plane gives you a browser-based operator surface for a local Iranti instance: you can inspect what Iranti currently believes, trace how a fact changed over time, watch the Librarian and Archivist work in near-real time, and diagnose integration and health problems — without writing SQL, opening Adminer, or tailing logs.

This release targets solo developers, technical founders, and early design partners running Iranti locally. It is local-only, read-only (except for repair operations), and runs entirely against your existing Iranti PostgreSQL database.

---

## What's Included

### Phase 1 Core Views and Features

| View | What it does | Ticket |
|---|---|---|
| **Memory Explorer** | Browse the live knowledge base (`knowledge_base` table). Filter by entity type, entity ID, key, source, agent, and confidence. Expand rows to read full raw JSON, provenance, and conflict log. | CP-T010, CP-T013 |
| **Archive Explorer** | Browse superseded, decayed, and conflict-resolved facts (`archive` table). Additional filters: archived reason, resolution state, archived-before/after date ranges, superseded-by. | CP-T010, CP-T013 |
| **Entity Detail** | Full entity page at `/memory/:entityType/:entityId` — current facts, archived facts, and entity relationships in one view with breadcrumb navigation back to the KB. | CP-T010, CP-T036 |
| **Temporal History** | Fact history timeline at `/memory/:entityType/:entityId/:key` — every interval for an entity+key pair, newest first. Full raw JSON with no truncation. | CP-T010, CP-T036 |
| **Staff Activity Stream** | Near-real-time event stream of Librarian and Archivist operations (`/activity`). Powered by SSE with a 2-second polling adapter. Filterable by Staff component and event type. Pauseable with a 500-event client-side buffer. | CP-T012, CP-T014, CP-T026 |
| **Health Dashboard** | Structured diagnostics view (`/health`) with a four-tier severity taxonomy: Critical / Warning / Informational / Healthy. Covers database reachability, provider key presence, integration file checks, runtime version, and `staff_events` table status. | CP-T011, CP-T015, CP-T028, CP-T029 |
| **Instance and Project Manager** | Discovered Iranti instances, runtime metadata, project bindings, and Claude/Codex integration status (`/instances`). Read-only. Discovers instances via `~/.iranti/instances.json` or filesystem fallback scan. | CP-T011, CP-T016 |

### Visual System

The control plane uses the "Terminals" visual palette (CP-T017):

- **Accent:** Emerald `#10b981`
- **Canvas (dark mode):** Near-black `#0a0a0a`
- **Canvas (light mode):** Off-white `#fafaf9`
- **Typography:** Monospace accent for entity identifiers and keys
- Full light and dark mode support with system preference detection
- CSS-loaders.com spinner component (conic-gradient arc, accent color)

---

## Defect Resolved in v0.1.0

### CP-D001 — Column Name Mismatch (FIXED)

**Status: FIXED — commit `8e5479c`, CI green.**

QA seed testing revealed that all SQL queries in the control plane server used snake_case column names (`entity_type`, `entity_id`, `valid_from`) while the Iranti Prisma database schema uses camelCase (`entityType`, `entityId`, `validFrom`). This caused all data read paths to fail on a live database. The fix applied explicit column aliasing in all queries. All data paths — Memory Explorer, Archive Explorer, Entity Detail, Temporal History, and Staff Activity Stream — are confirmed working with a live Iranti database.

**Note (2026-03-20):** Post-fix QA testing identified two additional schema mismatches (CP-D002): the entity detail and relationships endpoints use incorrect table/column names. These are being patched. Entity detail and temporal history views may return errors until CP-D002 is resolved. All other views (Memory Explorer, Archive, Health, Instances) are unaffected.

---

## How to Install

See `docs/guides/getting-started.md` for full installation instructions.

Quick start:

```bash
git clone https://github.com/your-org/iranti-control-plane.git
cd iranti-control-plane
npm run setup         # installs server + client dependencies
cp .env.example .env  # set DATABASE_URL to match your Iranti PostgreSQL connection
npm run migrate       # creates staff_events table (one-time)
npm run dev           # starts server at localhost:3002 and client at localhost:5173
```

Open `http://localhost:5173` in your browser.

---

## Known Issues

See `docs/reference/known-issues.md` for the full known-issues list.

**Summary of P0 and P1 issues:**

- **CP-D001** — column name mismatch affecting all data read paths: **FIXED in v0.1.0** (commit `8e5479c`)
- **KI-002** — `entity` field always `null` in entity detail — `entities` table not in current Iranti schema (P1, known, no workaround)
- **KI-003** — Attendant and Resolutionist events absent from Staff Activity Stream (P1, Phase 2 fix)
- **KI-005** — `staff_events` migration must be run manually (P1, workaround: `npm run migrate`)
- **KI-006** — Instance Manager repair actions write to `process.cwd()` regardless of `projectId` (P1, Phase 2 gap)
- **KI-007** — Getting Started screen and repair button UI: frontend implemented, pending QA end-to-end verification (P2, testing gap)
- **KI-008** — `DATABASE_URL` must be in project-root `.env.iranti`; if absent, all data views fail (Warning, workaround: `cp ~/.iranti/instances/local/.env .env.iranti`)

---

## What's Coming in Phase 2

Phase 2 is in progress as of 2026-03-20. The headline additions:

- **Embedded Chat Panel** — run Iranti Chat from within the control plane without leaving the management surface. Choose agent, provider, and model, and see retrieved memory blocks inline.
- **Conflict and Escalation Review** — a dedicated surface for pending escalations and Resolutionist decisions, replacing the need to inspect escalation files directly.
- **Provider and Model Manager** — configure default providers, per-task model overrides, and view provider credential status and available quota signals from one screen.
- **CLI Setup Wizard** (`iranti setup`) — a guided `clack`-based CLI wizard covering installation, database setup, provider configuration, and project binding — targeting under 3 minutes for a fresh macOS install.

Other Phase 2 items include native Staff emitter injection (Attendant + Resolutionist event coverage), an entity relationship graph view, a command palette (Cmd+K), integration repair actions, and full-text search.

---

## Feedback

Please share feedback, bug reports, and feature requests as GitHub issues:

```
https://github.com/your-org/iranti-control-plane/issues
```

When filing a bug, include: your OS, Node.js version, Iranti version, browser, and the relevant section of the Health Dashboard output. Check `docs/reference/known-issues.md` first to see if the issue is already documented.
