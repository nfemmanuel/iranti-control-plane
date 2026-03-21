# Resume Prompt — Next PM Session

**Last updated:** 2026-03-21 (Wave 7 PM-ACCEPTED, Wave 8 dispatched)
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

### Wave 5 — ALL PM-ACCEPTED 2026-03-21
- CP-T056 (Temporal History asOf Query) — PM-ACCEPTED
- CP-T057 (WhoKnows Contributor Panel) — PM-ACCEPTED
- CP-T058 (UX Guidance Labels M4/M5/H8) — PM-ACCEPTED

### Wave 6 — PM-ACCEPTED 2026-03-21
- CP-T059 (Interactive Diagnostics Panel) — PM-ACCEPTED

### Wave 7 — PM-ACCEPTED 2026-03-21
- **CP-T060** (Metrics Dashboard) — **PM-ACCEPTED 2026-03-21**
  - Backend: 3 endpoints (kb-growth, agent-activity, summary), migration 003 (compound index), action type strings verified as real lowercase values, totalFacts cumulative from all-time window, graceful degradation confirmed. TypeScript clean.
  - Frontend: SVG polyline line chart (emerald newFacts / amber archivedFacts), SVG stacked bar chart (top 5 + Other, 6 color slots via CSS tokens), 4 summary cards, period toggle with re-fetch, empty state. TypeScript clean.
  - One non-blocking note: empty state does not show table creation timestamp (AC-9 partial — message is clear and accurate; timestamp addition deferred).

### Wave 8 — DISPATCHED 2026-03-21

| Ticket | Title | Assignees | Priority | State |
|--------|-------|-----------|----------|-------|
| CP-T061 | Entity Alias Management UI | backend_developer + frontend_developer | P2 | OPEN |
| CP-T062 | Relationship Graph: B9 note | frontend_developer | P3 | OPEN |
| CP-T063 | API Key Scope Audit View | backend_developer + frontend_developer | P2 | OPEN |
| CP-T064 | Documentation: asOf + Contributors + Metrics | technical_writer | P3 | OPEN |

---

## Patch Still Needed — "Created by" Column Header in Memory Explorer

During CP-T053 acceptance, the PM noted the column header in the Memory Explorer list view reads "Created by" but the expanded row correctly reads "Written by" (AC-3 of CP-T053).

- **File:** `src/client/src/components/memory/MemoryExplorer.tsx`
- **Line ~695:** `<th>Created by</th>` — should be `<th>Written by</th>`
- **Filter input placeholder (~line 420):** `placeholder="Created by"` — should be `placeholder="Written by"`

This is a non-blocking one-line patch. Can be bundled into the next commit or assigned to frontend_developer.

---

## Guides Needing Update — Being Addressed by CP-T064

| Guide | What needs updating | Ticket |
|-------|---------------------|--------|
| `docs/guides/memory-explorer.md` | asOf picker section, Contributors panel section | CP-T064 |
| `docs/guides/getting-started.md` | Metrics Dashboard row added (done by PM 2026-03-21); asOf and Contributors rows may need refinement | CP-T064 |
| `docs/guides/health-dashboard.md` | Diagnostics Panel section — dispatched to technical_writer in Wave 6 session; confirm status | CP-T064 (if not done) |

---

## Open Gaps (Wave 9+ candidates)

### Medium priority
- **Full-text search across fact values** — Memory Explorer cannot search by fact content
- **CP-T025 native emitter PR submission** — system_architect carryover. Spec PM-approved. Long deferred. PM should follow up on submission status.
- **Multi-instance comparison view** — high value for operators with multiple Iranti instances
- **Agent Registry sidebar badge** — CP-T051 AC-10 stretch (badge for high-escalation inactive agents) not implemented; acceptable at MVP, should revisit if operators request it
- **Command palette search/recent items** — deferred from CP-T024; CP-T042 added shortcuts help but full search was not implemented
- **Staff Logs export end-to-end verification** — JSONL/CSV export included in CP-T050; confirm it's working

### Low priority
- Force-write / operator override path for C2 conflict limitation — needs UX scoping
- Site integration — iranti.dev has no mention of the control plane (cross-repo ticket needed)
- 90d period option for Metrics Dashboard — deferred from CP-T060; add when `staff_events` history is long enough

---

## CP-T048 PM Position

AC-11 (clean-machine validation) is a hard gate. Cannot accept without a real pass table from clean-machine tests. The implementation is solid. Recommendation: run `docs/qa/cp-t048-clean-machine-test-plan.md` when a VM is available.

---

## Iranti Version Context

- **Current Iranti version:** 0.2.14
- **Last audited:** 0.2.12 (cross-repo audit 2026-03-21)
- **Key changes since audit:** v0.2.13 partially fixes B11 attend classifier, improves hybrid search fallback; v0.2.14 Windows updater fix only.
- **Next drift check:** When Iranti reaches v0.2.15 or higher.
- **Confirmed Iranti bugs (upstream flags sent via memo):** B6 (ingest contamination), B11 (attend classifier — partial fix in v0.2.13), B4 (vector scoring — improved in v0.2.13), B9 (no MCP read tool for relationships — CP-T062 adds a note about this in the UI).
