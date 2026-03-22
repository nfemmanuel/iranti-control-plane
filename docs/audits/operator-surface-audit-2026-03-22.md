# Operator Surface Audit — Iranti Control Plane vs. Iranti CLI/Runtime

**Audited by:** product_manager
**Date:** 2026-03-22
**Scope:** Full comparison of Iranti CLI/runtime operator surface against control-plane repo state.

---

## 1. Product Framing: What the Control Plane Is and Is Not

### What it is

The control plane is the visual operator layer for Iranti. It is the surface an operator uses to:

- understand what Iranti is currently doing and why
- manage instances, projects, and their integrations from one place
- configure providers and model routing without editing env files
- rotate and manage API keys without scripts
- resolve conflicts without the terminal
- diagnose and repair a broken setup without raw CLI spelunking
- install and onboard a new instance without infrastructure guesswork

The correct mental model is: **anything the CLI can do that is meaningful and repeatable should have a control-plane equivalent, or a clearly justified reason why it is CLI-only.**

### What it is not

- A generic admin dashboard skinned with Iranti branding
- A read-only inspection surface (inspection is the floor, not the ceiling)
- A replacement for the Iranti CLI for power-user scriptable operations
- A hosted SaaS product or multi-tenant admin panel
- A benchmarking or marketing visualization layer
- A database admin panel (no direct SQL surface)

### The core operator promise

> You can run Iranti, manage its configuration, and repair a broken setup entirely from the control plane. You should only need the terminal for scripting, automation, or advanced power-user workflows.

**Today, this promise is broken for a significant set of operator jobs.** The control plane covers observability well. It does not yet cover configuration management.

---

## 2. Iranti CLI Operator Surface — Complete Map

The full operator surface extracted from `docs/guides/manual.md`, `scripts/iranti-cli.ts`, and all feature specs:

### 2.1 Runtime Lifecycle

| Command | Description |
|---|---|
| `iranti run --instance <name>` | Start an instance server |
| `iranti instance restart <name>` | Restart a live instance |
| `iranti upgrade` | Detect + execute CLI/package upgrade |
| `iranti upgrade --check` | Check upgrade status without executing |
| `iranti upgrade --restart --instance <name>` | Upgrade + restart instance |
| `iranti uninstall` | Remove CLI package (keeps data) |
| `iranti uninstall --all --yes` | Full teardown: CLI + runtime + project bindings + integrations |

### 2.2 Discovery and Status

| Command | Description |
|---|---|
| `iranti status` | Machine layout: runtime root, all instances, live/stale/stopped |
| `iranti status --json` | Machine-readable status |
| `iranti doctor` | Full diagnostic check on env, DB, provider keys, runtime |
| `iranti doctor --instance <name>` | Instance-specific doctor |
| `iranti doctor --json` | Machine-readable diagnostics |
| `iranti instance list` | List all known instances |
| `iranti instance show <name>` | Show single instance with runtime metadata |

### 2.3 Instance Management

| Command | Description |
|---|---|
| `iranti instance create <name>` | Create a new instance with port, DB URL, provider |
| `iranti configure instance <name>` | Update instance (DB URL, port, provider, provider key) |
| `iranti configure instance <name> --interactive` | Interactive update with prompts |
| `iranti setup` | Full guided first-run wizard |

### 2.4 Project Binding

| Command | Description |
|---|---|
| `iranti project init .` | Bind current project to an instance |
| `iranti project init . --mode shared` | Bind in shared mode |
| `iranti configure project .` | Update an existing project binding |
| `iranti configure project . --interactive` | Interactive rebind with prompts |
| `iranti configure project . --instance <name>` | Rebind to a different instance |

### 2.5 Integration Setup

| Command | Description |
|---|---|
| `iranti claude-setup .` | Scaffold `.mcp.json` and `.claude/settings.local.json` |
| `iranti claude-setup --scan <dir>` | Batch scaffold across all Claude projects in a directory |
| `iranti codex-setup` / `iranti integrate codex` | Register Iranti with Codex |
| `iranti mcp` | Run MCP server (stdio) |
| `iranti claude-hook --event <event>` | Claude Code hook runner |

### 2.6 Iranti Client API Key Management

| Command | Description |
|---|---|
| `iranti auth create-key` | Create or rotate a registry-backed API key |
| `iranti auth list-keys` | List all API keys for an instance |
| `iranti auth revoke-key` | Revoke an API key |

Key creation supports:
- stable key IDs, owner labels, scope lists (`kb:read`, `kb:write`, `memory:read`, etc.)
- namespace-aware scopes (`kb:read:project/acme`, `kb:write:project/*`, `kb:deny:project/rival`)
- `--write-instance` to sync generated token into instance env
- `--project` to sync into project binding

