# Iranti Control Plane PRD

> **Document status as of 2026-03-20:** Phase 0 complete. Phase 1 **COMPLETE** — all 10 core tickets delivered and PM-accepted, all 5 P0 blocker tickets (CP-T026–T030) PM-accepted, CP-T031 conditionally accepted (Phase 1 single-backend architecture documented). v0.1.0 declared ready by PM. CI green. Phase 2 tickets written (CP-T020–T025, CP-T032–T035) and ready to start.

## Problem

Iranti is usable today through the CLI, direct database inspection, Adminer, MCP integrations, and SDKs, but operating it still assumes too much infrastructure literacy. Users who want to understand what the Staff is doing, inspect current memory state, review temporal history, manage project bindings, or troubleshoot integrations are forced into raw SQL, scattered CLI commands, or local file inspection.

The product gap is not memory capability. The gap is operability.

Iranti needs a first-class control plane that lets users manage their own Iranti instances without dropping into PostgreSQL, Docker, or filesystem internals.

## Vision

Build an Iranti control plane that gives users one place to:
- inspect the current and historical state of memory
- watch the Librarian, Attendant, Archivist, and Resolutionist activity in real time
- manage instances, projects, bindings, and integrations
- configure default LLM providers and task-specific model routing
- inspect provider usage, remaining credits, and quota health where upstream APIs expose that data
- install or set up Iranti through a much simpler guided flow
- launch and use Iranti Chat without leaving the management surface
- review conflicts, archive events, and health signals without touching the database directly

This is the missing operating surface for Iranti as a product.

## Product Principles

- Readability before cleverness: operators should understand what Iranti believes and why.
- Read-only by default: inspection should be safer than mutation.
- Staff-centric observability: every major action should be attributable to a Staff component, agent, source, and timestamp.
- Project-scoped clarity: users should always know which instance, project, and database they are looking at.
- Progressive power: basic tasks should not require SQL, but advanced users should still be able to inspect raw fields and provenance.

## Target Users

### Primary
- solo developers using Iranti locally with Claude Code, Codex, or API wrappers
- technical founders evaluating Iranti as shared memory infrastructure
- early design partners managing multiple project bindings and local instances

### Secondary
- team leads reviewing conflicts, memory quality, and integration health
- operators debugging provider setup, project bindings, and upgrade state

## Goals

1. Make it easy to inspect the live memory state without raw SQL.
2. Make Staff activity visible in real time.
3. Make project and instance management coherent from one surface.
4. Reduce onboarding friction by replacing low-level debugging steps with guided views and a materially simpler installation/setup flow.
5. Preserve Iranti's existing consistency model and auditability while exposing it more clearly.

## Non-Goals

- Replace PostgreSQL with a proprietary storage layer.
- Add arbitrary direct database write capability from the UI.
- Rebuild the full SDK/API surface as a separate product.
- Hide provenance, archive history, or conflict mechanics behind oversimplified UI.
- Build a hosted multi-tenant SaaS admin panel in v1.

## Primary User Jobs

### 1. Inspect Current Memory
A user wants to see what Iranti currently believes about an entity or project, including summary, raw value, source, confidence, validFrom, and related facts.

### 2. Inspect Temporal History
A user wants to see how a fact changed over time, including superseded and contradicted intervals.

### 3. Watch Staff Activity
A user wants to watch the Librarian ingest writes, the Attendant load memory, the Archivist archive or resolve entries, and the Resolutionist process escalations.

### 4. Manage Instances and Projects
A user wants to see all local instances, bound projects, runtime roots, database targets, ports, and integration status from one place.

### 5. Configure Models and Providers
A user wants to inspect and manage default LLM providers, task-specific model overrides, stored provider credentials, and available credit or quota signals without editing env files by hand.

### 6. Resolve Issues Without SQL
A user wants to troubleshoot health, conflicts, integrations, and provider setup without needing `psql`, Adminer, or file spelunking.

### 7. Use Chat as an Operator Surface
A user wants access to Iranti Chat from the same management surface so they can inspect memory, write facts, test retrieval, and run slash commands.

### 8. Install Iranti Without Infrastructure Guesswork
A user wants a straightforward path to install, configure, and launch Iranti without already knowing how to set up PostgreSQL, local runtimes, env files, or integrations by hand.

## Proposed Product Surface

## 1. Control Plane Shell
A local operator surface exposed in one of two forms:
- a local web app served by the existing Iranti runtime, or
- a richer TUI layered on top of the current CLI

Recommendation: local web app.

