# QA Test Plan — CP-T052: Health View: Decay Config + Vector Backend + Attend Status

**Ticket:** CP-T052
**Date:** 2026-03-21
**QA Engineer:** qa_engineer
**Status:** Draft — pending implementation (backend already partially implemented in `health.ts` as of 2026-03-21)

## Overview

Tests three new sections added to the Health Dashboard: the Memory Decay configuration card (reading `IRANTI_DECAY_*` env vars), the Vector Backend card (reading `IRANTI_VECTOR_BACKEND` and probing qdrant/chroma URLs), and the Attendant informational card (a static message about CP-T025 limitations). The backend implementation in `health.ts` already exists and can be tested at the API level; frontend card rendering requires the implementation to be wired into `HealthDashboard.tsx`.

## Prerequisites

- [ ] Implementation complete: `src/server/routes/control-plane/health.ts` extended with `buildDecayConfig()`, `buildVectorBackendInfo()`, `buildAttendantStatus()` (already implemented as of 2026-03-21 — verify the health endpoint returns these fields)
- [ ] Frontend cards added to `src/client/src/components/health/HealthDashboard.tsx`
- [ ] TypeScript compiles cleanly (`tsc --noEmit`)
- [ ] All existing tests pass (`npx vitest run`)
- [ ] Dev server running at `http://localhost:3000`
- [ ] Iranti instance running at `http://localhost:3001`
- [ ] Access to edit `.env.iranti` to set/unset `IRANTI_DECAY_ENABLED`, `IRANTI_VECTOR_BACKEND`, and related vars
- [ ] Server restart after each `.env.iranti` change (the control plane reads env vars at process start via `db.ts`)

---

## Test Cases

### TC-1 — Health endpoint includes `decay` section (AC-1)

**AC:** AC-1 — Extend `GET /api/control-plane/health` to include decay config

**Test steps:**
1. Ensure `.env.iranti` does NOT set `IRANTI_DECAY_ENABLED` (or set it to `false`). Restart the dev server.
2. Run:
   ```bash
   curl -s http://localhost:3000/api/control-plane/health | jq '.decay'
   ```
3. Confirm the `decay` section is present.
4. Check each field value matches env expectations.

**Expected result:**
- Response contains `"decay": { "enabled": false, "stabilityBase": 30, "stabilityIncrement": 5, "stabilityMax": 365, "decayThreshold": 10 }` (all defaults when vars are unset).
- If `IRANTI_DECAY_ENABLED=false` is explicitly set, same result.
- All values are numbers (not strings). `enabled` is a boolean.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-2 — Decay config reflects `IRANTI_DECAY_ENABLED=true` (AC-1)

**AC:** AC-1 — Decay config reads from env

**Test steps:**
1. Set in `.env.iranti`:
   ```
   IRANTI_DECAY_ENABLED=true
   IRANTI_DECAY_STABILITY_BASE=45
   IRANTI_DECAY_STABILITY_INCREMENT=10
   IRANTI_DECAY_STABILITY_MAX=180
   IRANTI_DECAY_THRESHOLD=15
   ```
2. Restart the dev server.
3. Run:
   ```bash
   curl -s http://localhost:3000/api/control-plane/health | jq '.decay'
   ```

**Expected result:**
- `"decay": { "enabled": true, "stabilityBase": 45, "stabilityIncrement": 10, "stabilityMax": 180, "decayThreshold": 15 }`.
- All values match what was set in env (numbers parsed as integers, not strings).

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-3 — Decay card in Health Dashboard: decay disabled state (AC-5)

**AC:** AC-5 — "Memory Decay" card in Health Dashboard; disabled state shows explanatory message

**Test steps:**
1. Ensure `IRANTI_DECAY_ENABLED` is unset or `false`. Restart dev server.
2. Navigate to `http://localhost:3000` → Health view.
3. Locate the "Memory Decay" card.
4. Observe the card content.

