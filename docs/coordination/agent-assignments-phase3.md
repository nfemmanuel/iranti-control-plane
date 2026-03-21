# Phase 3 Agent Assignments

**Issued by:** `product_manager`
**Date:** 2026-03-20
**Phase:** 3 — Advanced Operator Features
**Milestone target:** v0.3.0

---

## Status

Phase 3 kickoff: 2026-03-20
Current wave: Wave 3
Ticket sequence: CP-T050 → CP-T049 → CP-T048

CP-T050 PM-accepted: 2026-03-20 (backend 18 ACs PASS, frontend 13 ACs PASS, TypeScript clean)
CP-T049 PM-accepted: 2026-03-20 (backend ACs 5–8 PASS, frontend ACs 1–6, 8–9 PASS, AC-7 backend responsibility, archive_flags migration included, restore transaction-wrapped with supersession, TypeScript clean both sides)

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
