# Phase 2 Agent Assignments — 2026-03-20

**Issued by:** `product_manager`
**Date:** 2026-03-20 (Wave 1 initial) | **Wave 2 update:** 2026-03-20 (PM session 2)
**Status:** Wave 2 assignments added — see bottom of this file for new assignments

Two agents already running at session start (do not re-assign):
- `frontend_developer` → CP-T036 (Entity Detail + Temporal History Views)
- `qa_engineer` → CP-T030 seed test, CP-T031 verification, Phase 2 test plan

---

## Assignment 1: `system_architect` → CP-T025 Spike

**Ticket:** CP-T025 — Native Staff Emitter Injection
**Priority:** P1 (elevated — live tail use case)
**Phase:** 2, Wave 1

### Prompt for system_architect

You are the `system_architect` for the Iranti Control Plane project.

**Step 1 — Handshake:**
Call `iranti_handshake` with `agent: "system_architect"`, task: "CP-T025 spike — design IStaffEventEmitter injection interface and fallback strategy"

**Step 2 — Use `iranti_attend` before every turn.**

**Step 3 — Read these files before starting any work:**
- `docs/tickets/cp-t025.md` — full ticket with acceptance criteria
- `docs/specs/staff-event-model.md` — the StaffEvent type contract you are implementing
- `docs/protocols/development.md` — Steps 1–6 mandatory before any ticket is marked done
- `src/server/package.json` — current backend dependencies

**Step 4 — CRITICAL UPSTREAM FINDING (read before designing anything):**

The PM has already confirmed: **there is NO `@iranti/` npm package in `src/server/node_modules/`**. The control plane connects to the Iranti PostgreSQL database directly using `pg` Pool. Iranti is NOT imported as a Node.js package by the control plane server.

This means the `IStaffEventEmitter` injection as described in CP-T025 (injecting an interface into the Librarian/Attendant/Archivist/Resolutionist Node.js classes) is NOT achievable from within this repository. The upstream Iranti server source code lives separately.

**Your spike must therefore assess two alternative approaches:**

**Option A: staff_events DB table (recommended by PM)**
- The upstream Iranti server (wherever it lives) is patched to write a row to a `staff_events` table on each Staff action
- The control plane reads from `staff_events` via polling or (better) a LISTEN/NOTIFY channel
- This is compatible with the existing architecture and requires no Node.js package dependency
- The system_architect must design the `staff_events` table schema and the patch points in the Iranti server

**Option B: IPC/socket between Iranti server and control plane**
- The Iranti server and control plane server run as separate processes; they could communicate via a named pipe, Unix socket, or local HTTP call
- The Iranti server emits events over the IPC channel; the control plane server receives and broadcasts via SSE
- More complex; requires OS-level IPC design

**For the spike**: design Option A (staff_events table) as the primary proposal. If Option A requires an upstream Iranti server change that is not achievable, design the fallback (enhanced polling of existing tables at 500ms interval). Document which Iranti server files would need to change for Option A.

To find the Iranti server source: check if Iranti is installed globally (`which iranti`, `npm list -g iranti`), check `~/.iranti/` for any server source, or check `src/server/db.ts` to understand what database the control plane connects to and whether there is a shared runtime. The system_architect should document what they find about the Iranti server accessibility before designing the injection approach.

**Step 5 — Design the IStaffEventEmitter interface:**

Based on your research, design:
1. The `IStaffEventEmitter` interface that Iranti Staff components can depend on
2. The binding pattern recommendation (constructor injection vs static setter vs context object) — compare at least 2 options with rationale
3. Injection points for all 4 Staff components — every action type listed in the ticket
4. The no-op default emitter (for use when control plane is not enabled)
5. The fallback strategy if upstream rejects the PR: enhanced polling design (target <500ms latency for all 4 components — what interval, what table, what query structure)

**Step 6 — Produce the output document:**
Write `docs/specs/cp-t025-emitter-design.md` with:
- Interface definition
- Binding pattern recommendation with rationale
- All injection points per Staff component (all action types from the ticket)
- List of files in the Iranti core package that must change
- Upstream PR description suitable for submission
- Rollout plan
- Fallback design (enhanced polling) if upstream rejects

**Step 7 — Check acceptance criteria explicitly:**
From `docs/tickets/cp-t025.md`, every AC item must be checkmarked or explicitly noted as "pending upstream" with a reason.

**Step 8 — Write to Iranti:**
- `entity: ticket/cp_t025`, `key: architect_spike_result` — your findings and the spec document path
- `entity: ticket/cp_t025`, `key: status` — "spike_complete_awaiting_pm_review"

**Step 9 — Report back to PM with:**
- What was done (spec created, key decisions made)
- Which ACs are met by the spec alone, which require upstream changes
- Upstream access: did you find the Iranti Staff source files? Were injection points identifiable?
- Risks discovered during the spike
- Open questions requiring PM decision
- Whether PM approval to proceed with upstream changes should be granted

---

## Assignment 2: `backend_developer` → CP-D001 (P0 DEFECT FIX — TOP PRIORITY) then CP-T033 + CP-T035

**URGENT: Fix CP-D001 FIRST before any other work.**
**Tickets:** CP-D001 (P0 defect, fix immediately) then CP-T033 + CP-T035
**Priority:** CP-D001 is P0 blocker — v0.1.0 on hold until this is fixed
**Phase:** 1 close-out (CP-D001) + Phase 2 (CP-T033, CP-T035)

### Prompt for backend_developer

You are the `backend_developer` for the Iranti Control Plane project.

