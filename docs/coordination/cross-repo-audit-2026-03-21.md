# Cross-Repo Product Alignment Audit — Iranti Control Plane

**Produced by:** product_manager
**Date:** 2026-03-21
**Scope:** iranti (core), iranti-site (marketing/docs), iranti-benchmarking (evaluation harness), iranti-control-plane (context only)

---

## 1. Iranti Core (`iranti` repo)

### 1.1 Current Version

**Version: 0.2.12** (package.json `"version": "0.2.12"`)

The CHANGELOG records releases from 0.1.0 (2026-03-04) through 0.2.12 (2026-03-20). The control plane's last-spec'd version is 0.2.9. Three versions have shipped since the control plane's Phase 2 specs were written.

### 1.2 Complete API Route Map

**Server: `src/api/server.ts`**
**Base URL:** `http://localhost:3001`
**Default port:** `IRANTI_PORT` env var, default `3001`

#### Public Endpoints (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Returns `{ status, version, provider }` — version hardcoded as `"0.2.12"` in server.ts |

#### Knowledge Base (`/kb/*`) — requires `kb:read` / `kb:write` scopes

| Method | Path | Auth Scope | Description |
|--------|------|-----------|-------------|
| `POST` | `/kb/write` | `kb:write` (entity-namespaced) | Write a single fact via Librarian |
| `POST` | `/kb/ingest` | `kb:write` (entity-namespaced) | Ingest free-text, extract and write facts via chunker/Librarian |
| `POST` | `/kb/resolve` | `kb:write` (entity-namespaced) | Resolve or create a canonical entity by name/alias |
| `POST` | `/kb/alias` | `kb:write` (entity-namespaced) | Add an alias to a canonical entity |
| `GET` | `/kb/entity/:entityType/:entityId/aliases` | `kb:read` (entity-namespaced) | List all aliases for an entity |
| `GET` | `/kb/query/:entityType/:entityId/:key` | `kb:read` (entity-namespaced) | Exact entity+key lookup; supports `?asOf=ISO&includeExpired=bool&includeContested=bool` |
| `GET` | `/kb/history/:entityType/:entityId/:key` | `kb:read` (entity-namespaced) | Full temporal history (KB + archive) for a fact key |
| `GET` | `/kb/query/:entityType/:entityId` | `kb:read` (entity-namespaced) | All facts for an entity (queryAll) |
| `GET` | `/kb/search` | `kb:read` (global scope only) | Hybrid lexical+vector search; params: `query`, `limit` (1–50), `entityType`, `entityId`, `lexicalWeight`, `vectorWeight`, `minScore` |
| `POST` | `/kb/relate` | `kb:write` (entity-namespaced for both entities) | Create a typed relationship edge between two entities |
| `GET` | `/kb/related/:entityType/:entityId` | `kb:read` (entity-namespaced) | Get all direct relationships for an entity |
| `GET` | `/kb/related/:entityType/:entityId/deep` | `kb:read` (entity-namespaced) | BFS relationship traversal; `?depth=N` (default 2) |
| `POST` | `/kb/batchQuery` | `kb:read` (global scope) | Batch exact lookups; body `{ items: [{ entity, key }] }`, max 200 items |

#### Memory / Agent Working Memory (`/memory/*`) — requires `memory:read` / `memory:write` scopes

| Method | Path | Auth Scope | Description |
|--------|------|-----------|-------------|
| `POST` | `/memory/handshake` | `memory:write` | Load working memory brief for an agent at session start |
| `POST` | `/memory/reconvene` | `memory:write` | Resume session — update working memory for ongoing task |
| `POST` | `/memory/observe` | `memory:write` | Passive relevance check: which KB facts are relevant to the current context? Requires `agent` + `currentContext` (or `entityHints`) |
| `POST` | `/memory/attend` | `memory:write` | Per-turn injection decision: should memory be injected before this turn? Supports `forceInject=true` |
| `GET` | `/memory/whoknows/:entityType/:entityId` | `memory:read` | Which agents have contributed facts to this entity? |
| `POST` | `/memory/maintenance` | `memory:write` | Trigger Archivist maintenance cycle manually |

#### Agent Registry (`/agents/*`) — requires `agents:read` / `agents:write` scopes

| Method | Path | Auth Scope | Description |
|--------|------|-----------|-------------|
| `POST` | `/agents/register` | `agents:write` | Register an agent profile (name, description, capabilities, model, properties) |
| `GET` | `/agents` | `agents:read` | List all registered agents |
| `GET` | `/agents/:agentId` | `agents:read` | Get a single agent record (profile + stats) |
| `POST` | `/agents/:agentId/team` | `agents:write` | Assign agent to a team |

#### Metrics

| Method | Path | Auth Scope | Description |
|--------|------|-----------|-------------|
| `GET` | `/metrics` | `metrics:read` | Snapshot of in-process counters and timer p95s |
| `POST` | `/metrics/reset` | `metrics:write` | Reset all in-process metric counters |

Metric counters tracked: `llm.calls`, `llm.failures`, `llm.cache_hit`, `llm.cache_miss`, `db.queries`, `librarian.created`, `librarian.updated`, `librarian.rejected`, `librarian.escalated`, `archivist.processed`, `archivist.resolutions_applied`

Timer names tracked: `attendant.handshake_ms`, `attendant.observe_ms`, `attendant.attend_ms`, `attendant.reconvene_ms`, `librarian.write_ms`, `llm.latency_ms`, `archivist.cycle_ms`

#### Chat Completions Proxy

