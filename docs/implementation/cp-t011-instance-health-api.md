# CP-T011 Implementation Plan — Instance Metadata + Health API

**Ticket**: CP-T011
**Spec**: CP-T002 Groups 5–6, CP-T003
**Author**: backend_developer
**Date**: 2026-03-20
**Status**: Plan — ready for implementation

---

## 1. Architecture Fit

### 1.1 Route Mounting

```
src/routes/control-plane/instances.ts  ← GET /api/control-plane/instances
                                          GET /api/control-plane/instances/:instanceId/projects
src/routes/control-plane/health.ts     ← GET /api/control-plane/health
```

Registered in the control plane barrel router (same `src/routes/control-plane/index.ts` as CP-T010):

```typescript
controlPlaneRouter.use('/instances', instancesRouter);
controlPlaneRouter.use('/health',    healthRouter);
```

### 1.2 Supporting Modules

```
src/lib/instance-aggregator/
  index.ts           ← Main aggregation entry point: discoverAndAggregate()
  discovery.ts       ← Registry file + fallback scan
  env-parser.ts      ← .env.iranti parse and redaction
  health-probe.ts    ← HTTP health check with timeout
  fs-checks.ts       ← CLAUDE.md, .mcp.json, package.json inspection
  db-url-parser.ts   ← Parse DATABASE_URL → { host, port, name, urlRedacted }

src/lib/health-aggregator/
  index.ts           ← Main health check runner: runAllHealthChecks()
  checks/
    db-reachability.ts
    db-schema-version.ts
    vector-backend.ts
    provider-keys.ts
    default-provider.ts
    mcp-integration.ts
    claude-md-integration.ts
    runtime-version.ts
    staff-events-table.ts
```

This separation keeps the route handlers thin and the aggregation logic independently testable.

---

## 2. `GET /api/control-plane/instances`

### 2.1 Instance Discovery

Discovery runs first, producing an array of `runtimeRoot` paths and a `discoverySource` label.

#### Step 1: Registry File Check

```typescript
// src/lib/instance-aggregator/discovery.ts
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

interface RegistryEntry {
  instanceId: string;
  runtimeRoot: string;
  registeredAt: string;
}

interface DiscoveryResult {
  roots: { runtimeRoot: string; registeredAt: string | null }[];
  source: 'registry' | 'scan' | 'hybrid';
}

async function getRegistryFilePath(): Promise<string> {
  return path.join(os.homedir(), '.iranti', 'instances.json');
}

async function readRegistry(): Promise<RegistryEntry[] | null> {
  const registryPath = await getRegistryFilePath();
  try {
    const raw = await fs.readFile(registryPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.instances)) return null;
    return parsed.instances as RegistryEntry[];
  } catch (err: unknown) {
    // File not found (ENOENT) → return null, trigger scan fallback
    // Malformed JSON → log warning, return null (do not throw — scan fallback is the recovery)
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[instance-aggregator] Registry file parse error — falling back to scan:', err);
    }
    return null;
  }
}
```

**Windows path note**: `path.join(os.homedir(), '.iranti', 'instances.json')` produces `C:\Users\{user}\.iranti\instances.json` on Windows automatically — no manual separator handling needed. `os.homedir()` resolves `%USERPROFILE%` correctly on Windows.

#### Step 2: Fallback Candidate Scan

If registry returns `null` or an empty array:

```typescript
async function scanCandidatePaths(): Promise<string[]> {
  const home = os.homedir();
  const cwd  = process.cwd();

  const candidates = [
    path.join(home, '.iranti'),
    path.join(home, 'iranti'),
    cwd,
  ];

  const found: string[] = [];
  for (const dir of candidates) {
    const envPath = path.join(dir, '.env.iranti');
    try {
      await fs.access(envPath, fs.constants.F_OK);
      found.push(dir);  // .env.iranti exists at this path
    } catch {
      // Directory or file doesn't exist — skip silently
    }
  }
  return found;
}
```

**Sequential iteration**: The candidate scan uses a `for` loop (not `Promise.all`) to avoid unnecessary filesystem I/O for paths that don't exist — fail-fast per candidate is preferred over parallel stat calls here.

