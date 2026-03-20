# Instance and Project Metadata Aggregation Spec

**Spec ID**: CP-T003
**Phase**: 0
**Author**: system_architect
**Date**: 2026-03-20
**Status**: Complete — pending PM review

---

## Overview

This spec defines how the control plane aggregates instance-level and project-level metadata to power the Instance and Project Manager view (FR4, FR5). It maps every metadata field to its source, selects an aggregation strategy, handles edge cases, and produces the concrete JSON output schema that the CP-T002 endpoint group will return.

The control plane must answer: "What instances exist, how are they configured, what projects are bound to them, and are their integrations healthy?" — without requiring the operator to inspect env files, filesystem directories, or run CLI commands manually.

---

## 1. Metadata Inventory

All fields are mapped to their primary source. Where a field does not currently exist as a structured artifact in Iranti, this is noted explicitly.

### 1.1 Instance-Level Fields

| Field | Source | Source Detail | Notes |
|---|---|---|---|
| `instanceId` | Derived | Hash or slug of the runtime root path (e.g. `sha256(runtimeRoot)[0:8]`). | Iranti does not currently maintain a canonical instance registry. See §6.1. |
| `runtimeRoot` | Filesystem / config | Directory containing `.env.iranti` and Iranti's runtime artifacts. Discovered by walking known candidate paths or reading a registry. | See §2.3 for discovery strategy. |
| `databaseUrl` | `.env.iranti` | `DATABASE_URL` value. **Must never be returned as a raw value.** Return only connection target (host, port, db name), with credentials redacted. | Parse as a PostgreSQL connection string. |
| `databaseHost` | Derived from `DATABASE_URL` | Hostname portion of `DATABASE_URL`. | Derived field, not stored separately. |
| `databasePort` | Derived from `DATABASE_URL` | Port portion of `DATABASE_URL`. Defaults to 5432 if absent. | |
| `databaseName` | Derived from `DATABASE_URL` | Database name portion of `DATABASE_URL`. | |
| `configuredPort` | `.env.iranti` | `PORT` env var, or fallback to `3001` if not set. | |
| `envFilePresent` | Filesystem stat | `stat(.env.iranti)` in the runtimeRoot — true if file exists. | |
| `envFileKeyCompleteness` | Filesystem parse | Read `.env.iranti`, check for presence of required keys: `DATABASE_URL`, `PORT`, `ANTHROPIC_API_KEY` (or equivalent provider key). Return a completeness summary, not values. | See §1.3 for key list. |
| `runningStatus` | Process check + health endpoint | (1) Attempt `GET http://localhost:{configuredPort}/health` — if 200, `running`. (2) If TCP connection refused, `stopped`. (3) If timeout, `unreachable`. | Do not rely on PID files — they go stale. |
| `irantVersion` | HTTP health endpoint or `package.json` | Prefer `GET http://localhost:{configuredPort}/version` or `/health` if it returns version. Fallback: read `package.json` in `runtimeRoot` or `node_modules/iranti/package.json`. | |
| `latestVersionAvailable` | Out of scope for v1 | Requires an upstream version-check API call. Note as future work. | |

### 1.2 Project Binding Fields