### 2.7 Upstream Provider Key Management

| Command | Description |
|---|---|
| `iranti list api-keys --instance <name>` | Show which provider keys are stored (masked) |
| `iranti add api-key <provider>` | Add a provider API key |
| `iranti update api-key <provider>` | Rotate a provider API key |
| `iranti remove api-key <provider>` | Remove a provider API key |

Providers: `openai`, `claude`, `gemini`, `groq`, `mistral` (not `mock` or `ollama`).
`--set-default` also updates `LLM_PROVIDER` in the instance env.

### 2.8 Provider and Model Configuration

| Capability | Description |
|---|---|
| `LLM_PROVIDER` | Default provider selection |
| `LLM_PROVIDER_FALLBACK` | Fallback chain: `openai,groq,mistral,mock` |
| Task-specific model routing | `CLASSIFICATION_MODEL`, `RELEVANCE_MODEL`, `SUMMARIZATION_MODEL`, `TASK_INFERENCE_MODEL`, `EXTRACTION_MODEL`, `CONFLICT_MODEL` |

### 2.9 Operator Tools

| Command | Description |
|---|---|
| `iranti chat` | Interactive chat shell with slash commands |
| `iranti handshake --task "<text>"` | Manual Attendant debug — see what the brief would be |
| `iranti attend "<query>"` | Manual memory retrieval for debugging |
| `iranti resolve` | Walk pending escalations interactively (Resolutionist) |

### 2.10 Session Recovery (Programmatic SDK)

| SDK Operation | Description |
|---|---|
| `checkpoint()` | Save durable session progress snapshot |
| `resumeSession()` | Resume an interrupted session |
| `completeSession()` | Mark session completed |
| `abandonSession()` | Explicitly discard interrupted session |

---

## 3. Operator Surface Matrix

| Capability | CLI? | CP Backend? | CP Frontend? | Status | Priority |
|---|---|---|---|---|---|
| **Instance: list** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Instance: show / runtime metadata** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Instance: start** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Instance: stop** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Instance: create** | ✓ | ✗ | ✗ | ❌ Missing | P0 |
| **Instance: configure (interactive update)** | ✓ | ✗ | ✗ | ❌ Missing | P0 |
| **Instance: restart post-upgrade** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Project: bind (init)** | ✓ | ✗ | ✗ | ❌ Missing | P0 |
| **Project: rebind to different instance** | ✓ | ✗ | ✗ | ❌ Missing | P0 |
| **Project: view binding** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Claude Code: scaffold .mcp.json + hooks** | ✓ | ✗ | ✗ | ❌ Missing | P1 |
| **Claude Code: view .mcp.json state** | ✓ | partial | partial | ⚠️ Partial | P1 |
| **Claude Code: view hook state** | ✓ | ✗ | ✗ | ❌ Missing | P1 |
| **Claude Code: scan-mode scaffold** | ✓ | ✗ | ✗ | ❌ Missing | P2 |
| **Codex: setup / register** | ✓ | ✗ | ✗ | ❌ Missing | P2 |
| **MCP: view registered servers per project** | ✓ | ✗ | ✗ | ❌ Missing | P1 |
| **Iranti client API keys: list** | ✓ | ✗ | ✗ | ❌ Missing | P0 |
| **Iranti client API keys: create** | ✓ | ✗ | ✗ | ❌ Missing | P0 |
| **Iranti client API keys: revoke** | ✓ | ✗ | ✗ | ❌ Missing | P0 |
| **Iranti client API keys: scope audit** | ✓ (CP-T063) | partial | partial | ⚠️ Partial | P0 |
| **Provider keys: list (masked)** | ✓ | ✓ | ✓ | ✅ Complete (read) | — |
| **Provider keys: add** | ✓ | ✗ | ✗ | ❌ Missing | P0 |
| **Provider keys: update / rotate** | ✓ | ✗ | ✗ | ❌ Missing | P0 |
| **Provider keys: remove** | ✓ | ✗ | ✗ | ❌ Missing | P0 |
| **Provider: set default** | ✓ | ✗ | ✗ | ❌ Missing | P0 |
| **Provider: set fallback chain** | ✓ | ✗ | ✗ | ❌ Missing | P1 |
| **Provider: task-model routing config** | ✓ | ✗ | ✗ | ❌ Missing | P1 |
| **Provider: reachability status** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Health: diagnostics** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Health: doctor per instance** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Health: version / upgrade status** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Upgrade: detect** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Upgrade: execute (UI-triggered)** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Uninstall: guidance** | ✓ | ✗ | ✗ | ❌ Missing | P2 |
| **Conflict resolution: view pending** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Conflict resolution: resolve (write)** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Memory: browse knowledge base** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Memory: browse archive** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Memory: temporal history** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Memory: entity detail** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Memory: full-text search** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Staff activity stream** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Staff logs** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Session recovery: view** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Session recovery: resume / abandon** | ✓ | unclear | unclear | ⚠️ Unverified | P1 |
| **Attendant debug (handshake/attend)** | ✓ | ✗ | ✗ | ❌ Missing | P2 |
| **Chat: embedded operator shell** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Setup wizard: guided first run** | ✓ | ✓ | ✓ | ✅ Complete | — |
| **Status: machine layout summary** | ✓ | partial | partial | ⚠️ Partial | P1 |
| **Metrics: KB growth, write volume** | — | ✓ | ✓ | ✅ Complete | — |
| **Agent registry: view** | — | ✓ | ✓ | ✅ Complete | — |
| **Entity type browser** | — | ✓ | ✓ | ✅ Complete | — |
| **Relationship graph** | — | ✓ | ✓ | ✅ Complete | — |
| **Who knows contributor panel** | — | ✓ | ✓ | ✅ Complete | — |