**Expected result:**
- Card labeled "Memory Decay" is visible in the Health Dashboard below the existing health checks.
- **Enabled** row shows "No" (or equivalent negative indicator). The status indicator is **green** (disabled = healthy, no unexpected archiving).
- A message is shown: "Memory decay is disabled. Facts are archived only by expiry, low confidence (< 30), or Resolutionist resolution."
- The decay threshold and stability range rows are still visible (showing defaults: threshold 10, range 30–365 days) or are omitted when disabled — document whichever behavior is implemented.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-4 — Decay card in Health Dashboard: decay enabled state (AC-5)

**AC:** AC-5 — Enabled state uses amber indicator to signal decay is active

**Test steps:**
1. Set `IRANTI_DECAY_ENABLED=true`, `IRANTI_DECAY_THRESHOLD=15`, `IRANTI_DECAY_STABILITY_BASE=30`, `IRANTI_DECAY_STABILITY_MAX=365` in `.env.iranti`. Restart dev server.
2. Navigate to the Health view.
3. Locate the "Memory Decay" card.

**Expected result:**
- **Enabled** row shows "Yes" with an **amber** status indicator (not green — decay being active is noteworthy, operators should be aware).
- **Decay threshold** row shows "15 confidence" (or "Confidence below 15 triggers archiving").
- **Stability range** row shows "30–365 days".
- The card uses the existing four-tier severity taxonomy: this card's overall status is "Informational" or "Warning" (amber) when decay is enabled — not "Healthy".

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-5 — Health endpoint includes `vectorBackend` section — pgvector default (AC-2, AC-3)

**AC:** AC-2 — Extend health endpoint with vector backend info; AC-3 — pgvector uses existing DB check

**Test steps:**
1. Ensure `IRANTI_VECTOR_BACKEND` is unset (or set to `pgvector`) in `.env.iranti`. Restart dev server.
2. Run:
   ```bash
   curl -s http://localhost:3000/api/control-plane/health | jq '.vectorBackend'
   ```

**Expected result:**
- `"vectorBackend": { "type": "pgvector", "configured": true, "url": null, "status": "ok" }`.
- `url` is `null` (pgvector uses the primary DB connection — no separate URL).
- `status` is `"ok"` (pgvector reachability is covered by the existing `db_reachability` check).

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-6 — Health endpoint: `IRANTI_VECTOR_BACKEND` unset defaults to pgvector (AC-2)

**AC:** AC-2 — Unknown/unset backend treated as pgvector

**Test steps:**
1. Remove `IRANTI_VECTOR_BACKEND` entirely from `.env.iranti`. Restart dev server.
2. Run:
   ```bash
   curl -s http://localhost:3000/api/control-plane/health | jq '.vectorBackend'
   ```

**Expected result:**
- `"vectorBackend": { "type": "pgvector", "configured": true, "url": null, "status": "ok" }`.
- The frontend card should show "pgvector" as the type.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-7 — Health endpoint: qdrant configured but unreachable (AC-2, AC-3)

**AC:** AC-2/AC-3 — qdrant backend: URL probe attempted; error status returned if unreachable

**Test steps:**
1. Set in `.env.iranti`:
   ```
   IRANTI_VECTOR_BACKEND=qdrant
   IRANTI_QDRANT_URL=http://localhost:6333
   ```
   Restart dev server. Ensure nothing is listening on port 6333 (confirm: `curl http://localhost:6333` should fail).
2. Run:
   ```bash
   curl -s http://localhost:3000/api/control-plane/health | jq '.vectorBackend'
   ```
3. Note: the probe has a 3-second timeout (per implementation). The health endpoint call may take up to 3 seconds.

**Expected result:**
- `"vectorBackend": { "type": "qdrant", "configured": true, "url": "http://localhost:6333", "status": "error" }`.
- The overall health response status is `"degraded"` or `"error"` (reflecting the vector backend probe failure).
- The health endpoint itself still returns HTTP `200` (the endpoint always returns 200 — status is in the body).

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-8 — Health endpoint: qdrant URL missing (AC-2)

**AC:** AC-2 — If qdrant/chroma configured but URL not set, report warn

**Test steps:**
1. Set `IRANTI_VECTOR_BACKEND=qdrant` in `.env.iranti` but do NOT set `IRANTI_QDRANT_URL`. Restart dev server.
2. Run:
   ```bash
   curl -s http://localhost:3000/api/control-plane/health | jq '.vectorBackend'
   ```

