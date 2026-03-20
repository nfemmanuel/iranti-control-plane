# CP-T023 — CLI Setup Wizard Design Spec

**Ticket:** CP-T023 — Build CLI Setup Wizard (`iranti setup`)
**Author:** devops_engineer
**Date:** 2026-03-20
**Status:** Design Spike — Spec Only (No Implementation)
**Gates:** Requires PM acceptance before implementation begins

---

## 1. Entry Point Decision

### Finding: `iranti setup` already exists as a first-class CLI command

The Iranti CLI (`npm install -g iranti`, currently at v0.2.9) already registers `iranti setup` as a built-in subcommand. The command is implemented in `dist/scripts/iranti-cli.js` as `setupCommand()` at approximately line 2025. It is dispatched from the main CLI switch and uses `readline/promises` (Node.js built-in) for interactive prompting.

The existing `iranti setup` command:
- Creates or configures an instance (`shared` or `isolated` scope)
- Constructs DATABASE_URL from individual prompts (host, port, user, password, db name)
- Runs bootstrap and migration
- Supports `--config <file>`, `--defaults`, `--db-url`, `--bootstrap-db`, `--scope` flags
- Writes per-instance `instance.json` to `~/.iranti/instances/<name>/`
- Writes an `install.json` at `~/.iranti/install.json` tracking version, scope, root, installedAt

The existing command does **not** cover:
- Provider API key entry (covered by `iranti add api-key`)
- MCP registration (covered by `iranti claude-setup`)
- Project binding (covered by `iranti project init` and `iranti configure project`)
- pgvector check and guided remediation
- Final health verification (`iranti doctor` equivalent integration)
- Unified 5-section wizard flow as specified in CP-T023

### Recommended approach

**Extend the existing `iranti setup` command** rather than creating a standalone package. The entry point exists; the scope of CP-T023 is to make that command more complete and guided.

**Rationale:**
1. `iranti setup` is already the user-facing name in all documentation and help text. Creating a parallel `npx iranti-setup` package would introduce two overlapping entry points.
2. The current implementation is procedural Node.js (no heavy framework), making it feasible to extend with `@clack/prompts` without restructuring.
3. The instance registry format (`~/.iranti/instances/<name>/instance.json` and `~/.iranti/install.json`) is already established. The wizard must write to these files in the format the existing CLI expects — not invent a new `instances.json` format that conflicts.

**Required upstream change:** The wizard additions must be implemented as a contribution to the upstream `iranti` package. This means:
- The devops_engineer (or backend_developer) must open an upstream PR to the `nfemmanuel/iranti` repository
- Or the PM must decide that Phase 2 will ship a forked/wrapper CLI for the control plane installer only

**Flag for PM (Open Question 1):** Is modifying the upstream `iranti` package in scope for this team? If not, is `npx iranti-control-plane-setup` acceptable as a standalone installer that wraps/supplements `iranti setup`?

**Fallback entry point (if upstream modification is not approved):** A standalone script at `scripts/wizard.js` in this repo, runnable as `npx . setup` from the control plane directory, or published as `iranti-cp-setup` with `npx iranti-cp-setup`.

---

## 2. Wizard Step Sequence (macOS)

### Architecture overview

The wizard runs as a single Node.js process. It is structured as sequential `@clack/prompts` groups (visual section headers with inline step status). The wizard maintains a `WizardState` object that accumulates configuration across sections before any writes occur.

Ctrl+C is handled globally with `process.on('SIGINT')`. On cancel: display "Setup cancelled. Run `iranti setup` to continue." and exit cleanly with code 130. No partial writes occur if cancelled before the explicit write-confirm prompt in each section.

A verbose log is written to `~/.iranti/setup-log-<timestamp>.txt` after every run. The log collects stdout lines but strips any values entered at secret prompts.

---

### Section 1: System Checks

**Purpose:** Gate-check the environment before collecting any configuration. Do not proceed if critical requirements are not met.

