# CP-T005 — Installer/Onboarding Concept Memo

**Status:** Complete — Awaiting PM Review
**Author:** devops_engineer
**Date:** 2026-03-20
**Ticket:** CP-T005
**Gates:** Phase 2 CP-E010 (installer/onboarding epic)

---

## Executive Summary

Iranti's current install path has 9 distinct manual steps with at least 3 high-probability failure points that cause new users to abandon setup before Iranti is running. The recommended approach for Phase 2 is **Option C: Enhanced CLI Setup Wizard** — an extended `iranti setup` command that guides users interactively through dependency checks, configuration, and first-run verification. This is the fastest path to a materially better experience without the distribution overhead of a native installer or the chicken-and-egg problem of a UI-first setup wizard. Phase 2 MVP scope is deliberately macOS-first, targeting solo developers with Homebrew installed.

---

## Part 1: Current Iranti Install Path Analysis

The following is the complete step-by-step install path for a new user running Iranti from scratch on a local machine. Each step is documented with what can go wrong and how a non-infrastructure-expert user experiences that failure.

---

### Step 1 — Install Node.js (required: v18 or later)

**What the user must do:**
Visit nodejs.org, download the LTS installer, run it, and verify with `node --version`. Or use a version manager: `nvm install 18` (macOS/Linux) or `nvm-windows`.

**What can go wrong:**
- User installs an older system-managed Node (e.g., v14 from an old Ubuntu package repo) and gets a cryptic syntax error at runtime rather than a clear version error.
- On macOS, the system may have `/usr/bin/node` pointing to nothing or to an ancient Xcode-bundled version. `which node` succeeds but `node --version` returns v10.
- Users with `nvm` installed across multiple shell profiles (`.bashrc` vs `.zshrc`) find that `node` is available in one terminal but not another, and Iranti's server start fails from a different shell or process spawner.

**New user experience:** The README says "requires Node.js 18+" but the user does not know if their existing install qualifies. There is no preflight check in the current install path.

---

### Step 2 — Install PostgreSQL (required: v14 or later)

**What the user must do:**
Install PostgreSQL locally. On macOS: `brew install postgresql@16`. On Windows: download the EDB installer and run it, setting a superuser password and selecting a port (default 5432). On Linux: `apt install postgresql-16`.

**What can go wrong:**
- On macOS, `brew install postgresql@16` installs the binaries but the service is not started. The user has PostgreSQL installed but `psql` commands fail with "connection refused" because `postgresql@16` is not yet running.
- On Windows, the EDB installer presents 12 screens and requires the user to set and remember a superuser password that will be needed in Step 5. Users who click through quickly with blank passwords or forget what they entered arrive at Step 5 unable to construct the DATABASE_URL.
- Multiple PostgreSQL versions installed simultaneously (e.g., a pre-existing v12 installation) cause the wrong `psql` to be on PATH. Migrations target the wrong server.

**New user experience:** No part of the current install path validates that PostgreSQL is reachable before moving on. The failure manifests several steps later as a migration error.

---

### Step 3 — Enable the pgvector extension

**What the user must do:**
Install the `pgvector` extension for the PostgreSQL version in use. On macOS with Homebrew: `brew install pgvector`. On Linux: `apt install postgresql-16-pgvector` or compile from source if the package is not in the distro repo. On Windows: compile from source or use a pgvector-ready PostgreSQL distribution.

Then connect to PostgreSQL as superuser and run:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

**What can go wrong:**
- On macOS, `brew install pgvector` installs the extension library but the user still needs to run `CREATE EXTENSION` per-database. Users who skip this step get a startup error from Iranti that references `pgvector` but the error message is not beginner-readable.
- On Windows, there is no official package for pgvector. Users must download and compile it manually with Visual Studio build tools — a 20+ minute process that requires developer toolchain knowledge. This is the single highest technical barrier for Windows users.
- On Linux, the pgvector package name varies by distro and PostgreSQL version. `postgresql-16-pgvector` is only available in Ubuntu 23.10+. Earlier LTS versions require compiling from source.

