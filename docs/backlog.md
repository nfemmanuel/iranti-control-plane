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
Status: **COMPLETE — 2026-03-20**
Tier: Must Have
Description: Architectural and design foundations for the control plane. Covers Staff event model spec, read API surface spec, instance metadata aggregation design, shell layout and visual direction exploration, and installer concept evaluation. No production code is written in this epic — all outputs are specs, wireframes, and memos. Every Phase 1 epic is blocked until CP-E001 is complete and PM-approved.
Linked tickets: CP-T001, CP-T002, CP-T003, CP-T004, CP-T005

---

### CP-E002 — Memory Explorer

Phase: 1
Owner: frontend_developer, backend_developer
Status: **COMPLETE — 2026-03-20** (CP-T010, CP-T013, CP-T036, CP-T032)
Tier: Must Have
Description: The primary read surface for Iranti's memory. Users can browse knowledge_base and archive tables with filter and search, view entity detail pages with full temporal history, and explore entity relationships. Powers FR1 and FR2 from the PRD. Blocked on CP-E001 (specifically CP-T001 event model and CP-T002 API spec).
Linked tickets: TBD

---

### CP-E003 — Staff Activity Stream

Phase: 1–3
Owner: backend_developer, frontend_developer
Status: **COMPLETE — 2026-03-20** (CP-T012, CP-T014, CP-T037, CP-T025, CP-T050)
Tier: Must Have
Description: Real-time or near-real-time event feed of Librarian, Attendant, Archivist, and Resolutionist activity. Operators can watch what the Staff is doing, filter by component or event level, and correlate events to specific entities and agents. Powers FR3 from the PRD. Blocked on CP-T001 (Staff event model must be specified before stream can be built).
Linked tickets: TBD

---

### CP-E004 — Instance & Project Manager

Phase: 1
Owner: backend_developer, frontend_developer
Status: **COMPLETE — 2026-03-20** (CP-T011, CP-T016, CP-T033)
Tier: Must Have
Description: A unified view of all Iranti instances and their bound projects. Shows instance runtime metadata, env file state, port configuration, project binding status, and Claude/Codex integration file presence. Powers FR4 from the PRD. Blocked on CP-T003 (metadata aggregation spec must define field sources and aggregation strategy before backend or frontend can build).
Linked tickets: TBD

---

### CP-E005 — Health & Diagnostics

Phase: 1
Owner: backend_developer, frontend_developer
Status: **COMPLETE — 2026-03-20** (CP-T011, CP-T015, CP-T028, CP-T029, CP-T034)
Tier: Must Have
Description: System health summary and diagnostic view. Shows DB connection status, Iranti service status, Staff operational state, and basic error indicators that help an operator diagnose why something isn't working without running raw queries. Powers FR5 from the PRD.
Linked tickets: TBD

---

### CP-E006 — Visual System

Phase: 1
Owner: frontend_developer
Status: **COMPLETE — 2026-03-20** (CP-T017 — Terminals palette, light/dark mode)
Tier: Must Have
Description: Deliberate visual design system for the control plane shell. Covers finalized light and dark mode palettes, typography, spacing system, and component foundations. Must be distinctive — not a generic gray/blue admin dashboard. Builds directly on CP-T004 shell design exploration. All Phase 1 UI work depends on this foundation.
Linked tickets: TBD

---

### CP-E007 — Embedded Chat

Phase: 2
Owner: frontend_developer, backend_developer
Status: **COMPLETE — 2026-03-20** (CP-T020)
Tier: Should Have
Description: An embedded Iranti chat panel within the control plane shell, allowing operators to interact with Iranti without switching to another tool. Powers FR6 from the PRD. Blocked on Phase 1 completion and stable shell infrastructure.
Linked tickets: TBD

---

### CP-E008 — Conflict & Escalation Review

Phase: 2
Owner: frontend_developer, backend_developer
Status: **COMPLETE — 2026-03-20** (CP-T021)
Tier: Should Have
Description: A UI surface for reviewing and resolving conflicts and escalations surfaced by the Resolutionist. Operators can see active conflicts, understand the source of disagreement, and take resolution actions from the control plane. Powers FR7 from the PRD. Requires Resolutionist integration design.
Linked tickets: TBD

---

### CP-E009 — Provider & Model Manager

Phase: 2
Owner: backend_developer, frontend_developer
Status: **COMPLETE (read-only) — 2026-03-20** (CP-T022, CP-T034, CP-T046). Write path deferred to Phase 3.
Tier: Should Have
Description: View and configure active LLM providers and models from the control plane without manually editing env files or config. Covers provider list, active model per Staff component, and basic configuration actions. Powers FR8 from the PRD.
Linked tickets: TBD

---

### CP-E010 — Installation & Onboarding

Phase: 2–3
Owner: devops_engineer, frontend_developer
Status: **Phase 2 COMPLETE — 2026-03-20** (CP-T023 CLI wizard, CP-T035 Getting Started view). Phase 3: CP-T048 platform installers in progress — implementation complete, AC-11 testing pending.
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

---

### CP-E011 — Advanced Operator Features (Phase 3)

