# Phase 2 Test Plan

**Plan ID**: QA-TP-002
**Author**: qa_engineer
**Date**: 2026-03-20
**Status**: Draft — ready for execution once Phase 2 tickets are implemented
**Prerequisites**: CP-D001 (camelCase SQL mismatch) must be resolved before any Phase 2 data-bearing tests can run

---

## 1. Scope

This plan covers QA verification for the following Phase 2 tickets:

| Ticket | Title | Priority |
|--------|-------|----------|
| CP-T036 | Entity Detail and Temporal History Views (Phase 1 gap, P0) | P0 |
| CP-T037 | Staff Activity Stream Live Mode UX | P1 |
| CP-T033 | Integration Repair Actions UI | P1 |
| CP-T035 | Getting Started Screen and First-Run Onboarding Flow | P1 |
| CP-T025 | Native Staff Emitter Injection (stream coverage test) | P1 |

**Out of scope**: CP-T032 (Entity Relationship Graph — depends on CP-T036), CP-T034 (Provider Quota — requires live provider API access).

---

## 2. Blocking Prerequisite: CP-D001

**All test sections in this plan are blocked until CP-D001 is resolved.**

CP-D001: The backend routes in `src/server/routes/control-plane/kb.ts` use `snake_case` column references in SQL (e.g., `ORDER BY created_at DESC`, `entity_type`, `summary`, `value_raw`). The Iranti database uses camelCase column names throughout (`"createdAt"`, `"entityType"`, `"valueSummary"`, `"valueRaw"`). All routes except `/health` and `/instances` currently return `{"error":"column \"..\" does not exist","code":"42703"}`.

**Required fix**: All SQL in `kb.ts` must use quoted camelCase column names. The `serializeKBRow` and `serializeArchiveRow` functions that read `row.summary` must be updated to read `row.valueSummary`. The ILIKE search clauses must use `"entityId"`, `"valueSummary"`, `"valueRaw"`.

**Additional prerequisite**: The `staff_events` table must be created (CP-T001 migration applied) before any Staff Activity Stream tests run.

---

## 3. CP-T036 — Entity Detail and Temporal History Views

**Ticket**: CP-T036 (Phase 1 gap, Phase 2 P0)
**Base URL**: `http://localhost:3002/api/control-plane`
**Frontend routes**: `/memory/:entityType/:entityId` and `/memory/:entityType/:entityId/:key`

### 3.1 Seed Data Requirements

Before running CP-T036 tests, ensure the following data exists in the database:

| Fixture | Description | How to create |
|---------|-------------|---------------|
| `agent/test_agent_001` | Entity with at least 3 current KB facts | Use `iranti_write` or direct SQL insert |
| `agent/test_agent_001/current_assignment` | Key with at least 2 archived intervals (superseded, expired) | Direct SQL insert into archive |
| `agent/test_agent_001` relationships | At least 1 relationship to another entity | Direct SQL insert into `EntityRelationship` |
| Large value entity | One KB fact with `valueRaw` > 4096 bytes | Direct SQL insert with padded JSON |
| `test/temporal_history_check` | Already seeded by CP-T030 seed test | See CP-T030 execution log |

### 3.2 Backend: Entity Detail Endpoint Tests

`GET /api/control-plane/entities/:entityType/:entityId`

| ID | Name | Input | Expected | Pass/Fail | Actual |
|----|------|-------|----------|-----------|--------|
| ED-001 | Happy path — entity with data | `GET /entities/agent/test_agent_001` | 200, `entity: null` (Phase 1), `currentFacts` array non-empty, `archivedFacts` array, `relationships` array | — | — |
| ED-002 | `entity` field is always null | Any entity | `body.entity === null` | — | — |
| ED-003 | 404 — entity with no data | `GET /entities/__fake__/__fake__` | 404, `code: NOT_FOUND` | — | — |
| ED-004 | currentFacts are camelCase | Any entity with data | `entityType`, `entityId`, `agentId`, `validFrom`, `createdAt` — no snake_case keys | — | — |
| ED-005 | archivedFacts have archivedAt | `GET /entities/agent/test_agent_001` | Each archived fact has `archivedAt` as ISO 8601 string | — | — |
| ED-006 | includeArchived=false | `?includeArchived=false` | `archivedFacts: []` | — | — |
| ED-007 | includeRelationships=false | `?includeRelationships=false` | `relationships: []` | — | — |
| ED-008 | relationships have correct shape | Any entity with relationships | Each item has `fromEntityType`, `fromEntityId`, `toEntityType`, `toEntityId`, `relationshipType` | — | — |

### 3.3 Backend: Temporal History Endpoint Tests (CP-T030 re-verification)

`GET /api/control-plane/entities/:entityType/:entityId/history/:key`

| ID | Name | Input | Expected | Pass/Fail | Actual |
|----|------|-------|----------|-----------|--------|
| HI-001 | Happy path — key with 2 archived intervals | `GET /entities/test/temporal_history_check/history/test_value` | 200, `current` object non-null, `history` array with 2 items, `hasHistory: true` | — | — |
| HI-002 | 404 — no history for key | `GET /entities/__fake__/__fake__/history/__fake_key__` | 404, `code: NOT_FOUND` | — | — |
| HI-003 | Response shape — current fact | `GET /entities/test/temporal_history_check/history/test_value` | `current` has `valueRaw: '"version 2"'`, `confidence: 80`, `providerSource: 'qa_seed_test'` | — | — |
| HI-004 | archivedReason labels — superseded | First history interval | `archivedReason === 'Superseded by newer write'` (not raw `'superseded'`) | — | — |
| HI-005 | archivedReason labels — expired | Second history interval | `archivedReason === 'Expired (validUntil passed)'` (not raw `'expired'`) | — | — |
| HI-006 | No raw archivedReason codes reach frontend | All history intervals | None of `['superseded','contradicted','expired','decayed']` appear as-is in `archivedReason` fields | — | — |
| HI-007 | Intervals ordered validFrom DESC | `GET /entities/test/temporal_history_check/history/test_value` | `history[0].validFrom > history[1].validFrom` | — | — |
| HI-008 | hasHistory: false — key with no archive | Any KB fact with no archive entries | `hasHistory: false`, `history: []` | — | — |
| HI-009 | Full valueRaw returned — no truncation | Any history interval | `valueRaw` is complete (no `valueRawTruncated` field on history intervals) | — | — |
| HI-010 | providerSource field present | Any interval | `providerSource` present, not `source` | — | — |
| HI-011 | hasHistory is consistent with history length | Any response | `hasHistory === (history.length > 0)` | — | — |
| HI-012 | archivedAt null for current fact | current object | `current` object has no `archivedAt` field | — | — |
| HI-013 | archivedAt set for archive intervals | Each history interval | `interval.archivedAt` is ISO 8601 string, not null | — | — |

