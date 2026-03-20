# Iranti Control Plane — Roadmap

## Horizon

This roadmap covers the full delivery arc of the Iranti Control Plane from architectural foundation through power-user operator features. Phase 0 is active as of 2026-03-20. Phases 1–3 follow sequentially. Phase 3 scope will be refined after Phase 2 learnings.

## Strategic Themes

- **Operability without SQL**: Users should be able to understand and operate Iranti without touching the database or reading raw logs.
- **First-class installation**: Installation and onboarding are product surfaces, not prerequisites. The path from zero to running Iranti must be genuinely simple.
- **Deliberate visual design**: The control plane must look intentional in both light and dark mode. Generic admin dashboard aesthetics are not acceptable.
- **Spec before build**: Every Phase 0 spec must be PM-approved before Phase 1 implementation begins. No implementation should outrun its design.
- **Staff transparency**: Operators must be able to watch what the Librarian, Attendant, Archivist, and Resolutionist are doing in real time, not just read static state.

---

## Phase 0 — Foundation

**Status**: Active (current phase)

**Goal**: Establish the architectural and design foundations before any UI build begins. No production code is written in Phase 0. All output is specifications, design explorations, and concept memos — ready to be directly acted on in Phase 1.

### Outcomes

- Staff event model fully specified: schema, persistence strategy, event levels, and component coverage
- Read API surface fully specified: all 7 endpoint groups with paths, params, response schemas, and PRD requirement mappings
- Instance and project metadata aggregation design: field-to-source mapping, aggregation strategy, edge case handling
- Shell design direction approved: layout wireframe, visual palette options, technology recommendation
- Installer/onboarding concept evaluated: current path documented, options compared, recommendation made with Phase 2 complexity estimate

### Workstreams

- **Staff Event Model spec** (system_architect) — CP-T001
- **Control Plane Read API spec** (system_architect) — CP-T002, depends on CP-T001
- **Instance & Project Metadata Aggregation spec** (system_architect) — CP-T003, parallel to CP-T001
- **Local Web Shell Design Exploration** (frontend_developer) — CP-T004, no dependencies
- **Installer/Onboarding Concept Evaluation** (devops_engineer) — CP-T005, no dependencies

### Exit Criteria

- [ ] `docs/specs/staff-event-model.md` exists and PM-approved (CP-T001)
- [ ] `docs/specs/control-plane-api.md` exists and PM-approved (CP-T002)
- [ ] `docs/specs/instance-metadata-aggregation.md` exists and PM-approved (CP-T003)
- [ ] `docs/specs/shell-design-exploration.md` exists with wireframe, visual brief, and tech recommendation — PM-approved (CP-T004)
- [ ] `docs/specs/installer-concept.md` exists and PM-approved (CP-T005)
- [ ] All 5 specs reviewed by PM; no unresolved blockers or open architectural questions

**Primary agents**: system_architect, frontend_developer, devops_engineer

**Dependencies**: Upstream Iranti codebase access for schema review (system_architect)

**Complexity**: Medium — research and design heavy, no implementation. High coordination required between CP-T001 and CP-T002.

---

## Phase 1 — Operability MVP

**Status**: Not started — blocked on Phase 0 exit criteria

**Goal**: A working local web app where a user can inspect memory, history, Staff activity, instance state, and system health without SQL. This is the first deliverable that a real operator can use.

### Outcomes

- User can answer "what does Iranti currently believe about X?" in under 30 seconds using the Memory Explorer
- User can see Staff activity (Librarian, Attendant, Archivist, Resolutionist) in real time without reading logs
- User can view all instances and bound projects from one surface and diagnose basic setup issues
- User can assess system health without running raw DB queries
- The product looks intentional and distinctive in both light and dark mode

### Workstreams

- **Memory Explorer** (frontend_developer + backend_developer) — CP-E002
  - KB table browsing with filter/search
  - Archive table browsing
  - Entity detail view with temporal history
- **Staff Activity Stream** (backend_developer + frontend_developer) — CP-E003
  - Real-time or near-real-time event feed from all 4 Staff components
  - Filtering by component, level, time range
- **Instance & Project Manager** (backend_developer + frontend_developer) — CP-E004
  - Instance list with metadata
  - Project binding status
  - Integration health indicators
- **Health & Diagnostics** (backend_developer + frontend_developer) — CP-E005
  - System health summary
  - Connection status
  - Basic diagnostic indicators
- **Visual System** (frontend_developer) — CP-E006
  - Finalized light/dark mode palette
  - Component foundations
  - Typography and spacing system

### Exit Criteria

