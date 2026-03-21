# QA Test Plan — CP-T053: Memory Explorer: ConflictLog Timeline + Field Label Fixes

**Ticket:** CP-T053
**Date:** 2026-03-21
**QA Engineer:** qa_engineer
**Status:** Draft — pending implementation

## Overview

Tests two UX improvements to the Memory Explorer and Archive Explorer fact detail views: (1) the `conflictLog` field rendered as a structured conflict history timeline instead of raw JSON; and (2) the `createdBy`/`source` field label distinction, renaming "Agent" to "Written by" with a tooltip clarifying what `source` means. Also covers `stability` and `lastAccessedAt` in the expanded Memory Explorer row (AC-4). This is a pure frontend change — the API already returns `conflictLog` in the payload.

## Prerequisites

- [ ] Implementation complete in `src/client/src/components/memory/MemoryExplorer.tsx` and `src/client/src/components/memory/ArchiveExplorer.tsx`
- [ ] TypeScript compiles cleanly (`tsc --noEmit`)
- [ ] All existing tests pass (`npx vitest run`)
- [ ] Dev server running at `http://localhost:3000`
- [ ] Iranti instance running at `http://localhost:3001`
- [ ] At least one KB fact with a non-empty `conflictLog` array (see "Setting Up Test Data" below)
- [ ] At least one archived fact with a non-empty `conflictLog` array (for AC-2)
- [ ] A fact where `createdBy` (agentId) and `source` have different values (e.g., agentId = `"backend_developer"`, source = `"mcp"`)

### Setting Up Test Data

To produce a KB fact with a non-empty `conflictLog`, you need to trigger Iranti's conflict resolution path. The most reliable method:

1. Write a fact via `iranti_write` (or the MCP tool) from agent `A`:
   ```json
   { "entityType": "test", "entityId": "conflict-test", "key": "value", "value": "version 1", "confidence": 70 }
   ```
2. Write the same fact with a conflicting value from agent `B` (or same agent with different confidence):
   ```json
   { "entityType": "test", "entityId": "conflict-test", "key": "value", "value": "version 2", "confidence": 65 }
   ```
3. Check the `conflictLog` via the control plane API:
   ```bash
   curl -s "http://localhost:3000/api/control-plane/kb?entityType=test&entityId=conflict-test" | jq '.[0].conflictLog'
   ```
4. If `conflictLog` is empty, the write was not treated as a conflict (confidence delta may not have been high enough). Try writes with a larger confidence gap (70 vs 30) or consult Iranti's conflict resolution threshold configuration.

**Alternative:** If a conflict log entry already exists in the running Iranti instance from normal agent activity, use that fact's `entityType`, `entityId`, and `key` for the tests below. Run `curl -s "http://localhost:3000/api/control-plane/kb" | jq '.[] | select(.conflictLog != null and (.conflictLog | length) > 0) | {entityId, key, conflictLog}'` to find one.

---

## Test Cases

### TC-1 — ConflictLog timeline rendered in Memory Explorer expanded row (AC-1)

**AC:** AC-1 — If `conflictLog` has entries, render "Conflict History" section; do not show raw JSON

**Test steps:**
1. Navigate to `http://localhost:3000/memory` (Memory Explorer).
2. Locate the fact with a non-empty `conflictLog` (search by entityId "conflict-test" or the known entity).
3. Click the fact row to expand it (or click the expand/chevron control).
4. Scroll to the bottom of the expanded row content.
5. Verify whether a "Conflict History" section is present.
6. For each conflict event in the section:
   a. Confirm timestamp is shown in relative form (e.g., "3 minutes ago" or "2 days ago").
   b. Hover over the relative timestamp and confirm the absolute ISO timestamp appears in a tooltip.
   c. Confirm the event type badge is present (e.g., `CONFLICT_REJECTED`, `CONFLICT_ESCALATED`, `CONFLICT_RESOLVED`, or `IDEMPOTENT_SKIP`).
   d. Confirm reason text is shown below or next to the badge.
   e. Confirm "Used LLM: Yes" or "Used LLM: No" indicator is present.
7. If `existingScore` and `incomingScore` are present in the conflict event, confirm they appear as "Existing: N vs. Incoming: N".
8. If `incomingSource` is present, confirm it appears in the event row.

