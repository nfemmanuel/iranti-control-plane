# Phase 3 Candidate Tickets — Iranti Control Plane

**Author:** product_manager
**Date:** 2026-03-20
**Status:** Draft — candidates pending Phase 2 retrospective confirmation

This document lists structured Phase 3 candidate features with problem statements, user value, rough effort, and ordering dependencies. Scope is not committed — all candidates are subject to Phase 2 retrospective learnings and design partner feedback before tickets are cut.

---

## Phase 3 Goal

**Power user and team-scale operator features** for operators running Iranti at higher complexity, frequency, or team scale. Phase 3 builds on Phase 2's foundation of interactive management to add depth, speed, and collaboration.

The primary design question for Phase 3: has v0.2.0 validated the core product with design partners, and if so, what are their top friction points that remain?

---

## Candidate 1: Multi-Instance Data Isolation and Side-by-Side Comparison

**Problem statement:**
The Phase 1 and Phase 2 control plane is bound to a single Iranti backend. Users with multiple instances (Priya has 2, Dev has 3) must open separate browser tabs or run separate server instances to inspect different instances. There is no unified view of "what does each instance know about this entity?" and no way to compare instance states from one surface.

**User value:**
Priya can compare her personal test instance against a team instance without switching tabs. Dev can run `iranti_write` against one instance and immediately see why the result differs from another instance for the same entity. Technical founders evaluating multi-team deployment get a credible answer to "how do you manage multiple instances?" in one view.

**Persona impact:** Priya (high), Dev (medium), Marcus (low — single-instance user)

**PRD mapping:** FR4 (Instance Awareness — extended to multi-instance), Section 4 (Instance and Project Manager desired actions)

**Rough effort:** High — requires `apiFetch` to pass instanceId through all API calls, backend to support per-instance database connections, frontend context switcher to be instance-scoped rather than URL-scoped. The CP-T031 architectural debt (no instanceId in API calls) must be resolved as a prerequisite.

**Dependencies:**
- Phase 2 complete (CP-T022 provider manager, CP-T035 getting started screen must both exist first)
- `apiFetch` instanceId routing must be addressed
- Instance registry (`instances.json`) from CP-T023 must exist and be reliable

**Risks:**
- Multi-instance database connection pool management adds significant backend complexity
- UI context switching across all views creates layout and state management complexity

**Ticket stub:** CP-T040 — Multi-Instance Data Isolation and Side-by-Side Comparison

---

## Candidate 2: Full-Text Search Across Fact Values

**Problem statement:**
Phase 1 and Phase 2 Memory Explorer search is entity/key-scoped: you can search by entityType, entityId, key, source, or createdBy. You cannot search the content of fact values. A user who wants to find "which entities contain the phrase 'active project'" must write a SQL query. This limits the "inspect memory" use case for users with large, dense knowledge bases.

**User value:**
Marcus can search "which facts mention 'my-api-key'" without SQL. Dev can find all facts where valueRaw contains a specific entity reference. Priya can audit what Iranti knows about a specific project path without knowing the entity structure.

**Persona impact:** Dev (high — power search user), Priya (medium), Marcus (low — smaller KB)

**PRD mapping:** FR1 (Read-Only Database Browsing — search capability), Section 2 (Memory Explorer — search by keyword)

**Rough effort:** Medium — requires either: (a) a PostgreSQL full-text search index on `valueRaw` (cast to text), or (b) a pg_trgm-based ILIKE search. The vector backend (pgvector) already exists but is optimized for semantic retrieval, not keyword search. The control plane needs a separate text search pathway.

**Dependencies:**
- CP-T010 KB endpoint must support a `valueSearch` query param
- PostgreSQL GIN index on JSONB `valueRaw` or trigram index — evaluate with system_architect

**Risks:**
- JSONB full-text search can be slow on large tables without proper indexing
- Adding a full-text search index to the `knowledge_base` table requires a migration — must be tested against production-scale data

**Ticket stub:** CP-T041 — Full-Text Search Across Fact Values

---

## Candidate 3: Value Diff View Between Adjacent History Intervals

**Problem statement:**
The Phase 2 temporal history view (CP-T036) shows each history interval with its full valueRaw accessible via expand-to-raw-JSON. But comparing two adjacent intervals requires the user to expand both, copy the JSON, and diff them manually. For complex nested JSON facts, this is the most friction-heavy part of temporal history inspection — and it is the most common debugging task for power users.

