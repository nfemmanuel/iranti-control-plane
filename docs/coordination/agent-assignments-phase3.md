# Phase 3 Agent Assignments

**Issued by:** `product_manager`
**Date:** 2026-03-20
**Phase:** 3 — Advanced Operator Features
**Milestone target:** v0.3.0

---

## Status

Phase 3 kickoff: 2026-03-20
Current wave: Wave 1
Ticket sequence: CP-T050 → CP-T049 → CP-T048

---

## Sequencing Rationale

### Why CP-T050 first (Staff Logs View)

CP-T050 has the clearest scope, the clearest data source (the `staff_events` table is live and indexed from CP-T039), and no write-path complexity. The backend work is a straightforward new query endpoint (`logs.ts`) following the exact pattern of `events.ts` and `kb.ts`. The frontend is a new paginated table at `/logs` with filter bar and export. No external dependencies, no upstream coordination required. It directly validates that the `staff_events` table is populated with useful operator data — validating the Phase 2 CP-T039 investment and building the evidentiary case for CP-T025 upstream PR submission.

### Why CP-T049 second (Archivist Transparency)

CP-T049 builds directly on what CP-T050 establishes. It adds write-path operations (flagging, restoration) and cross-links the Archive Explorer with the `staff_events` log. The backend needs a new `restore` endpoint and a flag storage mechanism. The frontend extends the existing ArchiveExplorer component rather than creating a net-new route. It is more complex than CP-T050 due to the mutation surface and the OQ-3 supersession handling, which is why it follows T050 rather than running in parallel with it in Wave 1.

### Why CP-T048 third (Platform Installers)

CP-T048 is categorically higher-complexity than T049 and T050 — it requires a Node SEA spike (ESM compatibility validation), multi-platform CI pipeline construction, code signing decisions, and artifact validation on clean machines. It has no functional dependency on T049 or T050, but it does benefit from the control plane being in a stable, feature-complete state before packaging infrastructure is built. The retrospective explicitly notes "packaging a rapidly-changing application creates rework on every build pipeline change." Sequencing it third gives T050 and T049 time to land, ensures the packaged binary includes the Logs and Archivist Transparency views, and keeps the devops_engineer's spike from running while backend/frontend are still actively modifying routes.

---

## Wave 1

### Assignment 1 — CP-T050 (Staff Logs View) — `backend_developer`

**Status:** Assigned — 2026-03-20
**Ticket:** `docs/tickets/cp-t050.md`
**Priority:** P2
**Phase:** 3, Wave 1

**Scope:**

Implement the backend for the Staff Logs persistent query surface. This is a new query endpoint over the `staff_events` table — the same table that `GET /events` polls for the SSE stream. The logs endpoint adds pagination, date range filtering, full-text search, and a download/export path that the SSE stream does not provide.

**Files to read before starting:**
- `docs/tickets/cp-t050.md` — full ticket, all acceptance criteria
- `src/server/routes/control-plane/events.ts` — existing events endpoint; `logs.ts` follows identical query-building and serialization patterns
- `src/server/routes/control-plane/kb.ts` — second pattern reference for pagination + where-clause construction
- `src/server/routes/control-plane/index.ts` — router registration; you must add `logsRouter` here
- `src/server/migrations/001_create_staff_events.sql` — confirms all column names: `event_id`, `timestamp`, `staff_component`, `action_type`, `agent_id`, `source`, `entity_type`, `entity_id`, `key`, `reason`, `level`, `metadata`
- `src/server/types.ts` — StaffEvent type; your serializer must produce this shape

**What to build:**

Create `src/server/routes/control-plane/logs.ts` implementing:

1. `GET /logs` — Paginated, sorted, filtered query over `staff_events`.

   Query params (all optional):
   - `component` — comma-separated filter on `staff_component` (Librarian, Attendant, Archivist, Resolutionist); same multi-value IN clause pattern as `events.ts`
   - `eventType` — exact match on `action_type`
   - `agentId` — exact match on `agent_id`
   - `entityType` — exact match on `entity_type`
   - `search` — ILIKE search across `action_type`, `agent_id`, `entity_type`, `entity_id`, `key`, and `CAST(metadata AS text)` — construct as: `(action_type ILIKE $N OR agent_id ILIKE $N OR entity_type ILIKE $N OR entity_id ILIKE $N OR key ILIKE $N OR CAST(metadata AS text) ILIKE $N)` using a `%term%` pattern
   - `since` — ISO 8601 timestamp lower bound on `timestamp`
   - `until` — ISO 8601 timestamp upper bound on `timestamp`
   - `level` — `audit` | `debug` (defaults to `audit`, same as events endpoint)
   - `limit` — integer 1–10000, default 50
   - `offset` — integer >= 0, default 0
   - `pageSize` — alias for `limit` when set to 25, 50, or 100 (accept either param)

   Response shape:
   ```json
   {
     "items": [ StaffEvent ],
     "total": 1234,
     "limit": 50,
     "offset": 0,
     "oldestEventTimestamp": "2026-03-15T10:00:00.000Z"
   }
   ```