Reason:
- real-time Staff logs, tables, history timelines, and relationship graphs are materially better in a browser
- it can still be local-first and instance-bound
- it avoids overloading the CLI with dashboard responsibilities

Suggested entry points:
- `iranti control-plane`
- `iranti dashboard`
- `iranti open`

> **Phase 1 decision (2026-03-20):** Local web app confirmed. Entry point is `iranti open`. Technology stack: React + Vite frontend, Express backend (existing Iranti server extended). Visual direction: Option B "Terminals" (emerald accent, near-black canvas, monospace typography). See `docs/specs/shell-design-exploration.md` and `docs/specs/visual-tokens.md`.

## 2. Memory Explorer
Core views:
- current facts table for `knowledge_base`
- archive table for `archive`
- entity detail page
- temporal history timeline per `entity/key`
- relationship view for `entity_relationships`
- raw JSON inspector for `valueRaw`, `properties`, and `conflictLog`

Required capabilities:
- filter by entityType, entityId, key, source, createdBy, confidence, archivedReason
- search by keyword and entity identity
- toggle summary view vs raw JSON view
- jump from a fact to its related entities and archived intervals

> **Phase 1 status (2026-03-20):** Memory Explorer implemented. KB table browse, archive browse, entity detail, and temporal history view all delivered. Relationship view delivered as flat list in Phase 1; graph visualization deferred to Phase 2 (CP-T032). Entity aliases endpoint deferred to Phase 2 (PM Decision 2).

## 3. Staff Activity Stream
A live event stream showing Staff actions with timestamps.

Events should include at minimum:
- Librarian write created / replaced / escalated / rejected
- Attendant handshake / reconvene / attend / observe activity
- Archivist archive / decay / escalation processing
- Resolutionist file resolution decisions
- system health and integration lifecycle events

Each event should show:
- Staff component
- action type
- entity and key when applicable
- agent id
- source
- reason / note
- link to affected fact or escalation file

Recommendation:
- implement as an append-only event feed sourced from structured runtime logs or a dedicated event table
- do not scrape console output

> **Phase 1 status (2026-03-20):** Staff Activity Stream delivered using database polling adapter (PM Decision 3). Phase 1 stream covers Librarian events and Archivist events via polling. Attendant and Resolutionist events are not yet instrumented — this is explicitly labeled in the UI with a Phase 1 coverage indicator (CP-T026, P0 open). Native Staff emitter injection is Phase 2 scope (CP-T025). Event persistence strategy: DB table approach confirmed (OQ-3 resolved).

## 4. Instance and Project Manager
A management view for:
- all known instances
- runtime roots
- database connection targets
- configured ports
- project bindings
- `.env.iranti` status
- Claude/Codex integration status
- API key presence and scope summary

Desired actions:
- create instance
- inspect instance env
- inspect project binding
- rebind project to instance
- open escalation directory
- run doctor for a specific instance
- run upgrade / setup actions from the UI

> **Phase 1 status (2026-03-20):** Instance and Project Manager delivered in read-only form. Instance list, runtime metadata, project binding status, and integration health indicators are all present. Instance registry uses filesystem fallback scan in Phase 1 (PM Decision 5). Write/repair actions (rebind, run doctor, regenerate integration files) deferred to Phase 2 (CP-T033). Instance context persistence across views verified by QA (CP-T031).

## 5. Provider and Model Manager
A management view for:
- default provider selection
- task-type routing overrides
- configured provider credentials per instance
- provider reachability and auth status
- remaining credits, quota usage, or balance visibility where the upstream provider exposes that information
- warnings when balance or quota is low

Desired actions:
- set default provider
- set per-task model overrides
- inspect stored provider key presence without exposing secrets
- refresh provider health and credit signals
- jump directly to provider-specific setup and repair guidance

> **Phase 1 status (2026-03-20):** Provider health shown in the Health view as a traffic-light card (read-only). Full Provider and Model Manager with configuration capability is Phase 2 scope (CP-T022). Provider balance/quota display: best-effort capability matrix approach (PM Decision 4) — providers that do not expose balance via API show an Informational status, not a Warning.

## 6. Embedded Iranti Chat
Expose `iranti chat` from within the control plane.

Requirements:
- choose agent id, provider, and model
- preserve conversation history for the session
- expose slash commands in an operator-friendly command palette or side panel
- show retrieved memory blocks and write results explicitly
- allow jumping from chat output to inspected facts in Memory Explorer

> **Phase 1 status (2026-03-20):** Embedded chat deferred to Phase 2 (PM Decision 6). The Phase 1 shell reserves a right-side panel slot for the chat panel. Full embedded chat implementation is CP-T020.

