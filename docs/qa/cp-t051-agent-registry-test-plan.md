# QA Test Plan — CP-T051: Agent Registry View

**Ticket:** CP-T051
**Date:** 2026-03-21
**QA Engineer:** qa_engineer
**Status:** Draft — pending implementation

## Overview

Tests the Agent Registry view, which exposes Iranti's `GET /agents` and `GET /agents/:agentId` endpoints through the control plane proxy. This covers the backend proxy routes (`/api/control-plane/agents`, `/api/control-plane/agents/:agentId`) and the frontend list view, detail drawer, empty state, and 503 state.

## Prerequisites

- [ ] Implementation complete (`src/server/routes/control-plane/agents.ts` already exists as of 2026-03-21 — verify frontend is also wired)
- [ ] TypeScript compiles cleanly (`tsc --noEmit`)
- [ ] All existing tests pass (`npx vitest run`)
- [ ] Dev server running at `http://localhost:3000` (or the port shown in startup output)
- [ ] Iranti instance running at `http://localhost:3001` with a valid API key that has `agents:read` scope
- [ ] At least one agent registered in Iranti (confirm with `curl http://localhost:3001/agents -H "X-Iranti-Key: <key>"`)
- [ ] The `.env.iranti` file has `IRANTI_URL=http://localhost:3001` and `IRANTI_API_KEY=<key>`
- [ ] Know the `agentId` of at least one registered agent (e.g., `product_manager`) to use in detail drawer tests

---

## Test Cases

### TC-1 — `GET /api/control-plane/agents` returns normalized list (AC-1)

**AC:** AC-1 — Proxy `GET /agents`, return `{ agents: [AgentRecord], total: N }`

**Test steps:**
1. Ensure Iranti is running and at least one agent is registered.
2. Open a terminal. Run:
   ```bash
   curl -s http://localhost:3000/api/control-plane/agents | jq .
   ```
3. Confirm the HTTP response status is `200`.
4. Inspect the response body.

**Expected result:**
- Response is `200 OK`.
- Body shape: `{ "agents": [...], "total": N }` where `N` is an integer matching `agents.length`.
- Each agent object contains: `agentId` (string), `name` (string), `stats` (object with `totalWrites`, `totalRejections`, `totalEscalations`, `avgConfidence`, `lastSeen`, `isActive`).
- No snake_case keys (e.g., `agent_id` must NOT appear — should be `agentId`).
- `total` equals `agents.length`.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-2 — `GET /api/control-plane/agents` response normalization from Iranti array (AC-1 variant)

**AC:** AC-1 — Handle both Iranti response shapes (bare array vs `{ agents: [] }` wrapper)

**Test steps:**
1. Check the actual Iranti `GET /agents` response shape: `curl -s http://localhost:3001/agents -H "X-Iranti-Key: <key>" | jq 'keys'`
2. Note whether Iranti returns a bare array or a `{ agents: [...] }` object.
3. Call the control plane proxy: `curl -s http://localhost:3000/api/control-plane/agents | jq '{total, agentCount: (.agents | length)}'`

**Expected result:**
- Regardless of Iranti's response shape, the control plane always returns `{ agents: [...], total: N }`.
- `total` equals the number of items in `agents`.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-3 — `GET /api/control-plane/agents/:agentId` returns single agent (AC-2)

**AC:** AC-2 — Proxy `GET /agents/:agentId`; 404 if not found

**Test steps:**
1. Use the `agentId` of a known registered agent (e.g., `product_manager`).
2. Run:
   ```bash
   curl -s http://localhost:3000/api/control-plane/agents/product_manager | jq .
   ```
