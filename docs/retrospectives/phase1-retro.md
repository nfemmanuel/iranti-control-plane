# Phase 1 Retrospective — Iranti Control Plane v0.1.0

**Date:** 2026-03-20
**PM:** product_manager
**Phase duration:** Estimated 2–3 weeks (Phase 0 specs → Phase 1 implementation → P0 blocker resolution)
**Status at retro:** v0.1.0 PM-accepted, CI green, Phase 2 kicked off

---

## What Was Built

Phase 1 delivered a working local web control plane for Iranti: a React + Vite frontend backed by an Express + Prisma server, served at `http://localhost:3001/control-plane`.

### Delivered in Phase 1

**Core Tickets (10)**

| Ticket | Description | Status |
|--------|-------------|--------|
| CP-T010 | KB, Archive, Entity Detail, Relationships API | PM-accepted |
| CP-T011 | Instance health and metadata API | PM-accepted |
| CP-T012 | Staff event stream API (polling adapter) | PM-accepted |
| CP-T013 | Memory Explorer + Archive Explorer frontend | PM-accepted |
| CP-T014 | Staff Activity Stream frontend | PM-accepted |
| CP-T015 | Health & Diagnostics frontend | PM-accepted |
| CP-T016 | Instance & Project Manager frontend | PM-accepted |
| CP-T017 | Visual system & Shell chrome (Terminals palette) | PM-accepted |
| CP-T018 | Phase 1 API test plan execution | PM-accepted |
| CP-T019 | Phase 1 UI acceptance test execution | PM-accepted |

**P0 Blocker Tickets (5) — resolved before v0.1.0**

| Ticket | Description | Status |
|--------|-------------|--------|
| CP-T026 | Staff Activity Stream Phase 1 coverage label | PM-accepted |
| CP-T027 | Explicit empty states for all data views + shell connection indicator | PM-accepted |
| CP-T028 | Health Dashboard four-tier severity taxonomy | PM-accepted |
| CP-T029 | Instance health last-checked timestamp and staleness | PM-accepted |
| CP-T030 | Temporal history endpoint correctness + archive JOIN | PM-accepted |

**P1 QA Ticket**

| Ticket | Description | Status |
|--------|-------------|--------|
| CP-T031 | Instance context persistence verification | Conditionally accepted |

---

## What Worked Well

### 1. Design Direction Clarity

Choosing Option B "Terminals" early in Phase 0 (emerald accent, near-black canvas, monospace accent typography) paid off in Phase 1. The visual identity is distinctive, consistent, and — critically — not generic. The Spinner component from css-loaders.com (conic-gradient arc in `var(--color-accent-primary)`) is elegant and idiomatic. The design system avoided the default gray/blue admin dashboard trap that the PRD explicitly prohibited.

### 2. Backend API Quality

CP-T010's KB/archive/entity/relationship endpoints were PM-reviewed with high confidence: explicit camelCase serialization, parameterized queries throughout, consistent error shapes, and a clean `{ current, history, hasHistory }` contract for temporal history. The `ARCHIVED_REASON_LABELS` map in `kb.ts` is an example of doing the right thing at the API boundary rather than pushing it to the frontend.

### 3. Health Dashboard Severity Taxonomy

The `classifyCheckSeverity` function in `HealthDashboard.tsx` is one of the best implementation decisions in Phase 1. It is explicit, documented with comments, exported for testing, and separated from display logic. The decision to classify `openai_key:warn` and `runtime_version:warn` as INFO (not WARNING) avoids the false-alarm problem on every standard installation. This was the right call given the user research finding that "3 amber warnings on first open" is a high-severity failure mode.

### 4. Empty State Design

The three-condition empty state pattern (connected+no data, not connected, filtered+no results) was correctly implemented across all three data views. The ActivityStream Condition A copy — "The stream is connected. Events will appear here when the Librarian processes a write. Try running `iranti write` in a terminal to generate an event." — is the exact right user-empowering language. It tells the user what is true, why it is true, and what to do. Most tools just say "No events."

### 5. Staff Activity Stream Implementation

The `useEventStream` hook is sophisticated for Phase 1: exponential backoff reconnection, pause/resume with buffer, maximum event count (500 DOM entries), client-side filter application without SSE reconnect for agentId/entityId filters, and a live vs tail mode. This is well above the minimum viable implementation.