2. `GET /logs/export` — Download the current filtered result (up to 10,000 rows) as JSONL or CSV.

   Query params: same filter params as `GET /logs`, plus `format=jsonl|csv` (default: `jsonl`).

   For JSONL: stream one JSON object per line, each line is a serialized `StaffEvent`.

   For CSV: header row matches the 8 column names from the ticket spec (Timestamp, Component, EventType, Agent, EntityType/EntityId, Key, Summary, Level). Summary is derived as: `metadata.summary ?? reason ?? action_type`.

   Response headers:
   - `Content-Disposition: attachment; filename="iranti-staff-logs-[ISO timestamp]-[component filter or 'all'].jsonl"`
   - `Content-Type: application/x-ndjson` for JSONL, `text/csv` for CSV

   Max rows: hard-cap at 10,000. If the filtered result exceeds 10,000 rows, return the first 10,000 and include `X-Export-Truncated: true` header.

Register `logsRouter` in `index.ts` as:
```ts
controlPlaneRouter.use('/logs', logsRouter)
```

**Graceful degradation:** If `staff_events` table does not exist (same check as in `events.ts`), return HTTP 503 with `{ error: "...", code: "EVENTS_TABLE_MISSING" }`.

**Acceptance criteria to verify before reporting back:**
- All 13 ACs from `cp-t050.md` checked
- TypeScript compiles (`tsc --noEmit`) with zero errors, no `any` in new code
- `vitest run` passes (existing tests must not regress)
- Manually test `GET /logs` with no params, with `component=Librarian`, with `since` and `until`, with `search=write_created`, and with `limit=10&offset=10`
- Manually test `GET /logs/export?format=jsonl` and `GET /logs/export?format=csv`
- Commit as: `feat(backend): implement Staff Logs query + export endpoint (CP-T050)`

**Report back to PM with:**
- Which ACs passed / any that could not be verified without live data
- Any schema surprises from `staff_events` (column names, nullable fields behaving unexpectedly)
- Whether the `search` ILIKE across metadata JSONB cast performed acceptably (mention query plan if concern)
- CI status

---

### Assignment 2 — CP-T050 (Staff Logs View) — `frontend_developer`

**Status:** Assigned — 2026-03-20
**Ticket:** `docs/tickets/cp-t050.md`
**Priority:** P2
**Phase:** 3, Wave 1

**Dependency:** Backend endpoint `GET /logs` must be merged before the frontend can fully test the data path. However, frontend can be developed against the existing `GET /events` endpoint (same shape) and switched to `/logs` once the backend lands. Coordinate with `backend_developer` on timing.

**Files to read before starting:**
- `docs/tickets/cp-t050.md` — full ticket, all acceptance criteria
- `src/client/src/main.tsx` — route registration; you must add `/logs` route here
- `src/client/src/components/stream/ActivityStream.tsx` — closest existing component in terms of data shape and filter bar patterns; reuse filter and display patterns
- `src/client/src/components/memory/ArchiveExplorer.tsx` — expandable row pattern to reuse for the expanded row detail
- `docs/specs/visual-tokens.md` — Terminals palette; all new components must use CSS tokens, no hardcoded colors

**What to build:**

Create `src/client/src/components/logs/StaffLogs.tsx` implementing:

1. **Route `/logs`** — Add to `main.tsx` as `<Route path="logs" element={<StaffLogs />} />` and add "Logs" to the AppShell sidebar navigation.

2. **Log table** — Paginated, sortable table with 8 columns as specified in the ticket. Default sort: `createdAt DESC` (most recent first). Columns:
   - Timestamp (relative + absolute on hover — same pattern as ActivityStream)
   - Component (color-coded badge: Librarian = emerald, Attendant = blue, Archivist = amber, Resolutionist = violet — use the same badge design as ActivityStream)
   - Event Type (`action_type`)
   - Agent (`agent_id`)
   - Entity (`entity_type/entity_id` or `—` if null)
   - Key (`key` or `—` if null)
   - Summary (derived: `metadata?.summary ?? reason ?? action_type`)
   - Level (derived classification — `error` if payload has `error` field or `action_type` contains `failed|rejected|error`; `warning` if `action_type` contains `conflict|decay|escalated|superseded`; `info` otherwise — render as a small colored dot or badge)

3. **Filter bar** — Component multi-select, event type text input, agent ID text input, level select (All/Info/Warning/Error), date range select ("Last 1 hour", "Last 24 hours", "Last 7 days", "Custom" with date pickers), full-text search input, "Clear all" button. Filters drive query params to `GET /api/control-plane/logs`.

4. **Pagination** — Page size options: 25, 50, 100. Use `limit` + `offset` params. Show total row count.

5. **Expanded row** — Clicking a row expands inline to show: full `metadata` payload as syntax-highlighted JSON (reuse the raw JSON expand pattern from ArchiveExplorer), all remaining fields. Include "View Entity" link that navigates to `/memory/:entityType/:entityId` when entity fields are non-null. Include "View in Archive" link that navigates to `/archive?entityType=X&entityId=Y` for archival events.

