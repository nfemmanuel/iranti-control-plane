# Cross-Repo Audit — Iranti v0.2.16

**Prepared by:** product_manager
**Date:** 2026-03-21
**Iranti version audited:** 0.2.16 (released 2026-03-21)
**Source files read:**
- `C:\Users\NF\Documents\Projects\iranti\CHANGELOG.md` (full)
- `C:\Users\NF\Documents\Projects\iranti\src\api\routes\memory.ts` (session recovery routes)
- `C:\Users\NF\Documents\Projects\iranti\src\lib\runtimeLifecycle.ts` (runtime lifecycle)
- `C:\Users\NF\Documents\Projects\iranti\src\api\server.ts` (API surface and runtime integration)

---

## What Changed in v0.2.16

The v0.2.16 release is the most significant Iranti release since v0.2.0. Three major capability areas were added:

### 1. Durable Interrupted-Session Recovery

New REST routes under `/memory`:

| Route | Method | Description |
|-------|--------|-------------|
| `/memory/checkpoint` | POST | Save session state — agent, task, recent messages, checkpoint data, sessionId, heartbeatAt |
| `/memory/resume` | POST | Resume a checkpointed session by agentId + sessionId |
| `/memory/complete` | POST | Mark a session as complete by agentId + sessionId |
| `/memory/abandon` | POST | Abandon a session by agentId + sessionId |

These join the existing `/memory/handshake`, `/memory/reconvene`, `/memory/observe`, `/memory/attend`, `/memory/maintenance`, and `/memory/whoknows` routes.

The SDK methods are: `iranti.checkpoint(...)`, `iranti.resumeSession(...)`, `iranti.completeSession(...)`, `iranti.abandonSession(...)`.

**Session states implied by the API surface:**
- `interrupted` — session was checkpointed but not resumed (inferred from the checkpoint/resume split)
- `checkpointed` — actively saved, resumable
- `complete` — operator or agent explicitly completed it
- `abandoned` — operator or agent explicitly abandoned it

The TypeScript client (`@iranti/sdk`) and Python client now expose these flows. Operator docs and quickstart guidance now describe checkpointed recovery behavior.

### 2. Runtime Lifecycle Tracking

New module: `src/lib/runtimeLifecycle.ts`

**Data model — `InstanceRuntimeMetadata`:**

```typescript
type InstanceRuntimeStatus = 'starting' | 'running' | 'stopping' | 'stopped';

type InstanceRuntimeMetadata = {
    instanceName: string;
    instanceDir: string;
    envFile: string;
    runtimeFile: string;
    version: string;
    pid: number;
    ppid: number;
    port: number;
    startedAt: string;
    lastHeartbeatAt: string;
    updatedAt: string;
    status: InstanceRuntimeStatus;
    healthUrl?: string;
    exitCode?: number | null;
    exitSignal?: string | null;
    requestLogFile?: string;
    packageRoot?: string;
};
```

**Persistence:** The API server writes `runtime.json` inside the instance directory on startup, refreshes `lastHeartbeatAt` every 15 seconds, and marks `status: 'stopped'` on SIGINT/SIGTERM.

**Health endpoint change:** `GET /health` now includes a `runtime` field:

```json
{
  "status": "ok",
  "version": "0.2.16",
  "provider": "...",
  "runtime": {
    "instanceName": "...",
    "pid": 12345,
    "port": 3001,
    "startedAt": "...",
    "lastHeartbeatAt": "...",
    "status": "running",
    ...
  }
}
```

This `runtime` field is `null` for instances not launched via `iranti run` (ad-hoc/dev mode).

**CLI visibility:** `iranti status` and `iranti instance list` now show running vs stale instances by reading `runtime.json` and checking if the PID is alive.

**Staleness determination:** A process is considered stale when `runtime.json` exists (status = "running") but the PID is no longer alive (`process.kill(pid, 0)` throws). The control plane can determine this by reading the runtime field from `GET /health` or by checking `lastHeartbeatAt` age.

### 3. Upgrade Coordination

`iranti upgrade` now supports `--restart --instance <name>` — after installing a new version, it coordinates a restart for the named running instance. This is a new operator workflow that currently requires the CLI.

### 4. B6 Fix (ingest contamination)

The CHANGELOG states: "`iranti_ingest` prose extraction is now benchmark-confirmed working in v0.2.16." Benchmark rerun validation was performed across ingest, relationships, search, observe, attend, persistence, and exact lookup as part of the v0.2.16 release. This closes the B6 defect that was confirmed as critical in prior audit cycles.