## 7. Conflict and Escalation Review
A dedicated surface for:
- pending escalations
- resolved escalations
- archive intervals with `resolutionState = pending`
- Resolutionist actions

Desired actions:
- open pending escalation
- compare existing vs challenger fact side by side
- resolve via existing / challenger / custom value
- see what the Archivist will consume
- inspect affected entities and conflict reasons

> **Phase 2 scope (CP-T021):** Not yet started. Blocked on Phase 1 completion and Resolutionist API surface specification.

## 8. Health and Diagnostics
A diagnostics surface that consolidates:
- `iranti doctor`
- provider credential status
- default provider and model routing status
- provider credits / quota / billing signals when available
- database reachability
- vector backend status
- integration status for Claude/Codex/MCP
- runtime version vs latest version
- project binding health
- setup preflight signals

This should be the first screen new users see after install.

> **Phase 1 status (2026-03-20):** Health and Diagnostics view delivered. Four-tier severity taxonomy (Critical / Warning / Informational / Healthy) implemented (CP-T028, P0 open). Key taxonomy decisions: provider balance unavailable for Anthropic shows as Informational (not Warning), no escalations directory shows as Informational, minor version gap shows as Informational.

## 9. Installation and Onboarding
A dedicated setup surface for:
- guided install and first-run flow
- dependency checks and remediation
- instance creation
- database setup path selection
- provider setup
- project binding
- Claude/Codex integration setup
- verification that the system is actually working after setup

Desired actions:
- choose a recommended install path for the current machine
- download or launch an installer flow where appropriate
- set up a local instance end-to-end
- bind one or more projects
- confirm the system is healthy with a clear success state
- recover from common setup failures without dropping to raw infrastructure commands

> **Phase 2 scope (CP-T023):** CLI setup wizard (`iranti setup`) using `clack` interactive prompts. Full macOS support targeting under 3 minutes for a fresh install. Reduced depth on Windows. Linux guidance deferred. Installer concept evaluation (CP-T005) must be accepted before implementation begins. PM Decision 7: CLI wizard approach confirmed as Phase 2 installer path.

## Functional Requirements

### FR1. Read-Only Database Browsing
The control plane must let the user inspect current KB, archive, relationships, entities, and aliases without direct SQL.

> **Phase 1 status:** Delivered. Entity aliases excluded in Phase 1 (deferred to Phase 2, PM Decision 2).

### FR2. Temporal Fact History
The control plane must display full temporal history for a fact, including validFrom, validUntil, archivedReason, supersededBy, and current status.

> **Phase 1 status:** Delivered. Backend correctness and QA seed test in final verification (CP-T030, P0 open).

### FR3. Live Staff Logs
The control plane must expose a live or near-live Staff activity stream with filterable structured events.

> **Phase 1 status:** Delivered (polling adapter, Librarian + Archivist coverage). Coverage labeled with Phase 2 roadmap reference. Full coverage via native emitter injection is Phase 2 (CP-T025).

### FR4. Instance Awareness
The control plane must show which runtime root, instance, and database are active, and let the user switch context safely.

> **Phase 1 status:** Delivered. Context persistence across views verified by QA (CP-T031).

### FR5. Project Binding Management
The control plane must show which projects are bound to which instances and whether those projects have Claude/Codex integration files configured.

> **Phase 1 status:** Delivered (inspect only). Mutation/repair actions are Phase 2 (CP-T033).

### FR6. Embedded Chat
The control plane must provide a usable chat experience backed by the existing Iranti Chat capabilities.

> **Phase 2 scope:** CP-T020. Panel slot reserved in Phase 1 shell.

### FR7. Provider and Model Configuration
The control plane must let the user inspect and change default providers, task-type model overrides, and provider credential status through supported configuration pathways rather than raw env editing.

> **Phase 2 scope:** CP-T022. Phase 1 delivers read-only provider health check.

### FR8. Provider Credit Visibility
Where upstream providers expose balance, credits, or quota information through an API, the control plane should display that status clearly with timestamps and degraded-state warnings.

> **Phase 2 scope:** Best-effort capability matrix (PM Decision 4). Providers without balance APIs show Informational status.

### FR9. Installation and Setup Experience
The control plane should provide or launch a dramatically simpler installation and onboarding flow, potentially including a dedicated installer or bootstrap experience for local development use cases.

> **Phase 2 scope:** CP-T023 CLI setup wizard.