**Step 1 — Handshake:**
Call `iranti_handshake` with `agent: "backend_developer"`, task: "CP-D001 P0 defect fix — SQL column name mismatch in kb.ts — then CP-T033 + CP-T035"

**Step 2 — Use `iranti_attend` before every turn.**

**Step 3 — READ CP-D001 FIRST (P0 defect, fix before anything else):**
- `docs/tickets/cp-d001.md` — full defect description with exact fix instructions

**THE FIX:** All SQL queries in `src/server/routes/control-plane/kb.ts` use snake_case column names (`summary`, `value_raw`, `entity_type`, `created_at`, etc.) but the Iranti Postgres DB uses Prisma-generated camelCase column names (`"valueSummary"`, `"valueRaw"`, `"entityType"`, `"createdAt"`, etc.). The fix is to quote all column names in camelCase in every WHERE clause, ORDER BY clause, and explicit SELECT column list. The `cp-d001.md` ticket has the complete fix specification with before/after SQL for every affected location.

After fixing kb.ts, also check `health.ts` and `events.ts` for the same pattern.

**AFTER FIXING CP-D001:**
- Run `cd src/server && npx tsc --noEmit` — must exit 0
- Run `cd src/server && npx vitest run tests/unit` — all 104 must pass
- Push and confirm CI green
- Write to Iranti: `entity: blocker/cp_d001`, `key: status` = "resolved"
- Notify qa_engineer to run regression tests REG-001 through REG-005 from `docs/test-plans/phase2-test-plan.md`

Only after CI is green and you have notified QA, proceed to CP-T035 and CP-T033.

**Step 4 — Implement CP-T035 backend first (P0, after CP-D001 is resolved):**

Implement `GET /api/control-plane/instances/:instanceId/setup-status` returning:
```typescript
interface SetupStatus {
  instanceId: string;
  steps: Array<{
    id: string;
    label: string;
    status: "complete" | "incomplete" | "warning" | "not_applicable";
    message: string;
    actionRequired: string | null;
    repairAction: string | null;
  }>;
  isFullyConfigured: boolean;
  firstRunDetected: boolean;
}
```

The 4 steps are: `database`, `provider`, `project_binding`, `claude_integration`.

First-run flag: store a `.iranti-cp-setup-complete` file in the runtime root. If it does not exist: `firstRunDetected: true`. Create a `POST /api/control-plane/instances/:instanceId/setup-status/complete` endpoint to set this flag.

Also implement a `POST /api/control-plane/instances/:instanceId/setup-status/refresh` that re-checks provider status without page reload.

**Step 5 — Implement CP-T033 repair endpoints:**

Three endpoints (all require `?confirm=true` query parameter):
1. `POST /api/control-plane/instances/:instanceId/projects/:projectId/repair/mcp-json`
   - Generates `.mcp.json` from current instance config, writes to project root
   - Returns: `{ filePath, content, action: "created"|"replaced" }`
2. `POST /api/control-plane/instances/:instanceId/projects/:projectId/repair/claude-md`
   - Appends/replaces the Iranti integration block in `CLAUDE.md`
   - Must preserve user-authored content — use comment-delimited block (`<!-- iranti:start --> ... <!-- iranti:end -->`)
   - Returns: `{ filePath, action: "appended"|"replaced", diff: string }`
3. `POST /api/control-plane/instances/:instanceId/doctor`
   - Runs health checks scoped to one instance
   - Returns structured results: each check as `{ id, label, status, message, repairAction? }`

All three endpoints must:
- Require `?confirm=true` or return 400
- Log to audit trail with `agentId: control_plane_repair`, `source: control_plane`
- Fail with structured error if directory not writable (never unhandled 500)
- Return `revertable: false` in response body

**Step 6 — Protocol compliance (mandatory before marking done):**
- `cd src/server && npx tsc --noEmit` must exit 0
- Run `cd src/server && npx vitest run tests/unit`
- Verify response shapes match `src/client/src/api/types.ts` (add types if missing)
- Check CI: `gh run list --limit 3 --repo nfemmanuel/iranti-control-plane`

**Step 7 — Write to Iranti:**
- `entity: ticket/cp_t035`, `key: backend_status` — what was implemented
- `entity: ticket/cp_t033`, `key: backend_status` — what was implemented

**Step 8 — Report back to PM with:**
- Both tickets: what was implemented, AC check per ticket
- The first-run flag storage decision (confirmed: local file in runtime root)
- The CLAUDE.md block detection heuristic chosen (confirm delimiter format)
- The audit log destination (staff_events table or separate? what schema amendment if any?)
- Any risks found during implementation
- TypeScript compilation status

---

## Assignment 3: `devops_engineer` → CP-T019 DX Fix + CP-T023 Wizard Design Spike

**Tickets:** CP-T019 (DX fix verification) + CP-T023 (CLI wizard design spike)
**Priority:** CP-T019 first (P1 DX fix), then CP-T023 design spike
**Phase:** 1 (CP-T019 close-out) + 2 (CP-T023 spike)

### Prompt for devops_engineer

You are the `devops_engineer` for the Iranti Control Plane project.

**Step 1 — Handshake:**
Call `iranti_handshake` with `agent: "devops_engineer"`, task: "CP-T019 DX fix + CP-T023 CLI wizard design spike"

**Step 2 — Use `iranti_attend` before every turn.**

**Step 3 — Read these files:**
- `docs/tickets/cp-t019.md` — DX fix acceptance criteria
- `docs/tickets/cp-t023.md` — CLI wizard spec
- `docs/specs/installer-concept.md` — approved concept memo
- `docs/protocols/development.md` — Steps 1–6 mandatory

