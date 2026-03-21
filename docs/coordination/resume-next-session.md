# Resume Prompt — Next PM Session

**Last updated:** 2026-03-21 (Wave 9 dispatched — CP-T065 PM-ACCEPTED, CP-T066/T067 OPEN)
**Current branch:** master
**Phase:** 3 — Advanced Operator Features

---

## Immediate Status

### Wave 3 — CP-T048 (Platform Installer Packages)
- **State:** Implementation complete. AC-11 (clean-machine validation) is the only remaining gate.
- **Blocked on:** Physical/VM clean-machine testing. Cannot be automated. QA engineer (or user) must run the test plan.
- **AC-11 gate:** Windows, macOS, Linux clean-machine pass table required before PM can accept.
- **Test plan:** `docs/qa/cp-t048-clean-machine-test-plan.md`

### Waves 4–8 — ALL PM-ACCEPTED 2026-03-21
- CP-T051 (Agent Registry View) — PM-ACCEPTED
- CP-T052 (Health: Decay + Vector + Attend) — PM-ACCEPTED
- CP-T053 (Memory Explorer: ConflictLog + Labels) — PM-ACCEPTED
- CP-T056 (Temporal History asOf Query) — PM-ACCEPTED
- CP-T057 (WhoKnows Contributor Panel) — PM-ACCEPTED
- CP-T058 (UX Guidance Labels M4/M5/H8) — PM-ACCEPTED
- CP-T059 (Interactive Diagnostics Panel) — PM-ACCEPTED
- CP-T060 (Metrics Dashboard) — PM-ACCEPTED
- CP-T061 backend (Entity Alias Proxy) — PM-ACCEPTED
- CP-T062 (Relationship Graph B9 note) — PM-ACCEPTED
- CP-T063 (API Key Scope Audit View) — PM-ACCEPTED
- CP-T064 (Documentation Update) — PM-ACCEPTED

### Wave 9 — IN PROGRESS

| Ticket | Title | Assignees | Priority | State |
|--------|-------|-----------|----------|-------|
| CP-T065 | Entity Alias Panel: Rewrite for Real Iranti Shape | frontend_developer | P2 | **PM-ACCEPTED 2026-03-21** |
| CP-T066 | KB Full-Text/Semantic Search Surface | backend_developer + frontend_developer | P2 | **OPEN — Wave 9** |
| CP-T067 | Entity Type Browser | backend_developer + frontend_developer | P3 | **OPEN — Wave 9** |

---

## CP-T065 PM Acceptance Summary — 2026-03-21

All 6 ACs verified. Types correct (flat token alias shape). AliasRow renders `<code>` token, muted source, ConfidenceBar, relative createdAt. CreateAliasForm single-field with correct POST body `{ canonicalEntity, alias }`. Empty state unchanged. tsc --noEmit CLEAN (0 errors, both server and client). CP-T061 is now fully accepted (backend was accepted 2026-03-21; frontend accepted via CP-T065 2026-03-21).

---

## Wave 9 Scope — Why CP-T066 and CP-T067

### CP-T066 — KB Full-Text/Semantic Search (P2)

`GET /kb/search` is Iranti's hybrid lexical+vector search endpoint. It is already called internally by the diagnostics module (`iranti_auth` probe and `vector_search_check` probe) — confirming the proxy path works. But no operator-facing search surface exists. Memory Explorer uses ILIKE substring filtering on entityType/entityId only. Operators cannot answer "which entities mention Project Iris?" without knowing the entity type first.

CP-T066 adds a search input to the Memory Explorer that calls `GET /api/control-plane/kb/search`, shows ranked results (entity+key+summary+score), and surfaces scope errors clearly. This is the highest-value KB feature not yet in the control plane.

Endpoint spec: `docs/coordination/cross-repo-audit-2026-03-21.md` line 41. Requires global-scope `kb:read` API key.

### CP-T067 — Entity Type Browser (P3)

New operators navigating an unfamiliar Iranti instance cannot discover what entity types exist without prior knowledge. The Memory Explorer requires an entity type to be specified before browsing. CP-T067 adds an initial landing view that shows all distinct entity types from a simple GROUP BY aggregation on the local `knowledge_base` table — no new Iranti API call needed. Each card links to filtered browse.

---

## Outstanding Carryover: CP-T025 Native Emitter PR