### FR10. Conflict Review
The control plane must expose pending escalations and resolution state without requiring direct file editing.

> **Phase 2 scope:** CP-T021.

### FR11. Safe Mutations
Any write-capable actions must go through existing API/CLI/Librarian pathways. The control plane must not write directly to DB tables.

> **Ongoing:** All Phase 1 and Phase 2 write actions are routed through existing public operations. No direct DB writes are permitted.

### FR12. Auditability
All destructive or state-changing operations initiated from the control plane must be attributable to a user action, timestamp, and underlying system call.

> **Ongoing:** Phase 2 repair actions (CP-T033) log to audit trail with `agentId: control_plane_repair`.

### FR13. Local-First Operation
The first version should run entirely on a local machine against a local Iranti instance. Hosted remote multi-user operation is out of scope for v1.

> **Confirmed:** Phase 1 and Phase 2 are local-only. Phase 3 scope for remote/team mode is TBD.

## Experience Requirements

### ER1. Fast Time to Clarity
A user should be able to answer "what does Iranti currently believe about this entity?" in under 30 seconds from opening the control plane.

### ER2. Fast Time to Root Cause
A user should be able to answer "why did that write conflict, disappear, or fail?" without dropping into SQL or log files.

### ER3. Minimal Context Switching
A user should not need to jump between terminal, Adminer, `.env.iranti`, `.mcp.json`, and escalation markdown for common operational tasks.

### ER4. Delightful Visual Identity
The control plane should not look like a generic admin dashboard. It should use distinctive, beautiful, intentional visual systems for both light and dark mode while preserving operational clarity.

> **Phase 1 decision (2026-03-20):** Visual direction confirmed as Option B "Terminals" — emerald accent (`#10b981`), near-black canvas (`#0a0a0a` dark / `#fafaf9` light), monospace accent typography. Full token system documented in `docs/specs/visual-tokens.md`. Loading animation selected from css-loaders.com.

### ER5. Low-Friction Setup
A new user should be able to get Iranti installed and into a working state with guided help instead of assembling infrastructure from scattered commands and docs.

> **Phase 2 target:** CLI setup wizard (CP-T023) addressing top failure points from CP-T005 evaluation.

## Technical Approach

### Recommendation
Build the first version as a local web app backed by new read-focused API endpoints plus a structured Staff event stream.

### Why this is lower risk than a bespoke desktop app
- leverages the existing Express server
- aligns with current API-first architecture
- keeps local auth and instance context straightforward
- can be shipped incrementally behind local-only routes

### Proposed Architecture
- Backend: extend existing API server with control-plane read endpoints and event streaming
- Frontend: minimal local web UI, local-only initially
- Source of truth: existing DB tables, escalation files, instance config, structured event stream
- Mutations: call existing CLI/API routes, never write around them
- Installer path: evaluate whether the first setup experience should remain CLI-driven with a richer guided layer or become a dedicated installer/bootstrap workflow

> **Phase 1 implementation (2026-03-20):** Architecture confirmed per proposal. Backend uses Express routes under `/api/control-plane/` namespace. Frontend is React + Vite with Tailwind CSS. DB access via Prisma v7. Staff event stream uses polling adapter in Phase 1 (2-second interval). SSE endpoint at `/api/control-plane/events`. See `docs/guides/architecture.md` for full architecture reference.

## Data Sources the Control Plane Needs

- `knowledge_base`
- `archive`
- `entity_relationships`
- `entities`
- `entity_aliases`
- escalation folder state
- runtime env / instance metadata
- project binding metadata
- provider configuration and model routing metadata
- provider balance / quota telemetry where supported
- provider key configuration summary
- structured Staff events
- setup/install diagnostics and machine capability metadata

> **Phase 1 note:** `entities` table does not exist in current Iranti schema — `entity` field returns `null` in all entity detail responses. `entity_aliases` endpoint deferred to Phase 2. All other sources confirmed and active.

## Major Gaps to Close Before Build

> **Status as of 2026-03-20 — all Phase 0 gaps resolved:**