**Step 4 — CI check first (before anything else):**
Run: `gh run list --limit 5 --repo nfemmanuel/iranti-control-plane`
If anything is red, diagnose and fix it before proceeding to other work.
Use `gh run view {run_id} --log-failed` to get failure logs.

**Step 5 — CP-T019 verification and fix:**
- Check root `package.json` at project root for `dev`, `build`, `setup` scripts
- Check if `node_modules` exists at root: `ls node_modules 2>/dev/null | head -5`
- Check if `concurrently` is installed
- If `npm run dev` at root is broken: run `npm install` at root to install concurrently
- Verify `npm run dev` starts both server (port 3002) and client (port 5173)
- Update `README.md` to show `npm install && npm run dev` as the primary quick-start
- Update `scripts/dev-setup.sh` and `scripts/dev-setup.ps1` to include root `npm install`
- Update `.github/workflows/ci.yml` to include root `npm install`
- Update `.github/workflows/release.yml` to include root `package.json` in archive

Check all acceptance criteria from `docs/tickets/cp-t019.md` explicitly.

**Step 6 — CP-T023 design spike (spec only, no implementation):**
Read `docs/specs/installer-concept.md` and `docs/tickets/cp-t023.md` carefully.

Produce `docs/specs/cp-t023-wizard-design.md` with:

1. **Entry point decision:** How does `iranti setup` register as a CLI command? Is it a subcommand of the main `iranti` CLI, or a standalone `npx iranti-setup` script? Research what the Iranti package structure looks like (check `src/server/node_modules` for any `iranti` CLI package). Document the recommended approach with rationale.

2. **Wizard step sequence:** The exact flow for macOS:
   - Section 1: System Checks (Node version, PostgreSQL, pgvector)
   - Section 2: Database Setup (DATABASE_URL construction wizard)
   - Section 3: Provider Setup (multiselect providers, key entry, default selection)
   - Section 4: Integrations (MCP registration, project binding, Claude integration)
   - Section 5: Verification (health check, success/partial/fail state)

3. **CP-T005 failure point mapping:** Look at `docs/specs/installer-concept.md`. Identify the top 3 failure points. For each: which wizard section addresses it and how.

4. **`instances.json` registry spec:** The file format for `~/.iranti/instances.json` — exact JSON schema with all fields. This is a `decision/instances_registry` item.

5. **Windows scope statement:** What is supported, what shows "not supported" message. Be explicit.

6. **`clack` package assessment:** Research the `@clack/prompts` npm package. What version should be used? What capabilities does it provide? Are there any known issues? One paragraph.

7. **Open questions for PM:** Any decisions you need from the PM before implementation can start.

Do NOT implement the wizard yet. Spec only.

**Step 7 — Protocol compliance:**
- `cd src/server && npx tsc --noEmit` must pass
- `cd src/client && npx tsc --noEmit` must pass (if client files touched)
- CI must be green after any pushes

**Step 8 — Write to Iranti:**
- `entity: ticket/cp_t019`, `key: status` — "completed" if AC met, or blockers found
- `entity: ticket/cp_t023`, `key: devops_spike_result` — key findings from the spike
- `entity: decision/instances_registry`, `key: registry_format` — the instances.json schema

**Step 9 — Report back to PM with:**
- CP-T019: AC check, what was done, CI status
- CP-T023: spec document path, entry point recommendation, open questions for PM
- Any risks or blockers found

---

## Assignment 4: `user_researcher` → Competitor Analysis Refresh + Design Partner Brief

**Deliverables:** Updated competitor analysis + design partner brief document
**Phase:** 2 research (not tied to a specific ticket number)

### Prompt for user_researcher

You are the `user_researcher` for the Iranti Control Plane project.

**Step 1 — Handshake:**
Call `iranti_handshake` with `agent: "user_researcher"`, task: "Phase 2 competitor analysis refresh and design partner brief"

**Step 2 — Use `iranti_attend` before every turn.**

**Step 3 — Read these files:**
- `docs/research/competitor-analysis.md` — current state (last updated 2026-03-20)
- `docs/research/operator-personas.md` — Marcus, Priya, Dev personas
- `docs/research/v020-success-criteria.md` — what v0.2.0 must achieve
- `docs/research/jobs-to-be-done.md` — JTBD framework

**Step 4 — Competitor research refresh:**

The current competitor analysis was written 2026-03-20 and covers Prisma Studio, Adminer, Retool, Mem0, Zep, Letta/MemGPT, PostHog, Directus, and Linear.

Search the web for current state of:
- **Mem0** — has their operator dashboard improved? Any new features or funding announcements?
- **Zep** — any changes to their memory management UI or operator surface?
- **Letta (formerly MemGPT)** — what has changed in their ADE (Agent Development Environment)?
- **LangSmith** — LangChain's observability tool. How does their operator surface compare to Iranti's control plane? This is a potentially important new competitor not in the current analysis.
- **Langfuse** — open-source LLM observability platform. Local-first self-hosted option. How does it compare?
- **Any new "agent memory dashboard" or "AI agent observability" products** that shipped in 2025-2026
- **OpenMemory/Composio** or similar agent memory management tools

For each product found: note what changed, what they now offer, where the gaps still exist, and whether Iranti's differentiation claims hold.

Update `docs/research/competitor-analysis.md` by appending a new section:
```
## Phase 2 Refresh — March 2026
```
With findings organized by: "What changed", "Where Iranti's differentiation holds", "Where competitors are closing in", "New entrants to watch".

**Step 5 — Design partner brief:**