| Field | Source | Source Detail | Notes |
|---|---|---|---|
| `projectId` | Derived | Slug or hash of `projectPath`. | No current project registry confirmed. |
| `projectPath` | Iranti project registry or config | Expected source: an Iranti-managed table or config file mapping project paths to instance IDs. If no registry exists, discovered via filesystem conventions. | See §6.2 for proposed upstream change. |
| `projectName` | `package.json` in `projectPath` | `name` field from `projectPath/package.json`. Fallback: directory name of `projectPath`. | |
| `claudeMdPresent` | Filesystem stat | `stat(projectPath/CLAUDE.md)` — true if file exists. | |
| `claudeMdHasIrantiRef` | Filesystem read | Read `CLAUDE.md` — search for presence of `iranti`, `localhost:3001`, or `mcp__iranti` as a heuristic indicator of Iranti integration. | Heuristic only; not a guaranteed integration check. |
| `mcpConfigPresent` | Filesystem stat | `stat(projectPath/.mcp.json)` — true if file exists. | |
| `mcpConfigHasIranti` | Filesystem read + parse | Parse `.mcp.json` as JSON — check for a server entry named `iranti` or with a URL matching the Iranti MCP endpoint. | Malformed JSON case: see §4. |
| `codexConfigPresent` | Filesystem stat | `stat(projectPath/AGENTS.md)` or `stat(projectPath/.codex/config.yaml)` — true if either exists. | Codex integration file conventions may evolve. |
| `lastActiveTimestamp` | DB query | `SELECT MAX(created_at) FROM knowledge_base WHERE agent_id IN (SELECT agent_id FROM sessions WHERE project_path = :projectPath)` — approximate. Alternatively: latest KB entry `created_at` filtered by entity identifiers associated with this project. | This query is approximate pending upstream schema clarification. |

### 1.3 Integration Status Fields

| Field | Source | Source Detail | Notes |
|---|---|---|---|
| `anthropicKeyPresent` | `.env.iranti` key presence | Check if `ANTHROPIC_API_KEY` key exists in `.env.iranti` (non-empty). Never return the value. | |
| `openaiKeyPresent` | `.env.iranti` key presence | Check if `OPENAI_API_KEY` key exists (non-empty). | |
| `otherProviderKeys` | `.env.iranti` key scan | Scan for any key matching `*_API_KEY` pattern; return list of key names only (not values). | |
| `mcpServerRegistered` | `.mcp.json` parse | Parse `.mcp.json` — true if an Iranti server entry exists with a valid URL. | Per-project field (see above). |
| `defaultProvider` | `.env.iranti` | `IRANTI_DEFAULT_PROVIDER` or equivalent env var. | Key name may need confirmation against upstream. |
| `defaultModel` | `.env.iranti` | `IRANTI_DEFAULT_MODEL` or equivalent. | Key name may need confirmation against upstream. |
| `providerRoutingConfig` | `.env.iranti` | Any `IRANTI_MODEL_*` or `IRANTI_PROVIDER_*` task-override keys. Return key names and non-secret values only. | |

---

## 2. Aggregation Strategy

### Option 1: Pull on Request

**Description**: Every time the control plane receives a request to `/api/control-plane/instances`, it synchronously reads all sources: filesystem stats, env file parse, process health check, DB queries. Assembles and returns the response in real time.

**Pros:**
- Always returns current state — no staleness.
- No Iranti-side changes required to maintain a registry.
- Simple to implement: a single aggregation function called at request time.
- Correct by construction: every read reflects the actual state of the filesystem and process at that moment.

**Cons:**
- Latency: a full aggregation may require 3–8 I/O operations (filesystem stats, env file reads, HTTP health check, DB query). On a local machine, this is likely 50–200ms — acceptable for a management UI, but not for high-frequency polling.
- Health check (`GET /health`) may add up to the TCP timeout (e.g., 2s) if the instance is not running. Must use a short timeout (500ms recommended).
- If multiple projects are bound, the per-project filesystem reads multiply linearly.

**Implementation complexity**: Low. No schema changes. One aggregation function per field group.

---

### Option 2: Push to Registry

**Description**: Iranti maintains a `instance_registry` table (or a metadata file) that it updates at startup, config change, and project bind/unbind events. The control plane queries this registry directly.

**Pros:**
- Fast reads — single DB query.
- No filesystem I/O at request time.
- Scales naturally to multiple instances and projects.

**Cons:**
- Requires Iranti to maintain the registry — a non-trivial upstream change.
- Registry can become stale if Iranti crashes without cleanup, or if the user manually edits config files outside of Iranti's control.
- Adds a new failure mode: registry is present but wrong (e.g., runtimeRoot moved, `.env.iranti` edited manually).
- Not suitable for "is the instance currently running" — process state cannot be pushed reliably.

**Implementation complexity**: High. Requires upstream Iranti changes (see §6.2).