### 5. Relationship Traversal Confirmation

Relationship traversal (write → read → depth traversal) is now benchmark-confirmed working end-to-end. This is not a new feature but confirms that B9 (no MCP read tool for relationships) remains open while the underlying data layer is working.

### 6. Honest Product Boundary Documentation

Iranti's product boundary is now documented more narrowly: "structured memory infrastructure is the strong claim; full semantic-paraphrase retrieval and fully autonomous extraction are not yet." This is relevant for how the control plane presents Iranti's capabilities to operators.

---

## Section 1: New API Routes the Control Plane Does Not Yet Surface

### 1a. Session Recovery Routes

**Routes:** `POST /memory/checkpoint`, `POST /memory/resume`, `POST /memory/complete`, `POST /memory/abandon`

**Current control plane exposure:** None. The control plane has no session state surface whatsoever. The Agent Registry (CP-T051) shows agents but not their session states. There is no way for an operator to see which sessions are interrupted, which are checkpointed, or to resume/abandon a session from the UI.

**What would need to be built:**
- A proxy endpoint in the control plane's API: `GET /api/control-plane/sessions` — list sessions by state
- A session detail endpoint: `GET /api/control-plane/sessions/:sessionId`
- Frontend: a Sessions view (or a panel in the Agent Registry) showing sessions grouped by state
- Optional write surfaces: resume and abandon actions (operator-triggered)

**Recommended response:** Surface it — CP-T071. This is meaningful operator tooling. Interrupted/abandoned sessions are invisible without this surface.

### 1b. Runtime Lifecycle Data (expanded `/health` response)

**Route:** `GET /health` (existing, but response shape changed)

**Current control plane exposure:** The health proxy (`GET /api/control-plane/health`) reads the Iranti health endpoint. However, the control plane's health processing does not extract or surface the new `runtime` field. The Instance Manager shows instance metadata from env files but has no concept of "is this instance's process actually running right now?"

**What would need to be built:**
- Extract `runtime` from the health response in the control plane's health endpoint
- Surface PID, startedAt, lastHeartbeatAt, and status (running/stale/stopped) in the Instance Manager
- Determine staleness: if `runtime.status === 'running'` but `lastHeartbeatAt` is more than ~30s old, the process may be dead

**Recommended response:** Surface it — CP-T072. Live vs stale instance status is a meaningful operational signal. Operators currently cannot tell if `iranti run` crashed without checking the terminal.

### 1c. Upgrade Coordination CLI Flow

**CLI command:** `iranti upgrade --restart --instance <name>`

**Current control plane exposure:** None. The Instance Manager shows instances but has no upgrade or restart actions.

**What would need to be built:**
- A proxy endpoint: `POST /api/control-plane/instances/:name/upgrade` — calls `iranti upgrade --restart --instance <name>` as a subprocess
- Frontend: an upgrade button or action in the Instance Manager's instance detail panel

**Recommended response:** Surface it — CP-T073. This is a natural fit for the Instance Manager and reduces operator dependency on the terminal for upgrade workflows.

---

## Section 2: Changed Endpoints the Control Plane Depends On

### 2a. `GET /health` — `runtime` field added

**Impact:** The control plane's health endpoint proxies this response and passes fields through to the frontend. The new `runtime` field is currently passed through as opaque data but never displayed. No regression — the change is additive.

**Action required:** CP-T072 will consume this field explicitly. Until then, the control plane should be updated to at least forward the `runtime` field in `HealthResponse` types even if the frontend doesn't display it.

### 2b. `/memory` route family — four new routes

**Impact:** The control plane's proxy layer does not proxy these routes and has no session-state concept. The existing `/memory/handshake`, `/memory/reconvene`, `/memory/observe`, and `/memory/attend` routes are not used by the control plane (they are used by agents via the Iranti API directly). No regression.

**Action required:** CP-T071 will add session visibility, not a proxy for agent-facing session management routes.

### 2c. No changes to `/kb`, `/agents`, `/metrics` routes

Confirmed from the CHANGELOG and source: no changes to KB, agents, or metrics endpoints in v0.2.16. All existing control plane KB search, entity type browser, memory explorer, agent registry, and metrics dashboard integrations are unaffected.

---

## Section 3: Product Claims Now Stale Due to v0.2.16

### 3a. B6 in upstream-bug-flags-2026-03-21.md

**Previous claim:** "B6 (ingest contamination): Critical — Unfixed as of v0.2.14. Use `iranti_write` instead."