**Expected result:**
- "Conflict History" section is visible with one entry per `conflictLog` array element.
- No raw JSON representation of `conflictLog` is present (no `[{"type":"..."}]` text anywhere in the expanded row).
- Timestamps show as relative time with absolute on hover.
- All fields from the conflict event object are rendered as structured UI elements, not as JSON.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-2 — ConflictLog timeline: empty log produces no conflict section (AC-1)

**AC:** AC-1 — If `conflictLog` is empty or null, do not render conflict section

**Test steps:**
1. In the Memory Explorer, find a fact where `conflictLog` is `[]` or `null`:
   ```bash
   curl -s "http://localhost:3000/api/control-plane/kb" | jq '.[] | select(.conflictLog == null or (.conflictLog | length) == 0) | {entityId, key} | first'
   ```
2. Click the row to expand it.
3. Inspect the expanded row content.

**Expected result:**
- No "Conflict History" section or "Conflict Log" label appears.
- The expanded row shows the standard fields (Value, Confidence, Source, Written by, etc.) with no conflict section.
- No empty section placeholder like "No conflicts" is shown (the section is simply absent).

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-3 — ConflictLog timeline in Archive Explorer expanded row (AC-2)

**AC:** AC-2 — Same rendering as AC-1 in Archive Explorer

**Test steps:**
1. Navigate to `http://localhost:3000/archive` (Archive Explorer) or equivalent route.
2. Find an archived fact with a non-empty `conflictLog`. If none exist, create one:
   - Write a fact → trigger a conflict → let the lower-confidence version get archived (or use the Archivist to archive manually).
   - Alternatively, run `curl -s "http://localhost:3000/api/control-plane/archive" | jq '.[] | select(.conflictLog != null and (.conflictLog | length) > 0) | {entityId, key} | first'`.
3. Click the archived fact row to expand it.
4. Verify the same "Conflict History" rendering as TC-1.

**Expected result:**
- Archive Explorer shows identical "Conflict History" rendering to the Memory Explorer.
- Same relative timestamp, event type badge (color-coded), reason, Used LLM indicator, score comparison, and incomingSource behavior.
- The section is absent for archived facts with empty `conflictLog`.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-4 — Event type badges are color-coded correctly (AC-1)

**AC:** AC-1 — `CONFLICT_ESCALATED` → amber, `CONFLICT_REJECTED` → red, `CONFLICT_RESOLVED` → green, `IDEMPOTENT_SKIP` → grey

**Test steps:**

For each badge type, you need a conflict event of that type in the KB or Archive. If all four are not present in the running instance, check the Staff Logs view for `conflict.*` action types to find which events have occurred, then find the corresponding facts.

For each badge type that exists in the data:
1. Expand the fact row containing that event type.
2. Inspect the badge element (browser DevTools → Elements or computed styles).
3. Confirm the badge color:
   - `CONFLICT_ESCALATED`: amber / orange background or amber text
   - `CONFLICT_REJECTED`: red background or red text
   - `CONFLICT_RESOLVED`: green background or green text
   - `IDEMPOTENT_SKIP`: grey / neutral background or grey text
4. Confirm the badge label shows the event type string (e.g., "ESCALATED", "REJECTED", "RESOLVED", "IDEMPOTENT SKIP" — exact label format to be confirmed from implementation).

**Expected result:**
- Each event type uses its designated color consistently.
- Badge labels are human-readable (no raw `CONFLICT_` prefix required — implementation may shorten to "Escalated", "Rejected", etc.).
- Color is applied to the badge only, not to the entire event row.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-5 — "Written by" label replaces "Agent" (AC-3)

**AC:** AC-3 — Rename "Agent" label to "Written by" (maps to `createdBy`/`agentId`)

**Test steps:**
1. Navigate to the Memory Explorer.
2. Find any fact that has a non-null `agentId` (most facts should have one).
3. Both in the collapsed row summary and the expanded detail:
   a. Confirm the label "Written by" appears (not "Agent" or "Created by" or "agentId").
   b. Confirm the value is the `agentId` string (e.g., `"product_manager"`, `"backend_developer"`).
4. Repeat in the Archive Explorer for an archived fact.

**Expected result:**
- "Agent" label is gone from both the Memory Explorer and Archive Explorer row views.
- "Written by" label is present in both collapsed and expanded states.
- The value maps to `createdBy`/`agentId`, not to `source`.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-6 — "Source" label shows with clarifying tooltip (AC-3)