- [ ] User can browse knowledge_base and archive tables with filter and search
- [ ] User can view entity detail with full temporal history
- [ ] User can watch Staff event stream in real time, filterable by component
- [ ] User can view all instances and their project bindings
- [ ] User can view system health and connection diagnostics
- [ ] Product passes a basic usability check: a new user can orient without a manual
- [ ] Light mode and dark mode both pass visual review — no generic gray/blue aesthetics
- [ ] All Phase 1 acceptance criteria checked by QA before PM accepts

**Primary agents**: frontend_developer, backend_developer, qa_engineer

**Dependencies**: All Phase 0 specs completed and PM-approved

**Complexity**: High — first working implementation, all stacks in play simultaneously

---

## Phase 2 — Interactive Management

**Status**: Not started — blocked on Phase 1 completion

**Goal**: User can manage the system from one surface for common tasks without dropping to the CLI or editing env files. This phase adds write surfaces, conflict review, and the installation/onboarding MVP.

### Outcomes

- User can configure providers and models from the control plane without editing env files
- User can review and resolve conflicts surfaced by the Resolutionist from the control plane
- User can chat with Iranti through an embedded panel without switching to another tool
- User can repair broken integrations from the UI
- New user can install and configure Iranti through a guided setup experience with significantly fewer manual steps than today

### Workstreams

- **Embedded Chat Panel** (frontend_developer + backend_developer) — CP-E007
  - Embedded Iranti chat surface within the control plane shell
- **Conflict & Escalation Review UI** (frontend_developer + backend_developer) — CP-E008
  - List of active conflicts/escalations from Resolutionist
  - Resolution actions
- **Provider & Model Manager** (backend_developer + frontend_developer) — CP-E009
  - View and configure active providers and models
  - Update config without editing env files
- **Installation & Onboarding MVP** (devops_engineer + frontend_developer) — CP-E010
  - Based on CP-T005 recommendation
  - Guided setup flow or dedicated installer
  - Addresses top failure points identified in Phase 0

### Exit Criteria

- [ ] User can configure providers and models from the UI without manually editing config files
- [ ] User can review and take action on Resolutionist conflicts from the control plane
- [ ] Embedded chat panel is functional and usable for at least basic Iranti interactions
- [ ] Installation path reduces setup steps vs current baseline (measured against CP-T005 documented baseline)
- [ ] All Phase 2 acceptance criteria checked by QA before PM accepts

**Primary agents**: frontend_developer, backend_developer, devops_engineer, qa_engineer

**Dependencies**: Phase 1 complete; CP-T005 installer concept memo PM-approved before installer tickets are cut

**Complexity**: High — write surfaces, Resolutionist integration, installer scope all introduce new risk dimensions

---

## Phase 3 — Advanced Operator Features

**Status**: Not started — blocked on Phase 2 completion

**Goal**: Power-user and team-scale operator features for operators running Iranti at higher complexity or scale. Specific scope is gated on Phase 2 learnings and user feedback.

### Outcomes

- Operators running multiple instances can compare state across instances
- Power users can save workspaces, filters, and frequently-used views
- Data can be exported for external analysis or imported for recovery/migration
- Optional remote or team mode for multi-user shared operation (scope TBD)

### Workstreams

- Saved filters and workspaces
- Richer entity graph exploration
- Multi-instance comparison view
- Export and import tooling
- Optional remote/team mode (scope TBD based on Phase 2 learnings)

### Exit Criteria

- [ ] Phase 3 success metrics defined after Phase 2 retrospective
- [ ] Scope confirmed by PM before any Phase 3 tickets are cut

**Primary agents**: TBD based on Phase 2 outcomes

**Dependencies**: Phase 2 complete

**Complexity**: Medium-High — individual features are well-understood; team mode introduces significant new complexity if included

---

## Dependencies

- Upstream Iranti codebase access is required for Phase 0 schema and logging review (system_architect blocker)
- CP-T002 is blocked on CP-T001 (API surface's Staff event stream endpoint shape depends on the event model spec)
- All Phase 1 tickets are blocked on PM approval of all Phase 0 specs
- Phase 2 installer tickets are blocked on PM approval of CP-T005 installer concept memo
- Phase 3 scope is formally undefined until Phase 2 retrospective

## Risks

- Upstream Iranti schema or logging surfaces may differ from what the PRD assumed; architect must verify before specifying
- Staff event volume could be high enough to require throttling or sampling at the stream level — must be addressed in CP-T001
- Visual direction is sticky: wrong choice in Phase 0 causes expensive rework in Phase 1; PM must approve before any implementation
- Installer scope can grow unboundedly; CP-T005 must be opinionated about MVP scope before Phase 2 tickets are cut
- Phase 3 team/remote mode is potentially large scope; should not be committed to until Phase 2 is stable
