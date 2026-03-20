# Operator Dashboard Best Practices — Iranti Control Plane

**Produced by:** product_manager
**Date:** 2026-03-20
**Purpose:** Establish concrete implementation standards for the Phase 1 and Phase 2 operator surfaces. These are not aspirational guidelines — they are specific component behaviors, library choices, and interaction patterns the engineering team must implement.

---

## 1. Real-Time Data Tables

### 1.1 Optimistic Filter UI — Show Loading Immediately, Never Blank the Table

When a user changes a filter or search term, the table must enter a loading state immediately — do not wait for the API response before removing the current rows.

**Correct pattern:**
1. User changes filter value.
2. Table immediately shows previous rows with reduced opacity (`opacity: 0.5`) and a loading indicator in the topbar or filter bar (a thin progress bar under the filter row works well).
3. When the response arrives, table snaps to the new rows with a subtle fade-in.
4. If the response returns zero results, the empty state is displayed — but only after the response arrives, not optimistically.

**Wrong pattern:** Blank the table rows immediately when a filter changes (this causes the layout to jump and is disorienting). Do not show a full-screen spinner. Do not disable the filter bar during loading.

**Implementation reference:** React Query's `placeholderData: keepPreviousData` option (v5: `placeholderData: (previousData) => previousData`) achieves this with zero extra logic. Set on any `useQuery` call that powers a filterable table. The `isFetching` boolean drives the opacity and progress bar.

```typescript
const { data, isFetching } = useQuery({
  queryKey: ['knowledge_base', filters],
  queryFn: () => fetchFacts(filters),
  placeholderData: (prev) => prev, // keep previous rows during refetch
});
```

### 1.2 Virtualized Rendering for Large Result Sets

For any table that may display more than 200 rows, use virtualized rendering. Rendering 1,000+ DOM nodes causes measurable frame drops on average developer hardware.

**Library recommendation:** TanStack Virtual (`@tanstack/react-virtual`) v3. It integrates directly with TanStack Table (`@tanstack/react-table`) which should be the table foundation for all data tables in the control plane.

**Implementation pattern:**
- The `knowledge_base` table can contain thousands of entries. Implement TanStack Virtual on the Memory Explorer table as a Phase 1 requirement, not a performance optimization.
- Archive table: same.
- Staff Activity Stream: virtualized list (not table) — use `useVirtualizer` with a fixed item height for the event rows.

**Critical implementation detail:** TanStack Virtual requires a fixed container height. The table container must be `height: calc(100vh - [topbar + filter bar height])` — typically `height: calc(100vh - 120px)`. Do not use `min-height` here; it must be `height` or the virtualizer cannot compute row positions.

### 1.3 Cursor-Based Pagination vs. Offset

**Use cursor-based pagination for all live tables. Never use offset-based pagination for the Memory Explorer or Archive Explorer.**

Reason: Offset pagination has drift problems with live-written data. If the Librarian writes a new fact between page 1 and page 2 of an offset-paginated list, the user on page 2 will see a duplicated row (the previously-last item on page 1 is now pushed into page 2). In a system where the Librarian writes frequently, this is a constant UX defect.

**Correct approach:**
- API endpoint accepts `cursor` (the `id` of the last-seen row) and `limit` (default 50, max 200).
- Response includes `nextCursor` when more rows exist, `null` when at the end.
- Frontend uses `useInfiniteQuery` (React Query) for scroll-to-load-more behavior.
- "Load more" is a button at the bottom of the table — do not use infinite scroll (scroll-triggered load is disorienting when the user is using the keyboard to navigate rows).

**Exception:** The Staff Activity Stream uses append-only chronological order. No pagination is needed — the stream shows the most recent N events (capped at 2,000 in memory) with scroll-to-history loading for older events.

### 1.4 Column Resize and Column Show/Hide as Standard Affordances

These are not advanced features. In 2025, every serious operator data table ships with:

**Column resize:**
- Right-edge drag handle on each column header. Cursor changes to `col-resize` on hover.
- Minimum column width of 60px (prevents columns from collapsing to illegible widths).
- Column widths persist in `localStorage` keyed by table ID.
- Implementation: TanStack Table's `columnResizing` column feature handles this with `<th style={{ width: header.getSize() }}>` and the resize handler.

