# Resume Prompt — Next PM Session

**Last updated:** 2026-03-21 (Wave 5 + Wave 6 kickoff)
**Current branch:** master
**Phase:** 3 — Advanced Operator Features

---

## Immediate Status

### Wave 3 — CP-T048 (Platform Installer Packages)
- **State:** Implementation complete. AC-11 (clean-machine validation) is the only remaining gate.
- **Blocked on:** Physical/VM clean-machine testing. Cannot be automated. QA engineer (or user) must run the test plan.
- **AC-11 gate:** Windows, macOS, Linux clean-machine pass table required before PM can accept.
- **Test plan:** `docs/qa/cp-t048-clean-machine-test-plan.md`

### Wave 4 — ALL PM-ACCEPTED 2026-03-21
- CP-T051 (Agent Registry View) — PM-ACCEPTED
- CP-T052 (Health: Decay + Vector + Attend) — PM-ACCEPTED
- CP-T053 (Memory Explorer: ConflictLog + Labels) — PM-ACCEPTED

### Wave 5 — THREE TICKETS OPEN (issued 2026-03-21)

| Ticket | Title | Assignees | Key scope |
|--------|-------|-----------|-----------|
| CP-T056 | Temporal History: asOf Point-in-Time Query | frontend_developer | Date/time picker in Temporal History view; asOf query; interval highlight; fact value callout |
| CP-T057 | Entity Detail: WhoKnows Contributor Panel | backend_developer + frontend_developer | Proxy GET /memory/whoknows/...; Contributors panel in Entity Detail |
| CP-T058 | UX Polish: Operator Guidance Labels (M4/M5/H8) | frontend_developer | Provider Manager write-path hint; unreachable instance iranti run command; IRANTI_PROJECT_MODE in Instance Manager |

### Wave 6 — ONE TICKET OPEN (issued 2026-03-21, P2 — higher priority than Wave 5)

| Ticket | Title | Assignees | Key scope |
|--------|-------|-----------|-----------|
| CP-T059 | Interactive Diagnostics Panel | backend_developer + frontend_developer | POST /diagnostics/run (7 checks), GET /diagnostics/last, "Run Diagnostics" button in Health Dashboard, command palette integration |

**Wave 6 runs concurrently with Wave 5.** backend_developer should start CP-T059 backend while frontend_developer works CP-T056 + CP-T058.

---

## Completed This Session (2026-03-21, second PM session)

1. **Iranti upstream drift check:** v0.2.12 → v0.2.14. v0.2.13 partially fixes B11 (attend classifier less aggressive); hybrid search now falls back to in-process scoring when pgvector unavailable; `entityHints` defaulted from `IRANTI_MEMORY_ENTITY`. v0.2.14 is Windows updater fix only. No breaking API changes. No control plane rework required.
2. **Wave 5 planning and ticket creation:**
   - CP-T057 (`docs/tickets/cp-t057.md`) — WhoKnows Contributor Panel
   - CP-T058 (`docs/tickets/cp-t058.md`) — UX Guidance Labels (M4/M5/H8)
   - CP-T056 already existed — confirmed scope and dispatched
3. **Wave 6 planning and ticket creation:**
   - CP-T059 (`docs/tickets/cp-t059.md`) — Interactive Diagnostics Panel (new CP-E012 Diagnostics epic)
4. **Upstream bug flag memo created:** `docs/coordination/upstream-bug-flags-2026-03-21.md` — flags B6 (ingest contamination), B11 (attend classifier), B4 (vector scoring), B9 (no MCP read for relationships) for Iranti maintainer.
5. **Backlog updated:** CP-E012 Diagnostics epic added; Wave 5 + Wave 6 tickets linked.
6. **Roadmap updated:** Wave 5 and Wave 6 sections added; Wave 4 ticket statuses updated to PM-ACCEPTED.
7. **Agent assignments updated:** Wave 5 and Wave 6 assignment blocks appended with full scope details.
8. **Iranti memory written:** `roadmap/phase3_wave5`, `ticket/cp-t057`, `ticket/cp-t058`.

---

## CP-T048 Review — PM Position on AC-11

AC-11 (clean-machine validation) is a **hard gate** for CP-T048 acceptance. The PM cannot accept CP-T048 without a real pass table from clean machine tests. The implementation is solid — Node SEA, all platform scripts, CI pipeline, QA test plan. But the point of the ticket is to confirm that a user with no Node.js can actually install and run it. That cannot be verified without a clean machine.