- **State:** Spec PM-approved (2026-03-20). Upstream PR description complete (`docs/specs/cp-t025-upstream-pr.md`). Actual TypeScript diff files NOT confirmed produced.
- **Impact:** Without this PR merged upstream, Staff Activity Stream shows Librarian + Archivist only. Attendant and Resolutionist events (including B11 attend classifier failures) are invisible.
- **Action:** Dispatch `system_architect` to confirm diff file status and submission path. Not a new ticket — carryover deliverable from CP-T025.
- **Iranti repo:** `nfemmanuel/iranti` (confirmed from `docs/specs/cp-t023-wizard-design.md`).

---

## v0.3.0 Release Readiness

**Gate:** CP-T048 AC-11 clean-machine validation is the only hard blocker for v0.3.0.

**Current picture:**
- TypeScript: CLEAN on both server and client (verified 2026-03-21 post-CP-T065)
- All Phase 3 Waves 1–9 (except CP-T066/T067 open): PM-ACCEPTED
- CP-T048: implementation complete, AC-11 pending VM testing
- No known regressions against Phase 1 or Phase 2 acceptance criteria

**Recommendation:** Once CP-T066 and CP-T067 are accepted, declare v0.3.0 candidate, gate final release on CP-T048 AC-11. If AC-11 cannot be run in the near term, consider declaring v0.3.0 with a known-issue note on clean-machine installer validation.

---

## "Written by" Label — CONFIRMED FIXED

The resume-next-session note from the prior session referenced a stale issue with the "Created by"/"Written by" inconsistency in MemoryExplorer.tsx. Verified 2026-03-21: both the filter placeholder (line 420) and the column header (line 695) already read "Written by". No patch needed.

---

## Open Gaps (Wave 10+ candidates)

### Medium priority
- **Full-text search (CP-T066)** — in Wave 9
- **Entity Type Browser (CP-T067)** — in Wave 9
- **CP-T025 native emitter PR submission** — system_architect carryover; submission unconfirmed
- **Multi-instance comparison view** — high value for operators with multiple Iranti instances
- **Staff Logs export end-to-end verification** — JSONL/CSV export included in CP-T050; confirm it's working in a test session

### Low priority
- Agent Registry sidebar badge — CP-T051 AC-10 stretch (badge for high-escalation inactive agents) not implemented; acceptable at MVP
- Command palette search/recent items — deferred from CP-T024; full search not implemented
- Force-write / operator override path for C2 conflict limitation — needs UX scoping
- Site integration — iranti.dev has no mention of the control plane (cross-repo ticket needed)
- 90d period option for Metrics Dashboard — deferred from CP-T060

---

## CP-T048 PM Position

AC-11 (clean-machine validation) is a hard gate. Cannot accept without a real pass table from clean-machine tests. The implementation is solid. Recommendation: run `docs/qa/cp-t048-clean-machine-test-plan.md` when a VM is available.

---

## Iranti Version Context

- **Current Iranti version:** 0.2.15 (Unreleased — "Pending release notes")
- **Last audited:** 0.2.12 (cross-repo audit 2026-03-21)
- **Key changes since audit:**
  - v0.2.13: Hybrid search fallback to deterministic semantic scoring; attend() classifier improvement; Python smoke fixes
  - v0.2.14: Windows updater EBUSY race condition fixed (no API changes)
  - v0.2.15: Unreleased — changelog placeholder only; alias API confirmed real (flat string tokens)
- **Next drift check:** When Iranti reaches v0.2.16 or when v0.2.15 is formally released with full release notes.
- **Confirmed Iranti bugs (upstream flags sent):** B6 (ingest contamination), B11 (attend classifier — partial fix in v0.2.13), B4 (vector scoring — improved in v0.2.13), B9 (no MCP read tool for relationships — CP-T062 adds UI note).

---

## TypeScript Status (2026-03-21 post-CP-T065)

- `src/server` — tsc --noEmit: **CLEAN** (0 errors)
- `src/client` — tsc --noEmit: **CLEAN** (0 errors)

---

## Open Tickets Summary

| Ticket | Title | Assignee | Priority |
|--------|-------|----------|----------|
| CP-T048 | Platform Installers | devops_engineer | P2 — AC-11 pending |
| CP-T066 | KB Full-Text/Semantic Search | backend_developer + frontend_developer | P2 — OPEN (Wave 9) |
| CP-T067 | Entity Type Browser | backend_developer + frontend_developer | P3 — OPEN (Wave 9) |