| Method | Path | Auth Scope | Description |
|--------|------|-----------|-------------|
| `POST` | `/v1/chat/completions` | `proxy:chat` | OpenAI-compatible proxy to configured LLM provider |
| `POST` | `/chat/completions` | `proxy:chat` | Alias of above |

#### Dev / Admin

| Method | Path | Auth Scope | Description |
|--------|------|-----------|-------------|
| `POST` | `/dev/reset` | `system:admin` | Delete all entries by agent `"benchmark"` — disabled in production |

### 1.3 New Routes / Changes Since Control Plane Was Spec'd (0.2.9 → 0.2.12)

The spec docs for the control plane were written against v0.2.9. Since then:

**0.2.10 additions (2026-03-20):**
- `IRANTI_PROJECT_MODE` env var now written to `.env.iranti` explicitly by `iranti setup`
- Default setup flow changed to **isolated per-project** (previously shared-runtime-first)
- ADR 005 documenting this as the canonical default model — affects Getting Started screen logic in CP-T035

**0.2.11 additions (2026-03-20):**
- `iranti doctor` now correctly reads `.env.iranti` as a project binding (not `DATABASE_URL` inside it) and inspects the bound instance's database, provider, and vector backend
- False failures for correctly-bound repos are now fixed — the control plane's Health view (`iranti doctor` equivalent) may have been built against the old broken behavior

**0.2.12 additions (2026-03-20):**
- `--debug` and `--verbose` flags added to the global CLI
- CLI failures now emit stable error codes, fix hints, and structured debug details
- The control plane's Getting Started / repair UX is not yet aware of these new debug flags

**No route-level additions or removals were found in 0.2.10–0.2.12.** The routes mapped above reflect the full current surface. The changes in these three versions are CLI UX and operational behavior only.

### 1.4 Staff Component Behavior

#### Librarian (`src/librarian/index.ts`)
The Librarian is the write manager. Every write to the KB goes through `librarianWrite()`. Its decision pipeline:

1. Clamp confidence to [0, 100]. Normalize `createdBy` to lowercase.
2. Block writes to `agent/*/attendant_state` from non-staff callers.
3. Check idempotency receipt by `requestId` — replay already-resolved writes.
4. Enforce write permissions (namespace protection for staff namespace).
5. Within an identity-scoped lock (`withIdentityLock` on entityType+entityId+key):
   - Block writes to protected staff namespace from non-staff writers.
   - Check `isProtected` flag — seed-only entries cannot be overwritten.
   - If no existing entry: check for **contextual conflict** (same entity, semantically similar but different key). If conflict detected, reject. Otherwise create.
   - If existing entry: invoke `resolveConflict()`.

Conflict resolution ladder in `resolveConflict()`:
- **Same confidence + same source** → accept incoming (replace)
- **Same confidence + different source** → temporal tie-break by `validFrom`; if tied → **escalate**
- **Duplicate value (same JSON), scores within 1.0** → escalate
- **Duplicate value, score gap > 1.0** → accept higher score
- **Authoritative source rules** (per `authoritativeSourcesByKey` policy) → authoritative wins
- **Score gap ≥ `minConfidenceToOverwrite`** → higher score wins
- **Ambiguous gap** → LLM arbitration (`KEEP_EXISTING` / `KEEP_INCOMING` / `ESCALATE`)
- LLM error → escalate

Escalated conflicts write a markdown file to `escalation/active/`. The Archivist picks these up when `**Status:** RESOLVED` appears in the file.

Emitted write actions: `"created"`, `"updated"`, `"escalated"`, `"rejected"`

Librarian also has `librarianIngest()` which runs `chunkContent()` (LLM extraction of structured facts from free text) and then calls `librarianWrite()` for each extracted chunk.

**B6 finding (critical):** The ingest pipeline has confirmed contamination behavior — extracted facts are influenced by existing KB content, not purely from the input text. Accuracy in the benchmark was 1/4 (25%) for a 4-key extraction task.

#### Attendant (`src/attendant/AttendantInstance.ts`)
One instance per agent. Key constants:
- `CONTEXT_RECOVERY_THRESHOLD = 20` LLM calls before context recovery triggers
- `ENTITY_DETECTION_WINDOW_CHARS = 1500`
- `MIN_ENTITY_CONFIDENCE = 0.75`
- `MEMORY_DECISION_CONTEXT_WINDOW_CHARS = 2000`

Exported types:
- `AgentContext { task: string; recentMessages: string[] }`
- `WorkingMemoryEntry { entityKey: string; summary: string; confidence: number; source: string; lastUpdated: string }`
- `WorkingMemoryBrief { agentId: string; operatingRules: string; inferredTaskType: string; workingMemory: WorkingMemoryEntry[]; sessionStarted: string; briefGeneratedAt: string; contextCallCount: number }`
- `ObserveResult { facts; entitiesDetected; entitiesResolved; alreadyPresent; totalFound; debug }`
- `AttendResult { shouldInject; reason; decision; facts; entitiesDetected; alreadyPresent; totalFound }`

**B11 findings (critical):**
- `iranti_observe` entity detection from raw context text is **broken** — `detectedCandidates: 0` even when the entity name appears verbatim. Entity hints are required for observe to function.
- `iranti_attend` injection classifier returns `classification_parse_failed_default_false` under normal conditions — the automatic per-turn injection decision is **not working**. `forceInject: true` bypasses the failure and works identically to observe.

#### Archivist (`src/archivist/index.ts`)
Runs on a schedule (configured via `IRANTI_ARCHIVIST_INTERVAL_MS` and `IRANTI_ARCHIVIST_WATCH`). A single `runArchivist()` call executes four passes:

1. **Archive expired** — entries with `validUntil < now` are moved to archive with `ArchivedReason.expired`
2. **Archive low confidence** — entries with `confidence < 30` (hardcoded) are archived
3. **Apply memory decay** — if `IRANTI_DECAY_ENABLED=true`, recalculates confidence via Ebbinghaus-style formula using `stability` and `lastAccessedAt`. Archives if below `IRANTI_DECAY_THRESHOLD`. Decay is off by default.
4. **Process escalations** — scans `escalation/active/*.md` for files containing `**Status:** RESOLVED`, extracts the `AUTHORITATIVE_JSON` block, and writes the resolution back to the KB. Moves resolved files to `escalation/resolved/` and archives a timestamped copy to `escalation/archived/`.

Decay env vars: `IRANTI_DECAY_ENABLED` (default: false), `IRANTI_DECAY_STABILITY_BASE` (30 days), `IRANTI_DECAY_STABILITY_INCREMENT` (5), `IRANTI_DECAY_STABILITY_MAX` (365 days), `IRANTI_DECAY_THRESHOLD` (10 confidence).

#### Resolutionist (`src/resolutionist/index.ts`)
Interactive CLI tool (`resolveInteractive(escalationDir)`). Not an HTTP endpoint. Reads pending escalation markdown files, presents them one at a time in the terminal, accepts `[1]` existing / `[2]` challenger / `[3]` custom / `[S]` skip / `[Q]` quit, and writes the `AUTHORITATIVE_JSON` block + marks `**Status:** RESOLVED`. The Archivist then picks up the file on its next cycle.

**This has no programmatic API surface.** The control plane's CP-T021 conflict review UI must either invoke the Resolutionist as a subprocess or replicate its file-write logic (which would then be picked up by the Archivist). The ticket correctly identified this risk.

### 1.5 Memory Model — Full Schema

From `prisma/schema.prisma` (confirmed current):

**`knowledge_base` (KnowledgeEntry):**
- `id`, `entityType`, `entityId`, `key` — composite unique
- `valueRaw` (Json), `valueSummary` (String)
- `confidence` (Int, default 50, range 0–100)
- `source` (String), `createdBy` (String)
- `validFrom` (DateTime, default now), `validUntil` (DateTime?, null = current)
- `lastAccessedAt` (DateTime, default now) — updated on reads for decay calculation
- `stability` (Float, default 30) — controls Ebbinghaus decay rate
- `conflictLog` (Json, default []) — append-only array of conflict events
- `isProtected` (Boolean, default false) — seed-only entries
- `properties` (Json, default {}) — stores `originalConfidence` for decay tracking
- `embedding` (vector(256)) — pgvector embedding, nullable

**`archive`:**
- Same core fields as `knowledge_base` plus:
- `archivedAt`, `archivedReason` (enum: `segment_closed`, `superseded`, `contradicted`, `escalated`, `expired`, `duplicate`)
- `resolutionState` (enum: `not_applicable`, `pending`, `resolved`)
- `resolutionOutcome` (enum: `not_applicable`, `challenger_won`, `original_retained`)
- `supersededBy`, `supersededByEntityType`, `supersededByEntityId`, `supersededByKey`

**`entity_relationships` (EntityRelationship):**
- `fromType`, `fromId`, `relationshipType`, `toType`, `toId` — composite unique
- `properties` (Json), `createdBy`, `createdAt`

**`write_receipts` (WriteReceipt):**
- `requestId` (unique), `entityType`, `entityId`, `key`, `outcome`, `resultEntryId?`, `escalationFile?`, `createdAt`

**`entities` (Entity):**
- `entityType`, `entityId` — composite PK
- `displayName`, `createdAt`
- Note: **The control plane Phase 1 notes explicitly flag that this table is not populated in the current Iranti runtime** — entity resolution creates entries in knowledge_base but does not always write canonical entity rows to this table.

**`entity_aliases` (EntityAlias):**
- `entityType`, `aliasNorm` — composite unique
- `rawAlias`, `canonicalEntityType`, `canonicalEntityId`, `source`, `confidence`, `createdAt`

### 1.6 Auth Mechanism

Confirmed: `X-Iranti-Key: <token>` header (recommended) or `Authorization: Bearer <token>`.

Three key modes:
1. **Registry key** (recommended): `<keyId>.<secret>` format
2. **Legacy single key**: `IRANTI_API_KEY` env var
3. **Legacy key list**: `IRANTI_API_KEYS` (comma-separated)

Scope format: `resource:action` or `resource:action:entityType/entityId`

Namespace scoping is implemented in `src/security/scopes.ts` with deny-beats-allow semantics. Wildcard `entityType/*` is supported; `*/entityId` is not. Note: `GET /kb/search`, `POST /kb/batchQuery`, and all `/memory/*` routes require **global** scope (not namespace-scoped) in the current implementation.

### 1.7 New Features Not Yet Surfaced by the Control Plane

The following Iranti capabilities exist but have no control plane surface:

1. **`IRANTI_PROJECT_MODE` env var** (0.2.10) — not reflected in Instance Manager
2. **`--debug` / `--verbose` CLI flags** (0.2.12) — not exposed in Getting Started repair flow
3. **`iranti doctor` project-bound behavior fix** (0.2.11) — control plane's doctor integration may be calling it with wrong semantics
4. **Agent team assignment** (`POST /agents/:agentId/team`) — no UI surface
5. **Memory decay configuration** (`IRANTI_DECAY_*` env vars) — not visible in Provider/Health view
6. **`stability` field** on KnowledgeEntry — not shown in Memory Explorer fact detail
7. **`lastAccessedAt` field** — not shown in Memory Explorer (relevant for decay diagnostics)
8. **`isProtected` flag** — shown in KB browse, but no ability to understand implications
9. **`properties` JSON field** (stores `originalConfidence`) — not surfaced in fact inspector
10. **Vector backend selection** (`IRANTI_VECTOR_BACKEND`, `pgvector` / `qdrant` / `chroma`) — not surfaced in Health or Provider views
11. **Chat completions proxy** (`/v1/chat/completions`, `/chat/completions`) — no control plane surface or mention
12. **`/kb/resolve` and `/kb/alias` endpoints** — entity resolution and aliasing have no UI
13. **`iranti_attend` injection classifier** — the control plane has no way to show injection decisions (relevant for Attendant transparency, CP-T025 scope)

### 1.8 Operational Requirements Affecting Installer/Onboarding

- **Node.js >= 18** (engines field confirmed)
- **PostgreSQL** — required; pgvector extension required for embedding search
- **`DATABASE_URL`** env var — required at runtime
- **`LLM_PROVIDER`** — defaults to `mock`; valid values: `gemini`, `openai`, `mock` (plus `anthropic`, `groq`, `mistral` implied by provider normalization code)
- **`IRANTI_PORT`** — defaults to 3001
- **`IRANTI_MAX_BODY_BYTES`** — defaults to `256kb`
- **`IRANTI_REQUEST_LOG_FILE`** — defaults to `logs/api-requests.log` relative to cwd
- **`IRANTI_ESCALATION_DIR`** — escalation folder root
- **`IRANTI_ARCHIVIST_WATCH`** — file watcher for escalations (default: true)
- **`IRANTI_ARCHIVIST_INTERVAL_MS`** — scheduled maintenance interval (0 = disabled)
- **`IRANTI_ARCHIVIST_DEBOUNCE_MS`** — debounce for file watcher (default: 60,000)
- **`IRANTI_DECAY_ENABLED`** — opt-in memory decay (default: false)
- **Vector backend env vars** — `IRANTI_VECTOR_BACKEND`, `IRANTI_QDRANT_URL`, `IRANTI_CHROMA_URL`, etc.

### 1.9 Upstream Breaking Changes Affecting Control Plane API Client Code

**No breaking route-level changes were found in 0.2.10–0.2.12.** All three releases were CLI UX and operational behavior fixes. The control plane API client code targeting 0.2.9 routes should continue to work against 0.2.12 without modification.

One nuance: the `iranti doctor` behavioral fix in 0.2.11 changes what the command outputs when run in a project-bound directory. If the control plane's repair/health flows invoke `iranti doctor` as a subprocess and parse its output, those parsers may see different output than what was spec'd against 0.2.9.

---

## 2. Iranti Site (`iranti-site` repo)

### 2.1 Public Positioning

The site positions Iranti as **"Memory infrastructure for multi-agent AI"**. Key claims from `Hero.tsx`:
- "Iranti gives agents persistent, identity-based shared memory."
- "Facts written by one agent are retrievable by any other through exact `entity + key` lookup."
- "Conflict-aware. Session-persistent. Framework-agnostic."
- "Not an agent framework — the memory layer underneath one."

Hero stats shown: `20/20` cross-session retrieval, `16/16` conflict benchmark (the Proof page separately shows `16/16` adversarial conflicts — note this is different from the `7/16 (44%)` internal conflict benchmark cited in the changelog at 0.2.0), `4/4` consistency validation.

**Naming note:** The site calls the component "Library" (not "Librarian") in the TheStaff component for the knowledge base data store, and separately "Librarian" for the write manager. This is a site-specific distinction: in the core codebase the "Library" refers to `src/library/` (database queries, client, entity resolution, etc.) and the "Librarian" refers to `src/librarian/` (write logic). The control plane should use the same naming as the site for user-facing labels.

The site also names five components in the Staff: Library, Librarian, Attendant, Archivist, Resolutionist — matching the codebase exactly.

**Version badge on Hero:** `v0.2.12 — open source, AGPL` — this is current.

### 2.2 Installation and Onboarding Story

The site presents two installation surfaces:

**`Install` component (homepage section):** "Up in four commands."
1. `npm install -g iranti` — requires Node.js 18+
2. `iranti setup` — "walks you through postgres, API keys, and project binding"
3. `iranti run --instance local` — "runs on port 3001 by default"
4. `iranti project init . --instance local --agent-id my_agent` — "writes .env.iranti to your project"

**`GetStartedContent` component (`/get-started` page):** Expands this with:
- DB path selector: **Local Postgres** / **Managed (Railway/Supabase)** / **Docker** — with different connection string guidance per path
- Step-by-step expanded instructions including: `docker run` command for Docker path, connection string format for each path
- Claude Code path: `iranti claude-setup`
- Codex path: `iranti codex-setup`
- `iranti chat` path: "interactive terminal session"

Diagnostics note on site: "If something fails at any step, use `iranti doctor --debug` for a full diagnostic report."

### 2.3 Gaps Between Site Promises and Control Plane Delivery

