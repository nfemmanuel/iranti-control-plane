# WORKFLOW_MATRIX.md — Operator Workflow Coverage

**Updated:** 2026-04-02

---

## Authority Model Summary

| Config Layer | What It Is | What It Controls | Who Writes It |
|---|---|---|---|
| **Instance env** (`~/.iranti-runtime/instances/<name>/.env`) | Live instance config | `DATABASE_URL`, `LLM_PROVIDER`, provider API keys, `IRANTI_PORT`, `IRANTI_API_KEY` | Iranti CLI (`iranti run`, `iranti add api-key`) |
| **Project binding** (`.env.iranti` in project dir) | Connector pointer | `IRANTI_URL`, `IRANTI_API_KEY`, `IRANTI_INSTANCE`, `IRANTI_INSTANCE_ENV` | Iranti CLI (`iranti project init` / `iranti configure project`) / control plane |
| **Runtime metadata** (`runtime.json`) | Process state | PID, port, heartbeat, version, status | Iranti runtime process |
| **Instance registry** (`instance.json`) | Static instance info | Name, created-at, port config | Iranti CLI (`iranti setup` / `iranti instance create`) |
| **Control plane env** (loaded at startup) | Merged view | Union of binding + instance env | Read-only by control plane |

**Rule:** Provider keys and runtime config MUST be written to the instance env, not the project binding. The control plane enforces this via `IRANTI_INSTANCE_ENV`.

---

## Operator Workflow Matrix

| Workflow | UI Surface | Backend Route(s) | CLI Equivalent | Config Authority | Status |
|---|---|---|---|---|---|
| **Install/Bootstrap** | Getting Started | `/instances/:id/setup-status` | `iranti setup` | Instance env | ✅ TEST-COVERED — setup-status routes are covered; action wording still needs UX polish |
| **Instance Discovery** | Instances list | `GET /instances` | `iranti list` | Instance env + runtime.json | ✅ WORKING (dev) / ❌ BROKEN (dist) |
| **Instance Create** | Instances > Create | `POST /instances` | `iranti instance create <name>` | Instance env | ✅ TEST-COVERED — route behavior covered in server unit tests |
| **Instance Configure** | Instances > Configure | `PATCH /instances/:name` | `iranti configure instance <name>` | Instance env | ✅ TEST-COVERED — route behavior covered in server unit tests |
| **Instance Start** | Instances > Start | `POST /instances/:name/start` | `iranti run --instance <n>` | Runtime | ✅ TEST-COVERED — lifecycle route behavior is covered in server unit tests |
| **Instance Stop** | Instances > Stop | `POST /instances/:name/stop` | `iranti stop --instance <n>` | Runtime | ✅ TEST-COVERED — lifecycle route behavior is covered in server unit tests |
| **Instance Doctor** | Instances > Doctor | `POST /instances/:id/doctor` | `iranti doctor --instance <n>` | Live runtime | ✅ TEST-COVERED — doctor + repair action wiring covered in server unit tests |
| **Repair MCP** | Instances > Repair | `POST /instances/:id/repair/mcp-json` | `iranti claude-setup [path]` / `iranti codex-setup --project-env <path>` | Project binding | ✅ TEST-COVERED — repair route behavior covered in server unit tests |
| **Repair CLAUDE.md** | Instances > Repair | `POST /instances/:id/repair/claude-md` | Manual | Project dir | ✅ TEST-COVERED — repair route behavior covered in server unit tests |
| **Project Binding** | Instances > Projects | `GET/POST/PATCH /instances/:id/projects` | `iranti project init [path]` / `iranti configure project [path]` | Project binding | ✅ TEST-COVERED — bind, rebind, list, and unbind route behavior are covered in server unit tests |
| **Provider Setup** | Providers | `GET /providers` | `iranti add api-key <p>` | Instance env | ✅ READ WORKING |
| **Provider Key Add** | Providers > Add Key | `PUT /providers/:id/key` | `iranti add api-key <p>` | Instance env | ⚠️ UNTESTED LIVE |
| **Provider Key Remove** | Providers > Remove | `DELETE /providers/:id/key` | `iranti remove api-key <p>` | Instance env | ⚠️ UNTESTED LIVE |
| **Default Provider** | Providers | `PUT /providers/default` | `iranti configure instance <name> --provider <name>` | Instance env | ⚠️ UNTESTED LIVE |
| **Fallback Chain** | Providers | `PUT /providers/fallback` | `iranti configure instance <name> --interactive` | Instance env | ⚠️ UNTESTED LIVE |
| **Task Routing** | Providers > Routing | `PUT /providers/task-routing` | Manual instance env edit / `iranti configure instance <name> --interactive` | Instance env | ⚠️ UNTESTED LIVE |
| **Health Check** | Health | `GET /health` | `iranti doctor` | Live runtime | ✅ WORKING |
| **Diagnostics** | Health > Run | `POST /diagnostics/run` | `iranti doctor --instance <n>` | Live runtime | ✅ WORKING |
| **Memory Browse** | Memory | `GET /kb` | — | Knowledge base | ✅ WORKING |
| **Archive Browse** | Archive | `GET /archive` | — | Knowledge base | ⚠️ Row-click unverified |
| **Agent Registry** | Agents | `GET /agents` | — | Knowledge base | ⚠️ Recently fixed (crash on missing stats) |
| **Session Recovery** | Sessions | `GET /sessions` | — | Knowledge base | ⚠️ Partially fixed |
| **Conflict Review** | Conflicts | `GET /escalations` | — | Escalation files | ✅ WORKING (empty state) |
| **Staff Activity** | Activity | SSE `/events` | — | CP-local staff_events | ⚠️ Depends on optional staff_events |
| **Staff Logs** | Logs | `GET /logs` | — | CP-local staff_events | ⚠️ Depends on optional staff_events |
| **Metrics** | Metrics | `GET /metrics/summary` | — | Knowledge base | ✅ IMPROVED (KB fallback) |
| **Overview** | Overview | `GET /overview` | — | Knowledge base | ✅ IMPROVED (KB fallback) |
| **Upgrade** | Instances > Upgrade | `POST /instances/:name/upgrade` | `npm install -g iranti-control-plane` | System | ⚠️ UNTESTED LIVE |
| **Auth Keys** | Instances > API Keys | `GET/POST/DELETE /auth-keys` | `iranti add api-key` | Iranti registry | ✅ TEST-COVERED — GET/POST/DELETE route behavior is covered in server unit tests |
| **Claude Integration** | Instances > Projects | `GET/POST .../claude-integration` | `iranti claude-setup` | Project dir | ✅ TEST-COVERED — status, scaffold, and summary route behavior are covered in server unit tests |
| **Codex Integration** | Integrations | `GET/POST/DELETE /integrations/codex` | `iranti codex-setup` | Codex config | ✅ TEST-COVERED — GET/POST/DELETE route behavior is covered in server unit tests |

