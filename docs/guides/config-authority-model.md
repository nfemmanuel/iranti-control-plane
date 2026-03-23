# Configuration Authority Model

## Two Files, Two Different Purposes

Every Iranti setup involves two configuration files. They are not interchangeable and they do not overlap. Getting this wrong is the single most common source of operator confusion.

| File | Role | Location |
|---|---|---|
| `.env.iranti` | Project binding pointer | Your project root |
| Instance `.env` | Runtime authority | `~/.iranti-runtime/instances/<name>/.env` |

The `.env.iranti` file tells the control plane **which** Iranti instance to connect to. The instance `.env` file tells Iranti **how** to run — which database, which provider, which API keys.

---

## The Project Binding File — `.env.iranti`

This file lives in the root of whatever project is connected to Iranti. It is a connector, not a config source. Think of it as a bookmark pointing at an instance.

**What goes here:**

```dotenv
IRANTI_URL=http://localhost:3001
IRANTI_API_KEY=iranti-local-key-abc123
IRANTI_AGENT_ID=my_agent
IRANTI_INSTANCE=local
IRANTI_INSTANCE_ENV=C:\Users\NF\.iranti-runtime\instances\local\.env
```

`IRANTI_INSTANCE_ENV` is the most important field. It is the path to the real config file — the instance env. The control plane follows this path to find authoritative runtime configuration.

**What does NOT go here:**

- `LLM_PROVIDER`
- `LLM_PROVIDER_FALLBACK`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `DATABASE_URL`
- `IRANTI_PORT`

Placing these in `.env.iranti` has no effect. The control plane does not read them from here. Iranti does not read them from here. They will be silently ignored.

---

## The Instance Env File — Runtime Authority

This file is created by `iranti init` and lives under the Iranti runtime root. It is the authoritative source for everything the running Iranti process needs.

**Where it lives:**

- Linux / macOS: `~/.iranti-runtime/instances/<name>/.env`
- Windows: `C:\Users\<user>\.iranti-runtime\instances\<name>\.env`

**What goes here:**

```dotenv
IRANTI_INSTANCE_NAME=local
IRANTI_PORT=3001
DATABASE_URL=postgresql://postgres@localhost:5432/iranti
LLM_PROVIDER=claude
LLM_PROVIDER_FALLBACK=openai
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
OPENAI_API_KEY=sk-proj-xxxxx
IRANTI_API_KEY=iranti-local-key-abc123
```

**The complete list of keys that belong here and nowhere else:**

| Key | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string for the instance |
| `IRANTI_PORT` | Port the Iranti HTTP server listens on |
| `IRANTI_INSTANCE_NAME` | Human-readable name (matches directory name) |
| `IRANTI_API_KEY` | API key clients use to authenticate with this instance |
| `LLM_PROVIDER` | Active provider: `claude` or `openai` (not `anthropic`) |
| `LLM_PROVIDER_FALLBACK` | Fallback provider when primary is unavailable |
| `ANTHROPIC_API_KEY` | Key used when `LLM_PROVIDER=claude` |
| `OPENAI_API_KEY` | Key used when `LLM_PROVIDER=openai` |

---

## Why the Separation Exists

A single Iranti instance can be shared across multiple projects. Each project has its own `.env.iranti` binding file, all pointing at the same instance env.

```
project-alpha/.env.iranti  →  ~/.iranti-runtime/instances/local/.env
project-beta/.env.iranti   →  ~/.iranti-runtime/instances/local/.env
project-gamma/.env.iranti  →  ~/.iranti-runtime/instances/local/.env
```

If provider API keys lived in `.env.iranti`, you would have to duplicate them across every project and keep them in sync manually. Instead, keys live in one place — the instance env — and all projects share the same source of truth.

The separation also means project repositories can safely commit `.env.iranti` without exposing credentials. The binding file contains only a URL, a public agent ID, and a local filesystem path. The instance env, which contains secrets, stays outside any project directory.

---

## How the Control Plane Resolves Config

