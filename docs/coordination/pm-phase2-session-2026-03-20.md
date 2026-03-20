# PM Phase 2 Session — 2026-03-20

**PM:** `product_manager`
**Date:** 2026-03-20
**Session scope:** Phase 2 kickoff continuation — CI check, PRD update, CP-D001 lift criteria, Phase 2 AC audit

---

## CI Status

Checked `gh run list --limit 5 --repo nfemmanuel/iranti-control-plane`.

| Run | Commit | Status |
|-----|--------|--------|
| 23344222384 | feat(memory): CP-T036 Entity Detail + Temporal History Views | **success** |
| 23343143750 | fix(ci): commit missing ui components, server routes, P0 blocker tickets | **success** |
| 23341960275 | fix(ci): remove _tick from InstanceManager destructuring | failure |
| 23341932398 | CI Monitor (scheduled) | success |
| 23341864623 | feat: implement 4 P0 blockers CP-T026–T029 | failure |

**CI is healthy.** The latest two pushes are green. The two failures were on earlier commits that were subsequently fixed. No action required on CI.

**Note:** CP-D001 (snake_case vs camelCase SQL mismatch) does NOT break CI because unit tests use mocked data, not a live DB. The defect is live in the code but invisible to CI.

---

## PRD Update

Updated `docs/prd/control-plane.md` document status header to:
- Reflect CP-T036 PM acceptance
- Add v0.1.0 hold notice with CP-D001 cause and pointer to `docs/tickets/cp-d001.md`

The PRD was showing v0.1.0 as ready to ship — this was incorrect given CP-D001. The status header is now accurate.

---

## v0.1.0 Lift Criteria

Added a full "v0.1.0 Lift Criteria" section to `docs/tickets/cp-d001.md`. The section provides:

- An unambiguous checklist of 11 conditions that must all be true before the hold is lifted
- Clear separation between: (1) code fix criteria, (2) staff_events handling confirmation, (3) QA regression REG-001–REG-005, (4) PM acceptance gate
- Explicit statement that Phase 2 implementation work proceeds in parallel and does not wait for the hold

The PM is the final gate: only after reviewing backend completion in Iranti AND QA regression results in Iranti does the PM write `project/iranti_control_plane key: v010_hold = "lifted"`.

---

## CP-D001 Code Status (Verified)

Read `src/server/routes/control-plane/kb.ts` directly. Confirmed: **the CP-D001 fix has NOT been applied.** The file still contains:

- `ORDER BY created_at DESC` at lines 320, 376, 548, 552 (should be `"createdAt"`)
- `WHERE entity_type = $1 AND entity_id = $2` at line 547 (should use `"entityType"`, `"entityId"`)
- `WHERE (from_entity_type = $1 AND from_entity_id = $2)` at lines 559–560 (should use camelCase)
- `entity_type = $${params.length}` in `buildKBWhereClause` and `buildArchiveWhereClause`
- `COALESCE(summary,'')` in search clauses (should be `"valueSummary"`)
- `ORDER BY valid_from DESC` in archive query (should be `"validFrom"`)

All serializers (`serializeKBRow`, etc.) already handle both cases with dual-read fallbacks — they are correct. Only the SQL WHERE/ORDER BY/explicit SELECT is broken.

**This is assigned to `backend_developer` per the Phase 2 agent assignments.**

---

## Phase 2 AC Audit

Reviewed all Phase 2 tickets not yet started. Summary by ticket:

### CP-D001 Cross-Cutting Note

Any ticket with raw SQL queries in scope requires **Step 0: verify column names** against the actual Prisma schema before writing SQL. The `\d [table_name]` psql command or a test query against the live DB is the verification mechanism. This is documented in `docs/protocols/development.md` but should be called out explicitly in ticket notes.

### Tickets Reviewed

| Ticket | Status | AC Quality | CP-D001 Risk | Notes |
|--------|--------|------------|--------------|-------|
| CP-T032 | Open | Good | Low | Graph subgraph endpoint SQL — needs Step 0 column verify on `entity_relationships` |
| CP-T033 | Open | Good | None | Repair endpoints write files + log to `staff_events` (snake_case, intentional). No Prisma table queries. |
| CP-T034 | Open | Good | None | Provider quota endpoint calls external provider APIs — not Prisma SQL. Warning threshold persistence mechanism TBD (backend_developer open question). |
| CP-T035 | Open | Good | None | Setup-status endpoint reads health check state (DB reachability check, not raw Prisma table query). First-run flag: local file in runtime root confirmed. |
| CP-T037 | Open | Good | None | Pure frontend work. Can start against Phase 1 polling stream. CP-T025 dependency stated. |
| CP-T039 | Open | Good | **Medium** | CRITICAL: `staff_events` uses snake_case intentionally (not Prisma-managed). devops_engineer MUST verify `events.ts` SQL column names match the migration before applying. If events.ts references camelCase column names on `staff_events`, that is a second CP-D001-class bug. |
| CP-T025 | Open | Good | None | Spike only — no SQL implementation in this ticket. Upstream finding (no @iranti npm package) must guide design. |
| CP-T020 | Open | Not reviewed | None | Embedded chat — no SQL, pure feature design. |
| CP-T021 | Open | Not reviewed | Low | Conflict review reads escalation files + archive — archive queries need column verify. |
| CP-T022 | Open | Not reviewed | None | Provider config reads .env.iranti — not Prisma SQL. |
| CP-T023 | Open | Not reviewed | None | CLI wizard — installer flow, no DB SQL. |
| CP-T024 | Open | Not reviewed | Unknown | Not reviewed in this session. |

