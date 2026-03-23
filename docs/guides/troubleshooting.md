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

The control plane discovers instances by scanning `~/.iranti-runtime/instances/*/`. It treats each subdirectory that contains a `.env` file as an instance. If that directory tree doesn't exist or is empty, no instances are found.

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

- If `~/.iranti-runtime/instances/` doesn't exist, Iranti has not been initialized on this machine. Run `iranti init` to create a local instance.
- If the directory exists but is empty, the instance was removed or the runtime root was relocated. Re-run `iranti init` or restore the instance directory.
- If the directory contains subdirectories but they have no `.env` file, the instance setup is incomplete. Check the Iranti installation for that instance.
- If you launched Iranti with a custom `IRANTI_HOME`, set the same value before starting the control plane so discovery points at the right runtime root.

Note: missing instances do not prevent the Health dashboard or Memory Explorer from working — they connect directly to the database from the resolved instance env.

---

## 2. Health Shows "Runtime Unreachable"

**Symptom:** The Health dashboard shows the Iranti runtime check as `error` with "runtime unreachable" or a connection refused message.

**Diagnosis:**

This check pings the Iranti HTTP API at the URL derived from the instance env (`IRANTI_PORT`). "Unreachable" has three distinct causes:

1. **Iranti is stopped.** The Iranti process isn't running. This is expected if you haven't started Iranti — the control plane can still show DB health, provider config, and other checks.
2. **Port mismatch.** Iranti is running but on a different port than the control plane expects.
3. **Config wrong.** `IRANTI_PORT` in the instance env doesn't match the port Iranti was actually started on.

Check whether Iranti is running:

```bash
# Linux / macOS
curl http://localhost:3001/health

# Windows (PowerShell)
Invoke-WebRequest http://localhost:3001/health
```

If that succeeds, check what port the control plane is reading:

- Open the Health dashboard and run Interactive Diagnostics. The `scope.apiBaseUrl` field shows the URL the control plane is trying to reach.
- Compare it to the running Iranti process. If they don't match, `IRANTI_PORT` in the instance env is wrong.

**Fix:**

- If Iranti is stopped: start it (`iranti start` or your usual start method). The health check will auto-resolve.
- If there is a port mismatch: correct `IRANTI_PORT` in `~/.iranti-runtime/instances/<name>/.env` to match the port Iranti is actually listening on, then restart the control plane.
- If you are intentionally running Iranti on a non-default port, confirm `IRANTI_PORT` is set correctly in the instance env — not in `.env.iranti`.

---

## 3. Provider Keys Not Saving

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
- If the instance env file does not exist: run `iranti init` to create it, or manually create it with the minimum required keys (`DATABASE_URL`, `IRANTI_PORT`, `IRANTI_INSTANCE_NAME`) and then add provider keys via the UI.
- If `IRANTI_INSTANCE_ENV` points at `.env.iranti` itself: this is a misconfiguration. `.env.iranti` is a binding pointer, not a runtime config file. Provider keys written there have no effect.

After fixing the path, re-enter the key in the Provider Manager and verify the Health dashboard shows the key as present.

---

## 4. "staff_events Table Not Found" Warning

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

---

## 5. "Default Provider Is Set to 'anthropic'" Warning

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

## 6. Control Plane Won't Start

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

## 7. DB Unreachable in Health Dashboard

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
