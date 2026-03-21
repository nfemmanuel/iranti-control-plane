# Phase 4 Agent Assignments

**Issued by:** `product_manager`
**Date:** 2026-03-21
**Phase:** 4 — Iranti Desktop
**Milestone target:** v0.4.0
**Epic:** CP-E015 (Iranti Desktop)

---

## Context

v0.3.0-rc shipped 2026-03-21 (GitHub release live). User feedback after seeing the product: *"you know how the Docker Desktop control panel looks? Why don't we have something like that?"*

This single sentence is the brief for v0.4.0. The product is capable but navigation-first — every view is a discrete destination. There is no at-a-glance landing page. The goal of Phase 4 is to change that: open the app, see everything that matters, act immediately.

Product direction: **Iranti Desktop** — a real desktop-class operator experience, not an admin UI.

---

## Status

Phase 4 kickoff: 2026-03-21
Current wave: Wave 10 dispatched 2026-03-21

CP-T068 dispatched: 2026-03-21 (backend_developer + frontend_developer — parallel)
CP-T069 dispatched: 2026-03-21 after CP-T068 (frontend_developer)
CP-T070 dispatched: 2026-03-21 after CP-T068 (frontend_developer)

---

## Wave 10 — Iranti Desktop

### CP-T068 — Home Overview Dashboard

**Priority:** P1
**Assigned:** backend_developer (backend half) + frontend_developer (frontend half)
**Ticket:** `docs/tickets/cp-t068.md`
**Dependencies:** None — all data sources exist from Phase 3

**Backend brief:**

You are building a single new endpoint: `GET /api/control-plane/overview`. This is the primary backend deliverable.

The endpoint aggregates data from four existing sources using `Promise.allSettled` — any source failure returns a partial payload rather than a 500. Sources:

1. **health**: Re-use the health check functions from `health.ts`. Export the individual check runner or the `Promise.allSettled` aggregate from that file. Call it from `overview.ts` and return only `name` and `status` per check (strip `detail` and `message` from the health payload to keep the overview response small).

2. **kb summary**: Inline the same aggregate SQL that `metrics.ts` uses for `GET /metrics/summary`. Extract the 3 fields you need: `totalFacts`, `factsLast24h`, `activeAgentsLast7d`. Do not make an internal HTTP request — direct DB query.

3. **recentEvents**: `SELECT id, staff_component, action_type, agent_id, entity_type, entity_id, key, reason, timestamp FROM staff_events ORDER BY timestamp DESC LIMIT 8`. Handle `42P01` (table not found) by returning `[]` with no error.

4. **activeAgents**: Call the Iranti agents proxy using the same approach as `agents.ts` (fetch `GET /agents` on the active Iranti instance). 3-second timeout. Filter to agents where `isActive === true`. Cap at 6. On any failure, return `[]`.

Mount: add `overviewRouter` to `src/server/routes/control-plane/index.ts` under `/overview`.

TypeScript clean, no `any`. The route file should be under 200 lines.

**Files to create/modify:**
- `src/server/routes/control-plane/overview.ts` (new)
- `src/server/routes/control-plane/index.ts` (add mount)
- `src/server/routes/control-plane/health.ts` (export check functions)

**Frontend brief:**

You are building the Home Overview Dashboard at `src/client/src/components/overview/OverviewDashboard.tsx`.

This is the most visible deliverable in v0.4.0. It must look like a real product landing page, not a data table. Think Docker Desktop — a grid of named cards, each showing one dimension of system state.

Key layout decisions:
- 2-column card grid on wide viewports (≥ 900px), single column below
- All colors from existing CSS token variables — no hardcoded hex
- Cards use `--color-surface-1` background, `--color-accent-emerald` for positive states
- The alert banner spans full width above the card grid when health is degraded or error

Five cards + one full-width quick actions row:
1. **Alert Banner** (conditional — `health.overall !== 'healthy'`)
2. **System Status Strip** (all health checks as mini status pills, click → `/health`)
3. **KB Summary** (totalFacts, factsLast24h, activeAgentsLast7d — 3 stat cells)
4. **Recent Activity Feed** (last 8 staff events, staff component badge, relative timestamp)
5. **Active Agents** (agents active last hour, status dot, write count, last seen)
6. **Quick Actions Row** (4 action cards: Search KB, Run Diagnostics, Browse Memory, View Logs)

Route wiring changes in `main.tsx`:
- Add `<Route path="overview" element={<OverviewDashboard />} />`
- Change root redirect from `/health` to `/overview`

Nav wiring changes in `AppShell.tsx`:
- Add `{ to: '/overview', label: 'Home', icon: '⌂', phase: 1 }` as the first NAV_ITEMS entry
- Add `'/overview': 'Overview'` to SECTION_TITLES
- Remove the `useEffect` that redirects `/` to `/memory` (main.tsx handles it now)

Use TanStack Query with `refetchInterval: 30_000` to poll the overview endpoint.