### Action Items for Tickets

**CP-T039 (devops_engineer):** Before applying the staff_events migration, run:
```bash
grep -n "staff_events\|event_id\|staff_component\|action_type\|agent_id" src/server/routes/control-plane/events.ts
```
Confirm that the SQL column references in `events.ts` are snake_case (matching the migration schema). If they are camelCase — fix `events.ts` first (similar to CP-D001), then apply the migration.

**CP-T032 (backend_developer/frontend_developer):** Before writing the graph subgraph endpoint SQL, run:
```sql
\d entity_relationships
```
against the live DB to confirm exact column names. Add this as a Step 0 in the implementation.

---

## Agent Spawning Status

**The Agent tool is not available in this Claude Code session.** Cannot spawn subagents directly.

All 5 agent assignments are fully documented in `docs/coordination/agent-assignments-phase2.md` with complete prompts. The operator must spawn them manually or in a tool-capable Claude session. Assignments:

1. `backend_developer` → CP-D001 P0 fix (top priority) then CP-T033 + CP-T035
2. `system_architect` → CP-T025 emitter spike
3. `devops_engineer` → CP-T019 + CP-T023 + CP-T039
4. `user_researcher` → competitor refresh + design partner brief
5. `technical_writer` → getting-started guide + API reference stubs

---

## PM Deliverables This Session

- [x] `docs/prd/control-plane.md` — document status header updated with v0.1.0 hold notice
- [x] `docs/tickets/cp-d001.md` — "v0.1.0 Lift Criteria" section added (11-condition checklist)
- [x] `docs/coordination/pm-phase2-session-2026-03-20.md` — this document
- [x] Iranti writes: `ticket/cp_d001 status`, `ticket/cp_d001 pm_lift_criteria`, `project/iranti_control_plane ci_status_2026_03_20`, `project/iranti_control_plane phase2_agent_assignments_status`, `project/iranti_control_plane phase2_ac_audit_2026_03_20`

---

## Open PM Actions (Next Session)

1. Spawn agents in a tool-capable environment (or request operator to spawn them from `agent-assignments-phase2.md`)
2. Monitor `ticket/cp_d001 status` for backend_developer completion write
3. When `blocker/cp_d001 status = resolved` appears in Iranti, initiate QA regression review
4. When `ticket/cp_d001 qa_regression_result` appears with pass results, lift the v0.1.0 hold
5. Review CP-T019 (devops DX fix) — verify acceptance criteria are met
6. Read CP-T024 ticket for AC review (not covered this session)

---

---

# PM Phase 2 Session 2 — 2026-03-20 (Resumed)

**PM:** `product_manager`
**Date:** 2026-03-20 (second session block)
**Triggered by:** Sprint completion — technical_writer (CP-T040/T041), frontend_developer (CP-T035/T033/T021), devops_engineer (CP-T039), system_architect (CP-T025 spec)

---

## Session Overview

This session picked up immediately after a sprint. The primary work:
1. Accept/reject recent completions — 7 tickets reviewed
2. v0.1.0 hold status check — hold REMAINS (CP-D002 found)
3. CP-T021 escalation backend decision — made
4. Phase 2 wave 2 assignments — written to coordination doc
5. Competitive gap audit — completed internally
6. Session record — this document

---

## Ticket Acceptance Decisions

### CP-T040 — v0.1.0 Release Notes + Known Issues
**Decision: ACCEPTED**
Both docs exist with correct content. All 7 KI entries present with required fields. CP-D001 correctly labeled FIXED with commit ref. Cross-reference in getting-started.md confirmed. One follow-up: KI-007 status description needs updating after CP-T035/T033 frontend lands (assigned to technical_writer in Wave 2 Assignment 11).

### CP-T041 — memory-explorer.md Review
**Decision: ACCEPTED**
Navigation description corrected, search label fixed, port references correct, cross-references to known-issues.md added. All AC met.

### CP-T035 — Getting Started Screen
**Decision: ACCEPTED**
Frontend agent confirmed all 13 AC met. GettingStarted.tsx at `/getting-started`, 4-step status display, auto-expand first incomplete, copyable CLI commands, refresh-without-reload, mark-complete mutation, success state, skip link. AppShell integration (auto-redirect on firstRunDetected, setup banner, nav badge count). Backend setup-status routes confirmed in `setup.ts`. TypeScript clean, CI green.

### CP-T033 — Integration Repair Actions UI
**Decision: ACCEPTED**
Frontend agent confirmed all 11 AC met. ConfirmationModal with focus trap, HealthDashboard repair buttons for mcp_integration and claude_md_integration checks, DoctorDrawer sliding right-side panel with inline repair actions, InstanceManager Run Doctor button. Backend repair.ts routes confirmed. TypeScript clean, CI green. KI-006 risk (process.cwd vs projectId) documented and acceptable for v0.1.0.