#### Step 3: Combine into DiscoveryResult

```typescript
async function discoverInstances(): Promise<DiscoveryResult> {
  const registryEntries = await readRegistry();

  if (registryEntries && registryEntries.length > 0) {
    return {
      roots: registryEntries.map(e => ({
        runtimeRoot: e.runtimeRoot,
        registeredAt: e.registeredAt,
      })),
      source: 'registry',
    };
  }

  const scannedRoots = await scanCandidatePaths();
  return {
    roots: scannedRoots.map(r => ({ runtimeRoot: r, registeredAt: null })),
    source: 'scan',
  };
}
```

### 2.2 Per-Instance Metadata Aggregation

After discovery, aggregate metadata for each `runtimeRoot` in parallel:

```typescript
// src/lib/instance-aggregator/index.ts
async function discoverAndAggregate(): Promise<{ instances: InstanceMetadata[]; discoverySource: string; discoveredAt: string }> {
  const { roots, source } = await discoverInstances();

  // Aggregate all instances in parallel — one failing instance does not block others
  const instances = await Promise.all(
    roots.map(({ runtimeRoot, registeredAt }) =>
      aggregateInstance(runtimeRoot, registeredAt).catch((err) => {
        // If aggregation for a single instance throws unexpectedly, return a minimal error object
        // rather than letting it propagate and kill the whole response
        console.error(`[instance-aggregator] Failed to aggregate ${runtimeRoot}:`, err);
        return buildErrorInstance(runtimeRoot, registeredAt, String(err));
      })
    )
  );

  return {
    instances,
    discoverySource: source,
    discoveredAt: new Date().toISOString(),
  };
}
```

#### 2.2.1 Env File Parsing

```typescript
// src/lib/instance-aggregator/env-parser.ts
import fs from 'fs/promises';
import path from 'path';

interface ParsedEnv {
  present: boolean;
  path: string;
  raw: Record<string, string> | null;
  keyCompleteness: EnvKeyCompleteness | null;
}

const REQUIRED_KEYS = ['DATABASE_URL', 'PORT'];
// At least one provider key must be present — checked separately
const PROVIDER_KEY_PATTERN = /^(ANTHROPIC|OPENAI)_API_KEY$/;

async function parseEnvFile(runtimeRoot: string): Promise<ParsedEnv> {
  const envPath = path.join(runtimeRoot, '.env.iranti');
  let raw: Record<string, string> | null = null;

  try {
    const content = await fs.readFile(envPath, 'utf8');
    raw = parseEnvContent(content);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        present: false,
        path: envPath,
        raw: null,
        keyCompleteness: null,
      };
    }
    throw err;  // Unexpected read error — propagate
  }

  const requiredKeyResults = REQUIRED_KEYS.map(k => ({
    key: k,
    present: k in raw! && raw![k].trim() !== '',
  }));

  const extraProviderKeys = Object.keys(raw).filter(
    k => k.endsWith('_API_KEY') && !PROVIDER_KEY_PATTERN.test(k)
  );

  return {
    present: true,
    path: envPath,
    raw,
    keyCompleteness: {
      allRequiredKeysPresent: requiredKeyResults.every(r => r.present),
      requiredKeys: requiredKeyResults,
      extraProviderKeys,
    },
  };
}

function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key   = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');  // Strip surrounding quotes
    if (key) result[key] = value;
  }
  return result;
}
```

**Security invariant**: The `raw` env map is **never** passed to the API response. Only structured, safe derived fields are returned. API response construction must explicitly pick allowed fields:

```typescript
// SAFE: pick only non-sensitive derived fields
integration: {
  defaultProvider: env.raw?.['IRANTI_DEFAULT_PROVIDER'] ?? null,
  defaultModel:    env.raw?.['IRANTI_DEFAULT_MODEL'] ?? null,
  providerKeys: {
    anthropic: !!(env.raw?.['ANTHROPIC_API_KEY']?.trim()),
    openai:    !!(env.raw?.['OPENAI_API_KEY']?.trim()),
    otherKeys: (env.keyCompleteness?.extraProviderKeys ?? []),
  },
  providerRoutingOverrides: null,  // Phase 1: not yet aggregated
},
```