**Column show/hide:**
- A "Columns" button in the table toolbar (right side, near filter bar). Opens a popover/dropdown with checkboxes for each column.
- Required visible columns are not toggleable (entity and key in Memory Explorer; component and action in Activity Stream).
- Column visibility state persists in `localStorage` keyed by table ID.
- Default hidden columns for Memory Explorer: `id`, `valueRaw` (too wide), `conflictLog`. Default visible: `entityType`, `entityId`, `key`, `summary`, `confidence`, `source`, `createdBy`, `createdAt`.

---

## 2. Live Event Streams

### 2.1 Auto-Scroll vs. Manual Scroll Lock

This is the most commonly misimplemented behavior in live event streams. The correct pattern:

**Behavior spec:**
1. Default state: auto-scroll ON. New events append to the bottom. Container scrolls to follow.
2. User scrolls up manually: auto-scroll PAUSES immediately. The stream continues to receive events but does not scroll the container.
3. While paused: a floating pill/badge appears at the bottom of the stream: "▼ N new events" where N is the count of events received while paused. Badge is sticky at bottom of the scroll container.
4. User clicks the badge OR scrolls back to the bottom: auto-scroll RESUMES. Badge disappears. Scroll jumps to current end.
5. "Pause" button (optional): explicit toggle in the toolbar. Shows "Resume" when paused. Useful for reading an event without fighting the scroll.

**Implementation:**
```typescript
const isNearBottom = (el: HTMLElement) =>
  el.scrollHeight - el.scrollTop - el.clientHeight < 80; // 80px threshold

const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
  const nearBottom = isNearBottom(e.currentTarget);
  if (!nearBottom && autoScroll) setAutoScroll(false);
  if (nearBottom && !autoScroll) {
    setAutoScroll(true);
    setPendingCount(0);
  }
};

useEffect(() => {
  if (autoScroll && containerRef.current) {
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  } else if (!autoScroll) {
    setPendingCount(c => c + newEvents.length);
  }
}, [events]);
```

The 80px threshold is important — users should not need pixel-perfect scroll position to trigger resume.

### 2.2 Event Deduplication on SSE Reconnect

SSE connections drop and reconnect. Without deduplication, events received during a reconnect cycle will appear twice in the stream.

**Standard approach:** The `Last-Event-ID` SSE header. The server assigns each event a monotonically increasing integer ID (`id:` field in the SSE stream). When the browser reconnects, it sends `Last-Event-ID: <last-received-id>` in the request headers. The server resumes from after that ID.

**Backend requirement (for CP-T014 / activity stream endpoint):**
```
data: {"component":"Librarian","action":"write_created",...}
id: 1042
event: staff_event
\n\n
```

**Frontend requirement:** The browser `EventSource` API handles `Last-Event-ID` automatically. No explicit client-side deduplication is needed if the server correctly implements the `id:` field. However, as a safety measure, maintain a `Set<string>` of seen event IDs in the browser and skip duplicates if the server ever replays.

**If SSE is not feasible:** WebSocket with a sequence number achieves the same result. Last resort: polling with a `since` timestamp parameter on the events endpoint. Polling at 2-second intervals is acceptable for Phase 1 if the SSE infrastructure is not ready.

### 2.3 Maximum Event Buffer Size

The browser cannot hold an unbounded event list in memory. For a long-lived tab running the Activity Stream:

**Rule:** Cap the event buffer at 2,000 events. When the 2,001st event arrives, drop the oldest event from the array. The virtualizer ensures DOM count stays small regardless.

**Implementation:**
```typescript
const MAX_EVENTS = 2000;
const addEvent = (event: StaffEvent) =>
  setEvents(prev => [...prev.slice(-(MAX_EVENTS - 1)), event]);
```

Display a muted note at the top of the stream when the buffer is full: "Showing most recent 2,000 events. Older events are available in the archive." This sets correct expectations.

### 2.4 Event Severity Color Coding

Follow the universal operator convention. Do not invent new semantics for these colors — operators have trained intuitions from every other tool they use:

| Severity | Color token | Hex (dark mode) | Use in Staff Stream |
|---|---|---|---|
| Error | `--status-error` | `#F87171` (red-400) | Resolutionist escalations, write failures, health errors |
| Warning | `--status-warning` | `#FBBF24` (amber-400) | Conflicts detected, provider unreachable, confidence below threshold |
| Info / Success | `--status-success` | `#34D399` (emerald-400) | Librarian write created, Attendant handshake, Archivist archive |
| Debug / Muted | `--text-muted` | `#6B7280` (gray-500) | Internal step events, verbose Staff actions, observe calls |