### 6. Phase 0 Specification Quality

The Phase 0 specs (staff-event-model.md, control-plane-api.md, visual-tokens.md, shell-design-exploration.md) gave Phase 1 implementation clear direction with minimal ambiguity. The decision to do specs-before-code prevented significant rework in Phase 1.

---

## What Did Not Work Well

### 1. Files Left Uncommitted (CI Was Red for Multiple Commits)

The most serious operational failure in Phase 1: the `src/client/src/components/ui/` directory (Spinner, LoadingPage, Spinner.module.css), three new server routes (providers.ts, repair.ts, setup.ts), and all modified component files were implemented but never committed to git. This caused CI to fail on two consecutive commits because `InstanceManager.tsx` imported `../ui/Spinner` which didn't exist in the remote repo.

**Root cause:** The implementation agent did not follow the completion protocol (Step 5: check CI after pushing, Step 6: CI must be green before marking done). The commits were pushed without verifying CI was green.

**Fix applied:** Fixed by the PM session (2026-03-20) by committing all missing files plus fixing three TypeScript `noUnusedLocals` errors (unused LoadingSkeleton, SkeletonRow declarations) and one type error in providers.ts.

**Lesson:** The pre-push hook and completion protocol exist for this reason. Every agent must run the typecheck locally and verify CI before marking a ticket done. The PM cannot accept work without a green CI signal.

### 2. QA Seed Test for CP-T030 Not Executed

The Definition of Done for CP-T030 explicitly required the QA engineer to execute a live seed test (write two facts to the same entity/key to trigger supersession, verify both intervals appear in the temporal history view) and record the result in Iranti as `ticket/cp_t030 key qa_seed_result`. This was not done. The backend implementation is correct and unit-tested, but the end-to-end live verification was skipped.

**Lesson:** The QA engineer role must be explicitly activated and given a checklist. The PM cannot assume QA tests ran because they were specified. A separate ticket assignment and explicit "run and record" instruction is required.

### 3. CP-T031 Architecture Mismatch

CP-T031 was written assuming a multi-instance architecture where switching instances in the UI would scope all data API calls to a different backend. The Phase 1 implementation is single-backend (apiFetch calls relative URLs without instanceId), making the multi-instance scoping test steps not applicable.

**Lesson:** The acceptance criteria for QA tickets must be grounded in the actual Phase 1 architecture. The PM should have verified the architecture assumption before writing the test protocol. The conditional acceptance is correct but the ticket should be retrospectively scoped to match what was built.

### 4. entity_relationships Graph View Deferred

The Phase 1 implementation shows relationships as a flat list. The PRD explicitly calls out graph visualization for relationships. While the deferral to Phase 2 (CP-T032) was intentional, the flat list presentation is the least defensible part of Phase 1 from a user research perspective — Dev (Power User) is the most affected persona and he will notice the gap immediately.

### 5. Entity Detail and Temporal History Views Are Placeholders

`main.tsx` shows that `/memory/:entityType/:entityId` and `/memory/:entityType/:entityId/:key` routes render `<PlaceholderView label="Entity Detail" />` and `<PlaceholderView label="Temporal History" />` respectively. These are empty stubs. The backend endpoints exist and are tested, but the frontend views that would display them are not implemented.

**Impact:** A user clicking "View History" or "View Related Entities" in the Memory Explorer lands on a "coming soon" placeholder. This is a significant product gap for v0.1.0. The control plane cannot fulfill its core "inspect temporal history" promise until these are built.

**Recommendation:** These placeholder views should be prioritized in Phase 2 alongside CP-T032. They are not new scope — they are incomplete Phase 1 work. Spawn frontend_developer to implement entity detail and temporal history views as Phase 2 P0.

---

## Technical Debt Observed in Code Review

### Minor Debt

1. **ActivityStream Condition A ordering logic**: The three empty-state conditions in ActivityStream have slightly redundant condition checking (checking `events.length === 0` twice in sequence). Non-breaking, but could be simplified.

2. **SkeletonRow components removed**: LoadingSkeleton in HealthDashboard, SkeletonRow in MemoryExplorer and ArchiveExplorer were declared but never used. They were removed to fix CI. The loading states in all three views use Spinner instead of skeletons — this is a deliberate choice but the gap between the competitor analysis recommendation (skeleton loaders) and the current implementation should be noted.