1. ~~There is no first-class structured Staff event bus yet.~~ **Resolved:** Polling adapter implemented in Phase 1 (CP-T014). Native emitter injection is Phase 2 (CP-T025).
2. ~~There is no local browser control plane route yet.~~ **Resolved:** Control plane shell implemented and running.
3. ~~Existing inspection tools are split across CLI, SQL, and filesystem views.~~ **Resolved:** Memory Explorer, Staff Stream, Instance Manager, and Health views delivered.
4. ~~Project binding and integration metadata are not yet unified into one queryable surface.~~ **Resolved:** Instance and Project Manager delivered.
5. ~~Chat exists, but not as an embedded operator workspace.~~ **Deferred to Phase 2 (CP-T020):** Panel slot reserved in shell.
6. ~~Provider credit and quota APIs are inconsistent across vendors and may need a best-effort capability matrix instead of a universal contract.~~ **Resolved:** Best-effort capability matrix approach confirmed (PM Decision 4). Providers without balance APIs show Informational status.
7. ~~Iranti installation is still too infrastructure-heavy for many users and likely needs a more productized installer path.~~ **Resolved in concept:** CLI wizard approach confirmed for Phase 2 (CP-T023, PM Decision 7).

## Risks

### Risk 1. Accidental shadow admin plane
If this surface starts writing directly to internals, it will undermine the Librarian and Archivist invariants.

Mitigation:
- make read paths first
- route writes through existing public operations only

> **Phase 1 status:** Confirmed clean. All Phase 1 surfaces are read-only. Phase 2 repair actions (CP-T033) are routed through structured API endpoints, never direct DB writes.

### Risk 2. Log volume and event noise
A live Staff stream can become unreadable if every internal step is emitted naively.

Mitigation:
- define structured event levels and filtering from the start
- separate audit events from debug events

> **Phase 1 status:** Managed. Polling adapter limits event frequency. Event levels defined in CP-T001 spec. Filtering by component and level implemented in the stream UI.

### Risk 3. Scope explosion
This can turn into "build all of Postgres admin, chat, logs, project config, and IDE integrations" if not phased.

Mitigation:
- ship narrow phases
- v1 focuses on observability and management, not broad workflow orchestration

> **Phase 1 status:** Held. Phase 1 delivered only the planned observability and management surfaces. Phase 2 and Phase 3 scope boundaries are maintained.

### Risk 4. Installer complexity
Trying to solve every environment and dependency edge case in a first installer can create a brittle setup experience.

Mitigation:
- target the most common local-first paths first
- make machine detection and remediation explicit
- keep a CLI fallback for advanced users

> **Phase 2 scope:** CP-T023 explicitly scopes to macOS full support, Windows reduced depth, Linux out of scope with clear messaging.

## Release Phasing

### Phase 0: Foundation
> **Status: COMPLETE (2026-03-20)**

Deliverables completed:
- Staff event model spec (CP-T001) — `docs/specs/staff-event-model.md`
- Control Plane Read API spec (CP-T002) — `docs/specs/control-plane-api.md`
- Instance and Project Metadata Aggregation spec (CP-T003) — `docs/specs/instance-metadata-aggregation.md`
- Local Web Shell Design Exploration (CP-T004) — `docs/specs/shell-design-exploration.md` — visual direction Option B "Terminals" approved
- Installer/Onboarding Concept Evaluation (CP-T005) — `docs/specs/installer-concept.md`
- Entity Aliases spike (CP-T006) — `docs/specs/entity-aliases-spike.md` — deferred to Phase 2

All Phase 0 specs PM-approved. Phase 1 unblocked.

### Phase 1: Operability MVP
> **Status: IN PROGRESS — substantially complete (2026-03-20)**
> **Target completion:** 2026-03-20 (pending P0 blocker tickets)

Delivered (10 core tickets):
- CP-T010: Knowledge Base, Archive, Entity Detail, and Relationships API endpoints
- CP-T011: Instance health and metadata API endpoints
- CP-T012: Staff event stream API (polling adapter)
- CP-T013: Memory Explorer and Archive Explorer frontend
- CP-T014: Staff Activity Stream frontend
- CP-T015: Health and Diagnostics frontend
- CP-T016: Instance and Project Manager frontend
- CP-T017: Visual System and Shell Chrome (Terminals palette, light/dark mode)
- CP-T018: Phase 1 API test plan execution (QA)
- CP-T019: Phase 1 UI acceptance test execution (QA)

Open P0 blocker tickets (must close before v0.1.0):
- CP-T026: Label Staff Activity Stream with Phase 1 coverage scope (frontend)
- CP-T027: Design explicit empty states for Memory Explorer, Archive Explorer, and Staff Activity Stream (frontend)
- CP-T028: Implement Health Dashboard severity taxonomy — Critical / Warning / Informational / Healthy (frontend)
- CP-T029: Instance health status must show last-checked timestamp and distinguish Unreachable from Unknown (frontend)
- CP-T030: Verify temporal history endpoint returns archive intervals; QA seed test for v0.1.0 (backend + QA)

