# Iranti Control Plane PRD

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

## 6. Embedded Iranti Chat
Expose `iranti chat` from within the control plane.

Requirements:
- choose agent id, provider, and model
- preserve conversation history for the session
- expose slash commands in an operator-friendly command palette or side panel
- show retrieved memory blocks and write results explicitly
- allow jumping from chat output to inspected facts in Memory Explorer

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

## Functional Requirements

### FR1. Read-Only Database Browsing
The control plane must let the user inspect current KB, archive, relationships, entities, and aliases without direct SQL.

### FR2. Temporal Fact History
The control plane must display full temporal history for a fact, including validFrom, validUntil, archivedReason, supersededBy, and current status.

### FR3. Live Staff Logs
The control plane must expose a live or near-live Staff activity stream with filterable structured events.

### FR4. Instance Awareness
The control plane must show which runtime root, instance, and database are active, and let the user switch context safely.

### FR5. Project Binding Management
The control plane must show which projects are bound to which instances and whether those projects have Claude/Codex integration files configured.

### FR6. Embedded Chat
The control plane must provide a usable chat experience backed by the existing Iranti Chat capabilities.

### FR7. Provider and Model Configuration
The control plane must let the user inspect and change default providers, task-type model overrides, and provider credential status through supported configuration pathways rather than raw env editing.

### FR8. Provider Credit Visibility
Where upstream providers expose balance, credits, or quota information through an API, the control plane should display that status clearly with timestamps and degraded-state warnings.

### FR9. Installation and Setup Experience
The control plane should provide or launch a dramatically simpler installation and onboarding flow, potentially including a dedicated installer or guided bootstrap experience for local development use cases.

### FR10. Conflict Review
The control plane must expose pending escalations and resolution state without requiring direct file editing.

### FR11. Safe Mutations
Any write-capable actions must go through existing API/CLI/Librarian pathways. The control plane must not write directly to DB tables.

### FR12. Auditability
All destructive or state-changing operations initiated from the control plane must be attributable to a user action, timestamp, and underlying system call.

### FR13. Local-First Operation
The first version should run entirely on a local machine against a local Iranti instance. Hosted remote multi-user operation is out of scope for v1.

## Experience Requirements

### ER1. Fast Time to Clarity
A user should be able to answer "what does Iranti currently believe about this entity?" in under 30 seconds from opening the control plane.

### ER2. Fast Time to Root Cause
A user should be able to answer "why did that write conflict, disappear, or fail?" without dropping into SQL or log files.

### ER3. Minimal Context Switching
A user should not need to jump between terminal, Adminer, `.env.iranti`, `.mcp.json`, and escalation markdown for common operational tasks.

### ER4. Delightful Visual Identity
The control plane should not look like a generic admin dashboard. It should use distinctive, beautiful, intentional visual systems for both light and dark mode while preserving operational clarity.

### ER5. Low-Friction Setup
A new user should be able to get Iranti installed and into a working state with guided help instead of assembling infrastructure from scattered commands and docs.

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

## Major Gaps to Close Before Build

1. There is no first-class structured Staff event bus yet.
2. There is no local browser control plane route yet.
3. Existing inspection tools are split across CLI, SQL, and filesystem views.
4. Project binding and integration metadata are not yet unified into one queryable surface.
5. Chat exists, but not as an embedded operator workspace.
6. Provider credit and quota APIs are inconsistent across vendors and may need a best-effort capability matrix instead of a universal contract.
7. Iranti installation is still too infrastructure-heavy for many users and likely needs a more productized installer path.

## Risks

### Risk 1. Accidental shadow admin plane
If this surface starts writing directly to internals, it will undermine the Librarian and Archivist invariants.

Mitigation:
- make read paths first
- route writes through existing public operations only

### Risk 2. Log volume and event noise
A live Staff stream can become unreadable if every internal step is emitted naively.