**Additional Staff component colors (from CP-T017):**
- Librarian: `--staff-librarian` — teal/green family
- Attendant: `--staff-attendant` — blue family
- Archivist: `--staff-archivist` — amber/orange family
- Resolutionist: `--staff-resolutionist` — red/coral family

These Staff colors appear as left-border accents on event rows, not as full-row background fills. Full-row fill only for `error` severity.

---

## 3. Diagnostics and Health Dashboards

### 3.1 Traffic Light Status Cards — The Universal Mental Model

Do not reinvent health status UX. The three-state traffic light model (green / amber / red) is the mental model every operator has. Use it.

**Component spec for Health view status cards:**
- Card width: full column (grid of 2–3 columns depending on viewport)
- Top-left: component icon (database, cloud, puzzle piece, etc.)
- Center: component name in `--text-primary`, status text in `--text-secondary`
- Top-right: status badge — `Healthy` / `Warning` / `Error` — using `--status-success` / `--status-warning` / `--status-error` background with white text
- Card border: 1px solid matching the status color at 40% opacity (subtle but reinforces the state)
- No fourth state: avoid "Unknown" or "Checking" as persistent states. If the check is running, show a spinner inside the badge. If it returns no data, show `Warning` (not `Unknown`).

**Standard components to check in Phase 1 Health view:**
1. Database (PostgreSQL reachability)
2. Vector backend (pgvector extension present)
3. Default LLM provider (best-effort key detection)
4. MCP registration (`.mcp.json` present and valid)
5. Iranti runtime version (current vs latest)
6. Project bindings (count of bound projects, any without valid paths)

### 3.2 Time-Since-Last-Check Display

Health data has a freshness problem: if the last check was 10 minutes ago and the database just went down, the green status card is misleading.

**Rule:** Every health card must display "Last checked Ns ago" or "Last checked at HH:MM:SS" below the status text. Use relative time for recent checks (< 2 minutes: "Just now", < 1 hour: "X minutes ago"), absolute time for older checks.

**Auto-refresh:** Health cards auto-refresh every 30 seconds. A visible countdown timer in the Health view topbar ("Refresh in 18s") prevents the user from wondering if the data is stale. The countdown is secondary (smaller, muted color) — it should not compete with the status cards for attention.

**On-demand refresh:** A "Refresh now" button in the topbar triggers an immediate re-check of all health components. After clicking, the countdown resets to 30 seconds. The button shows a spinner during the refresh and returns to its default state when complete.

### 3.3 Actionable Error Messages

**Bad:** `"Database unreachable"`

**Good:** `"Database unreachable — check DATABASE_URL in .env.iranti (currently: postgresql://***@localhost:5432/iranti)"`

**Best:** The above, plus a "How to fix" link that opens an inline guidance panel with specific resolution steps for the most common causes of this error.

**Rule:** Every health error message must answer three questions:
1. What is wrong? (The failing check, in plain language)
2. Where do I look? (Specific file, env variable, or command)
3. What do I try first? (One or two concrete remediation steps)

**Implementation pattern:** Each health check function returns a structured result:
```typescript
type HealthCheckResult = {
  status: 'healthy' | 'warning' | 'error';
  message: string; // human-readable, actionable
  detail?: string; // optional: the raw error or config value (secrets masked)
  guidance?: string; // optional: resolution steps (rendered as Markdown)
  guidanceUrl?: string; // optional: link to docs
};
```

The frontend renders `message` in the status card, `detail` and `guidance` in a collapsible "Details" section below the card. Clicking "Details" expands inline — no modal.

### 3.4 Auto-Refresh with Visible Countdown

Silent background refresh is confusing for operators. When data refreshes without any indication, users cannot tell if the dashboard is live or cached. They lose trust.

**Pattern:**
- Visible countdown timer in the Health view topbar or status bar: "Refreshing in 28s"
- The countdown animates down (not a static label)
- When refresh triggers: countdown resets, a brief "Refreshing..." state in the topbar (< 1 second for fast checks)
- If a check takes > 3 seconds, show an inline spinner in the affected card