**New user experience:** Most new users do not know what pgvector is before encountering this step. The documentation requires them to already understand PostgreSQL extension management.

---

### Step 4 — Install the Iranti package

**What the user must do:**
Either `npm install -g iranti` (if published to npm) or clone the repository and run `npm install` inside it.

**What can go wrong:**
- `npm install -g` requires write permissions to the global npm prefix. On macOS without proper npm setup, this fails with `EACCES` permission errors. The fix (changing npm prefix or using `sudo`) is non-obvious.
- On Windows, PowerShell execution policy may block post-install scripts. The error message does not explain why.
- If installing from source (git clone), the user may clone to a path with spaces (`C:\Users\John Smith\Projects\iranti`), which breaks several Node.js child process invocations.

**New user experience:** Error messages from npm install failures are verbose and do not map cleanly to actionable fixes. A user who has never debugged npm will see a wall of red text.

---

### Step 5 — Create the `.env.iranti` configuration file

**What the user must do:**
Copy `.env.iranti.example` to `.env.iranti` and fill in:
- `DATABASE_URL` (PostgreSQL connection string: `postgresql://user:password@localhost:5432/iranti`)
- `ANTHROPIC_API_KEY` or other LLM provider credentials
- `IRANTI_INSTANCE_ID` or instance name
- Any additional config flags for model routing, logging, etc.

**What can go wrong:**
- The `DATABASE_URL` format is unforgiving. Users who mistype the port, forget to URL-encode special characters in their password, or use the wrong database name get an opaque connection error.
- Users who installed PostgreSQL on Windows with a password containing `@` or `#` do not know they must percent-encode it.
- LLM API key values are easy to copy with a trailing space, producing auth errors that look identical to invalid key errors.
- Users do not know which fields are required vs optional. The `.env.iranti.example` file has no inline guidance on field semantics.

**New user experience:** This step requires the user to synthesize information from three places: the PostgreSQL setup in Step 2 (remembering the password they set), the LLM provider dashboard (obtaining an API key), and the Iranti documentation. There is no wizard; it is raw file editing.

---

### Step 6 — Run database migrations

**What the user must do:**
Run `iranti migrate` or the equivalent npm script from the installation directory.

**What can go wrong:**
- If `DATABASE_URL` is incorrect, the migration fails with a PostgreSQL connection error. The error message does not tell the user which part of the URL is wrong.
- If pgvector is not installed (Step 3 was skipped or failed silently), the migration fails at the vector column creation with an error referencing an unknown type `vector`. This error is not self-explanatory.
- If the PostgreSQL service is installed but not running (common on macOS after a reboot), the migration fails with "connection refused." The user does not know they need to run `brew services start postgresql@16`.

**New user experience:** Migration failure is reported as a code-level SQL error. There is no friendly remediation — the user must interpret raw PostgreSQL error messages.

---

### Step 7 — Start the Iranti server

**What the user must do:**
Run `iranti start` or `npm start` from the installation directory. Confirm the server is listening (typically `http://localhost:3001`).

**What can go wrong:**
- Port 3001 may already be in use. The error message is Node.js's default `EADDRINUSE`, which does not tell the user which process is occupying the port or how to change Iranti's port.
- If `.env.iranti` is malformed or missing required keys, the server may start silently in a degraded state rather than failing fast with a clear error.
- On macOS, the server starts but macOS Gatekeeper may block outbound API calls to LLM providers on first run, requiring the user to approve a security prompt they may not recognize as related to Iranti.

**New user experience:** The user does not get a clear "Iranti is working correctly" signal. The server starts, but the user does not know if the database connection is healthy, if the API key is valid, or if pgvector is active.

---

### Step 8 — Register the MCP server in Claude's config

**What the user must do:**
Locate Claude's `.mcp.json` configuration file (location varies by OS and Claude version). Add an entry for the Iranti MCP server:
```json
{
  "servers": {
    "iranti": {
      "type": "http",
      "url": "http://localhost:3001/mcp"
    }
  }
}
```
Restart Claude.

