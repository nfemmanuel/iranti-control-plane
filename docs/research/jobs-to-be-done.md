# Iranti Control Plane — Jobs-to-be-Done Analysis

**Author:** user_researcher
**Date:** 2026-03-20
**Phase:** Phase 1 research
**Source:** PRD `docs/prd/control-plane.md`, operator persona synthesis

---

## Overview

This document applies the Jobs-to-be-Done framework to the eight primary user jobs identified in the Iranti Control Plane PRD. Each job is analyzed for its current solution (without the control plane), the specific pains that solution creates, how the user would define success, what Phase 1 addresses, and what remains unsolved after Phase 1 ships.

The goal is to ensure Phase 1 delivers real job completion — not just feature presence — and to surface the highest-signal gaps for Phase 2 planning.

---

## Job 1: Inspect Current Memory

**Job statement**
When I need to understand what Iranti currently believes about an entity or project, I want to query that entity's live facts with full metadata — value, source, confidence, validFrom, and related keys — so I can verify that memory is accurate and complete before trusting it in an agentic workflow.

**Current solution**
Direct SQL queries against `knowledge_base` in Adminer or `psql`. Alternatively, calling `iranti query` from the CLI and reading raw JSON output in the terminal.

**Pain of current solution**
- Requires knowing the exact table structure and column names (`valueRaw`, `confidence`, `validFrom`, `createdBy`, etc.)
- Adminer returns raw rows with no context about what the fact means or where it came from
- No way to quickly navigate from one fact to related facts without writing JOIN queries
- `psql` output is truncated for long JSON values; Adminer truncates similarly by default
- No confidence-tier labeling — user must interpret a raw float
- No summary vs raw toggle — everything is raw JSON by default
- Switching between entities requires rewriting the WHERE clause manually

**Success criteria**
- User can type an entity name or keyword and see all matching live facts within 10 seconds
- Each fact row shows: entity, key, summary or value, confidence tier label, source, createdBy, validFrom, archivedReason (if any)
- User can click a fact and see its full raw JSON without leaving the page
- User understands what "confidence 82" means without consulting docs

**Phase 1 coverage**
Memory Explorer covers this job directly: the current facts table for `knowledge_base`, entity search and filter, entity detail page, and raw JSON inspector are all included in Phase 1. Coverage is approximately 80% complete for this job.

**Gap**
Phase 1 does not include entity aliases, so a user who knows an entity by an alternate name may not find it. Relationship navigation (jumping from a fact to related entities) is present but may be incomplete for complex relationship graphs. No write capability means a user who finds a stale or incorrect fact cannot act on it — they must still drop to CLI to correct it.

---

## Job 2: Inspect Temporal History

**Job statement**
When a fact changes unexpectedly or I want to understand how Iranti's understanding of an entity evolved over time, I want to see the full chronological history of that entity/key pair — including superseded intervals, archive reasons, and what replaced what — so I can diagnose whether the change was correct, accidental, or caused by a conflict.

**Current solution**
SQL queries across `knowledge_base` and `archive` tables, joining on `entity` and `key`, manually sorting by `validFrom` and `validUntil`. Requires understanding the archive schema and the difference between `superseded`, `contradicted`, `expired`, and `decayed` archive reasons.

**Pain of current solution**
- Two separate tables with different schemas must be mentally unified by the user
- No timeline visualization — user must interpret raw timestamps as a sequence
- `supersededBy` is a UUID reference with no human-readable label — requires a second query to resolve
- `conflictLog` is a raw JSON blob — reading it requires understanding the Librarian conflict format
- Archive reasons are stored as codes, not explanations
- No way to see "what was the value at time T" without a complex WHERE clause with timestamp arithmetic

**Success criteria**
- User can navigate from any fact in Memory Explorer to a full chronological timeline for that entity/key pair in one click
- Timeline shows all intervals in order: current → archived in reverse-chronological order
- Each interval shows: value (summary), validFrom, validUntil, archivedReason (human-readable label), and what superseded it (entity link if applicable)
- User can expand any interval to see raw JSON
- User can answer "was this value ever X?" by scanning the timeline without writing SQL

**Phase 1 coverage**
The temporal history timeline per `entity/key` is explicitly in Phase 1 scope. Archive table browsing is also included. Coverage is approximately 75% complete — the timeline view is planned but its depth of conflict annotation and supersededBy resolution depends on backend implementation detail.

