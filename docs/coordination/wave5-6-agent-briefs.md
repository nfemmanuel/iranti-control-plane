# Wave 5 / Wave 6 Agent Dispatch Briefs

**Issued by:** `product_manager`
**Date:** 2026-03-21
**Status:** Ready for dispatch — spawn these three agents in parallel

---

## Agent 1: `frontend_developer` — CP-T056 (Temporal History asOf Query)

### Identity and Handshake

You are the **frontend_developer** for the Iranti Control Plane project.

Your first action must be to call `iranti_handshake` with `agent_id: "frontend_developer"` and task: "Implement CP-T056 — Temporal History asOf point-in-time query. Date/time picker in Temporal History view, calls GET /kb/query with asOf param, highlights matching interval."

Query Iranti before making implementation decisions. Write your findings and completed ACs back to Iranti when done.

### Ticket: CP-T056 — Temporal History: Point-in-Time `asOf` Query

**Full ticket:** `docs/tickets/cp-t056.md`
**Priority:** P3
**Epic:** CP-E002 (Memory Explorer)

### What You're Building

The Temporal History view (`/memory/:entityType/:entityId/:key`) currently shows the full interval list using `GET /kb/history/:entityType/:entityId/:key`. The Iranti API also supports `GET /kb/query/:entityType/:entityId/:key?asOf=<ISO>` which returns the fact state at a specific point in time. You are adding a date/time picker to the view that uses this endpoint.

**Use case:** "What did Iranti believe about this fact on March 15?" — operators debugging why an agent had stale information at a specific time.

### Acceptance Criteria Summary

**AC-1 — asOf date/time picker in header**
- Add a "Point in Time" date+time picker in the Temporal History view header
- When a date/time is selected: call `GET /kb/query/:entityType/:entityId/:key?asOf=<ISO>&includeExpired=true`
- If result returned: highlight the matching interval (elevated border or background) + show fact value in a callout
- If no result: show "No fact existed at this time" in the callout
- If picker cleared: return to normal full-history view with no highlight

**AC-2 — Display returned value**
When an asOf result is returned, show in the callout:
- `valueRaw` (or `valueSummary`)
- `confidence`
- `source` and `createdBy`
- The interval it falls within (`validFrom` / `validUntil`)

**AC-3 — No backend changes needed**
This is a pure frontend change. The `asOf` parameter is already supported. Verify that the control plane backend at `GET /kb/query` forwards query params including `asOf` to Iranti — check the proxy route. If it does, no backend work is needed.

**AC-4 — Terminals palette**
The highlight style and callout box must use the emerald accent + dark canvas style consistent with the existing visual system. No hardcoded colors.

### Key Files to Read

- `src/client/src/components/memory/MemoryExplorer.tsx` — find the temporal history section or a dedicated `TemporalHistory.tsx` component
- `src/server/routes/control-plane/kb.ts` — verify that `asOf` query params are forwarded to Iranti on the `/kb/query` route
- Look at existing Terminals palette CSS tokens in `src/client/src` for the correct highlight color pattern

### Implementation Notes

- You can pre-compute which interval the `asOf` date falls within using the already-loaded `validFrom`/`validUntil` interval data — no second request strictly required if you already have intervals loaded
- But you still need the `asOf` API call to get the fact value at that exact point, since the interval list shows summaries only
- The date picker should support at minimum: date selection + time (to the minute). Browser native `<input type="datetime-local">` is acceptable if styled consistently; a small third-party picker is acceptable if already in the dependency tree
- The callout is a new UI element — use a card/box style consistent with existing expanded row callouts in the Memory Explorer

### What to Report Back When Done

- Which files you modified
- Confirmation that `tsc --noEmit` passes with zero new errors
- Confirmation that the asOf picker works against a live Iranti instance (or description of how it was tested)
- Any edge cases you encountered (e.g., what happens if the interval list is empty)
- Explicit AC checklist: AC-1 through AC-4, each confirmed or flagged

**Do not self-approve.** Report back to PM for acceptance review. The PM will check the AC list and may ask follow-up questions before accepting.

---

## Agent 2: `backend_developer` — CP-T057 Backend + CP-T059 Backend

### Identity and Handshake

You are the **backend_developer** for the Iranti Control Plane project.

Your first action must be to call `iranti_handshake` with `agent_id: "backend_developer"` and task: "Implement CP-T057 backend (WhoKnows proxy endpoint) and CP-T059 backend (Interactive Diagnostics Panel — POST /diagnostics/run, GET /diagnostics/last, 7 diagnostic checks). Work CP-T057 first, then CP-T059."

Query Iranti before making implementation decisions. Write your findings and completed ACs back to Iranti when done.

