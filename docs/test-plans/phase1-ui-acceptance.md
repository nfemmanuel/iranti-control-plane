# Phase 1 UI Acceptance Test Checklist

**Plan ID**: QA-UI-001
**Tickets**: CP-T013 (Memory Explorer), CP-T014 (Staff Activity Stream), CP-T015 (Instance Manager), CP-T016 (Health Dashboard), CP-T017 (Shell / Navigation)
**Author**: qa_engineer
**Date**: 2026-03-20
**Status**: Ready for execution once frontend tickets CP-T013–CP-T017 are marked complete

---

## Prerequisites

Before running this checklist:

- [ ] Backend server running at `http://localhost:3002`
- [ ] Frontend dev server running (or production build served)
- [ ] Local Iranti instance running with KB data
- [ ] CP-T001 migration applied (staff_events table exists)
- [ ] Both Chromium-based browser (Chrome/Edge) and Firefox available for cross-browser checks
- [ ] Dark mode and light mode tested in each section

---

## 1. Shell (CP-T017) — Sidebar Navigation and Global Controls

Test this first, as it is the frame for all other views.

### 1.1 Sidebar Navigation

- [ ] **SHELL-01**: Sidebar is visible and persistent across all 5 views (does not collapse unexpectedly)
- [ ] **SHELL-02**: "Memory Explorer" nav item navigates to `/memory` (or equivalent route) when clicked
- [ ] **SHELL-03**: "Staff Activity" nav item navigates to `/activity`
- [ ] **SHELL-04**: "Instances" nav item navigates to `/instances`
- [ ] **SHELL-05**: "Health" nav item navigates to `/health`
- [ ] **SHELL-06**: Fifth nav item (if present — confirm with frontend) navigates to its correct route
- [ ] **SHELL-07**: Active route's nav item is visually highlighted/selected — style differs from inactive items
- [ ] **SHELL-08**: Highlighting updates correctly when navigating between views (no stale highlight)
- [ ] **SHELL-09**: Direct URL navigation (paste URL in address bar) activates the correct sidebar item

### 1.2 Instance Switcher

- [ ] **SHELL-10**: Instance switcher is visible in the sidebar or header
- [ ] **SHELL-11**: Switcher displays the currently active instance name or ID (not blank, not "undefined")
- [ ] **SHELL-12**: If multiple instances are discoverable, switcher lists all of them
- [ ] **SHELL-13**: Selecting a different instance from the switcher updates the active instance in the UI

### 1.3 Theme Toggle

- [ ] **SHELL-14**: Theme toggle button is visible and accessible
- [ ] **SHELL-15**: Clicking toggle switches from light to dark mode — background, text, and card colors all change
- [ ] **SHELL-16**: Clicking toggle again switches back to light mode
- [ ] **SHELL-17**: Dark mode persists across a browser page refresh (preference stored in localStorage or equivalent)
- [ ] **SHELL-18**: Light mode persists across a browser page refresh
- [ ] **SHELL-19**: Dark mode: sidebar, cards, table rows, and modals use dark backgrounds — no white flash
- [ ] **SHELL-20**: Dark mode: text is legible (sufficient contrast ratio) on all UI surfaces

### 1.4 Cross-View Consistency

- [ ] **SHELL-21**: Page title (browser tab) updates correctly for each view
- [ ] **SHELL-22**: Shell does not visually break at 1280x800 viewport
- [ ] **SHELL-23**: Shell does not visually break at 1920x1080 viewport

---

## 2. Memory Explorer (CP-T013) — KB Table View

### 2.1 Initial Load

- [ ] **ME-01**: Navigating to Memory Explorer loads without a blank screen or console error
- [ ] **ME-02**: KB table displays rows when data is present in the database
- [ ] **ME-03**: Loading spinner or skeleton state is shown while data is fetching
- [ ] **ME-04**: Column headers are visible: at minimum `Entity`, `Key`, `Value`, `Confidence`, `Created At` (exact labels TBD by frontend)
- [ ] **ME-05**: Rows display `entityType`, `entityId`, `key`, truncated `valueRaw` or `valueSummary`, `confidence`, `createdAt`

### 2.2 Filtering