---

## 4. Gap Analysis

### 4.1 Highest-Value Missing Operator Capabilities (by impact)

#### GAP-1: Iranti Client API Key Management — CRITICAL
**Operator job:** "My project's API key stopped working. I need to see what keys exist, create a new one, and revoke the broken one."

The CLI has `iranti auth create-key`, `iranti auth list-keys`, `iranti auth revoke-key` with full scope management. The control plane has **zero surface** for this. The CP-T063 API Key Scope Audit view shows existing scopes from the project `.env.iranti`, but cannot list all keys registered in the instance DB, create new keys, or revoke them.

This is the gap operators hit most often in day-to-day operations — when a key rotates, expires, or you need to provision a new integration.

**Missing:** GET+POST `/api/control-plane/auth-keys` with list, create (scoped), revoke.

---

#### GAP-2: Provider Key Management — CRITICAL (write path)
**Operator job:** "I want to add my Gemini key. I want to rotate my OpenAI key. I want to remove a stale provider."

The ProviderManager view shows provider reachability (read-only). The `providers.ts` backend has only GET routes — no write path at all. The CLI has `iranti add|update|remove api-key` with full CRUD.

An operator whose provider key stops working must drop to the terminal. This breaks the promise.

**Missing:** POST/PUT/DELETE `/api/control-plane/providers/:provider/key` plus "Set as default provider" action.

---

#### GAP-3: Instance Create — CRITICAL
**Operator job:** "I want to create a second instance for my team project."

`iranti instance create local --port 3001 --db-url "..." --provider mock` has no UI equivalent. The Instance Manager shows existing instances and their lifecycle, but cannot create a new one. This means onboarding a second project or creating a parallel instance always requires the terminal.

**Missing:** Instance creation form — name, port, database URL, provider.

---

#### GAP-4: Project Binding Create / Rebind — HIGH
**Operator job:** "I want to bind this project to Iranti" or "I need to move this project to a different instance."

`iranti project init .` and `iranti configure project . --instance <name>` have no UI equivalent. The Instance Manager shows project bindings read-only. This was explicitly deferred as CP-T033 but was never fully resolved — CP-T033 added integration repair buttons but not the core bind/rebind flow.

**Missing:** "Bind project" action (path selector + instance selector + mode), rebind action per existing project.

---

#### GAP-5: Provider Model Routing Configuration — HIGH
**Operator job:** "I want to use cheap models for fast tasks and expensive models for conflict resolution."

`CLASSIFICATION_MODEL`, `CONFLICT_MODEL`, etc. are meaningful operator controls for cost optimization. The ProviderManager shows which provider is active, but has no ability to configure task-specific model overrides. This is a significant omission given how often operators need to tune this for cost.

**Missing:** Per-task model routing editor in the Provider Manager.

---

#### GAP-6: Provider Fallback Chain Configuration — HIGH
**Operator job:** "I want Iranti to fall back to OpenAI if Gemini hits rate limits."

`LLM_PROVIDER_FALLBACK=openai,groq,mock` is a meaningful HA configuration. No UI surface exists for configuring or even inspecting it.

**Missing:** Fallback chain inspector + editor in the Provider Manager.

---

#### GAP-7: Claude Code Integration Manager — MEDIUM-HIGH
**Operator job:** "I want to see if my Claude Code integration is healthy. I want to scaffold the MCP + hooks for this project from the UI."