**What can go wrong:**
- The `.mcp.json` file location is not standardized and is not in an intuitive place for new users (e.g., `~/.claude/mcp.json` on macOS, `%APPDATA%\Claude\mcp.json` on Windows).
- JSON syntax errors in `.mcp.json` cause Claude to fail silently or display a generic error. There is no Claude-side validator.
- If the Iranti server is not running when the user restarts Claude, the MCP server appears unavailable and the user does not know if the registration is correct or if the server is simply down.

**New user experience:** This step requires the user to hand-edit a config file for a separate application (Claude) in a location they must look up. There is no integration from the Iranti side that validates whether this step was completed correctly.

---

### Step 9 — Set up a project binding

**What the user must do:**
Run `iranti bind --project /path/to/project` or equivalent. Confirm the binding is active via `iranti status` or direct database inspection.

**What can go wrong:**
- Project path must be the correct absolute path. Relative paths may work from the current directory but fail later when Iranti is started from a different working directory.
- If the user has multiple projects and creates duplicate bindings, behavior is undefined without reading the docs carefully.
- There is no visible confirmation that the binding is active other than a `status` command that itself requires the server to be running.

**New user experience:** This is the last step in a long sequence, and by this point, many users have already hit at least one failure that required manual debugging. Arriving at Step 9 successfully requires surviving 8 prior steps without tooling support.

---

### Top 3 Failure Points

**Failure Point 1 — pgvector installation (Step 3)**

This is the highest-severity failure in the install path. pgvector has no clean cross-platform install story. On macOS it is tolerable with Homebrew. On Windows it requires compiling from source with a C++ build chain. On older Linux distributions the package is not available without additional repo configuration. When it fails, the error surfaces in Step 6 (migrations) as an opaque SQL error, not at the step where the user was supposed to install it. The gap between cause and symptom makes recovery very hard. Estimated drop-off: high — any user without existing PostgreSQL extension management experience will likely abandon setup here.

**Failure Point 2 — DATABASE_URL construction (Step 5)**

The `.env.iranti` file requires the user to synthesize a correctly formatted connection string from credentials they set up in Step 2, across two tools (a PostgreSQL client and a text editor), without validation feedback until Step 6. The connection string format has multiple mandatory fields, encoding requirements for special characters, and is platform-specific in subtle ways (socket paths vs TCP on Linux). Users who set a complex PostgreSQL password during the EDB installer on Windows frequently arrive here unable to reconstruct it. Estimated drop-off: high for non-developer users; moderate for developers unfamiliar with PostgreSQL connection strings.

**Failure Point 3 — MCP registration and confirmation (Step 8)**

Even after Iranti is technically running, users cannot confirm the setup is working until Claude recognizes the MCP server. The file path for `.mcp.json` is non-obvious, the edit is manual JSON, and there is no in-process feedback loop telling the user whether registration succeeded. Users who complete Steps 1–7 successfully may abandon at Step 8 because they do not know where to find the Claude config file, and the consequence of a mistake (Claude not loading the tool) looks identical to the consequence of Iranti not running. Estimated drop-off: moderate — developer-literate users figure this out, but non-infrastructure users often cannot.

---

## Part 2: Install Path Options

### Option A: Dedicated Installer (Native App)

**Description:**
A packaged OS-level installer. On macOS: a signed `.pkg` or `.dmg` with a standard installation wizard, potentially distributed via Homebrew (`brew install --cask iranti`). On Windows: a signed `.exe` installer (NSIS or WiX), distributed via direct download or `winget install iranti`. On Linux: `.deb`/`.AppImage` or a `snap` package.

The installer would bundle or auto-install Node.js, provide an embedded PostgreSQL instance (using a bundled PostgreSQL binary or Docker), run migrations, create the `.env.iranti` file interactively, and register the MCP server.

**User experience:**
Excellent for the target use case — download, double-click, follow prompts, done. This is the gold standard for developer tooling targeted at non-infrastructure users (e.g., Postgres.app, Docker Desktop, Homebrew Cask apps).