**React Query implementation:** `refetchInterval: 30_000` on the health query, with `isFetching` driving the "Refreshing..." state. The countdown must be maintained in local component state (decremented via `setInterval`) and reset on `isFetching` transition.

---

## 4. Local-First App Patterns

### 4.1 Designing for Server-Down State

The Iranti control plane is fundamentally different from a typical web app: if the Iranti server (`http://localhost:3001`) is down, the entire application is non-functional. Every component talking to the API will fail simultaneously. This must be handled as a first-class application state, not as individual component error boundaries.

**The correct pattern:**
1. On app load, check server reachability immediately with a `/api/health` or `/api/control-plane/health` ping.
2. If the server responds: proceed normally.
3. If the server does not respond within 3 seconds: render a full-page "Iranti is not running" state. This is not an error page — it is an expected operational state.

**Full-page down state design:**
- Large centered message: "Iranti is not running"
- Secondary message: "The control plane connects to Iranti at `http://localhost:3001`. Make sure Iranti is running."
- Command suggestion: `iranti start` or `npx iranti start` in a monospace code block
- A "Check again" button that re-pings and updates state immediately
- An auto-retry indicator: "Checking again in 5s..." (the app quietly polls every 5 seconds in this state)

**What to avoid:** Individual component error boundaries that show their own disconnected error messages. Having the table show "Error loading data" while the sidebar shows "Cannot connect" and the topbar shows a stale instance name is worse than the full-page down state.

### 4.2 Connection Recovery — Auto-Reload When Server Returns

When Iranti comes back up after being down, the user should not need to manually reload the page.

**Pattern:**
1. When in the "server down" state, the app polls `GET /api/health` every 5 seconds.
2. When the health check succeeds: transition out of the down state.
3. Re-fetch all active queries: call `queryClient.invalidateQueries()` to invalidate all cached data.
4. If the app had a prior view state (e.g., the user was on the Memory Explorer with filters applied): restore that view state. The user should see their work exactly as they left it, now populated with fresh data.
5. Show a brief success toast: "Iranti reconnected" (auto-dismiss in 3 seconds).

**Implementation:**
```typescript
// In the root health check hook
const [isDown, setIsDown] = useState(false);
const queryClient = useQueryClient();

useEffect(() => {
  if (!isDown) return;
  const interval = setInterval(async () => {
    try {
      await fetch('/api/health');
      setIsDown(false);
      queryClient.invalidateQueries(); // re-fetch everything
      toast.success('Iranti reconnected');
    } catch {}
  }, 5000);
  return () => clearInterval(interval);
}, [isDown]);
```

### 4.3 Local Instance Context — Always Visible

Because the control plane is local-only in Phase 1, users may not immediately understand what instance they are looking at, especially if they have multiple Iranti instances configured.

**Rule:** The active instance context must be permanently visible in the UI — not just on the Instances page.

**Implementation (from CP-T017):**
- Instance context switcher at the top of the sidebar, always visible.
- Shows: instance name + port (`local :3001`).
- A subtle "Local" or "localhost" badge reinforces the local-only scope.
- If the instance cannot be identified (e.g., metadata endpoint not ready): show `Iranti — [hostname]` using `window.location.hostname`.

**Why this matters:** If a user opens two control plane tabs pointing at two different Iranti instances, they need to know which is which at a glance. The instance context label at the top of the sidebar is the answer.

---

## 5. Keyboard-First Operator Design

### 5.1 Global Command Palette (Cmd+K) — Table Stakes in 2025

A command palette is not a nice-to-have for an operator tool. It is the primary navigation affordance for power users. Every operator who uses Linear, VS Code, Raycast, or Notion expects Cmd+K to work from anywhere.