**AC:** AC-3 — "Source" label retained but with tooltip: "Caller-supplied provenance label (e.g. 'mcp', 'git', 'manual')"

**Test steps:**
1. Navigate to the Memory Explorer.
2. Find a fact where `source` is a non-null string (e.g., `"mcp"`, `"git"`, `"manual"`).
3. In the expanded fact detail:
   a. Confirm the "Source" label is present.
   b. Hover over the "Source" label (or an info icon adjacent to it).
   c. Confirm a tooltip appears containing the text: "Caller-supplied provenance label (e.g. 'mcp', 'git', 'manual')" (or equivalent clarifying language).
4. Confirm the "Source" value shown matches `source` (e.g., "mcp") and NOT `agentId`.

**Expected result:**
- "Source" label present in expanded row.
- Tooltip or description explains the distinction from `createdBy`.
- `source` and `agentId`/`createdBy` show different values when they differ (e.g., source = "mcp", Written by = "backend_developer").

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-7 — Both "Written by" and "Source" shown even when identical (AC-3)

**AC:** AC-3 — If both are identical strings, show both — do not collapse them

**Test steps:**
1. Find (or create) a fact where `source` and `agentId` are the same string (e.g., both `"backend_developer"`).
   - Check with: `curl -s "http://localhost:3000/api/control-plane/kb" | jq '.[] | select(.source == .agentId and .source != null) | {entityId, key, source, agentId} | first'`
2. Expand that fact row.
3. Confirm both "Written by: backend_developer" and "Source: backend_developer" are displayed as separate rows.

**Expected result:**
- Both rows present even when values are identical.
- No deduplication or collapsing of the two fields.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-8 — `stability` field shown in expanded Memory Explorer row (AC-4)

**AC:** AC-4 — Add `stability` (Float, days) to expanded fact detail in MemoryExplorer only

**Test steps:**
1. Navigate to the Memory Explorer.
2. Find a fact where `stability` is a non-null float. This field may be populated by the Archivist if decay has been run.
   - Check: `curl -s "http://localhost:3000/api/control-plane/kb" | jq '.[] | select(.stability != null) | {entityId, key, stability} | first'`
3. Expand the fact row.
4. Locate the "Stability" field in the expanded detail.
5. Verify the value matches the API value (e.g., if API returns `stability: 45.0`, the UI shows "Stability: 45 days" or "45.0 days").

**Expected result:**
- "Stability: N days" is shown in the expanded row when `stability` is non-null.
- The value is formatted as a number with "days" unit.
- When `stability` is `null`, the field is absent (not shown as "Stability: null" or "Stability: —").

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-9 — `lastAccessedAt` field shown in expanded Memory Explorer row (AC-4)

**AC:** AC-4 — Add `lastAccessedAt` to expanded fact detail in MemoryExplorer only

**Test steps:**
1. Navigate to the Memory Explorer.
2. Find a fact where `lastAccessedAt` is a non-null timestamp.
   - Check: `curl -s "http://localhost:3000/api/control-plane/kb" | jq '.[] | select(.lastAccessedAt != null) | {entityId, key, lastAccessedAt} | first'`
3. Expand the fact row.
4. Locate the "Last Accessed" field in the expanded detail.
5. Verify it shows a relative time (e.g., "2 days ago") with the absolute timestamp on hover.

**Expected result:**
- "Last Accessed: [relative time]" shown when `lastAccessedAt` is non-null.
- Relative time formatting matches the existing pattern used for other timestamps in the product.
- When `lastAccessedAt` is `null`, the field is absent entirely.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-10 — `stability` and `lastAccessedAt` NOT shown in Archive Explorer (AC-4)

**AC:** AC-4 — Scope is MemoryExplorer only; Archive model does not have these fields

**Test steps:**
1. Navigate to the Archive Explorer.
2. Expand any archived fact row.
3. Inspect the expanded detail fields.

**Expected result:**
- "Stability" label is absent from the Archive Explorer expanded row.
- "Last Accessed" label is absent from the Archive Explorer expanded row.
- No "undefined", "null", or empty row is rendered in place of these fields.
- All other Archive Explorer fields are unaffected.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-11 — Raw JSON expand for `conflictLog` is removed (AC-5)

**AC:** AC-5 — The raw JSON expand for `conflictLog` specifically can be removed; `properties` and `metadata` retain their raw expand

