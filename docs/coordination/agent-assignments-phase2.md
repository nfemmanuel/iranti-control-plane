# Phase 2 Agent Assignments — 2026-03-20

**Issued by:** `product_manager`
**Date:** 2026-03-20
**Status:** Active — all agents assigned for Phase 2 wave 1 kickoff

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