3. Confirm `200` status and full agent record.
4. Then test a non-existent agent:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/control-plane/agents/nonexistent_agent_xyz
   ```

**Expected result:**
- Known agent: `200` with `{ agentId: "product_manager", name: "...", stats: { ... }, capabilities: [...], model: "...", properties: {...}, description: "..." }`.
- Non-existent agent: `404` with `{ "error": "Agent not found", "code": "NOT_FOUND" }`.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-4 — 503 state when Iranti is unreachable (AC-3, AC-9)

**AC:** AC-3 — Return HTTP 503 with `AGENTS_UNAVAILABLE` on auth failure or unreachability; AC-9 — Frontend 503 empty state

**Test steps:**
1. Stop the Iranti process (`kill <pid>` or `pkill iranti`). Confirm it is not responding: `curl http://localhost:3001/health` should time out or refuse connection.
2. Navigate to `http://localhost:3000/agents` in the browser.
3. Observe the Agents view.
4. Also verify the backend directly:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/control-plane/agents
   ```
5. Restart Iranti and confirm the view recovers on refresh.

**Expected result (backend):**
- HTTP `503` with body `{ "error": "Iranti instance unreachable", "code": "AGENTS_UNAVAILABLE" }`.

**Expected result (frontend):**
- The Agents view shows the same 503 empty state pattern used in other views (e.g., Staff Logs 503 state). Not a blank screen and not a generic error boundary.
- Message must reference the connection issue (not just "Unknown error").
- After Iranti restarts, refreshing the page shows the agent list.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-5 — 503 state when API key lacks `agents:read` scope (AC-3, AC-4)

**AC:** AC-3 — 503 on 401/403; AC-4 — Auth key forwarded correctly

**Test steps:**
1. Temporarily set `IRANTI_API_KEY` in `.env.iranti` to a key that lacks `agents:read` scope (or a deliberately invalid key like `invalid-key-no-scope`).
2. Restart the control plane dev server.
3. Run:
   ```bash
   curl -s http://localhost:3000/api/control-plane/agents
   ```

**Expected result:**
- HTTP `503` with `{ "error": "Iranti agents:read scope required", "code": "AGENTS_UNAVAILABLE" }`.
- The frontend Agents view shows the 503 empty state.

**Note:** Restore the valid API key after this test and restart the dev server.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-6 — `X-Iranti-Key` header forwarded from request (AC-4)

**AC:** AC-4 — Control plane forwards `X-Iranti-Key` header

**Test steps:**
1. With Iranti running, make a request to the proxy passing the API key explicitly as a request header:
   ```bash
   curl -s -H "X-Iranti-Key: <valid_key_with_agents_read>" http://localhost:3000/api/control-plane/agents | jq '.total'
   ```
2. Also make a request without the header (relying on the env key):
   ```bash
   curl -s http://localhost:3000/api/control-plane/agents | jq '.total'
   ```

**Expected result:**
- Both requests return `200` with agent data.
- The explicit header takes precedence over the env-configured key.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-7 — `/agents` sidebar navigation item present at correct position (AC-5)

**AC:** AC-5 — "Agents" nav item in sidebar, after Providers

**Test steps:**
1. Navigate to `http://localhost:3000` in the browser.
2. Locate the left sidebar navigation.
3. List the sidebar items in order.
4. Confirm "Agents" appears after "Providers" in the navigation order.
5. Confirm an icon is present next to the "Agents" label (person-group or similar from Lucide).
6. Click "Agents" and confirm navigation to `/agents` or the equivalent route.

**Expected result:**
- "Agents" sidebar item is visible.
- It is positioned after "Providers" (8th position, before "Getting Started" if that link exists).
- Clicking it navigates to the Agent Registry view without a full page reload (SPA routing).
- An appropriate icon is shown (not a placeholder or broken icon).

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-8 — Agent list view renders all required columns (AC-6)

**AC:** AC-6 — Table with Agent ID, Display Name, Last Seen, Active indicator, Total Writes, Rejections, Escalations, Avg Confidence

**Test steps:**
1. Navigate to `http://localhost:3000/agents`.
2. With at least one registered agent, observe the table.
3. For a known agent (e.g., `product_manager` with known stats), verify each column:
   a. Agent ID column shows the `agentId` string (e.g., `product_manager`).
   b. Display Name column shows `name` field (may be same as agentId if equal).
   c. Last Seen shows a relative time (e.g., "2 hours ago" or "just now") — hover to confirm absolute timestamp appears.
   d. Active indicator: if `isActive: true`, a green dot is shown; if `isActive: false`, a grey dot is shown.
   e. Total Writes: integer matching `stats.totalWrites`.
   f. Rejections: integer matching `stats.totalRejections`. If `totalRejections > 0` and high relative to writes, the value should appear red.
   g. Escalations: integer matching `stats.totalEscalations`. If `> 0`, the value should appear amber.
   h. Avg Confidence: percentage matching `stats.avgConfidence` (e.g., "85%").
4. Confirm the table defaults to sorted by `lastSeen` descending (most recently seen agent at the top).

**Expected result:**
- All eight columns are present and populated correctly.
- Color-coding for Rejections (red when high) and Escalations (amber when > 0) is visible.
- Sort is descending by Last Seen by default.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-9 — Agent detail drawer opens with full agent data (AC-7)

**AC:** AC-7 — Clicking a row opens detail view with all stat fields, capabilities, model, properties, description

**Test steps:**
1. Navigate to `http://localhost:3000/agents`.
2. Click on the row for a known agent (e.g., `product_manager`).
3. A detail drawer or detail page should open.
4. Verify the following are present in the detail view:
   a. All stat fields from the list view (totalWrites, totalRejections, totalEscalations, avgConfidence, lastSeen, isActive indicator).
   b. `capabilities` array — if non-empty, items are shown; if empty, this section is either absent or shows an empty state message (not "null" or "[]" raw).
   c. `model` field (e.g., "claude-sonnet-4-6").
   d. `properties` raw JSON — expandable section, not displayed as "[object Object]".
   e. `description` field (if non-null).