**Behavior spec:**
- Trigger: `Cmd+K` (macOS) / `Ctrl+K` (Windows/Linux). Works from any focused element, including text inputs (use `event.metaKey || event.ctrlKey` + `event.key === 'k'`, and call `event.preventDefault()` to prevent browser default actions).
- Opens in < 50ms. Use a dialog or portal rendered at the root level — not inside any scrolling container.
- Input field is focused immediately on open.
- Results update on each keystroke (debounced at 100ms for API-backed results, instant for static commands).
- Result groups: "Recent" (top 3–5 recently visited entity views from `localStorage`), "Navigate" (all 6 Phase 1 views), "Actions" (health refresh, clear filters, toggle dark mode), "Search" (live entity search results from the API).
- Keyboard navigation: `↑` / `↓` to move between results, `Enter` to activate, `Escape` to close without action.
- Each result shows: icon, primary label, secondary label (for entity results: `entityType/entityId`), and keyboard shortcut hint if applicable (right-aligned, muted text).
- `Tab` does not close the palette and does not change focus — only `↑`/`↓` navigate results. (Linear's behavior; prevents accidents.)

**Implementation recommendation:** `cmdk` (npm package `cmdk`) — the same library used by shadcn/ui, Vercel's dashboard, and Linear. It provides the accessible dialog, fuzzy search, keyboard navigation, and result grouping out of the box. It is headless (no default styles) and works with the Iranti token system.

```tsx
import { Command } from 'cmdk';
// Render as a Dialog at root level
// useEffect to listen for Cmd+K globally
```

### 5.2 Table Row Keyboard Navigation

Operators who process many facts (e.g., reviewing archive entries, scanning Staff events) will use the keyboard. Mouse-only tables are unacceptable for the Memory Explorer.

**Required behaviors:**
- `↑` / `↓` arrow keys: navigate between rows. Focused row is visually distinct (left-border accent, background shift).
- `Enter`: expand the currently focused row inline (accordion or detail panel). Same as clicking the row.
- `Escape`: collapse the expanded row and return focus to the table.
- `Tab`: move focus out of the table to the next interactive element (filter bar, pagination, etc.). Standard browser tab order.
- The table container must have `role="grid"` and each row `role="row"` with `tabIndex={0}` on the focused row (roving tabindex pattern).

**Implementation:** TanStack Table does not provide keyboard navigation out of the box — implement roving tabindex manually on the row elements. The focused row index lives in local state, updated by `onKeyDown` on the table container.

### 5.3 Filter Bar Focus Shortcut

When an operator is scanning a large table and wants to filter, they should not have to move their hand to the mouse.

**Rule:** Pressing `/` when focus is on the table (not inside a text input) moves focus to the filter bar's primary search input. This is the standard adopted by GitHub, Linear, and Notion for "focus search."

**Implementation:**
```typescript
// On the table container div:
onKeyDown={(e) => {
  if (e.key === '/' && e.target === e.currentTarget) {
    e.preventDefault();
    filterInputRef.current?.focus();
  }
}}
```

Additionally: `Cmd+F` / `Ctrl+F` should trigger the same focus (and `preventDefault` to suppress browser find). Operators trained on browser find-in-page will reflexively use `Cmd+F`.

### 5.4 Two-Key Navigation Shortcuts (Phase 2)

Following Linear's `G then H` pattern, implement a second keyboard navigation layer for Phase 2:

| Shortcut | Destination |
|---|---|
| `G` then `M` | Memory Explorer |
| `G` then `R` | Archive Explorer |
| `G` then `A` | Activity Stream |
| `G` then `I` | Instances |
| `G` then `H` | Health |
| `G` then `?` | Keyboard shortcut reference |

This requires a short-lived key buffer: on first keypress of `G`, start a 500ms window listening for the second key. If no second key arrives, treat `G` as a normal keystroke and discard the buffer.

---

## Implementation Priority Order

The practices above are not all equal. These five are the highest-impact items to implement correctly in Phase 1, ordered by operator-facing impact:

**1. Full-page server-down state (Section 4.1)**
If this is wrong, the app is unusable whenever Iranti is not running. This is a first-boot experience issue. Implement before any view.

**2. Optimistic filter UI with `placeholderData: keepPreviousData` (Section 1.1)**
If this is wrong, every filter change blanks the table and the app feels broken. Implement in Memory Explorer (CP-T013) as the foundation.

**3. Auto-scroll / scroll-lock / N-new-events badge for Activity Stream (Section 2.1)**
The Staff Activity Stream is the most novel surface in the control plane. If auto-scroll is broken, operators cannot watch live events. Implement in CP-T014.

**4. Actionable health error messages (Section 3.3)**
Vague health errors are a first-run abandonment cause. New users who cannot understand why a health check failed will give up. Implement in CP-T015.

**5. Column show/hide with localStorage persistence (Section 1.4)**
Operators customize their tables. If state resets on every reload, the tool feels unpolished. Implement in Memory Explorer (CP-T013) and include by default.

---

*Document maintained by: product_manager*
*Next review: Phase 1 frontend implementation review*
