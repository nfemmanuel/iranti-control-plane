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