---

### Option 3: Hybrid (Registry for Stable Fields, Pull for Live Fields)

**Description**: A registry stores stable, slowly-changing fields (project bindings, runtimeRoot, configuredPort). Live fields (runningStatus, envFilePresent, process health) are pulled at request time.

**Pros:**
- Faster than pure pull for stable fields.
- More accurate than pure registry for live state.
- Reduces I/O for large project lists.

**Cons:**
- Still requires upstream registry changes for the stable fields.
- Two code paths to maintain.
- Registry-stable / live-pull boundary is ambiguous (e.g., is `irantVersion` stable? What about `defaultProvider` if the env file is edited?).

**Implementation complexity**: Medium-high. Requires some upstream changes plus pull logic.

---

### Recommendation: Option 1 — Pull on Request (for v1)

**Rationale:**

For a v1 local-only deployment with a single Iranti instance, pull on request is the right choice:

1. **No upstream changes required**: Option 2 and 3 both require Iranti to maintain a registry, which is a non-trivial upstream change that is out of scope for this repository. Option 1 can be fully implemented in the control plane backend without any Iranti core changes.

2. **Correctness over speed**: The Instance Manager is a management surface opened intentionally by an operator. Sub-second response time is not required. A 100–300ms response is excellent for this use case.

3. **Staleness is worse than latency**: For a management UI, returning stale data (e.g., "instance running" when it has crashed) is more harmful than a slightly slower accurate response.

4. **Caching is straightforward to add later**: A 30-second TTL cache on the aggregated response can be added in Phase 2 if performance becomes a concern at scale.

**Performance notes:**
- Health endpoint check: 500ms timeout. If the instance does not respond within 500ms, status is `unreachable`.
- Filesystem stats: typically <5ms per call on a local disk.
- Total expected P50 latency: 50–150ms (instance running). P50 latency when instance is stopped: ~550ms (dominated by the TCP connect timeout).
- Recommendation: expose the health check result as a separate cached field with its own `checkedAt` timestamp so the UI can show "as of N seconds ago" without re-checking on every page render.

---

## 3. Instance Discovery

Before aggregating metadata, the control plane must discover what instances exist.

### Discovery Strategy: Registry File + Fallback Scan

**Primary: Global Registry File**

A file at `~/.iranti/instances.json` (or platform equivalent) acts as a lightweight registry of known Iranti instance roots. Iranti writes to this file on `iranti init` or `iranti start`. Format:

```json
{
  "instances": [
    {
      "instanceId": "a1b2c3d4",
      "runtimeRoot": "/Users/nf/projects/myapp/.iranti",
      "registeredAt": "2026-01-15T10:00:00Z"
    }
  ]
}
```

**Fallback: Candidate Path Scan**

If the registry file is absent or empty, the control plane scans a fixed list of candidate directories for `.env.iranti` presence:
- `~/.iranti/`
- `~/iranti/`
- The control plane's own working directory

This fallback is intentionally narrow to avoid filesystem traversal. It is not exhaustive instance discovery — it covers the most common installation patterns only.

**OS-Specific Registry File Paths:**

| OS | Default registry path |
|---|---|
| macOS | `~/.iranti/instances.json` → `/Users/{username}/.iranti/instances.json` |
| Linux | `~/.iranti/instances.json` → `/home/{username}/.iranti/instances.json` |
| Windows | `%USERPROFILE%\.iranti\instances.json` → `C:\Users\{username}\.iranti\instances.json` |

The control plane should use `os.homedir()` (Node.js) or equivalent to resolve `~` portably.

---

## 4. Edge Cases

### 4.1 `.env.iranti` is Missing

**Behavior:**
- `envFilePresent`: `false`
- `databaseUrl`, `configuredPort`, all key presence fields: `null`
- `envFileKeyCompleteness`: `{ present: false, keys: null, missingRequiredKeys: ["DATABASE_URL", "PORT"] }`
- `runningStatus`: still attempt health check (instance may be running with environment variables set externally)