### 3.4 Frontend: Entity Detail View (`/memory/:entityType/:entityId`)

| ID | Name | Action | Expected | Pass/Fail | Notes |
|----|------|--------|----------|-----------|-------|
| FE-ED-001 | Page loads without error | Navigate to `/memory/agent/test_agent_001` | Page renders entity header, current facts table, no blank screen | — | — |
| FE-ED-002 | Placeholder is replaced | Navigate to `/memory/agent/test_agent_001` | NO "Entity Detail — coming soon" placeholder visible | — | — |
| FE-ED-003 | Entity header shows type, ID, fact count | Page load | Header shows `entityType: agent`, `entityId: test_agent_001`, fact count integer | — | — |
| FE-ED-004 | Current facts table renders | Page load with data | Table/list showing key, valueSummary, confidence, source, agentId, validFrom | — | — |
| FE-ED-005 | Archived facts shown (table or tab) | Page load with archived data | Archived facts section shows `archivedAt`, `archivedReason` in human-readable form | — | — |
| FE-ED-006 | Relationships list renders | Entity with relationships | Relationships section shows linked entities with `relationshipType` | — | — |
| FE-ED-007 | Clicking a key navigates to history | Click a fact's key | URL changes to `/memory/agent/test_agent_001/{key}` | — | — |
| FE-ED-008 | Back breadcrumb returns to Memory Explorer | Click back breadcrumb | Returns to `/memory` with prior filters preserved | — | — |
| FE-ED-009 | Loading state shown | Slow network (throttle to Slow 3G) | Spinner or skeleton visible before data loads | — | — |
| FE-ED-010 | Error state shown | Navigate to nonexistent entity | Error message shown, not blank screen | — | — |
| FE-ED-011 | Dark mode renders correctly | Toggle to dark mode | No white flash, text legible, table uses dark background | — | — |
| FE-ED-012 | Light mode renders correctly | Default (light) | Cards, tables, text all use correct light palette | — | — |

### 3.5 Frontend: Temporal History View (`/memory/:entityType/:entityId/:key`)

| ID | Name | Action | Expected | Pass/Fail | Notes |
|----|------|--------|----------|-----------|-------|
| FE-TH-001 | Page loads without error | Navigate to `/memory/test/temporal_history_check/test_value` | Timeline renders, no blank screen | — | — |
| FE-TH-002 | Placeholder is replaced | Navigate to history route | NO "Temporal History — coming soon" placeholder visible | — | — |
| FE-TH-003 | Header shows entity+key | Page load | Breadcrumb/header shows `test/temporal_history_check/test_value` | — | — |
| FE-TH-004 | Current fact shown with badge | Page load | Most recent interval has a "Current" or "Live" badge | — | — |
| FE-TH-005 | Archive intervals shown, newest first | Page load with 2 archive entries | 3 intervals total (1 current + 2 archived), ordered newest validFrom first | — | — |
| FE-TH-006 | archivedReason shows human-readable labels | Archive intervals | Shows "Superseded by newer write" and "Expired (validUntil passed)" — not raw codes | — | — |
| FE-TH-007 | Clicking interval expands raw JSON | Click on a history interval | `valueRaw` shown in monospace code block | — | — |
| FE-TH-008 | Empty state for key with no history | Navigate to history for key with only current fact | "No history — this fact has not been superseded or archived" message shown | — | — |
| FE-TH-009 | Back breadcrumb goes to entity detail | Click back breadcrumb | Returns to `/memory/test/temporal_history_check` | — | — |
| FE-TH-010 | Error state shown | Navigate to nonexistent entity/key | Error message with link to Health | — | — |
| FE-TH-011 | Loading spinner shown | Slow network | Spinner visible before timeline loads | — | — |
| FE-TH-012 | Dark mode correct | Toggle dark mode | Timeline intervals readable on dark background, no white flash | — | — |
| FE-TH-013 | Light mode correct | Default | All elements use light palette correctly | — | — |

### 3.6 CP-T036 Acceptance Criteria Checklist

| AC | Requirement | Test cases | Pass/Fail |
|----|-------------|------------|-----------|
| AC-1 | `/memory/:entityType/:entityId` renders full entity detail | FE-ED-001 through FE-ED-008 | — |
| AC-2 | `/memory/:entityType/:entityId/:key` renders temporal history timeline | FE-TH-001 through FE-TH-009 | — |
| AC-3 | Both views handle loading, error, and empty states | FE-ED-009, FE-ED-010, FE-TH-008, FE-TH-010, FE-TH-011 | — |
| AC-4 | Navigation from Memory Explorer row buttons works correctly | FE-ED-007, cross-reference with ME-16/ME-20 in QA-UI-001 | — |
| AC-5 | Back breadcrumb returns to Memory Explorer correctly | FE-ED-008, FE-TH-009 | — |
| AC-6 | Both views match Terminals visual palette | FE-ED-011, FE-ED-012, FE-TH-012, FE-TH-013 | — |
| AC-7 | TypeScript compiles without errors | Run `cd src/client && npx tsc --noEmit` | — |
| AC-8 | archivedReason labels human-readable (end-to-end) | HI-004, HI-005, HI-006, FE-TH-006 | — |
| AC-9 | hasHistory: false shows correct empty state | HI-008, FE-TH-008 | — |