Mitigation:
- define structured event levels and filtering from the start
- separate audit events from debug events

### Risk 3. Scope explosion
This can turn into "build all of Postgres admin, chat, logs, project config, and IDE integrations" if not phased.

Mitigation:
- ship narrow phases
- v1 focuses on observability and management, not broad workflow orchestration

### Risk 4. Installer complexity
Trying to solve every environment and dependency edge case in a first installer can create a brittle setup experience.

Mitigation:
- target the most common local-first paths first
- make machine detection and remediation explicit
- keep a CLI fallback for advanced users

## Release Phasing

### Phase 0: Foundation
- structured Staff event model
- read-only control-plane API surface
- instance/project metadata aggregation
- design exploration for local web shell
- installer/onboarding concept evaluation

### Phase 1: Operability MVP
- Memory Explorer
- Archive Explorer
- entity detail page
- temporal history view
- Staff activity stream
- diagnostics summary
- instance/project manager
- visual system for light and dark mode

Success metric:
- a user can inspect memory, history, and Staff behavior without using SQL

### Phase 2: Interactive Management
- embedded chat
- escalation review UI on top of Resolutionist flow
- integration status and repair actions
- guided project binding repair
- provider and model configuration surface
- installer or guided onboarding MVP

Success metric:
- a user can inspect and manage the system from one surface for the most common tasks

### Phase 3: Advanced Operator Features
- saved filters and workspaces
- richer graph exploration
- multi-instance comparison
- export/import support for selected views
- optional remote/team mode

## MVP Backlog

### Must Have
- read-only KB table browser
- archive browser
- fact history viewer
- related-entity inspector
- Staff event stream
- health/doctor summary
- instance list and active context selector
- project binding view
- provider default and model override management
- a deliberately designed light/dark visual system

### Should Have
- embedded chat panel
- pending escalation list
- direct launch of Resolutionist flow
- integration status for Claude/Codex
- latest-version / upgrade status
- provider credit / quota visibility where supported
- guided install/setup path or installer concept

### Nice to Have
- relationship graph visualization
- live tail mode per entity
- event replay for a selected fact
- export selected facts as JSON or markdown

## Open Questions

1. Should v1 be entirely local-only, or should the architecture leave room for hosted remote access immediately?
2. Should the first delivery vehicle be a browser UI, TUI, or both?
3. How much of the event stream should persist vs remain ephemeral?
4. Should embedded chat reuse the existing `iranti chat` process or call the same underlying primitives through a new web session layer?
5. Should project management include creating `.env.iranti`, `.mcp.json`, and Claude settings from the UI, or only inspecting and repairing them?
6. Which providers can reliably expose credits, spend, or remaining quota through stable APIs, and what should the fallback UX be when that data is unavailable?
7. Should the simplest install path be a dedicated installer, a richer guided setup app, or a control-plane-first bootstrap flow?

## Success Metrics

- 80% of local debugging tasks completed without SQL or Adminer
- reduced time to inspect a fact and its history from minutes to seconds
- reduced time to diagnose broken integration/setup from minutes to seconds
- increased successful first-run onboarding completion
- fewer support interactions caused by "where is my data" and "is the Attendant/Librarian doing anything" questions
- improved successful local installation completion for new users

## Suggested Follow-On Deliverables

1. ADR for local web control plane vs TUI-first path
2. event model spec for Staff activity streaming
3. control-plane API spec
4. UI wireframe set for Memory Explorer, Staff Stream, and Instance Manager
5. phased implementation backlog
6. provider telemetry capability matrix for balances, credits, and quota
7. installer/onboarding concept memo with recommended path

## Related

- [README gap analysis](../../README.md)
- [CLI doctor spec](../features/cli-doctor/spec.md)
- [CLI setup wizard spec](../features/cli-setup-wizard/spec.md)
- [Resolutionist spec](../features/resolutionist/spec.md)
- [Chat spec](../features/chat/spec.md)
