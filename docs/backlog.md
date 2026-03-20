# Iranti Control Plane — Backlog

## Themes

- **Foundation before build**: All architectural and design decisions must be specified and PM-approved before any implementation begins.
- **Operator-first**: Every epic must be traceable to a real operator need — not a technical exercise.
- **Installation as a first-class surface**: Setup and onboarding are product deliverables, not prerequisites.
- **Deliberate aesthetics**: Visual system is a named epic, not an afterthought.

---

## Epics

### CP-E001 — Control Plane Foundation

Phase: 0
Owner: system_architect, devops_engineer
Status: In progress
Tier: Must Have
Description: Architectural and design foundations for the control plane. Covers Staff event model spec, read API surface spec, instance metadata aggregation design, shell layout and visual direction exploration, and installer concept evaluation. No production code is written in this epic — all outputs are specs, wireframes, and memos. Every Phase 1 epic is blocked until CP-E001 is complete and PM-approved.
Linked tickets: CP-T001, CP-T002, CP-T003, CP-T004, CP-T005

---

### CP-E002 — Memory Explorer

Phase: 1
Owner: frontend_developer, backend_developer
Status: Not started
Tier: Must Have
Description: The primary read surface for Iranti's memory. Users can browse knowledge_base and archive tables with filter and search, view entity detail pages with full temporal history, and explore entity relationships. Powers FR1 and FR2 from the PRD. Blocked on CP-E001 (specifically CP-T001 event model and CP-T002 API spec).
Linked tickets: TBD

---

### CP-E003 — Staff Activity Stream

Phase: 1
Owner: backend_developer, frontend_developer
Status: Not started
Tier: Must Have
Description: Real-time or near-real-time event feed of Librarian, Attendant, Archivist, and Resolutionist activity. Operators can watch what the Staff is doing, filter by component or event level, and correlate events to specific entities and agents. Powers FR3 from the PRD. Blocked on CP-T001 (Staff event model must be specified before stream can be built).
Linked tickets: TBD

---

### CP-E004 — Instance & Project Manager

Phase: 1
Owner: backend_developer, frontend_developer
Status: Not started
Tier: Must Have
Description: A unified view of all Iranti instances and their bound projects. Shows instance runtime metadata, env file state, port configuration, project binding status, and Claude/Codex integration file presence. Powers FR4 from the PRD. Blocked on CP-T003 (metadata aggregation spec must define field sources and aggregation strategy before backend or frontend can build).
Linked tickets: TBD

---

### CP-E005 — Health & Diagnostics

Phase: 1
Owner: backend_developer, frontend_developer
Status: Not started
Tier: Must Have
Description: System health summary and diagnostic view. Shows DB connection status, Iranti service status, Staff operational state, and basic error indicators that help an operator diagnose why something isn't working without running raw queries. Powers FR5 from the PRD.
Linked tickets: TBD

---

### CP-E006 — Visual System

Phase: 1
Owner: frontend_developer
Status: Not started
Tier: Must Have
Description: Deliberate visual design system for the control plane shell. Covers finalized light and dark mode palettes, typography, spacing system, and component foundations. Must be distinctive — not a generic gray/blue admin dashboard. Builds directly on CP-T004 shell design exploration. All Phase 1 UI work depends on this foundation.
Linked tickets: TBD

---

### CP-E007 — Embedded Chat

Phase: 2
Owner: frontend_developer, backend_developer
Status: Not started
Tier: Should Have
Description: An embedded Iranti chat panel within the control plane shell, allowing operators to interact with Iranti without switching to another tool. Powers FR6 from the PRD. Blocked on Phase 1 completion and stable shell infrastructure.
Linked tickets: TBD

---

### CP-E008 — Conflict & Escalation Review

Phase: 2
Owner: frontend_developer, backend_developer
Status: Not started
Tier: Should Have
Description: A UI surface for reviewing and resolving conflicts and escalations surfaced by the Resolutionist. Operators can see active conflicts, understand the source of disagreement, and take resolution actions from the control plane. Powers FR7 from the PRD. Requires Resolutionist integration design.
Linked tickets: TBD

---

### CP-E009 — Provider & Model Manager

Phase: 2
Owner: backend_developer, frontend_developer
Status: Not started
Tier: Should Have
Description: View and configure active LLM providers and models from the control plane without manually editing env files or config. Covers provider list, active model per Staff component, and basic configuration actions. Powers FR8 from the PRD.
Linked tickets: TBD

---

### CP-E010 — Installation & Onboarding

Phase: 2
Owner: devops_engineer, frontend_developer
Status: Not started
Tier: Should Have
Description: A dramatically simpler Iranti installation and first-run experience. Based directly on the CP-T005 concept memo recommendation. Scope — whether a dedicated installer, a guided setup flow embedded in the control plane, or a hybrid — is determined in Phase 0. Must address the top failure points in the current setup path. Powers FR9 and ER5 from the PRD. Tickets for this epic must not be cut until CP-T005 is PM-approved.
Linked tickets: TBD

---

## Features

Features will be decomposed from each epic when the epic's phase begins. Phase 0 epics are fully decomposed into tickets above. Phase 1 and Phase 2 features will be defined after Phase 0 specs are PM-approved.

## Stories

Stories will be written per feature during the relevant phase planning. Format follows the template:
As a [persona], I want [capability] so that [outcome].

## Tasks

Tasks will be assigned per story during sprint planning within each phase.

## Subtasks

- [ ] Phase 0: All 5 tickets (CP-T001 through CP-T005) assigned and accepted by agents
- [ ] Phase 0: All 5 specs/memos produced and submitted for PM review
- [ ] Phase 0: All 5 specs/memos PM-approved before Phase 1 tickets are cut
- [ ] Phase 1: CP-E002 through CP-E006 features decomposed after Phase 0 exit
- [ ] Phase 2: CP-E007 through CP-E010 features decomposed after Phase 1 exit
- [ ] Phase 3: Scope defined after Phase 2 retrospective
