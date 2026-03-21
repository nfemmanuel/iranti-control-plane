# Resume Prompt — Next PM Session

**Last updated:** 2026-03-21 (Wave 6 accepted, Wave 7 dispatched)
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

### Wave 5 — Status unknown (dispatched 2026-03-21, outcomes pending)
| Ticket | Title | Assignees | State |
|--------|-------|-----------|-------|
| CP-T056 | Temporal History: asOf Point-in-Time Query | frontend_developer | Dispatched — outcome unknown |
| CP-T057 | Entity Detail: WhoKnows Contributor Panel | backend_developer + frontend_developer | Dispatched — outcome unknown |
| CP-T058 | UX Polish: Operator Guidance Labels (M4/M5/H8) | frontend_developer | Dispatched — outcome unknown |

### Wave 6 — PM-ACCEPTED 2026-03-21
- **CP-T059** (Interactive Diagnostics Panel) — **PM-ACCEPTED** (backend + frontend both accepted)
  - All 5 frontend ACs verified: Run Diagnostics button, results table, DiagStatusBadge, summary banner, collapsible panel, command palette integration, AC-9 `__diagnostics__` filter
  - `tsc --noEmit` passes — zero errors
  - The double-trigger guard, rAF deferred command palette event, and collapsed last-run on mount are all correct
  - Acceptance notes: implementation is solid and complete

### Wave 7 — DISPATCHED 2026-03-21
| Ticket | Title | Assignees | Key scope |
|--------|-------|-----------|-----------|
| CP-T060 | Metrics Dashboard: Agent Write Volume + KB Growth | backend_developer + frontend_developer | `/metrics` route; 3 endpoints (kb-growth, agent-activity, summary); SVG-native line + bar charts; 7d/30d toggles; summary stat cards |

**PM decisions locked for CP-T060:**
- SVG-native charts only (no Recharts/Chart.js)
- 7d/30d periods at MVP (90d deferred)
- `totalFacts` from `staff_events` accumulation (not unbounded `/kb/query`)
- DB index on `(timestamp, agent_id, action_type)` recommended to backend

---

## In-Flight Technical Writer Task (dispatched 2026-03-21)

**technical_writer** has been dispatched to update `docs/guides/health-dashboard.md`:
- Add "Interactive Diagnostics Panel" H2 section
- Cover the 7 diagnostic checks with descriptions
- Fix hints table showing key hints per check
- Last-run behavior (fetched on mount, collapsed by default)
- `__diagnostics__` probe note (what it is, why filtered)
- Cross-reference from Attendant Status Card section

---

## Patch Needed — "Created by" Column Header in Memory Explorer

During CP-T053 acceptance, the PM noted the column header in the Memory Explorer list view reads "Created by" but the expanded row correctly reads "Written by" (AC-3 of CP-T053). The inconsistency was confirmed during the CP-T059 review session:

- **File:** `src/client/src/components/memory/MemoryExplorer.tsx`
- **Line 695 (approx):** `<th>Created by</th>` — should be `<th>Written by</th>`
- **Filter input placeholder (line 420 approx):** `placeholder="Created by"` — should be `placeholder="Written by"` for consistency

This is a non-blocking one-line patch. **Can be bundled into the next commit** or assigned as a micro-task to frontend_developer.

---

## Completed This Session (2026-03-21, third PM session)

1. **CP-T059 frontend accepted:** Full AC verification against ticket spec. TypeScript clean. All 5 ACs pass.
2. **CP-T059 ticket updated:** Status set to PM-ACCEPTED 2026-03-21 (both backend and frontend).
3. **Wave 7 planned and dispatched:**
   - CP-T060 ticket finalized with resolved open questions (SVG-native, 7d/30d, `staff_events` accumulation, DB index recommendation)
   - backend_developer + frontend_developer dispatched
4. **technical_writer dispatched** for `health-dashboard.md` guide update (Interactive Diagnostics Panel section).
5. **"Created by" inconsistency confirmed** in MemoryExplorer list view column header — patch needed.
6. **getting-started.md review:** Table needs updating to add CP-T059 (Interactive Diagnostics Panel) and Wave 5 features (asOf query, WhoKnows panel) once those tickets are accepted.

---

## Guides Needing Update After Wave 5/6 Acceptance

| Guide | What needs updating |
|-------|---------------------|
| `docs/guides/getting-started.md` | Add CP-T059 Diagnostics Panel row to the "What's Available Now" table; add Wave 5 accepted tickets (CP-T056 asOf, CP-T057 WhoKnows) once those are accepted |
| `docs/guides/health-dashboard.md` | **In progress** — technical_writer dispatched for Diagnostics Panel section |
| `docs/guides/memory-explorer.md` | Review whether the `__diagnostics__` filter behavior (AC-9) needs a note; confirm "Written by" label is consistent throughout guide |

---

## Open Gaps (Wave 7+ candidates after CP-T060)

### Medium priority
- **Entity alias management UI** (`POST /kb/alias`, `GET /kb/entity/.../aliases`) — Phase 1 deferred, still unbuilt
- **Full-text search across fact values** — currently Memory Explorer cannot search by fact content
- **CP-T025 native emitter PR submission** — system_architect carryover. Spec PM-approved. Long deferred.
- **Multi-instance comparison view** — high value for operators with multiple Iranti instances
- **API key scope audit view** — namespace-aware scopes not visible anywhere in the UI

### Low priority
- Force-write / operator override path for C2 conflict limitation — needs UX scoping
- Site integration — iranti.dev has no mention of the control plane

---

## CP-T048 PM Position

AC-11 (clean-machine validation) is a hard gate. Cannot accept without a real pass table from clean-machine tests. The implementation is solid. Recommendation: run `docs/qa/cp-t048-clean-machine-test-plan.md` when a VM is available.

---

## Iranti Version Context

- **Current Iranti version:** 0.2.14
- **Last audited:** 0.2.12 (cross-repo audit 2026-03-21)
- **Key changes since audit:** v0.2.13 partially fixes B11 attend classifier, improves hybrid search fallback; v0.2.14 Windows updater fix only.
- **Next drift check:** When Iranti reaches v0.2.15 or higher.
- **Confirmed Iranti bugs (upstream flags sent via memo):** B6 (ingest contamination), B11 (attend classifier — partial fix in v0.2.13), B4 (vector scoring — improved in v0.2.13), B9 (no MCP read tool for relationships).