The control plane shows Claude integration status (present/absent) but has no mechanism to:
- View the actual content of `.mcp.json` and `.claude/settings.local.json`
- Run `iranti claude-setup .` equivalent from the UI
- Diagnose why a hook might be failing (wrong path, missing env var)
- Re-scaffold stale integration files

**Missing:** Claude integration inspector + scaffold action per project.

---

#### GAP-8: MCP and Hook Visibility — MEDIUM
**Operator job:** "I need to see what MCP tools are exposed to Claude Code. Why is the hook failing?"

No view shows:
- Which MCP servers are registered per project (`.mcp.json` content)
- Which tools are exposed by the Iranti MCP server
- Which hooks are configured and what commands they run
- Whether hook commands are resolving correctly

This is a diagnostic blind spot. Operators who have hook failures have no place to start in the CP.

**Missing:** Per-project MCP + hook visibility view (read-only is sufficient for v1).

---

#### GAP-9: Session Recovery Actions — UNVERIFIED
**Operator job:** "Resume that interrupted session" or "abandon it."

SessionsView exists and shows interrupted sessions. But whether the UI actually supports resume/abandon actions (calling `resumeSession()`/`abandonSession()` via the backend) is unverified. If it is read-only, operators see interrupted sessions but cannot act on them from the CP.

**Action needed:** Verify SessionsView write actions; implement if missing.

---

#### GAP-10: Instance Configure (Interactive Update) — MEDIUM
**Operator job:** "I need to update this instance's database URL" or "change the port."

`iranti configure instance <name>` has no UI equivalent for changing instance env settings. The control plane can start/stop/upgrade instances but cannot reconfigure them (DB URL, port, provider config).

**Missing:** Instance configure panel — edit port, DB URL, provider, provider key per instance.

---

### 4.2 Misleading or Wasted Current Work

None of the current work is wasted — it is all genuinely useful. However, some items have lower operator value than their implementation cost suggests:

- **Relationship Graph (CP-T032)** — Beautiful but not an operator-critical surface. Operators rarely need a visual graph; they need the fact table. Graph view should be discoverable but not prioritized for the next phase.
- **WhoKnows panel (CP-T057)** — Useful for power users, but not a daily operational need. Correct to have it, but should not have displaced key management in priority.
- **Metrics Dashboard (CP-T060)** — Good product direction, but only reaches its value when the KB is populated. New users see an empty chart. Getting onboarding right (GAP-3, GAP-4) would make metrics meaningful faster.

### 4.3 Architectural Drift

**No significant architectural drift detected.** The local web app + Express backend model is the correct choice. The control plane correctly proxies through the Iranti HTTP API and reads env files for configuration.

One architectural note worth flagging: the provider key write path and Iranti client key management require the control plane backend to call **Iranti CLI commands** (like `iranti add api-key`) or write directly to instance env files. The current lifecycle.ts backend already uses the CLI for start/stop (`iranti run --instance <name>`). This CLI-call pattern should be consistently extended for configuration write operations rather than inventing a new direct env-file write mechanism.

---

## 5. Staged Product Plan

### v1 Essential Operator Layer (current state — what exists)

**Observation and monitoring:**
- Health + Diagnostics (complete)
- Staff Activity Stream (complete)
- Staff Logs (complete)
- Version + upgrade status (complete)
- Agent Registry (complete)
- Session Recovery view (complete)

**Memory inspection:**
- Knowledge Base browse + search (complete)
- Archive browse (complete)
- Temporal history (complete)
- Entity detail + relationship view (complete)

**Operator tooling:**
- Chat panel (complete)
- Conflict resolution (complete)
- Setup wizard + Getting Started (complete)

**Instance and project:**
- Instance list + runtime metadata (complete)
- Instance start/stop/upgrade (complete)
- Project binding view (complete)

**Provider:**
- Provider reachability status (complete)

---

### v1.1 Operator Configuration Layer — NEXT PHASE (highest-priority gaps)

This is the phase that completes the operator promise. Operators should be able to manage their Iranti configuration entirely from the control plane after this phase.

**P0: Key Management**
1. Iranti Client API Key Manager (list, create, revoke with scope selection)
2. Provider Key Manager — write path (add, update, remove per provider)
3. Provider Default Configuration — set default provider, set `--set-default` equivalent

**P0: Instance Management Completion**
4. Instance Create — name, port, DB URL, provider selection
5. Instance Configure — update port, DB URL, provider, provider key per existing instance