Write `docs/research/design-partner-brief.md` — a 1-page briefing document for the 3 design partner personas.

Structure:
1. **What is Iranti Control Plane v0.1.0?** — 3 bullet points. Plain language, no jargon.
2. **What you can do today (v0.1.0):** Specific actions, not marketing copy. "You can..." format.
3. **What to test:** For each persona (Marcus, Priya, Dev): 3 specific tasks to try. These should surface real feedback.
4. **What feedback to capture:** 5 specific questions we want each persona to answer.
5. **What Phase 2 will add:** 4 bullet points. Concrete, not vague.
6. **How to share feedback:** Email, GitHub issues, or Iranti entity write — pick the simplest mechanism and document it.

This is the document that will be handed to design partners when v0.1.0 ships. It must be honest about current limitations and specific about what to test.

**Step 6 — Write to Iranti:**
- `entity: research/competitor_analysis`, `key: phase2_refresh` — summary of key findings
- `entity: research/design_partner_brief`, `key: v010_brief` — confirmation of document creation and key decisions

**Step 7 — Report back to PM with:**
- Key findings from the competitor refresh: what changed, what risks emerged
- Design partner brief: key framing decisions made
- Any new competitive threats that should influence Phase 2 or Phase 3 priority

---

## Assignment 5: `technical_writer` → Phase 2 Doc Updates

**Deliverables:** Updated getting-started guide, API reference stubs, staff-activity-stream guide review
**Phase:** 2 documentation

### Prompt for technical_writer

You are the `technical_writer` for the Iranti Control Plane project.

**Step 1 — Handshake:**
Call `iranti_handshake` with `agent: "technical_writer"`, task: "Phase 2 documentation update — getting-started guide, API reference, staff stream guide"

**Step 2 — Use `iranti_attend` before every turn.**

**Step 3 — Read these files:**
- `docs/guides/getting-started.md` — current state
- `docs/guides/architecture.md` — architecture overview
- `docs/reference/api.md` — current API reference
- `docs/guides/staff-activity-stream.md` — Phase 1 stream guide
- `docs/tickets/cp-t036.md` — Entity Detail + Temporal History (frontend, in progress)
- `docs/tickets/cp-t033.md` — Integration Repair Actions (backend being implemented)
- `docs/tickets/cp-t035.md` — Getting Started Screen (backend being implemented)

**Step 4 — Update getting-started.md:**

The guide must be accurate for a new user opening the product for the first time as of Phase 1 complete / Phase 2 in progress (2026-03-20).

Ensure the guide:
- Accurately describes what the control plane includes today (Phase 1)
- Shows the correct startup command sequence
- Notes which features are Phase 2 (embedded chat, conflict review, provider manager, CLI wizard)
- Has correct port numbers (server: 3002, client: 5173)
- Does not reference features that do not yet exist
- Includes a "What's coming in Phase 2" section so users know what to expect

**Step 5 — Update api.md with Phase 2 endpoint stubs:**

Add a section `## Phase 2 Endpoints (In Progress)` with stubs for:

1. `GET /api/control-plane/instances/:instanceId/setup-status` — the response shape from CP-T035
2. `POST /api/control-plane/instances/:instanceId/setup-status/complete` — mark first-run complete
3. `POST /api/control-plane/instances/:instanceId/projects/:projectId/repair/mcp-json` — from CP-T033
4. `POST /api/control-plane/instances/:instanceId/projects/:projectId/repair/claude-md` — from CP-T033
5. `POST /api/control-plane/instances/:instanceId/doctor` — doctor endpoint from CP-T033

For each: method, path, description, request params/body, response shape. Mark each as "(Phase 2 — in implementation)".

**Step 6 — Review staff-activity-stream.md:**

Check: does the guide correctly explain Phase 1 coverage limitations?
- Must state: "Phase 1 covers Librarian and Archivist events only"
- Must state: "Attendant and Resolutionist events require native emitter injection (Phase 2: CP-T025)"
- Must NOT imply all 4 Staff components are covered in Phase 1

If any of these are wrong or missing, update the guide.

**Step 7 — Write to Iranti:**
- `entity: agent/technical_writer`, `key: phase2_docs_update` — summary of what was updated and what was found inaccurate

**Step 8 — Report back to PM with:**
- What was updated in each document
- What was inaccurate in the existing docs (if anything)
- Any documentation gaps found that are not covered by the current assignment
- Suggestions for additional docs needed before design partner handoff

---

## Already-Running Agents (do not re-assign)

### `frontend_developer` → CP-T036
Already running. Assignment: implement Entity Detail view at `/memory/:entityType/:entityId` and Temporal History view at `/memory/:entityType/:entityId/:key`. Both routes currently render PlaceholderView stubs. Backend already implemented. Phase 2 P0.

### `qa_engineer` → CP-T030 + CP-T031 + Phase 2 test plan
Already running. Assignment: verify temporal history endpoint returns archive intervals (CP-T030 seed test), verify instance context persists across all Phase 1 views (CP-T031), and write the Phase 2 QA test plan.

---

## PM Review Trigger

When any agent writes `status: completed` to Iranti for a ticket, the PM will:
1. Query Iranti for the ticket status
2. Read the output artifacts
3. Check AC explicitly
4. Accept or return with feedback
5. Write `entity: ticket/cp_tXXX`, `key: pm_review` with the decision

No ticket is done until PM has written acceptance.

---

---

# Wave 2 Assignments — 2026-03-20 (PM Session 2)

**Issued by:** `product_manager`
**Context:** Wave 1 sprint completed. QA regression FAILED (CP-D002 found). v0.1.0 hold remains. New assignments prioritized: CP-D002 fix is P0 blocker for everything.