**`IRANTI_DEFAULT_PROVIDER` key name**: This is assumed based on the spec. The CP-T011 ticket flags this as unconfirmed. Before shipping, verify against an actual `.env.iranti` file from a running Iranti instance. If the key is named differently, update the constant and document the finding in Iranti.

#### 2.2.2 DATABASE_URL Redaction

```typescript
// src/lib/instance-aggregator/db-url-parser.ts
import { URL } from 'url';

interface ParsedDbUrl {
  host: string | null;
  port: number | null;
  name: string | null;
  urlRedacted: string | null;
}

function parseAndRedactDbUrl(rawUrl: string | undefined): ParsedDbUrl {
  if (!rawUrl) return { host: null, port: null, name: null, urlRedacted: null };

  try {
    const parsed = new URL(rawUrl);
    const host   = parsed.hostname || null;
    const port   = parsed.port ? parseInt(parsed.port, 10) : 5432;
    // DB name is the first path segment without leading slash
    const name   = parsed.pathname.replace(/^\//, '') || null;
    // Redacted URL: replace username:password with ***
    const redacted = `${parsed.protocol}//***@${parsed.host}${parsed.pathname}`;

    return { host, port, name, urlRedacted: redacted };
  } catch {
    // Malformed URL — return null fields, log the issue
    console.warn('[db-url-parser] Failed to parse DATABASE_URL (value redacted from log)');
    return { host: null, port: null, name: null, urlRedacted: null };
  }
}
```

**`new URL()` handles all connection string formats**: PostgreSQL connection strings in the format `postgresql://user:pass@host:port/dbname` are valid URLs parseable by the WHATWG `URL` API. The `postgres://` protocol variant is also handled identically. If Iranti uses a non-URL connection string format (e.g., `host=localhost dbname=iranti user=postgres password=...`), this parser will fail and return all-nulls — a warning will appear in logs. Implement a key-value fallback parser if this is observed.

#### 2.2.3 Health Probe (Running Status)

```typescript
// src/lib/instance-aggregator/health-probe.ts
import http from 'http';

interface ProbeResult {
  runningStatus: 'running' | 'stopped' | 'unreachable';
  irantVersion: string | null;
  checkedAt: string;
}

async function probeInstance(port: number): Promise<ProbeResult> {
  const checkedAt = new Date().toISOString();

  return new Promise((resolve) => {
    const TIMEOUT_MS = 500;

    const req = http.get(
      {
        hostname: 'localhost',
        port,
        path: '/health',  // or '/version' — try /health first
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            let version: string | null = null;
            try {
              const parsed = JSON.parse(body);
              version = parsed.version ?? null;  // Per CP-T003 §7.3 proposed upstream shape
            } catch { /* non-JSON health endpoint — version undetectable from HTTP */ }
            resolve({ runningStatus: 'running', irantVersion: version, checkedAt });
          } else {
            // Non-200 response: treat as running (port responded) but version unknown
            resolve({ runningStatus: 'running', irantVersion: null, checkedAt });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ runningStatus: 'unreachable', irantVersion: null, checkedAt });
    });

    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') {
        resolve({ runningStatus: 'stopped', irantVersion: null, checkedAt });
      } else {
        // Other errors (ETIMEDOUT, EHOSTUNREACH, etc.) → unreachable
        resolve({ runningStatus: 'unreachable', irantVersion: null, checkedAt });
      }
    });
  });
}
```

**Timeout behavior**: The `http.get` `timeout` option fires the `'timeout'` event after 500ms but does not automatically destroy the request — `req.destroy()` is called explicitly in the handler to release resources. Without the explicit `destroy()`, the socket remains open and the handler may resolve multiple times. The Promise resolves exactly once in all branches.

**No `reject` path**: The probe never rejects — it always resolves with a status. This is intentional: a network error for an individual instance should not throw and must not prevent other instances from being aggregated.

#### 2.2.4 Version Fallback (package.json)

When the health probe returns `irantVersion: null` (instance stopped or health endpoint does not include version):

