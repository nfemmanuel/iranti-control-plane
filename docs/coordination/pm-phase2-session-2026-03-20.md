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
9. Consider whether CP-T042/T043/T044/T045 should be formally ticketed for Phase 3
10. Evaluate whether CP-T021 conflict review window is closing — if backend_developer cannot land escalation routes within 2 weeks, PM should escalate to product risk