- [ ] **ME-06**: Entity type filter dropdown is visible and populated with distinct entity types from the DB
- [ ] **ME-07**: Selecting an entity type from the dropdown updates the table to show only rows matching that type
- [ ] **ME-08**: Clearing the entity type filter restores all rows
- [ ] **ME-09**: Filtering by entity type updates the `total` row count displayed

### 2.3 Search

- [ ] **ME-10**: Search text input is visible
- [ ] **ME-11**: Typing in the search box updates results — search is debounced (no result update on every keystroke; waits for typing pause)
- [ ] **ME-12**: Search term of "assignment" returns rows whose `valueSummary` or `valueRaw` contains "assignment"
- [ ] **ME-13**: Search term with no matches shows the empty state (see ME-17), not an error
- [ ] **ME-14**: Clearing the search input restores all rows
- [ ] **ME-15**: Search and entity type filter can be combined — both applied simultaneously

### 2.4 Row Detail / Expansion

- [ ] **ME-16**: Clicking a row expands it (inline or panel) to show full detail
- [ ] **ME-17**: Expanded row shows: `entityType`, `entityId`, `key`, `valueSummary`, `valueRaw`, `confidence`, `source`, `agentId`, `validFrom`, `validUntil`, `createdAt`
- [ ] **ME-18**: JSON toggle button is visible when `valueRaw` is present
- [ ] **ME-19**: Clicking the JSON toggle shows the raw JSON value in a monospace code block
- [ ] **ME-20**: If `valueRawTruncated === true`, a "view full value" affordance is shown (button or link) — clicking it fetches the complete value
- [ ] **ME-21**: Collapsing the row hides the detail panel

### 2.5 Empty State

- [ ] **ME-22**: When no rows match the current filters, an empty state is shown — not a blank or broken table
- [ ] **ME-23**: Empty state message is informative (e.g., "No facts found for this filter" — not just a spinner)

### 2.6 Pagination

- [ ] **ME-24**: Pagination controls are visible when total > limit
- [ ] **ME-25**: "Next page" button loads the next set of rows
- [ ] **ME-26**: "Previous page" button loads the previous set of rows
- [ ] **ME-27**: Current page indicator is correct (e.g., "Page 2 of 5")
- [ ] **ME-28**: Changing page does not reset current filters

### 2.7 Visual Design

- [ ] **ME-29**: Light mode: table rows alternate colors or have clear row separators; text is legible
- [ ] **ME-30**: Dark mode: table rows are readable against a dark background; no white backgrounds visible
- [ ] **ME-31**: Confidence value is displayed with visual weight (e.g., color-coded badge or number) — not just plain text

---

## 3. Staff Activity Stream (CP-T014) — Live Event Feed

### 3.1 Initial Connection

- [ ] **SA-01**: Navigating to Staff Activity view connects to the SSE stream without a console error
- [ ] **SA-02**: "Connecting..." or equivalent loading state is shown briefly before events appear
- [ ] **SA-03**: If no events exist yet, an empty state message is shown: "No events yet" or similar — not a blank screen

### 3.2 Live Event Delivery

- [ ] **SA-04**: After a KB write is triggered (via Iranti MCP tool), a new event appears in the stream view within 3 seconds
- [ ] **SA-05**: New events appear at the top of the stream (newest-first) or are appended and auto-scrolled into view — confirm which UX pattern is implemented
- [ ] **SA-06**: Each event row shows: staff component icon or label (`Librarian`, `Archivist`, etc.), `actionType`, `agentId`, `entityType/entityId`, `timestamp`
- [ ] **SA-07**: Timestamp is formatted in a human-readable way (relative time or locale-formatted — not raw ISO string)

### 3.3 Component Filter

- [ ] **SA-08**: Component filter control is visible (dropdown or button group)
- [ ] **SA-09**: Selecting "Librarian" filters the stream to show only Librarian events
- [ ] **SA-10**: Selecting "Archivist" filters the stream to show only Archivist events
- [ ] **SA-11**: Selecting "All" (or clearing filter) shows all components
- [ ] **SA-12**: Filter updates the SSE stream query parameter (reconnects with `?staffComponent=Librarian`) — not just client-side filtering of already-received events

### 3.4 Pause / Resume