```typescript
async function readVersionFromPackageJson(runtimeRoot: string): Promise<string | null> {
  const candidates = [
    path.join(runtimeRoot, 'package.json'),
    path.join(runtimeRoot, 'node_modules', 'iranti', 'package.json'),
  ];

  for (const pkgPath of candidates) {
    try {
      const raw    = await fs.readFile(pkgPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (typeof parsed.version === 'string') return parsed.version;
    } catch { /* not found or malformed — try next candidate */ }
  }
  return null;
}
```

#### 2.2.5 `instanceId` Derivation

```typescript
import crypto from 'crypto';

function deriveInstanceId(runtimeRoot: string): string {
  // Normalize path to lowercase and forward slashes before hashing
  // to avoid case-sensitivity differences on Windows vs macOS
  const normalized = runtimeRoot.toLowerCase().replace(/\\/g, '/');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 8);
}
```

**Stability**: The `instanceId` is stable across restarts as long as `runtimeRoot` does not change. Normalizing case and separator ensures Windows paths hash identically regardless of how the path was resolved (e.g., `C:\Users\NF` vs `c:/users/nf`).

### 2.3 Full `aggregateInstance` Function

```typescript
async function aggregateInstance(
  runtimeRoot: string,
  registeredAt: string | null
): Promise<InstanceMetadata> {
  const instanceId = deriveInstanceId(runtimeRoot);

  // Parse env file first — needed for port and DB URL
  const envResult = await parseEnvFile(runtimeRoot);

  const port = envResult.raw?.['PORT']
    ? parseInt(envResult.raw['PORT'], 10)
    : 3001;

  const dbParsed = parseAndRedactDbUrl(envResult.raw?.['DATABASE_URL']);

  // Health probe and version fallback run in parallel
  const [probe, versionFallback] = await Promise.all([
    probeInstance(port),
    envResult.present
      ? readVersionFromPackageJson(runtimeRoot)
      : Promise.resolve(null),
  ]);

  const irantVersion = probe.irantVersion ?? versionFallback;

  return {
    instanceId,
    runtimeRoot,
    database: envResult.raw?.['DATABASE_URL']
      ? {
          host:        dbParsed.host,
          port:        dbParsed.port,
          name:        dbParsed.name,
          urlRedacted: dbParsed.urlRedacted,
        }
      : null,
    configuredPort: port,
    runningStatus:           probe.runningStatus,
    runningStatusCheckedAt:  probe.checkedAt,
    irantVersion,
    envFile: {
      present:         envResult.present,
      path:            envResult.path,
      keyCompleteness: envResult.keyCompleteness,
    },
    integration: {
      defaultProvider:         envResult.raw?.['IRANTI_DEFAULT_PROVIDER'] ?? null,
      defaultModel:            envResult.raw?.['IRANTI_DEFAULT_MODEL'] ?? null,
      providerKeys: {
        anthropic: !!(envResult.raw?.['ANTHROPIC_API_KEY']?.trim()),
        openai:    !!(envResult.raw?.['OPENAI_API_KEY']?.trim()),
        otherKeys: envResult.keyCompleteness?.extraProviderKeys ?? [],
      },
      providerRoutingOverrides: null,
    },
    // Phase 1: project bindings are stubbed — CP-T006 spike required for binding source
    projects: [],
    registeredAt,
    notes: null,
  };
}
```

### 2.4 Edge Cases

#### Missing `.env.iranti`

When `envResult.present === false`:
- `database`: `null` (no DATABASE_URL to parse)
- `configuredPort`: `3001` (default fallback — health probe still runs on 3001)
- `envFile.keyCompleteness`: `null`
- `integration.providerKeys`: all `false` (cannot check without env file)

The health probe still runs against the default port because the instance may have been started with environment variables set externally (e.g., via `export` in the shell or a system env), not from `.env.iranti`.

#### Instance Not Running

When `probe.runningStatus === 'stopped'` or `'unreachable'`:
- `runningStatus` is set to the probe result
- All env file fields are still populated normally
- `irantVersion` falls back to `package.json` reader
- The response is 200 — the stopped state is surfaced inside the object, not as an HTTP error

