# Troubleshooting

This guide covers the most common failures operators encounter running the Iranti Control Plane. Each section lists the symptom, how to diagnose it, and the exact fix.

Before diving into specific sections, run Iranti's built-in diagnostics:

```bash
iranti doctor --debug
```

This checks database connectivity, environment variables, provider keys, and project bindings in one pass and is the fastest way to separate Iranti-level issues from control plane configuration issues.

---

## 1. Instances Not Showing on the Instances Page

**Symptom:** The Instances page (`/instances`) loads but shows an empty list or "No instances found."

**Diagnosis:**

The control plane now prefers `iranti status --json` as the source of truth for instance discovery and runtime classification. It does not trust a directory scan by itself when the CLI is available.

Check the actual upstream view first:

```bash
iranti status --root C:\Users\NF\.iranti-runtime --json
```

If that command shows instances and the control plane does not, the control plane is resolving the wrong runtime root or the CLI itself is not resolving correctly on this machine.

Check:

```bash
# Linux / macOS
ls ~/.iranti-runtime/instances/

# Windows (PowerShell)
Get-ChildItem "$env:USERPROFILE\.iranti-runtime\instances\"
```

Then verify at least one instance has a `.env` file:

```bash
# Linux / macOS
ls ~/.iranti-runtime/instances/local/.env

# Windows (PowerShell)
Get-ChildItem "$env:USERPROFILE\.iranti-runtime\instances\local\.env"
```

**Fix:**

- If `iranti status --json` is empty, the issue is upstream runtime state, not the control plane.
- If `iranti status --json` works but the control plane still shows no instances, verify the control plane can resolve the same CLI that your shell resolves.
- If you launched Iranti with a custom `IRANTI_HOME`, set the same value before starting the control plane so both point at the same runtime root.
- If the runtime root exists but contains incomplete instance directories, complete or recreate the instance instead of relying on the control plane to infer missing config.

Note: missing instances do not prevent the Health dashboard or Memory Explorer from working — they connect directly to the database from the resolved instance env.

---

## 2. Instances Show as Stale or Stopped

**Symptom:** The Instances page shows `STALE` or `STOPPED`, and Doctor recommends restarting the instance.

**Diagnosis:**

This now follows Iranti's runtime classification rules. A stale instance usually means runtime metadata still exists, but the process is gone:

1. `runtime.json` still points at an old PID.
2. The last heartbeat is old.
3. The process is not alive even though metadata says it used to be running.

Confirm with Iranti directly:

```bash
iranti status --root C:\Users\NF\.iranti-runtime --json
iranti doctor --instance <name> --root C:\Users\NF\.iranti-runtime --json
```

**Fix:**

- If the instance should still be running: `iranti instance restart <name>`
- If the instance is intentionally down: the control plane should show `configured` plus `stopped`; no repair is needed.
- If `doctor` reports runtime authority or vector drift issues, fix those upstream and reload the control plane.

---

## 3. Session Recovery Shows No Sessions

**Symptom:** The Sessions page loads, but shows an empty list with a warning that the session API is unavailable.

**Diagnosis:**

The control plane now asks Iranti's real `/memory/sessions` API first. If the bound instance is down or stale, the control plane falls back to local attendant/session facts and reports that fallback explicitly.

Check whether the bound instance is actually reachable:

```bash
iranti status --root C:\Users\NF\.iranti-runtime --json
```

If the selected instance is stale or stopped, the session API is unavailable by definition.

**Fix:**

- Restart the bound instance if you expect live session recovery data.
- If no sessions appear after restart, verify the agents are actually checkpointing through Iranti.
- Treat the fallback note literally: it means the control plane is not looking at live session state right now.

---

## 4. Provider Keys Not Saving

**Symptom:** You enter a provider API key in the Provider Manager UI and click Save. The save appears to succeed, but the Health dashboard still shows the key as missing. Or: the save fails with an error.

**Diagnosis:**

The control plane writes provider keys to the instance env file at the path given by `IRANTI_INSTANCE_ENV` in `.env.iranti`. Two things can go wrong:

1. **`IRANTI_INSTANCE_ENV` is not set or is wrong.** The control plane doesn't know where to write and falls back to `.env.iranti`, where provider keys have no effect.
2. **The instance env file does not exist.** The control plane cannot create a file from scratch — it can only update one that already exists.

Check your `.env.iranti`:

```dotenv
IRANTI_INSTANCE_ENV=C:\Users\NF\.iranti-runtime\instances\local\.env
```

Then confirm the file at that path exists:

```bash
# Linux / macOS
cat ~/.iranti-runtime/instances/local/.env

# Windows (PowerShell)
Get-Content "$env:USERPROFILE\.iranti-runtime\instances\local\.env"
```