**UI implication:** Show a "env file missing" warning banner. This is a common misconfiguration state during setup.

---

### 4.2 Instance is Not Running

**Behavior:**
- `runningStatus`: `"stopped"` (TCP connection refused within 500ms) or `"unreachable"` (TCP timeout)
- `irantVersion`: fall back to reading `package.json` in `runtimeRoot` if health endpoint is unavailable
- All other fields: populate from filesystem and env file as normal

**UI implication:** Show instance status indicator as "offline." Still show all config fields so the operator can diagnose why.

---

### 4.3 Project Path No Longer Exists on Filesystem

**Behavior:**
- `projectPath`: return the registered path as-is
- `projectExists`: `false`
- All filesystem-derived project fields (`claudeMdPresent`, `mcpConfigPresent`, etc.): `null` with `projectExists: false` as the reason
- `lastActiveTimestamp`: still query DB (historical data may still exist)

**UI implication:** Show a "project directory not found" warning. Allow the operator to remove the stale binding or reassign it.

---

### 4.4 Integration Config File Exists but is Malformed

Applies to `.mcp.json` (expected JSON) and `CLAUDE.md` (expected text).

**Behavior for malformed `.mcp.json`:**
- `mcpConfigPresent`: `true`
- `mcpConfigHasIranti`: `false`
- `mcpConfigError`: `"JSON parse error: {truncated error message}"`

**Behavior for unreadable `CLAUDE.md`:**
- `claudeMdPresent`: `true`
- `claudeMdHasIrantiRef`: `false`
- `claudeMdError`: `"File read error: {reason}"`

**General rule:** Field-level errors should be surfaced in a companion `{fieldName}Error` field, not as a top-level error response. The aggregation should not fail if one field fails to populate.

---

### 4.5 Multiple Instances Discovered

**Behavior:**
- The `/api/control-plane/instances` endpoint returns an array — one element per discovered instance.
- Each element has its own `instanceId`, `runtimeRoot`, `runningStatus`, and project bindings.
- The control plane does not pick a "current" instance — that is a UI concern.
- If two instances share the same `DATABASE_URL` (e.g., same Postgres DB), this is surfaced as a metadata field so the operator is aware of the shared state.

---

## 5. Output Schema

The following JSON schema is the authoritative shape for the instance metadata API response. It feeds directly into the `/api/control-plane/instances` endpoint specified in CP-T002.

### 5.1 Top-Level Response

```typescript
interface InstanceListResponse {
  instances: InstanceMetadata[];
  discoveredAt: string;           // ISO 8601 — when this aggregation was performed
  discoverySource: "registry" | "scan" | "hybrid";
}
```

### 5.2 InstanceMetadata

```typescript
interface InstanceMetadata {
  // Identity
  instanceId: string;             // Derived ID (hash of runtimeRoot)
  runtimeRoot: string;            // Absolute path, OS-native separators

  // Database (credentials never returned)
  database: {
    host: string | null;
    port: number | null;          // Default 5432
    name: string | null;
    urlRedacted: string | null;   // e.g. "postgresql://***@localhost:5432/iranti"
  } | null;

  // Network
  configuredPort: number | null;  // From PORT env var, default 3001

  // Runtime state
  runningStatus: "running" | "stopped" | "unreachable";
  runningStatusCheckedAt: string; // ISO 8601 — when the health check was performed
  irantVersion: string | null;    // From health endpoint or package.json

  // Env file
  envFile: {
    present: boolean;
    path: string;                 // Absolute path to .env.iranti
    keyCompleteness: EnvKeyCompleteness | null;
  };

  // Integration config (instance-level)
  integration: {
    defaultProvider: string | null;
    defaultModel: string | null;
    providerKeys: ProviderKeyPresence;
    providerRoutingOverrides: Record<string, string> | null;
  };

  // Bound projects
  projects: ProjectBinding[];

  // Metadata
  registeredAt: string | null;    // When this instance was added to the registry
  notes: string | null;           // Any operator notes (future use)
}
```