| Site Promise | Control Plane Status |
|---|---|
| `iranti setup` as the entry point to first-run | CP-T023 (CLI wizard) — PM-ACCEPTED Phase 2. Site matches. |
| "Up in four commands" — `iranti run --instance local` | The control plane does NOT expose an `iranti run` equivalent or instance start button. Users still need the CLI to start Iranti. |
| `iranti doctor --debug` for diagnostics | The control plane's Health view exists, but does not surface `--debug` flag output or structured error codes from v0.2.12 |
| DB path selection (Local / Managed / Docker) | Not surfaced in control plane Getting Started screen (CP-T035). The Getting Started screen checks setup steps but does not guide DB path selection. |
| Claude Code / Codex integration as core onboarding paths | CP-T033 integration repair exists. `iranti claude-setup` / `iranti codex-setup` as primary setup steps are surfaced in the Getting Started screen. |
| `iranti chat` as a first-class integration | Embedded chat exists (CP-T020). Site separately lists `iranti chat` (CLI) as distinct from a browser chat experience — the control plane has browser chat; the site describes CLI chat. These are two different surfaces, but the site doesn't differentiate them to the user. |

### 2.4 UX Flows and User Expectations Set by the Site

1. **Frictionless first install**: Site explicitly says "no manual env file editing on the happy path." The control plane should maintain this framing — any write action in the Provider or Instance managers must clearly route through wizard/guided flows, not raw env editing.

2. **Honesty about limitations**: Site's "honest scope" box and "Honest scope" notes are a product promise. The control plane must maintain the same tone — e.g., labeling Phase 1 stream coverage gaps explicitly (which CP-T026 did correctly).

3. **Framework-agnostic, not framework-replacing**: Site explicitly states "Not an agent framework — the memory layer underneath one." The control plane should never position itself as replacing the agent workflow. The chat panel and Staff stream are operator tools, not agent orchestration.

4. **"See proof" as a real link**: The site's Proof section links to `/proof/b1`, `/proof/b2`, `/proof/b3` benchmark detail pages. These exist in the site as dedicated routes. The control plane currently has no link to or awareness of this external proof/validation story.

### 2.5 Naming and Terminology to Honor in Control Plane UI

From the site's confirmed naming:
- **"The Staff"** — collective noun for all five components
- **"Library"** — the knowledge base data store (PostgreSQL tables)
- **"Librarian"** — the write manager (conflict detection, resolution)
- **"Attendant"** — per-agent memory (working memory, handshake, reconvene, observe, attend)
- **"Archivist"** — periodic cleanup (decay, expiry, escalation processing)
- **"Resolutionist"** — conflict review (human-in-the-loop CLI tool)
- **"entity + key"** — the canonical fact addressing model (always written with a plus sign or as "entity/key")
- **"knowledge base"** (two words, lowercase) — the `knowledge_base` table
- **"conflict-aware"**, **"session-persistent"**, **"framework-agnostic"** — the three product adjectives
- **"iranti chat"** — lowercase, referring to the CLI interactive session specifically
- Scope format example from docs: `kb:read`, `kb:write`, `kb:write:project/*` — always use colons, not dots

---

## 3. Iranti Benchmarking (`iranti-benchmarking` repo)

### 3.1 What the Benchmarking Harness Evaluates

The benchmarking program is an independent research workspace. It evaluates Iranti against recognizable external benchmarks. **11 benchmarks** have been run to date: B1–B11. Results are in `results/raw/` and published results in `results/published/`.

### 3.2 Benchmark Results Summary

| Benchmark | Description | Iranti Score | Key Finding |
|---|---|---|---|
| **B1** Entity Fact Retrieval (NIAH-inspired) | Exact entity/key lookup vs. context reading under distractor density | 8/8 exact lookup, 10/10 baselines at N=5, N=20, N=100 | Null differential at scale <130k tokens (Claude context handles it); Iranti's O(1) claim confirmed |
| **B2** Cross-Session Persistence | 20 facts written in Session 1, retrieved in Session 2 | 20/20 (100%) | Genuine cross-session evidence confirmed; zero hallucination |
| **B3** Conflict Resolution | 5 adversarial conflict scenarios | 4/5 (80%) | C2 failure (high-confidence first write blocks correction) is documented design property |
| **B4** Multi-Hop Entity Reasoning | 2-hop queries requiring entity discovery via search | Iranti search-based: 1/4 (25%); Oracle (known IDs): 4/4 | `iranti_search` fails to surface entities by attribute value — discovery is broken, retrieval is not |
| **B5** Knowledge Currency / Temporal Update | Fact update semantics, stale write rejection | T1b only: expected updates work | New-source updates blocked by LLM arbitration; no update primitive exists |
| **B6** Ingest Pipeline | Free-text → structured facts extraction accuracy | 1/4 (25%) | KB contamination confirmed — Librarian ingest extracts wrong values matching existing KB entries |
| **B7** Episodic Memory | Recall from a 51-turn simulated meeting transcript | 10/10 (100%) Iranti arm | Active-write pattern works; agent must write facts during conversation |
| **B8** Multi-Agent Coordination | Agent Alpha writes, Agent Beta reads — no shared context | 6/6 (100%) fidelity | Source attribution (`source=agent_alpha`) ≠ agentId attribution — B10 clarifies this |
| **B9** Entity Relationship Graph | `iranti_relate` write + agent read-back | Write: 5/5; Read-back by agent: 0/5 | Relationships are a **write-only store from the agent perspective** — no MCP tool to read them back |
| **B10** Knowledge Provenance (`iranti_who_knows`) | Attribution accuracy — which agent contributed which facts | agentId attribution: correct; source label attribution: not tracked | `who_knows` tracks agentId (system identity), not `source` (caller-supplied label) |
| **B11** Context Recovery (`iranti_observe` + `iranti_attend`) | Recover relevant facts from KB when context paged out | `observe`: 5/6 (83%) with hints; `attend`: 0/6 auto, 5/6 with forceInject | Entity auto-detection from raw text broken; `iranti_attend` injection classifier broken |