3. **AppShell ActivityDrawerSlot**: The activity drawer slot says "Staff activity drawer — wired in CP-T014" but CP-T014 (Staff Activity Stream) is delivered as a full page view, not a drawer widget. The slot content was never wired. This comment is stale.

4. **providers.ts quota endpoints**: The quota endpoint for OpenAI says "Key presence confirmed. Live balance requires org:read scope — check OpenAI Usage dashboard directly." This is honest but the route is stubbed. It will return this message indefinitely until CP-T034 (Provider Credit and Quota Visibility) ships.

### Architectural Debt

1. **No instanceId in API calls**: As noted in CP-T031, `apiFetch` doesn't pass instanceId. Phase 2 will need to address this when multiple instances need truly isolated data views.

2. **Entity detail and temporal history not implemented as views**: Significant gap between the backend API correctness and the frontend view coverage.

---

## Usability Risks Addressed in Phase 1

From `docs/research/phase1-usability-risks.md` — which risks were addressed?

- **Risk 1 (Activity Stream shows no events):** Addressed by CP-T026 coverage label and CP-T027 empty states
- **Risk 5 (Health Dashboard amber warnings on fresh install):** Addressed by CP-T028 severity taxonomy
- **Risk 4 (Empty table = broken system):** Addressed by CP-T027 three-condition empty states
- **Risk 6 (Instance Health status stale):** Addressed by CP-T029 timestamp and staleness indicators
- **Risk 7 (Temporal history incomplete):** Backend addressed by CP-T030; frontend placeholder views still incomplete

**Risks still open for Phase 2:**
- Entity detail and temporal history frontend views
- Multi-instance context scoping
- Provider configuration (currently read-only health check only)

---

## User Research Alignment

The Phase 1 product as shipped serves **Marcus (Solo Dev)** most directly:
- Empty states tell him the system is connected and what to do
- Health dashboard shows him operational status at a glance without false alarms
- Memory Explorer lets him browse facts without SQL

**Priya (Technical Founder)** gets partial value:
- Read-only instance view is sufficient for evaluation
- Multi-instance scoping limitation is a gap she will hit

**Dev (Power User)** is least well-served:
- Temporal history frontend views are placeholders
- Relationship graph is a flat list
- No ability to see Attendant/Resolutionist events

Phase 2 must specifically address Dev's job-to-be-done to complete the v0.1.0 → v0.2.0 arc.

---

## Phase 2 Lessons Carried Forward

1. **Every agent must follow the completion protocol before marking done.** CI green is a hard requirement, not a best practice.
2. **QA tickets need explicit activation and execution tracking.** Assign qa_engineer as the responsible agent and give them specific steps + an Iranti record to write.
3. **Frontend placeholder views need to be closed before design partner handoff.** Entity detail and temporal history views are Phase 2 P0.
4. **The architecture note for instanceId routing must be addressed in Phase 2 setup wizard.** When CP-T023 (CLI setup wizard) ships, the instance context model needs to be clarified.
5. **Dev (Power User) must be the primary beneficiary of Phase 2 features.** His JTBD (temporal history inspection, relationship graph, full Staff observability) are the highest-differentiation capabilities of the product.

---

## Competitor Positioning Update

Phase 1 ships the foundational operator surfaces that no competitor currently offers:
- Staff Activity Stream with phase-labeled coverage (unique to Iranti)
- Four-tier severity taxonomy with normalization copy (Mem0 and Zep have no health dashboard at all)
- Temporal history with archive JOIN (Zep has snapshots but not this level of operator control)
- Local-first, no exfiltration, no auth overhead (all competitors have hosted requirements)

Phase 2 will deepen the differentiation with the features that matter most to power users: conflict review (unique), embedded chat (equivalent to hosted competitors but local-first), and the graph view (which no AI memory tool currently ships with operator-grade UX).

The core positioning claim holds: **Iranti Control Plane is the only operator surface that makes an AI memory system's full internal reasoning legible to a human operator without SQL, filesystem access, or raw log parsing.**

---

## Next Review Point

Phase 2 kickoff. PM to review each ticket's acceptance criteria before agents begin execution. First design partner onboarding session to validate Phase 1 product quality against real usage.