#### `isNaN(port)` Guard

If `envResult.raw?.['PORT']` is present but not a valid integer:

```typescript
const rawPort = envResult.raw?.['PORT'];
const port = rawPort && !isNaN(parseInt(rawPort, 10))
  ? parseInt(rawPort, 10)
  : 3001;
```

### 2.5 Route Handler

```typescript
// src/routes/control-plane/instances.ts
import { Router, Request, Response, NextFunction } from 'express';
import { discoverAndAggregate } from '../../lib/instance-aggregator';

const instancesRouter = Router();

instancesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await discoverAndAggregate();
    return res.json({
      instances:       result.instances,
      discoveredAt:    result.discoveredAt,
      discoverySource: result.discoverySource,
    });
  } catch (err) {
    next(err);
  }
});

instancesRouter.get('/:instanceId/projects', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { instanceId } = req.params;

    // Phase 1 stub — project binding discovery pending CP-T006 spike
    // CP-T003 §7.2 proposes an upstream project binding registry that does not yet exist.
    // Return empty array with a metadata flag so the UI can show an informative empty state.
    return res.json({
      instanceId,
      projects: [],
      projectBindingsUnavailable: true,
      note: 'Project binding discovery is pending CP-T006. No binding registry source has been confirmed.',
    });
  } catch (err) {
    next(err);
  }
});

export { instancesRouter };
```

**`/instances/:instanceId/projects` does not validate that the instanceId exists**: In Phase 1, because we always return an empty stub, this does not matter. When CP-T006 is resolved, the handler must look up the instance by `instanceId` and return 404 if not found.

---

## 3. `GET /api/control-plane/health`

### 3.1 Check Runner Architecture

All 10 health checks run in parallel using `Promise.allSettled`. A settled check that throws is treated as an `error`-status check — it does not propagate and kill the response.

```typescript
// src/lib/health-aggregator/index.ts

async function runAllHealthChecks(): Promise<HealthSummaryResponse> {
  const checkedAt = new Date().toISOString();

  const checkFunctions: Array<() => Promise<HealthCheck>> = [
    checkDbReachability,
    checkDbSchemaVersion,
    checkVectorBackend,
    checkAnthropicKey,
    checkOpenAIKey,
    checkDefaultProvider,
    checkMcpIntegration,
    checkClaudeMdIntegration,
    checkRuntimeVersion,
    checkStaffEventsTable,
  ];

  const settled = await Promise.allSettled(
    checkFunctions.map(fn => fn())
  );

  const checks: HealthCheck[] = settled.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    // Check function itself threw — treat as error status
    console.error(`[health-aggregator] Check ${checkFunctions[i].name} threw:`, result.reason);
    return {
      name:    checkFunctions[i].name.replace(/^check/, '').replace(/([A-Z])/g, '_$1').toLowerCase().slice(1),
      status:  'error' as const,
      message: 'Health check failed unexpectedly',
      detail:  { error: String(result.reason) },
    };
  });

  const overall = computeOverall(checks);

  return { overall, checkedAt, checks };
}

function computeOverall(checks: HealthCheck[]): 'healthy' | 'degraded' | 'error' {
  if (checks.some(c => c.status === 'error'))   return 'error';
  if (checks.some(c => c.status === 'warn'))    return 'degraded';
  return 'healthy';
}
```

### 3.2 Individual Check Implementations

#### Check 1: `db_reachability`

```typescript
// src/lib/health-aggregator/checks/db-reachability.ts
import { prisma } from '../../db';  // Shared Prisma client

export async function checkDbReachability(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('DB query timeout')), 2000)
      ),
    ]);
    const latencyMs = Date.now() - start;
    return {
      name:    'db_reachability',
      status:  'ok',
      message: 'Connected',
      detail:  { latencyMs },
    };
  } catch (err) {
    return {
      name:    'db_reachability',
      status:  'error',
      message: 'Database connection failed',
      detail:  { error: String(err) },
    };
  }
}
```