**Test steps:**
1. Navigate to the Memory Explorer.
2. Find a fact with a non-empty `conflictLog` AND non-null `properties`.
3. Expand the fact row.
4. Inspect all expandable sections in the expanded row:
   a. Confirm there is NO "conflictLog" expandable section showing raw JSON (like `[{"type":"CONFLICT_REJECTED",...}]`).
   b. Confirm there IS a "Properties" expandable section showing the `properties` object as raw JSON.
   c. If the fact has `metadata`, confirm there IS a "Metadata" expandable section showing raw JSON.
5. Click expand on the "Properties" section — confirm it reveals the raw JSON content.

**Expected result:**
- `conflictLog` raw JSON expand is absent from the expanded row.
- `properties` and `metadata` raw JSON expands are still present and functional.
- No regression on any other expandable section.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

## Edge Cases

1. **ConflictLog with only partial fields** — A conflict event may be missing optional fields like `existingScore`, `incomingScore`, or `incomingSource`. Confirm the UI renders gracefully when these are undefined/null (omit those sub-rows rather than showing "Existing: null" or "Incoming: undefined").

2. **ConflictLog with many entries (10+)** — A frequently-contested fact might have 10 or more conflict events. The "Conflict History" section must remain readable: either render all entries in a scrollable list, or paginate. Confirm the expanded row does not overflow the viewport or push other content off-screen.

3. **Fact where `agentId` is null** — Some facts may have been written with no authenticated agent (legacy data). "Written by" should render as "—" or similar null indicator, not as "null" or an empty string.

4. **Fact where `source` is null** — Similarly, if `source` is null, the "Source" row should either show a null indicator or be omitted entirely. Neither case should cause a React error.

5. **`conflictLog` parsed as object instead of array** — The control plane server serializes `conflictLog` as `Record<string, unknown> | null` in `types.ts` (per implementation note in ticket). The frontend must parse this as `ConflictEntry[]`. If the API returns a plain object `{}` instead of an array `[]`, the frontend should handle it gracefully (no crash, show no conflict entries or show an error state within the section).

---

## Regression Checks

1. **Existing Memory Explorer columns unchanged** — The fact list table columns (Entity Type, Entity ID, Key, Value Summary, Confidence, etc.) must be unchanged. Confirm no columns were accidentally removed or reordered.

2. **Fact detail fields not affected by label rename** — The rename of "Agent" to "Written by" must not affect any other label in the product. Check Staff Logs view, Archive Explorer, and the Providers view for any "Agent" labels that were correct as-is and must not be changed.

3. **Archive Explorer expanded row unchanged except for conflict timeline** — The Archive Explorer row expansion previously showed `conflictLog` as raw JSON (or nothing). After this change, it should show the timeline (when non-empty) and no raw JSON for `conflictLog`. All other Archive Explorer fields must be unaffected: `archivedReason`, `supersededBy`, `resolutionState`, `validFrom`, `validUntil`, `archivedAt`.

4. **Properties raw expand still works for large objects** — The `properties` section in both Memory Explorer and Archive Explorer should still expand to reveal arbitrary-depth JSON. Confirm with a fact that has a nested `properties` object (multiple levels deep).

5. **TypeScript type safety for ConflictEntry** — Run `tsc --noEmit` and confirm no type errors are introduced by the `ConflictEntry[]` cast from `Record<string, unknown> | null`. The cast is in the frontend component, not the server types — confirm the frontend defines a proper `ConflictEntry` interface.

---

## Known Limitations / Deferred

- **Creating conflict log test data is not trivial** — Requires Iranti's conflict resolution path to fire, which depends on write API configuration, confidence thresholds, and timing. If a pre-existing fact with `conflictLog` data is not available, some test cases (TC-1, TC-3, TC-4) may be blocked during initial testing. The QA engineer should document this as a blocker and request the backend_developer to seed test data.
- **`stability` and `lastAccessedAt` fields may not be populated** if the Archivist decay process has never run on the Iranti instance. TC-8 and TC-9 may be blocked pending Archivist activity. In that case, test with the raw API response from `http://localhost:3000/api/control-plane/kb` and note whether these fields are returned at all.
- **`incomingValue` field** — The `ConflictEntry` type includes `incomingValue?: string`. The ticket's AC-1 does not explicitly specify how to render this field. Implementation may choose to show it (e.g., "Incoming value: ...") or omit it. Document the actual behavior observed and flag to PM if it was omitted but is needed for operator diagnostics.