5. Confirm the drawer uses the Terminals palette (emerald accent, near-black canvas) consistent with other detail views in the product.

**Expected result:**
- Drawer/detail page shows all six content areas listed above.
- Capabilities array is rendered as a readable list, not raw JSON.
- Properties section is expandable raw JSON.
- Visual palette matches the existing product style.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-10 — Empty state when no agents are registered (AC-8)

**AC:** AC-8 — "No agents registered yet" message when `total: 0`

**Test steps:**
1. Confirm the empty state can be triggered. Option A: use an Iranti instance with no registered agents. Option B: manually return a mocked empty response by temporarily intercepting with a proxy.
2. If Option A, call: `curl http://localhost:3001/agents -H "X-Iranti-Key: <key>"` and confirm the array is empty.
3. Navigate to `http://localhost:3000/agents`.
4. Observe the page content.

**Expected result:**
- The page does not show an error or the 503 state.
- A clear empty state message is shown: "No agents registered yet. Agents appear here after their first `iranti_handshake` call."
- The message uses code styling for `iranti_handshake` (inline code or monospace).
- No table is rendered (avoids rendering an empty table with column headers and no rows).

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-11 — Stretch: Sidebar badge for stale agents with escalations (AC-10)

**AC:** AC-10 (stretch) — Badge on "Agents" nav item for agents with `isActive: false`, `lastSeen > 24h`, `totalEscalations > 0`

**Test steps:**
1. Confirm whether AC-10 was implemented (check with frontend_developer).
2. If implemented: register or mock an agent with `isActive: false`, `lastSeen` more than 24 hours ago, and `totalEscalations > 0`.
3. Observe the "Agents" sidebar item.

**Expected result (if implemented):**
- A subtle count badge appears on the Agents nav item, showing the count of qualifying agents.
- The badge is not shown when no agents meet the criteria.
- The badge does not overlap or obscure the nav item label.

**Expected result (if not implemented):**
- No badge is shown; no visual regression on the sidebar.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked / [ ] N/A (not implemented)

---

## Edge Cases

1. **Agent with all-zero stats** — An agent registered via `iranti_handshake` but that has never written, rejected, or escalated anything. All numeric stat fields should show `0`, not `null` or `undefined`. The active indicator should reflect `isActive` correctly.

2. **Agent `name` identical to `agentId`** — Most agents use an ID like `product_manager` and a display name like `"Product Manager"`. If the API returns `name: "product_manager"` (same as ID), the table should still show both columns without collapsing them into one.

3. **Agent with `lastSeen: null`** — If `lastSeen` is null (agent registered but never called the API), the Last Seen column should render "Never" or an appropriate null state — not "null", "Invalid Date", or a JS error.

4. **Agent with `capabilities: []` (empty array)** — The detail drawer's Capabilities section should either be omitted or show an appropriate empty state — not an empty bullet list or `[]`.

5. **Large number of agents (20+)** — The agent list should handle pagination or scrolling gracefully. If pagination is not implemented, the table must at least scroll without breaking layout. Performance: the page should load and render within 3 seconds for up to 50 agents.

6. **Rapid tab switching** — Navigate away from the Agents view and back while the fetch is in-flight. The component should not throw a React state-update-on-unmounted-component error (check browser console for warnings).

---

## Regression Checks

1. **Providers view unchanged** — Navigate to the Providers view and confirm it still loads correctly. The new `agents.ts` route must not conflict with the `providers.ts` router registration in `index.ts`.

2. **Health view unchanged** — Navigate to the Health Dashboard and confirm all existing health checks render. No new health checks should have been unintentionally added or removed by this ticket.

3. **Sidebar layout** — Verify that inserting the new "Agents" nav item does not push any existing items off-screen or break the sidebar scroll on narrow viewports (test at 1280px wide and 768px wide).

4. **Staff Logs 503 state** — Navigate to Staff Logs with Iranti stopped. Confirm the Staff Logs 503 state still uses its original pattern and was not accidentally replaced by the new agents 503 state component.

5. **Memory Explorer unchanged** — Navigate to the Memory Explorer and confirm KB fact browsing still works. The agents route is a new sibling route — it must not shadow the existing `/kb` or `/memory` paths.

---

## Known Limitations / Deferred

- **AC-10 (sidebar badge)** is explicitly marked as a stretch goal. It is acceptable for this ticket to ship without the badge.
- **Write operations** are not in scope — this is a read-only view. No create/update/delete agent controls should be present.
- **Agent filtering/search** is not specified in the ACs. If the frontend includes a filter input, it should be noted as out-of-scope and tested only to confirm it does not break the basic list.
- **Real-time updates** (auto-refresh of the agent list) are not specified. The view is expected to reflect the state at load time until the user manually refreshes.