### 3.3 Operator-Facing Observability Needs Implied by Benchmarks

Each of these findings implies a feature gap the control plane could address:

**B4 — Multi-hop search failure:** An operator cannot currently see why `iranti_search` failed to find an entity by attribute value. The control plane has no search diagnostics view — no way to see what query was run, what embedding was used, what was and wasn't returned. **An operator debugging "why didn't the agent find this entity?" has no tool in the control plane.**

**B5 — No update primitive:** When an agent tries to update a fact and gets rejected, there is no operator surface for "show me recent rejections and why each was rejected." The `conflictLog` field contains this data but the control plane's Memory Explorer only shows a raw JSON expand of it — there is no parsed, human-readable conflict history view.

**B6 — Ingest contamination:** The control plane has no surface for showing "what did the Librarian extract from this ingest call?" — no ingest audit trail. If contamination is occurring in production, an operator has no way to detect it from the control plane.

**B9 — Relationship write-only:** The control plane has an entity relationship graph view (CP-T032, Phase 2 complete). However, this view reads from the database directly (the `/kb/related` REST endpoint), not through MCP tools. This is correct for the control plane. The gap is for agents — the control plane cannot help an agent understand what relationships exist.

**B11 — Attend classifier broken:** The control plane has no Attendant transparency surface. When `iranti_attend` silently fails (`classification_parse_failed_default_false`), there is no way for an operator to see this from the control plane. The Staff Activity Stream (Phase 2) covers Attendant events only if CP-T025 native emitter is merged — which it is not yet. Until that upstream PR is merged, Attendant failures are completely invisible.

### 3.4 Evaluation Workflows That Map to Control Plane Features

| Benchmark Finding | Maps to Control Plane Feature |
|---|---|
| B6 ingest contamination | Fact detail page should show `conflictLog` in parsed form, not just raw JSON |
| B5 rejection events | Memory Explorer should filter by `action=rejected` from conflictLog |
| B11 entity auto-detection failure | Attendant transparency: Getting Started screen or Health view should surface when entity detection is consistently failing |
| B4 search failure | Search diagnostic view: show scored results including why entities were or weren't returned |
| B10 agentId vs source | Memory Explorer fact detail should show both `createdBy` (agentId) and `source` (provenance label) with clear labels distinguishing the two |

---

## 4. Control Plane Alignment Gaps

### 4.1 Features Iranti Has That the Control Plane Does Not Yet Expose

**High Priority:**
1. **`stability` and `lastAccessedAt` fields in fact detail** — These are the two decay-relevant fields. Any operator debugging "why was this fact archived?" needs to see them. They are in the schema but not displayed.
2. **Memory decay configuration** — `IRANTI_DECAY_ENABLED`, `IRANTI_DECAY_STABILITY_BASE`, `IRANTI_DECAY_THRESHOLD` are env vars that control the Archivist's decay behavior. None are surfaced in the Provider view or Health view. An operator cannot tell whether decay is enabled or what parameters it's running at.
3. **Vector backend configuration and status** — `IRANTI_VECTOR_BACKEND` (pgvector / qdrant / chroma) is not shown anywhere. The Health view does not report which backend is active or whether it's reachable. This is particularly important for diagnosing B4-style search failures.
4. **`conflictLog` in parsed form** — The Memory Explorer shows `conflictLog` as raw JSON expandable. The data structure is an append-only array of conflict events with `type`, `at`, `incoming`, `existingScore`, `incomingScore`, `reason`, `usedLLM`. This should be rendered as a readable conflict history timeline, not raw JSON.
5. **Agent registry** — `/agents`, `/agents/:agentId` are not surfaced in the control plane. Operators cannot browse registered agents, their profiles, or their write stats (totalWrites, totalRejections, totalEscalations, avgConfidence, lastSeen, isActive).
6. **`iranti_attend` failure visibility** — The inject classifier failure (`classification_parse_failed_default_false`) is completely invisible to operators. No current control plane surface can detect or display it.
7. **`IRANTI_PROJECT_MODE` env var** — The isolated-per-project default (0.2.10) is not reflected in the Instance Manager. When an operator inspects a project binding, the mode (isolated/shared) is not shown.
8. **`--debug` / `--verbose` CLI flags** (0.2.12) — The Getting Started screen's repair guidance does not mention these flags. They are the primary debugging path per the v0.2.12 release.

**Medium Priority:**
9. **Agent team assignment** — No UI for `POST /agents/:agentId/team`.
10. **`/kb/resolve` and `/kb/alias` entity management** — No UI for creating or inspecting entity aliases beyond the deferred Phase 2 scope.
11. **Chat completions proxy** — `/v1/chat/completions` endpoint exists but is not mentioned or surfaced anywhere in the control plane.
12. **Write receipt audit trail** — `write_receipts` table exists with idempotency records. No control plane surface for it.
13. **`iranti doctor` project-bound fix** (0.2.11) — Health view's doctor integration may be calling the command incorrectly for project-bound instances.

### 4.2 Onboarding/Install Stories the Site Sets Up That the Control Plane Must Honor

1. **"No manual env file editing on the happy path"** — The Provider Manager (CP-T022) write path was deferred to Phase 3. Until it ships, operators who need to change a provider must manually edit env files, contradicting this site promise. This is a gap that should be clearly labeled in the control plane UI (e.g., "To change providers, run `iranti setup` or edit your instance `.env`").