**2-second timeout**: The DB query is raced against a 2-second timeout. If the DB does not respond within 2 seconds, the check returns `error`. The `Promise.race` timeout does not cancel the outstanding DB query — Prisma will eventually receive the response and discard it. This is acceptable for a local diagnostic endpoint.

#### Check 2: `db_schema_version`

```typescript
export async function checkDbSchemaVersion(): Promise<HealthCheck> {
  try {
    // Attempt to read the Prisma migration table (_prisma_migrations)
    // This table exists if Prisma migrations have been applied
    const rows = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
      SELECT migration_name, finished_at
      FROM _prisma_migrations
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1
    `;

    if (rows.length === 0) {
      return { name: 'db_schema_version', status: 'warn', message: 'No migrations found in _prisma_migrations' };
    }

    const latest = rows[0];
    if (!latest.finished_at) {
      return { name: 'db_schema_version', status: 'warn', message: 'Latest migration has not finished applying', detail: { migration: latest.migration_name } };
    }

    return {
      name:    'db_schema_version',
      status:  'ok',
      message: `Latest migration: ${latest.migration_name}`,
      detail:  { latestMigration: latest.migration_name, appliedAt: latest.finished_at.toISOString() },
    };
  } catch (err) {
    return {
      name:    'db_schema_version',
      status:  'error',
      message: 'Could not read migration table (_prisma_migrations not accessible)',
      detail:  { error: String(err) },
    };
  }
}
```

#### Check 3: `vector_backend`

```typescript
export async function checkVectorBackend(): Promise<HealthCheck> {
  try {
    const rows = await prisma.$queryRaw<{ installed_version: string | null }[]>`
      SELECT installed_version
      FROM pg_extension
      WHERE extname = 'vector'
      LIMIT 1
    `;

    if (rows.length === 0 || !rows[0].installed_version) {
      return {
        name:    'vector_backend',
        status:  'warn',
        message: 'pgvector extension not installed',
        detail:  { hint: 'Run: CREATE EXTENSION IF NOT EXISTS vector;' },
      };
    }

    return {
      name:    'vector_backend',
      status:  'ok',
      message: `pgvector installed (version ${rows[0].installed_version})`,
      detail:  { version: rows[0].installed_version },
    };
  } catch (err) {
    return {
      name:    'vector_backend',
      status:  'error',
      message: 'Failed to check pgvector status',
      detail:  { error: String(err) },
    };
  }
}
```

**`pg_extension` vs `pg_available_extensions`**: `pg_extension` lists installed extensions. `pg_available_extensions` lists what can be installed. The check uses `pg_extension` to confirm it is actually installed and active, not just available.

#### Check 4 & 5: `anthropic_key` and `openai_key`

```typescript
// Generic provider key check — reused for both Anthropic and OpenAI
function checkProviderKey(keyName: string, checkName: string) {
  return async (): Promise<HealthCheck> => {
    const value = process.env[keyName];
    const present = typeof value === 'string' && value.trim() !== '';

    return {
      name:    checkName,
      status:  present ? 'ok' : 'warn',
      message: present ? `${keyName} is present` : `${keyName} not found in environment`,
      // Never include the value or any portion of it in the response
    };
  };
}