When the control plane needs to read runtime config (e.g., to check which provider is active, or to display the Health dashboard), it follows this chain:

1. Read `IRANTI_INSTANCE_ENV` from `.env.iranti` in the project root.
2. Load the file at that path — the instance env.
3. Read `LLM_PROVIDER`, `DATABASE_URL`, `ANTHROPIC_API_KEY`, etc. from the instance env.

If `IRANTI_INSTANCE_ENV` is not set or the file it points to does not exist, the control plane falls back to searching for `.env.iranti` in the project root and reading what it can from there. This fallback exists only as a last resort — it will not find provider keys or `DATABASE_URL` because those do not belong in `.env.iranti`.

When you change a provider key in the **Provider Manager** UI, the control plane writes the new value to the instance env file at the path from `IRANTI_INSTANCE_ENV`. It does not write to `.env.iranti`.

---

## Common Mistakes

| What the operator did | What actually happens | Fix |
|---|---|---|
| Added `ANTHROPIC_API_KEY` to `.env.iranti` | Key is silently ignored; Health dashboard still shows key as missing | Move the key to `~/.iranti-runtime/instances/<name>/.env` |
| Added `DATABASE_URL` to `.env.iranti` | Control plane cannot find the database; connection errors at startup | Add `DATABASE_URL` to the instance env; ensure `IRANTI_INSTANCE_ENV` points there |
| Set `LLM_PROVIDER=anthropic` in instance env | Health check emits a warning: `'anthropic' is not a valid provider` | Change to `LLM_PROVIDER=claude` |
| Set `IRANTI_INSTANCE_ENV` to a path that does not exist | Provider key writes fail silently; Health shows stale or empty config | Create the instance env file or correct the path in `.env.iranti` |
| Copied provider key from instance env into project `.env.iranti` | Key works in neither place; instance still reads from instance env | Remove from `.env.iranti`; the instance env copy is what Iranti actually reads |
| Did not set `IRANTI_INSTANCE_ENV` at all | Control plane falls back to `.env.iranti` lookup; no provider keys found | Add `IRANTI_INSTANCE_ENV=<path>` to `.env.iranti` |

---

## Quick Reference: Which File for Which Key

| Key | `.env.iranti` | Instance `.env` |
|---|---|---|
| `IRANTI_URL` | Yes | No |
| `IRANTI_API_KEY` | Yes (as a client credential) | Yes (as the server-side key) |
| `IRANTI_AGENT_ID` | Yes | No |
| `IRANTI_INSTANCE` | Yes | No |
| `IRANTI_INSTANCE_ENV` | Yes — this is the pointer | No |
| `DATABASE_URL` | **No** | **Yes** |
| `IRANTI_PORT` | No | Yes |
| `LLM_PROVIDER` | **No** | **Yes** |
| `LLM_PROVIDER_FALLBACK` | **No** | **Yes** |
| `ANTHROPIC_API_KEY` | **No** | **Yes** |
| `OPENAI_API_KEY` | **No** | **Yes** |
| `IRANTI_INSTANCE_NAME` | No | Yes |

---

## Verifying the Correct File is Being Used

Open the **Health dashboard** at `/health` and run **Interactive Diagnostics** ("Run Diagnostics" button). The diagnostics panel shows the resolved `scope` object — the instance name, base URL, and which config path the control plane is actually reading from.

If the scope shows the wrong instance or an empty provider, check:

1. Does `IRANTI_INSTANCE_ENV` in `.env.iranti` point at the right path?
2. Does that file exist and contain the expected keys?

You can also verify directly by inspecting the instance env file:

```bash
# Linux / macOS
cat ~/.iranti-runtime/instances/local/.env

# Windows (PowerShell)
Get-Content "$env:USERPROFILE\.iranti-runtime\instances\local\.env"
```

If the file contains `ANTHROPIC_API_KEY` and `LLM_PROVIDER=claude`, the Health dashboard should reflect those values within one reload. If it does not, confirm that `IRANTI_INSTANCE_ENV` in `.env.iranti` points at the correct path.