---

## 4. CP-T037 — Staff Activity Stream Live Mode UX

**Ticket**: CP-T037
**Prerequisite**: Phase 1 Staff Activity Stream implementation must be complete, SSE stream must deliver events.
**Note**: Many tests can be executed against Phase 1 polling events (Librarian + Archivist). Full stream coverage test (CP-T025) is a separate section below.

### 4.1 Seed Data Requirements

- CP-T001 migration applied (staff_events table must exist)
- At least one active Iranti instance writing KB facts during the test session

### 4.2 Activity Pulse Indicator Tests

| ID | Name | Setup | Expected | Pass/Fail | Notes |
|----|------|-------|----------|-----------|-------|
| AP-001 | Pulse dot visible in stream header | Navigate to Staff Activity | Animated dot present in stream header | — | — |
| AP-002 | Pulse animates faster with rapid events | Trigger 5 KB writes in 10 seconds | Pulse animation speed increases ("hot" state) | — | — |
| AP-003 | Pulse dims after 5 seconds of no events | Wait 5+ seconds with no new events | Dot dims to neutral/idle color | — | — |
| AP-004 | Pulse turns error color on SSE disconnect | Stop the CP server, wait 2 seconds | Pulse dot turns red/error color | — | — |
| AP-005 | Pulse recovers to active on reconnect | Restart CP server after AP-004 | Dot returns to active/idle color as events resume | — | — |
| AP-006 | Pulse animation uses CSS keyframes — no JS-driven animation | Inspect DevTools > Animations | Pulse uses `@keyframes`, `animation-duration` driven by CSS custom property, not JS setInterval | — | — |

### 4.3 Event Velocity Counter Tests

| ID | Name | Setup | Expected | Pass/Fail | Notes |
|----|------|-------|----------|-----------|-------|
| EV-001 | Counter visible in stream header | Navigate to Staff Activity | Counter element rendered near pulse indicator | — | — |
| EV-002 | Counter shows "No activity" at start | Fresh page load with no recent events | Display reads "No activity" or "0 events/min" | — | — |
| EV-003 | Counter increments on events | Trigger 3 KB writes | Counter updates to reflect ~3 events/min within 5 seconds | — | — |
| EV-004 | Counter uses 60-second rolling window | Trigger 6 events then wait 61 seconds | Counter resets toward 0 as events fall outside window | — | — |
| EV-005 | Tooltip describes counter meaning | Hover over the counter | Tooltip: "Events from Staff in the last 60 seconds" or equivalent | — | — |
| EV-006 | Counter resets to zero after 60 seconds of no events | Wait 60+ seconds with no activity | Counter shows "No activity" or "0 events/min" | — | — |

### 4.4 Auto-Scroll with Hover Pause Tests

| ID | Name | Setup | Expected | Pass/Fail | Notes |
|----|------|-------|----------|-----------|-------|
| AS-001 | Live mode: new events appear at expected position | In live mode, trigger a KB write | New event appears at top of list (or bottom if oldest-first — document which) within 3 seconds | — | — |
| AS-002 | Hover pauses DOM injection | Hover mouse over event list, trigger a KB write | New event NOT injected into DOM while hovering | — | — |
| AS-003 | "N new events" banner shown while hovering | Hover, trigger 2 KB writes | Banner shows "2 new events — click to resume" (or equivalent) | — | — |
| AS-004 | Banner count increments for each new event | Hover, trigger 3 sequential KB writes | Banner count increments 1 → 2 → 3 | — | — |
| AS-005 | Mouse leave flushes buffered events | After AS-003 setup, move mouse off event list | All buffered events appear in DOM; banner dismisses | — | — |
| AS-006 | Click banner also flushes events | After AS-003 setup, click the banner | Same as AS-005 | — | — |
| AS-007 | Hover-pause does not conflict with row click | Hover over list, then click an event row to expand | Event row expands correctly; hover-pause does not prevent click interaction | — | — |
| AS-008 | Buffer respects MAX_PAUSE_BUFFER (1000) | Accumulate 1001 events while hovering (stress test) | Buffer caps at 1000; 1001st event drops or replaces oldest in buffer | — | — |

### 4.5 Live Mode / Paused Badge Tests

| ID | Name | Setup | Expected | Pass/Fail | Notes |
|----|------|-------|----------|-----------|-------|
| LM-001 | "LIVE" badge visible in stream header during live mode | Navigate to Staff Activity (default) | "LIVE" badge shown, green-tinted, with pulse dot | — | — |
| LM-002 | Badge uses accent primary color | Inspect DevTools | Badge uses `var(--color-accent-primary)` | — | — |
| LM-003 | Manual pause changes badge to "PAUSED" | Click the pause button | Badge changes to "PAUSED" with neutral color; "Resume live" button appears | — | — |
| LM-004 | "Resume live" button returns to LIVE badge | After LM-003, click "Resume live" | Badge returns to "LIVE" | — | — |
| LM-005 | Existing manual pause/resume toggle still works | Click pause button, trigger events, click resume | Pause buffers events; resume flushes them | — | — |
| LM-006 | "Watching [agent]" header shown when agentId filter active (stretch) | Set agentId filter to `product_manager` | Header shows "Watching product_manager — N events in this session" | — | — |

### 4.6 Visual Design Tests