6. **Export button** — In the log view header. Opens a small dropdown: "Export as JSONL" and "Export as CSV". Calls `GET /api/control-plane/logs/export?format=jsonl|csv` with the current filter params applied. Triggers browser download.

7. **Empty state** — When no rows match filters: "No Staff events match the current filters." When `staff_events` table is empty or returns 503: "No Staff events recorded yet. Events appear here once the Iranti Staff emitter is active. — Learn more about CP-T025."

8. **URL deep-links** — Filter state must sync to the URL query string so that `/logs?component=Librarian` pre-populates the component filter. This enables the per-component deep-link pattern from the ticket.

**Acceptance criteria to verify before reporting back:**
- All 13 ACs from `cp-t050.md` checked
- TypeScript compiles with zero errors, no `any` in new component tree
- Light mode and dark mode both reviewed visually — Terminals palette, no hardcoded colors
- `/logs?component=Librarian` URL navigates to Logs view with Librarian pre-selected
- Export produces a downloadable file (test with a JSONL export)
- "View Entity" link navigates correctly when entity fields are set
- CI green
- Commit as: `feat(frontend): implement Staff Logs view with filter, pagination, export (CP-T050)`

**Report back to PM with:**
- Which ACs passed
- Screenshots or description of light and dark mode appearance
- Any filter/pagination edge cases found
- Whether the URL deep-link param sync is fully working

---

## Wave 2 (planned — not yet assigned)

### Assignment 3 — CP-T049 (Archivist Transparency) — `backend_developer` + `frontend_developer`

**Status:** Planned — will be assigned after Wave 1 (CP-T050) is PM-accepted
**Ticket:** `docs/tickets/cp-t049.md`
**Priority:** P2
**Phase:** 3, Wave 2

Wave 2 kickoff will be issued by PM after CP-T050 backend and frontend are accepted. Both agents pick up CP-T049 together.

**Backend scope summary (preview):**
- New endpoint: `GET /api/control-plane/archive/:id/archivist-events` — returns `staff_events` filtered to `staff_component = 'Archivist'` and `entity_type/entity_id/key` matching the archive row
- New endpoint: `POST /api/control-plane/archive/:id/flag` — stores a flag with operator note (OQ-1: backend_developer decides `archive_flags` table vs JSONB — document the choice)
- New endpoint: `DELETE /api/control-plane/archive/:id/flag` — clears the flag
- New endpoint: `POST /api/control-plane/archive/:id/restore?confirm=true` — writes archived fact's `valueRaw`/`valueSummary` to `knowledge_base`, archives the currently-active fact as `operator_superseded`, logs `fact_restored_by_operator` to `staff_events`
- `GET /archive` must accept `?flagged=true` filter to support the Flagged Facts queue

**Frontend scope summary (preview):**
- Extend `ArchiveExplorer.tsx` expanded row: add "Archivist History" timeline section and "Flag for Review" button
- Add "Flagged" filter to Archive Explorer filter bar
- Add Flagged Facts review queue (sub-tab or toggle)
- Implement Restore Fact action with confirmation dialog

**PM decision on OQ-2 (resolved):** Restore Fact action is only available from the Flagged review queue in the initial release.
**PM decision on OQ-3 (resolved):** If the fact's entity/key is currently active, the restore supersedes the current active fact with `operator_superseded` — show this explicitly in the confirmation dialog.

---

## Wave 3 (planned — not yet assigned)

### Assignment 4 — CP-T048 (Platform Installer Packages) — `devops_engineer`

**Status:** Planned — will be assigned after Wave 2 (CP-T049) is PM-accepted
**Ticket:** `docs/tickets/cp-t048.md`
**Priority:** P2
**Phase:** 3, Wave 3

Wave 3 kickoff will be issued by PM after CP-T049 is accepted. The `devops_engineer` picks up CP-T048.

**First task when picking up CP-T048 (mandatory spike before pipeline work):**
- Validate Node SEA ESM compatibility (OQ-1 in ticket). The Express server uses `"type": "module"`. Run the proof-of-concept spike described in the Implementation Notes section before committing to Node SEA. If SEA is not viable, evaluate `caxa` or a `pkg` fork and confirm toolchain with PM before proceeding.
- Validate static frontend embedding (whether Vite build output can be embedded in binary or must be placed alongside it).
- Then confirm toolchain choice with PM via Iranti write before building the pipeline.

---

## Carryover from Phase 2 (tracked separately, not Phase 3 tickets)

- **CP-T025 upstream PR submission** — `system_architect` should submit the upstream PR to the Iranti maintainer in Phase 3. This is not a new ticket; it is a carryover action. Track status in Iranti memory under `ticket/cp-t025`.
- **CP-T022 write path** — Provider manager write-path (mutating active provider/model config at runtime) was deferred from Phase 2. Phase 3 will revisit once the upstream Iranti configuration API surface is clear. PM will create a new ticket if/when that surface stabilizes.