export const checkAnthropicKey = checkProviderKey('ANTHROPIC_API_KEY', 'anthropic_key');
export const checkOpenAIKey    = checkProviderKey('OPENAI_API_KEY',    'openai_key');
```

**Environment variable source**: The health endpoint reads from `process.env` — i.e., the environment variables that were set when the control plane server process started. If the `.env.iranti` file is loaded via `dotenv` at startup (standard pattern), these keys will be available in `process.env`. If not loaded, they will be absent regardless of the env file's contents. Verify the startup sequence in the Iranti Express app to confirm `dotenv.config()` is called before route handlers execute.

#### Check 6: `default_provider_configured`

```typescript
export async function checkDefaultProvider(): Promise<HealthCheck> {
  // Candidate env var names — check in order; first non-empty value wins
  // CP-T003 flags that the actual key name is unconfirmed; verify against real Iranti
  const candidates = ['IRANTI_DEFAULT_PROVIDER', 'DEFAULT_PROVIDER'];
  const found = candidates.find(k => typeof process.env[k] === 'string' && process.env[k]!.trim() !== '');

  if (!found) {
    return {
      name:    'default_provider_configured',
      status:  'warn',
      message: 'No default provider configured (IRANTI_DEFAULT_PROVIDER not set)',
      detail:  { checked: candidates },
    };
  }

  const value     = process.env[found]!.trim().toLowerCase();
  const knownProviders = ['anthropic', 'openai'];
  const known          = knownProviders.includes(value);

  return {
    name:    'default_provider_configured',
    status:  known ? 'ok' : 'error',
    message: known
      ? `Default provider: ${value}`
      : `Default provider set to unknown value: ${value}`,
    detail: { key: found, value, knownProviders },
  };
}
```

#### Check 7: `mcp_integration`

```typescript
export async function checkMcpIntegration(): Promise<HealthCheck> {
  const mcpPath = path.join(process.cwd(), '.mcp.json');

  try {
    const raw    = await fs.readFile(mcpPath, 'utf8');
    const parsed = JSON.parse(raw);

    // Check for an 'iranti' server entry in the mcpServers map
    const servers     = parsed.mcpServers ?? parsed.servers ?? {};
    const hasIranti   = 'iranti' in servers ||
      Object.values(servers).some((s: unknown) =>
        typeof (s as { url?: string }).url === 'string' &&
        (s as { url: string }).url.includes('iranti')
      );

    return {
      name:    'mcp_integration',
      status:  hasIranti ? 'ok' : 'warn',
      message: hasIranti ? '.mcp.json present and Iranti entry found' : '.mcp.json present but no Iranti server entry',
      detail:  { path: mcpPath, servers: Object.keys(servers) },
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        name:    'mcp_integration',
        status:  'warn',
        message: '.mcp.json not found in current working directory',
        detail:  { path: mcpPath },
      };
    }
    // Malformed JSON or read error
    return {
      name:    'mcp_integration',
      status:  'warn',
      message: '.mcp.json present but could not be parsed',
      detail:  { path: mcpPath, error: String(err) },
    };
  }
}
```

#### Check 8: `claude_md_integration`

```typescript
export async function checkClaudeMdIntegration(): Promise<HealthCheck> {
  const claudeMdPath = path.join(process.cwd(), 'CLAUDE.md');

  try {
    const content  = await fs.readFile(claudeMdPath, 'utf8');
    const patterns = ['iranti', 'localhost:3001', 'mcp__iranti'];
    const hasRef   = patterns.some(p => content.toLowerCase().includes(p.toLowerCase()));

    return {
      name:    'claude_md_integration',
      status:  hasRef ? 'ok' : 'warn',
      message: hasRef
        ? 'CLAUDE.md present and references Iranti'
        : 'CLAUDE.md present but no Iranti reference detected',
      detail:  { path: claudeMdPath, patternsChecked: patterns },
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        name:    'claude_md_integration',
        status:  'warn',
        message: 'CLAUDE.md not found in current working directory',
        detail:  { path: claudeMdPath },
      };
    }
    return {
      name:    'claude_md_integration',
      status:  'warn',
      message: 'CLAUDE.md could not be read',
      detail:  { path: claudeMdPath, error: String(err) },
    };
  }
}
```

#### Check 9: `runtime_version`

```typescript
export async function checkRuntimeVersion(): Promise<HealthCheck> {
  // Try reading version from own package.json first
  let version: string | null = null;

  const pkgCandidates = [
    path.join(process.cwd(), 'package.json'),
    path.join(process.cwd(), 'node_modules', 'iranti', 'package.json'),
  ];

  for (const pkgPath of pkgCandidates) {
    try {
      const raw    = await fs.readFile(pkgPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (typeof parsed.version === 'string') {
        version = parsed.version;
        break;
      }
    } catch { /* try next */ }
  }

  // npm registry check omitted in Phase 1 (network call, adds latency, offline risk)
  // latestVersionAvailable is out of scope per CP-T003 §1.1

  if (!version) {
    return {
      name:    'runtime_version',
      status:  'warn',
      message: 'Could not detect Iranti runtime version',
      detail:  { checked: pkgCandidates },
    };
  }

  return {
    name:    'runtime_version',
    status:  'ok',
    message: `Running Iranti version ${version}`,
    detail:  { version },
  };
}
```

#### Check 10: `staff_events_table`

```typescript
export async function checkStaffEventsTable(): Promise<HealthCheck> {
  try {
    const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name   = 'staff_events'
      ) AS exists
    `;

    const exists = rows[0]?.exists ?? false;

    return {
      name:    'staff_events_table',
      status:  exists ? 'ok' : 'warn',
      message: exists
        ? 'staff_events table exists'
        : 'staff_events table missing — CP-T001 migration not applied; event stream will not work',
      detail:  exists ? undefined : { hint: 'Apply the CP-T001 migration to create the staff_events table.' },
    };
  } catch (err) {
    return {
      name:    'staff_events_table',
      status:  'error',
      message: 'Could not check staff_events table existence',
      detail:  { error: String(err) },
    };
  }
}
```

### 3.3 Route Handler

```typescript
// src/routes/control-plane/health.ts
import { Router, Request, Response, NextFunction } from 'express';
import { runAllHealthChecks } from '../../lib/health-aggregator';

const healthRouter = Router();

healthRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await runAllHealthChecks();
    // Always 200 — HTTP status reflects whether the health endpoint itself worked,
    // not the health of the system. See CP-T002 §Group 6 error states.
    return res.status(200).json(result);
  } catch (err) {
    // Only if runAllHealthChecks itself throws (should not happen due to allSettled)
    next(err);
  }
});

export { healthRouter };
```

---

## 4. Acceptance Criteria Checklist (Pre-PM Review)

- [ ] `GET /instances` returns `InstanceListResponse` with `discoveredAt` and `discoverySource`
- [ ] Registry file read attempted first; fallback scan triggered when registry absent/empty
- [ ] `instanceId` is a deterministic 8-char hash of normalized `runtimeRoot`
- [ ] `database.urlRedacted` shows `postgresql://***@host:port/dbname` — no credentials
- [ ] API key values are never returned — only boolean presence
- [ ] Missing `.env.iranti`: `envFile.present: false`, database null, integration keys all false
- [ ] Instance not running: `runningStatus: 'stopped'` or `'unreachable'`; all config fields still populated
- [ ] Health probe timeout: 500ms maximum — verified by testing with a stopped instance
- [ ] `GET /instances/:instanceId/projects` returns stub with `projectBindingsUnavailable: true`
- [ ] `GET /health` returns all 10 required checks
- [ ] `overall` status: `healthy`/`degraded`/`error` logic verified
- [ ] `staff_events_table` check returns `warn` when table missing
- [ ] Both endpoints return 200 even for `error` overall status
- [ ] `path.join()` and `os.homedir()` used throughout — no hardcoded path separators
- [ ] Tested on Windows (developer machine is Windows 11 — this is the primary platform to verify)

---

## 5. Open Questions (Flagged for Implementer)

1. **`IRANTI_DEFAULT_PROVIDER` key name**: Confirm against actual Iranti `.env.iranti` docs or source. If wrong, the `default_provider_configured` health check and `integration.defaultProvider` field will always be null/warn.
2. **`dotenv` startup**: Confirm that `dotenv.config()` is called before route registration in the Iranti Express app. If not, environment variables read by health checks from `process.env` will not reflect `.env.iranti` contents.
3. **`instances.json` registry**: Does any current Iranti installation write this file? If not, the control plane will always fall back to the candidate scan in Phase 1. Document this finding so the PM can decide whether to add registry writing to the Iranti onboarding flow.
4. **Health endpoint shape**: Does the current Iranti `/health` endpoint return a JSON body with a `version` field? If not, the version field will always be populated from `package.json` fallback.
5. **`lastActiveTimestamp`**: This field is stubbed as `null` in the `ProjectBinding` objects returned by the instance aggregator. The CP-T003 spec's proposed query (`SELECT MAX(created_at) FROM knowledge_base WHERE agent_id IN ...`) is approximate and requires a confirmed agent-to-project mapping. Leave as `null` and document.