Open P1 ticket:
- CP-T031: QA — Verify instance context persists correctly across all Phase 1 views (QA + frontend)

Success metric:
- a user can inspect memory, history, and Staff behavior without using SQL

### Phase 2: Interactive Management
> **Status: PLANNED — tickets written, not yet started**
> **Prerequisite:** Phase 1 P0 blockers resolved and v0.1.0 accepted by PM

Tickets written (CP-T020–T025, CP-T032, CP-T033):
- CP-T020: Embedded Chat Panel (CP-E007)
- CP-T021: Conflict and Escalation Review UI (CP-E008)
- CP-T022: Provider and Model Manager (CP-E009)
- CP-T023: CLI Setup Wizard — `iranti setup` (CP-E010)
- CP-T024: Command Palette — Cmd+K (CP-E002 enhancement)
- CP-T025: Native Staff Emitter Injection (CP-E003 enhancement)
- CP-T032: Entity Relationship Graph View (CP-E002 enhancement)
- CP-T033: Integration Repair Actions UI (CP-E004 enhancement)

Success metric:
- a user can inspect and manage the system from one surface for the most common tasks

### Phase 3: Advanced Operator Features
> **Status: FUTURE — scope to be refined after Phase 2 retrospective**

Planned themes:
- saved filters and workspaces
- richer graph exploration
- multi-instance comparison
- export/import support for selected views
- optional remote/team mode

Success metric:
- TBD after Phase 2 retrospective

## Decisions Log

> Added 2026-03-20. Captures the 10 PM decisions made during the Phase 0 → Phase 1 transition, plus additional decisions made during Phase 1.

### Decision 1: Entity Aliases Deferred to Phase 2
**Date:** Phase 0 exit
**Decision:** Entity aliases spike (CP-T006) revealed that the `entity_aliases` table exists in the schema but is not yet used by the current Iranti Staff components. Exposing an aliases endpoint in Phase 1 would surface empty or stale data. Deferred to Phase 2 when aliases have meaningful content.
**Impact:** Phase 1 Memory Explorer does not expose entity aliases. The `/api/control-plane/aliases` endpoint is not implemented in Phase 1.

### Decision 2: Visual Direction — Option B "Terminals"
**Date:** Phase 0 exit
**Decision:** Shell design exploration (CP-T004) produced two viable visual directions. PM selected Option B "Terminals": near-black canvas (`#0a0a0a` dark / `#fafaf9` light), emerald accent (`#10b981`), monospace accent typography, subtle grid/dot background texture. Option A (muted slate) was not selected.
**Rationale:** Option B is distinctive and avoids the generic admin dashboard aesthetic the PRD explicitly prohibits. It aligns with the "Terminals" metaphor of operator-level visibility.
**Impact:** All Phase 1 and Phase 2 UI must use the Terminals token system. See `docs/specs/visual-tokens.md`.

### Decision 3: Staff Event Model — Polling Adapter for Phase 1, No Upstream Changes Required
**Date:** Phase 0 exit
**Decision:** Phase 1 Staff Activity Stream uses a database polling adapter (2-second interval on `knowledge_base` and `archive` tables) rather than a native emitter injected into Staff components. This avoids requiring upstream changes to the Iranti core package for Phase 1.
**Rationale:** Upstream changes to inject `IStaffEventEmitter` into the four Staff components are architecturally correct but require coordination with the Iranti maintainer. Phase 1 polling is sufficient for Librarian and Archivist event coverage. Attendant and Resolutionist coverage is explicitly labeled as Phase 2 scope.
**Impact:** Phase 1 stream covers Librarian and Archivist events only. UI labels this explicitly. Native emitter injection is Phase 2 (CP-T025).

### Decision 4: Provider Balance/Quota — Best-Effort Capability Matrix
**Date:** Phase 0 exit
**Decision:** Providers that do not expose balance or quota via a stable public API (including Anthropic) show an Informational health status ("Balance visibility not supported by this provider. This is expected.") — not a Warning or error. A capability matrix is maintained per provider indicating which balance/quota signals are available.
**Rationale:** Anthropic does not expose remaining credits via a stable public API. Treating this as a Warning would create a false alarm for every Anthropic user. Informational is the correct severity for an expected architectural limitation of the provider.
**Impact:** Health dashboard taxonomy (CP-T028) must classify provider balance unavailability as Informational for providers that don't support it. Full provider credit display is Phase 2+ (CP-T022), pending capability matrix.