| ID | Name | Expected | Pass/Fail | Notes |
|----|------|----------|-----------|-------|
| VD-001 | Light mode: pulse dot and counter readable | Dot and counter visible against light background | — | — |
| VD-002 | Dark mode: pulse dot and counter readable | Dot and counter visible against dark background | — | — |
| VD-003 | LIVE badge uses Terminals palette — green accent | Badge color is `var(--color-accent-primary)` (emerald) | — | — |
| VD-004 | PAUSED badge uses neutral palette | Badge is visually distinct from LIVE — neutral/grey color | — | — |
| VD-005 | Banner for buffered events is clearly visible but not blocking | "N new events" banner positioned above event list, does not cover events | — | — |

### 4.7 CP-T037 Acceptance Criteria Checklist

| AC | Requirement | Test cases | Pass/Fail |
|----|-------------|------------|-----------|
| AC-1 | Activity pulse dot with correct state transitions | AP-001 through AP-005 | — |
| AC-2 | Event velocity counter, rolling 60-sec window, "No activity" zero state | EV-001 through EV-006 | — |
| AC-3 | Hover pauses DOM injection; mouse leave flushes | AS-002 through AS-006 | — |
| AC-4 | Hover-pause does not conflict with row expand | AS-007 | — |
| AC-5 | LIVE/PAUSED badge with visual clarity | LM-001 through LM-005 | — |
| AC-6 | All elements match Terminals palette | VD-001 through VD-005 | — |
| AC-7 | TypeScript compiles without errors | `cd src/client && npx tsc --noEmit` | — |
| AC-8 | Both light and dark mode correct | VD-001, VD-002 | — |

---

## 5. CP-T033 — Integration Repair Actions UI

**Ticket**: CP-T033
**Backend routes**: `POST /api/control-plane/instances/:instanceId/projects/:projectId/repair/mcp-json`, `POST .../repair/claude-md`, `POST /api/control-plane/instances/:instanceId/doctor`
**Prerequisites**: A configured project binding must exist; the backend must have filesystem write access to that project directory.

### 5.1 Seed Data / Environment Requirements

- At least one instance discoverable by the CP server (fix instance discovery or configure manually)
- A bound project directory with writable filesystem permissions
- A project directory where `.mcp.json` is either absent or malformed (to trigger the repair condition)
- A `CLAUDE.md` file in a project directory where the Iranti integration block is absent or outdated

### 5.2 Repair Action — Regenerate `.mcp.json`

| ID | Name | Setup | Expected | Pass/Fail | Notes |
|----|------|-------|----------|-----------|-------|
| RA-001 | Repair button visible when .mcp.json missing | Navigate to Instance Manager, project row with missing .mcp.json | "Repair" or "Regenerate" button visible next to the status row | — | — |
| RA-002 | Confirmation modal shown before write | Click Repair button | Modal appears showing: project directory path, file content preview, confirmation button | — | — |
| RA-003 | Cancel aborts the repair | Click Cancel in modal | No file write occurs; modal closes; status unchanged | — | — |
| RA-004 | Confirming triggers POST endpoint | Click Confirm in modal | `POST /api/control-plane/instances/:instanceId/projects/:projectId/repair/mcp-json` called | — | — |
| RA-005 | .mcp.json file created at project root | After confirmation | `.mcp.json` exists at the project root directory | — | — |
| RA-006 | Generated .mcp.json has correct instance config | Read the generated file | File contains correct DB host, port, runtime root from current instance configuration | — | — |
| RA-007 | Success confirmation with file path shown | After write | UI shows "Repaired: `.mcp.json` created at [path]" | — | — |
| RA-008 | Instance Manager status updates after repair | After RA-007 | `.mcp.json` integration status changes from missing to present | — | — |
| RA-009 | Audit log entry written | After repair | `staff_events` (or audit log table) has entry with `agentId: control_plane_repair`, `source: control_plane` | — | — |
| RA-010 | Permission error surfaces correctly | Test against a write-protected directory | Error response with permission problem and suggested OS fix; no unhandled 500 | — | — |
| RA-011 | `?confirm=true` required on endpoint | `POST .../repair/mcp-json` without `?confirm=true` | 400 error or ignored, not a write | — | — |
| RA-012 | `revertable: false` warning in response | Read success response | Response includes `revertable: false` field | — | — |

### 5.3 Repair Action — Regenerate `CLAUDE.md` Integration Block

| ID | Name | Setup | Expected | Pass/Fail | Notes |
|----|------|-------|----------|-----------|-------|
| CM-001 | "Update" button visible when CLAUDE.md block missing/outdated | Project row with missing Iranti block | "Update" button visible | — | — |
| CM-002 | Confirmation modal shows diff | Click Update | Modal shows: what block will be replaced/inserted, what content will be written | — | — |
| CM-003 | User content above Iranti block preserved | CLAUDE.md with user content before Iranti block | After write, content before the Iranti block is unchanged | — | — |
| CM-004 | User content below Iranti block preserved | CLAUDE.md with user content after Iranti block | After write, content after the Iranti block is unchanged | — | — |
| CM-005 | Audit log entry written | After write | Audit entry with `agentId: control_plane_repair` | — | — |
| CM-006 | Delimiter detection failure surfaces safely | CLAUDE.md where Iranti block delimiters have been removed by user | Endpoint returns structured error (not 500); no write occurs | — | — |

### 5.4 Repair Action — Run Instance Doctor

| ID | Name | Setup | Expected | Pass/Fail | Notes |
|----|------|-------|----------|-----------|-------|
| DR-001 | "Run Doctor" button present on each instance row | Instance Manager with >= 1 instance | Button visible per instance | — | — |
| DR-002 | Doctor results panel opens as drawer | Click "Run Doctor" | Right-side drawer opens with check results | — | — |
| DR-003 | All checks shown as rows | Doctor results | Each check: pass/fail icon, plain-English description | — | — |
| DR-004 | Failed check shows suggested fix | Doctor result with at least one failed check | Failed check has one-line remediation text | — | — |
| DR-005 | Repair button inline for checks with registered repair action | Failed check that has a repair action (e.g., .mcp.json) | Repair button available inline in the Doctor Results row | — | — |
| DR-006 | Doctor endpoint does NOT run live shell commands | Inspect response | Doctor endpoint returns structured diagnostic data; no shell process spawned | — | — |
| DR-007 | Doctor response shape correct | Any instance | Response has `checks` array, each with `name`, `status`, `message`, `suggestedFix` | — | — |