**Implementation complexity:**
Very high. Requires:
- Separate build pipelines per platform (macOS, Windows, Linux are each distinct)
- Code signing and notarization for macOS (Apple Developer ID, $99/year, notarization process for each release)
- Code signing for Windows (Extended Validation code signing certificate, ~$300/year, mandatory for Defender trust on Windows 11)
- Bundling or auto-provisioning PostgreSQL — Postgres.app approach (macOS only) is clean; for Windows/Linux it requires either shipping a full PostgreSQL binary or managing Docker as a dependency
- A release pipeline that produces platform-specific artifacts and hosts them for download
- An update mechanism (Sparkle for macOS, WinSparkle for Windows, or a custom channel)

**Maintenance burden:**
High. Every Iranti release requires rebuilding, signing, notarizing, and publishing platform artifacts. PostgreSQL version updates inside the bundle require testing across all platforms. Code signing certificates have annual renewal cycles.

**Cross-platform scope:**
macOS is achievable in Phase 2. Windows is significantly more work (code signing, `.exe` format, Windows Defender interactions). Linux is viable via AppImage but requires its own testing surface. Doing all three in Phase 2 is unrealistic.

**Distribution mechanism:**
Direct download page + Homebrew Cask (macOS), winget (Windows). Both require publishing and maintenance overhead beyond the installer itself.

**Time to implement for Phase 2:**
6–10 weeks for macOS alone, correctly signed and notarized. Cross-platform would be 12–16+ weeks. Not achievable within a reasonable Phase 2 scope without a dedicated installer engineer.

**Major risks:**
- Apple notarization process has changed multiple times and can block releases unexpectedly
- Bundling PostgreSQL creates a support surface for PostgreSQL issues that Iranti did not previously own
- Update path for the bundled PostgreSQL version is complex (users may have data in the bundled database that must survive upgrades)
- The installer binary distribution requires infrastructure (a CDN, download tracking, version hosting) that does not currently exist

**Verdict:** Too much distribution and maintenance overhead for Phase 2. Correct long-term direction for a productized v2, but not the right Phase 2 choice.

---

### Option B: Guided Setup Flow Inside the Control Plane

**Description:**
The control plane itself serves a first-run setup wizard when it detects that Iranti is not fully configured. The web UI walks the user through dependency checks, configuration, database setup, and MCP registration. No separate installer binary — the control plane IS the setup surface.

**User experience:**
Good once the user has reached the control plane. The wizard UI can be rich, interactive, and visually aligned with the product design. Dependency checks can be displayed clearly with green/red status indicators and contextual remediation links.

**The chicken-and-egg problem:**
This option has a fundamental prerequisite: the control plane must be running before the setup wizard can be accessed. But the control plane requires Node.js, and it benefits significantly from Iranti's server being at least partially running. This means the user must complete at minimum Steps 1–4 of the current install path (Node.js, PostgreSQL install, Iranti install) before they can access the wizard. The wizard cannot help with its own prerequisites.

The practical consequence: a guided UI flow in the control plane can dramatically improve the Steps 5–9 experience (database config, migration, MCP registration, project binding), but it cannot eliminate the Steps 1–4 barrier. Steps 1–3 remain fully manual and unguided.

**What prerequisites it still requires:**
- Node.js 18+ installed (user must do this without help)
- PostgreSQL installed and the service running (user must do this without help)
- pgvector installed (user must do this without help, still the highest failure point)
- Iranti npm package installed (user must do this without help, including solving npm permission issues)

**Implementation complexity:**
Moderate. The control plane already needs to be built as a web app (Phase 1). The setup wizard is an additional multi-step flow within it. The main engineering work is:
- A "first run" detection mechanism (checking database connectivity, env file presence, pgvector status)
- Step-by-step wizard UI with real-time dependency checking
- A structured API that the wizard calls to run migrations, write the `.env.iranti` file, and validate the setup
- An MCP registration helper that writes to `.mcp.json` programmatically