### Decision 5: Instance Registry — Filesystem Fallback Scan in Phase 1
**Date:** Phase 0 exit
**Decision:** Phase 1 instance discovery uses a filesystem scan to locate instance directories (scanning `~/.iranti/instances/` and looking for `.env.iranti` files) rather than requiring a pre-existing `instances.json` registry file. If no instances are found via scan, the control plane falls back to the currently-running instance context.
**Rationale:** Requiring a formal `instances.json` registry as a Phase 1 prerequisite would block users whose Iranti installations predate the registry format. Filesystem scan is resilient to older installations.
**Impact:** Phase 2 setup wizard (CP-T023) writes `instances.json` on setup completion, formalizing the registry going forward. Phase 1 continues to support scan-based discovery.

### Decision 6: Embedded Chat — Deferred to Phase 2
**Date:** Phase 0 exit
**Decision:** Embedded Iranti Chat is deferred from Phase 1 to Phase 2 (CP-T020). The Phase 1 shell reserves the right-side panel slot for the chat panel. The chat panel is not functional in Phase 1.
**Rationale:** The Iranti Chat integration path (programmatic API vs subprocess wrapping) requires investigation that Phase 1 timeline does not accommodate. The panel slot reservation keeps Phase 2 implementation clean.
**Impact:** FR6 (Embedded Chat) is not met in Phase 1. Phase 2 CP-T020 is the delivery vehicle.

### Decision 7: Installer — CLI Wizard Approach for Phase 2
**Date:** Phase 0 exit
**Decision:** The Phase 2 installation surface is a CLI wizard (`iranti setup`) using `clack` interactive prompts, not a dedicated GUI installer or a Homebrew formula. macOS full support, Windows reduced depth, Linux documentation only.
**Rationale:** CP-T005 installer concept evaluation concluded that a CLI wizard is the fastest path to eliminating the top-three setup failure points without the signing, distribution, and maintenance burden of a native installer.
**Impact:** CP-T023 implements this. Phase 3 may revisit a native installer or Homebrew formula.

### Decision 8: Project Management — Inspect Only in Phase 1
**Date:** Phase 0 exit
**Decision:** Phase 1 Instance and Project Manager is read-only. Project creation, rebinding, and integration file mutation are Phase 2 scope (CP-T033).
**Rationale:** Write operations against project files (`.mcp.json`, `CLAUDE.md`) require careful confirmation flows, audit logging, and error handling that are not feasible within Phase 1 scope. Read-only inspection is safe and delivers the primary user value of understanding project state.
**Impact:** FR5 (Project Binding Management) is partially met in Phase 1 (inspect only). CP-T033 delivers repair actions in Phase 2.

### Decision 9: Loading Animation — css-loaders.com Selection
**Date:** Phase 1
**Decision:** The control plane loading animation is selected from css-loaders.com and must be consistent with the Terminals visual palette (emerald or near-white spinner on near-black background).
**Rationale:** Custom animation adds build complexity for minimal differentiation. css-loaders.com provides polished, accessible CSS-only animations that integrate cleanly with the token system.

### Decision 10: CI Monitoring — DevOps Engineer Owns
**Date:** Phase 1
**Decision:** CI pipeline monitoring and maintenance is owned by the devops_engineer. The PM does not intervene in CI pipeline failures unless they are blocking a release.
**Rationale:** Clear ownership prevents CI debt from accumulating without accountability.

---

## Open Questions
> **Status as of 2026-03-20 — all 7 original open questions resolved.**

### OQ-1: Staff event coverage strategy
**Original question:** How much of the event stream should persist vs remain ephemeral?
**Resolution (2026-03-20):** Phase 1 stream is in-memory ring buffer (max 2,000 events) plus database polling. Persistence to a dedicated DB table confirmed as the Phase 2 strategy (when native emitter ships). Phase 3 may add longer-term event persistence for analytics.

### OQ-2: Entity aliases — when and how to expose them
**Original question:** Should entity aliases be exposed in Phase 1?
**Resolution (2026-03-20):** Deferred to Phase 2 (PM Decision 2). See Decisions Log above.

### OQ-3: Event persistence strategy
**Original question:** How much of the event stream should persist vs remain ephemeral?
**Resolution (2026-03-20):** In-memory ring buffer in Phase 1. DB table persistence planned for Phase 2 when native emitter injection ships (CP-T025). No ephemeral-only approach — operators need to review events after the fact.

### OQ-4: Embedded chat integration path
**Original question:** Should embedded chat reuse the existing `iranti chat` process or call the same underlying primitives through a new web session layer?
**Resolution (2026-03-20):** Deferred to Phase 2 (PM Decision 6, CP-T020). Backend_developer must investigate Option A (programmatic SDK/API call) vs Option B (subprocess wrapping) at task start. Option A is preferred.