### 5.5 CP-T033 Acceptance Criteria Checklist

| AC | Requirement | Test cases | Pass/Fail |
|----|-------------|------------|-----------|
| AC-1 | Regenerate `.mcp.json` repair action available where condition met | RA-001 | — |
| AC-2 | Confirmation modal before write | RA-002, RA-003 | — |
| AC-3 | `.mcp.json` correctly generated after confirmation | RA-004, RA-005, RA-006 | — |
| AC-4 | `CLAUDE.md` write preserves user content | CM-003, CM-004 | — |
| AC-5 | Doctor button triggers doctor endpoint, renders results in drawer | DR-001 through DR-004 | — |
| AC-6 | Repair buttons available inline in Doctor Results | DR-005 | — |
| AC-7 | All repair actions require explicit confirmation | RA-002, CM-002 | — |
| AC-8 | All repair actions log to audit trail | RA-009, CM-005 | — |
| AC-9 | Permission errors surface as structured error — not 500 | RA-010 | — |
| AC-10 | TypeScript compiles without errors | `cd src/client && npx tsc --noEmit` and `cd src/server && npx tsc --noEmit` | — |

---

## 6. CP-T035 — Getting Started Screen and First-Run Onboarding Flow

**Ticket**: CP-T035
**Backend route**: `GET /api/control-plane/instances/:instanceId/setup-status`
**Frontend route**: `/getting-started`

### 6.1 Test Environment Setup

Two test scenarios must be prepared:

**Scenario A — Fresh install (all steps incomplete):**
- DB unreachable OR no DATABASE_URL configured
- No provider key configured
- No projects bound
- No `.mcp.json` in any project

**Scenario B — Partial setup (steps 1-2 complete, 3-4 incomplete):**
- DB connected
- At least one provider key configured
- No projects bound
- No `.mcp.json`

**Scenario C — All steps complete:**
- DB connected
- Provider configured
- At least one project bound
- `.mcp.json` present for that project

### 6.2 Backend: Setup Status Endpoint

| ID | Name | Setup | Expected | Pass/Fail | Notes |
|----|------|-------|----------|-----------|-------|
| SS-001 | Returns 200 with 4-step structure | Any instance | 200, `steps` array with 4 items, `isFullyConfigured`, `firstRunDetected` booleans | — | — |
| SS-002 | Step IDs are correct | Any instance | `steps[].id` values include: `database`, `provider`, `project_binding`, `claude_integration` | — | — |
| SS-003 | Database step complete — DB connected | Scenario B or C | `database` step `status: complete` | — | — |
| SS-004 | Database step incomplete — DB not reachable | Scenario A | `database` step `status: incomplete`, `actionRequired` contains CLI instruction | — | — |
| SS-005 | Provider step complete — key present | Scenario B or C | `provider` step `status: complete` | — | — |
| SS-006 | Provider step incomplete — no key | Scenario A | `provider` step `status: incomplete`, `actionRequired` describes env var to set | — | — |
| SS-007 | Project binding incomplete — no projects | Scenario A or B | `project_binding` step `status: incomplete`, `actionRequired` contains `iranti bind` CLI command | — | — |
| SS-008 | Claude integration incomplete — no projects bound | Scenario A or B | `claude_integration` step `status: not_applicable` or `incomplete` (not actionable until project_binding done) | — | — |
| SS-009 | Claude integration incomplete — projects but no .mcp.json | Scenario: projects bound, no .mcp.json | `claude_integration` step `status: incomplete`, `actionRequired` contains CLI or `repairAction` endpoint | — | — |
| SS-010 | isFullyConfigured: true when all steps complete | Scenario C | `isFullyConfigured: true` | — | — |
| SS-011 | firstRunDetected: true on fresh instance | Fresh instance (flag file absent) | `firstRunDetected: true` | — | — |
| SS-012 | firstRunDetected: false after flag set | After "Mark setup complete" | `firstRunDetected: false` | — | — |
| SS-013 | Flag persists at instance level (not browser) | Set flag, open new browser tab | New tab still shows `firstRunDetected: false` | — | — |
| SS-014 | actionRequired is non-null for incomplete steps | Scenario A | Each incomplete step has a non-null `actionRequired` string with specific instructions | — | — |

### 6.3 Frontend: Getting Started Screen

| ID | Name | Setup | Expected | Pass/Fail | Notes |
|----|------|-------|----------|-----------|-------|
| GS-001 | Screen renders at `/getting-started` | Navigate to `/getting-started` | Page loads with numbered step list | — | — |
| GS-002 | Auto-shown on first load when firstRunDetected: true | Fresh instance | On page load, browser navigates to `/getting-started` before Memory Explorer | — | — |
| GS-003 | NOT auto-shown when firstRunDetected: false | After mark complete | Memory Explorer loads directly | — | — |
| GS-004 | All 4 steps shown | Any state | Steps 1-4 all visible in order | — | — |
| GS-005 | First incomplete step expanded | Scenario B (steps 1-2 done) | Step 3 (project_binding) is expanded; steps 1-2 collapsed (checkmark) | — | — |
| GS-006 | Completed steps collapsed with checkmark | Scenario B | Steps 1 and 2 show checkmark badge, greyed styling | — | — |
| GS-007 | Incomplete step shows actionRequired | Any incomplete step | Plain-English description of what to do, visible in expanded step | — | — |
| GS-008 | Copyable CLI command shown where applicable | Incomplete project_binding or database step | Code-formatted CLI command with copy button or selectable text | — | — |
| GS-009 | "Refresh" button on provider step | Step 2 provider | Clicking Refresh re-checks provider status without full page reload | — | — |
| GS-010 | "Mark setup complete" redirects to Memory Explorer | Click "Mark setup complete" | `firstRunDetected` flag set; browser navigates to `/memory` | — | — |
| GS-011 | "Skip for now" does not mark complete | Click "Skip for now" | Screen dismissed; Getting Started still appears on next load if incomplete | — | — |
| GS-012 | Success state shown when all steps complete | Scenario C | "Iranti is ready" message with green checkmark and "Go to Memory Explorer" CTA | — | — |
| GS-013 | "Go to Memory Explorer" CTA navigates correctly | Click CTA in success state | Browser navigates to `/memory` | — | — |
| GS-014 | "Refresh all" button re-checks all steps | Click "Refresh all" | All step statuses re-fetched from backend; UI updates | — | — |
| GS-015 | Dark mode renders correctly | Toggle dark mode | Background, text, step cards all use dark palette | — | — |
| GS-016 | Light mode renders correctly | Default | All elements use light palette | — | — |