## Completed since Wave 1

| Agent | Work | PM Decision |
|-------|------|-------------|
| technical_writer | CP-T040 (release notes + known issues) | ACCEPTED |
| technical_writer | CP-T041 (memory-explorer.md review) | ACCEPTED |
| frontend_developer | CP-T035 (GettingStarted.tsx + AppShell integration) | FRONTEND ACCEPTED — backend pending |
| frontend_developer | CP-T033 (ConfirmationModal, DoctorDrawer, repair buttons) | FRONTEND ACCEPTED — backend pending |
| frontend_developer | CP-T021 (ConflictReview.tsx) | FRONTEND ACCEPTED — backend blocked |
| devops_engineer | CP-T039 (staff_events migration) | ACCEPTED (previously) |
| system_architect | CP-T025 (emitter spec) | SPEC ACCEPTED — upstream PR pending |
| qa_engineer | REG-001–REG-005 | FAIL — CP-D002 raised |

---

## Assignment 6: `backend_developer` → CP-D002 (P0 DEFECT — URGENT) then CP-T021 escalation routes

**Priority:** CP-D002 is P0 blocker. Fix before anything else.
**Phase:** 1 close-out (CP-D002) + Phase 2 (CP-T021 backend)

### Prompt for backend_developer

You are the `backend_developer` for the Iranti Control Plane project.

**Step 1 — Handshake:**
Call `iranti_handshake` with `agent: "backend_developer"`, task: "CP-D002 P0 defect fix — entity_relationships table name + agentId column mismatch — then CP-T021 escalation routes"

**Step 2 — Use `iranti_attend` before every turn.**

**Step 3 — READ THE DEFECT FIRST (CP-D002, fix before anything else):**

Query Iranti: `entity: blocker/cp_d002`, `key: pm_assessment` for the full defect list.

**THREE SPECIFIC BUGS TO FIX in `src/server/routes/control-plane/kb.ts`:**

**Bug 1 — entity_relationships table name (affects entity detail and relationships routes):**
- The SQL queries around line 558 and 649 reference `entity_relationships` as the table name.
- The actual Prisma table name is `"EntityRelationship"` (PascalCase, must be quoted in SQL).
- Column names are also wrong: code uses `fromEntityType`, `fromEntityId`, `toEntityType`, `toEntityId`.
- Actual column names: `fromType`, `fromId`, `toType`, `toId`.
- Fix: update the FROM clause to `FROM "EntityRelationship"` and all column references to `"fromType"`, `"fromId"`, `"toType"`, `"toId"`.

**Bug 2 — agentId column name in history endpoint (affects temporal history):**
- The temporal history route (around line 400–450 in kb.ts) has an explicit SELECT that names `"agentId"` as a column.
- The actual column in both `knowledge_base` and `archive` tables is `"createdBy"`.
- Fix: replace `"agentId"` with `"createdBy"` in all explicit SELECTs in the history endpoint.

**Bug 3 (minor) — serializeArchiveRow() missing labelArchivedReason():**
- The archive browse serializer `serializeArchiveRow()` returns raw `archivedReason` codes (e.g., `"superseded"`) without passing them through `labelArchivedReason()`.
- The history endpoint already applies `labelArchivedReason()` correctly.
- Fix: call `labelArchivedReason(row.archivedReason)` in `serializeArchiveRow()` before returning the value.

**Step 4 — After fixing CP-D002:**
- Run `cd src/server && npx tsc --noEmit` — must exit 0
- Run `cd src/server && npx vitest run tests/unit` — all tests must pass
- Push and confirm CI green: `gh run list --limit 3 --repo nfemmanuel/iranti-control-plane`
- Write to Iranti: `entity: blocker/cp_d002`, `key: fix_status` = "resolved" with commit SHA
- Notify PM that CP-D002 fix is pushed — PM will trigger QA re-run of REG-003, REG-004, REG-005

**Step 5 — ONLY AFTER CP-D002 FIX IS CONFIRMED MERGED AND CI GREEN: Implement CP-T021 escalation routes**

**PM decision on escalation data source (read entity: ticket/cp_t021, key: pm_escalation_backend_decision):**

The PM has decided: escalation data lives in the `archive` table. Rows where `resolutionState IS NULL AND supersededBy IS NOT NULL` are pending escalations. The archive row UUID is the escalation ID.

**Implement two new routes in a new file `src/server/routes/control-plane/escalations.ts`:**

**Route 1: `GET /api/control-plane/escalations`**
- Query param: `?status=pending|resolved` (default: pending)
- For `status=pending`: query `archive` WHERE `resolutionState IS NULL AND supersededBy IS NOT NULL`
- For each pending archive row, also fetch the current `knowledge_base` row for the same `entityType/entityId/key` — this is the "existing fact" in the comparison
- For `status=resolved`: query `archive` WHERE `resolutionState IS NOT NULL`
- Response shape (see ConflictReview.tsx for the expected PendingEscalation and ResolvedEscalation interfaces):
```typescript
interface EscalationListResponse {
  pending: PendingEscalation[];    // when status=pending
  resolved: ResolvedEscalation[];  // when status=resolved
  total: number;
}
```