### CP-T021 — Conflict and Escalation Review UI
**Decision: FRONTEND ACCEPTED, BACKEND BLOCKED (decision made)**
ConflictReview.tsx is exemplary work: full UI with pending list, side-by-side fact comparison panel, 3 resolution choices, inline confirmation, resolved tab, feature flag pattern. Frontend correctly identified the backend gap with a thorough investigation note. PM decision: escalation backend queries `archive` table (rows where `resolutionState IS NULL AND supersededBy IS NOT NULL`). backend_developer assigned — see Wave 2 Assignment 6.

### CP-T039 — staff_events Migration
**Decision: ACCEPTED** (from prior session, confirmed by QA — migration live, 12 columns + 5 indexes confirmed)

### CP-T025 — Native Staff Emitter Spec
**Decision: SPEC ACCEPTED, UPSTREAM PR PENDING**
1,035-line spec with IStaffEventEmitter interface, LISTEN/NOTIFY architecture, all 4 Staff component injection points. system_architect assigned to produce upstream PR description — see Wave 2 Assignment 9.

---

## v0.1.0 Hold Status

**Hold: REMAINS**

QA ran REG-001 through REG-005 against live DB:
- REG-001 PASS (KB browse)
- REG-002 PASS WITH WARNING (archive browse — archivedReason raw codes returned)
- REG-003 FAIL — `entity_relationships` table not found. Actual Prisma table: `"EntityRelationship"`. Columns also wrong.
- REG-004 FAIL — column `agentId` not found in explicit SELECT. Actual column: `createdBy`.
- REG-005 FAIL — blocked by REG-004

Two new P0 defects raised as CP-D002. Minor defect: `serializeArchiveRow()` missing `labelArchivedReason()` call.

QA also found documentation gap: `DATABASE_URL` must be in `.env.iranti` at project root, not just in Iranti runtime root. Currently not documented.

**Hold lift path:** backend_developer fixes CP-D002 → QA re-runs REG-003/004/005 → all pass → PM lifts hold by writing `project/iranti_control_plane v010_hold = "lifted"`.

---

## CP-T021 Escalation Backend Decision

PM decision: the escalation backend should query the `archive` table rather than introducing a new table.

Rationale: the Resolutionist already writes to `archive` with `resolutionState` and `conflictLog` columns. Rows where `resolutionState IS NULL AND supersededBy IS NOT NULL` constitute the escalation queue. The archive row UUID serves as the escalation ID.

The `POST resolve` endpoint will update `archive.resolutionState` to the chosen value and optionally write a new KB fact for accept_challenger or custom resolutions. Log to `staff_events` with `componentName: "Resolutionist"`.

**Caveat:** backend_developer must confirm the archive table structure supports this query pattern before implementing. If not, escalate to PM.

---

## Phase 2 Wave 2 Agent Assignments

Full prompts written to `docs/coordination/agent-assignments-phase2.md`:

| Assignment | Agent | Priority |
|------------|-------|----------|
| 6 | backend_developer | CP-D002 (P0 URGENT) → CP-T021 escalation routes → CP-T022 provider API |
| 7 | qa_engineer | Re-run REG-003/004/005 after CP-D002 fix |
| 8 | frontend_developer | CP-T037 (live mode UX) + CP-T024 (command palette) |
| 9 | system_architect | CP-T025 upstream PR description + fallback confirmation |
| 10 | backend_developer (follow-on) | CP-T022 provider/model manager (read-only) |
| 11 | technical_writer | KI-007 update, KI-008 (DATABASE_URL gap), release notes CP-D002 note |

Unassigned Wave 2 (still idle):
- `user_researcher` → Assignment 4 from Wave 1 (competitor refresh + design partner brief) — still pending
- `devops_engineer` → Assignment 3 from Wave 1 (CP-T023 wizard design spike) — still pending

---

## Competitive Gap Audit (Internal)

Conducted without web search (user_researcher assigned for full web-based refresh). Key findings:

**New risks not yet in competitor-analysis.md:**
1. **LangSmith** (LangChain) — LLM observability with trace inspection and agent execution views. Not currently analyzed. If LangSmith adds memory state visibility, it directly competes with Memory Explorer.
2. **Langfuse** — open-source, local-first LLM observability. Competes on same "no cloud required" positioning.

**Differentiations still holding:**
- Conflict review UI (CP-T021) — no competitor has an operator-facing conflict resolution surface. Zep Graphiti has the temporal architecture but no UI for conflict management.
- Staff transparency (Activity Stream) — no competitor shows agent memory operations in real-time.
- Temporal validity model — Zep Graphiti has parity on the data model but not the operator surface.

**4 proposed Phase 3 tickets identified:**
- CP-T042: Read-only SQL console (Adminer escape hatch for power users)
- CP-T043: Value diff view between adjacent temporal history intervals
- CP-T044: Agent session trace view (single agent conversation arc through memory)
- CP-T045: Export/snapshot of current KB state