### 6.4 Shell Integration

| ID | Name | Setup | Expected | Pass/Fail | Notes |
|----|------|-------|----------|-----------|-------|
| SH-001 | Setup incomplete badge visible in shell header | Any incomplete step, screen not dismissed | Badge shows "Setup incomplete — N steps remaining" with link | — | — |
| SH-002 | Badge not shown when all steps complete | Scenario C | No badge in shell header | — | — |
| SH-003 | Badge dismissible per session | Click dismiss on badge | Badge hides for the rest of the session | — | — |
| SH-004 | Badge reappears on next page load if incomplete | After SH-003, reload | Badge reappears (not permanently dismissed) | — | — |
| SH-005 | "Getting Started" nav item visible | Any state | Nav item present in sidebar | — | — |
| SH-006 | Nav item shows badge count | Incomplete steps | Badge count on nav item matches number of incomplete steps | — | — |
| SH-007 | Nav item positioned above other items when firstRunDetected: true | Fresh instance | Getting Started item at top of nav | — | — |
| SH-008 | Nav item positioned below Health after complete | After all steps complete | Getting Started item below Health in nav | — | — |

### 6.5 Health Dashboard Integration

| ID | Name | Setup | Expected | Pass/Fail | Notes |
|----|------|-------|----------|-----------|-------|
| HD-001 | "View Setup Guide" link on Critical health items | Health check with error status | Link to `/getting-started` visible on error checks | — | — |

### 6.6 CP-T035 Acceptance Criteria Checklist

| AC | Requirement | Test cases | Pass/Fail |
|----|-------------|------------|-----------|
| AC-1 | Setup status endpoint returns 4-step status with correct states | SS-001 through SS-014 | — |
| AC-2 | firstRunDetected: true on fresh instance; false after mark complete | SS-011, SS-012 | — |
| AC-3 | Getting Started screen renders with correct step states | GS-001 through GS-014 | — |
| AC-4 | First incomplete step expanded on load | GS-005 | — |
| AC-5 | Each incomplete step shows plain-English action and CLI command | GS-007, GS-008 | — |
| AC-6 | Provider step refresh re-checks without page reload | GS-009 | — |
| AC-7 | Mark setup complete sets flag and redirects | GS-010 | — |
| AC-8 | All-complete success state shown automatically | GS-012 | — |
| AC-9 | Shell header badge visible when incomplete, dismissible per session | SH-001 through SH-004 | — |
| AC-10 | Getting Started nav item with badge count | SH-005, SH-006 | — |
| AC-11 | Screen auto-shown on first load | GS-002 | — |
| AC-12 | TypeScript compiles without errors | `cd src/server && npx tsc --noEmit` and `cd src/client && npx tsc --noEmit` | — |
| AC-13 | Both light and dark mode | GS-015, GS-016 | — |

---

## 7. CP-T025 — Native Staff Emitter Injection (Stream Coverage Test)

**Ticket**: CP-T025 (P1 — elevated; stream coverage test planned here, not yet runnable)
**Status**: CP-T025 is not yet implemented. This section defines the stream coverage test that must pass before CP-T025 can be marked done.

**Context**: Phase 1 uses a polling adapter that infers events from DB state changes. CP-T025 injects native emitters into all 4 Iranti Staff components (Librarian, Attendant, Archivist, Resolutionist) to achieve <200ms event latency and full component coverage. This test plan verifies that the native emitter delivers the event types that the polling adapter cannot.

### 7.1 Stream Coverage Test — Prerequisites

Before running this test:
- CP-T025 implementation merged (native emitter injected into all 4 Staff components)
- Control plane server running with CP-T025 build
- Iranti instance running with CP-T025 native emitter active
- SSE stream connected: `curl -N "http://localhost:3002/api/control-plane/events/stream"`

### 7.2 Event Component Coverage Tests

| ID | Event type | How to trigger | Expected SSE event | Pass/Fail | Notes |
|----|-----------|---------------|-------------------|-----------|-------|
| CE-001 | Librarian write_created | `iranti_write` new entity/key | `staffComponent: 'Librarian'`, `actionType: 'write_created'` | — | Also testable in Phase 1 |
| CE-002 | Librarian write_replaced | `iranti_write` to existing entity/key | `staffComponent: 'Librarian'`, `actionType: 'write_replaced'` | — | Also testable in Phase 1 (approximate) |
| CE-003 | Archivist entry_archived | Trigger Archivist run or direct supersession | `staffComponent: 'Archivist'`, `actionType: 'entry_archived'` | — | Also testable in Phase 1 |
| CE-004 | Attendant handshake_completed | `iranti_handshake` call | `staffComponent: 'Attendant'`, `actionType: 'handshake_completed'` | — | **Only testable post-CP-T025** |
| CE-005 | Attendant session_expired | Session timeout elapsed | `staffComponent: 'Attendant'`, `actionType: 'session_expired'` | — | **Only testable post-CP-T025** |
| CE-006 | Resolutionist resolution_decision | Conflict arises and Resolutionist resolves | `staffComponent: 'Resolutionist'`, `actionType: 'resolution_decision'` | — | **Only testable post-CP-T025** |