**Route 2: `POST /api/control-plane/escalations/:id/resolve`**
- `:id` is the archive row UUID
- Body: `{ resolution: "keep_existing" | "accept_challenger" | "custom", customValue?: string }`
- For `keep_existing`: set `archive.resolutionState = "resolved_keep_existing"` — no KB change
- For `accept_challenger`: set `archive.resolutionState = "resolved_accept_challenger"`, then write a new KB fact using the archive row's `valueRaw` and `valueSummary` (this supersedes the current fact)
- For `custom`: validate `customValue` is valid JSON, write as new KB fact, set `resolutionState = "resolved_custom"`
- All: update `archive.updatedAt` and log to `staff_events` table with `componentName: "Resolutionist"`, `eventType: "conflict_resolved"`, `agentId: "control_plane_operator"`, payload includes resolution choice and entity context
- Return: `{ id, resolution, resolvedAt, entityType, entityId, key }`
- Validation: if resolution is "custom" and `customValue` is missing or invalid JSON, return 400
- If archive row not found or already resolved, return 404

**Wire both routes in `src/server/routes/control-plane/index.ts` or equivalent router file.**

**Confirm with PM before implementing if:** the `archive` table structure does not support this query pattern, or if the `resolutionState` values differ from what PM specified.

**Step 6 — After CP-T021 backend:**
- TypeScript must compile: `cd src/server && npx tsc --noEmit`
- Write to Iranti: `entity: ticket/cp_t021`, `key: backend_status` — what was implemented, any schema surprises
- In `src/client/src/components/conflicts/ConflictReview.tsx`: flip `ESCALATIONS_API_AVAILABLE = true` and wire the two fetch calls (GET escalations, POST resolve) to the real endpoints

**Step 7 — Report back to PM with:**
- CP-D002: what was fixed, commit SHA, CI status
- CP-T021: did archive table structure match PM's expectation? Any deviations?
- TypeScript compilation status for both fixes
- Any risks or open questions

---

## Assignment 7: `qa_engineer` → CP-D002 Regression Re-run (after backend fix)

**Priority:** P0 — immediately after backend_developer pushes CP-D002 fix
**Blocking:** v0.1.0 hold lift

### Prompt for qa_engineer

You are the `qa_engineer` for the Iranti Control Plane project.

**Step 1 — Handshake:**
Call `iranti_handshake` with `agent: "qa_engineer"`, task: "CP-D002 regression re-run — REG-003, REG-004, REG-005 against live DB after backend fix"

**Step 2 — Use `iranti_attend` before every turn.**

**Step 3 — Wait for backend_developer to write `entity: blocker/cp_d002`, `key: fix_status` = "resolved" before starting.**

Query Iranti for that key. If not yet resolved, do not proceed — wait for the signal.

**Step 4 — Re-run only the failing tests:**

From `docs/test-plans/phase2-test-plan.md`, re-run:
- **REG-003:** `GET /api/control-plane/entities/agent/test_agent_001` — should return 200 with entity detail and relationships (no SQL error about entity_relationships table)
- **REG-004:** `GET /api/control-plane/entities/test/temporal_history_check/history/test_value` — should return 200 with temporal history intervals (no SQL error about agentId column)
- **REG-005:** Same as REG-004 but verify `archivedReason` labels are human-readable (e.g., "Superseded" not "superseded")

Also verify:
- **REG-002 re-check:** archive browse endpoint — verify `archivedReason` values are now human-readable (labelArchivedReason fix)
- **REG-006:** re-run relationships endpoint (was blocked by same entity_relationships bug as REG-003)

**Step 5 — Write results to Iranti:**
- `entity: ticket/cp_d001`, `key: qa_regression_result_v2` — all test results with pass/fail and detail
- `entity: ticket/cp_d001`, `key: regression_gate_status_v2` — overall verdict

**Step 6 — If all gate tests pass, notify PM explicitly:**
Write `entity: project/iranti_control_plane`, `key: qa_regression_v2_verdict` = "PASS" with date and QA sign-off.

**If any still fail:** Write failure detail with exact SQL error, endpoint, and what changed vs v1 result. PM will triage.

**Step 7 — Alongside the regression re-run, complete the Phase 2 QA test plan if not done:**
Read `docs/test-plans/phase2-test-plan.md`. If Phase 2 test cases for CP-T035 (setup status endpoint), CP-T033 (repair endpoints), and CP-T021 (escalations) are not yet written, add them.

**Step 8 — Report back to PM with:**
- REG-003, REG-004, REG-005 re-run results
- Overall verdict: v0.1.0 hold lift criteria met or not
- Any new defects found
- Phase 2 test plan status

---

## Assignment 8: `frontend_developer` → CP-T037 (Live Mode UX) + CP-T024 (Command Palette)

**Priority:** P1 (CP-T037) + P2 (CP-T024)
**Phase:** 2, Wave 2

### Prompt for frontend_developer

You are the `frontend_developer` for the Iranti Control Plane project.

**Step 1 — Handshake:**
Call `iranti_handshake` with `agent: "frontend_developer"`, task: "CP-T037 Staff Activity Stream live mode UX + CP-T024 command palette"

**Step 2 — Use `iranti_attend` before every turn.**

**Step 3 — Read these files before starting:**
- `docs/tickets/cp-t037.md` — Live Mode UX acceptance criteria
- `docs/tickets/cp-t024.md` — Command Palette acceptance criteria
- `docs/protocols/development.md` — Steps 1–6 mandatory before marking done
- `src/client/src/components/stream/ActivityStream.tsx` — current ActivityStream component
- `src/client/src/components/shell/AppShell.tsx` — shell structure you are working within

**Step 4 — CP-T037: Staff Activity Stream Live Mode UX**

The ActivityStream component exists from Phase 1. This ticket adds:

1. **Pulse indicator** — a visual "live" badge that pulses (CSS animation) when the stream is receiving events. Should dim or stop pulsing when paused or when no events have arrived in the last 10 seconds.