### Ticket 1: CP-T057 Backend — WhoKnows Contributor Panel (backend portion)

**Full ticket:** `docs/tickets/cp-t057.md`
**Priority:** P3

#### What You're Building

A proxy endpoint that surfaces Iranti's `GET /memory/whoknows/:entityType/:entityId` in the control plane API. The frontend will call this to display a "Contributors" panel in the Entity Detail view.

#### Acceptance Criteria

**AC-1 — `GET /api/control-plane/kb/whoknows/:entityType/:entityId`**

Proxy `GET /memory/whoknows/:entityType/:entityId` from the connected Iranti instance. Auth: forward `X-Iranti-Key` with `memory:read` scope (same pattern as existing `kb.ts` proxies).

Response shape (normalized):
```json
{
  "contributors": [
    {
      "agentId": "backend_developer",
      "writeCount": 14,
      "lastContributedAt": "2026-03-21T09:00:00.000Z"
    }
  ],
  "total": 3
}
```

Error handling:
- Iranti 404 or 401: return HTTP 503 with `{ error: "...", code: "WHOKNOWS_UNAVAILABLE" }`
- Iranti returns empty list: return `{ contributors: [], total: 0 }` (not an error)

**AC-2 — Route registration**
Register in `src/server/routes/control-plane/kb.ts` (or a new `whoknows.ts` alongside it). Add to `src/server/routes/control-plane/index.ts`. Reference `src/server/routes/control-plane/providers.ts` for the proxy pattern.

**Important:** The WhoKnows endpoint on Iranti is at `/memory/whoknows/...` — this is the `/memory/` path, not `/kb/`. Check the existing proxy routing in `index.ts` to see how `/memory/` routes are handled vs `/kb/` routes.

**AC-3 — TypeScript clean**
No `any`, no type assertions without comment. `tsc --noEmit` passes.

#### Key Files

- `src/server/routes/control-plane/kb.ts` — existing proxy pattern
- `src/server/routes/control-plane/providers.ts` — second proxy pattern reference
- `src/server/routes/control-plane/index.ts` — router registration
- `.env.iranti` — Iranti base URL and API key

---

### Ticket 2: CP-T059 Backend — Interactive Diagnostics Panel (backend portion)

**Full ticket:** `docs/tickets/cp-t059.md`
**Priority:** P2 (this is the highest-priority backend item in Wave 5/6)

#### What You're Building

Two new endpoints powering a "Run Diagnostics" button in the Health Dashboard. This is the control plane equivalent of `iranti doctor` — live diagnostic checks with actionable fix hints.

#### Acceptance Criteria

**AC-1 — `POST /api/control-plane/diagnostics/run`**

Trigger a full diagnostic run. Synchronous (preferred) — complete within 10 seconds using a per-check timeout (not a global timeout).

Run these 7 checks in order (or parallel where safe):

| Check | What it tests | Pass condition |
|-------|--------------|----------------|
| `iranti_connectivity` | HTTP GET to Iranti `/health` | Returns 200 with `{ status: "ok" }` |
| `iranti_auth` | HTTP GET to Iranti `/kb/search?query=test&limit=1` with configured API key | Returns 200 (not 401/403) |
| `db_connectivity` | `SELECT 1` against the control plane's local DB | Returns a row |
| `vector_backend` | HTTP GET probe to configured `IRANTI_VECTOR_BACKEND` URL (if qdrant/chroma) or `SELECT 1` for pgvector | Connection succeeds within 3s |
| `ingest_roundtrip` | Write a test fact (`entityType: '__diagnostics__'`, `entityId: '__probe__'`, `key: 'probe_timestamp'`) via `POST /kb/write`, read it back via `GET /kb/query`, then delete it | Write returns 200, read returns the written value |
| `attend_check` | Call `POST /memory/attend` with `{ agent: 'control_plane_operator', currentContext: 'diagnostic probe' }`. Check that it returns 200 without `classification_parse_failed_default_false` in the response | Returns 200 with a parseable result |
| `vector_search_check` | Call `GET /kb/search?query=diagnostic+probe&limit=1`. Check that `vectorScore > 0` for any result, OR fallback in-process scoring is active | Returns 200; if `vectorScore=0` for all results, flag as `warn` (not `fail`) |

Each check result shape:
```json
{
  "check": "iranti_connectivity",
  "status": "pass" | "warn" | "fail",
  "message": "Iranti v0.2.14 reachable at http://localhost:3001",
  "fixHint": null,
  "durationMs": 45
}
```