### 7.3 Latency Tests

| ID | Name | Setup | Expected | Pass/Fail | Notes |
|----|------|-------|----------|-----------|-------|
| LT-001 | Librarian event latency < 200ms | Start timer, trigger KB write, note SSE event timestamp | Time from write to SSE event receipt < 200ms | — | Phase 1 polling is 2s; CP-T025 target is <200ms |
| LT-002 | Attendant event latency < 200ms | Start timer, call iranti_handshake, note SSE event | Time < 200ms | — | **Only testable post-CP-T025** |
| LT-003 | No duplicate events after reconnect | Connect, receive 3 events, reconnect | No events emitted twice (Last-Event-ID cursor respected) | — | Same as SS-012/SS-013 from QA-TP-001 |

### 7.4 Phase 1 Polling Fallback Verification (for pre-CP-T025 baseline)

| ID | Name | Expected | Pass/Fail | Notes |
|----|------|----------|-----------|-------|
| FB-001 | Librarian events appear within 2 seconds | Trigger KB write; SSE event arrives within 2s | — | Phase 1 polling interval |
| FB-002 | Archivist events appear within 2 seconds | Trigger archival; SSE event arrives within 2s | — | Phase 1 polling interval |
| FB-003 | Attendant events NOT present in Phase 1 stream | iranti_handshake called; no `staffComponent: 'Attendant'` event in stream | — | Expected Phase 1 limitation |
| FB-004 | Resolutionist events NOT present in Phase 1 stream | Conflict resolved; no `staffComponent: 'Resolutionist'` event | — | Expected Phase 1 limitation |

### 7.5 CP-T025 Acceptance Criteria Checklist

| AC | Requirement | Test cases | Pass/Fail |
|----|-------------|------------|-----------|
| AC-1 | All 4 Staff components emit events (Librarian, Attendant, Archivist, Resolutionist) | CE-001 through CE-006 | — |
| AC-2 | Librarian event latency < 200ms | LT-001 | — |
| AC-3 | Attendant event latency < 200ms | LT-002 | — |
| AC-4 | No duplicate events after reconnect | LT-003 | — |
| AC-5 | Phase 1 fallback still active before CP-T025 ships | FB-001 through FB-004 | — |

---

## 8. Regression Test: Core Phase 1 Endpoints (Post-CP-D001 Fix)

Before any Phase 2 work is released, the following Phase 1 endpoints must be re-verified after the CP-D001 camelCase SQL fix is applied. These are abbreviated smoke tests, not the full QA-TP-001 test suite.

| ID | Endpoint | Expected | Pass/Fail |
|----|---------|----------|-----------|
| REG-001 | `GET /kb?limit=5` | 200, `items` array, camelCase fields | — |
| REG-002 | `GET /archive?limit=5` | 200, `items` array, `archivedAt` non-null on all items | — |
| REG-003 | `GET /entities/agent/test_agent_001` | 200, `currentFacts`, `archivedFacts`, `relationships` arrays | — |
| REG-004 | `GET /entities/test/temporal_history_check/history/test_value` | 200, `current` with `"version 2"`, `history` with 2 entries, `hasHistory: true` | — |
| REG-005 | `GET /entities/test/temporal_history_check/history/test_value` — archivedReason | `history[0].archivedReason === 'Superseded by newer write'`, `history[1].archivedReason === 'Expired (validUntil passed)'` | — |
| REG-006 | `GET /relationships?limit=5` | 200, `items` array, camelCase fields | — |
| REG-007 | `GET /health` | 200, `overall` in `['healthy','degraded','error']`, all 10 checks present | — |
| REG-008 | `GET /instances` | 200, `instances` array (may be empty) | — |
| REG-009 | `GET /kb?search=__impossible_string__` | 200, `items: []`, `total: 0` (ILIKE search with camelCase columns) | — |
| REG-010 | `GET /kb?limit=501` | 400, `code: INVALID_PARAM` | — |

---

## 9. Known Phase 2 Test Limitations

1. **CP-T033 filesystem tests require a real project directory**: The repair action tests require an actual writable project directory. They cannot be fully automated without a test fixture directory. QA must prepare a dedicated test project directory before executing CP-T033 tests.

2. **CP-T025 Attendant and Resolutionist tests require upstream Iranti changes**: CE-004, CE-005, CE-006, LT-002 cannot be executed until CP-T025 ships. The FB-001 through FB-004 fallback tests can be run against Phase 1 immediately.

3. **CP-T037 velocity counter accuracy**: The rolling 60-second velocity counter will show bursty readings with Phase 1 polling (batches of events every 2 seconds). EV-003 and EV-004 should note this and verify the behavior, not fail on it. The behavior will smooth out once CP-T025 ships.

4. **CP-T035 first-run flag tests require a clean instance**: SS-011, GS-002, SH-007 require a fresh instance with no prior setup flag. Use a test instance with its runtime root directory cleared, or delete the `.iranti-cp-setup-complete` flag file before testing.

5. **CP-D001 must be resolved first**: All tests in sections 3–8 will fail if the camelCase SQL mismatch is not fixed. This is the P0 blocker for all Phase 2 QA.

---

## 10. Test Results Log

*To be filled in during execution.*

**Execution date**: ___________
**Executor**: qa_engineer
**CP server version**: ___________
**Iranti version**: ___________
**CP-D001 fix applied**: ☐ Yes ☐ No
**CP-T001 migration applied**: ☐ Yes ☐ No