**P1: Project and Integration Management**
6. Project Binding Create — bind new project to instance
7. Project Rebind — move project to different instance
8. Claude Code Integration Manager — view `.mcp.json` + hooks, scaffold action, re-scaffold action
9. MCP + Hook Visibility — read-only view of registered servers and hook config per project

**P1: Provider Configuration Completion**
10. Provider Fallback Chain — view and configure `LLM_PROVIDER_FALLBACK`
11. Task-Specific Model Routing — view and configure per-task model overrides
12. Session recovery actions — verify and wire resume/abandon if missing

---

### v1.2 Advanced Operator Expansion

**P2: Integration and Tooling**
13. Codex integration manager (register, unregister)
14. Attendant debug tools — manual handshake/attend from UI for memory debugging
15. Uninstall guidance — not one-click delete, but a guided teardown checklist
16. Claude Code scan-mode scaffold — batch re-scaffold across all bound projects

**P2: Visibility Extensions**
17. Machine layout summary — equivalent to `iranti status` showing all instances + runtime state at a glance (currently partial)

---

### Later / Optional

- Multi-instance management from a single CP surface
- Remote instance management (currently local-only)
- Export/import for memory snapshots
- Provider credit visibility (blocked on upstream API availability)

---

## 6. Architecture Recommendation

**Verdict: stay with the current architecture. No change needed.**

Local web app + Express backend is the right call. The evidence:
- All operator jobs can be served through this model
- CLI-call pattern in `lifecycle.ts` is a clean, proven way to delegate configuration changes to the existing CLI surface without rebuilding its logic
- No desktop shell is needed — the browser is sufficient for local-first use
- A Tauri/Electron shell would add distribution and signing complexity without meaningful operator benefit at this stage

The one architectural pattern that must be established clearly for the next phase: **all write operations in the control plane backend must route through Iranti's existing CLI or API, never write directly to env files or DB tables.** This is already stated in the PRD but needs explicit backend implementation patterns for the new configuration management routes.

The preferred implementation pattern for configuration write operations:
1. For instance/project env file mutations: call `iranti configure instance <name>` or write env file with the same merge logic as the CLI uses (read existing, merge updates, write back)
2. For Iranti client API keys: call `iranti auth create-key / revoke-key` or connect to the instance DB using the same `DATABASE_URL` as the running instance
3. For provider keys: write to instance env file using the same key mapping as `iranti add api-key`
4. For integration scaffolding: call `iranti claude-setup .` subprocess or replicate its file-write logic

---

## 7. Concrete Execution Backlog

See `docs/tickets/cp-t085.md` through `cp-t096.md` for the new tickets.

### New Epic: CP-E017 — Operator Configuration Management

**Phase:** 7
**Theme:** Complete the operator promise — write operations for everything that is currently read-only

**Tickets:**
| Ticket | Title | Priority | Phase |
|---|---|---|---|
| CP-T085 | Provider Key Write Path — add, update, remove via UI | P0 | 7 |
| CP-T086 | Provider Default + Fallback Chain Configuration | P0 | 7 |
| CP-T087 | Provider Task-Model Routing Editor | P1 | 7 |
| CP-T088 | Iranti Client API Key Manager — list, create, revoke | P0 | 7 |
| CP-T089 | Instance Create — full creation form from CP | P0 | 7 |
| CP-T090 | Instance Configure — edit env settings per existing instance | P1 | 7 |
| CP-T091 | Project Binding Create + Rebind | P1 | 7 |
| CP-T092 | Claude Code Integration Manager — view + scaffold | P1 | 7 |
| CP-T093 | MCP and Hook Visibility | P1 | 7 |
| CP-T094 | Session Recovery Actions — verify + wire resume/abandon | P1 | 7 |
| CP-T095 | Codex Integration Manager | P2 | 7 |
| CP-T096 | Attendant Debug Tools — manual handshake/attend from UI | P2 | 7 |

---

## 8. Audit Findings Summary

| Finding | Severity | Action |
|---|---|---|
| No Iranti client API key management in CP | Critical | New epic CP-E017, CP-T088 |
| Provider keys are read-only | Critical | CP-T085 |
| No instance creation from CP | Critical | CP-T089 |
| No project binding create/rebind | High | CP-T091 |
| No provider default or model routing config | High | CP-T086, CP-T087 |
| No Claude Code integration manager | Medium-High | CP-T092 |
| No MCP/hook visibility | Medium | CP-T093 |
| Session recovery write actions unverified | Medium | CP-T094 |
| No instance configure (edit env) | Medium | CP-T090 |
| No Codex integration surface | Low-Medium | CP-T095 |
| Conflict resolution write path present | OK | No action |
| Architecture is sound | OK | No change |
| Current observability surfaces are strong | OK | No action |