**Fix:**

- If `IRANTI_INSTANCE_ENV` is missing from `.env.iranti`: add it pointing at the correct instance env path, then restart the control plane.
- If the instance env file does not exist: run `iranti instance create <name> ...` or `iranti setup` to create it, or manually create it with the minimum required keys (`DATABASE_URL`, `IRANTI_PORT`, `IRANTI_INSTANCE_NAME`) and then add provider keys via the UI.
- If `IRANTI_INSTANCE_ENV` points at `.env.iranti` itself: this is a misconfiguration. `.env.iranti` is a binding pointer, not a runtime config file. Provider keys written there have no effect.

After fixing the path, re-enter the key in the Provider Manager and verify the Health dashboard shows the key as present.

---

## 4A. Instance Create or Configure Does the Wrong Thing

**Symptom:** Creating or reconfiguring an instance from the Instance Manager appears to target the wrong runtime root, or the success message leaves you unsure what to do next.

**Diagnosis:**

The control plane now resolves the target runtime root the same way the rest of the audited integration layer does:

1. explicit `IRANTI_HOME`
2. bound `IRANTI_INSTANCE_ENV`
3. discovered runtime roots near the current project and under the home directory

The actual create/configure mutation is delegated to the current Iranti CLI. That means the control plane should now behave like:

```bash
iranti instance create <name> ...
iranti configure instance <name> ...
```

Check the runtime root and resulting instance files directly:

```bash
iranti status --root C:\Users\NF\.iranti-runtime --json
Get-Content "$env:USERPROFILE\.iranti-runtime\instances\<name>\.env"
```

**Fix:**

- If the wrong runtime root was chosen, set `IRANTI_HOME` before starting the control plane.
- After create, treat `iranti instance show <name>` and `iranti run --instance <name>` as the primary next steps.
- After configure, use the new restart action in the control plane or run `iranti instance restart <name>` manually.
- `ollama` does not take a provider API key in this flow. Configure its base URL separately in the instance env if needed.

Operator note:

- The **Create Instance** form no longer requires a hand-typed PostgreSQL URL. Use **Build from parts** to compose `DATABASE_URL` from host, port, database name, username, and password.
- When you are binding a project, prefer the native **Browse…** button so the control plane gets the exact absolute folder path instead of a manually typed guess.

---

## 4B. Codex Integration Says "Not Registered" Even Though `iranti codex-setup` Works

**Symptom:** The Codex Integration panel says Iranti is not registered, or the Register button fails even though running `iranti codex-setup` manually in the terminal succeeds.

**Diagnosis:**

On current Codex installs, MCP registration truth should come from the live Codex CLI:

```bash
codex mcp get iranti --json
```

Do not treat missing legacy files like `~/.codex/config.json` or `~/.codex/mcp.json` as proof that Codex is unconfigured. Current installs may use different config surfaces, and the control plane now follows `codex mcp get` instead.

Also verify that the control plane has been restarted after a control-plane upgrade or rebuild. A long-running server process can still be serving old route logic even if the source code is fixed.

**Fix:**

- If `codex mcp get iranti --json` succeeds, refresh the Instances page. The Codex Integration panel should report Iranti as registered.
- If `iranti codex-setup` works in the terminal but the panel still fails, restart the control-plane server so it picks up the current backend code.
- If `codex mcp get iranti --json` says no server named `iranti`, run:

```bash
iranti codex-setup
```

Then refresh the Instances page again.

---

## 5. "staff_events Table Not Found" Warning

**Symptom:** The Health dashboard shows a `warn` status for the `staff_events` table. The Staff Activity Stream shows "migration not applied."

**Diagnosis:**

The `staff_events` table is added by a control plane migration. It is not part of the core Iranti schema. The migration must be applied once before the Activity Stream and Staff Logs views are functional.

As of v0.7.0, the migration runs automatically on control plane startup. If you see this warning, the auto-migration did not complete — usually because `DATABASE_URL` was not yet resolvable at startup time, or the control plane was started before the database was ready.

**Fix:**

1. Restart the control plane. The migration runs on startup and will retry.
2. If the warning persists after a restart, run the migration manually:

```bash
cd src/server
npm run migrate
```

This is a one-time operation. If the table already exists the migration is a no-op — it is safe to run repeatedly.

Note: `npm run migrate` must be run from `src/server/`, not from the project root.

Where available, the Health dashboard now renders that migration command as a command action with **Copy** and **Run**. If the UI only shows **Copy**, the control plane is intentionally refusing to execute that command automatically.

---

## 6. "Default Provider Is Set to 'anthropic'" Warning

**Symptom:** The Health dashboard shows a warning: `'anthropic' is not a valid value for LLM_PROVIDER`.

**Diagnosis:**