2. **Velocity counter** — a rolling "events per minute" counter updated every 5 seconds. Display format: `{N} evt/min`. Should drop to 0 if no events for 60 seconds.

3. **Hover-pause** — when the user hovers over the event list, the stream pauses (new events are buffered, not rendered). A "Paused (hover)" indicator replaces the live badge. On mouse leave, resume rendering (flush buffer). The buffer should match the existing 500-event client-side buffer.

4. **Live/Paused badge** — a persistent badge in the stream header: `● LIVE` (emerald, pulsing) when streaming, `⏸ PAUSED` (amber) when paused manually or by hover. Clicking the badge toggles the manual pause.

5. **Phase 2 coverage note** — update the Phase 1 coverage indicator to note: "All 4 Staff components: Librarian, Archivist (current via polling), Attendant, Resolutionist (Phase 2 — pending CP-T025)". This is informational, not a blocker.

**Note on CP-T025 dependency:** CP-T037 improves the live UX of the existing polling stream. CP-T025 (native emitter) is not required for CP-T037 to ship. The pulse/velocity/hover-pause work with the current 2-second polling adapter.

**Step 5 — CP-T024: Command Palette (Cmd+K)**

Implement a global command palette reachable from any view via Cmd+K (Mac) / Ctrl+K (Windows/Linux).

**Requirements:**
- A full-screen overlay with a centered search input and filtered results list
- Keyboard navigation: arrow keys to select, Enter to navigate, Escape to close
- Results organized in groups: Navigation (Memory, Archive, Activity, Instances, Health, Conflicts, Getting Started), Actions (filtered suggestions based on current view context)
- Fuzzy search across command labels
- Must be reachable from every view — mount in AppShell, not inside any individual view
- Close on click-outside and on Escape
- Trap focus within the palette while open (accessibility)
- Transitions: fade-in/fade-out, not instant show/hide

**Do NOT** build a full search-across-KB feature in this ticket. The palette is for navigation and in-app actions only. KB search is a Phase 3 item.

**Step 6 — Protocol compliance:**
- `cd src/client && npx tsc --noEmit` must exit 0
- `cd src/server && npx tsc --noEmit` must exit 0 (no regressions)
- Both light and dark mode verified for all new components

**Step 7 — Write to Iranti:**
- `entity: ticket/cp_t037`, `key: frontend_status` — what was implemented, AC check
- `entity: ticket/cp_t024`, `key: frontend_status` — what was implemented, AC check

**Step 8 — Report back to PM with:**
- Both tickets: what was built, AC check per ticket
- Any UX decisions made (e.g., hover-pause interaction model, command palette grouping structure)
- TypeScript and visual mode status

---

## Assignment 9: `system_architect` → CP-T025 Upstream PR (from spec)

**Priority:** P1
**Phase:** 2, Wave 2

### Prompt for system_architect

You are the `system_architect` for the Iranti Control Plane project.

**Step 1 — Handshake:**
Call `iranti_handshake` with `agent: "system_architect"`, task: "CP-T025 upstream emitter PR — convert spec to actionable PR description and fallback design confirmation"

**Step 2 — Use `iranti_attend` before every turn.**

**Step 3 — Read the completed spec:**
- `docs/specs/cp-t025-emitter-design.md` — your 1,035-line spec from Wave 1

**Step 4 — Your deliverable:**

The spec is done. Now produce two outputs:

**Output A — Upstream PR description (`docs/specs/cp-t025-upstream-pr.md`):**
A ready-to-submit GitHub PR description for the Iranti upstream repository. Audience: the Iranti maintainer. Must include:
- What the PR does (one paragraph, plain English)
- Why: the use case (control plane live tail)
- What changes: specific files modified, with the interface definition included inline
- The IStaffEventEmitter interface and no-op default implementation
- Injection point summary (one table: component, action, event type, injection location)
- Testing: how to verify the emitter fires correctly
- Rollout safety: no-op default means the emitter is safe to merge without the control plane deployed

**Output B — Fallback design confirmation (`docs/specs/cp-t025-fallback-confirmed.md`):**
A 1-page document confirming the enhanced polling fallback design:
- Poll interval: 500ms against `staff_events` table
- Attendant proxy: what `knowledge_base` writes to watch for Attendant activity
- Resolutionist proxy: what `archive` writes to watch for Resolutionist activity
- SSE broadcast: how the fallback event is shaped into a StaffEvent for the frontend
- When the fallback is triggered: upstream PR rejected, or control plane is running without upstream patch

**Step 5 — Write to Iranti:**
- `entity: ticket/cp_t025`, `key: upstream_pr_status` — "pr_description_written, awaiting maintainer submission"
- `entity: ticket/cp_t025`, `key: fallback_status` — "fallback_design_confirmed"

**Step 6 — Report back to PM with:**
- PR description path and key decisions made
- Fallback design — is the 500ms polling feasible without DB overload? What is the estimated query cost per minute?
- Any risks in the upstream PR that PM should know before submitting

---

## Assignment 10: `backend_developer` (follow-on) → CP-T022 Provider and Model Manager

**Priority:** P1 — start ONLY after CP-D002 fix is merged and CI green
**Phase:** 2, Wave 2

### Prompt for backend_developer (follow-on after CP-D002 + CP-T021)

You are the `backend_developer` for the Iranti Control Plane project.

**Step 1 — Handshake:**
Call `iranti_handshake` with `agent: "backend_developer"`, task: "CP-T022 provider and model manager — read-only API for configured providers and model catalog"

**Step 2 — Use `iranti_attend` before every turn.**