2. **DB path selection (Local / Managed / Docker)** — The site's `/get-started` page provides three distinct DB setup paths with different instructions. The control plane's Getting Started screen (CP-T035) does not mirror this. New users who arrive at the control plane after the site experience will not see the same guidance structure.

3. **`iranti doctor --debug`** — The site references this as the primary debugging command. The Getting Started screen should mention `--debug` (available since 0.2.12) in its repair guidance.

4. **`iranti run --instance local`** — The site lists this as Step 3 of the install flow. The control plane does not have a "Start Instance" button. Operators who have installed via the site's instructions but have a stopped instance will land in the control plane disconnected with no clear in-UI path to restart.

### 4.3 Benchmark Scenarios That Imply Missing Operator-Facing Observability

| Benchmark | Gap | Missing Control Plane Surface |
|---|---|---|
| B4 multi-hop search | `iranti_search` fails for entity discovery by attribute | No search diagnostic view — no way to see search scores, matched/unmatched entities |
| B5 update blocking | New-source updates blocked by LLM arbitration | No rejection history per entity — conflictLog is raw JSON, not parsed |
| B6 ingest contamination | Librarian extracts wrong values from ingest | No ingest audit trail — no way to see what was extracted vs. what was written |
| B11 entity detection | Auto-detection from raw text fails silently | No Attendant transparency — injection decisions invisible without CP-T025 |
| B11 attend classifier | `iranti_attend` fails silently with parse error | No health signal for Attendant component status |
| B9 relationships write-only | Agents can't read relationships via MCP | Control plane can read them (endpoint exists), but no context for why agents can't see what the control plane shows |

### 4.4 Naming and Messaging Inconsistencies

1. **"Library" vs. "knowledge base"**: The site uses "Library" as the component name and "knowledge base" as the data concept. The control plane's navigation uses "Memory" (for the Memory Explorer). This is a deliberate product decision (the ticket names it Memory Explorer) but it differs from the site's framing. As long as the PRD's intent is clear, this is acceptable — but the control plane should not mix terminology inconsistently within its own UI.

2. **"iranti chat" (CLI) vs. Embedded Chat Panel**: The site describes `iranti chat` as a CLI tool. The control plane has an Embedded Chat Panel. These are not the same thing, but the site does not distinguish them. The control plane's embedded chat should be clearly labeled as the browser-based interface, not `iranti chat`.

3. **Conflict benchmark numbers**: The Hero strip shows `16/16 conflict benchmark` (adversarial). The Proof section shows `4/5 (80%)` for B3 conflict resolution. These are two different benchmarks (internal adversarial suite vs. external B3 program). The control plane does not reference either — no gap here, but the terminology is important for when the Proof section is linked.

4. **`createdBy` vs. `source`**: Iranti internally distinguishes `createdBy` (the authenticated agentId that made the write call) from `source` (a caller-supplied provenance string). The B10 benchmark confirms these are different layers. The control plane's Memory Explorer fact rows should display both with distinct labels.

---

## 5. Required Actions

### Critical Priority

| # | Gap | Recommendation | Scope |
|---|---|---|---|
| C1 | `iranti_attend` injection classifier is broken (B11 finding) | New ticket: Attendant health signal in Health view. Should surface when attend is consistently returning `classification_parse_failed` errors. This is a runtime bug in Iranti core — PM should flag upstream. Also surface in Control Plane Health check. | Small (signal) / Large (upstream fix) |
| C2 | `iranti_observe` entity detection from raw text broken (B11) | New ticket or PRD note: document known limitation. Control plane should surface hint that `entityHints` must be provided for observe to work. Getting Started screen or Attendant docs should reflect this. | Small |
| C3 | B6 ingest contamination — high severity production risk | New ticket: ingest audit trail. When `POST /kb/ingest` is called, the control plane should be able to show what was extracted (the results array from `librarianIngest`) alongside the fact detail. Existing `results` field in ingest response is the data source. PM should flag the contamination finding to the upstream Iranti team. | Medium |

### High Priority

| # | Gap | Recommendation | Scope |
|---|---|---|---|
| H1 | `stability` and `lastAccessedAt` not shown in fact detail | Ticket update to CP-T049 (Archivist Transparency) or new ticket: add both fields to Memory Explorer expanded row view and Archive Explorer expanded row view | Small |
| H2 | Memory decay configuration not visible | Update CP-T046 (Provider Manager) or create new ticket: add Decay Configuration section to the instance config / Health view. Show: `IRANTI_DECAY_ENABLED`, `IRANTI_DECAY_STABILITY_BASE`, `IRANTI_DECAY_THRESHOLD`, and current active values. | Small |
| H3 | Vector backend not visible | Update Health view ticket or create new ticket: add vector backend card to Health Dashboard. Show: active backend (`pgvector` / `qdrant` / `chroma`), reachability status, configured URL (for qdrant/chroma). | Small |
| H4 | `conflictLog` shown as raw JSON, not parsed | Ticket update: CP-T036 (Entity Detail) or new ticket. Parse `conflictLog` array into a readable conflict timeline. Each entry has `type`, `at`, `reason`, `usedLLM` — enough for a clean event list. | Medium |
| H5 | Agent registry has no control plane surface | New ticket: Agent Registry View. Lists all agents (from `GET /agents`), shows profile, stats (totalWrites, totalRejections, totalEscalations, avgConfidence, lastSeen, isActive). Read-only. | Medium |
| H6 | `iranti doctor` project-bound fix (0.2.11) not validated | Ticket update: add regression test to Health view QA checklist verifying doctor is invoked correctly for project-bound instances. | Small |
| H7 | Getting Started repair flow doesn't mention `--debug` / `--verbose` (0.2.12) | Update CP-T047 or Getting Started screen docs: add `iranti doctor --debug` and `iranti --debug` as repair tools in the troubleshooting section. | Small |
| H8 | `IRANTI_PROJECT_MODE` not shown in Instance Manager | Update CP-T033 (Integration Repair) or Instance view: show `IRANTI_PROJECT_MODE` value (`shared` / `isolated`) when displaying project binding detail. | Small |