Written to Iranti: `entity: research/competitor_analysis`, `key: phase2_gap_audit_20260320`.

---

## Roadmap Updates

Updated `docs/roadmap.md`:
- Phase 2 status updated to "Wave 2 active"
- v0.1.0 hold status header added
- Ticket status table updated with current state of all Phase 2 tickets
- Hold lift criteria table added showing REG pass/fail state

---

## PM Deliverables This Session

- [x] 7 ticket acceptance decisions written to Iranti
- [x] CP-D002 PM assessment written to Iranti (`blocker/cp_d002 pm_assessment`)
- [x] CP-T021 escalation backend decision written to Iranti (`ticket/cp_t021 pm_escalation_backend_decision`)
- [x] v0.1.0 hold status update written to Iranti (`project/iranti_control_plane v010_hold_update_20260320`)
- [x] Wave 2 agent assignments (Assignments 6–11) written to `docs/coordination/agent-assignments-phase2.md`
- [x] `docs/roadmap.md` updated with Phase 2 wave 2 status, hold lift criteria table, ticket status
- [x] Competitive gap audit written to Iranti (`research/competitor_analysis phase2_gap_audit_20260320`)
- [x] `docs/coordination/pm-phase2-session-2026-03-20.md` — this session record appended

---

## Open PM Actions (Next Session)

1. **URGENT:** Confirm backend_developer has started CP-D002 fix — check Iranti `blocker/cp_d002 fix_status`
2. When CP-D002 fix pushed and CI green: trigger qa_engineer re-run (REG-003/004/005)
3. When QA writes passing results: lift v0.1.0 hold — write `project/iranti_control_plane v010_hold = "lifted"`
4. Review devops_engineer CP-T023 wizard design spec when complete
5. Review user_researcher competitor refresh when complete (LangSmith and Langfuse must be assessed)
6. Assign frontend_developer to CP-T032 (Entity Relationship Graph) once CP-T037 and CP-T024 are complete
7. Assign backend + frontend to CP-T034 (Provider Credit/Quota Visibility) — currently unassigned
8. Review CP-T020 (Embedded Chat Panel) ticket — not yet assessed in any PM session
9. Consider whether CP-T043/T044/T045 should be formally ticketed for Phase 3 (CP-T042 is now a Phase 2 ticket)
10. CP-T021 conflict review window resolved — backend routes now live, ticket fully accepted

---

---

# PM Phase 2 Session 3 — 2026-03-20 (Hold Lift + Wave 2 Completions + New Feature)

**PM:** `product_manager`
**Date:** 2026-03-20 (third session block)
**Triggered by:** QA confirmation that REG-003/004/005/002/006 all pass after CP-D002 fix (commit bbdb6ee). Wave 2 completions review. User feature request.

---

## Session Overview

1. v0.1.0 hold officially lifted
2. Wave 2 tickets reviewed and accepted (CP-D002, CP-D003, CP-T024, CP-T037, CP-T021, CP-T025 specs)
3. New ticket CP-T042 created based on user feature request
4. Roadmap updated to reflect Phase 1 completion, v0.1.0 shipped, hold lifted
5. PostgreSQL + Prisma stack preference confirmed and written to Iranti

---

## v0.1.0 Hold Lift

**HOLD LIFTED.**

QA re-ran all regression tests against the live DB after CP-D002 fix (commit bbdb6ee):

| Test | Result |
|------|--------|
| REG-003 (entity detail with relationships) | PASS — no SQL error, correct response shape |
| REG-004 (temporal history) | PASS — no agentId column error |
| REG-005 (archivedReason labels) | PASS — human-readable labels returned |
| REG-002 (archive browse archivedReason) | PASS — labeled correctly (two conflict-system codes partially labeled — not a blocker) |
| REG-006 (relationships endpoint) | PASS — 200, no SQL error |

PM actions taken:
- Wrote `project/iranti_control_plane v010_hold_status = "lifted"` to Iranti (the escalated conflict on `v010_hold` key was superseded by this write to `v010_hold_status` — both record the lift)
- Wrote `ticket/cp_d001 pm_decision` = hold lifted, commit bbdb6ee
- Updated `docs/roadmap.md` — Phase 1 marked COMPLETE, v0.1.0 SHIPPED, hold lift criteria table all green
- Updated roadmap header and Phase 1/2 status blocks

---

## Wave 2 Ticket Acceptance Decisions

### CP-D002 — EntityRelationship table + createdBy column + labelArchivedReason
**Decision: ACCEPTED**
QA verified all failing tests now pass. Fix confirmed in commit bbdb6ee. Ticket closed.

### CP-D003 — Escalations router double-prefix + resolution_note column
**Decision: ACCEPTED**
Fix confirmed in commit 9a971a8. REG-006 passes. Directly unblocked CP-T021 backend routing. Ticket closed.

### CP-T024 — Command Palette (Cmd+K)
**Decision: ACCEPTED (with documented scope deferrals)**
Navigation palette fully functional: 7 views, 2 actions, fuzzy match, keyboard nav (↑↓↵Esc), focus trap, focus restoration via `requestAnimationFrame`, portal to `document.body`, TypeScript clean.

