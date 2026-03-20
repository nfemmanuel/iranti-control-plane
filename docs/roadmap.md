# Iranti Control Plane — Roadmap

> **Last updated: 2026-03-20** — Phase 0 complete, Phase 1 **COMPLETE**, v0.1.0 **SHIPPED** (hold lifted 2026-03-20 after CP-D002 fix, all regression tests pass). Phase 2 in progress — Wave 2 completions accepted.

## Horizon

This roadmap covers the full delivery arc of the Iranti Control Plane from architectural foundation through power-user operator features. Phase 0 is complete as of 2026-03-20. Phase 1 is in the final blocker-resolution stage. Phase 2 is ready to start once Phase 1 P0 blockers are resolved. Phase 3 scope will be refined after Phase 2 learnings.

## Strategic Themes

- **Operability without SQL**: Users should be able to understand and operate Iranti without touching the database or reading raw logs.
- **First-class installation**: Installation and onboarding are product surfaces, not prerequisites. The path from zero to running Iranti must be genuinely simple.
- **Deliberate visual design**: The control plane must look intentional in both light and dark mode. Generic admin dashboard aesthetics are not acceptable.
- **Spec before build**: Every Phase 0 spec must be PM-approved before Phase 1 implementation begins. No implementation should outrun its design.
- **Staff transparency**: Operators must be able to watch what the Librarian, Attendant, Archivist, and Resolutionist are doing in real time, not just read static state.

---

## Phase 0 — Foundation

**Status: COMPLETE (2026-03-20)**

**Goal**: Establish the architectural and design foundations before any UI build begins. No production code is written in Phase 0. All output is specifications, design explorations, and concept memos — ready to be directly acted on in Phase 1.

### Outcomes — All Achieved

- Staff event model fully specified: schema, persistence strategy, event levels, and component coverage — `docs/specs/staff-event-model.md`
- Read API surface fully specified: all 7 endpoint groups with paths, params, response schemas, and PRD requirement mappings — `docs/specs/control-plane-api.md`
- Instance and project metadata aggregation design: field-to-source mapping, aggregation strategy, edge case handling — `docs/specs/instance-metadata-aggregation.md`
- Shell design direction approved: layout wireframe, visual palette Option B "Terminals" selected, technology recommendation confirmed — `docs/specs/shell-design-exploration.md`
- Installer/onboarding concept evaluated: current path documented, options compared, CLI wizard recommendation made — `docs/specs/installer-concept.md`
- Entity aliases spike completed: deferred to Phase 2 — `docs/specs/entity-aliases-spike.md`

### Workstreams — Completed

- **Staff Event Model spec** (system_architect) — CP-T001 ✓
- **Control Plane Read API spec** (system_architect) — CP-T002 ✓, depends on CP-T001
- **Instance & Project Metadata Aggregation spec** (system_architect) — CP-T003 ✓, parallel to CP-T001
- **Local Web Shell Design Exploration** (frontend_developer) — CP-T004 ✓, no dependencies
- **Installer/Onboarding Concept Evaluation** (devops_engineer) — CP-T005 ✓, no dependencies
- **Entity Aliases spike** (system_architect) — CP-T006 ✓, finding: deferred to Phase 2

### Exit Criteria — All Met

- [x] `docs/specs/staff-event-model.md` exists and PM-approved (CP-T001)
- [x] `docs/specs/control-plane-api.md` exists and PM-approved (CP-T002)
- [x] `docs/specs/instance-metadata-aggregation.md` exists and PM-approved (CP-T003)
- [x] `docs/specs/shell-design-exploration.md` exists with wireframe, visual brief, and tech recommendation — PM-approved, Option B "Terminals" selected (CP-T004)
- [x] `docs/specs/installer-concept.md` exists and PM-approved (CP-T005)
- [x] All specs reviewed by PM; no unresolved blockers or open architectural questions

**Primary agents**: system_architect, frontend_developer, devops_engineer

---

## Phase 1 — Operability MVP

**Status: COMPLETE (2026-03-20)**
**v0.1.0: SHIPPED** — hold lifted 2026-03-20 after CP-D002 fix (commit bbdb6ee). All regression tests REG-002 through REG-006 pass against live DB.
**PM accepted**: 2026-03-20 — all 5 P0 blockers resolved, CI green, v0.1.0 declared ready

**Goal**: A working local web app where a user can inspect memory, history, Staff activity, instance state, and system health without SQL. This is the first deliverable that a real operator can use.

### Outcomes — All Core Outcomes Achieved

