# Phase 3 Agent Assignments

**Issued by:** `product_manager`
**Date:** 2026-03-20
**Phase:** 3 — Advanced Operator Features
**Milestone target:** v0.3.0

---

## Status

Phase 3 kickoff: 2026-03-20
Current wave: Wave 9 dispatched 2026-03-21 (Wave 8 PM acceptance complete)
Ticket sequence: CP-T050 → CP-T049 → CP-T048 → CP-T051 / CP-T052 / CP-T053 → CP-T056 / CP-T057 / CP-T058 → CP-T059 → CP-T060 → CP-T061 / CP-T062 / CP-T063 / CP-T064 → CP-T065

CP-T050 PM-accepted: 2026-03-20 (backend 18 ACs PASS, frontend 13 ACs PASS, TypeScript clean)
CP-T049 PM-accepted: 2026-03-20 (backend ACs 5–8 PASS, frontend ACs 1–6, 8–9 PASS, AC-7 backend responsibility, archive_flags migration included, restore transaction-wrapped with supersession, TypeScript clean both sides)
CP-T048 Wave 3: implementation complete 2026-03-21 — Node SEA, all platform build scripts, CI pipeline, QA test plan written. AC-11 clean-machine validation pending.
CP-T051 PM-ACCEPTED: 2026-03-21 — Backend proxy AC-1–4 correct, frontend AC-5–9 complete (AC-10 stretch not implemented, acceptable)
CP-T052 PM-ACCEPTED: 2026-03-21 — Health endpoint extended with decay/vector/attendant; three new Health Dashboard cards
CP-T053 PM-ACCEPTED: 2026-03-21 — ConflictLog timeline, createdBy/source labels, stability/lastAccessedAt fields
CP-T056 issued: 2026-03-21 Wave 5 — Temporal History asOf query (frontend_developer only)
CP-T057 issued: 2026-03-21 Wave 5 — WhoKnows Contributor Panel (backend_developer + frontend_developer)
CP-T058 issued: 2026-03-21 Wave 5 — UX Guidance Labels M4/M5/H8 (frontend_developer only)
CP-T059 issued: 2026-03-21 Wave 6 — Interactive Diagnostics Panel (backend_developer + frontend_developer) — P2, new CP-E012 epic
CP-T059 PM-ACCEPTED: 2026-03-21 — All 5 frontend ACs pass, tsc clean, AC-9 __diagnostics__ filter confirmed
CP-T060 issued: 2026-03-21 Wave 7 — Metrics Dashboard (backend_developer + frontend_developer) — P2, CP-E013 epic
CP-T060 PM-ACCEPTED: 2026-03-21 — Backend: action_type strings verified correct (lowercase real values), totalFacts cumulative from all-time window, graceful degradation confirmed, tsc clean. Frontend: SVG line + bar charts, 4 summary cards, period toggle with re-fetch, empty state at < 2 data points or truncated, tsc clean. Both halves accepted.
CP-T061 issued: 2026-03-21 Wave 8 — Entity Alias Management UI (backend_developer + frontend_developer) — P2, CP-E014
CP-T061 PM-PARTIAL: 2026-03-21 — Backend ACCEPTED (real Iranti shape); Frontend REJECTED (shape mismatch — built against wrong CP-T006 spike spec). Follow-on CP-T065 issued.
CP-T062 issued: 2026-03-21 Wave 8 — Relationship Graph B9 note (frontend_developer) — P3
CP-T062 PM-ACCEPTED: 2026-03-21 — Semantic note below graph, only when relationships exist, links to /health, uses --color-text-tertiary, tsc clean.
CP-T063 issued: 2026-03-21 Wave 8 — API Key Scope Audit View (backend_developer + frontend_developer) — P2
CP-T063 PM-ACCEPTED: 2026-03-21 — scope/scopeType fields added (gracefully null; Iranti v0.2.15 does not expose scope via API). ScopeBadge in list and detail. tsc clean.
CP-T064 issued: 2026-03-21 Wave 8 — Documentation update for CP-T056/T057/T060 (technical_writer) — P3
CP-T064 PM-ACCEPTED: 2026-03-21 — asOf picker section, Contributors panel section, Metrics Dashboard row all present and accurate to actual implementation (not spec). Two spec gaps noted (rejectionCount/firstSeen fields don't exist; no Query button — reactive instead). Documented actual behavior, which is correct.
CP-T065 issued: 2026-03-21 Wave 9 — Entity Alias Panel Rewrite (frontend_developer) — P2, CP-E014
CP-T065 PM-ACCEPTED: 2026-03-21 — All 6 ACs verified. Types correct (EntityAlias flat token shape, EntityAliasesResponse with canonicalEntity/aliases/total). AliasRow renders alias in <code>, source muted, ConfidenceBar, relative createdAt. CreateAliasForm single-field with canonicalEntity derived from props, correct POST body, clears on success, inline error. Empty state unchanged, count badge from data.total. aliasToken CSS class monospace. tsc --noEmit clean (both server and client, 0 errors). CP-T061 frontend now fully accepted via CP-T065.
CP-T066 issued: 2026-03-21 Wave 9 — KB Full-Text/Semantic Search Surface (backend_developer + frontend_developer) — P2, CP-E014 — PM-ACCEPTED 2026-03-21
CP-T067 issued: 2026-03-21 Wave 9 — Entity Type Browser (backend_developer + frontend_developer) — P3, CP-E014 — PM-ACCEPTED 2026-03-21

Iranti upstream drift check (2026-03-21): v0.2.15 now current (unreleased — "Pending release notes"). v0.2.14 Windows updater fix only. v0.2.13 partially fixes B11 attend classifier; hybrid search fallback improved. v0.2.15 alias API shape confirmed real by backend agent: flat string tokens (not entity cross-references). No breaking API changes beyond alias shape (which was always speculative). No other control plane rework required.

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

**Status:** ACCEPTED — 2026-03-20
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

**Status:** ACCEPTED — 2026-03-20
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

## Wave 2

### Assignment 3 — CP-T049 (Archivist Transparency) — `backend_developer`

**Status:** ACCEPTED — 2026-03-20
**Ticket:** `docs/tickets/cp-t049.md`
**Priority:** P2
**Phase:** 3, Wave 2

**Files to read before starting:**
- `docs/tickets/cp-t049.md` — full ticket with all acceptance criteria and resolved OQs
- `src/server/routes/control-plane/events.ts` — existing `staff_events` query patterns, `buildEventWhereClause`, `serializeEventRow`, table-existence cache; your archivist-events endpoint follows the same pattern filtered to `staff_component = 'Archivist'` + `entity_type/entity_id/key`
- `src/server/routes/control-plane/index.ts` — route registration; you must add `archiveRouter` (or extend existing archive router) for the new endpoints
- `src/server/routes/control-plane/kb.ts` — write path patterns to reuse for the restore endpoint
- `src/server/migrations/` — examine existing migrations for the archive table schema; your flag storage (new `archive_flags` table or JSONB on `archive`) requires a migration

**What to build:**

1. **`GET /api/control-plane/archive/:id/archivist-events`** — Returns all `staff_events` rows where `staff_component = 'Archivist'` and the row's `entity_type`, `entity_id`, `key` match the archive fact identified by `:id`. Look up the archive row to get its `entity_type/entity_id/key`, then query `staff_events`. Return `{ items: StaffEvent[], total: number }`. Graceful degradation: if `staff_events` table does not exist, return `{ items: [], total: 0 }` (not 503 — this is a supplemental view, not a primary endpoint). Empty result is a valid state and is expected until CP-T025 is active.

2. **Flag storage decision (OQ-1):** Choose between a new `archive_flags` table (clean relational, requires migration, safer cascade delete) or a JSONB `metadata` column on the `archive` table (simpler, no new table). PM accepts either — document your choice as a comment at the top of the file and in your report. If using a new table, provide the migration SQL.

3. **`POST /api/control-plane/archive/:id/flag`** — Body: `{ note: string }` (max 500 chars, required). Stores the flag with: archive record ID, operator note, `flaggedAt` timestamp. Returns `201` with the created flag record. If already flagged, upserts (update note + timestamp). Validate that `:id` is a valid archive row.

4. **`DELETE /api/control-plane/archive/:id/flag`** — Removes the flag for the given archive row. Returns `204`. Returns `404` if not flagged.

5. **`POST /api/control-plane/archive/:id/restore?confirm=true`** — Requires `?confirm=true` query param (consistent with CP-T033 pattern). Only available on flagged facts (return `409 RESTORE_NOT_FLAGGED` if not flagged). Steps:
   - Fetch the archive row by `:id`.
   - Check if `knowledge_base` has an active row for the same `entity_type/entity_id/key`.
     - If yes: archive it with `archived_reason = 'operator_superseded'`, then continue.
     - If no: proceed directly.
   - Insert the archived fact's `value_raw`, `value_summary`, `confidence`, `entity_type`, `entity_id`, `key` into `knowledge_base` as a new active row with `created_by = 'control_plane_operator'`, `source = 'operator_restore'`.
   - Log a `staff_events` row: `staff_component = 'Archivist'`, `action_type = 'fact_restored_by_operator'`, `metadata` includes `{ archiveId: id, entityType, entityId, key, flagNote: <operator note>, restoredAt }`.
   - Return `201` with `{ restoredKbId: <new knowledge_base id> }`.
   - Return `400` if `?confirm=true` is absent. Return `404` if archive row not found.

6. **`GET /archive` flagged filter** — Extend the existing archive endpoint to accept `?flagged=true`. When set, join against the flag store and return only flagged facts. Add a `flagged` boolean field (and `flagNote`, `flaggedAt`) to the archive row serializer when present.

**PM decisions already resolved:**
- OQ-2: Restore is only available on flagged facts.
- OQ-3: If the entity/key is active in `knowledge_base`, supersede it with `operator_superseded` and proceed. The frontend will display this in the confirmation dialog.

**Acceptance criteria to verify:**
- ACs 1, 2, 5, 6, 7, 8 from `cp-t049.md` are backend-owned; verify all
- TypeScript compiles with zero errors, no `any` in new code
- `vitest run` passes (no regressions)
- Manually test: fetch archivist-events for a known archive row (empty state OK), POST /flag with a note, GET /archive?flagged=true, DELETE /flag, POST /restore?confirm=true (with and without existing active KB row), POST /restore without `?confirm=true` (must return 400)
- Commit as: `feat(backend): implement Archivist transparency endpoints — flag, restore, archivist-events (CP-T049)`

**Report back to PM with:**
- OQ-1 decision (flag storage mechanism chosen) and rationale
- Which ACs passed; any that required assumptions
- Whether the restore correctly handles the active KB row supersession case
- Migration SQL provided or JSONB approach confirmed
- CI status

---

### Assignment 4 — CP-T049 (Archivist Transparency) — `frontend_developer`

**Status:** ACCEPTED — 2026-03-20
**Ticket:** `docs/tickets/cp-t049.md`
**Priority:** P2
**Phase:** 3, Wave 2

**Dependency:** Backend Assignment 3 endpoints must be merged before the Flagged Facts queue and Restore action can be fully tested. The Archivist History section (GET archivist-events) and Flag for Review button (POST flag) can be developed in parallel using the known endpoint contracts. Coordinate with `backend_developer` on timing.

**Files to read before starting:**
- `docs/tickets/cp-t049.md` — full ticket with all acceptance criteria and PM decisions on OQ-2 and OQ-3
- `src/client/src/components/memory/ArchiveExplorer.tsx` — the existing component you are extending. Read thoroughly: `ExpandedArchiveRow`, `ArchiveFilterState`, `filterReducer`, the query param construction, and the table row rendering. Every new UI element slots into this existing structure.
- `src/client/src/components/stream/ActivityStream.tsx` — timeline/event display patterns to reuse for the Archivist History section
- `docs/specs/visual-tokens.md` — Terminals palette; all new components must use CSS tokens, no hardcoded colors
- `src/client/src/api/types.ts` — existing `ArchiveFact` type; you must extend it to include optional `flagged`, `flagNote`, `flaggedAt` fields returned by the updated `GET /archive?flagged=true`

**What to build:**

1. **Archivist History section in `ExpandedArchiveRow`** — After the existing expanded grid fields, add an "Archivist History" section. On mount (when the row is expanded), call `GET /api/control-plane/archive/:id/archivist-events`. Render as a compact timeline (most recent first): each event shows timestamp, `actionType`, and `metadata.summary ?? reason ?? actionType` as a one-line description. Empty state: "No Archivist events recorded for this fact. Events require CP-T025 native emitter injection." Do not show a spinner for longer than 2s — fall back to empty state on error. Use a `useQuery` key scoped to `['archivist-events', fact.id]`.

2. **"Flag for Review" button in `ExpandedArchiveRow`** — Below the Archivist History section. If the fact is already flagged (`fact.flagged === true`), show "Flagged for Review" as a read-only indicator with the flag note and a "Clear Flag" button. If not flagged, show a "Flag for Review" button. Clicking it reveals an inline text input (max 500 chars) and a "Confirm Flag" button. On confirm, call `POST /api/control-plane/archive/:id/flag` with `{ note }`. On success, invalidate the `['archive', ...]` query to refresh the row. On error, show inline error message. Flagged rows must show a visible "Flagged" indicator (small badge or icon) in the main table row — add this to the `<tr>` rendering block.

3. **"Flagged" filter in Archive Explorer filter bar** — Add a "Flagged only" toggle/checkbox to the filter bar (second filter row, after the resolution state select). When active, appends `flagged=true` to the `GET /archive` query params. Update `ArchiveFilterState` and `filterReducer` to include `flaggedOnly: boolean`. Update the query param construction block accordingly.

4. **Flagged Facts review queue** — Add a sub-tab toggle above the table (or a tab row in the filter bar area): "All Facts" | "Flagged for Review". When "Flagged for Review" is active, it functions as a persistent `flaggedOnly=true` filter. The view shows the same table but adds a visible "Restore" action column. This can be implemented as a `viewMode: 'all' | 'flagged'` state variable rather than a separate route — no new route is required.

5. **Restore Fact confirmation dialog** — In the Flagged Facts view, each row shows a "Restore" button. Clicking it opens a confirmation dialog (modal overlay or inline alert) that states: "This is an operator override. The Archivist may re-archive this fact on its next processing cycle if the same conditions apply." If the fact's entity/key is currently active in `knowledge_base`, the dialog must additionally say: "A currently-active fact for this entity/key exists and will be superseded with reason operator_superseded." On confirm, call `POST /api/control-plane/archive/:id/restore?confirm=true`. On success, show inline success feedback ("Fact restored. KB ID: [id]") and invalidate the archive query. On error (409, 404, 400), show the error message inline without closing the dialog. "Cancel" closes without action.

6. **Type additions** — Extend `ArchiveFact` in `src/client/src/api/types.ts` to include `flagged?: boolean`, `flagNote?: string | null`, `flaggedAt?: string | null`. Add `ArchivistEvent` type (reuse or alias `StaffEvent`). Add `FlagResponse` and `RestoreResponse` types. No `any`.

**Acceptance criteria to verify:**
- ACs 1, 2, 3, 4, 5, 6, 8, 9 from `cp-t049.md` are frontend-owned; verify all
- TypeScript compiles with zero errors, no `any` in new component tree
- Light mode and dark mode both visually verified for all new elements
- Archivist History section renders with empty state when no events exist
- Flag for Review flow: button → input → confirm → row shows "Flagged" indicator
- Flagged filter in filter bar correctly filters to flagged-only rows
- Flagged Facts queue shows restore button; confirmation dialog shows warning text verbatim
- Restore success path shows KB ID feedback inline
- Commit as: `feat(frontend): implement Archivist transparency UI — history, flagging, restore (CP-T049)`

**Report back to PM with:**
- Which ACs passed
- Description (or screenshot notes) of light and dark mode appearance for the Archivist History timeline, flag indicator, and restore confirmation dialog
- Whether the confirmation dialog warning text is exactly as specified
- Any edge cases found in the flag/unflag/restore cycle
- CI status

---

## Wave 3

Wave 3 kicked off: 2026-03-20 (CP-T049 PM-accepted same date).

### Assignment 5 — CP-T048 (Platform Installer Packages) — `devops_engineer`

**Status:** Assigned — 2026-03-20
**Ticket:** `docs/tickets/cp-t048.md`
**Priority:** P1 (gating — pipeline work cannot start without spike result)
**Phase:** 3, Wave 3

**SPIKE-FIRST REQUIREMENT — pipeline work is blocked until the spike is complete and PM has confirmed the toolchain.**

The Express server uses `"type": "module"` (ESM TypeScript output). Node.js Single Executable Applications (Node 20+ SEA) have known friction with ESM entry points. Before writing a single line of GitHub Actions workflow or installer configuration, the devops_engineer must run the ESM + Node SEA compatibility spike documented in OQ-1 and the Implementation Notes section of `docs/tickets/cp-t048.md`.

**Phase 1 — Spike (do this first, nothing else):**

1. **Node SEA ESM compatibility** — Create a minimal reproduction: compile the Express server entry point (`src/server/`) with `tsc` targeting CommonJS (or use `esbuild`/`rollup` to produce a CJS bundle), then attempt to wrap it with the Node 20 SEA toolchain (`node --experimental-sea-config sea-config.json`). Document: does SEA accept an ESM entry point directly? Does it require a CJS input? Does `--input-type=module` work? What happens with dynamic `import()` of TypeScript paths? What happens with the Prisma client (which has its own native module dependencies)?

2. **Static frontend embedding** — Determine how the Vite build output (`src/client/dist/`) is served from the standalone binary. Two options from the ticket: (a) embed assets into the binary via SEA's `"assets"` config field (cleaner for single-file distribution), or (b) place assets alongside the binary in a known relative path (simpler, always works, but two-artifact distribution). Validate that option (a) is feasible given the asset size and any SEA asset-embedding limitations.

3. **Toolchain comparison** — Based on spike results, assess all three candidate toolchains: Node SEA (built-in, Node 20+), `caxa` (simpler, no native SEA — wraps Node binary in a self-extracting archive), `electron-builder` with `--prepackaged` (evolving SEA support). Document tradeoffs against the ticket's AC-8 (no Node prerequisite), AC-10 (< 80MB), and the universal binary requirement for macOS (arm64 + x86_64 via `lipo`).

4. **Write spike findings to Iranti** — Write results to `ticket/cp_t048` key `esm_sea_spike_result`. Include: toolchain recommendation, whether SEA works with ESM entry, asset embedding decision, and any blockers found. PM will review before pipeline work starts.

5. **Confirm toolchain with PM** — After writing spike findings, flag for PM review. PM will validate and confirm or redirect before full implementation begins.

**Phase 2 — Full implementation (after PM confirms toolchain):**

Once the spike is confirmed, implement the full ticket per `docs/tickets/cp-t048.md`:

- Build pipeline (GitHub Actions matrix: `windows-latest`, `macos-latest`, `ubuntu-latest`)
- Windows NSIS `.exe` installer (AC-1, AC-2, AC-12)
- macOS `.dmg` with ad-hoc signed universal binary (AC-3, AC-6)
- Linux `.AppImage` and `.deb` (AC-4, AC-5)
- Version display integration (AC-7)
- Artifact size validation (AC-10 — < 80MB binary)
- Port conflict detection and auto-increment (AC-12)
- CI pipeline producing all artifacts on tagged release (AC-9)
- Document SmartScreen and Gatekeeper bypass instructions in release notes and Getting Started screen (per OQ-2)

**Files to read before starting:**
- `docs/tickets/cp-t048.md` — full ticket, all 12 ACs, all resolved OQs, Implementation Notes section
- `src/server/package.json` — confirm `"type": "module"` and entry point
- `src/client/vite.config.ts` — confirm build output path and whether dynamic import paths are filesystem-layout-relative
- `.github/workflows/` (if any exist) — existing CI patterns to follow

**Acceptance criteria to verify before reporting back:**
- All 12 ACs from `cp-t048.md` verified (AC-11 QA sign-off requires QA agent on clean machine/VM — coordinate with `qa_engineer`)
- TypeScript still compiles after any build script changes
- CI pipeline green on a tagged release commit
- Each platform artifact manually validated (coordinate with `qa_engineer` for clean-machine testing)

**Report back to PM with:**
- Spike findings and toolchain decision (in Phase 1 report)
- Which ACs passed in full implementation (in Phase 2 report)
- Artifact sizes for each platform
- SmartScreen / Gatekeeper bypass documentation location confirmed
- Any risks or follow-on items (signing roadmap, Homebrew Cask, auto-update)

### Assignment 6 — CP-T048 (Platform Installer Pipeline — Full Implementation) — `devops_engineer`

**Status:** Assigned — 2026-03-20
**Ticket:** `docs/tickets/cp-t048.md`
**Priority:** P2
**Phase:** 3, Wave 3
**Depends on:** Assignment 5 spike phase complete (ESM + Node SEA compatibility confirmed by PM). All four spike blockers resolved — see PM Implementation Decisions section in `docs/tickets/cp-t048.md` and Iranti `ticket/cp_t048` key `pm_implementation_decisions`.

This assignment covers the full Phase 2 implementation of CP-T048: build scripts, GitHub Actions pipeline, and all platform installer artifacts. The spike phase (Assignment 5) established that Node SEA with an esbuild CJS pre-bundle is the confirmed toolchain. The devops_engineer is unblocked to build the full pipeline.

**Files to read before starting:**
- `docs/tickets/cp-t048.md` — full ticket including all 12 ACs, all resolved OQs, Implementation Notes, and the new PM Implementation Decisions section (2026-03-20) which contains the four binding decisions
- `src/server/index.ts` — contains the `__dirname`-based static asset path on line 31 that must be updated to use `process.isSea?.()` detection (see Decision 2 in the PM Implementation Decisions section for the exact code change)
- `src/server/package.json` — confirms `"type": "module"` (ESM) and the server entry point; the esbuild CJS pre-bundle step converts this to CJS before feeding to Node SEA
- `src/client/vite.config.ts` — confirms Vite build output path (`public/control-plane/`); the sidecar static assets directory must match this path in the installer layout
- `.github/workflows/` — any existing CI patterns to follow for matrix job structure, secret handling, and artifact upload conventions
- Iranti memory `ticket/cp_t048` key `pm_implementation_decisions` — all four PM decisions documented with full rationale; read this before writing a single line of pipeline code

**What to build:**

1. **esbuild CJS pre-bundle step** — Before invoking the Node SEA toolchain, run `esbuild src/server/index.ts --bundle --platform=node --format=cjs --outfile=dist/server/bundle.cjs`. This resolves the ESM/SEA compatibility issue from the spike: the SEA `main` field points to `bundle.cjs`, not the raw TypeScript or ESM output. Include all server dependencies in the bundle (except Prisma client native modules — mark `@prisma/client` as external and handle separately, or verify Prisma bundling works in the spike environment). Place the esbuild step in `scripts/package/bundle.sh` (or `.js`).

2. **`scripts/package/` directory** — Create a `scripts/package/` directory with per-platform build scripts:
   - `bundle.sh` — esbuild CJS pre-bundle (shared by all platforms)
   - `build-windows.sh` — Node SEA binary build (Windows `x64`) + NSIS installer invocation
   - `build-macos-arm64.sh` — Node SEA binary build for `arm64`
   - `build-macos-x86_64.sh` — Node SEA binary build for `x86_64`
   - `build-macos-universal.sh` — `lipo` merge + `.app` bundle + `create-dmg` invocation
   - `build-linux.sh` — Node SEA binary build + AppImage tooling + `fpm` for `.deb`
   - Scripts may be `.js` / `.ts` if that is more natural given the repo conventions

3. **`src/server/index.ts` path fix** — Apply the `process.isSea?.()` static asset path fix documented in PM Decision 2. This is a required code change — the installer will produce a broken control plane if this change is not applied before packaging.

4. **GitHub Actions workflow: `.github/workflows/release.yml`** — Matrix CI pipeline triggered on `push: tags: ['v*']`. Jobs:
   - `build-windows` on `windows-latest`: esbuild bundle → Node SEA binary → NSIS `.exe`. Upload artifact.
   - `build-macos-arm64` on `macos-14`: esbuild bundle → Node SEA binary (arm64). Upload artifact.
   - `build-macos-x86_64` on `macos-13`: esbuild bundle → Node SEA binary (x86_64). Upload artifact.
   - `package-macos-universal` on `macos-14`: download both macOS artifacts → `lipo` merge → `.app` bundle → `create-dmg` → `.dmg`. Upload artifact.
   - `build-linux` on `ubuntu-latest`: esbuild bundle → Node SEA binary → AppImage → `.deb`. Upload artifact.
   - `create-release` (final job, depends on all platform jobs): download all artifacts → create GitHub Release with all artifacts attached.
   - All jobs: `actions/setup-node@v4` with `node-version: '22'` (pinned per PM Decision 3).

5. **Windows NSIS installer** — NSIS `.exe` installer that: installs binary to `%ProgramFiles%\Iranti Control Plane\`, places `public\control-plane\` sidecar directory alongside the binary, creates Start menu entry, registers Add/Remove Programs uninstaller, offers optional "Start with Windows" checkbox. Template the NSIS script in `scripts/package/installer.nsi`.

6. **macOS `.dmg`** — Drag-to-Applications disk image containing `Iranti Control Plane.app`. The `.app` bundle must contain: `Contents/MacOS/iranti-control-plane` (the universal SEA binary) and `Contents/Resources/public/control-plane/` (the sidecar assets — the server resolves them via `process.isSea()` relative to `process.execPath`). Ad-hoc sign the `.app` with `codesign --sign - --force --deep`. Use `create-dmg` or `appdmg` for the final `.dmg`.

7. **Linux `.AppImage` and `.deb`** — AppImage via `appimagetool`: bundle binary + assets into the AppImage directory structure, `chmod +x`, run `appimagetool`. For `.deb`: use `fpm` to produce a `.deb` that installs binary to `/usr/local/bin/iranti-control-plane` and assets to `/usr/share/iranti-control-plane/public/control-plane/`. Include a `.desktop` file for application menu integration.

8. **Port conflict detection** — Implement port auto-increment (3000–3010) in the server startup path before packaging. This is AC-12 — the packaged binary must not silently fail if port 3000 is in use.

9. **Version display** — Ensure the packaged binary reads and exposes the version from `package.json` so it matches the installer version in the About/Health view (AC-7).

**Acceptance criteria to verify before reporting back:**
- AC-1 through AC-12 from `docs/tickets/cp-t048.md` — all 12
- AC-10 specifically: each compressed installer artifact is < 80 MB; measure and document uncompressed binary size in your report
- TypeScript compiles clean after the `index.ts` path fix (`tsc --noEmit` with zero errors)
- CI pipeline green on a tagged release commit (create a `v0.3.0-test` tag in a branch to validate before tagging `v0.3.0`)
- AC-11 QA sign-off: coordinate with `qa_engineer` for clean-machine validation on each platform. Pass QA the installer artifacts and ask them to validate on a VM with no Node.js pre-installed.
- esbuild bundle step works and Prisma client (if used) is handled — document the Prisma decision in your report

**Commit structure (suggested):**
- `feat(devops): add esbuild CJS pre-bundle step for Node SEA compatibility (CP-T048)`
- `fix(server): resolve static asset path using process.isSea() for packaged binary (CP-T048)`
- `feat(devops): add Windows NSIS installer build script and workflow job (CP-T048)`
- `feat(devops): add macOS universal binary build with lipo and DMG packaging (CP-T048)`
- `feat(devops): add Linux AppImage and deb packaging (CP-T048)`
- `feat(devops): add GitHub Actions release pipeline for all platform installers (CP-T048)`

**Report back to PM with:**
- Toolchain confirmation (Node SEA + esbuild confirmed, or any deviation and rationale)
- Artifact sizes: compressed download size for each platform (must be < 80 MB per AC-10), uncompressed binary size (documented)
- Prisma client decision (bundled or external; document approach)
- Which ACs passed; any that required assumptions or deferred to QA
- CI pipeline URL (GitHub Actions run on a test tag)
- SmartScreen / Gatekeeper bypass instructions — confirm location in release notes and Getting Started screen
- Any risks or follow-on items (auto-update, Homebrew Cask, Windows `.msi`)

### Assignment 7 — CP-T048 AC-6 (Browser Auto-Open Fix) — `devops_engineer`

**Status:** Assigned — 2026-03-20
**Ticket:** `docs/tickets/cp-t048.md` — AC-6
**Priority:** P2
**Phase:** 3, Wave 3 (follow-on to Assignment 6)
**Depends on:** Assignment 6 merged

**PM Decision (Iranti `ticket/cp_t048` key `ac6_decision`):**
AC-6 browser auto-open is implemented via the `open` npm package. Add `open` to `src/server/package.json` dependencies (not devDependencies — it must be available in the bundle). In `src/server/index.ts`, after the server begins listening on its resolved port, add a call to `open('http://localhost:PORT')` guarded by `process.isSea?.() === true`. This means the browser opens automatically only when running as a packaged SEA binary, not in dev mode (`npm run dev`). This is cross-platform (Windows, macOS, Linux), three lines of code, and requires no OS-specific logic.

**What to implement:**

1. **Add `open` to server dependencies:**
   ```
   npm install open --save
   ```
   in `src/server/`. Confirm `open` v9+ (ESM-first) is compatible with the esbuild CJS bundling step — if there are ESM/CJS compatibility issues with `open` v9+, use `open` v8 (CJS-compatible) instead. Document the version choice in the commit message.

2. **Update `src/server/index.ts`:**
   After the `server.listen(PORT, ...)` callback fires (i.e., once the server is confirmed listening), add:
   ```ts
   if (process.isSea?.()) {
     const { default: open } = await import('open')
     open(`http://localhost:${PORT}`)
   }
   ```
   If dynamic import is problematic with the esbuild CJS bundle, use a top-level `import open from 'open'` and guard the call with the `process.isSea?.()` check. Do not open the browser in dev mode — the guard is required.

3. **Verify the esbuild bundle step handles `open`:**
   Run `scripts/package/bundle.sh` (or the equivalent bundling script) after adding `open` and confirm the bundle produces no errors. `open` is a pure-JS package with no native binaries, so it should bundle cleanly.

4. **Test manually:**
   - Run `npm run dev` — confirm the browser does NOT auto-open (guard is working).
   - Build the SEA binary locally on one platform — confirm the browser DOES open automatically after the binary starts.
   - If a full SEA build is not practical locally, add a temporary `FORCE_OPEN=true` environment variable override for testing and remove it before committing.

**Acceptance criteria to verify:**
- AC-6 from `docs/tickets/cp-t048.md`: "Launching the packaged binary opens the default browser to the control plane URL automatically."
- Dev mode (`npm run dev`) does not trigger browser auto-open.
- TypeScript compiles clean (`tsc --noEmit` zero errors).
- esbuild bundle step completes without errors after adding `open`.

**Commit as:** `feat(server): implement AC-6 browser auto-open via open package for packaged binary (CP-T048)`

**Report back to PM with:**
- `open` version chosen (v8 CJS or v9 ESM) and rationale
- Confirmation that dev mode does not trigger auto-open
- Confirmation that bundle step is clean
- Whether a full end-to-end test was performed on a SEA binary or if a proxy test was used

---

### Assignment 8 — CP-T048 AC-11 (Clean-Machine QA Validation) — `qa_engineer`

**Status:** Assigned — 2026-03-20
**Ticket:** `docs/tickets/cp-t048.md` — AC-11
**Priority:** P2
**Phase:** 3, Wave 3 (parallel with or following Assignment 7)
**Depends on:** Assignment 6 artifacts available (all platform installers built by CI on a test tag)

**What to validate:**

AC-11 requires validation on a clean machine — a VM or fresh OS image with no Node.js, no npm, no existing Iranti Control Plane installation, and no pre-existing `node_modules`. The purpose is to confirm that the packaged binary is genuinely self-contained and that a non-developer user can install and run the control plane without any development environment prerequisites.

**Platforms to test (one clean VM per platform):**

1. **Windows** — Windows 10 or Windows 11, fresh user account, no Node.js installed. Run the NSIS `.exe` installer. Validate:
   - Installer completes without errors.
   - Start menu entry is created.
   - Launching from Start menu starts the server on an available port (3000–3010).
   - Browser opens automatically to the control plane UI (AC-6).
   - UI loads and the health/status view is reachable.
   - SmartScreen warning appears (expected for unsigned binary) — document the bypass steps and confirm they match the release note instructions.
   - Uninstaller works cleanly (Add/Remove Programs entry present and removes the install).

2. **macOS** — macOS 13 (Ventura) or macOS 14 (Sonoma), no Node.js installed. Mount the `.dmg`, drag to Applications, launch from Applications. Validate:
   - Gatekeeper warning appears on first launch (expected for ad-hoc signed binary) — document the bypass steps ("Right-click → Open") and confirm they match the release note instructions.
   - App launches without crashing.
   - Browser opens automatically to the control plane UI.
   - UI loads and the health/status view is reachable.
   - App can be quit and relaunched without issues.

3. **Linux (Ubuntu)** — Ubuntu 22.04 LTS, no Node.js installed. Test both the `.deb` and `.AppImage`. Validate:
   - `.deb`: `sudo dpkg -i iranti-control-plane.deb` installs without errors. Binary is at `/usr/local/bin/iranti-control-plane`. Running it starts the server. Browser opens (if a desktop environment is present) or the URL is printed to stdout for manual navigation.
   - `.AppImage`: `chmod +x` + direct execution works without any additional dependencies. Same startup and UI validation as above.
   - Uninstall: `sudo dpkg -r iranti-control-plane` removes cleanly.

**Port conflict test (AC-12):** On at least one platform (Windows preferred for ease), start a process occupying port 3000 before launching the installer binary. Confirm the binary auto-increments to the next available port in the 3000–3010 range and logs the resolved port clearly.

**Version display test (AC-7):** Confirm the version string displayed in the control plane health/status view or About screen matches the installer version.

**Acceptance criteria to check:**
- AC-11 from `docs/tickets/cp-t048.md`: installer works on a clean machine with no Node.js prerequisite.
- AC-12: port conflict detection and auto-increment confirmed.
- AC-7: version display matches installer version.
- AC-6: browser auto-opens on all three platforms (or URL is printed on headless Linux).

**Report back to PM with:**
- Per-platform pass/fail table: Windows, macOS, Linux .deb, Linux .AppImage
- SmartScreen bypass steps tested and documented (confirm match with release notes)
- Gatekeeper bypass steps tested and documented (confirm match with release notes)
- Port conflict test result
- Version display confirmed
- Any failures with reproduction steps and the exact error output
- VM environment details (OS version, clean-machine confirmation)

---

## Carryover from Phase 2 (tracked separately, not Phase 3 tickets)

- **CP-T025 upstream PR submission** — `system_architect` should submit the upstream PR to the Iranti maintainer in Phase 3. This is not a new ticket; it is a carryover action. Track status in Iranti memory under `ticket/cp-t025`.
- **CP-T022 write path** — Provider manager write-path (mutating active provider/model config at runtime) was deferred from Phase 2. Phase 3 will revisit once the upstream Iranti configuration API surface is clear. PM will create a new ticket if/when that surface stabilizes.

---

## Wave 4 — Issued 2026-03-21 (Cross-Repo Audit Findings)

**Source:** `docs/coordination/cross-repo-audit-2026-03-21.md`
**Audit findings addressed:** H1, H2, H3, H4, H5, M7, C1/C2 (informational surface)

---

### Assignment — CP-T051 (Agent Registry View) — `backend_developer` + `frontend_developer`

**Status:** OPEN — issued 2026-03-21
**Ticket:** `docs/tickets/cp-t051.md`
**Priority:** P2
**Phase:** 3, Wave 4

**Why now:** Iranti's `GET /agents` API (with per-agent write/rejection/escalation stats) has existed since at least v0.2.9. The control plane has never surfaced it. Operators have no way to see which agents are registered, what their error rates are, or whether any agents are going dark. The API is ready; this is purely a missing UI surface.

**backend_developer scope:**
- `GET /api/control-plane/agents` — proxy to `GET /agents` on the connected Iranti instance
- `GET /api/control-plane/agents/:agentId` — proxy to `GET /agents/:agentId`
- 503 graceful degradation if upstream is unreachable or returns 401
- Forward `X-Iranti-Key` with `agents:read` scope (see `providers.ts` for the forwarding pattern)
- Pattern reference: `src/server/routes/control-plane/providers.ts`

**frontend_developer scope:**
- Add "Agents" nav item to sidebar (position: after Providers, before Getting Started)
- `/agents` route — paginated table: agentId, display name, lastSeen (relative), active indicator, writes, rejections (red if high), escalations (amber if any), avg confidence
- Agent detail drawer/page: full stats, capabilities, model, properties (JSON), description
- Empty state: "No agents registered yet. Agents appear here after their first `iranti_handshake` call."
- 503 empty state: match Staff Logs 503 state pattern
- Stretch: sidebar badge if any agent is inactive with high escalations

---

### Assignment — CP-T052 (Health: Decay Config + Vector Backend + Attend Status) — `backend_developer` + `frontend_developer`

**Status:** OPEN — issued 2026-03-21
**Ticket:** `docs/tickets/cp-t052.md`
**Priority:** P2
**Phase:** 3, Wave 4

**Why now:** Three operator-critical signals are missing from the Health dashboard: (1) decay configuration (`IRANTI_DECAY_ENABLED` etc.) is invisible — operators don't know if decay is active or why facts are being archived; (2) vector backend (`IRANTI_VECTOR_BACKEND`) is not surfaced — this is the first diagnostic signal for B4-style search failures; (3) Attendant classifier failures (B11 benchmark) are invisible and need at minimum an informational note.

**backend_developer scope:**
- Extend `GET /api/control-plane/health` to include `decay` object: `{ enabled, stabilityBase, stabilityIncrement, stabilityMax, decayThreshold }` — read from `IRANTI_DECAY_*` env vars
- Extend health endpoint to include `vectorBackend` object: `{ type, configured, url }` — read from `IRANTI_VECTOR_BACKEND`, `IRANTI_QDRANT_URL`, `IRANTI_CHROMA_URL`
- For qdrant/chroma: lightweight HTTP probe to configured URL; report status as `ok`, `warn`, `error`
- Add `attendant` informational object to health endpoint — static message about CP-T025 limitation
- Reference: `src/server/routes/control-plane/health.ts`

**frontend_developer scope:**
- "Memory Decay" card in Health Dashboard: enabled status (green=disabled, amber=enabled), decay threshold, stability range
- "Vector Backend" card: type, status indicator, URL for qdrant/chroma, "Uses primary database connection" for pgvector
- "Attendant" informational card: status=Informational, surfaces the entityHints workaround and CP-T025 context
- All new cards must use the four-tier severity taxonomy from CP-T028 (Critical/Warning/Informational/Healthy)
- Reference: `src/client/src/components/health/HealthDashboard.tsx`

---

### Assignment — CP-T053 (Memory Explorer: ConflictLog Timeline + Field Labels) — `frontend_developer`

**Status:** OPEN — issued 2026-03-21
**Ticket:** `docs/tickets/cp-t053.md`
**Priority:** P2
**Phase:** 3, Wave 4

**Why now:** The `conflictLog` field on every KB fact is an append-only array of conflict events — type, timestamp, reason, LLM usage, scores. This data is already returned by the API. Currently it's shown as raw JSON (if at all). The cross-repo audit confirmed the field structure. This is a pure frontend improvement with no backend work required.

**frontend_developer scope:**
- `MemoryExplorer.tsx` — expanded fact row: render "Conflict History" section if `conflictLog` has entries
  - Each entry: relative timestamp (absolute on hover), event type badge (CONFLICT_ESCALATED=amber, CONFLICT_REJECTED=red, CONFLICT_RESOLVED=green, IDEMPOTENT_SKIP=grey), reason text, "Used LLM: Yes/No"
  - If `existingScore` + `incomingScore` present: "Existing: N vs. Incoming: N"
  - If `incomingSource` present: show it
- `ArchiveExplorer.tsx` — same ConflictLog rendering in expanded archive row
- Rename "Agent" label to "Written by" (maps to `createdBy`) across both expanded and collapsed row
- Keep "Source" for `source` field; add tooltip: "Caller-supplied provenance label (e.g. 'mcp', 'git', 'manual')"
- Add `stability` (N days) and `lastAccessedAt` (relative time) to expanded fact detail — omit if null
- Remove raw JSON `conflictLog` expand once timeline renders; keep `properties` and `metadata` raw expand unchanged
- The server serializes `conflictLog` as `Record<string, unknown> | null` — cast to `ConflictEntry[]` in the frontend

---

## Wave 5 — Issued 2026-03-21 (Post-Wave-4 acceptance)

**Wave 4 status at handoff:** CP-T051, CP-T052, CP-T053 all PM-ACCEPTED 2026-03-21. 196 unit tests passing. TypeScript clean.

**Upstream drift note (v0.2.12 → v0.2.14):**
- v0.2.13: `attend()` classifier partially fixed (less aggressive `memory_not_needed` default); hybrid search now falls back to in-process semantic scoring when pgvector unavailable; `entityHints` defaulted from `IRANTI_MEMORY_ENTITY` env var. No breaking API changes for the control plane.
- v0.2.14: Windows self-updater race fix only. Zero control plane impact.

**Wave 5 scope rationale:** With Wave 4 complete, the control plane now surfaces agent registry, health extensions (decay/vector/attendant), and conflict history. Wave 5 completes the remaining operator insight gaps: temporal point-in-time query (CP-T056), entity contributor visibility (CP-T057), and three UX guidance labels (CP-T058). All three are low-risk. CP-T056 and CP-T058 are pure frontend. CP-T057 is a small backend proxy + frontend display.

---

### Assignment — CP-T056 (Temporal History asOf Query) — `frontend_developer`

**Status:** OPEN — issued 2026-03-21 (Wave 5)
**Ticket:** `docs/tickets/cp-t056.md`
**Priority:** P3
**Phase:** 3, Wave 5
**Scope:** Pure frontend. No backend changes required.

**Why now:** CP-T036 (Temporal History view) is complete and showing full interval timelines. The Iranti API already supports `?asOf=ISO` on `GET /kb/query/:entityType/:entityId/:key` — this parameter passes through the control plane's existing proxy without any backend change. Surfacing it gives operators the ability to answer "what did Iranti believe about this fact on date X?" — a common debugging question.

**What to build:** Read `docs/tickets/cp-t056.md` fully before starting — all 4 ACs are specified there. Summary:
1. Add a "Point in Time" date+time picker in the Temporal History view header
2. When a date/time is selected: call `GET /kb/query/:entityType/:entityId/:key?asOf=<ISO>&includeExpired=true`
3. Highlight the matching interval (elevated border/background); show fact value callout with `valueRaw`, `confidence`, `source`, `createdBy`, `validFrom/validUntil`
4. If no fact at that time: "No fact existed at this time"
5. Clearing the picker returns to normal full-history view with no highlight
6. All new UI uses Terminals palette tokens — no hardcoded colors

**Files to read before starting:**
- `docs/tickets/cp-t056.md` — full ticket with all ACs
- `src/client/src/components/memory/MemoryExplorer.tsx` — Temporal History section (or dedicated TemporalHistory.tsx if it was extracted)
- `docs/specs/visual-tokens.md` — Terminals palette; highlight style must use emerald accent

**Acceptance criteria to verify:**
- All 4 ACs from `cp-t056.md` checked explicitly
- Date picker appears in Temporal History view header
- Selecting a date triggers the asOf query and highlights the correct interval
- Clearing the date returns to normal view
- "No fact existed at this time" shown when query returns empty
- TypeScript compiles clean (`tsc --noEmit` zero errors), no `any` in new code
- Light mode and dark mode both visually reviewed
- `vitest run` passes (no regressions)

**Commit as:** `feat(frontend): add asOf point-in-time picker to Temporal History view (CP-T056)`

**Report back to PM with:**
- Which ACs passed
- Description of the highlight style chosen (border, background color, etc.)
- Whether `asOf` query params are forwarded correctly through the existing proxy (confirm with a real Iranti instance if available, or document that the proxy pass-through is confirmed in `kb.ts`)
- CI status

---

### Assignment — CP-T057 (Entity Detail: WhoKnows Contributor Panel) — `backend_developer` + `frontend_developer`

**Status:** OPEN — issued 2026-03-21 (Wave 5)
**Ticket:** `docs/tickets/cp-t057.md`
**Priority:** P3
**Phase:** 3, Wave 5

**Why now:** Entity Detail shows what Iranti believes but not who contributed it. `GET /memory/whoknows/:entityType/:entityId` exists and has existed since the initial Iranti API. Adding a Contributors panel closes a visible gap — "which agents shaped this entity?" — that operators hit when debugging conflicted or unexpected facts.

**backend_developer scope:**

Add `GET /api/control-plane/kb/whoknows/:entityType/:entityId` in `src/server/routes/control-plane/kb.ts` (or a new `whoknows.ts` in the same directory):

1. Forward the request to `GET /memory/whoknows/:entityType/:entityId` on the Iranti instance
2. Forward `X-Iranti-Key` with `memory:read` scope (same pattern as all other proxied endpoints — see `providers.ts`)
3. Normalize response to `{ contributors: [{ agentId, writeCount, lastContributedAt }], total: N }`
4. If Iranti returns 401, 404, or is unreachable: return HTTP 503 with `{ error: "...", code: "WHOKNOWS_UNAVAILABLE" }`
5. Empty contributors list is a valid response — return `{ contributors: [], total: 0 }` with HTTP 200

**Important:** Note that this proxies to `/memory/whoknows/...` on Iranti (the `/memory/` route group), not `/kb/`. Check that the control plane's Iranti proxy routing in `index.ts` covers the `/memory/` path, or add a new forwarding entry if needed.

**Files to read before starting:**
- `docs/tickets/cp-t057.md` — full ticket with all ACs
- `src/server/routes/control-plane/providers.ts` — proxy pattern to follow exactly
- `src/server/routes/control-plane/index.ts` — route registration; register the new endpoint here
- `src/server/routes/control-plane/kb.ts` — existing kb route file; the whoknows endpoint can live here or in a new file

**Acceptance criteria (backend):**
- AC-1: `GET /api/control-plane/kb/whoknows/:entityType/:entityId` returns `{ contributors, total }`
- AC-2: Endpoint registered in `index.ts`
- AC-3: TypeScript clean, no `any`
- Graceful degradation: 503 with `WHOKNOWS_UNAVAILABLE` on upstream failure
- Empty list: HTTP 200 with `{ contributors: [], total: 0 }`

**frontend_developer scope:**

In the Entity Detail view (`/memory/:entityType/:entityId`), add a "Contributors" panel below the entity facts section:
1. On mount, call `GET /api/control-plane/kb/whoknows/:entityType/:entityId`
2. Render as a compact list (sorted by `writeCount` descending):
   - Agent ID (bold, monospace or using the existing badge pattern)
   - Write count (integer)
   - Last contributed (relative time, absolute on hover — same pattern as ActivityStream timestamps)
3. If an agent from the list matches one available in the Agent Registry (CP-T051 route at `/agents/:agentId`), link the agent ID text to `/agents/:agentId`. If Agent Registry is unavailable or agent not registered, show plain text — no broken link.
4. Empty state: "No attributed contributors for this entity."
5. 503 state: "Contributor data unavailable. Check that your Iranti API key has `memory:read` scope."
6. Loading state: skeleton row consistent with existing fact row loading

**Files to read before starting:**
- `docs/tickets/cp-t057.md` — full ticket
- `src/client/src/components/memory/MemoryExplorer.tsx` — Entity Detail view; find where to insert the Contributors panel
- `src/client/src/components/stream/ActivityStream.tsx` — relative timestamp pattern to reuse
- `docs/specs/visual-tokens.md` — Terminals palette

**Acceptance criteria (frontend):**
- AC-4: Contributors panel renders in Entity Detail with write count and relative lastContributedAt
- AC-5: Empty state and 503 state render correctly
- AC-6: Panel uses Terminals palette tokens — no hardcoded colors
- AC-7: TypeScript clean
- Agent ID link to `/agents/:agentId` is best-effort (degrade gracefully)
- Light mode and dark mode both visually reviewed

**Commit as:**
- `feat(backend): add WhoKnows proxy endpoint for entity contributor panel (CP-T057)`
- `feat(frontend): add Contributors panel to Entity Detail view (CP-T057)`

**Report back to PM with:**
- Whether the `/memory/whoknows/` route on Iranti was reachable with the `memory:read` scope API key
- Which ACs passed
- Whether the Agent Registry link was implemented or deferred (and why)
- CI status

---

### Assignment — CP-T058 (UX Polish: Operator Guidance Labels — M4/M5/H8) — `frontend_developer`

**Status:** OPEN — issued 2026-03-21 (Wave 5)
**Ticket:** `docs/tickets/cp-t058.md`
**Priority:** P3
**Phase:** 3, Wave 5
**Scope:** Primarily pure frontend. One item (H8 — IRANTI_PROJECT_MODE) may require a small backend addition if the field is not already returned by the health/instance endpoint — check first, document in report.

**Why now:** Three UX gaps were identified in the cross-repo audit where the control plane shows read-only data but leaves operators stranded with no action guidance. All three are small, low-risk, and high-operator-value. Bundling them as a single polish pass keeps the commit footprint small.

**The three changes:**

**M4 — Provider Manager write-path guidance:**
- In `src/client/src/components/providers/ProviderManager.tsx`, add a static informational note in the view header or below the active provider display
- Text: "Provider and model configuration is read-only. To change providers or models, run `iranti setup` in your project directory."
- Style: Informational severity (blue-tinted or neutral) from the CP-T028 taxonomy — not a warning/error
- `iranti setup` must render in monospace/code style
- Must not be dismissible; must be visible in both light mode and dark mode

**M5 — Instance unreachable command hint:**
- In the Instance Manager, when an instance status is `Unreachable`:
- Add helper text below the status badge: "To start this instance, run `iranti run --instance <name>` in your terminal."
- Substitute the actual instance name from the instance record; if null, show `iranti run` without `--instance`
- Small, muted helper text — not a full alert panel

**H8 — IRANTI_PROJECT_MODE in Instance Manager:**
- Add `IRANTI_PROJECT_MODE` as a displayed field in the instance metadata panel, alongside existing env-derived fields
- Label: "Project Mode"; value: env var value (`isolated`, `shared`) or `—` if not set
- If `isolated`: tooltip "Each project gets its own isolated memory context."
- If `shared`: tooltip "All projects share a single memory context."
- **Check first:** Does the backend health endpoint or instance serializer already return `IRANTI_PROJECT_MODE`? If yes, pure frontend change. If no, add it to the relevant serializer in `health.ts` or the instance endpoint.

**Files to read before starting:**
- `docs/tickets/cp-t058.md` — full ticket with all ACs
- `src/client/src/components/providers/ProviderManager.tsx` — M4 target
- `src/client/src/components/instances/` (or equivalent) — M5 and H8 targets
- `src/server/routes/control-plane/health.ts` — check if `IRANTI_PROJECT_MODE` is already returned
- `docs/specs/visual-tokens.md` — Terminals palette

**Acceptance criteria:**
- AC-1 (M4): Informational note visible in Provider Manager, `iranti setup` in code style, non-dismissible
- AC-2 (M5): `iranti run --instance <name>` helper text under Unreachable status badge
- AC-3 (H8): Project Mode field displayed in instance metadata; `isolated`/`shared` tooltips present
- AC-4: TypeScript clean, no `any`
- AC-5: Light mode and dark mode both visually reviewed

**Commit as:** `feat(frontend): add operator guidance labels — Provider Manager hint, instance unreachable cmd, project mode (CP-T058)`

**Report back to PM with:**
- Whether H8 required a backend change (and if so, what was added)
- All 5 ACs verified
- CI status

---

## Wave 6 — Issued 2026-03-21 (Diagnostics Epic — CP-E012)

**Wave 6 rationale:** The Health Dashboard is a passive read-only view. Operators encountering problems must drop to the CLI and run `iranti doctor`. Wave 6 adds the first active operator surface: a "Run Diagnostics" button that triggers live checks (connectivity, auth, DB, vector backend, ingest round-trip, attend probe, vector search quality) and surfaces actionable fix suggestions from within the UI. This is a new product epic (CP-E012 Diagnostics) at P2 priority — higher than the Wave 5 items — because it directly reduces mean-time-to-resolution for operators.

Wave 6 can run concurrently with Wave 5 (different ticket owners). The backend_developer can start CP-T059 backend while the frontend_developer works through CP-T056 + CP-T058.

---

### Assignment — CP-T059 (Interactive Diagnostics Panel) — `backend_developer` + `frontend_developer`

**Status:** OPEN — issued 2026-03-21 (Wave 6, CP-E012)
**Ticket:** `docs/tickets/cp-t059.md`
**Priority:** P2
**Phase:** 3, Wave 6

**Why now:** Passive health views are table stakes. An active "Run Diagnostics" surface that probes Iranti, the auth layer, the vector backend, and the Staff round-trip is what makes the control plane genuinely useful when something is wrong — which is exactly when operators need it most. `iranti doctor` is a CLI tool; the control plane should be better.

**backend_developer scope:**

Create `src/server/routes/control-plane/diagnostics.ts` implementing:

1. **`POST /api/control-plane/diagnostics/run`** — Trigger a full diagnostic run. Runs 7 checks sequentially or concurrently (see below), returns a structured result object. Hard timeout per check: 5 seconds. Total run timeout: 30 seconds.

   The 7 checks:
   - `iranti_connectivity`: GET `${IRANTI_URL}/health` — expect 200 with `{ status: "ok" }`
   - `iranti_auth`: GET `/kb/search?query=test&limit=1` with `X-Iranti-Key` forwarded — expect 200
   - `db_connectivity`: `SELECT 1` against the control plane's own database connection
   - `vector_backend`: probe configured `IRANTI_VECTOR_BACKEND` URL (if qdrant/chroma: HTTP GET to root URL; if pgvector/none: mark as `pass` with note "Uses primary database connection")
   - `ingest_roundtrip`: POST `/kb/write` with `entityType: '__diagnostics__'`, `entityId: '__probe__'`, `key: 'probe_timestamp'`, `valueJson: JSON.stringify(Date.now())`, then GET `/kb/query/__diagnostics__/__probe__/probe_timestamp` — expect round-trip to match
   - `attend_check`: POST `/memory/attend` with `{ agent: 'control_plane_operator', currentContext: 'diagnostic probe' }` — expect 200 without `classification_parse_failed_default_false`
   - `vector_search_check`: GET `/kb/search?query=diagnostic+probe&limit=1` — if result has `vectorScore > 0`, pass; if `vectorScore === 0` for all results, warn (not fail) with message about in-process fallback

   Each check returns:
   ```ts
   {
     check: string     // internal key
     status: 'pass' | 'warn' | 'fail'
     message: string   // human-readable result
     fixHint: string | null  // actionable next step, or null if passing
     durationMs: number
   }
   ```

   Fix hint examples are in the ticket (`docs/tickets/cp-t059.md`). Use the ticket wording exactly — these are operator-facing copy.

   Full response:
   ```ts
   {
     runAt: string   // ISO timestamp
     overallStatus: 'pass' | 'warn' | 'fail'
     checks: CheckResult[]
     totalDurationMs: number
   }
   ```

   Cache the result in a module-level variable. Never persist to disk.

2. **`GET /api/control-plane/diagnostics/last`** — Return the cached last run result. Return 404 with `{ error: "No diagnostic run performed yet" }` if no run has been triggered.

3. **Graceful degradation**: If any check throws, catch and mark it as `fail` with the exception message. Never let diagnostics.run itself 500.

4. **Register in `index.ts`**: `controlPlaneRouter.use('/diagnostics', diagnosticsRouter)`

**Files to read before starting:**
- `docs/tickets/cp-t059.md` — full ticket, all 8 ACs, fixHint wording
- `src/server/routes/control-plane/providers.ts` — Iranti proxy pattern (forwarding `X-Iranti-Key`)
- `src/server/routes/control-plane/health.ts` — environment variable patterns already in use
- `src/server/routes/control-plane/index.ts` — route registration

**Note on the ingest roundtrip probe entity:** The `__diagnostics__` entity and `__probe__` entity ID are intentional sentinel values. Consider whether the control plane should filter these from normal Memory Explorer results. Mention your decision in the report.

**Acceptance criteria (backend):**
- AC-1: POST /diagnostics/run returns the 7-check result object
- AC-2: GET /diagnostics/last returns last result or 404
- AC-3: Any check that throws returns `fail` with exception message (not 500)
- AC-4: TypeScript clean, no `any`
- Checks 5–7 (ingest, attend, vector search) require live Iranti — mark as `warn` with "Iranti unavailable" if upstream is unreachable rather than fail
- `vitest run` passes — no regressions

**frontend_developer scope:**

In `src/client/src/components/health/HealthDashboard.tsx`:

1. **"Run Diagnostics" button** — In the Health Dashboard header. On click:
   - Show "Running diagnostics…" with a spinner/pulse animation (use the existing ActivityStream pulse pattern or a simple spinner)
   - POST `/api/control-plane/diagnostics/run`
   - On success: render results panel (see below)
   - On error: "Diagnostics unavailable. Check that the control plane server is running."

2. **On page load**: GET `/api/control-plane/diagnostics/last`. If result exists, show it in a collapsed "Last Run" section (with timestamp). If 404, show nothing.

3. **Results panel**:
   - Summary banner at top: "All checks passed" (emerald) / "N warning(s) — system functional but degraded" (amber) / "N failure(s) detected — action required" (red) — consistent with CP-T028 four-tier severity taxonomy
   - Table of check results: Check Name | Status (badge) | Message | Duration
   - Status badges: Pass=emerald, Warn=amber, Fail=red — use existing Health Dashboard badge styles
   - If `fixHint` is non-null: show below the message as small helper text; `iranti ...` commands in inline monospace
   - Panel is collapsible. Default: expanded after a run; collapsed on page load (last-run state)

4. **Command palette**: Register "Run Diagnostics" as a command in the Cmd+K palette (CP-T024). Triggering it should fire the same run flow as the button click.

5. **Check name display mapping** (human-friendly labels):

   | Internal key | Display label |
   |-------------|---------------|
   | `iranti_connectivity` | Iranti Connectivity |
   | `iranti_auth` | API Key Auth |
   | `db_connectivity` | Database Connection |
   | `vector_backend` | Vector Backend |
   | `ingest_roundtrip` | Memory Ingest Round-Trip |
   | `attend_check` | Attendant Classifier |
   | `vector_search_check` | Vector Search Quality |

**Files to read before starting:**
- `docs/tickets/cp-t059.md` — full ticket
- `src/client/src/components/health/HealthDashboard.tsx` — extend this component
- `src/client/src/components/stream/ActivityStream.tsx` — pulse/spinner animation pattern
- `src/client/src/components/common/CommandPalette.tsx` (or wherever the palette command registry is) — how to add a new command

**Acceptance criteria (frontend):**
- AC-5: "Run Diagnostics" button visible in Health Dashboard header
- AC-6: Results panel renders with pass/warn/fail badges, fix hints in monospace, duration per check
- AC-7: Command palette "Run Diagnostics" entry triggers the run
- AC-8: TypeScript clean, no `any`
- Light mode and dark mode both visually reviewed
- Page load with last-run result shows collapsed "Last Run" section with timestamp

**Commit as:**
- `feat(backend): implement diagnostics run endpoint with 7 live checks and fix hints (CP-T059)`
- `feat(frontend): add Run Diagnostics panel to Health Dashboard with command palette integration (CP-T059)`

**Report back to PM with:**
- Which of the 7 checks ran successfully against a live Iranti instance
- Whether the `__diagnostics__` probe entity decision (filter from Memory Explorer or leave visible) was made — and which direction
- Any fixHint wording changes and rationale (must get PM approval before deviating from ticket wording)
- AC-7 (command palette) confirmed working
- CI status

**CP-T059 outcome:** PM-ACCEPTED 2026-03-21 (backend + frontend). TypeScript clean. All 5 frontend ACs verified. AC-9 `__diagnostics__` filter implemented as client-side exclusion in MemoryExplorer.tsx. Double-trigger guard confirmed. rAF deferred command palette event confirmed.

---

## Wave 7 — Issued 2026-03-21 (Metrics Epic — CP-E013)

**Wave 7 rationale:** With Wave 5/6 complete, the control plane provides a complete real-time operator surface. The natural next step is the time-dimension view: trends and historical activity shape, not just current state. CP-T060 (Metrics Dashboard) uses only data that already exists in `staff_events`, introduces no new data collection infrastructure, and gives operators a genuinely new capability — spotting trends and anomalies across sessions.

**PM decisions locked at dispatch:**
- SVG-native charts only (no Recharts, Chart.js, or any other charting dependency)
- 7d and 30d period toggles at MVP (90d deferred)
- `totalFacts` derived from `staff_events` accumulation, not unbounded `/kb/query`
- DB index on `(timestamp, agent_id, action_type)` recommended to backend

---

### Assignment — CP-T060 (Metrics Dashboard) — `backend_developer` + `frontend_developer`

**Status:** OPEN — dispatched 2026-03-21 (Wave 7, CP-E013)
**Ticket:** `docs/tickets/cp-t060.md`
**Priority:** P2
**Phase:** 3, Wave 7

**Why now:** The Staff Logs view (CP-T050) proved the `staff_events` table is populated and query-ready. Wave 5/6 completed the operator insight surface. Metrics is the final piece of the "understand Iranti over time" capability gap — operators currently cannot answer "how fast is the KB growing?" or "which agents have been most active this week?" This view answers those questions with no new data collection infrastructure.

**backend_developer scope:**

Create `src/server/routes/control-plane/metrics.ts` implementing three endpoints:

1. **`GET /api/control-plane/metrics/kb-growth?period=30d`**

   Return daily KB fact counts for the last N days (7 or 30 — no other values at MVP). Query structure:
   - `newFacts`: count `staff_events` WHERE `action_type = 'WRITE_ACCEPTED'` grouped by DATE(timestamp)
   - `archivedFacts`: count `staff_events` WHERE `action_type IN ('ARCHIVED', 'WRITE_REJECTED_CONFIDENCE', ...)` grouped by DATE(timestamp) — include all archival action types
   - `totalFacts`: running accumulation from day 0 of available `staff_events` data (sum of `WRITE_ACCEPTED` minus `ARCHIVED` to date)
   - If `staff_events` has fewer than 2 days of data: return `truncated: true` with whatever is available

   Response shape:
   ```json
   {
     "period": "30d",
     "truncated": false,
     "data": [
       { "date": "2026-03-20", "totalFacts": 1240, "newFacts": 14, "archivedFacts": 2 }
     ]
   }
   ```

2. **`GET /api/control-plane/metrics/agent-activity?period=30d`**

   Return per-agent write volume grouped by day. Cap to top 10 agents by total write count if more than 10 are active in the period.

   Response shape:
   ```json
   {
     "period": "30d",
     "agents": [
       {
         "agentId": "backend_developer",
         "data": [
           { "date": "2026-03-20", "writes": 8, "rejections": 1, "escalations": 0 }
         ]
       }
     ]
   }
   ```

3. **`GET /api/control-plane/metrics/summary`**

   Lightweight summary for the top of the view. Use SQL aggregates — do not load all events into memory.

   Response shape:
   ```json
   {
     "totalFacts": 1240,
     "factsLast24h": 14,
     "factsLast7d": 89,
     "activeAgentsLast7d": 3,
     "rejectionRateLast7d": 0.04,
     "archiveRateLast7d": 0.02
   }
   ```

4. **DB index recommendation:** Before writing the endpoint, check whether a compound index exists on `staff_events (timestamp, agent_id, action_type)`. If not, add a migration that creates it. GROUP BY queries on this table will need it as volume grows.

5. **Register in `index.ts`**: `controlPlaneRouter.use('/metrics', metricsRouter)`

**Files to read before starting:**
- `docs/tickets/cp-t060.md` — full ticket, all ACs, PM decisions
- `src/server/routes/control-plane/events.ts` — existing `staff_events` query patterns, table-existence cache, serialization — your metrics queries follow the same patterns
- `src/server/routes/control-plane/index.ts` — route registration
- `src/server/migrations/` — examine for existing index patterns; add index migration here

**Acceptance criteria (backend):**
- AC-1: `GET /metrics/kb-growth?period=30d` returns data array with `date`, `totalFacts`, `newFacts`, `archivedFacts`; `truncated: true` when `< 2 days` of data
- AC-2: `GET /metrics/agent-activity?period=30d` returns per-agent data array
- AC-3: `GET /metrics/summary` returns all 6 summary fields
- AC-4: TypeScript clean, no `any`. `tsc --noEmit` passes.
- Graceful degradation: if `staff_events` table doesn't exist (e.g., before migration), return empty data with `truncated: true` — not a 500
- No unbounded memory loads: use SQL aggregates (`COUNT`, `GROUP BY`, `DATE_TRUNC` or `strftime`)

**frontend_developer scope:**

Create `src/client/src/components/metrics/MetricsDashboard.tsx` and add the `/metrics` route:

1. **Sidebar nav entry:** Add "Metrics" between "Health" and "Conflicts" in the sidebar nav list. Icon: use a chart-like symbol from existing palette (e.g., `▦` or `⊡` — confirm with visual tokens).

2. **Summary stat cards at top (AC-8):** 4 cards in a 2×2 or 4-column row:
   - "Total KB Facts" — `summary.totalFacts`
   - "Written in last 24h" — `summary.factsLast24h`
   - "Active agents (7d)" — `summary.activeAgentsLast7d`
   - "Rejection rate (7d)" — `summary.rejectionRateLast7d` as a percentage (e.g., "4.0%")
   - Use the same card style as Health Dashboard cards

3. **KB Growth chart (AC-6):** SVG-native line chart. X-axis: dates (last 7 or 30 days). Y-axis: fact count. Two lines: `newFacts` (emerald) and `archivedFacts` (amber). Period toggle: 7d / 30d buttons (default 30d). No chart library — draw SVG paths from the data array. Axis labels: abbreviated date (e.g., "Mar 20"). Legend below the chart. The Entity Relationship Graph (CP-T032) is an existing SVG precedent in the codebase.

4. **Agent Activity chart (AC-7):** SVG-native bar chart. X-axis: dates. Y-axis: write count. Bars grouped or stacked by agent. Show top 5 agents by total write count; group the rest as "Other" (neutral gray). Agent color assignments: use the same color seed function as the Agent Registry (CP-T051) if one exists — otherwise derive colors from a fixed palette of 5 Terminals palette accents. Legend showing agent IDs and their color.

5. **Empty state (AC-9):** If `kb-growth` returns `truncated: true` and has fewer than 2 data points: show "Not enough history yet. Metrics will appear after at least 48 hours of activity." with a note about when the `staff_events` table was created (use `summary` data or the oldest event timestamp if available).

6. **Period toggle state:** Changing the 7d/30d toggle re-fetches both `kb-growth` and `agent-activity` with the new period. Summary cards do not change (summary uses its own fixed windows).

**Files to read before starting:**
- `docs/tickets/cp-t060.md` — full ticket
- `src/client/src/components/memory/EntityDetail.tsx` (or wherever CP-T032 SVG graph lives) — SVG rendering precedent
- `src/client/src/components/agents/AgentRegistry.tsx` (or equivalent) — agent color assignment to reuse
- `src/client/src/components/health/HealthDashboard.tsx` — card style to match
- `docs/specs/visual-tokens.md` — Terminals palette; emerald for new facts, amber for archived, use accent colors for agent bars

**Acceptance criteria (frontend):**
- AC-5: `/metrics` route in sidebar, renders dashboard
- AC-6: KB Growth SVG line chart with 7d/30d toggle, emerald/amber lines, period toggle re-fetches
- AC-7: Agent Activity SVG bar chart, top 5 agents, "Other" grouping, legend
- AC-8: 4 summary stat cards visible at top of view
- AC-9: Empty state shown when fewer than 2 days of data
- AC-10: TypeScript clean, no `any`. `tsc --noEmit` passes.
- Light mode and dark mode both visually reviewed

**Commit as:**
- `feat(backend): add metrics endpoints — kb-growth, agent-activity, summary (CP-T060)`
- `feat(frontend): add Metrics Dashboard with SVG charts and summary cards (CP-T060)`

**Report back to PM with:**
- Whether the `staff_events` index was added (and migration confirmed)
- Confirmation that SVG chart rendering works with real data (or empty/truncated state if no data yet)
- Which ACs passed
- Whether any agent color reuse from CP-T051 was implemented
- CI status

---

## Wave 8 — Issued 2026-03-21 (KB Management, Product Clarity, Provider Auditability, Documentation)

**Rationale:** Wave 7 (Metrics Dashboard) closed the historical visibility gap. Wave 8 closes three orthogonal gaps: (1) the entity alias write surface deferred since Phase 1, (2) a product clarity note about the semantic relationship gap, and (3) API key scope visibility for multi-agent operators. Documentation for Wave 5 and Wave 7 features is also overdue.

**Priority sequencing:**
- CP-T061 (Entity Alias UI) — P2 — backend + frontend, moderate complexity
- CP-T063 (API Key Scope Audit) — P2 — backend + frontend, low complexity
- CP-T062 (Relationship Graph B9 note) — P3 — frontend only, one-file change
- CP-T064 (Documentation update) — P3 — technical_writer only

---

### Assignment — CP-T061 (Entity Alias Management UI) — `backend_developer` + `frontend_developer`

**Status:** OPEN — issued 2026-03-21
**Ticket:** `docs/tickets/cp-t061.md`
**Priority:** P2
**Phase:** 3, Wave 8

**Why now:** Entity aliases have been deferred since CP-T006 (Phase 1 spike). The Iranti API (`POST /kb/alias`, `GET /kb/entity/:entityType/:entityId/aliases`) has existed since Phase 1. The Entity Detail view (CP-T036) is now stable, write-surface patterns are established (CP-T049 restore, CP-T033 repair actions), and alias management is a routine housekeeping task for operators ingesting data from multiple sources.

**backend_developer scope:**
- Add `GET /api/control-plane/kb/entity/:entityType/:entityId/aliases` — proxy to Iranti, return alias list
- Add `POST /api/control-plane/kb/alias` — proxy to Iranti `POST /kb/alias`; 201 on success, 400 if entity not found, 503 if upstream unreachable
- Add to `src/server/routes/control-plane/kb.ts`
- TypeScript clean, no `any`

**frontend_developer scope:**
- Add "Aliases" collapsible section to Entity Detail view (`src/client/src/components/memory/EntityDetail.tsx`), positioned after Relationships section
- List existing aliases with entity type/ID links and creation timestamps
- Empty state: "No aliases — this entity has no aliases yet."
- Inline "Create alias" form (collapsed by default) with entityType + entityId fields and Create button
- On success: refresh alias list. On error: inline error message.
- Each alias links to `/memory/:aliasEntityType/:aliasEntityId`
- TypeScript clean, no `any`

**Files to read before starting:**
- `docs/tickets/cp-t061.md` — full ticket and acceptance criteria
- `docs/specs/entity-aliases-spike.md` — Phase 1 spike; design rationale and API shape
- `src/server/routes/control-plane/kb.ts` — existing KB proxy patterns
- `src/client/src/components/memory/EntityDetail.tsx` — Entity Detail component structure
- `src/server/routes/control-plane/archivist.ts` or `escalations.ts` — write-path proxy patterns

**Acceptance criteria:**
- AC-1: `GET .../aliases` proxy returns alias list or empty array
- AC-2: `POST /kb/alias` proxy returns 201 on success, 400 on bad entity, 503 on unreachable
- AC-3: Backend TypeScript clean
- AC-4: Aliases panel in Entity Detail with list + create form
- AC-5: Each alias links to the aliased entity detail page
- AC-6: Frontend TypeScript clean

**Report back to PM with:**
- Confirmation of which Iranti API shape was used (`POST /kb/alias` request body fields)
- Whether the alias creation form was tested with real data or in empty-table state
- Any upstream API gaps found (e.g., missing `createdAt` field in alias response)
- TypeScript status both sides

---

### Assignment — CP-T063 (API Key Scope Audit View) — `backend_developer` + `frontend_developer`

**Status:** OPEN — issued 2026-03-21
**Ticket:** `docs/tickets/cp-t063.md`
**Priority:** P2
**Phase:** 3, Wave 8

**Why now:** Iranti v0.2.1 introduced namespace-aware API key scopes. The Provider Manager shows key presence and reachability but not scope assignments. Wave 7 (Metrics Dashboard) surfaces per-agent write volume, making multi-agent routing patterns visible. Wave 8 should make the provider configuration that supports those agents auditable.

**backend_developer scope:**
- Before implementing: check whether Iranti's provider endpoint (or config files) exposes scope information in v0.2.14. If yes, add `scope` and `scopeType` fields to `GET /api/control-plane/providers` response. If no, return `scope: null` / `scopeType: "unknown"` and note the upstream gap.
- Read `src/server/routes/control-plane/providers.ts` for the current provider endpoint and `src/server/routes/control-plane/setup.ts` for config-file reading patterns.
- TypeScript clean, no `any`

**frontend_developer scope:**
- Add "Scope" column to Provider Manager list view: "global" badge, scope string in code-styled label, or "—" for unknown
- Add "API Key Scope" row to Provider Manager detail panel with full scope string and explanatory note
- Truncate long scope strings with tooltip
- TypeScript clean, no `any`

**Files to read before starting:**
- `docs/tickets/cp-t063.md` — full ticket and acceptance criteria
- `src/server/routes/control-plane/providers.ts` — current provider endpoint
- `src/server/routes/control-plane/setup.ts` — config-file reading (source of truth for env/config values)
- `src/client/src/components/providers/ProviderManager.tsx` — current Provider Manager component

**Acceptance criteria:**
- AC-1: `scope` and `scopeType` fields in provider endpoint response (or `null`/`"unknown"` gracefully)
- AC-2: Backend TypeScript clean
- AC-3: Scope column in Provider Manager list
- AC-4: Scope row in Provider Manager detail panel with explanatory note
- AC-5: Frontend TypeScript clean

**Report back to PM with:**
- Whether Iranti v0.2.14 exposes scope in a queryable API or only in config files
- Whether real scope data was visible or only the `null`/`"unknown"` placeholder
- TypeScript status both sides

---

### Assignment — CP-T062 (Relationship Graph B9 Note) — `frontend_developer`

**Status:** OPEN — issued 2026-03-21
**Ticket:** `docs/tickets/cp-t062.md`
**Priority:** P3
**Phase:** 3, Wave 8

**Why now:** Operators looking at the Relationship Graph have no way to know that semantic similarity relationships (`GET /kb/related`) are a planned capability blocked by B9 (no MCP read tool). CP-T052 surfaces vector backend status in Health, so operators now understand the vector layer — this note closes the communication loop.

**frontend_developer scope:**
- Add a muted informational note below the Relationship Graph in Entity Detail: "This graph shows explicit relationships. Semantic relationships via vector similarity (`GET /kb/related`) are not yet available from the control plane — this requires MCP read tool support (B9)."
- Only show when the Relationship Graph section is visible (entity has relationships)
- Use `--color-text-tertiary` token, no new CSS classes needed
- Link to `/health` for vector backend status check
- TypeScript clean

**Files to read before starting:**
- `docs/tickets/cp-t062.md` — full ticket
- `src/client/src/components/memory/EntityDetail.tsx` — where the graph renders
- `src/client/src/components/memory/EntityDetail.module.css` — existing label styles to reuse

**Acceptance criteria:**
- AC-1: Informational note rendered below the graph, linking to /health
- AC-2: Note only appears when graph section is rendered (entity has relationships)
- AC-3: TypeScript clean

**Report back to PM with:**
- Confirmation of which CSS class/token was used for the note text
- Whether the note is visible in both light and dark mode

---

### Assignment — CP-T064 (Documentation Update) — `technical_writer`

**Status:** OPEN — issued 2026-03-21
**Ticket:** `docs/tickets/cp-t064.md`
**Priority:** P3
**Phase:** 3, Wave 8

**Why now:** CP-T056 (asOf picker) and CP-T057 (Contributors panel) were accepted in Wave 5 but the guide was not updated at that time. CP-T060 (Metrics Dashboard) was accepted today. The documentation debt must be paid in Wave 8.

**technical_writer scope:**
- Update `docs/guides/memory-explorer.md`: add asOf picker section (what it does, how to use it, limitations) and Contributors panel section (what it shows, relation to `GET /kb/whoknows`)
- Update `docs/guides/getting-started.md`: add Metrics Dashboard row to the "What's Available Now" table
- No new files. Edit in place.

**Files to read before starting:**
- `docs/tickets/cp-t064.md` — full ticket and acceptance criteria
- `docs/tickets/cp-t056.md` — asOf picker feature description
- `docs/tickets/cp-t057.md` — Contributors panel feature description
- `docs/tickets/cp-t060.md` — Metrics Dashboard feature description
- `docs/guides/memory-explorer.md` — current state
- `docs/guides/getting-started.md` — current state (add to "What's Available Now" table)

**Acceptance criteria:**
- AC-1: asOf picker documented in memory-explorer.md
- AC-2: Contributors panel documented in memory-explorer.md
- AC-3: Metrics Dashboard row added to getting-started.md table
- AC-4: No new files created

**Report back to PM with:**
- Sections added and their headings
- Any gaps found between ticket spec and actual implementation (e.g., if asOf picker UI differs from ticket description)

---

## Wave 9 — Issued 2026-03-21 (KB Power Features)

**Rationale:** Wave 8 revealed that the CP-T061 frontend was built against a speculative API shape from the CP-T006 spike that does not match Iranti's real alias API. The backend was correct and accepted. Wave 9 immediately corrects the frontend (CP-T065 — PM-ACCEPTED) and then adds the two highest-value remaining KB operator features: full-text/semantic search across the entire KB (CP-T066) and entity type discovery (CP-T067). These close the gap between the Memory Explorer's browse-only model and a true knowledge management surface.

**Tickets in this wave:**
- CP-T065 (Entity Alias Panel Rewrite) — P2 — frontend only — **PM-ACCEPTED 2026-03-21**
- CP-T066 (KB Full-Text/Semantic Search) — P2 — backend + frontend
- CP-T067 (Entity Type Browser) — P3 — backend + frontend

---

### Assignment — CP-T065 (Entity Alias Panel Rewrite) — `frontend_developer`

**Status:** OPEN
**Ticket:** `docs/tickets/cp-t065.md`
**Priority:** P2
**Phase:** 3, Wave 9

**Why this wave:** The CP-T061 frontend was rejected because it rendered `alias.aliasEntityType / alias.aliasEntityId` (fields that don't exist) and sent `{ fromEntityType, fromEntityId, toEntityType, toEntityId }` as the POST body (wrong shape). The correct shape is flat string alias tokens. This must be fixed before the alias tab is visible to operators.

**Key files to change:**
- `src/client/src/api/types.ts` — replace `EntityAlias` and `EntityAliasesResponse` with correct interfaces
- `src/client/src/components/memory/EntityDetail.tsx` — rewrite `AliasRow` (no entity link, show token + metadata) and `CreateAliasForm` (single token field, correct POST body)
- `src/client/src/components/memory/EntityDetail.module.css` — token display styles if needed

**Key files to leave unchanged:**
- `src/server/routes/control-plane/kb.ts` — backend is correct, accepted in CP-T061

**Real API shapes (from backend agent investigation of Iranti v0.2.15):**

GET response:
```json
{ "canonicalEntity": "user/alice-doe", "aliases": [{ "alias": "alice", "aliasNorm": "alice", "source": "query", "confidence": 50, "createdAt": "..." }], "total": 1 }
```

POST body:
```json
{ "canonicalEntity": "user/alice-doe", "alias": "alice", "source": "manual", "confidence": 80 }
```

**Acceptance criteria:**
- AC-1: `EntityAlias` and `EntityAliasesResponse` match real API shape
- AC-2: `AliasRow` shows alias token (monospace), source, confidence, createdAt — no entity Link
- AC-3: `CreateAliasForm` single field; POST body is `{ canonicalEntity: "type/id", alias: token }`
- AC-4: Empty state and count badge unchanged
- AC-5: Visual design quality — ConfidenceBar reused, tokens in code style
- AC-6: tsc --noEmit CLEAN in both src/server and src/client

**Report back to PM with:**
- Confirmation that AliasRow renders flat string tokens (not entity links)
- Confirmation that CreateAliasForm POST body matches the real API
- TypeScript check output
- Any Iranti API edge cases discovered during testing

---

### Assignment — CP-T066 (KB Full-Text/Semantic Search) — `backend_developer` + `frontend_developer`

**Status:** PM-ACCEPTED 2026-03-21
**Ticket:** `docs/tickets/cp-t066.md`
**Priority:** P2
**Phase:** 3, Wave 9

**Why this wave:** The Iranti API's `GET /kb/search` endpoint provides hybrid lexical+vector search across the full KB. It is already used internally by the diagnostics module (`iranti_auth` and `vector_search_check` probes) but is not exposed as an operator search surface. Memory Explorer currently uses ILIKE substring filtering only. This ticket surfaces real search to operators for the first time — answering "which entities know something about onboarding?" without knowing entity type or ID.

**Key files to change:**
- `src/server/routes/control-plane/kb.ts` — add `GET /kb/search` proxy endpoint
- `src/client/src/api/types.ts` — add `KBSearchResult`, `KBSearchResponse` interfaces
- `src/client/src/components/memory/MemoryExplorer.tsx` — add search mode
- `src/client/src/components/memory/MemoryExplorer.module.css` — search result styles

**Key reference:**
- `src/server/routes/control-plane/diagnostics.ts` — already calls `/kb/search`; use same URL construction pattern
- `docs/coordination/cross-repo-audit-2026-03-21.md` — line 41, endpoint spec: `query`, `limit` (1–50), `entityType`, `entityId`, `lexicalWeight`, `vectorWeight`, `minScore`; requires global scope `kb:read`
- Real Iranti search response includes per-result `lexicalScore`, `vectorScore`, `score` (combined)

**Backend work:**
- Proxy `GET /api/control-plane/kb/search?query=<q>&limit=<n>&entityType=<optional>` → `GET /kb/search` on active instance
- Do NOT expose `lexicalWeight`/`vectorWeight` in the API at MVP (Iranti defaults are fine)
- Handle: 400 (missing query), 403 (scope error → return to client with SCOPE_ERROR), 503 (unreachable)

**Frontend work:**
- Add a search input above the entity type filter that triggers a call to `/api/control-plane/kb/search`
- Show results as a ranked list: entity type + entity ID (link to `/memory/:type/:id`), fact key, value summary, score display
- If `vectorScore === 0` for all results, show muted note: "Semantic search returned no vector matches — showing lexical results only."
- If 403/SCOPE error, explain: "Full-text search requires a global-scope API key."
- Empty state: "No results for [query]."
- Must not break existing Memory Explorer browse mode

**Acceptance criteria (from ticket):**
- AC-1: Backend proxy returns results; handles 503/400/403
- AC-2: `KBSearchResult` and `KBSearchResponse` types correct and match real API
- AC-3: Operator can type a query and receive cross-KB results (not ILIKE entity filter)
- AC-4: Results show entity+key+summary+score+confidence, entity link navigates to detail
- AC-5: Score display; vectorScore=0 → lexical fallback note
- AC-6: Empty and error states correct
- AC-7: Existing Memory Explorer browse mode unaffected
- AC-8: tsc --noEmit CLEAN in both server and client

**Report back to PM with:**
- Confirmation of the real `KBSearchResult` shape (verify against live instance before committing types)
- Design decision made for search mode integration (separate input vs toggle vs mode switch)
- TypeScript check output
- Any scope errors observed during testing

---

### Assignment — CP-T067 (Entity Type Browser) — `backend_developer` + `frontend_developer`

**Status:** PM-ACCEPTED 2026-03-21
**Ticket:** `docs/tickets/cp-t067.md`
**Priority:** P3
**Phase:** 3, Wave 9

**Why this wave:** CP-T067 can run in parallel with CP-T066. The Entity Type Browser is purely additive — it does not modify any existing routes or components, only adds a new initial state to the Memory Explorer. The backend aggregation query is straightforward and reads from the local `knowledge_base` table, requiring no new Iranti API calls. This gives new operators an instant map of the KB's structure.

**Key files to change:**
- `src/server/routes/control-plane/kb.ts` — add `GET /api/control-plane/kb/entity-types` endpoint
- `src/client/src/api/types.ts` — add `EntityTypeSummary`, `EntityTypesResponse`
- `src/client/src/components/memory/MemoryExplorer.tsx` — add EntityTypeBrowser as initial view when no entityType filter is active
- `src/client/src/components/memory/MemoryExplorer.module.css` — entity type card styles

**Backend work:**
```sql
SELECT entity_type,
       COUNT(*) as fact_count,
       MAX(COALESCE(updated_at, created_at)) as last_updated_at
FROM knowledge_base
GROUP BY entity_type
ORDER BY fact_count DESC;
```
Returns `{ entityTypes: [{ entityType, factCount, lastUpdatedAt }], total }`.

**Frontend work:**
- When `entityType` filter is empty (default Memory Explorer state), show EntityTypeBrowser grid instead of empty table
- Each card: entity type name, fact count badge, last updated relative time, "Browse →" that sets entityType filter
- Setting entityType filter switches to normal browse mode; clearing it returns to EntityTypeBrowser
- URL: use `?entityType=<type>` query param for shareability

**Acceptance criteria (from ticket):**
- AC-1: Endpoint returns distinct entity types with correct counts and lastUpdatedAt
- AC-2: Memory Explorer shows EntityTypeBrowser on initial load (no entityType selected)
- AC-3: Clicking "Browse →" activates entity type filter and shows facts
- AC-4: Counts and recency are accurate
- AC-5: Empty state for empty KB
- AC-6: Existing browse mode unaffected; clearing entityType returns to browser
- AC-7: tsc --noEmit CLEAN in both server and client

**Report back to PM with:**
- Design decision for grid vs list layout
- How the URL param is handled (query param vs state-only)
- TypeScript check output
- Empty KB behavior

---

## CP-T025 — Carryover: Native Emitter PR Diff Files

**Status:** Carryover from Phase 2 — spec PM-approved; diff files NOT yet produced
**Assigned:** system_architect
**Priority:** P1 (long-deferred, but critical for full Staff Activity Stream coverage)

**Context:** The CP-T025 spec (`docs/specs/cp-t025-emitter-design.md` — 1,035 lines, PM-approved 2026-03-20) and upstream PR description (`docs/specs/cp-t025-upstream-pr.md` — 298 lines) are complete. The system_architect was assigned to produce actual TypeScript diff files (7 files covering all 4 Staff components) but this was never confirmed complete. The upstream PR remains unsubmitted.

**Why this still matters:** Until the upstream PR is merged, the Staff Activity Stream shows Librarian and Archivist events only. Attendant events (handshake, attend, reconvene) and Resolutionist events (resolution filed, escalation deferred) are completely invisible in the control plane — including B11 (attend classifier failure), which v0.2.13 partially fixes but still cannot be observed.

**Action for system_architect:**
1. Read `docs/specs/cp-t025-emitter-design.md` and `docs/specs/cp-t025-upstream-pr.md`
2. Confirm or produce the 7 TypeScript diff files
3. Confirm the target upstream repository and submission path (`nfemmanuel/iranti` on GitHub, based on `docs/specs/cp-t023-wizard-design.md`)
4. Report back to PM with diff file locations, submission status, and any blockers

**This is not a new ticket** — it is the outstanding Part 2 deliverable from CP-T025. Track in Iranti memory under `ticket/cp-t025`.