Phase: 3
Owner: backend_developer, frontend_developer, devops_engineer
Status: **IN PROGRESS** — Waves 1–9 active; CP-T065 PM-ACCEPTED 2026-03-21; CP-T066, CP-T067 OPEN (Wave 9)
Tier: Should Have
Description: Power-user features for operators running Iranti at scale. Persistent Staff event log history (CP-T050), Archivist decision transparency and operator review/restore (CP-T049), platform-native installer packages (CP-T048), Agent Registry View (CP-T051), Health extensions (CP-T052), Memory Explorer field label improvements (CP-T053), temporal asOf query (CP-T056), WhoKnows contributor panel (CP-T057), operator guidance UX labels (CP-T058), Interactive Diagnostics (CP-T059), Metrics Dashboard (CP-T060), Entity Alias Management UI (CP-T061), Relationship Graph B9 note (CP-T062), API Key Scope Audit (CP-T063), documentation updates (CP-T064), alias panel rewrite (CP-T065). Wave 9 adds CP-T066 (KB Search) and CP-T067 (Entity Type Browser).
Linked tickets: CP-T050, CP-T049, CP-T048, CP-T051, CP-T052, CP-T053, CP-T056, CP-T057, CP-T058, CP-T059, CP-T060, CP-T061, CP-T062, CP-T063, CP-T064, CP-T065, CP-T066, CP-T067

---

---

### CP-E012 — Diagnostics (Phase 3)

Phase: 3
Owner: backend_developer, frontend_developer
Status: **IN PROGRESS** — backend PM-ACCEPTED 2026-03-21; frontend pending (Wave 6)
Tier: Should Have
Description: An active diagnostic surface within the control plane, beyond the passive Health Dashboard. Operators can trigger live connectivity checks, Staff round-trip tests (ingest write/read, attend probe, vector search quality), and receive actionable fix suggestions from within the UI — equivalent to `iranti doctor` but with richer output and operator guidance. Powers a key operator workflow: "something's wrong, diagnose it from the control plane."
Linked tickets: CP-T059

---

### CP-E013 — Metrics Dashboard (Phase 3)

Phase: 3
Owner: backend_developer, frontend_developer
Status: **OPEN** — stub ticket CP-T060 drafted 2026-03-21; scope reviewed and ready for Wave 7 dispatch
Tier: Nice to Have
Description: Time-dimension view of Iranti operational signals. KB growth rate, agent write volume, rejection and escalation trends — all derived from the existing `staff_events` table (CP-T039). Completes the "passive → interactive → historical" progression of the Health/Diagnostics surface. Operators can answer "how fast is the KB growing?" and "which agents have been most active this week?" for the first time.
PM Scope Notes (2026-03-21): SVG-native charts only (no Recharts/Chart.js/canvas). Periods: 7d and 30d at MVP (90d deferred). totalFacts from staff_events WRITE_ACCEPTED accumulation (not live /kb/query). Backend should index staff_events on (timestamp, agent_id, action_type). AC-9 empty state: show if staff_events has 0 rows.
Linked tickets: CP-T060

---

---

### CP-E014 — Knowledge Base Power Features (Phase 3)

Phase: 3
Owner: backend_developer, frontend_developer
Status: **IN PROGRESS** — CP-T061 (Entity Alias Management) complete; CP-T065 (Alias Panel Rewrite) PM-ACCEPTED 2026-03-21; CP-T066 (KB Search) and CP-T067 (Entity Type Browser) OPEN Wave 9
Tier: Should Have
Description: Advanced KB inspection and search capabilities for operators who need to navigate and reason about the knowledge base at scale. Covers entity alias management (find canonical forms, register lookup tokens), full-text and semantic search across all KB facts using the native Iranti /kb/search endpoint, and entity type discovery (browse the KB's structural taxonomy without prior knowledge of entity types). These features close the gap between the Memory Explorer's current browse-only model and a true operator knowledge management surface.
Linked tickets: CP-T061, CP-T065, CP-T066, CP-T067

---

## Subtasks

- [x] Phase 0: All 5 tickets (CP-T001 through CP-T005) assigned and accepted by agents
- [x] Phase 0: All 5 specs/memos produced and submitted for PM review
- [x] Phase 0: All 5 specs/memos PM-approved before Phase 1 tickets are cut
- [x] Phase 1: CP-E002 through CP-E006 features decomposed and delivered — all PM-accepted 2026-03-20
- [x] Phase 2: CP-E007 through CP-E010 features decomposed and delivered — all PM-accepted 2026-03-20
- [x] Phase 3: Scope defined after Phase 2 retrospective — CP-E011 defined, tickets in flight
- [x] Phase 3 Wave 4: CP-T051, CP-T052, CP-T053 — PM-ACCEPTED 2026-03-21
- [ ] Phase 3: CP-T048 clean-machine testing (AC-11) — blocked on CI artifact availability
- [x] Phase 3 Wave 5: CP-T056, CP-T057, CP-T058 — PM-ACCEPTED 2026-03-21
- [x] Phase 3 Wave 6: CP-T059 (Diagnostics Panel) — PM-ACCEPTED 2026-03-21
- [x] Phase 3 Wave 7: CP-T060 (Metrics Dashboard, CP-E013) — PM-ACCEPTED 2026-03-21
- [x] Phase 3 Wave 8: CP-T061 (backend+CP-T065 frontend), CP-T062, CP-T063, CP-T064 — all PM-ACCEPTED 2026-03-21
- [x] Phase 3 Wave 9: CP-T065 (Alias Panel Rewrite) — PM-ACCEPTED 2026-03-21
- [ ] Phase 3 Wave 9: CP-T066 (KB Full-Text Search) — OPEN
- [ ] Phase 3 Wave 9: CP-T067 (Entity Type Browser) — OPEN