### CP-T036 Results

| Test ID | Pass | Fail | Skip | Notes |
|---------|------|------|------|-------|
| ED-001 | | | | |
| ED-002 | | | | |
| ED-003 | | | | |
| ED-004 | | | | |
| ED-005 | | | | |
| ED-006 | | | | |
| ED-007 | | | | |
| ED-008 | | | | |
| HI-001 | | | | |
| HI-002 | | | | |
| HI-003 | | | | |
| HI-004 | | | | |
| HI-005 | | | | |
| HI-006 | | | | |
| HI-007 | | | | |
| HI-008 | | | | |
| HI-009 | | | | |
| HI-010 | | | | |
| HI-011 | | | | |
| HI-012 | | | | |
| HI-013 | | | | |
| FE-ED-001 | | | | |
| FE-ED-002 | | | | |
| FE-ED-003 | | | | |
| FE-ED-004 | | | | |
| FE-ED-005 | | | | |
| FE-ED-006 | | | | |
| FE-ED-007 | | | | |
| FE-ED-008 | | | | |
| FE-ED-009 | | | | |
| FE-ED-010 | | | | |
| FE-ED-011 | | | | |
| FE-ED-012 | | | | |
| FE-TH-001 | | | | |
| FE-TH-002 | | | | |
| FE-TH-003 | | | | |
| FE-TH-004 | | | | |
| FE-TH-005 | | | | |
| FE-TH-006 | | | | |
| FE-TH-007 | | | | |
| FE-TH-008 | | | | |
| FE-TH-009 | | | | |
| FE-TH-010 | | | | |
| FE-TH-011 | | | | |
| FE-TH-012 | | | | |
| FE-TH-013 | | | | |

### CP-T037 Results

| Test ID | Pass | Fail | Skip | Notes |
|---------|------|------|------|-------|
| AP-001 | | | | |
| AP-002 | | | | |
| AP-003 | | | | |
| AP-004 | | | | |
| AP-005 | | | | |
| AP-006 | | | | |
| EV-001 | | | | |
| EV-002 | | | | |
| EV-003 | | | | |
| EV-004 | | | | |
| EV-005 | | | | |
| EV-006 | | | | |
| AS-001 | | | | |
| AS-002 | | | | |
| AS-003 | | | | |
| AS-004 | | | | |
| AS-005 | | | | |
| AS-006 | | | | |
| AS-007 | | | | |
| AS-008 | | | | |
| LM-001 | | | | |
| LM-002 | | | | |
| LM-003 | | | | |
| LM-004 | | | | |
| LM-005 | | | | |
| LM-006 | | | | |
| VD-001 | | | | |
| VD-002 | | | | |
| VD-003 | | | | |
| VD-004 | | | | |
| VD-005 | | | | |

### CP-T033 Results

| Test ID | Pass | Fail | Skip | Notes |
|---------|------|------|------|-------|
| RA-001 | | | | |
| RA-002 | | | | |
| RA-003 | | | | |
| RA-004 | | | | |
| RA-005 | | | | |
| RA-006 | | | | |
| RA-007 | | | | |
| RA-008 | | | | |
| RA-009 | | | | |
| RA-010 | | | | |
| RA-011 | | | | |
| RA-012 | | | | |
| CM-001 | | | | |
| CM-002 | | | | |
| CM-003 | | | | |
| CM-004 | | | | |
| CM-005 | | | | |
| CM-006 | | | | |
| DR-001 | | | | |
| DR-002 | | | | |
| DR-003 | | | | |
| DR-004 | | | | |
| DR-005 | | | | |
| DR-006 | | | | |
| DR-007 | | | | |

### CP-T035 Results

| Test ID | Pass | Fail | Skip | Notes |
|---------|------|------|------|-------|
| SS-001 | | | | |
| SS-002 | | | | |
| SS-003 | | | | |
| SS-004 | | | | |
| SS-005 | | | | |
| SS-006 | | | | |
| SS-007 | | | | |
| SS-008 | | | | |
| SS-009 | | | | |
| SS-010 | | | | |
| SS-011 | | | | |
| SS-012 | | | | |
| SS-013 | | | | |
| SS-014 | | | | |
| GS-001 | | | | |
| GS-002 | | | | |
| GS-003 | | | | |
| GS-004 | | | | |
| GS-005 | | | | |
| GS-006 | | | | |
| GS-007 | | | | |
| GS-008 | | | | |
| GS-009 | | | | |
| GS-010 | | | | |
| GS-011 | | | | |
| GS-012 | | | | |
| GS-013 | | | | |
| GS-014 | | | | |
| GS-015 | | | | |
| GS-016 | | | | |
| SH-001 | | | | |
| SH-002 | | | | |
| SH-003 | | | | |
| SH-004 | | | | |
| SH-005 | | | | |
| SH-006 | | | | |
| SH-007 | | | | |
| SH-008 | | | | |
| HD-001 | | | | |

### Regression Tests (Post-CP-D001)

| Test ID | Pass | Fail | Skip | Notes |
|---------|------|------|------|-------|
| REG-001 | | | | |
| REG-002 | | | | |
| REG-003 | | | | |
| REG-004 | | | | |
| REG-005 | | | | |
| REG-006 | | | | |
| REG-007 | | | | |
| REG-008 | | | | |
| REG-009 | | | | |
| REG-010 | | | | |

**Defects raised**:

| Defect ID | Test case | Description | Assigned to | Status |
|-----------|-----------|-------------|-------------|--------|
| CP-D001 | REG-001 through REG-006 (and HI-001) | All KB/archive/entity routes fail: SQL uses snake_case column names but Iranti DB uses camelCase (Prisma schema). Also `serializeKBRow`/`serializeArchiveRow` read `row.summary` but column is `row.valueSummary`. | backend_developer | Open |

---

*End of Phase 2 Test Plan — QA-TP-002*