### OQ-5: Project management — create vs inspect only
**Original question:** Should project management include creating `.env.iranti`, `.mcp.json`, and Claude settings from the UI, or only inspecting and repairing them?
**Resolution (2026-03-20):** Phase 1 is inspect only (PM Decision 8). Phase 2 adds targeted repair actions for `.mcp.json` and `CLAUDE.md` integration blocks (CP-T033). Full creation from UI is Phase 3 scope if validated by user feedback.

### OQ-6: Provider credits — which providers expose stable balance APIs
**Original question:** Which providers can reliably expose credits, spend, or remaining quota through stable APIs, and what should the fallback UX be when that data is unavailable?
**Resolution (2026-03-20):** Best-effort capability matrix approach (PM Decision 4). Anthropic does not expose balance via stable public API — classified as Informational, not Warning. OpenAI exposes some usage data. Ollama is local — no balance concept. Full capability matrix to be maintained as part of CP-T022 provider manager implementation.

### OQ-7: Installer path — dedicated installer vs CLI wizard vs control-plane-first
**Original question:** Should the simplest install path be a dedicated installer, a richer guided setup app, or a control-plane-first bootstrap flow?
**Resolution (2026-03-20):** CLI wizard approach confirmed for Phase 2 (PM Decision 7, CP-T023). Native installer (`.pkg`, Homebrew formula) is Phase 3 scope.

---

## MVP Backlog

### Must Have
- read-only KB table browser ✓ Phase 1
- archive browser ✓ Phase 1
- fact history viewer ✓ Phase 1
- related-entity inspector ✓ Phase 1
- Staff event stream ✓ Phase 1 (Librarian + Archivist coverage, Phase 2 for full coverage)
- health/doctor summary ✓ Phase 1
- instance list and active context selector ✓ Phase 1
- project binding view ✓ Phase 1
- provider default and model override management — Phase 2 (CP-T022)
- a deliberately designed light/dark visual system ✓ Phase 1 (Terminals palette)

### Should Have
- embedded chat panel — Phase 2 (CP-T020)
- pending escalation list — Phase 2 (CP-T021)
- direct launch of Resolutionist flow — Phase 2 (CP-T021)
- integration status for Claude/Codex ✓ Phase 1 (read-only)
- latest-version / upgrade status ✓ Phase 1 (Health view)
- provider credit / quota visibility where supported — Phase 2 (CP-T022, best-effort matrix)
- guided install/setup path or installer concept — Phase 2 (CP-T023)

### Nice to Have
- relationship graph visualization — Phase 2 (CP-T032)
- live tail mode per entity — Phase 3
- event replay for a selected fact — Phase 3
- export selected facts as JSON or markdown — Phase 3

---

## Success Metrics

- 80% of local debugging tasks completed without SQL or Adminer
- reduced time to inspect a fact and its history from minutes to seconds
- reduced time to diagnose broken integration/setup from minutes to seconds
- increased successful first-run onboarding completion
- fewer support interactions caused by "where is my data" and "is the Attendant/Librarian doing anything" questions
- improved successful local installation completion for new users

## Suggested Follow-On Deliverables

1. ADR for local web control plane vs TUI-first path — ✓ resolved (local web app)
2. event model spec for Staff activity streaming — ✓ `docs/specs/staff-event-model.md`
3. control-plane API spec — ✓ `docs/specs/control-plane-api.md`
4. UI wireframe set for Memory Explorer, Staff Stream, and Instance Manager — ✓ `docs/specs/shell-design-exploration.md`
5. phased implementation backlog — ✓ `docs/backlog.md`
6. provider telemetry capability matrix for balances, credits, and quota — Phase 2 (CP-T022 dependency)
7. installer/onboarding concept memo with recommended path — ✓ `docs/specs/installer-concept.md`

## Related

- [README gap analysis](../../README.md)
- [CLI doctor spec](../features/cli-doctor/spec.md)
- [CLI setup wizard spec](../features/cli-setup-wizard/spec.md)
- [Resolutionist spec](../features/resolutionist/spec.md)
- [Chat spec](../features/chat/spec.md)
- [Architecture guide](../guides/architecture.md)
- [Visual tokens](../specs/visual-tokens.md)
- [Competitor analysis](../research/competitor-analysis.md)
- [Operator dashboard best practices](../research/operator-dashboard-best-practices.md)