**Current reality:** FIXED in v0.2.16. The claim is stale. Updated in upstream-bug-flags-2026-03-21.md as part of this session's Job 1 drift corrections.

### 3b. B6 workaround in v0.3.0 release notes

**Previous claim:** Getting Started guide and v0.3.0 Known Issues advised using `iranti_write` for critical fact population.

**Current reality:** This workaround is no longer needed on v0.2.16+. Updated in v0.3.0 release notes as part of this session's Job 1 drift corrections. The Getting Started guide should be updated as a Phase 5 documentation pass.

### 3c. "Iranti v0.2.15" in v0.3.0 release notes (alias API shape reference)

**Previous claim:** The v0.3.0 release notes reference "real Iranti v0.2.15 alias API shape exactly" (CP-T061/T065 note in the release notes). This is technically accurate but the current version is 0.2.16.

**Current reality:** No change to the alias API in v0.2.16. The reference is not wrong, just refers to an older version. Low priority — no correction needed.

### 3d. resume-next-session.md version context

**Previous claim:** Shows Wave 9 as in-progress and Iranti version as 0.2.15.

**Current reality:** Wave 9 and Wave 10 are complete. Iranti is at 0.2.16. Fully rewritten in this session's Job 1 drift corrections.

### 3e. Iranti's product boundary (new in v0.2.16)

**New claim from upstream:** Iranti now documents its product boundary more narrowly — "structured memory infrastructure is the strong claim; full semantic-paraphrase retrieval and fully autonomous extraction are not yet."

**Control plane implication:** The Getting Started guide, KB search UI, and diagnostics panel should be reviewed to ensure they do not overstate Iranti's semantic retrieval capabilities. The vector_search_check diagnostic and the "Falls back to lexical-only" note in CP-T066 are already appropriately hedged. No immediate correction needed but worth reviewing in Phase 5 documentation pass.

---

## Section 4: Recommended Control Plane Response

| Capability | Recommendation | Ticket |
|------------|---------------|--------|
| Session recovery routes (checkpoint, resume, complete, abandon) | **Surface it** — build a Session Recovery Visibility view | CP-T071 |
| Runtime lifecycle metadata in `/health` | **Surface it** — add running vs stale status to Instance Manager | CP-T072 |
| Upgrade coordination (`iranti upgrade --restart --instance`) | **Surface it** — add upgrade action to Instance Manager | CP-T073 |
| B6 fix (ingest contamination) | **Note it** — update docs, no new UI needed | Job 1 (done) |
| Relationship traversal benchmark confirmation | **Note it** — confirms B9 is about MCP tooling gap only, not data layer | No ticket needed |
| Honest product boundary docs | **Note it** — review Getting Started and diagnostics copy in Phase 5 | Documentation pass |
| TypeScript client session recovery methods | **Ignore for now** — agent-facing SDK change, not operator-facing | Phase 5+ |

---

## New API Endpoints Summary (v0.2.16)

```
POST /memory/checkpoint    — save session state
POST /memory/resume        — resume a checkpointed session
POST /memory/complete      — mark session complete
POST /memory/abandon       — abandon a session
```

**Modified endpoints:**
```
GET /health                — now includes runtime: InstanceRuntimeMetadata | null
```

**Unchanged endpoints that the control plane depends on:**
```
GET /kb/search             — unchanged (used by CP-T066)
GET /kb/related            — unchanged (used by CP-T032, B9 still open)
GET /agents                — unchanged (used by CP-T051)
GET /metrics               — unchanged (used by CP-T060)
GET /kb/query              — unchanged (used by Memory Explorer)
POST /memory/handshake     — unchanged
POST /memory/reconvene     — unchanged
POST /memory/observe       — unchanged
POST /memory/attend        — unchanged
```

---

## Risk Assessment

**Low risk:** All v0.2.16 changes are additive. No breaking changes to existing control plane integrations. The `runtime` field in `/health` is additive; the session routes are new; the upgrade CLI flag is new. No existing functionality is affected.

**Medium risk:** If operators upgrade Iranti to v0.2.16 before Phase 5 ships, they will have session recovery and runtime lifecycle capabilities in Iranti that are invisible in the control plane. This is not a regression but represents a growing gap between Iranti's capabilities and the control plane's surface. Phase 5 should ship promptly.

**No risk:** B6 being fixed does not break anything in the control plane. The `iranti_write` workaround path still works — it just isn't required anymore. The diagnostics panel's `ingest_roundtrip` check continues to function correctly.