**Maintenance burden:**
Low to moderate. The wizard is part of the control plane codebase and updates with it. No separate distribution artifacts. No code signing.

**Major risks:**
- Does not solve the hardest failure points (Steps 1–3). A user who cannot get pgvector installed still cannot reach the wizard.
- If migrations or database setup fail inside the wizard, the error handling must be better than the current CLI's raw SQL errors — otherwise the wizard is just a pretty face on the same failures.
- Requires the control plane to be running as a prereq for setup — circular dependency if the control plane itself is not yet installed.

**Verdict:** Excellent for Steps 5–9. Wrong tool for Steps 1–4. Needs a companion pre-install layer to be effective. On its own, it helps the already-technical users but does not materially lower the bar for the Step 3 (pgvector) failure point.

---

### Option C: Enhanced CLI Setup Wizard

**Description:**
Extend the Iranti CLI with a richer `iranti setup` (or `iranti init`) command. Interactive terminal prompts — similar to `create-react-app`, `laravel new`, or `bun init` — that check dependencies, guide the user through configuration, run migrations, write the `.env.iranti` file, and register the MCP server. No separate installer binary. Runs in the terminal the user already has open.

**User experience:**
Better than raw docs. Worse than a native installer UI, but better for the target user persona (solo developer, comfortable with a terminal). The wizard can:
- Check for Node.js version and print a clear message if it's wrong
- Check if PostgreSQL is reachable at localhost:5432 and print specific remediation if not (including "run `brew services start postgresql@16`" on macOS)
- Check if pgvector is installed and guide the user to the correct install command for their OS
- Collect DATABASE_URL components interactively (host, port, user, password, database name) rather than requiring the user to format the string manually
- Validate each piece of config before writing `.env.iranti`
- Run migrations with a spinner and a human-readable success/fail message
- Detect Claude's `.mcp.json` location and offer to write the Iranti entry automatically
- Print a clear "Iranti is running correctly" confirmation at the end

**What it can automate:**
- Dependency checks with specific error messages and remediation instructions
- `.env.iranti` creation from interactive field collection with validation
- Database migration execution with understandable error messages
- `.mcp.json` registration (locate the file, write the entry, validate JSON)
- Project binding via `iranti bind --project .` with clear confirmation
- End-to-end health check via `iranti doctor` integrated at the end