**Expected result:**
- `"vectorBackend": { "type": "qdrant", "configured": false, "url": null, "status": "warn" }`.
- No HTTP probe is attempted (no URL to probe).

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-9 — Vector Backend card in Health Dashboard (AC-6)

**AC:** AC-6 — "Vector Backend" card in Health Dashboard

**Test steps:**
1. Restore `.env.iranti` to `IRANTI_VECTOR_BACKEND=pgvector` (or unset). Restart dev server.
2. Navigate to the Health view.
3. Locate the "Vector Backend" card.
4. Verify card content for pgvector.

Then test the qdrant+unreachable scenario:
5. Set `IRANTI_VECTOR_BACKEND=qdrant` + `IRANTI_QDRANT_URL=http://localhost:6333` (unreachable). Restart.
6. Navigate to the Health view and observe the Vector Backend card.

**Expected result (pgvector):**
- Card shows: Backend type = "pgvector", status indicator = green/ok, note text: "Uses primary database connection".
- No URL is shown (pgvector has no separate URL).

**Expected result (qdrant, unreachable):**
- Card shows: Backend type = "qdrant", configured URL = "http://localhost:6333", status indicator = red/error.
- Status communicates that qdrant is unreachable at the configured URL.
- Card severity is "Critical" or "Warning" per the four-tier taxonomy, not "Healthy".

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-10 — Vector Backend card: unknown backend fallback (AC-6)

**AC:** AC-6 — "IRANTI_VECTOR_BACKEND not configured — defaulting to pgvector" message when unknown

**Test steps:**
1. Set `IRANTI_VECTOR_BACKEND=someunknownvalue` in `.env.iranti`. Restart dev server.
2. Navigate to the Health view.
3. Observe the Vector Backend card.

**Expected result:**
- Backend type shows "unknown" or a clear "Unknown" label.
- A note is shown: "IRANTI_VECTOR_BACKEND not configured — defaulting to pgvector" (or equivalent informational message).
- Status is `"ok"` (the server will fall back to pgvector behavior).

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-11 — Health endpoint includes `attendant` section (AC-4)

**AC:** AC-4 — Attendant health signal always present as informational

**Test steps:**
1. With any valid `.env.iranti`, restart the dev server.
2. Run:
   ```bash
   curl -s http://localhost:3000/api/control-plane/health | jq '.attendant'
   ```

**Expected result:**
- `"attendant": { "status": "informational", "message": "Attendant status cannot be verified without native emitter injection (CP-T025). If memory injection appears to not be working, ensure entityHints are provided to iranti_observe — entity auto-detection from raw text is unreliable.", "upstreamPRRequired": "CP-T025" }`.
- `status` is always `"informational"` — never `"ok"`, `"warn"`, or `"error"`.
- `upstreamPRRequired` is `"CP-T025"`.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-12 — Attendant card in Health Dashboard is always shown (AC-7)

**AC:** AC-7 — Attendant informational card is always visible, not conditional on any state

**Test steps:**
1. Test with Iranti running (normal state).
2. Navigate to Health view. Locate the "Attendant" card.
3. Stop Iranti. Navigate to Health view again (or refresh). Locate the "Attendant" card.
4. Set `IRANTI_DECAY_ENABLED=true`. Navigate to Health view. Locate "Attendant" card.

**Expected result (all three states):**
- The "Attendant" card is present in every case.
- Status indicator uses grey or a neutral "Informational" style, not green/amber/red.
- The card message explains the CP-T025 limitation and the entityHints workaround.
- The card is NOT conditional on any env var, Iranti state, or other health check result.

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

### TC-13 — Severity taxonomy consistency across all three new cards (AC-8)

**AC:** AC-8 — All new cards use the existing four-tier severity taxonomy from CP-T028

**Test steps:**
1. Navigate to the Health Dashboard with a fresh pgvector/decay-disabled setup.
2. Open browser DevTools → Elements.
3. For each new card (Memory Decay, Vector Backend, Attendant), inspect the severity indicator component class or data attribute.
4. Confirm each uses the same severity component/class used by the pre-existing health check cards.