**Files to create/modify:**
- `src/client/src/components/overview/OverviewDashboard.tsx` (new)
- `src/client/src/components/overview/OverviewDashboard.module.css` (new)
- `src/client/src/main.tsx` (add route, change redirect)
- `src/client/src/components/shell/AppShell.tsx` (Home nav item, SECTION_TITLES, remove redirect effect)

**Acceptance criteria to verify before marking done:**
All 12 ACs in the ticket. Key ones: AC-1 (backend endpoint returns correct shape), AC-3 (alert banner shows on degraded health), AC-9 (Home is the landing page), AC-10 (Terminals palette compliance), AC-11 (tsc clean both sides).

---

### CP-T069 — Proactive Health Alert Toasts

**Priority:** P2
**Assigned:** frontend_developer
**Ticket:** `docs/tickets/cp-t069.md`
**Dependency:** CP-T068 must be PM-ACCEPTED first

**Brief:**

This ticket is frontend-only. It adds a lightweight global toast/notification system to the shell that proactively alerts operators when health degrades — while they are using any view, without them visiting `/health`.

Infrastructure to build:
- `useToasts` hook — manages toast state (add, dismiss, deduplicate by title)
- `Toast` component — severity-colored (error/warn/info), with optional action link, auto-dismiss timer, dismiss button
- `ToastContainer` — fixed-position container at bottom-right, max 4 visible

The health poller (60-second interval, separate from the 30-second API reachability check) detects state transitions (`healthy → degraded`, `healthy → error`, `degraded/error → healthy`) and fires toasts accordingly. Only fires on transition — not every 60 seconds while degraded.

Mount `<ToastContainer />` in `AppShell.tsx` after `<ChatPanel />`.

**Files to create/modify:**
- `src/client/src/components/ui/Toast.tsx` (new)
- `src/client/src/components/ui/Toast.module.css` (new)
- `src/client/src/components/ui/ToastContainer.tsx` (new)
- `src/client/src/components/ui/ToastContainer.module.css` (new)
- `src/client/src/hooks/useToasts.ts` (new)
- `src/client/src/components/shell/AppShell.tsx` (mount ToastContainer, add health poller)

**Acceptance criteria to verify before marking done:**
All 11 ACs in the ticket. Key ones: AC-3 (deduplication), AC-4/5 (correct severity on state transition), AC-8 (no toast spam), AC-10 (tsc clean).

---

### CP-T070 — Global Keyboard Shortcuts: View Navigation Hotkeys

**Priority:** P3
**Assigned:** frontend_developer
**Ticket:** `docs/tickets/cp-t070.md`
**Dependency:** CP-T068 must be PM-ACCEPTED first (defines `/overview` route that `G+H` navigates to)

**Brief:**

This ticket is frontend-only. It adds `G + <key>` two-key navigation shortcuts — the GitHub/Linear "go to" pattern — that let operators navigate to any view without touching the mouse.

The core implementation is a `useViewNavigationShortcuts` hook. It:
1. Listens for a `G` keypress (with no input focused, no modifiers held)
2. Activates "go mode" for 1500ms
3. On the next keypress, navigates to the mapped route or cancels

Visual feedback: a fixed go-mode chip at bottom-right while go mode is active ("go mode — press a key").

12 shortcuts total (`G+H` → Home, `G+M` → Memory, `G+D` → Diagnostics, etc.). See ticket for full mapping.

Command palette: add a "Navigation shortcuts" section to the shortcuts panel (shown on `?` in the palette).

**Files to create/modify:**
- `src/client/src/hooks/useViewNavigationShortcuts.ts` (new)
- `src/client/src/components/shell/AppShell.tsx` (call hook, render go mode chip)
- `src/client/src/components/shell/CommandPalette.tsx` (add navigation shortcuts section)
- `src/client/src/components/shell/AppShell.module.css` (go mode chip styles)

**Acceptance criteria to verify before marking done:**
All 8 ACs in the ticket. Key ones: AC-3 (no fire when input has focus), AC-4 (go mode indicator appears), AC-5 (modifier keys excluded), AC-8 (no regressions).

---

## PM Review Protocol

When each ticket is complete, the assigned agent must:

1. List every AC with PASS / FAIL / N-A status
2. Run `tsc --noEmit` in both `src/server` and `src/client` and report the exit codes
3. Describe any deviation from the ticket spec with rationale
4. Note any risks or follow-on items for v0.4.1

The PM will review all ACs before marking PM-ACCEPTED. Work is not done until PM-ACCEPTED is recorded here.

---

## Sequencing

CP-T068 is P1 and must be accepted before CP-T069 and CP-T070 begin — they depend on the `/overview` route existing and the shell integration pattern established there.

CP-T069 and CP-T070 can be worked in parallel after CP-T068 acceptance, by the same or different frontend_developer instances.

The backend half of CP-T068 can proceed in parallel with the frontend half — they share no code, only the API contract defined in the ticket.