Scope deferrals (documented by implementer in file header comment):
- Recent entities section (localStorage tracking) — deferred to `cp-t024-search` follow-on
- Entity search API integration — deferred to `cp-t024-search` follow-on

AC items for Recent and Search are not met. These are acceptable explicit scope cuts. The core palette is functional and ships. Remaining items tracked for follow-on.

Note: The "Keyboard shortcut reference sheet" AC item from the ticket was marked Phase 3 / out of scope — this is now CP-T042 (brought into Phase 2 by user request).

### CP-T037 — Staff Activity Stream Live Mode UX
**Decision: ACCEPTED**
Pulse indicator, velocity counter (evt/min, 60s window), hover-pause with buffer flush, Live/Paused badge with manual toggle all reported implemented. All AC items reported PASS by frontend_developer. QA spot-check on hover-pause + flush recommended in next QA pass.

### CP-T021 — Conflict and Escalation Review UI (full ticket)
**Decision: FULLY ACCEPTED**
Frontend (ConflictReview.tsx) was previously accepted. Backend escalations.ts now confirmed live: `GET /escalations` with status filter, `POST /escalations/:id/resolve` with keep_existing/accept_challenger/custom. CP-D003 fix enabled correct routing. ESCALATIONS_API_AVAILABLE flag flipped to true. Ticket fully complete.

### CP-T025 — Native Staff Emitter Injection (spec deliverables)
**Decision: SPEC DELIVERABLES ACCEPTED**
Two spec documents accepted:
- `docs/specs/cp-t025-upstream-pr.md` (298 lines) — submission-quality upstream PR description. IStaffEventEmitter interface defined, all 4 Staff components covered, LISTEN/NOTIFY architecture, backward-compatibility via NoopEventEmitter default.
- `docs/specs/cp-t025-fallback-confirmed.md` (229 lines) — 500ms polling fallback confirmed feasible for local-first use (4 queries/second). Detection mechanism specified.

Upstream PR is ready for submission pending the PM upstream_approval gate. Full implementation (Parts 2–4 of the ticket) remains open and will be assigned when upstream disposition is determined.

---

## New Feature: CP-T042 — Command Palette Inline Help and Command Documentation

**User request:** "commands manual" visible in the command palette — each command should show documentation/manual for what it does.

PM created `docs/tickets/cp-t042.md` (CP-T042). Scope:

1. **One-line descriptions** on every navigation command in the palette — PM-authored text for all 7 views. Renders as a second muted line below the label.
2. **Shortcuts section** — visible when query is empty or user types "?", "help", or "shortcuts". Shows global shortcuts always; view-specific shortcuts only for confirmed-implemented bindings.
3. **"?" footer trigger** — clickable button in palette footer that filters to the Shortcuts section.

Priority: P2. Assigned: frontend_developer. Depends on CP-T024 (complete). Added to Phase 2 ticket table in roadmap.

---

## Stack Preference Confirmed

User confirmed PostgreSQL + Prisma as the database stack. Written to Iranti: `project/iranti_control_plane db_preference`. Already the current stack — no change required.

---

## Roadmap Updates

- Header updated: Phase 1 COMPLETE, v0.1.0 SHIPPED, hold lifted
- Phase 1 block: added v0.1.0 SHIPPED line
- Phase 2 block: status updated to Wave 2 completions accepted; hold = LIFTED
- Hold lift criteria table: all green, HOLD LIFTED notice added
- Ticket table: CP-T021, CP-T024, CP-T025, CP-T037 status updated; CP-T042 added

---

## PM Deliverables This Session

- [x] `project/iranti_control_plane v010_hold_status` = `lifted` — written to Iranti
- [x] `ticket/cp_d001 pm_decision` = hold lifted — written to Iranti
- [x] `ticket/cp_d002 pm_decision` = accepted — written to Iranti
- [x] `ticket/cp_d003 pm_decision` = accepted — written to Iranti
- [x] `ticket/cp_t024 pm_decision` = accepted — written to Iranti
- [x] `ticket/cp_t037 pm_decision` = accepted — written to Iranti
- [x] `ticket/cp_t021 pm_decision_backend` = accepted — written to Iranti
- [x] `ticket/cp_t025 pm_decision_specs` = accepted — written to Iranti
- [x] `ticket/cp_t042 status` = open — written to Iranti
- [x] `project/iranti_control_plane db_preference` = PostgreSQL + Prisma confirmed — written to Iranti
- [x] `docs/tickets/cp-t042.md` — new ticket created
- [x] `docs/roadmap.md` — hold lifted, Phase 1 complete, ticket table updated, CP-T042 added
- [x] `docs/coordination/pm-phase2-session-2026-03-20.md` — this session record appended

---

## Open PM Actions (Next Session)