`fixHint` values (these must be copy-edited, consistent in tone — present tense, actionable):
- `iranti_connectivity` fail: `"Iranti may not be running. Run: iranti run --instance <name>"`
- `iranti_auth` fail: `"API key missing or insufficient scope. Check IRANTI_API_KEY in your .env.iranti. Required scope: kb:read, kb:write, memory:read, memory:write."`
- `vector_backend` warn: `"Vector backend unreachable. Vector search will use in-process fallback. Check IRANTI_QDRANT_URL or IRANTI_CHROMA_URL."`
- `attend_check` warn: `"Attendant classifier returned a parse failure. Memory injection may be non-functional. Known issue in Iranti < 0.2.13. Run: iranti upgrade"`

Full response shape:
```json
{
  "runAt": "2026-03-21T10:00:00.000Z",
  "overallStatus": "pass" | "warn" | "fail",
  "checks": [ CheckResult ],
  "totalDurationMs": 850
}
```

`overallStatus` = `fail` if any check is `fail`; `warn` if any is `warn` and none fail; `pass` if all pass.

**AC-2 — `GET /api/control-plane/diagnostics/last`**

Returns the result of the most recent run (in-memory cache — no persistence required at MVP). Returns 404 if no run has been performed yet in this server session.

**AC-3 — Graceful degradation**

If a check itself throws (network error mid-probe), catch the exception and mark that check as `fail` with the exception message. Never 500 the diagnostics endpoint.

**AC-4 — TypeScript clean**

No `any`, no type assertions without comment. `tsc --noEmit` passes.

#### Key Files

- `src/server/routes/control-plane/health.ts` — pattern for health check structure; diagnostics follows similar approach
- `src/server/routes/control-plane/index.ts` — registration
- `src/server/routes/control-plane/kb.ts` — for the proxy patterns used in `ingest_roundtrip` and `vector_search_check`
- `.env.iranti` — Iranti base URL, API key, vector backend config

#### Implementation Notes

- The `ingest_roundtrip` check writes a test fact with `entityType: '__diagnostics__'`. This is intentional. Document in your PR that this probe entity should be filtered out of Memory Explorer results (the frontend team will handle that, but note it).
- Cache only the last result (a single in-memory object on the module). No database or file persistence needed at MVP.
- Per-check timeouts: use `Promise.race` with a `setTimeout` rejection to enforce individual check timeouts. The `ingest_roundtrip` check should have a 5s timeout; `iranti_connectivity` and `iranti_auth` should have 3s each.

### What to Report Back When Done (both tickets)