### 5.3 EnvKeyCompleteness

```typescript
interface EnvKeyCompleteness {
  allRequiredKeysPresent: boolean;
  requiredKeys: {
    key: string;
    present: boolean;
  }[];
  extraProviderKeys: string[];    // Additional *_API_KEY keys found (names only)
}

// Required keys checked:
// - DATABASE_URL
// - PORT (optional — has default)
// - At least one provider key: ANTHROPIC_API_KEY or OPENAI_API_KEY
```

### 5.4 ProviderKeyPresence

```typescript
interface ProviderKeyPresence {
  anthropic: boolean;             // ANTHROPIC_API_KEY present and non-empty
  openai: boolean;                // OPENAI_API_KEY present and non-empty
  otherKeys: string[];            // Names of any other *_API_KEY keys found
}
```

### 5.5 ProjectBinding

```typescript
interface ProjectBinding {
  // Identity
  projectId: string;              // Derived from projectPath
  projectPath: string;            // Absolute path
  projectName: string | null;     // From package.json name or directory name
  projectExists: boolean;         // Whether the directory currently exists on disk

  // Claude integration
  claudeIntegration: {
    claudeMdPresent: boolean | null;         // null if projectExists = false
    claudeMdHasIrantiRef: boolean | null;
    claudeMdError: string | null;
    mcpConfigPresent: boolean | null;
    mcpConfigHasIranti: boolean | null;
    mcpConfigError: string | null;
  } | null;

  // Codex integration
  codexIntegration: {
    configPresent: boolean | null;           // AGENTS.md or .codex/config.yaml
  } | null;

  // Activity
  lastActiveTimestamp: string | null;        // ISO 8601, from DB query

  // Binding metadata
  boundAt: string | null;                    // ISO 8601, when project was bound
}
```

### 5.6 Example Response

```json
{
  "instances": [
    {
      "instanceId": "a1b2c3d4",
      "runtimeRoot": "/Users/nf/projects/myapp/.iranti",
      "database": {
        "host": "localhost",
        "port": 5432,
        "name": "iranti_dev",
        "urlRedacted": "postgresql://***@localhost:5432/iranti_dev"
      },
      "configuredPort": 3001,
      "runningStatus": "running",
      "runningStatusCheckedAt": "2026-03-20T10:00:00.000Z",
      "irantVersion": "1.4.2",
      "envFile": {
        "present": true,
        "path": "/Users/nf/projects/myapp/.iranti/.env.iranti",
        "keyCompleteness": {
          "allRequiredKeysPresent": true,
          "requiredKeys": [
            { "key": "DATABASE_URL", "present": true },
            { "key": "PORT", "present": true }
          ],
          "extraProviderKeys": ["ANTHROPIC_API_KEY"]
        }
      },
      "integration": {
        "defaultProvider": "anthropic",
        "defaultModel": "claude-sonnet-4-5",
        "providerKeys": {
          "anthropic": true,
          "openai": false,
          "otherKeys": []
        },
        "providerRoutingOverrides": null
      },
      "projects": [
        {
          "projectId": "b5c6d7e8",
          "projectPath": "/Users/nf/projects/myapp",
          "projectName": "myapp",
          "projectExists": true,
          "claudeIntegration": {
            "claudeMdPresent": true,
            "claudeMdHasIrantiRef": true,
            "claudeMdError": null,
            "mcpConfigPresent": true,
            "mcpConfigHasIranti": true,
            "mcpConfigError": null
          },
          "codexIntegration": {
            "configPresent": false
          },
          "lastActiveTimestamp": "2026-03-19T22:45:00.000Z",
          "boundAt": "2026-01-15T10:00:00.000Z"
        }
      ],
      "registeredAt": "2026-01-15T10:00:00.000Z",
      "notes": null
    }
  ],
  "discoveredAt": "2026-03-20T10:00:00.000Z",
  "discoverySource": "registry"
}
```

---

## 6. OS-Level Path Considerations