**What it cannot automate:**
- Installing Node.js (must be a prereq, but the wizard can detect and abort cleanly)
- Installing PostgreSQL (must be a prereq, but the wizard gives clear instructions on detecting it and what to install)
- Installing pgvector (cannot be installed programmatically without sudo/superuser and platform-specific tooling, but the wizard can detect its absence and print the exact command for the user's detected OS)
- Obtaining LLM API keys (must prompt the user for these)

**Implementation complexity:**
Moderate-low. The CLI already exists. The wizard is a new command (`iranti setup`) implemented with a mature interactive prompt library (Inquirer.js or Clack). Key workstreams:
- Dependency detection module (Node version, PostgreSQL reachability, pgvector presence)
- Interactive config collection for DATABASE_URL, API keys, instance name
- `.env.iranti` writer with field validation
- Migration runner with improved error messaging
- `.mcp.json` locator and writer (cross-platform path resolution)
- Health check integration at the end of the flow
- OS detection for platform-specific remediation messages

**Maintenance burden:**
Low. No distribution artifacts. No code signing. Updates ship with the Iranti npm package. The wizard commands are part of the main CLI codebase.

**Time to implement for Phase 2:**
3–5 weeks for a solid macOS + Windows implementation with platform-specific remediation messages. 1 additional week for Linux. This is achievable in Phase 2.

**Major risks:**
- pgvector on Windows still requires manual steps that the wizard cannot automate; the wizard can only guide, not install. If pgvector remains the primary failure point, the CLI wizard improves the experience but does not eliminate the barrier.
- Cross-platform `.mcp.json` path detection is non-trivial (Claude stores config in different locations on macOS vs Windows vs Linux, and this may change between Claude versions).
- The "interactive terminal" experience is less discoverable than a UI — users who expect a desktop app may not find the CLI wizard approachable.

**Verdict:** Best balance of user value delivered vs implementation cost for Phase 2. Directly addresses failure points 2 and 3. Provides meaningful improvement for failure point 1 even if it cannot fully automate it.

---

## Part 3: Recommendation

**Recommended: Option C — Enhanced CLI Setup Wizard**

The recommendation is Option C, with Option B (`guided setup flow in the control plane`) implemented as the Phase 2 follow-on companion once the control plane is live.

**Rationale tied to FR9 and ER5:**

FR9 requires a "dramatically simpler installation and onboarding flow." Option C delivers this in the most direct way possible for the primary target user (solo developer, macOS or Windows, comfortable with a terminal). It takes the existing 9-step manual process and collapses the hardest steps (Steps 5–9) into a single guided command, while giving clear, specific, actionable guidance on Steps 1–4 instead of silent failures.

ER5 requires that "a new user should be able to get Iranti installed and into a working state with guided help instead of assembling infrastructure from scattered commands and docs." Option C provides this guided help at the CLI layer, meeting users where they already are (a terminal) rather than requiring them to navigate to a UI before setup is complete.

Option A (native installer) would deliver the best possible UX, but the distribution overhead (signing, notarization, platform builds, update pipeline) makes it a Phase 3 investment rather than Phase 2. It is the right long-term direction for Iranti to become a genuinely mainstream tool.

Option B (control plane wizard) is excellent for the Steps 5–9 experience but cannot address the pre-install phase. It should be built in Phase 2 as a health/setup dashboard after the user has completed the initial install via the CLI wizard — the two approaches are complementary, not competing.

**What Option C will and will not solve:**

It will solve:
- Silent failures from bad `DATABASE_URL` construction (interactive field collection with validation)
- Silent pgvector absence (explicit detection and OS-specific remediation message)
- `.mcp.json` registration confusion (programmatic detection and writing)
- Project binding as an afterthought (wizard ends with binding confirmation)
- No success signal (wizard ends with `iranti doctor` output and explicit "Iranti is running correctly" confirmation)

It will not fully solve:
- pgvector installation on Windows (still requires manual steps; wizard guides but cannot automate)
- Node.js and PostgreSQL installation (prereqs; wizard detects and gives precise instructions but cannot install)
- Users who are not comfortable with a terminal at all (addressed in Phase 3 with a native installer)

**MVP scope for Phase 2:**
See Part 4.

---

## Part 4: MVP Scope Definition

### Platform support for Phase 2

**macOS:** Required. This is the primary platform for the target user persona (solo developers, technical founders). macOS with Homebrew is the highest-probability environment and where the wizard can offer the most specific remediation commands (`brew services start postgresql@16`, `brew install pgvector`, etc.).

**Windows:** Required with reduced depth. The wizard must run on Windows and provide useful guidance. However, pgvector remediation on Windows cannot be automated — the wizard should detect the gap, explain it clearly, and link to the relevant documentation. Windows PostgreSQL path detection and `.mcp.json` location must be handled correctly.

**Linux:** Out of scope for Phase 2. The Linux user population for this product is smaller and more technically capable (they are already accustomed to package manager installation). Linux support should be added in Phase 2.1 or Phase 3 based on user demand.

### Dependencies: bundled vs pre-installed

**Must be pre-installed by user:**
- Node.js 18+ (wizard detects, fails gracefully with install instructions)
- PostgreSQL 14+ (wizard detects, fails gracefully with install instructions)
- pgvector extension (wizard detects, provides platform-specific installation commands)

**Can be automated by wizard:**
- `.env.iranti` file creation (from collected field inputs)
- Database migration execution
- `.mcp.json` registration
- Project binding
- Health verification

**Not in scope for Phase 2:**
- Bundling any runtime or database binary
- Silent background installation of any system dependency

### Happy path end-to-end

The Phase 2 happy path assumes the user has Node.js 18+, PostgreSQL 14+ running, and pgvector installed. This is the path the wizard optimizes for:

1. User runs `npm install -g iranti` (or equivalent install command)
2. User runs `iranti setup`
3. Wizard checks Node.js version — passes
4. Wizard checks PostgreSQL reachability at localhost:5432 — passes
5. Wizard checks pgvector installed — passes
6. Wizard prompts: PostgreSQL host, port, user, password, database name — user fills in fields
7. Wizard validates connection string by attempting a connection — succeeds
8. Wizard prompts: LLM provider (Anthropic / OpenAI / other) and API key — user fills in
9. Wizard writes `.env.iranti` to the Iranti install directory
10. Wizard runs database migrations — succeeds
11. Wizard starts Iranti server — succeeds
12. Wizard detects Claude's `.mcp.json` path and offers to register the MCP server — user confirms
13. Wizard prompts for project directory to bind — user provides path
14. Wizard runs `iranti bind` for the provided path
15. Wizard runs `iranti doctor` and prints a clear health summary
16. Wizard prints: "Iranti is running. Open http://localhost:3001 to access the control plane."

Total user interactions: ~6 prompts. Estimated time on the happy path: under 3 minutes.

### What is explicitly out of scope for Phase 2

- PostgreSQL installation automation (install instructions only, no automated install)
- pgvector installation automation on any platform (detection and OS-specific instructions only)
- Multiple instance setup (single instance only)
- Team or multi-user setup flows
- Provider credential rotation or management beyond initial setup
- Uninstaller or migration-away tooling
- Auto-update mechanism for the Iranti CLI itself
- macOS `.pkg` or `.dmg` packaging
- Windows signed `.exe` installer
- Linux package distribution
- The control plane setup wizard UI (deferred to Phase 2.1 after control plane is live)

---

## Part 5: Implementation Complexity Estimate

### Engineering workstreams (Option C)

**Workstream 1: Dependency detection module**
Check Node.js version, PostgreSQL TCP reachability, pgvector presence via a test query, and OS detection for platform-specific messaging. This is standalone utility code that can also power the control plane's health diagnostics surface later.
Effort: 3–5 days.

**Workstream 2: Interactive prompt flow (`iranti setup`)**
Implement the step-by-step wizard using Clack (preferred over Inquirer.js — better terminal rendering, actively maintained, smaller bundle) or Inquirer.js. Covers database config collection, API key collection, and project path input with validation at each step.
Effort: 4–7 days.

**Workstream 3: `.env.iranti` writer with validation**
Write the collected config to `.env.iranti` atomically. Validate each field before writing (test database connection, validate API key format). Handle the case where `.env.iranti` already exists (offer to update or back up).
Effort: 2–3 days.

**Workstream 4: Migration runner with improved error handling**
Wrap the existing migration command with human-readable error translation. Map known SQL error codes to remediation messages (pgvector not installed, database does not exist, permission denied, etc.).
Effort: 3–4 days.

**Workstream 5: `.mcp.json` locator and writer**
Detect the Claude config directory on macOS and Windows (known paths, with fallback to documented paths). Read, modify, and write `.mcp.json` safely (validate JSON, preserve existing entries, create file if absent).
Effort: 3–5 days.

**Workstream 6: End-to-end health check and success state**
Integrate `iranti doctor` output at the end of the wizard. Display a structured success confirmation. Handle partial-success states (e.g., Iranti running but MCP not yet verified because Claude is not running).
Effort: 2–3 days.

### Total estimate

**Implementation (macOS + Windows):** 3–4 weeks for one backend engineer.
**Testing and edge case handling:** 1 additional week.
**Total Phase 2 scope:** 4–5 weeks, 1 agent (backend_developer with devops_engineer reviewing platform-specific paths).

This is a 1-agent effort with devops_engineer in a review and testing role for platform-specific behavior.

### Key technical risks

1. **`.mcp.json` path stability.** Claude has changed config file locations between versions. The path resolver must handle multiple candidate locations and document its fallback behavior. If it writes to the wrong file, MCP registration silently fails. Mitigation: check multiple candidate paths in priority order, print which path was selected, and prompt the user to confirm.

2. **pgvector detection reliability.** Detecting pgvector requires an active PostgreSQL connection and a query against `pg_available_extensions`. This means pgvector detection can only happen after the database connection is established (Step 6 of the wizard, not earlier). The flow must be sequenced correctly — do not ask the user for config before checking what is and is not available.

3. **Windows PostgreSQL path detection.** On Windows, the PostgreSQL service may be running on a non-default port, with a non-default service name, and the `pg_isready` binary may not be on PATH. The wizard needs a Windows-specific detection path that does not rely on `pg_isready` being available.

### External tooling required

- **Clack** (`@clack/prompts`) — interactive terminal prompt library. No significant licensing risk. Well-maintained. Used by Vite and other modern Node.js tooling.
- **pg** (`node-postgres`) — already a dependency for Iranti. Used for database connection testing.
- No Electron, no Tauri, no native packaging toolchains required for Option C.

---

## Part 6: Open Questions for PM

The following questions must be answered before Phase 2 installer tickets are cut. They are real sequencing blockers, not theoretical concerns.

**Q1: Is Windows required in Phase 2, or is macOS-only acceptable for the initial release?**

The wizard can be built for macOS first in 3 weeks. Adding solid Windows support (correct PostgreSQL detection, pgvector guidance, `.mcp.json` path resolution in `%APPDATA%`) adds 1–2 weeks. If the PM accepts macOS-first, Phase 2 ships faster. If Windows must be day-one, the estimate expands accordingly.

**Q2: Can we assume Homebrew is installed on macOS users' machines?**

The pgvector remediation message on macOS is dramatically simpler if we can say "run `brew install pgvector`" vs having to explain compiling from source. If the primary macOS user persona is a developer with Homebrew (a reasonable assumption for solo developers and technical founders), we optimize for that. If not, the macOS remediation instructions become more complex.

**Q3: Should `iranti setup` attempt to start the PostgreSQL service if it is installed but not running?**

On macOS with Homebrew, the wizard could run `brew services start postgresql@16` automatically if PostgreSQL is installed but not listening. This is a small amount of automation that materially improves the failure-point-1 experience (service not running). However, it requires the wizard to execute system-level commands on behalf of the user. Is this acceptable, or should the wizard stay in a "guide only, never execute system-level actions" posture?

**Q4: What is the expected distribution mechanism for Iranti itself?**

The wizard assumes the user has already installed the Iranti CLI (via `npm install -g iranti` or equivalent). If the npm global install experience is itself a significant friction point (EACCES errors, etc.), we may need to address the install-the-installer problem first. Is there a plan to publish Iranti to npm, or is direct-from-repo the current model?

**Q5: Should the wizard support updating an existing installation, or only new installs?**

A user who already has Iranti running and wants to re-run the wizard to update their config, add a new project binding, or re-register MCP needs different wizard behavior than a first-time installer. Phase 2 should probably handle first-time install only and add update mode in Phase 2.1. Is that the right call, or does the PM require update mode in Phase 2?

---

## Acceptance Criteria Checklist

- [x] Current install path accurately documented with every manual step in sequence, named dependencies with version requirements, and every config file described
- [x] Top 3 most common failure points identified with root cause and user experience described for each
- [x] At least 3 install path options evaluated with concrete pros and cons tied to real implementation realities (Options A, B, and C)
- [x] Recommended option stated clearly (Option C) with rationale explicitly referencing FR9 and ER5
- [x] Phase 2 implementation complexity estimate included: 4–5 weeks, 6 workstreams, 1 agent primary, key technical risks identified
- [x] Explicit Phase 2 out-of-scope items listed
- [x] Chicken-and-egg problem for Option B addressed explicitly
- [x] Open questions for PM listed as real blockers before Phase 2 tickets are cut

---

*This memo was produced as a Phase 0 spike output. No implementation was performed. Phase 2 CP-E010 tickets must not be cut until the PM has reviewed and approved this memo.*