- [ ] **SA-13**: Pause button is visible and labeled clearly ("Pause" or equivalent)
- [ ] **SA-14**: Clicking Pause stops auto-scroll — new events are buffered but view does not scroll
- [ ] **SA-15**: While paused, a buffer count badge or indicator shows how many new events have arrived (e.g., "12 new events")
- [ ] **SA-16**: Clicking Resume (or equivalent) flushes buffered events into the view and resumes auto-scroll
- [ ] **SA-17**: After resume, buffer count resets to 0

### 3.5 Reconnection

- [ ] **SA-18**: After the server is restarted (simulate by stopping and starting the CP server), the stream view automatically reconnects — no manual page refresh needed
- [ ] **SA-19**: After reconnect, events continue to appear without a page reload
- [ ] **SA-20**: `Last-Event-ID` is sent on reconnect — no event duplication visible after reconnect

### 3.6 Visual Design

- [ ] **SA-21**: Light mode: events are clearly separated; staff component label has distinct color or badge per component
- [ ] **SA-22**: Dark mode: event rows readable against dark background; component badge colors remain distinguishable

---

## 4. Instance Manager (CP-T015) — Instance List View

### 4.1 Instance List

- [ ] **IM-01**: Navigating to Instance Manager loads without error
- [ ] **IM-02**: At least one instance is shown when a local Iranti instance is running
- [ ] **IM-03**: Each instance card shows: `instanceId`, `runtimeRoot` path, `runningStatus`
- [ ] **IM-04**: Running status is shown with a visual indicator (green dot for running, grey/red for stopped/unreachable)
- [ ] **IM-05**: `runningStatus: 'running'` shows a "Running" or equivalent status label
- [ ] **IM-06**: `runningStatus: 'stopped'` shows a "Stopped" label — not an error state
- [ ] **IM-07**: `runningStatus: 'unreachable'` shows an "Unreachable" label with a helpful note

### 4.2 Env Key Completeness

- [ ] **IM-08**: Env key completeness section is visible on each instance card or in the instance detail
- [ ] **IM-09**: Required key presence flags are shown (DATABASE_URL present: yes/no, PORT present: yes/no)
- [ ] **IM-10**: When `envFile.present === false`, a clear message is shown: ".env.iranti not found" or equivalent — not a blank field
- [ ] **IM-11**: Provider key presence is shown: Anthropic key present (boolean), OpenAI key present (boolean)
- [ ] **IM-12**: Provider key values are NOT shown — only presence indicators

### 4.3 Integration Status

- [ ] **IM-13**: Integration status section shows `.mcp.json` presence indicator
- [ ] **IM-14**: Integration status shows whether the MCP config includes an Iranti entry

### 4.4 Project Binding Stub

- [ ] **IM-15**: Project bindings section is visible on the instance card or detail view
- [ ] **IM-16**: A stub message is shown explaining that project binding discovery is pending (not a blank section or error)
- [ ] **IM-17**: The stub message does not appear as a broken UI state — it is clearly intentional, e.g., "Project bindings: coming soon" or equivalent

### 4.5 Visual Design

- [ ] **IM-18**: Light mode: instance cards are readable; status indicators are clearly colored
- [ ] **IM-19**: Dark mode: cards readable on dark background

---

## 5. Health Dashboard (CP-T016) — System Health View

### 5.1 Check Cards

- [ ] **HD-01**: Navigating to Health Dashboard loads without error
- [ ] **HD-02**: All 10 health checks are shown as individual cards or list items: `db_reachability`, `db_schema_version`, `vector_backend`, `anthropic_key`, `openai_key`, `default_provider_configured`, `mcp_integration`, `claude_md_integration`, `runtime_version`, `staff_events_table`
- [ ] **HD-03**: Each check displays: check name, status badge (`ok` / `warn` / `error`), message string
- [ ] **HD-04**: `ok` status badge is green (or equivalent positive visual treatment)
- [ ] **HD-05**: `warn` status badge is yellow/amber
- [ ] **HD-06**: `error` status badge is red
- [ ] **HD-07**: `detail` field content is displayed when present (e.g., `latencyMs` for `db_reachability`)

### 5.2 Overall Status Badge