| Field | macOS | Linux | Windows |
|---|---|---|---|
| `runtimeRoot` | `/Users/{user}/.iranti` | `/home/{user}/.iranti` | `C:\Users\{user}\.iranti` |
| `.env.iranti` | `{runtimeRoot}/.env.iranti` | same | same (backslash) |
| Registry file | `~/.iranti/instances.json` | same | `%USERPROFILE%\.iranti\instances.json` |
| `projectPath` | POSIX absolute | POSIX absolute | Windows absolute (`C:\...`) |
| Path separator | `/` | `/` | `\` (Node `path.win32`) |

**Implementation note:** All path operations must use Node.js `path.join()` / `path.resolve()` rather than string concatenation. `os.homedir()` must be used to resolve `~`. On Windows, `fs.stat()` accepts both `/` and `\` separators, but paths returned to the client should use the OS-native separator.

**Cross-platform filesystem reads:** `.env.iranti`, `CLAUDE.md`, `.mcp.json`, and `package.json` are all text files readable by Node.js `fs.readFile` uniformly across platforms. No platform-specific read logic is required beyond path resolution.

---

## 7. Proposed Upstream Changes

> **FLAG: All items in this section are proposed upstream changes — requires PM review before acting on.**

### 7.1 Instance Registry

Iranti does not currently maintain a canonical registry of known instances. To support reliable multi-instance discovery, Iranti should:
- Write to `~/.iranti/instances.json` on `iranti init` and `iranti start`.
- Remove stale entries on `iranti stop` or when a runtimeRoot no longer exists.

Without this, the control plane falls back to candidate-path scanning, which is narrower and may miss instances configured in non-standard paths.

### 7.2 Project Binding Registry

Iranti should maintain a project-binding table or config file (e.g., `{runtimeRoot}/projects.json`) listing all projects bound to this instance, including the bind timestamp and any metadata. Without this, the control plane cannot enumerate project bindings without either a DB query or asking the operator to specify them.

### 7.3 Version Endpoint

Iranti's health endpoint (if one exists) should include the running Iranti version in its response body. This allows the control plane to read the version without parsing `package.json`. Proposed shape: `GET /health → { status: "ok", version: "1.4.2", ... }`.

---

## 8. Open Questions

1. **Project binding source**: Does Iranti currently store project bindings in a DB table, a config file, or not at all? If not at all, the control plane cannot enumerate projects without a new upstream construct. This must be confirmed against the running Iranti codebase before Phase 1 implementation begins.

2. **`lastActiveTimestamp` query**: The query described in §1.2 is approximate. The exact schema of the `knowledge_base` table and its indexing on `created_at` + agent/project dimensions needs to be confirmed. If there is no efficient index, this query could be slow for large instances.

3. **`IRANTI_DEFAULT_PROVIDER` key name**: The env var name for default provider and model configuration is assumed. Actual key names must be confirmed against the running Iranti codebase.

4. **Multiple instances sharing a DB**: If two runtimeRoots point to the same `DATABASE_URL`, the control plane should warn the operator. This requires de-duplication logic at the aggregation layer. Deferred to Phase 2 unless the PM prioritizes it.

5. **Windows path separator in responses**: Should the API return paths with OS-native separators or normalized POSIX paths? For a local-only API consumed by a local browser, OS-native is acceptable. If the API is ever accessed remotely (out of scope for v1), POSIX normalization would be safer. Recommendation: return OS-native for v1 and document this as a v2 concern.

---

## 9. Acceptance Criteria Check

- [x] Every metadata field in PRD Section 4 mapped to its current source — no TBD fields without documented investigation notes.
- [x] Aggregation strategy: push vs pull vs hybrid compared with concrete pros/cons; pull recommended with rationale.
- [x] Edge cases addressed: missing env file, non-running instance, missing project path, malformed integration config, multiple instances.
- [x] Output schema is concrete: all field names, types, and nullability documented.
- [x] OS-level path differences addressed for macOS, Linux, and Windows.
- [x] Proposed upstream changes flagged clearly as out-of-scope for this repo.
- [ ] PM review: pending.