**Steps:**

**1.1 — Node.js version check**
- Read `process.version`
- Minimum: v18.0.0 (from Iranti's `engines.node` field or documented minimum)
- On pass: green check, show detected version
- On fail: show current version, required minimum, and: `nvm install 18 && nvm use 18`. Mark as **blocker** — cannot continue.

**1.2 — macOS version check (macOS only)**
- `sw_vers -productVersion` parsed to major version
- Minimum: macOS 12 (Monterey)
- On pass: green check
- On fail below macOS 12: amber warning, do not block. Show "Iranti is supported on macOS 12+. Older versions may work but are not tested."
- On non-macOS: skip this check silently; Windows and Linux have their own flows (see Section 5).

**1.3 — PostgreSQL service check**
- Run `pg_isready -h localhost -p 5432` (configurable port — default 5432 but overridable in Section 2)
- If `pg_isready` is not on PATH: detect whether `psql` is on PATH as fallback. If neither: attempt to detect PostgreSQL via common Homebrew paths (`/opt/homebrew/bin/pg_isready`, `/usr/local/bin/pg_isready`).
- On pass: green check, show PostgreSQL version from `psql --version`
- On "not on PATH" (Homebrew PostgreSQL installed but not on PATH):
  ```
  [WARN] PostgreSQL tools not on PATH.
  Add this to ~/.zshrc:
    export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
  Then run: source ~/.zshrc
  ```
  Offer retry after user acknowledges fix.
- On "connection refused" (service not running):
  ```
  [WARN] PostgreSQL is installed but not running.
  Start it with: brew services start postgresql@16
  ```
  Offer to retry (user confirms they've started it). Mark as **blocker** — cannot proceed to Section 2 without PostgreSQL reachable.
- On not installed:
  ```
  [FAIL] PostgreSQL not found.
  Install with: brew install postgresql@16
  Then start:   brew services start postgresql@16
  ```
  Mark as **blocker**.

**1.4 — pgvector check (deferred until after DATABASE_URL is established)**
- Note: pgvector can only be checked against a specific database. This check is deferred to Section 2, step 2.3, after the database connection is validated.
- During Section 1, display: "pgvector check deferred — will run after database connection is confirmed."

**Section 1 outcome states:**
- All pass: proceed to Section 2 automatically
- One or more blockers: show summary of what failed. Offer retry or exit.

---

### Section 2: Database Setup

**Purpose:** Construct a valid DATABASE_URL interactively, create the database if needed, check pgvector, run migrations, and write the env file.

**Steps:**

**2.1 — DATABASE_URL construction wizard**

Individual prompts with defaults shown:

| Prompt | Default | Validation |
|--------|---------|------------|
| PostgreSQL host | `localhost` | non-empty |
| PostgreSQL port | `5432` | integer 1–65535 |
| Database name | `iranti` | alphanumeric, underscores, hyphens only |
| Username | result of `whoami` | non-empty |
| Password | (empty — hidden input, no echo) | none required |

After all fields are entered:
- Construct and display the resulting DATABASE_URL (mask the password as `***` in the display)
- Prompt: "Use this connection string? [Y/n]"
- On confirm: attempt a test connection using `pg` client `new Client(url).connect()`. On success: green check. On failure: show the PostgreSQL error message + which field is most likely wrong (port error → check port, auth error → check username/password, database does not exist → offer to create it in 2.2).

**2.2 — Database creation (if database does not exist)**
- If the test connection fails with "database does not exist":
  - Prompt: "Database `iranti` does not exist. Create it now? [Y/n]"
  - On yes: run `createdb -h {host} -p {port} -U {user} {dbname}`. Show command, show result.
  - On failure of `createdb`: show error + "You may need to create the database manually as a PostgreSQL superuser."
  - Retry the connection test after creation.

**2.3 — pgvector check**
- Now that the connection is established, query:
  ```sql
  SELECT 1 FROM pg_available_extensions WHERE name = 'vector'
  ```
- If extension is available but not enabled in this database:
  ```sql
  SELECT 1 FROM pg_extension WHERE extname = 'vector'
  ```
- On extension not available (not installed at the PostgreSQL level):
  ```
  [FAIL] pgvector is not installed for this PostgreSQL instance.
  Install with: brew install pgvector
  Then run:     psql -d {dbname} -c "CREATE EXTENSION IF NOT EXISTS vector"
  ```
  Offer to retry after user installs.
- On extension available but not enabled in this database:
  - Prompt: "pgvector is installed but not enabled in database `{dbname}`. Enable it now? [Y/n]"
  - On yes: run `CREATE EXTENSION IF NOT EXISTS vector` via the `pg` client. Show result.
- On enabled: green check.

**2.4 — Migration runner**
- Run `iranti migrate` or the equivalent Prisma migration command for the Iranti instance.
- Show a spinner: "Running migrations…"
- Show migration output in a non-scrollable summary (last 10 lines of output); full output goes to the log file.
- On success: green check, show migration count.
- On failure: show error + map known errors:
  - `type "vector" does not exist` → pgvector not enabled (re-run 2.3)
  - `connection refused` → PostgreSQL service stopped (re-run 1.3)
  - `permission denied` → user lacks CREATE TABLE permissions
- Offer retry after error.

**2.5 — Write env file**
- Show a diff of what will be written (or created) at the instance env path: `~/.iranti/instances/<name>/.env`
- Prompt: "Write this configuration? [Y/n]"
- On confirm: write atomically (write to temp file, rename). Set `fs.chmod('0600')` on the file after writing.
- On existing file: show diff of additions/changes. Do not overwrite existing values without prompting to confirm overwrite for each changed key.

---

### Section 3: Provider Setup

**Purpose:** Configure at least one LLM provider so Iranti has model access.

**Steps:**

**3.1 — Provider selection**

Show a `@clack/prompts` multiselect:

```
Which LLM providers do you want to configure now?
  [x] Anthropic (Claude)
  [ ] OpenAI
  [ ] Groq
  [ ] Mistral
  [ ] Ollama (local, no API key needed)
  [ ] Skip for now — configure later with: iranti add api-key
```

At least one provider must be selected or "Skip" must be chosen. If "Skip" is chosen, the section completes with a warning: "No providers configured. Iranti will not be able to process requests until a provider is added."

**3.2 — Per-provider key entry**

For each selected remote provider:
- Show the expected env variable name (e.g., `ANTHROPIC_API_KEY`)
- Show where to get the key: `https://console.anthropic.com/settings/keys` (displayed, not opened automatically)
- Prompt for key using hidden input (no echo)
- Validate format (Anthropic: starts with `sk-ant-`, OpenAI: starts with `sk-`, Groq: starts with `gsk_`, Mistral: starts with a known prefix). Warn if format doesn't match but do not block.
- After entry: write key to the instance env file using `iranti add api-key` command or direct env file append. Use `0600` permissions.
- **Security note:** The key value is never written to the verbose log file. The log records "ANTHROPIC_API_KEY: [SET]" not the value.

**3.3 — Ollama detection (if Ollama selected)**
- Check `http://localhost:11434/api/tags` with a 2-second timeout.
- On success: green check, show detected models.
- On connection refused:
  ```
  [WARN] Ollama is not running.
  Install: brew install ollama
  Start:   ollama serve
  Pull a model: ollama pull llama3.2
  ```
  Do not block — Ollama can be started after setup.

**3.4 — Default provider selection**
- If more than one provider was configured: prompt "Which provider should be the Iranti default?" as a `@clack/prompts` select.
- Write the selection to the instance env file as `LLM_PROVIDER=<name>`.

**3.5 — `instances.json` registry write**
- See Section 4 in this spec for the registry format.
- The registry write happens here, after the provider is configured, because the instance is now considered configured.

---

### Section 4: Integrations

**Purpose:** Register Iranti with Claude and bind the current project.

**Steps:**

**4.1 — MCP registration check**
- Check the current working directory for `.mcp.json`. Also check `~/.claude/mcp.json` and `~/.config/claude/mcp.json`.
- If Iranti is not registered in any found `.mcp.json`:
  - Show the exact JSON block that needs to be added:
    ```json
    {
      "servers": {
        "iranti": {
          "type": "http",
          "url": "http://localhost:{port}/mcp"
        }
      }
    }
    ```
  - Prompt: "Write this to `.mcp.json` in the current directory? [Y/n]"
  - On yes: read existing `.mcp.json` if present (parse, merge `servers.iranti`, write back), or create a new file. Validate JSON before writing. Show which file was written.
  - On no: show the manual steps and continue.
- If Iranti is already registered: green check, show which file and URL.

**4.2 — Project binding**
- Prompt: "Would you like to bind this project directory (`{cwd}`) to Iranti now? [Y/n]"
- On yes: run `iranti project init {cwd} --instance {instanceName}`. Show result.
- On error: show error and the manual command to run later: `iranti project init . --instance {instanceName}`
- On no: show the manual command and continue.

**4.3 — Claude Code integration check**
- Check for `.claude/settings.local.json` in the current project directory.
- If it exists and does not reference Iranti MCP: show the addition needed and offer to auto-write it.
- If it does not exist: no action (`.mcp.json` from 4.1 is sufficient for most Claude versions).
- This step is informational only — do not block.

---

### Section 5: Verification

**Purpose:** Confirm that the complete setup is functional before declaring success.

**Steps:**

**5.1 — Health check**
- Attempt to start the Iranti server briefly (or if already running, hit the health endpoint): `GET http://localhost:{port}/health` or run `iranti doctor` equivalent checks inline.
- Display a traffic-light summary:

```
  System Checks
  [✓] Node.js v20.11.0
  [✓] PostgreSQL 16.3 reachable at localhost:5432
  [✓] pgvector extension enabled in iranti_local

  Instance
  [✓] Instance "local" configured at ~/.iranti/instances/local
  [✓] DATABASE_URL: postgresql://postgres:***@localhost:5432/iranti_local
  [✓] Migrations applied

  Providers
  [✓] Anthropic configured (ANTHROPIC_API_KEY set)
  [!] No default provider set — using first available

  Integrations
  [✓] MCP registration: .mcp.json in current directory
  [!] Project binding: not confirmed (iranti project init not run)
```

**5.2 — Success state (all critical checks pass)**
```
Setup complete.

  Iranti v0.2.9 is configured and ready.
  Instance: local (http://localhost:3001)

Next steps:
  Start Iranti:       iranti run --instance local
  Open control plane: http://localhost:5173  (after: npm run dev in iranti-control-plane)
  Try Iranti Chat:    iranti chat

Verbose log saved to: ~/.iranti/setup-log-20260320-063500.txt
```

**5.3 — Partial success state (non-critical warnings)**
```
Setup complete with 2 warnings.

  [!] No default provider set
  [!] Project binding not confirmed

Run `iranti setup` again to address warnings, or fix manually:
  iranti add api-key --set-default
  iranti project init . --instance local
```

**5.4 — Failure state (critical check failed)**
```
Setup could not be completed.

  [✗] pgvector extension not enabled in iranti_local

What happened: The database migration requires pgvector to be enabled.
What to do:
  1. Connect to PostgreSQL: psql -d iranti_local
  2. Run: CREATE EXTENSION IF NOT EXISTS vector;
  3. Re-run: iranti setup

Verbose log: ~/.iranti/setup-log-20260320-063500.txt
```

---

## 3. CP-T005 Failure Point Mapping

The top 3 failure points from `docs/specs/installer-concept.md` (Part 1) and their wizard coverage:

### Failure Point 1 — pgvector installation (installer-concept.md Step 3)

**Root cause:** pgvector has no clean cross-platform install. Error surfaces in migration (Step 6) as an opaque SQL error, not at the install step.

**Wizard coverage:** Section 1.4 / Section 2.3
- Section 1 notes pgvector will be checked after DB connection
- Section 2.3 explicitly checks `pg_available_extensions` and `pg_extension` after the connection is established
- On failure: shows the exact `brew install pgvector` command (macOS) and `CREATE EXTENSION` command with the actual database name
- Offers to auto-run the `CREATE EXTENSION` step with user confirmation
- **Gap closed:** Error surfaces at the setup step, not buried in migration output

### Failure Point 2 — DATABASE_URL construction (installer-concept.md Step 5)

**Root cause:** User must synthesize a correctly-formatted connection string from credentials set up 3 steps earlier, across two tools, without validation feedback until migration fails.

**Wizard coverage:** Section 2.1
- Interactive field-by-field construction with individual prompts and defaults
- Immediately tests the connection before writing anything
- Maps test failures to specific field guidance (auth error → username/password, db missing → offer to create)
- Masks password in all displayed output
- **Gap closed:** Validation happens before any write; user gets field-level guidance not a raw connection error

### Failure Point 3 — MCP registration and confirmation (installer-concept.md Step 8)

**Root cause:** `.mcp.json` path is non-obvious, edit is manual JSON, no in-process feedback on success.

**Wizard coverage:** Section 4.1
- Checks multiple candidate `.mcp.json` locations automatically
- Offers to write the correct entry automatically (merge, not overwrite)
- Shows which file was written and validates JSON before writing
- Section 5 health check confirms registration status
- **Gap closed:** User does not need to know where the file lives or how to format the JSON

---

## 4. `instances.json` Registry Spec

### Finding: The existing Iranti CLI does NOT use `instances.json`

Investigation of the installed Iranti v0.2.9 reveals the following storage model:

- `~/.iranti/install.json` — machine-level install metadata (version, scope, root, installedAt)
- `~/.iranti/instances/<name>/instance.json` — per-instance metadata (name, createdAt, port, envFile, instanceDir)

There is no `instances.json` aggregated registry file. The Iranti CLI discovers instances by scanning the `instances/` directory.

**The CP-T023 ticket spec includes a `instances.json` write step (Section 3 of the ticket).** This was designed before the upstream Iranti CLI structure was investigated. The correct approach is to write per-instance `instance.json` files in the format the upstream CLI expects, not to create a parallel `instances.json` file that the upstream CLI does not read.

**Recommended decision for PM:** Replace the `instances.json` requirement with writing to the per-instance `instance.json` format that the upstream Iranti CLI already uses. This maintains compatibility and avoids a parallel registry that becomes stale.

### `instance.json` format (per-instance, already in use)

```json
{
  "name": "local",
  "createdAt": "2026-03-20T09:00:00.000Z",
  "port": 3001,
  "envFile": "/Users/<user>/.iranti/instances/local/.env",
  "instanceDir": "/Users/<user>/.iranti/instances/local"
}
```

Written to: `~/.iranti/instances/<name>/instance.json`

### Proposed `instances.json` format (if PM confirms this separate registry is still required)

If the PM confirms that a separate `~/.iranti/instances.json` aggregated file is needed (e.g., for use by the control plane to enumerate all instances without scanning the filesystem), the format should be:

```json
{
  "version": 1,
  "updatedAt": "2026-03-20T09:00:00.000Z",
  "instances": [
    {
      "name": "local",
      "port": 3001,
      "root": "/Users/<user>/.iranti/instances/local",
      "envFile": "/Users/<user>/.iranti/instances/local/.env",
      "createdAt": "2026-03-20T09:00:00.000Z",
      "configuredAt": "2026-03-20T09:15:00.000Z"
    }
  ],
  "defaultInstance": "local"
}
```

**All paths must be absolute** — no `~` expansion required at read time.

**Written to:** `~/.iranti/instances.json`

**Open question for PM (Open Question 2):** Is this aggregated `instances.json` actually required, or does the wizard just need to write per-instance `instance.json` in the existing format the upstream CLI uses?

---

## 5. Windows Scope Statement

### Supported on Windows (wizard runs and executes)

- Node.js version check (via `process.version`)
- DATABASE_URL construction (field-by-field prompts, same as macOS)
- Database existence test (via `pg` client connection attempt)
- Database creation (via `createdb` if on PATH, else show manual instructions)
- pgvector check (via SQL query after connection established)
- Migration runner (via `iranti migrate` if installed, else `npx prisma migrate deploy`)
- Provider key entry and env file write (same as macOS)
- `instances.json` or `instance.json` registry write
- Final health check (port reachability check)

### Not supported on Windows (shows "Not available on Windows" message)

| Step | Windows behavior |
|------|-----------------|
| `pg_isready` check (Section 1.3) | Skip. Use TCP connect to `localhost:5432` as equivalent. |
| `brew services start postgresql@16` remediation | Show: "Start PostgreSQL via Services manager or: `pg_ctl -D <datadir> start`" |
| pgvector Homebrew install instruction | Show: "pgvector on Windows requires manual build or a pgvector-enabled PostgreSQL distribution. See: https://github.com/pgvector/pgvector#windows" |
| macOS version check (Section 1.2) | Skip entirely |
| `createdb` command availability | Check for `createdb` on PATH; if absent, show: "Run in psql: `CREATE DATABASE iranti;`" |
| `.mcp.json` path detection | Check `%APPDATA%\Claude\mcp.json` and `%LOCALAPPDATA%\Claude\mcp.json`. Fall back to current directory. |
| Auto-run `CREATE EXTENSION vector` | Supported — uses `pg` client, not shell, so platform-agnostic |

### Linux

Linux is out of scope for Phase 2. When the wizard detects Linux (via `process.platform === 'linux'`):

```
Linux setup guidance is not yet available in the wizard.
See the documentation at: https://github.com/nfemmanuel/iranti/blob/main/docs/install.md

You can still run `iranti setup` with --defaults for a non-interactive setup.
```

Wizard exits cleanly with code 0 after displaying this message.

---

## 6. `@clack/prompts` Assessment

**Package:** `@clack/prompts` v1.1.0 (latest as of 2026-03-20). MIT license. Maintained by `natemoo-re` (Astro core team) and `dreyfus92`. Used in production by Vite's `create-vite` scaffolder and several other high-profile Node.js CLI tools.

**Capabilities relevant to this wizard:** `intro`/`outro` for section framing, `spinner` for async tasks with inline success/fail updates, `text` for string input, `password` for hidden input (no echo, no log), `select` for single-choice prompts, `multiselect` for provider selection, `confirm` for yes/no gates, `group` for named sections with dependency between steps, `cancel` for graceful Ctrl+C handling. The `isCancel` utility correctly distinguishes user cancellation from a `null` or `undefined` value.

**Known limitations:** `@clack/prompts` requires a TTY (interactive terminal). It will throw or behave incorrectly if stdout is not a TTY (e.g., piped output, CI environments). The wizard must check `process.stdout.isTTY` at startup and fall back to the existing `--config <file>` or `--defaults` flag mode when non-interactive. The package does not support Windows legacy `cmd.exe` ANSI rendering well — it renders correctly in Windows Terminal and PowerShell 7, but may show raw escape codes in `cmd.exe`. The recommended workaround is to detect `cmd.exe` (via `%COMSPEC%` or `WT_SESSION` environment variable absence) and disable ANSI color in that case.

**Recommended version:** `@clack/prompts@^1.1.0`. The package reached 1.x stability with the move to the `bombshell-dev/clack` monorepo in late 2024. Version `0.7.x` had a known issue with `multiselect` not correctly handling arrow keys on Windows — avoid anything below `1.0.0`.

---

## 7. Open Questions for PM

The following decisions are required from the PM before implementation can begin. Each is a real sequencing blocker.

**OQ-1: Upstream `iranti` package modification — approved or not?**

The wizard must extend the existing `iranti setup` command in the upstream `nfemmanuel/iranti` repository. If this team is not authorized to modify the upstream package, the wizard must be a standalone script invokable separately from `iranti setup`. The PM must decide: (a) we contribute to upstream, (b) we build a standalone `npx iranti-control-plane-setup` script, or (c) we build a wrapper that calls `iranti setup` and then runs the additional sections.

**OQ-2: `instances.json` vs per-instance `instance.json` — which is required?**

The upstream Iranti CLI already writes per-instance `instance.json` files. The CP-T023 ticket spec calls for writing `~/.iranti/instances.json` (an aggregated registry). These two formats are not the same. Does the PM want: (a) the wizard to write per-instance `instance.json` in the upstream format (compatible, no new file), or (b) a new `instances.json` aggregated registry in addition to the per-instance format?

**OQ-3: Which providers are in the Phase 2 supported set?**

The ticket references "Anthropic, OpenAI, Ollama, Groq, Mistral." The upstream Iranti CLI supports: `mock`, `ollama`, `gemini`, `claude`, `openai`, `groq`, `mistral`. Should `gemini` be added to the Phase 2 provider list? The wizard multiselect must list a fixed set — PM to confirm the exact list.

**OQ-4: Should the wizard attempt to start the Iranti server on completion?**

The ticket asks whether the wizard should offer to launch the control plane after setup. Recommendation (from installer-concept.md): yes. But starting the server requires knowing whether to use `iranti run --instance local` or the control plane's `npm run dev`. The PM must confirm: (a) wizard offers to run `iranti run --instance local`, (b) wizard just shows the command, (c) wizard offers to launch both the Iranti server and the control plane dev server.

**OQ-5: Re-run behavior — update mode vs fresh install only?**

The wizard must detect whether `~/.iranti/instances/<name>/instance.json` already exists. If it does, the wizard is a re-run. Does the PM require update mode in Phase 2 (detect existing config, offer update vs reset), or is fresh-install-only acceptable with a message: "An instance named `local` already exists. Use `iranti configure instance local` to update it, or provide a different name."?

**OQ-6: Windows — is reduced depth acceptable for Phase 2?**

The installer-concept.md memo says Windows is required in Phase 2 with reduced depth. The CP-T023 ticket confirms this. But the specific scope of "reduced depth" needs PM sign-off given the detailed Windows scope statement above. PM to confirm the Windows scope table in Section 5 of this spec matches expectations.

---

## Summary of Key Findings

| Finding | Impact |
|---------|--------|
| `iranti setup` already exists as a CLI subcommand at v0.2.9 | Entry point work is upstream contribution, not net-new CLI |
| Iranti CLI does not use `instances.json` — uses per-instance `instance.json` | Registry spec in CP-T023 ticket needs PM decision |
| `~/.iranti/instances/local/instance.json` has confirmed schema | Wizard must write to this format for upstream CLI compatibility |
| `iranti setup` currently uses `readline/promises`, not `@clack/prompts` | Migrating to clack requires upstream change; not trivial |
| Iranti v0.2.9 already handles DATABASE_URL, migration, instance creation | Wizard extension scope is: pgvector check, provider setup, MCP registration, health verification |
| `@clack/prompts` v1.1.0 is production-stable and TTY-safe | Recommended, but add TTY check at startup |
| `iranti setup --config <file>` and `--defaults` flags exist for non-interactive mode | Wizard must preserve these flags for CI/scripted use |

---

*This is a design spike output. No implementation was performed. CP-T023 implementation must not begin until the PM has reviewed this spec and resolved all open questions.*