### Medium Priority

| # | Gap | Recommendation | Scope |
|---|---|---|---|
| M1 | No search diagnostic surface (B4 finding) | New ticket (Phase 3): KB Search Diagnostics. Show search query, returned results with `lexicalScore`, `vectorScore`, and combined `score`. Allow searching from the control plane UI and inspecting why certain entities were or weren't matched. | Large |
| M2 | No rejection history per entity (B5 finding) | Ticket update to CP-T036 / CP-T049: parse the `conflictLog` and filter to show only `CONFLICT_REJECTED` events per entity. This is a subset of H4. | Medium |
| M3 | Ingest audit trail missing (B6 finding) | New ticket: ingest call history. When looking at a fact in the Memory Explorer, show whether it was originally written via `ingest` (check `source` field pattern or add ingest tracking). | Medium |
| M4 | Provider Manager write path deferred — site claims "no env editing" | Add in-control-plane message to Provider view: "To change providers, run `iranti setup` or edit your instance `.env`". Clear label that write is not yet available. | Small |
| M5 | No "Start Instance" button / instance is stopped | New ticket: instance start/stop action (or at minimum a reminder about `iranti run` when instance is unreachable). The Getting Started flow and Health view should surface `iranti run --instance <name>` as the restart command. | Small |
| M6 | Site's DB path selector not mirrored in Getting Started screen | Update CP-T047 or new Getting Started screen ticket: add DB path selection context (Local / Managed / Docker) to the setup wizard section within the control plane. | Medium |
| M7 | `createdBy` vs. `source` not clearly distinguished in UI | Ticket update to CP-T036: show both fields with distinct labels ("Written by (agent)" for `createdBy`, "Provenance source" for `source`). | Small |
| M8 | Write receipts not surfaced | New ticket (Phase 3+): Write Receipt Audit Log. Browse `write_receipts` table filtered by entity/key. Useful for idempotency debugging. | Medium |

### Low Priority

| # | Gap | Recommendation | Scope |
|---|---|---|---|
| L1 | Chat completions proxy not documented or surfaced | PRD update note: the `/v1/chat/completions` proxy exists. No control plane UI needed, but the embedded chat panel's provider selection should be aware of it. Document in API reference. | Small |
| L2 | Agent team assignment not surfaced | New ticket (Phase 3+): add "Assign to Team" action in Agent Registry view if H5 is built. | Small |
| L3 | Entity aliases UI deferred since Phase 1 | Confirm whether entity alias management is still Phase 3 scope or has been deprioritized further. PRD notes "deferred to Phase 2" for aliases — but Phase 2 is complete with no alias ticket delivered. | PRD clarification |
| L4 | B9 relationship write-only for agents | The control plane reads relationships correctly. Document this distinction in the control plane's help text for the relationship graph view: "These relationships are visible to operators in this view. Agents cannot currently read relationships via MCP tools." | Small |
| L5 | Homebrew Cask for CP-T048 | Confirm: the roadmap lists this as a separate dedicated ticket (not CP-T048 scope). Ticket should be formally created if CP-T048 ships successfully. | Small |

---

## Summary of Key Findings

1. **Iranti is now at 0.2.12** — three minor versions past what the control plane specs were written against. No breaking route changes, but three areas of CLI/behavioral change need control plane reflection.

2. **The ingest pipeline (B6) has a confirmed high-severity contamination bug** — Librarian extracts facts matching existing KB content rather than the input text. This is a production risk that should be escalated to the upstream Iranti team as a P0 finding from the benchmarking program, and the control plane should get an ingest audit trail to detect it.

3. **`iranti_attend` injection classifier is broken (B11)** — automatic per-turn memory injection is non-functional. This is a silent failure with no current operator visibility. This is the most operationally impactful benchmark finding.

4. **`iranti_search` entity discovery fails (B4)** — multi-hop queries requiring entity discovery by attribute value succeed 1/4 (25%). The control plane has no diagnostic surface for search behavior.

5. **Agent registry has no control plane surface at all** — despite `GET /agents` and `GET /agents/:agentId` existing and returning rich stats (totalWrites, totalRejections, totalEscalations, avgConfidence), this data is invisible to operators in the control plane.

6. **Decay configuration is invisible** — `IRANTI_DECAY_ENABLED` and related env vars are not surfaced. Operators cannot tell whether decay is running or at what parameters.

7. **Vector backend status is invisible** — three backend options exist (pgvector, qdrant, chroma) but the Health view does not report which is active or whether it's reachable.

8. **The site's four-step install flow sets expectations the control plane does not fully meet** — specifically: no in-control-plane way to start a stopped instance, no DB path guidance mirroring the site's three-path selector, and no `--debug` flag mention in repair flows.

9. **The Resolutionist has no programmatic API** — it is a CLI-only interactive tool. CP-T021's implementation must have worked around this. The approach used should be documented for Phase 3 if escalation review is extended.

10. **CP-T025 (native emitter injection) is the keystone for all Attendant/Resolutionist observability** — until this upstream PR is merged, the Staff Activity Stream and Staff Logs view will remain Librarian + Archivist only, and the B11 attend classifier failure will remain invisible.