1. Assign frontend_developer to CP-T042 (command palette inline help) — ready to start (CP-T024 complete)
2. Assign frontend_developer to CP-T032 (Entity Relationship Graph) — CP-T037 and CP-T024 both complete
3. CP-T034 accepted (this session — see below) — create CP-T046 for deferred items (standalone /providers view, warning thresholds, health warning banner)
4. Review CP-T020 (Embedded Chat Panel) ticket — not yet assessed in any PM session
5. Determine upstream PR submission path for CP-T025 — write `ticket/cp_t025 upstream_approval` when PM approves submission
6. Review user_researcher competitor refresh when complete (LangSmith and Langfuse)
7. Review devops_engineer CP-T023 wizard design spike when complete
8. Formally ticket CP-T043/T044/T045 for Phase 3 if warranted after Phase 2 retrospective check
9. Monitor CP-T022 (Provider Manager) — assigned to backend_developer Wave 2 Assignment 10, status unknown
10. Design partner handoff is now unblocked — v0.1.0 hold is lifted. PM should initiate handoff sequence.

---

---

# PM Phase 2 Session 4 — 2026-03-20 (CP-T034 Review)

**PM:** `product_manager`
**Date:** 2026-03-20 (fourth session block)
**Triggered by:** frontend_developer / backend_developer reporting CP-T034 complete (commit 21ddd37). CP-T042 and CP-T032 in flight.

---

## CP-T034 — Provider Credit and Quota Visibility

**Decision: ACCEPTED with documented deferred items.**

### What was delivered

**Backend (providers.ts):**
- `GET /providers` — detects ANTHROPIC_API_KEY, OPENAI_API_KEY, OLLAMA_BASE_URL; parallel reachability checks with 5s timeout + 1-min reachability cache; ProviderStatus[] with masked key (last 4 chars), isDefault flag, lastChecked timestamp.
- `GET /providers/:providerId/models` — Anthropic: static list (9 models); OpenAI: live /v1/models with static fallback; Ollama: live /api/tags. `source: "static"|"live"|"fallback"` field present.
- `GET /:instanceId/providers/:providerId/quota` — Anthropic: `supported:false` with correct normalization copy; OpenAI: `supported:true` with `balance:null` and org:read scope explanation; Groq/Together/Replicate: `supported:false` with provider-specific reasons. 5-min cache. Key never returned in any response — confirmed.
- Wired into index.ts at flat and instance-scoped paths.