**Recommendation for next session:** If the user has access to a VM or can borrow a clean Windows/macOS machine, run the QA test plan. The QA test plan is at `docs/qa/cp-t048-clean-machine-test-plan.md`. Until then, CP-T048 remains "implementation complete, AC-11 pending."

---

## "Created by" Column Header Issue in Memory Explorer

The PM noted during CP-T053 acceptance that the column header says "Created by" but CP-T053 changed the label to "Written by" for the expanded row. There may be a label inconsistency between the collapsed table header and the expanded detail label.

**Decision:** CP-T053 is accepted as-is. The "Written by" vs "Created by" header inconsistency (if it exists after CP-T053 lands) should be caught in QA during Wave 5 / 6. If it surfaces, it is a one-line fix that can be bundled into a patch commit rather than a separate ticket.

---

## Open Gaps Deferred to Wave 7+

### Medium priority
- **CP-T025 upstream PR submission** — system_architect carryover from Phase 2. Should still submit the native emitter upstream PR to Iranti maintainer. Not a new ticket — it's a carryover action. Track in Iranti memory under `ticket/cp-t025`.
- **Force-write / operator override path** for the C2 conflict limitation (high-confidence first write blocks corrections). Needs more UX scoping before ticketing. Deferred.
- **Entity alias management UI** (`POST /kb/alias`, `GET /kb/entity/.../aliases`) — deferred since Phase 1. Still not done. Consider as Wave 7 candidate.
- **API key scope audit view** — namespace-aware scopes not visible. Consider as Wave 7 candidate.
- **Site integration** — iranti.dev has no mention of the control plane. Cross-repo coordination ticket. Needs PM alignment with site team.

### Low priority
- **iranti.dev benchmark copy clarification** — Hero shows `16/16` (internal benchmark), Proof page shows `4/5` (external B3 benchmark). Site PM should clarify. Not a control plane ticket.

---

## Wave 7 Candidates (not yet ticketed)

When Wave 5 and Wave 6 complete, these are the next-best operator-value items:

1. **Metrics Dashboard** — `GET /metrics` exposes LLM call counts, cache hit/miss ratio, DB query count, Librarian write/reject/escalate counts, timer p95s. This is valuable operational data that no view currently surfaces. Would be a new view or a section of the Health Dashboard.
2. **Entity alias management UI** — POST /kb/alias, GET /kb/entity/.../aliases. Phase 1 deferred. Now genuinely useful now that Memory Explorer is mature.
3. **Full-text search across fact values** — Currently Memory Explorer filters by entityId/key. Operators cannot search for entities by fact content. `GET /kb/search` (lexical+vector hybrid) enables this.
4. **CP-T025 native emitter PR submission** — system_architect should execute this. The spec is PM-approved. It's been deferred for two waves.
5. **Multi-instance comparison view** — For operators running more than one Iranti instance, comparing entity state across instances would be highly valuable.

---

## Key Files for Next Session

- `docs/tickets/cp-t056.md` — asOf query (Wave 5, frontend)
- `docs/tickets/cp-t057.md` — WhoKnows panel (Wave 5, backend + frontend)
- `docs/tickets/cp-t058.md` — UX labels (Wave 5, frontend)
- `docs/tickets/cp-t059.md` — Interactive Diagnostics (Wave 6, backend + frontend)
- `docs/coordination/agent-assignments-phase3.md` — Wave 5 + 6 assignment briefs
- `docs/qa/cp-t048-clean-machine-test-plan.md` — CP-T048 AC-11 test plan
- `docs/coordination/upstream-bug-flags-2026-03-21.md` — Bug flag memo for Iranti maintainer

---

## Iranti Version Context

- **Current Iranti version:** 0.2.14
- **Last audited:** 0.2.12 (cross-repo audit 2026-03-21)
- **Key changes since audit:** v0.2.13 partially fixes B11 attend classifier, improves hybrid search fallback; v0.2.14 Windows updater fix only.
- **Next drift check:** When Iranti reaches v0.2.15 or higher.
- **Confirmed Iranti bugs (upstream flags sent via memo):** B6 (ingest contamination), B11 (attend classifier — partial fix in v0.2.13), B4 (vector scoring — improved in v0.2.13), B9 (no MCP read tool for relationships).