**User value:**
Dev can see exactly what changed between version N and version N-1 of a fact without copying JSON to an external diff tool. Priya can audit fact changes to understand why an agent session changed behavior. This directly reduces the most common "drop to terminal" moment in temporal history inspection.

**Persona impact:** Dev (very high — his #1 remaining friction point), Priya (medium)

**PRD mapping:** Section 2 (Memory Explorer — raw JSON inspector)

**Rough effort:** Low-Medium — the data is already present in the temporal history response. The diff is a pure frontend feature: compare `valueRaw` between adjacent intervals using a JSON diff library (e.g., `jsondiffpatch`). No new backend work required.

**Dependencies:**
- CP-T036 (temporal history view) must be shipped and stable
- A JSON diff library must be evaluated and added to the frontend

**Risks:**
- JSON diff rendering for very large values (>100KB) can cause performance issues in the browser
- Diff view layout must fit within the existing temporal history page design without requiring a separate route

**Ticket stub:** CP-T042 — Value Diff View Between Adjacent Temporal History Intervals

---

## Candidate 4: Persistent Cross-Session Embedded Chat History

**Problem statement:**
The Phase 2 embedded chat panel (CP-T020) stores conversation history in-memory only — it clears on page reload. For operators who use the chat panel as a working scratchpad (writing test facts, querying retrieval, running slash commands), losing history on reload is disruptive. There is no way to return to a previous session's context.

**User value:**
Marcus can reload the control plane and continue the chat session he started before lunch. Dev can search through his recent chat interactions to find the test write he ran last week. Priya can share a chat session export with a team member for context.

**Persona impact:** Marcus (medium), Priya (medium), Dev (medium — uses chat as a diagnostic tool)

**PRD mapping:** FR6 (Embedded Chat — preserve conversation history for session — Phase 3 extended to cross-session)

**Rough effort:** Low-Medium — requires: (a) persisting chat history to localStorage with a session key (simplest), or (b) storing sessions in a `control_plane_chat_sessions` table in the database (richer — enables cross-device and search). Start with localStorage for Phase 3 MVP.

**Dependencies:**
- CP-T020 (embedded chat) must be shipped and stable
- A session key scheme for localStorage must be designed (instanceId + date?)

**Risks:**
- localStorage is not encrypted; chat content may include sensitive facts. Should log a warning when writing to localStorage.
- Chat session storage in the database requires a schema addition — must coordinate with backend

**Ticket stub:** CP-T043 — Persistent Cross-Session Embedded Chat History

---

## Candidate 5: Signed macOS Installer / Homebrew Formula

**Problem statement:**
The Phase 2 CLI setup wizard (CP-T023) dramatically simplifies Iranti installation via a guided terminal flow. But it still requires Node.js and the terminal. For users who are not developers — or who are onboarding non-technical team members — a terminal-based installer is still a friction point. A signed macOS `.pkg` installer or Homebrew formula would allow one-click installation without any terminal prerequisite knowledge.

**User value:**
Marcus's non-developer co-founder can install Iranti for local AI tooling without touching the terminal. Priya can hand off a `.pkg` to a team member with no dev background. The product becomes accessible to a wider user base.

**Persona impact:** Marcus (medium — he can use the terminal but would prefer not to), Priya (medium — team onboarding), new personas not yet represented

**PRD mapping:** Section 9 (Installation and Onboarding), ER5 (Low-Friction Setup)

**Rough effort:** High — signed macOS installer requires: Apple Developer account, code signing certificate, notarization process, installer package construction (pkgbuild/productbuild), and a release pipeline update. Homebrew formula is Medium — create a formula, add a tap, add tap to CI. Both options add ongoing maintenance burden.

**Dependencies:**
- CP-T023 (CLI wizard) must be stable — the installer should wrap the wizard, not replace it
- Phase 2 design partner validation of demand — "would a native installer change your decision to recommend Iranti?" must be confirmed before investing in this

**Risks:**
- Apple Developer Program membership has an annual cost
- Code signing and notarization process is complex and fragile; any binary dependency change requires re-signing
- Homebrew formula must be updated on every Iranti release

**Ticket stub:** CP-T044 — Signed macOS Installer / Homebrew Formula

---

## Candidate 6: Entity Aliases — Phase 2 Deferred, Phase 3 Implement

**Problem statement:**
Entity aliases (the ability to define that `agent/marcus_claude` and `agent/claude_code_session_a42f` refer to the same logical entity) were specified in Phase 0 (CP-T006 spike), found feasible, and deferred to Phase 2. They are not in any current Phase 2 ticket. The PRD's Memory Explorer section lists aliases as a required data source. Until aliases are implemented, users who have multiple agent IDs representing the same person or session cannot see a unified view of that entity.

**User value:**
Dev can define that his three agent IDs (work, personal, test) are aliases of the same operator. The Memory Explorer shows facts from all three agent sessions in one entity view. Priya can alias team member agent IDs to canonical identities. Search across aliases works correctly.

**Persona impact:** Dev (high), Priya (medium), Marcus (low — single agent)

**PRD mapping:** Section 2 (Memory Explorer — entity_aliases data source), PM Decision 2 (deferred to Phase 2/3)

**Rough effort:** Medium — the spike (CP-T006) found the approach feasible. Requires: backend endpoint for alias CRUD, frontend alias management in entity detail view, and query layer update to expand aliases on entity lookup. The `entity_aliases` table may or may not exist in current Iranti schema — must verify.

**Dependencies:**
- CP-T036 (entity detail view) must exist for alias management to be surfaced
- `entity_aliases` table existence in Iranti schema must be confirmed by system_architect

**Ticket stub:** CP-T038 — Entity Aliases (Phase 2/3 Implementation)

**Note:** This was expected in Phase 2 per PM Decision 2. Its absence from Phase 2 tickets is a PRD gap flagged in the PM audit. Consider whether this should be a Phase 2 ticket instead.

---

## Candidate 7: Create Instance and Rebind Project from UI

**Problem statement:**
The Phase 1 and Phase 2 Instance Manager is inspection-only for instance creation and project rebinding. The PRD section 4 desired actions explicitly include "create instance" and "rebind project to instance." Currently these require CLI commands. Phase 2 adds repair actions (CP-T033) but not instance creation or project rebinding.

**User value:**
Priya can create a second local instance for a new team member from the control plane without CLI knowledge. Dev can rebind a project directory from one instance to another when restructuring his workspace.

**Persona impact:** Priya (high — multi-instance use case), Dev (medium), Marcus (low — single instance)

**PRD mapping:** Section 4 (Instance and Project Manager desired actions)

**Rough effort:** Medium-High — requires write endpoints for instance creation (creating the runtime root directory structure, instance env file, registering in `instances.json`) and project rebinding (updating the binding registry, verifying the new instance is reachable).

**Dependencies:**
- CP-T023 (CLI wizard) must establish the `instances.json` registry format
- Multi-instance data isolation (Candidate 1) must be complete for creating instances to be meaningful from the control plane

**Ticket stub:** CP-T047 — Create Instance and Rebind Project from UI
*(Originally noted as CP-T039 but that number is reserved for the staff_events migration task — Phase 2.)*

---

## Candidate 8: Optional Remote / Team Mode

**Problem statement:**
Phase 1–2 are strictly local-first: one browser, one machine, one Iranti backend. Teams where multiple members want to inspect the same Iranti knowledge base from different machines have no path. The PRD explicitly declares hosted multi-tenant SaaS out of scope for v1, but notes that team mode may become appropriate in Phase 3 if demand is confirmed.

**User value:**
Priya's team of 3 can all view the same Iranti instance from their own machines. A team lead can monitor Staff activity and review conflicts without being on the same machine as the Iranti server. Read-only remote access requires no security model changes; write-capable remote access requires auth.

**Persona impact:** Priya (high if confirmed by design partner feedback), Marcus (low — solo user), Dev (medium — single user but multiple machines)

**PRD mapping:** FR13 (Local-First — "Hosted remote multi-user operation is out of scope for v1" — explicitly Phase 3 candidate)

**Rough effort:** Very High — requires: network exposure beyond localhost (TLS, auth, CORS), session management, read vs. write permission scoping, and potentially a hosted offering or self-hosted server mode. The current architecture assumes `localhost` everywhere. This is a significant architectural change.

**Risk:** This is the scope-explosion risk the PRD specifically warned against. Only proceed if Phase 2 design partner feedback explicitly identifies this as a blocker for team adoption. Do not pursue based on internal assumptions.

**Ticket stub:** CP-T045 — Optional Remote / Team Mode (Scope TBD)

---

## Candidate 9: Saved Workspaces, Filters, and Frequently-Used Views

**Problem statement:**
Power users like Dev have specific Memory Explorer filters and Staff Activity Stream configurations they re-apply every session (e.g., "Archivist events for entity type project, last 24 hours"). Currently these must be manually re-applied on each visit. There is no way to save a named filter preset or view configuration.

**User value:**
Dev saves a "morning audit" workspace: Memory Explorer filtered to confidence < 50 + temporal history open for his primary project entity. Opens the control plane, clicks "morning audit," and is immediately in his diagnostic context. Priya saves a "pre-deploy check" workspace: all health checks + provider status + instance manager.

**Persona impact:** Dev (high), Priya (medium), Marcus (low)

**PRD mapping:** Phase 3 roadmap candidate mentioned in roadmap.md

**Rough effort:** Medium — localStorage-based saved filter state is straightforward. Named workspaces require a bit more schema design. No backend changes needed if localStorage is the storage.

**Dependencies:** CP-T036, CP-T037 must exist. Command palette (CP-T024) is the ideal activation surface for saved workspaces.

**Ticket stub:** CP-T046 — Saved Workspaces, Filters, and Frequently-Used Views

---

## PM Audit Notes — 2026-03-20

**Ticket number conflict:** CP-T039 has been assigned to the staff_events migration task (devops_engineer, Phase 2). The "Create Instance and Rebind Project" Phase 3 stub listed below as CP-T039 must be renumbered to **CP-T047** when Phase 3 tickets are cut. Do not create a file named `cp-t039.md` for that item.

**Entity Aliases urgency:** CP-T038 was expected in Phase 2 per PM Decision 2. Monitor design partner sessions closely. If Priya or Dev surface multi-agent alias confusion during Phase 2 validation, promote CP-T038 from Phase 3 candidate to Phase 2 addition and cut the ticket immediately.

**Missing candidates (not yet in this list):**
- Model routing rules and quota alerting — follow-on to Phase 2 Provider Manager (CP-T022). As providers gain usage, operators will want alert thresholds and per-task model routing rules. Add before Phase 3 ticket cut.
- Bulk conflict resolution — if operators accumulate many pending escalations, single-resolution UI (CP-T021) becomes a bottleneck. A bulk select-and-resolve flow should be considered for Phase 3.

---

## Phase 3 Priority Ordering (Provisional)

Based on persona impact, PRD priority, and effort-to-value ratio:

| Priority | Candidate | Ticket | Rationale |
|----------|-----------|--------|-----------|
| 1 | Value Diff Between History Intervals | CP-T042 | Low effort, high Dev impact, pure frontend |
| 2 | Full-Text Search Across Fact Values | CP-T041 | Medium effort, unblocks Adminer-equivalent power search |
| 3 | Entity Aliases | CP-T038 | PRD gap, deferred too long, needed for multi-agent users |
| 4 | Persistent Chat History | CP-T043 | Low-medium effort, completes the chat panel use case |
| 5 | Saved Workspaces | CP-T046 | Medium effort, high daily-use value for power users |
| 6 | Multi-Instance Data Isolation | CP-T040 | High effort but critical for team evaluation |
| 7 | Create Instance / Rebind Project | CP-T047 | Medium-high effort, depends on CP-T040. Note: stub was CP-T039 but that number is taken (staff_events migration). |
| 8 | macOS Installer | CP-T044 | High effort, validate demand first |
| 9 | Remote / Team Mode | CP-T045 | Very high effort, validate demand with design partners |

---

## Phase 3 Entry Criteria

Phase 3 scope must be confirmed by PM after:
- Phase 2 complete and v0.2.0 accepted
- At least 3 design partner sessions completed
- Phase 2 retrospective written
- User feedback from design partners reviewed and synthesized

Do not cut Phase 3 tickets before these criteria are met.

---

*Maintained by: product_manager*
*Next review: Phase 2 retrospective*