- [ ] **HD-08**: Overall status badge is prominently displayed at the top of the dashboard
- [ ] **HD-09**: `overall: 'healthy'` shows green "Healthy" badge
- [ ] **HD-10**: `overall: 'degraded'` shows amber "Degraded" badge
- [ ] **HD-11**: `overall: 'error'` shows red "Error" badge
- [ ] **HD-12**: The overall badge matches the computed logic (error beats degraded beats healthy)

### 5.3 Auto-Refresh

- [ ] **HD-13**: Auto-refresh countdown is visible (e.g., "Refreshing in 28s")
- [ ] **HD-14**: After the countdown reaches 0, the dashboard re-fetches and updates automatically
- [ ] **HD-15**: Countdown restarts after each refresh

### 5.4 Manual Refresh

- [ ] **HD-16**: Manual refresh button is visible and labeled clearly ("Refresh" or with a refresh icon)
- [ ] **HD-17**: Clicking the manual refresh button immediately re-fetches health data
- [ ] **HD-18**: After manual refresh, the auto-refresh countdown resets

### 5.5 Remediation Guidance

- [ ] **HD-19**: For checks with `status: 'warn'` or `status: 'error'`, a remediation hint or guidance is shown (e.g., "Run: CREATE EXTENSION IF NOT EXISTS vector;" for vector_backend)
- [ ] **HD-20**: For `staff_events_table: warn`, the guidance mentions applying the CP-T001 migration
- [ ] **HD-21**: Guidance text is actionable — not just an error code

### 5.6 "Needs Setup" Banner

- [ ] **HD-22**: When `overall === 'error'`, a prominent "Needs setup" or "Action required" banner is visible at the top of the dashboard
- [ ] **HD-23**: Banner is not shown when `overall === 'healthy'` or `'degraded'`

### 5.7 Visual Design

- [ ] **HD-24**: Light mode: check cards are visually clean; status colors are correct
- [ ] **HD-25**: Dark mode: cards readable; status badge colors remain distinguishable on dark background
- [ ] **HD-26**: Dashboard does not require horizontal scrolling on a 1280px-wide viewport

---

## 6. Cross-View Smoke Tests

After completing all individual view tests, run these cross-view navigation checks:

- [ ] **XV-01**: Navigate Memory Explorer → Staff Activity → Instance Manager → Health → back to Memory Explorer via sidebar — no errors, no blank screens
- [ ] **XV-02**: Toggle dark mode on Memory Explorer, then navigate to Health — dark mode persists
- [ ] **XV-03**: Apply a filter on Memory Explorer, navigate away, return — filter state is either preserved or clearly reset (document which behavior is implemented)
- [ ] **XV-04**: While Staff Activity stream is connected, navigate to Health and back — stream reconnects automatically on return
- [ ] **XV-05**: Open browser DevTools > Console — no uncaught errors after full session of navigation

---

## 7. Known Phase 1 UI Limitations

The following are accepted limitations for Phase 1. They should not be treated as bugs.

1. **No entity display names**: Entity cards and rows show `entityType/entityId` directly. No canonical display name or alias lookup is available (entities table does not exist in Phase 1).
2. **Project bindings stub**: Instance Manager shows a stub message for project bindings. No binding data is available in Phase 1.
3. **Attendant and Resolutionist events absent**: Staff Activity Stream will only show Librarian and Archivist events. No Attendant session events or Resolutionist decision events are produced in Phase 1.
4. **No conflict review UI**: There is no conflict resolution view in Phase 1.
5. **No write operations**: The UI is entirely read-only. No mutations are possible through the control plane UI in Phase 1.

---

## 8. Sign-Off

| View | QA Pass | Notes | Date |
|---|---|---|---|
| Shell (CP-T017) | ☐ | | |
| Memory Explorer (CP-T013) | ☐ | | |
| Staff Activity Stream (CP-T014) | ☐ | | |
| Instance Manager (CP-T015) | ☐ | | |
| Health Dashboard (CP-T016) | ☐ | | |
| Cross-view smoke tests | ☐ | | |

**QA engineer sign-off**: ___________
**Date**: ___________
**PM sign-off required before v0.1.0 is declared testable**: ☐

---

*End of Phase 1 UI Acceptance Test Checklist — QA-UI-001*