**Gap**
Phase 1 does not include event replay (nice-to-have). The conflictLog raw JSON viewer is present but may not render conflict reasons in a user-readable format without additional interpretation logic. No diff view between adjacent intervals — users still need to read two raw values side by side.

---

## Job 3: Watch Staff Activity

**Job statement**
When I want to understand what Iranti is doing right now or diagnose why a memory write happened (or didn't happen), I want to see a live, structured stream of Staff actions — Librarian writes, Attendant handshakes, Archivist decisions, and Resolutionist escalation handling — so I can trace causality without parsing log files.

**Current solution**
Reading console log output from the Iranti runtime process (stdout/stderr). Searching log files in the filesystem. No structured log format is consistently applied across all Staff components; some events are readable, others are internal debug messages. No unified view exists — users watch different process terminals depending on which Staff component they care about.

**Pain of current solution**
- Log output is noisy — internal debug steps mixed with meaningful operational events
- Log files are spread across the filesystem with no unified location
- Timestamps are not always in a consistent timezone or format
- No filtering: seeing only Archivist decisions requires grep and pattern knowledge
- Events reference UUIDs and internal keys that require a second lookup to contextualize
- No persistence: if the user wasn't watching when an event happened, it's gone (or buried)
- Multi-instance setups produce log output from multiple processes with no correlation

**Success criteria**
- User can open the Staff Activity Stream and see structured events appear within 3 seconds of a real Librarian write
- Each event shows: Staff component (labeled, not abbreviated), action type, entity, key, agent id, source, timestamp, and a human-readable reason
- User can filter by Staff component, action type, and entity
- Events persist for the session — user can scroll back to see what happened 5 minutes ago
- User can click an event and jump to the affected fact in Memory Explorer

**Phase 1 coverage**
Staff Activity Stream is in Phase 1 scope. However, the PRD notes a major gap: there is no first-class structured Staff event bus yet. Phase 1 coverage depends on Phase 0 delivering the event model. The stream will initially show Librarian write events reliably, but Attendant, Archivist, and Resolutionist events depend on adapter completeness at the time of Phase 1 delivery. Coverage is estimated at 40-60% complete for full Staff observability.

**Gap**
Phase 1 will likely show Librarian and possibly Archivist events but not Attendant or Resolutionist events without additional adapter work. No event replay in Phase 1. Filtering may be limited to component-level — key-level filtering may not be implemented. Click-through from event to affected fact may not be wired in Phase 1.

---

## Job 4: Manage Instances and Projects

**Job statement**
When I'm running multiple Iranti instances or binding a project to a specific instance, I want to see all instances, their runtime roots, database targets, ports, and project bindings from one surface — so I can understand my configuration without reading env files or grepping the filesystem.

**Current solution**
Reading `.env.iranti` files per instance directory, using CLI commands to inspect instance state, and manually cross-referencing project directories with database connection strings. No unified view. Checking whether a project is correctly bound requires reading both the project directory's `.env.iranti` and the runtime's active config.

**Pain of current solution**
- Instance state is spread across multiple `.env.iranti` files with no aggregation
- No health check runs automatically — user must invoke `iranti doctor` manually per instance
- Port conflicts between instances have no detection surface
- "Is Claude integration set up for this project?" requires reading `.mcp.json` and Claude settings files by hand
- Rebinding a project to a different instance has no guided flow — requires editing env files
- No clear indication of which instance is "active" in the context of a given terminal session

**Success criteria**
- User can see all detected local instances in a list with: runtime root path, database connection target, configured port, active/inactive status
- Each instance shows which projects are bound to it
- Each project binding shows: path, Claude integration status (present/missing/broken), `.env.iranti` key completeness
- User can run `iranti doctor` for a specific instance from the UI and see results without opening a terminal
- "Active instance" is clearly indicated

**Phase 1 coverage**
Instance and Project Manager is in Phase 1 scope. It shows instance list, runtime roots, database targets, ports, project bindings, and `.env.iranti` status. Doctor integration is planned. Coverage is approximately 70% complete for the core visibility job.

**Gap**
Phase 1 does not support creating a new instance, rebinding a project, or running setup/upgrade actions from the UI — those are Phase 2. Claude/Codex integration status may be read-only with no repair actions in Phase 1. Multi-instance switching context is listed as a Phase 1 goal but may not include safe teardown/handoff behavior.

---

## Job 5: Configure Models and Providers

**Job statement**
When I want to change which LLM provider or model Iranti uses for a specific task type, or when I want to verify that my provider credentials are valid without exposing secrets, I want a UI that shows current routing configuration and lets me change it — so I don't have to hand-edit env files and restart the runtime to test a configuration change.

**Current solution**
Editing `.env.iranti` directly with a text editor. Setting `IRANTI_DEFAULT_PROVIDER`, `IRANTI_MODEL_*` variables by hand. Verifying credentials by running a test operation and reading error output. No unified view of which model is used for which task type.

**Pain of current solution**
- Env file editing is error-prone — typos in variable names silently fail
- No way to see the effective routing configuration (env overrides vs defaults vs task-specific overrides) in one place
- Credential validity can only be confirmed by running an actual operation
- No credit or quota visibility — user doesn't know they're out of credits until a failure occurs
- Changing the default provider requires restart — no hot-reload path is documented
- Multiple env files across instances means changes must be replicated manually

**Success criteria**
- User can see: current default provider, all task-type model overrides, which provider keys are configured (presence only, not exposed values)
- User can see provider reachability status with a last-checked timestamp
- User can see remaining credits or quota where the provider exposes this via API
- User can change the default provider and a task-type model override from the UI
- Changes go through the existing config pathway — no direct env file mutation from the UI

**Phase 1 coverage**
Provider and Model Manager is listed in the Phase 1 scope indirectly (it's in the MVP Must Have backlog) but the PRD's Phase 1 section does not explicitly call it out as a Phase 1 deliverable — it's noted as Phase 2 "Interactive Management." The health dashboard in Phase 1 will show provider credential status and default routing status, covering approximately 30% of this job.

**Gap**
Full provider and model configuration management is a Phase 2 deliverable. Phase 1 gives visibility into whether a key is present and whether the default provider is reachable — it does not support changing configuration from the UI. Credit and quota visibility is also Phase 2.

---

## Job 6: Resolve Issues Without SQL

**Job statement**
When something goes wrong — a write conflict, a missing project binding, a provider failure, or an integration misconfiguration — I want to diagnose and resolve the issue from the control plane without opening psql, Adminer, or the filesystem, so I can spend time building instead of spelunking.

**Current solution**
`iranti doctor` CLI command for health checks, direct Adminer inspection for data issues, reading escalation markdown files from the filesystem for conflict review, and reading raw error logs. Each issue type requires a different tool and mental context switch.

**Pain of current solution**
- Each failure mode requires a different debugging tool — there is no unified triage surface
- `iranti doctor` output is text-only with no remediation guidance beyond what the text suggests
- Escalation files are markdown in a filesystem folder — no UI to review, compare, or act on them
- Conflict resolution requires understanding the Resolutionist flow and editing files by hand
- Provider failures often surface as generic API errors with no actionable guidance
- Integration failures (Claude MCP config) require reading JSON files and understanding the MCP protocol

**Success criteria**
- User can open Health and Diagnostics and see all health checks with clear pass/warn/fail states and plain-English explanations for each failure
- Clicking a failed check offers at least one specific remediation action or link to guidance
- User can see pending escalations and open a conflict comparison view (Phase 2)
- User can see provider failure reason with a specific error message, not just "unreachable"
- User can diagnose "why did the Librarian reject this write?" from the Staff stream without SQL

**Phase 1 coverage**
Health and Diagnostics is a Phase 1 deliverable as the first screen new users see. It consolidates `iranti doctor` output, provider credential status, database reachability, vector backend status, integration status, and runtime version. Coverage for the diagnostic visibility part of this job is approximately 60% in Phase 1. Remediation actions and conflict review are Phase 2.

**Gap**
Phase 1 gives visibility into health state but does not provide interactive remediation. Conflict review UI is Phase 2. Escalation file browsing is Phase 2. A user who identifies a problem in Phase 1 still needs to drop to CLI or filesystem to fix it.

---

## Job 7: Use Chat as an Operator Surface

**Job statement**
When I want to inspect memory, write test facts, or run slash commands against a live Iranti instance, I want to do it from the same management surface — not by switching to a separate terminal session — so I can stay in context and immediately see how chat interactions affect memory state.

**Current solution**
`iranti chat` in a terminal session. Slash commands typed manually. No visual connection between chat output and the Memory Explorer — user must cross-reference mentally or run separate queries.

**Pain of current solution**
- Context switching: terminal for chat, Adminer for verification, terminal for slash commands
- Chat history is ephemeral — cleared when the terminal session ends
- Slash commands have no autocomplete or discovery mechanism (command palette)
- No visual link from a chat response to the retrieved memory blocks that produced it
- No way to click a memory block reference in a chat response and jump to the full fact
- Chat and memory inspection are two separate workflows with no integration

**Success criteria**
- User can open Iranti Chat from within the control plane without leaving the management surface
- Chat response shows retrieved memory blocks with clickable links to Memory Explorer
- Write operations from chat are immediately visible in the Staff Activity Stream
- Session history persists for at least the browser session
- Slash commands are discoverable through a command palette or side panel

**Phase 1 coverage**
Embedded Chat is not in Phase 1. It is a Phase 2 deliverable. Phase 1 provides zero coverage for this job.

**Gap**
This job is entirely deferred to Phase 2. Users will still need to use `iranti chat` in a terminal for Phase 1.

---

## Job 8: Install Iranti Without Infrastructure Guesswork

**Job statement**
When I want to start using Iranti for the first time (or set it up on a new machine), I want a guided installation flow that checks my environment, tells me what's missing, and walks me through setup step by step — so I don't have to read scattered infrastructure docs and assemble the setup myself.

**Current solution**
Reading the Iranti README and docs, running `iranti setup` or similar CLI commands, manually setting up PostgreSQL (or selecting an alternative), creating `.env.iranti` by hand from a template, configuring provider keys, creating a first instance, and binding a project — each step separate, with no feedback about whether the overall setup is working until all steps are complete.

**Pain of current solution**
- No single entry point — setup is assembled from multiple docs pages and CLI commands
- Failure at any step produces a generic error with no guided recovery path
- PostgreSQL setup is a significant barrier for users without database administration experience
- No feedback about "is this working?" until the full stack is running
- Provider key setup has no validation — a mis-entered key only fails on first use
- No concept of setup progress — if the user stops and comes back, they don't know where they left off
- Windows support adds additional complexity that docs don't always cover

**Success criteria**
- User can run a single command or open a single URL and enter a guided setup flow
- Each step is validated before proceeding — user gets explicit pass/fail feedback
- At least one easy database path is presented (local Postgres, managed Postgres, or alternative) with detection of what's already available
- Provider key entry includes immediate validation (ping the API, show success/failure)
- Setup completes with an explicit "Iranti is working" confirmation screen
- If setup fails at any step, the user sees a specific remediation action, not a raw error

**Phase 1 coverage**
Installation and Onboarding is a Phase 2 deliverable (listed as "installer or guided onboarding MVP"). Phase 1 ships the Health and Diagnostics screen, which serves as a post-install verification surface but not a guided setup flow. Phase 1 coverage for this job is approximately 15% — first-run health visibility only.

**Gap**
The guided install experience is Phase 2. The PRD flags this as a known gap: "Iranti installation is still too infrastructure-heavy for many users and likely needs a more productized installer path." Phase 1 users who hit setup problems will still need to rely on CLI commands and docs.

---

## Summary: Job Priority for Phase 1

| Job | Phase 1 Coverage | User Pain Severity | Phase 1 Priority |
|-----|-----------------|-------------------|-----------------|
| 1. Inspect Current Memory | ~80% | High | Core |
| 2. Inspect Temporal History | ~75% | High | Core |
| 3. Watch Staff Activity | ~50% | High | Core (partial) |
| 4. Manage Instances and Projects | ~70% | Medium | Core |
| 6. Resolve Issues Without SQL | ~60% (visibility only) | High | Supporting |
| 5. Configure Models and Providers | ~30% (health only) | Medium | Deferred to P2 |
| 8. Install Without Guesswork | ~15% (health only) | Very High (new users) | Deferred to P2 |
| 7. Use Chat as Operator Surface | 0% | Medium | Deferred to P2 |

**Phase 2 highest-signal jobs (by user pain):**
1. Job 8: Installation — highest drop-off risk, highest new-user friction
2. Job 7: Embedded Chat — enables full operator workflow without context switching
3. Job 5: Provider/Model Configuration — reduces env-file editing friction

---

*This document is a living artifact. Update as Phase 1 implementation reveals gaps between planned and actual job coverage.*