For each ticket:
- Files modified
- Explicit AC checklist (each AC confirmed or flagged)
- `tsc --noEmit` result
- Any edge cases or deviations from the spec (document them; don't silently skip)

For CP-T059 specifically: document whether the `ingest_roundtrip` probe fact cleanup works reliably (delete after write+read), and whether the `attend_check` response structure matches what you expected from the Iranti API.

**Do not self-approve.** Report back to PM for acceptance review on each ticket separately.

---

## Agent 3: `frontend_developer` (instance: "Frontend-CP-T057-T058") — CP-T057 Frontend + CP-T058 UX Labels

### Identity and Handshake

You are the **frontend_developer** (instance: "Frontend-CP-T057-T058") for the Iranti Control Plane project.

Your first action must be to call `iranti_handshake` with `agent_id: "frontend_developer"` and task: "Implement CP-T057 frontend (WhoKnows Contributors panel in Entity Detail view) and CP-T058 UX guidance labels — M4 Provider Manager hint, M5 unreachable instance hint, H8 IRANTI_PROJECT_MODE display."

Query Iranti before making implementation decisions. Write findings and completed ACs back to Iranti when done.

**Coordination note:** The `backend_developer` is building the `GET /api/control-plane/kb/whoknows/:entityType/:entityId` endpoint needed for CP-T057. You may stub or mock that call while the backend is in progress, but confirm the endpoint is available before final integration. The response shape is documented in the ticket and in this brief.

### Ticket 1: CP-T057 Frontend — WhoKnows Contributors Panel

**Full ticket:** `docs/tickets/cp-t057.md`
**Priority:** P3

#### What You're Building

A "Contributors" panel in the Entity Detail view (`/memory/:entityType/:entityId`) that shows which agents have contributed facts to this entity, sourced from the new backend endpoint `GET /api/control-plane/kb/whoknows/:entityType/:entityId`.

#### Acceptance Criteria

**AC-4 — "Contributors" panel in Entity Detail view**

Below the entity facts section, add a "Contributors" panel. On mount, call `GET /api/control-plane/kb/whoknows/:entityType/:entityId`.

Render as a compact horizontal card row (or vertical list for narrow viewports):
- Each contributor: agent ID (bold, monospace or badge), write count (integer), last contributed (relative time, absolute on hover)
- Sort by `writeCount` descending
- If an agent from this list matches an agent in the Agent Registry (the `/agents` data from CP-T051), link the agent ID to `/agents/:agentId` — if Agent Registry is unavailable or the agent is not registered, show ID as plain text (no broken link)

**AC-5 — Empty states**
- No contributors returned: "No attributed contributors for this entity." (not an error)
- Endpoint returns 503 / unreachable: "Contributor data unavailable. Check that your Iranti API key has `memory:read` scope."
- Loading state: skeleton row (consistent with existing fact row loading)

**AC-6 — Visual consistency**
Panel must use existing Terminals palette CSS tokens. No hardcoded colors. Match the card/section styling of existing Entity Detail panels (facts, relationships, temporal history).

**AC-7 — TypeScript clean**
No `any` in new component tree. `tsc --noEmit` passes.

#### Key Files

- `src/client/src/components/memory/MemoryExplorer.tsx` or a dedicated `EntityDetail.tsx` — the Entity Detail view; find the relevant component
- Look at how existing panels (facts table, relationships) are structured and match that pattern
- For the Agent Registry link: look at how the existing `/agents` route renders agent IDs — you may be able to reuse or reference that pattern

#### Backend Response Shape (for reference/mocking)

```json
{
  "contributors": [
    {
      "agentId": "backend_developer",
      "writeCount": 14,
      "lastContributedAt": "2026-03-21T09:00:00.000Z"
    }
  ],
  "total": 3
}
```

---

### Ticket 2: CP-T058 — UX Polish: Operator Guidance Labels (M4, M5, H8)

**Full ticket:** `docs/tickets/cp-t058.md`
**Priority:** P3

#### What You're Building

Three small, independent frontend-only UX additions that close operator guidance gaps. These can be committed separately if convenient.

#### Acceptance Criteria

**AC-1 — M4: Provider Manager guidance label**

File: `src/client/src/components/providers/ProviderManager.tsx`

Add a static informational note in the view header or below the active provider/model display:

> "Provider and model configuration is read-only. To change providers or models, run `iranti setup` in your project directory."

Requirements:
- Use the `Informational` severity style from the Health Dashboard severity taxonomy (CP-T028) — blue-tinted or neutral, not warning/error
- `iranti setup` must render in inline monospace consistent with the rest of the UI
- Visible in both light and dark mode
- Not dismissible (permanent operator hint)

**AC-2 — M5: Instance unreachable remediation hint**

File: `src/client/src/components/instances/InstanceManager.tsx` (or equivalent)

When an instance status is `Unreachable`, below the "Unreachable" status badge add small muted helper text:

> "To start this instance, run `iranti run --instance <name>` in your terminal."

- Replace `<name>` with the actual instance name from the instance record
- If instance name is null/unknown: show `iranti run` without the `--instance` flag
- Render as small helper text (muted, slightly smaller font) — not a full alert panel

**AC-3 — H8: IRANTI_PROJECT_MODE in Instance Manager**

In the instance metadata display (expanded card or detail view):
- Add `IRANTI_PROJECT_MODE` as a displayed field alongside existing env-derived fields
- Label: "Project Mode"
- Value: the raw env var value (e.g., `isolated`, `shared`) or `—` if not set
- If `isolated`: tooltip or helper note: "Each project gets its own isolated memory context."
- If `shared`: "All projects share a single memory context."
- If not set: `—` with no tooltip

**First check** whether `IRANTI_PROJECT_MODE` is already included in the backend instance/health response. Look at `src/server/routes/control-plane/health.ts` and `src/server/routes/control-plane/instances.ts`. If it's already returned, this is purely a frontend display addition. If not, you'll need a small backend change — document that in your report.

**AC-4 — TypeScript clean**
`tsc --noEmit` passes with zero new errors. No `any` in new code.

**AC-5 — Visual consistency**
All new UI elements use Terminals palette CSS tokens. No hardcoded colors. Light and dark mode both visually reviewed.

### What to Report Back When Done (both tickets)

For CP-T057:
- Files modified
- Confirmation that the Contributors panel renders with real data from the backend (or description of mock/stub testing)
- AC-4 through AC-7 explicit checklist
- Whether the Agent Registry link is implemented or gracefully degraded

For CP-T058:
- Files modified
- Whether `IRANTI_PROJECT_MODE` required a backend change (and what you changed)
- AC-1 through AC-5 explicit checklist
- Screenshots or descriptions of light/dark mode appearance for each change

**Do not self-approve.** Report back to PM for acceptance review. The PM will review ACs before accepting.

---

*This dispatch document was prepared by `product_manager` on 2026-03-21 and represents the complete agent briefing for Wave 5 and Wave 6 specialist work.*