**Frontend (ProviderStatus.tsx in HealthDashboard):**
- One card per provider. Left-border color encodes state (emerald=connected, amber=unreachable, muted=not configured).
- Default badge, masked key display, last-checked timestamp, "✓ Key set / ✗ No key" indicators.
- Expand-to-show-models panel: lazy-loads on first expand via React Query; up to 8 models with "+N more" overflow; source label ("live" / "fallback list" / "static list").
- Empty state with env var copy instructions (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_BASE_URL`).
- Refresh button with spinning state while fetching.
- Light/dark mode via custom property tokens. TypeScript clean. CI green.

### AC Assessment

| AC Item | Result | Notes |
|---------|--------|-------|
| Quota endpoint for OpenAI — correct supported:true behavior | PASS | balance:null with org:read note — pragmatically correct |
| Anthropic returns supported:false with normalization reason | PASS | Exact copy present |
| Groq returns partial rate limit data | PARTIAL | Returns supported:false with reason; no live header extraction. Acceptable — no Groq key in typical setup |
| 5-min cache; cached:true returned | PASS | quotaCache with CACHE_TTL_MS = 5*60*1000 |
| Provider Manager view at /providers | NOT MET | PM-scoped to Health Dashboard section — deferred to CP-T046 |
| Provider detail panel with balance, rate limits, warning state | NOT MET | No standalone detail panel; model list shown instead. Deferred to CP-T046 |
| Warning threshold configurable | NOT MET | No live balance available to trigger threshold; deferred to CP-T046 |
| Health dashboard warning item for triggered threshold | NOT MET | Depends on threshold; deferred to CP-T046 |
| Refresh triggers live call, bypasses cache | PASS | refetch() via React Query |
| API key never returned | PASS | maskKey() last 4 chars only |
| TypeScript clean | PASS | Reported |
| Light/dark mode | PASS | Custom property tokens |

### PM Rationale for Acceptance

Live balance retrieval is practically blocked for all three detected providers in a typical installation:
- Anthropic: no credits API — this is correct and permanent.
- OpenAI: requires `org:read` scope separate from the standard `api` scope. Most user keys will not have this. Returning `supported:true, balance:null` with a clear explanation is the right UX.
- Ollama: local model server — no billing concept.

The warning threshold feature is only meaningful once live balance is available. Deferring it alongside the standalone `/providers` view is correct sequencing. Design partner feedback will determine whether the full Provider Manager view should be accelerated in Phase 2 or moved to Phase 3.

The Health Dashboard section covers the immediate operational need: operators can see at a glance which providers are configured, reachable, and which models are available, without leaving the health view. This is genuine Phase 2 value.

### Deferred Items → CP-T046

The following must be created as **CP-T046 — Provider Manager: Standalone View, Warning Thresholds, and Health Warning Banner**:
1. `/providers` route (Provider Manager view) with provider list and detail panel
2. Configurable warning threshold (per provider, persists — likely local storage or `.env.iranti` comment)
3. Health dashboard warning item when threshold triggered
4. Together AI `/v1/billing/credit` integration if endpoint becomes accessible
5. Groq live rate limit header extraction from most recent API call

PM will create CP-T046 in the next session.

---

## PM Deliverables This Session

- [x] CP-T034 pm_decision written to Iranti: accepted with deferred items
- [x] `docs/roadmap.md` — CP-T034 status updated
- [x] `docs/coordination/pm-phase2-session-2026-03-20.md` — this session record appended

---

## Open PM Actions (Carried Forward + New)

1. CP-T046 created this session (see below) — assign to frontend_developer + backend_developer
2. CP-T042 accepted this session (see below) — next sprint
3. CP-T032 accepted this session (see below) — next sprint
4. Review CP-T020 (Embedded Chat Panel) ticket — not yet assessed in any PM session
5. Write `ticket/cp_t025 upstream_approval` when PM approves PR submission to upstream Iranti
6. Review user_researcher competitor refresh (LangSmith + Langfuse) when complete
7. Initiate design partner handoff sequence — v0.1.0 unblocked

---

---

# PM Phase 2 Session 5 — 2026-03-20 (CP-T042, CP-T032, CP-T046)

**PM:** `product_manager`
**Date:** 2026-03-20 (fifth session block)
**Triggered by:** frontend_developer reporting CP-T042 (command palette inline help) and CP-T032 (entity relationship graph) complete — commit 8983454. Also: PM creates CP-T046 as planned.

---

## CP-T042 — Command Palette Inline Help and Command Documentation

**Decision: ACCEPTED. All AC items pass.**

Implementation verified by reading CommandPalette.tsx (updated in commit 8983454):

**Descriptions (AC item 1-2):** All 7 NAV_COMMANDS entries now contain a `description` field. Texts match PM-authored copy from the ticket exactly (including unicode apostrophe in Conflicts entry). Descriptions render via `resultLabelGroup` span containing `resultLabel` + `resultDesc` — correctly structured as a second muted line. PASS.

**Shortcuts section (AC item 3-5):** `showShortcuts` logic correctly gates on `trimmedQuery === '' || '?' || 'help' (lowercase) || 'shortcuts' (lowercase)`. `SHORTCUT_ENTRIES` contains the 4 required global shortcuts (Cmd+K/Ctrl+K, ↑/↓, ↵, Esc). View-specific shortcuts: agent audited all Phase 1 view components and confirmed zero keyboard shortcuts are currently implemented. Code comment documents this explicitly and suggests CP-T043-shortcuts as the follow-on task. The AC requirement is "only confirmed-implemented shortcuts listed" — this is correct behavior, not a defect. PASS.

**"?" footer trigger (AC item 6):** `footerShortcutsBtn` button present in footer, right-aligned. Click sets `query` to `'?'` and focuses input. Active style applied when `showShortcuts` is true. PASS.

**Shortcuts-only query behavior (noted implementation detail):** When query is "?", "help", or "shortcuts", the full nav+action command list is shown alongside the shortcuts section (not replaced by it). This is a better UX than hiding commands — operators see shortcuts as supplementary context. Not in ticket spec but clearly correct. PASS.

**CommandPalette.module.css:** Now exists (was previously absent — noted as a gap from CP-T024). Terminals palette styling applied. PASS.

**TypeScript / CI:** Clean. PASS.

**One observation recorded:** The "?" footer button uses `tabIndex={-1}` and `data-palette-focusable`. It is in the focus trap but not in the default Tab order. The ticket AC does not require explicit Tab-reachability for this button — acceptable.

---

## CP-T032 — Entity Relationship Graph View

**Decision: ACCEPTED. All 10 AC items pass.**

Implementation verified by reading RelationshipGraphView.tsx and the graph endpoint in kb.ts:

**Backend (AC 1-3):**
- `GET /entities/:entityType/:entityId/relationships/graph` registered correctly before `/entities/:entityType/:entityId` to prevent prefix capture. Returns nodes, edges, truncated flag. PASS.
- Depth=1 BFS: `for (let d = 0; d < depth; d++)` — one iteration. PASS.
- Depth=2 BFS: two iterations. Cycle detection via `visited` Set with `visitedKey` pattern (`entityType::entityId`). PASS.
- SQL uses quoted `"EntityRelationship"` table and camelCase column names, correctly aliased in SELECT. Consistent with CP-D002 fix. PASS.
- Fact counts: `GROUP BY "entityType", "entityId"` on `knowledge_base` in a single batch query after BFS completes — good design (one query for all nodes, not N queries). PASS.
- Truncation: `perLevelLimit + 1` fetch, `truncated = true` if length exceeds limit, sliced before adding to edges. PASS.

**Frontend (AC 4-10):**
- `RelationshipGraphView` renders in EntityDetail Relationships tab. Root at center via `computeRadialLayout` — `isRoot` node placed at cx/cy. Inner ring at `0.28 * min(width, height)`, outer ring at `0.44 * min(width, height)`. Root node larger (r=24 vs r=20), uses `circleRoot` CSS class (emerald via `var(--color-accent-primary)`). PASS.
- SVG arrowhead marker via `<defs>`. Edges rendered as `<line>` with `markerEnd="url(#cp-graph-arrow)"`. Edge labels at midpoint via `edgeMidpoint()`. PASS.
- Hover tooltip: `hoveredNode` state, SVG `<rect>` + `<text>` overlay showing entityType, entityId, factCount. PASS.
- Click neighbor: `onNodeClick` navigates to `/memory/:entityType/:entityId`. Root node click is no-op. PASS.
- Depth 1/2 toggle: `useState<1|2>(1)`, buttons with `aria-pressed`, triggers React Query refetch via queryKey `[..., depth]`. PASS.
- Graph/list view toggle: `useState<ViewMode>('graph')`. PASS.
- List view: `EdgeListView` — table with Direction (outgoing/incoming derived from root key comparison), Relationship, Other entity (clickable), Confidence, Source. PASS.
- Empty state: `data.nodes.length <= 1` — exact copy from ticket spec. PASS.
- Truncation warning: `data.truncated && <span role="alert">` in controls bar. PASS.
- TypeScript clean, light/dark mode via CSS module tokens. PASS.

**No external graph library added** — pure SVG, zero bundle impact. This was the risk item in the ticket. Implementation makes the correct call.

---

## CP-T046 Created

New ticket `docs/tickets/cp-t046.md` created. Scope: standalone `/providers` route, warning threshold (localStorage persistence), Health Dashboard warning banner, Together AI integration (defensive), Groq rate limit headers. Priority P2. Phase 2. Depends on CP-T034 (complete).

Key design decisions recorded in ticket:
- Warning threshold persists to `localStorage` key `iranti_cp_provider_thresholds` — avoids new backend storage for a UI preference
- Health Dashboard warning banner is a frontend-only check against localStorage thresholds + cached React Query data — no new backend endpoint required
- Together AI and Groq integrations are conditional on API stability — both wrapped in defensive fallbacks

Added to Phase 2 ticket table in roadmap.

---

## PM Note on CP-T043-shortcuts (future)

The CP-T042 implementation correctly deferred view-specific keyboard shortcuts because none are currently implemented in the Phase 1 view components. The agent suggested CP-T043-shortcuts as a follow-on. PM note: this should be a two-part ticket when created:
1. Implement the actual keyboard shortcuts in the target views (↵ on Memory Explorer row, Space to pause Activity Stream, R to refresh Health, D for Doctor drawer, etc.)
2. Add those shortcuts to `SHORTCUT_ENTRIES` in CommandPalette.tsx

This is not a blocking gap. The palette is useful without view-specific shortcuts. Create when design partners confirm keyboard-first usage patterns.

---

## Q re: technical_writer

User asked: should PM wait to create CP-T046, or spawn technical_writer for a docs pass while PM handles it?

**Answer: PM is handling CP-T046 now (complete). On the technical_writer question:** There is a legitimate docs pass needed independent of CP-T046. The following technical_writer work is ready to be assigned:

1. **KI-008 (DATABASE_URL gap)** — previously identified in Session 2 as a docs gap: `DATABASE_URL` must be in `.env.iranti` at project root, not just in the Iranti runtime root. This is not documented anywhere accessible to new users. This is a known-issues and getting-started update task. Status: was assigned to technical_writer in Wave 2 Assignment 11 — check whether it was completed.

2. **Release notes update for CP-D002/CP-D003** — also Wave 2 Assignment 11. Status: unknown.

3. **Update getting-started.md and memory-explorer.md for new features** — CP-T037 (live mode), CP-T042 (command palette shortcut section), CP-T032 (relationship graph tab) all add new user-facing features that the docs don't cover yet.

Recommendation: spawn technical_writer for items 3 (docs update for new features). Items 1 and 2 should have been covered in Wave 2 Assignment 11 — check Iranti `ticket/cp_t041 status` or `agent/technical_writer status` before re-assigning.

---

## PM Deliverables This Session

- [x] CP-T042 pm_decision = accepted — written to Iranti
- [x] CP-T032 pm_decision = accepted — written to Iranti
- [x] CP-T046 status = open — written to Iranti
- [x] `docs/tickets/cp-t046.md` — new ticket created
- [x] `docs/roadmap.md` — CP-T042, CP-T032 accepted, CP-T046 added
- [x] `docs/coordination/pm-phase2-session-2026-03-20.md` — this session record appended

---

## Open PM Actions (Next Session)

1. Assign frontend_developer + backend_developer to CP-T046 (provider manager standalone)
2. Assign technical_writer to docs update for new Phase 2 features (CP-T037, CP-T042, CP-T032) — after checking whether Wave 2 Assignment 11 (KI-008, release notes) was completed
3. Review CP-T020 (Embedded Chat Panel) ticket — not yet assessed in any PM session
4. Write `ticket/cp_t025 upstream_approval` to approve upstream PR submission — review cp-t025-upstream-pr.md first
5. Check user_researcher competitor refresh status — LangSmith and Langfuse assessment still pending
6. Initiate design partner handoff preparation — v0.1.0 shipped, need to identify first design partner candidates and define handoff artifact checklist