---

## Workflow: Instance Discovery

**Precondition:** Iranti runtime root exists at `~/.iranti-runtime`

**What the UI does:**
1. Calls `GET /api/control-plane/instances`
2. Backend reads `~/.iranti-runtime/install.json` and scans `~/.iranti-runtime/instances/*/`
3. For each instance dir: reads `instance.json`, `.env`, `runtime.json`
4. Returns aggregated metadata including running status, setup state, provider config

**What the CLI does:** `iranti list`

**Config authority:** Instance env at `~/.iranti-runtime/instances/<name>/.env`

**Success state:** List shows all instances with correct running/stopped/incomplete states

**Failure states:**
- "No instances found" — runtime root doesn't exist or has no instances
- Instance shows "Needs setup" — instance dir exists but `.env` is missing required keys
- Instance shows "unreachable" — instance process is stopped or on unexpected port

**Fallback command if UI cannot perform action:** `iranti list`

---

## Workflow: Provider Key Management

**Precondition:** Instance is configured with `IRANTI_INSTANCE_ENV`

**What the UI does:**
1. Reads current provider state from `GET /providers`
2. To set a key: `PUT /providers/:provider/key` with `{ key: "..." }`
3. Backend validates key is not a placeholder
4. Backend writes to `IRANTI_INSTANCE_ENV` (the authoritative instance env)
5. Returns masked confirmation

**What the CLI does:** `iranti add api-key openai` (interactive), or set manually in instance .env

**Config authority:** Instance env at `~/.iranti-runtime/instances/<name>/.env`

**⚠️ REQUIRES RESTART** after key changes for the running Iranti process to pick up the new key

**Fallback command:** Manually edit `~/.iranti-runtime/instances/<name>/.env` and restart

---

## Workflow: Instance Lifecycle (Start/Stop)

**What the UI does:**
1. `POST /instances/:name/start` → backend spawns `iranti run --instance <name>` as detached process
2. `POST /instances/:name/stop` → backend sends SIGTERM to tracked PID

**⚠️ LIMITATION:** PID tracking is in-memory only. Restarting the control plane clears tracked PIDs. If the control plane restarts, Stop will not work for previously-started instances.

**Fallback command:**
- Start: `iranti run --instance <name>`
- Stop: `iranti stop --instance <name>` (if CLI supports it) or kill the PID directly

**Config authority:** Instance env (defines port, DB, etc.)

---

## Known Operator Confusion Points

1. **Two env files**: `.env.iranti` (project binding pointer) vs `~/.iranti-runtime/instances/<name>/.env` (runtime truth). Changes must go to the instance env, not the project binding.
2. **Port conflicts**: The control plane and Iranti runtime both start on port 3000+. If Iranti stops, the control plane may take its port on next restart, causing the health probe to show "unreachable" misleadingly.
3. **Restart required**: Provider config changes take effect only after restarting the Iranti process, not the control plane.
4. **In-memory PID tracking**: The control plane can only stop instances it started in its current process lifetime.