**Expected result:**
- All three cards use the same visual severity indicator component as the existing health checks.
- No new one-off colored divs or custom severity styles.
- Severity values are from: `{ "ok" | "warn" | "error" | "informational" }` (or however CP-T028 names the tiers — check existing card implementation and match).

**Status:** [ ] Pass / [ ] Fail / [ ] Blocked

---

## Edge Cases

1. **Invalid numeric env vars** — Set `IRANTI_DECAY_THRESHOLD=notanumber` in `.env.iranti`. The `buildDecayConfig()` function falls back to the default (10) when `parseInt` returns `NaN`. Verify the health endpoint returns `"decayThreshold": 10` (not `NaN`, `null`, or `"notanumber"`).

2. **chroma backend with reachable URL** — Set `IRANTI_VECTOR_BACKEND=chroma` and `IRANTI_CHROMA_URL=http://localhost:8000`, with something actually listening on 8000 (even a mock HTTP server that returns `200`). Confirm `status: "ok"` is returned and the card shows green.

3. **Concurrent health check failures** — Stop the database. Confirm that the health endpoint still returns the `decay`, `vectorBackend`, and `attendant` sections correctly, since these read from env vars (not DB), and the DB failure only affects the `db_reachability` check. The overall status should be `"error"` but the new sections should still be populated.

4. **Zero-value decay thresholds** — Set `IRANTI_DECAY_THRESHOLD=0`. This is technically valid (all facts below confidence 0 are archived — effectively none). Confirm the response is `"decayThreshold": 0` (not filtered as falsy).

5. **Very long qdrant URL** — Set `IRANTI_QDRANT_URL` to a URL with a very long path (200+ chars). Confirm the URL is returned verbatim in the health response and displayed in the frontend card without truncation that drops important information.

---

## Regression Checks

1. **Existing health checks still present** — After the extension, confirm all 10 original checks still appear in the `checks` array: `db_reachability`, `db_schema_version`, `vector_backend` (the old pgvector extension check — separate from the new `vectorBackend` section), `anthropic_key`, `openai_key`, `default_provider_configured`, `mcp_integration`, `claude_md_integration`, `runtime_version`, `staff_events_table`.

2. **Overall status computation** — The `overall` field (`healthy`/`degraded`/`error`) must still be computed from the `checks` array only, not from the new `decay`/`vectorBackend`/`attendant` sections. Confirm that setting `IRANTI_VECTOR_BACKEND=qdrant` with an unreachable URL does NOT change the `overall` field unless the qdrant probe is wired into the `checks` array.

   **Ambiguity flag for PM:** The ticket does not specify whether the qdrant probe result should be folded into the `checks` array (which would affect `overall`) or kept as a standalone `vectorBackend` section. The current backend implementation keeps it separate. This should be confirmed with PM before frontend severity indicators are finalized.

3. **Health endpoint response time** — With qdrant configured and unreachable, the probe times out after 3 seconds. Confirm the health endpoint returns within 5 seconds total, and that the 3-second probe timeout does not block other checks (all checks run via `Promise.allSettled` in parallel — confirm the vector probe runs in parallel with other checks and does not serialize them).

4. **No existing card layout broken** — Navigate to the Health Dashboard and confirm all existing cards (DB, Provider Keys, MCP Integration, etc.) still render with the same layout. The three new cards are additions, not replacements.

---

## Known Limitations / Deferred

- **chroma backend reachability** is implemented identically to qdrant (HTTP GET probe to configured URL). If chroma's actual API returns 4xx on a GET to its root, `status` would be `"ok"` (per implementation: `probe.status < 500`). This may produce false positives. The behavior is acceptable for now but should be noted in the release.
- **Attendant health signal** is explicitly informational because Iranti does not expose Attendant stats via `GET /health`. Full Attendant health monitoring requires CP-T025 (upstream Iranti PR). This is out of scope for this ticket.
- **qdrant/chroma not tested with real instances** — Test TC-7 uses an unreachable URL. If qdrant or chroma is actually available in the test environment, add a TC testing the `status: "ok"` path for both.