`anthropic` is not a valid value for `LLM_PROVIDER`. The correct value for the Anthropic Claude provider is `claude`. The value `anthropic` will cause Iranti's provider routing to fail silently.

**Fix:**

Open the instance env at `~/.iranti-runtime/instances/<name>/.env` and change:

```dotenv
# Wrong
LLM_PROVIDER=anthropic

# Correct
LLM_PROVIDER=claude
```

Then restart the Iranti instance. The control plane will pick up the updated value on the next Health dashboard load or diagnostics run.

---

## 7. Control Plane Won't Start

**Symptom:** Running `iranti-cp` (npm global install) or `npm run dev` (from source) exits immediately or hangs without serving requests.

**Diagnosis and fixes by cause:**

**Port conflict:**

The control plane tries ports 3000–3010 (npm global) or defaults to 3002 (from source). If all are occupied:

```bash
# Find what is on port 3002
# Linux / macOS
lsof -i :3002

# Windows (PowerShell)
netstat -ano | findstr :3002
```

Stop the conflicting process or change the port:

```bash
CONTROL_PLANE_PORT=3005 iranti-cp
```

**DATABASE_URL not resolvable:**

The control plane reads `DATABASE_URL` from the instance env. If `IRANTI_INSTANCE_ENV` is not set, or the file it points to does not contain `DATABASE_URL`, the server exits at startup.

Verify the chain: `.env.iranti` → `IRANTI_INSTANCE_ENV` → instance env → `DATABASE_URL`.

**Node version too old:**

The control plane requires Node.js 18 or later.

```bash
node --version
```

If you see v16 or earlier, upgrade via [nvm](https://github.com/nvm-sh/nvm) or download from [nodejs.org](https://nodejs.org).

**Dependencies not installed:**

If running from source, `npm install` at the root only installs `concurrently`. You must also install server and client dependencies:

```bash
npm run setup
```

This runs `npm install` in both `src/server/` and `src/client/`.

---

## 8. DB Unreachable in Health Dashboard

**Symptom:** The Health dashboard shows `error` for the `DB Reachability` check.

**Diagnosis:**

The control plane cannot connect to PostgreSQL. This blocks all data views — Memory Explorer, Archive, Staff Logs, etc.

Check:

1. Is PostgreSQL running?

```bash
pg_isready -h localhost -p 5432
```

If this returns `no response`, PostgreSQL is stopped. If you use Docker:

```bash
docker start iranti_db
```

2. Does `DATABASE_URL` in the instance env match the actual connection?

```bash
# Show current DATABASE_URL (Linux / macOS)
grep DATABASE_URL ~/.iranti-runtime/instances/local/.env
```

A common mismatch: database name `iranti` vs `iranti_dev`, or port `5432` vs a custom port.

3. Does the PostgreSQL user have `SELECT` access to the database?

```bash
psql postgresql://postgres@localhost:5432/iranti -c "SELECT 1;"
```

**Fix:**

- Start PostgreSQL if it isn't running.
- Correct `DATABASE_URL` in the instance env to match the running PostgreSQL connection.
- Grant the database user read access if the permissions check fails.

After fixing, restart the control plane or reload the Health dashboard — the DB check runs on each page load.

---

## 8. Provider API Key Shows as Missing in Health

**Symptom:** The Health dashboard shows `warn` for `Claude Key` or `OpenAI Key` even after you've set the key.

**Diagnosis:**

This almost always means the key was written to the wrong file. The Health dashboard reads provider keys from the instance env (via `IRANTI_INSTANCE_ENV`). Keys placed in `.env.iranti` are not read.

Confirm where the key actually landed:

```bash
# Check instance env (correct location)
grep ANTHROPIC_API_KEY ~/.iranti-runtime/instances/local/.env

# Check project binding file (wrong location — should return nothing)
grep ANTHROPIC_API_KEY .env.iranti
```

Also confirm that `LLM_PROVIDER` is set correctly in the instance env:

- For Claude: `LLM_PROVIDER=claude` (not `anthropic`)
- For OpenAI: `LLM_PROVIDER=openai`

The Health dashboard only raises a warning for the key corresponding to the active provider. If `LLM_PROVIDER=claude`, it checks `ANTHROPIC_API_KEY`. If `LLM_PROVIDER=openai`, it checks `OPENAI_API_KEY`.

**Fix:**

Move the key to the instance env. Either:

- Use the Provider Manager UI (`/providers`) — it writes to the correct file automatically as long as `IRANTI_INSTANCE_ENV` is properly set.
- Or edit the instance env directly and add the key under `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.

Remove any duplicate keys from `.env.iranti` — they serve no purpose there and create confusion.

Reload the Health dashboard after saving. The key check reruns on each load.