- User can answer "what does Iranti currently believe about X?" in under 30 seconds using the Memory Explorer ✓
- User can see Librarian and Archivist Staff activity in the stream in near-real time without reading logs ✓ (full 4-component coverage is Phase 2)
- User can view all instances and bound projects from one surface and diagnose basic setup issues ✓
- User can assess system health without running raw DB queries ✓
- The product looks intentional and distinctive in both light and dark mode — Terminals palette ✓

### Workstreams — Completed

- **Knowledge Base, Archive, Entity Detail & Relationships API** (backend_developer) — CP-T010 ✓
- **Instance Health & Metadata API** (backend_developer) — CP-T011 ✓
- **Staff Event Stream API** (backend_developer) — CP-T012 ✓ (polling adapter, Librarian + Archivist coverage)
- **Memory Explorer + Archive Explorer frontend** (frontend_developer) — CP-T013 ✓
- **Staff Activity Stream frontend** (frontend_developer) — CP-T014 ✓
- **Health & Diagnostics frontend** (frontend_developer) — CP-T015 ✓
- **Instance & Project Manager frontend** (frontend_developer) — CP-T016 ✓
- **Visual System & Shell Chrome** (frontend_developer) — CP-T017 ✓ (Terminals palette, light/dark mode, loading animation)
- **Phase 1 API Test Plan Execution** (qa_engineer) — CP-T018 ✓
- **Phase 1 UI Acceptance Test Execution** (qa_engineer) — CP-T019 ✓

### Open P0 Blocker Tickets (must resolve before v0.1.0 ships)

- **CP-T026** (frontend_developer) — Label Staff Activity Stream with Phase 1 coverage scope. Non-dismissible indicator showing which Staff components are instrumented.
- **CP-T027** (frontend_developer) — Design explicit empty states for Memory Explorer, Archive Explorer, and Staff Activity Stream. Three distinct variants per view: connected+no data, not connected, filtered+no results.
- **CP-T028** (frontend_developer) — Implement Health Dashboard severity taxonomy: Critical / Warning / Informational / Healthy. Anthropic balance unavailable and no escalations directory must both show as Informational.
- **CP-T029** (frontend_developer) — Instance health status must show last-checked timestamp and distinguish "Unreachable" from "Unknown."
- **CP-T030** (backend_developer + qa_engineer) — Verify temporal history endpoint returns archive intervals; QA seed test for v0.1.0.

### Open P1 Ticket (must pass before v0.1.0 ships)

- **CP-T031** (qa_engineer) — Verify instance context persists correctly across all Phase 1 views.

### Exit Criteria

- [x] User can browse knowledge_base and archive tables with filter and search
- [x] User can view entity detail with full temporal history
- [x] User can watch Staff event stream in real time, filterable by component (Librarian + Archivist; Attendant and Resolutionist explicitly labeled as Phase 2)
- [x] User can view all instances and their project bindings
- [x] User can view system health and connection diagnostics
- [x] Light mode and dark mode both pass visual review — Terminals palette, not generic gray/blue
- [x] Staff Activity Stream Phase 1 coverage explicitly labeled — CP-T026 (PM-accepted 2026-03-20)
- [x] Empty states distinguish connected+no data, not connected, and filtered+no results — CP-T027 (PM-accepted 2026-03-20)
- [x] Health Dashboard severity taxonomy implemented — CP-T028 (PM-accepted 2026-03-20)
- [x] Instance health status shows last-checked timestamp — CP-T029 (PM-accepted 2026-03-20)
- [x] Temporal history endpoint verified; QA seed test passes — CP-T030 (PM-accepted 2026-03-20; QA seed test result to be logged)
- [x] Instance context persistence verified — CP-T031 (conditionally accepted; Phase 1 single-backend architecture documented)
- [ ] All Phase 1 acceptance criteria checked by QA before PM accepts

**Primary agents**: frontend_developer, backend_developer, qa_engineer

**Complexity**: High — first working implementation, all stacks in play simultaneously

---

## Phase 2 — Interactive Management

**Status: IN PROGRESS — Wave 1 complete, Wave 2 completions accepted 2026-03-20 PM session 3**
**v0.1.0 HOLD: LIFTED** — All regression tests pass after CP-D002 fix (commit bbdb6ee). Hold lifted 2026-03-20 by PM.
**Prerequisite met**: Phase 1 complete, v0.1.0 PM-accepted and shipped 2026-03-20

**Goal**: User can manage the system from one surface for common tasks without dropping to the CLI or editing env files. This phase adds write surfaces, conflict review, embedded chat, and the installation/onboarding MVP.

### Outcomes