**Step 3 — Read these files:**
- `docs/tickets/cp-t022.md` — full ticket with acceptance criteria
- `docs/prd/control-plane.md` sections 5 and 10 — Provider Manager product intent
- `src/server/routes/control-plane/health.ts` — provider check logic already exists here

**Step 4 — PM pre-decision on CP-T022 write scope:**

The write path for CP-T022 (actually changing the default provider from the UI) requires either:
(a) Programmatic API in the Iranti server to change provider config, or
(b) Writing to `.env.iranti` directly from the control plane server.

**PM decision for Phase 2:** Implement read-only first. No `.env.iranti` writes in Phase 2. The provider manager shows what is configured and whether each provider key is present and reachable. Provider configuration remains a manual CLI/env operation. Write surfaces are Phase 3 scope.

**Implement these read-only endpoints:**

1. `GET /api/control-plane/providers` — list configured providers with status:
```typescript
interface ProviderStatus {
  id: string;            // "anthropic", "openai", "ollama"
  name: string;          // "Anthropic", "OpenAI", "Ollama"
  keyPresent: boolean;
  keyEnvVar: string;     // e.g., "ANTHROPIC_API_KEY"
  reachable: boolean;    // ping the provider health endpoint
  lastChecked: string;   // ISO timestamp
  isDefault: boolean;    // whether this is the configured default provider
  models?: ModelInfo[];  // if available from provider API
}
```

2. `GET /api/control-plane/providers/:providerId/models` — list available models for a provider (if the provider exposes a models list API). For Anthropic: static list from known models. For OpenAI: call `/v1/models`. For Ollama: call `/api/tags`.

**Step 5 — Write to Iranti:**
- `entity: ticket/cp_t022`, `key: backend_status` — what endpoints were implemented, any limitations found

**Step 6 — Report back to PM with:**
- Endpoint shapes implemented
- Provider reachability check: how are you probing each provider's health?
- Model list: which providers return a dynamic model list vs. static?
- Any surprises about the provider configuration structure in `.env.iranti`

---

## Wave 2 Status Summary (as of 2026-03-20 PM session 2)

| Agent | Current Assignment | Priority |
|-------|-------------------|----------|
| backend_developer | CP-D002 fix (P0 URGENT) → CP-T021 escalation routes → CP-T022 provider API | P0→P1→P1 |
| qa_engineer | Wait for CP-D002 fix, then re-run REG-003/004/005 → Phase 2 test plan | P0 gate |
| frontend_developer | CP-T037 (live mode UX) + CP-T024 (command palette) | P1 + P2 |
| system_architect | CP-T025 upstream PR description + fallback confirmation | P1 |
| technical_writer | CP-T040 and CP-T041 ACCEPTED — next: see Assignment 11 below | P2 |
| user_researcher | Assignment 4 from Wave 1 (competitor refresh + design partner brief) | P1 |
| devops_engineer | CP-T023 wizard design (from Wave 1 Assignment 3) | P1 |

---

## Assignment 11: `technical_writer` → Phase 2 doc updates (round 2)

**Priority:** P2
**Blocked on:** CP-D002 fix merged (so docs accurately describe fixed behavior)

### Prompt for technical_writer

You are the `technical_writer` for the Iranti Control Plane project.

**Step 1 — Handshake:**
Call `iranti_handshake` with `agent: "technical_writer"`, task: "Phase 2 doc round 2 — known-issues update, DATABASE_URL gap, v0.1.0 release notes correction"

**Step 2 — Use `iranti_attend` before every turn.**

**Step 3 — Three specific tasks:**

**Task A — Update KI-007 in `docs/reference/known-issues.md`:**
KI-007 currently says "Getting Started screen and repair button UI are backend-only — frontend not yet implemented." This is now incorrect. The frontend IS implemented (CP-T035 GettingStarted.tsx, CP-T033 ConfirmationModal + DoctorDrawer + repair buttons). Update KI-007 to reflect the current state: both surfaces exist in the frontend and are pending QA verification and full backend completion (setup routes, repair routes). The severity should reflect: the UI exists, the backend routes exist, but end-to-end is not yet QA-verified. Revise the description accordingly.

**Task B — Add KI-008 for the DATABASE_URL documentation gap:**
QA discovered that `DATABASE_URL` was missing from `.env.iranti` at the project root. The getting-started guide does not make this requirement explicit enough. Add a new known issue:

```
KI-008 | DATABASE_URL must be set in .env.iranti at the project root | All data views | P1 | Known, workaround: copy .env.iranti from your Iranti runtime root (~/.iranti/.env.iranti) to the project root
```

Also update `docs/guides/getting-started.md` prerequisites section to explicitly state: "Your `.env.iranti` file must be present at the project root (the `iranti-control-plane` directory), not just in the Iranti runtime root. If you only have it in `~/.iranti/.env.iranti`, copy it: `cp ~/.iranti/.env.iranti ./`."

**Task C — Update CP-D001 status note in release notes:**
The v0.1.0-release-notes.md says CP-D001 is "FIXED." This remains true, but QA has now found two additional defects (CP-D002). Update the "Defect Resolved" section to note: "Note: QA testing after the CP-D001 fix identified two additional schema mismatches (CP-D002). These are being fixed. The entity detail and temporal history views may show SQL errors until CP-D002 is resolved."

**Step 4 — Write to Iranti:**
- `entity: agent/technical_writer`, `key: phase2_docs_round2` — summary of what was updated

**Step 5 — Report back to PM with:**
- What was updated in each document
- Any other documentation gaps found during this pass

---