- User can configure providers and models from the control plane without editing env files (CP-T022)
- User can review and resolve conflicts surfaced by the Resolutionist from the control plane (CP-T021)
- User can chat with Iranti through an embedded panel without switching to another tool (CP-T020)
- User can repair broken integrations from the UI (CP-T033)
- New user can install and configure Iranti through a guided CLI wizard with significantly fewer manual steps than today (CP-T023)
- Operators can navigate the entire control plane by keyboard via Cmd+K command palette (CP-T024)
- Staff Activity Stream shows events from all four Staff components with < 200ms latency (CP-T025)
- Watching Staff activity live feels immediate — pulse indicator, velocity counter, hover-pause, live/paused badge (CP-T037)
- Entity relationships visible as an interactive graph, not just a flat list (CP-T032)

### Tickets Written

| ID | Title | Epic | Assigned | Priority | Status |
|----|-------|------|----------|----------|--------|
| CP-T020 | Embedded Chat Panel | CP-E007 | frontend + backend | P1 | Not started |
| CP-T021 | Conflict and Escalation Review UI | CP-E008 | frontend + backend | P1 | PM-ACCEPTED 2026-03-20 (frontend + backend complete; CP-D003 fix enabled routing) |
| CP-T022 | Provider and Model Manager | CP-E009 | backend + frontend | P1 | Not started |
| CP-T023 | CLI Setup Wizard (`iranti setup`) | CP-E010 | devops + backend | P1 | Spec in progress |
| CP-T024 | Command Palette (Cmd+K) | CP-E002 enhancement | frontend | P2 | PM-ACCEPTED 2026-03-20 (nav palette; search/recent deferred) |
| CP-T025 | Native Staff Emitter Injection | CP-E003 enhancement | system_architect + backend | P1 | Spec deliverables PM-ACCEPTED 2026-03-20; upstream PR ready for submission |
| CP-T042 | Command Palette — Inline Help and Command Documentation | CP-E002 enhancement | frontend | P2 | Open — new ticket 2026-03-20 |
| CP-T032 | Entity Relationship Graph View | CP-E002 enhancement | frontend + backend | P1 | Not started |
| CP-T033 | Integration Repair Actions UI | CP-E004 enhancement | frontend + backend | P1 | PM-ACCEPTED 2026-03-20 |
| CP-T034 | Provider Credit and Quota Visibility | CP-E009 | frontend + backend | P1 | Not started |
| CP-T035 | Getting Started Screen and First-Run Onboarding | CP-E010 | frontend + backend | P0 | PM-ACCEPTED 2026-03-20 |
| CP-T036 | Entity Detail and Temporal History Views | CP-E002 | frontend_developer | P0 | PM-accepted (prior session) |
| CP-T037 | Staff Activity Stream Live Mode UX | CP-E003 enhancement | frontend_developer | P1 | PM-ACCEPTED 2026-03-20 |
| CP-T039 | staff_events migration | DevOps | devops_engineer | P0 | PM-accepted |
| CP-T040 | v0.1.0 Release Notes + Known Issues | Documentation | technical_writer | P1 | PM-accepted 2026-03-20 |
| CP-T041 | memory-explorer.md review | Documentation | technical_writer | P2 | PM-accepted 2026-03-20 |

### v0.1.0 Hold Lift Criteria — HOLD LIFTED 2026-03-20

| Criterion | Status |
|-----------|--------|
| kb.ts SQL uses camelCase column names | PASS (CP-D001 fix, commit 8e5479c) |
| health.ts and events.ts checked | PASS |
| tsc --noEmit exits 0 | PASS |
| vitest run passes 104 tests | PASS |
| CI green on master | PASS |
| staff_events missing table handled gracefully | PASS |
| REG-001 (KB browse) | PASS |
| REG-002 (Archive browse) | PASS (two conflict-system archivedReason codes partially labeled — minor, non-blocking) |
| REG-003 (Entity detail — entity_relationships table) | **PASS** — CP-D002 fix in commit bbdb6ee |
| REG-004 (Temporal history — agentId column) | **PASS** — CP-D002 fix in commit bbdb6ee |
| REG-005 (archivedReason labels) | **PASS** — CP-D002 fix in commit bbdb6ee |
| REG-006 (Relationships endpoint) | **PASS** — 200, no SQL error |

**HOLD LIFTED:** PM wrote `project/iranti_control_plane v010_hold_status = lifted` 2026-03-20. v0.1.0 is shipped.

### Exit Criteria

- [ ] Entity detail view renders full facts/archive/relationships (CP-T036) — P0
- [ ] Temporal history timeline renders for a fact key with interval list and raw JSON expand (CP-T036) — P0
- [ ] Getting Started screen renders with 4-step setup status and auto-shows on first run (CP-T035) — P0
- [ ] Staff Activity Stream shows events from all four Staff components (CP-T025), or upstream PR is documented and in-progress with polling fallback active
- [ ] Live mode pulse indicator, velocity counter, and hover-pause are functional (CP-T037)
- [ ] Command palette is functional from every view (CP-T024)
- [ ] Entity relationship graph renders for entities with relationships (CP-T032)
- [ ] Integration repair actions (mcp-json, claude-md, run doctor) work and log to audit trail (CP-T033)
- [ ] Provider quota and credit visibility shows for configured providers (CP-T034)
- [ ] User can configure providers and models from the UI without manually editing config files (CP-T022)
- [ ] User can review and take action on Resolutionist conflicts from the control plane (CP-T021)
- [ ] Embedded chat panel is functional and usable for at least basic Iranti interactions (CP-T020)
- [ ] Installation path reduces setup steps vs current baseline — measured against CP-T005 documented baseline (CP-T023)
- [ ] All Phase 2 acceptance criteria checked by QA before PM accepts

**Primary agents**: frontend_developer, backend_developer, devops_engineer, system_architect, qa_engineer

**Dependencies**:
- Phase 1 complete and v0.1.0 accepted by PM
- CP-T005 installer concept memo PM-approved before CP-T023 is picked up (already approved)
- CP-T001 Staff Event Model spec PM-approved before CP-T025 is picked up (already approved)
- CP-T017 Phase 1 shell complete before CP-T020 can start (already complete)
- PM decision on supported providers list required at CP-T022 task start

**Complexity**: High — write surfaces, Resolutionist integration, upstream emitter proposal, installer scope all introduce new risk dimensions

---

## Phase 3 — Advanced Operator Features

**Status: FUTURE — blocked on Phase 2 completion**

**Goal**: Power-user and team-scale operator features for operators running Iranti at higher complexity or scale. Specific scope is gated on Phase 2 learnings and user feedback.

### Candidate Outcomes

- Operators running multiple instances can compare state across instances
- Power users can save workspaces, filters, and frequently-used views
- Data can be exported for external analysis or imported for recovery/migration
- Optional remote or team mode for multi-user shared operation (scope TBD)
- Signed macOS installer or Homebrew formula (if Phase 2 wizard adoption validates demand)
- Persistent cross-session conversation history in embedded chat
- Full-text search across fact values (not just entityId/key)

### Exit Criteria

- [ ] Phase 3 success metrics defined after Phase 2 retrospective
- [ ] Scope confirmed by PM before any Phase 3 tickets are cut

**Primary agents**: TBD based on Phase 2 outcomes

**Dependencies**: Phase 2 complete

**Complexity**: Medium-High — individual features are well-understood; team mode introduces significant new complexity if included

---

## Dependencies

- Upstream Iranti codebase access is required for Phase 2 native emitter injection (CP-T025) — system_architect must have read access to Librarian, Attendant, Archivist, and Resolutionist source files
- CP-T025 requires PM approval before any upstream Iranti core package changes are made
- All Phase 2 tickets are blocked on Phase 1 P0 blocker resolution (CP-T026–T030) and PM acceptance of v0.1.0
- CP-T023 (CLI setup wizard) requires CP-T005 to be PM-approved (already approved)
- Phase 3 scope is formally undefined until Phase 2 retrospective

## Risks

- **CP-T025 upstream rejection**: If the Iranti maintainer rejects the native emitter injection PR, Phase 2 must fall back to enhanced polling (shorter interval, dedicated events table). system_architect must design the fallback in parallel with the upstream proposal.
- **CP-T021 Resolutionist API gap**: If the Resolutionist does not yet expose a programmatic resolution pathway (may be CLI-only), the escalation review UI requires either subprocess wrapping or a new upstream API. Must be confirmed in first 2 days of CP-T021 pickup.
- **CP-T022 configuration write pathway**: If Iranti has no programmatic mechanism to change the default provider, the write-capable parts of CP-T022 must be scoped down to read-only in Phase 2. PM must confirm scope at task start.
- **CP-T023 macOS installer integration**: If registering `iranti setup` requires changes to the upstream Iranti CLI package, devops_engineer must coordinate with PM before proceeding. A standalone `npx iranti-setup` fallback must be designed.
- **Phase 3 team/remote mode**: Potentially large scope; should not be committed to until Phase 2 is stable and user demand is confirmed.
