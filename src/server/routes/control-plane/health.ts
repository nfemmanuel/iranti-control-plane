/**
 * Health summary route
 *
 * GET /health — runs all 10 checks in parallel via Promise.allSettled
 *
 * Always returns HTTP 200. The `overall` field reflects system health.
 * Individual check failures are surfaced inside the `checks` array.
 *
 * Checks:
 *   1. db_reachability        — SELECT 1 with 2s timeout
 *   2. db_schema_version      — _prisma_migrations latest entry
 *   3. vector_backend         — pg_extension WHERE extname = 'vector'
 *   4. anthropic_key          — ANTHROPIC_API_KEY in env
 *   5. openai_key             — OPENAI_API_KEY in env
 *   6. default_provider_configured — LLM_PROVIDER (authoritative, from instance env)
 *   7. mcp_integration        — .mcp.json in cwd
 *   8. claude_md_integration  — CLAUDE.md in cwd
 *   9. runtime_version        — live probe of Iranti /health endpoint
 *  10. staff_events_table     — information_schema.tables check
 */

import { Router, Request, Response, NextFunction } from 'express'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { query, env } from '../../db.js'
import { HealthCheck, HealthResponse, ApiError } from '../../types.js'

// ---------------------------------------------------------------------------
// CP-T072: Runtime lifecycle types
// ---------------------------------------------------------------------------

export interface IrantiRuntimeMetadata {
  instanceName: string
  pid: number
  port: number
  startedAt: string
  lastHeartbeatAt: string
  updatedAt: string
  status: 'starting' | 'running' | 'stopping' | 'stopped'
  version?: string
  healthUrl?: string | null
}

export type RuntimeStatus = 'running' | 'stale' | 'stopped' | 'unknown'

/**
 * Staleness threshold: if runtime.status === 'running' but lastHeartbeatAt is
 * more than STALE_THRESHOLD_MS milliseconds old, the instance is considered stale.
 * CP-T072 implementation spec: 30 seconds.
 */
const STALE_THRESHOLD_MS = 30_000

export function deriveRuntimeStatus(runtime: IrantiRuntimeMetadata | null): RuntimeStatus {
  if (!runtime) return 'unknown'
  if (runtime.status === 'stopped' || runtime.status === 'stopping') return 'stopped'
  if (runtime.status === 'running') {
    const heartbeat = Date.parse(runtime.lastHeartbeatAt)
    if (isNaN(heartbeat)) return 'stale'
    const ageMs = Date.now() - heartbeat
    return ageMs > STALE_THRESHOLD_MS ? 'stale' : 'running'
  }
  // 'starting' or any unknown status
  return 'unknown'
}

/**
 * Fetch the Iranti /health response and extract the runtime field.
 * Returns null if Iranti is unreachable or returns no runtime field.
 */
async function fetchIrantiRuntime(): Promise<IrantiRuntimeMetadata | null> {
  const baseUrl = (env['IRANTI_URL'] ?? process.env['IRANTI_URL'] ?? 'http://localhost:3001').replace(/\/$/, '')
  const apiKey = env['IRANTI_API_KEY'] ?? process.env['IRANTI_API_KEY'] ?? ''

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['X-Iranti-Key'] = apiKey

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })

    if (!res.ok) return null

    const body = await res.json() as Record<string, unknown>
    const runtime = body['runtime']

    if (!runtime || typeof runtime !== 'object') return null

    const r = runtime as Record<string, unknown>

    // Validate required fields before accepting
    if (
      typeof r['instanceName'] !== 'string' ||
      typeof r['pid'] !== 'number' ||
      typeof r['port'] !== 'number' ||
      typeof r['startedAt'] !== 'string' ||
      typeof r['lastHeartbeatAt'] !== 'string' ||
      typeof r['status'] !== 'string'
    ) {
      return null
    }

    return {
      instanceName: r['instanceName'],
      pid: r['pid'],
      port: r['port'],
      startedAt: r['startedAt'],
      lastHeartbeatAt: r['lastHeartbeatAt'],
      updatedAt: typeof r['updatedAt'] === 'string' ? r['updatedAt'] : r['lastHeartbeatAt'],
      status: r['status'] as IrantiRuntimeMetadata['status'],
      version: typeof r['version'] === 'string' ? r['version'] : undefined,
      healthUrl: typeof r['healthUrl'] === 'string' ? r['healthUrl'] : null,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export const healthRouter = Router()

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

async function checkDbReachability(): Promise<HealthCheck> {
  const start = Date.now()
  try {
    await Promise.race([
      query('SELECT 1'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DB query timeout after 2s')), 2000)
      ),
    ])
    return {
      name: 'db_reachability',
      status: 'ok',
      message: 'Connected',
      detail: { latencyMs: Date.now() - start },
    }
  } catch (err) {
    return {
      name: 'db_reachability',
      status: 'error',
      message: 'Database connection failed',
      detail: { error: String(err) },
    }
  }
}

async function checkDbSchemaVersion(): Promise<HealthCheck> {
  try {
    const result = await query<{ migration_name: string; finished_at: Date | null }>(
      `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1`
    )

    if (result.rows.length === 0) {
      return {
        name: 'db_schema_version',
        status: 'warn',
        message: 'No migrations found in _prisma_migrations',
      }
    }

    const latest = result.rows[0]
    if (!latest.finished_at) {
      return {
        name: 'db_schema_version',
        status: 'warn',
        message: 'Latest migration has not finished applying',
        detail: { migration: latest.migration_name },
      }
    }

    return {
      name: 'db_schema_version',
      status: 'ok',
      message: `Latest migration: ${latest.migration_name}`,
      detail: {
        latestMigration: latest.migration_name,
        appliedAt: latest.finished_at.toISOString(),
      },
    }
  } catch (err) {
    return {
      name: 'db_schema_version',
      status: 'warn',
      message: 'Could not read migration table (_prisma_migrations not accessible)',
      detail: { error: String(err) },
    }
  }
}

async function checkVectorBackend(): Promise<HealthCheck> {
  try {
    const result = await query<{ extversion: string | null }>(
      `SELECT extversion FROM pg_extension WHERE extname = 'vector' LIMIT 1`
    )

    if (result.rows.length === 0 || !result.rows[0].extversion) {
      return {
        name: 'vector_backend',
        status: 'warn',
        message: 'pgvector extension not installed',
        detail: { hint: 'Run: CREATE EXTENSION IF NOT EXISTS vector;' },
      }
    }

    return {
      name: 'vector_backend',
      status: 'ok',
      message: `pgvector installed (version ${result.rows[0].extversion})`,
      detail: { version: result.rows[0].extversion },
    }
  } catch (err) {
    return {
      name: 'vector_backend',
      status: 'error',
      message: 'Failed to check pgvector status',
      detail: { error: String(err) },
    }
  }
}

/**
 * Check whether a provider API key is present.
 * Severity rules:
 *   - key present → ok (regardless of active provider)
 *   - key absent AND this provider IS the active default or in the fallback chain → warn
 *   - key absent AND this provider is NOT active and NOT in the fallback chain → ok
 *     (absent key for an inactive provider is expected, not a warning)
 *
 * Active provider is read from LLM_PROVIDER in the instance env (authoritative).
 * Fallback chain is read from LLM_PROVIDER_FALLBACK.
 *
 * SECURITY: never include key value or any part of it in the result.
 */
function makeProviderKeyCheck(
  keyName: string,
  checkName: string,
  providerName: string
): () => Promise<HealthCheck> {
  return async (): Promise<HealthCheck> => {
    const value = process.env[keyName] ?? env[keyName]
    const present = typeof value === 'string' && value.trim() !== ''

    if (present) {
      return {
        name: checkName,
        status: 'ok',
        message: `${keyName} is set`,
      }
    }

    // Key absent — check whether this provider is actually in use
    const activeProvider = (
      process.env['LLM_PROVIDER'] ?? env['LLM_PROVIDER'] ?? ''
    ).trim().toLowerCase()
    const fallbackChain = (
      process.env['LLM_PROVIDER_FALLBACK'] ?? env['LLM_PROVIDER_FALLBACK'] ?? ''
    ).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

    const isActiveOrFallback =
      activeProvider === providerName || fallbackChain.includes(providerName)

    if (!isActiveOrFallback) {
      // Key is absent but provider is not the active default or fallback — expected state
      return {
        name: checkName,
        status: 'ok',
        message: `${keyName} not set — ${providerName} is not the active provider`,
        detail: { activeProvider: activeProvider || 'not set' },
      }
    }

    // Key absent and provider IS active/fallback — this is a real problem
    return {
      name: checkName,
      status: 'warn',
      message: `${keyName} not found — ${providerName} is the active provider but has no API key configured`,
      detail: { activeProvider },
    }
  }
}

const checkAnthropicKey = makeProviderKeyCheck('ANTHROPIC_API_KEY', 'anthropic_key', 'anthropic')
const checkOpenAIKey = makeProviderKeyCheck('OPENAI_API_KEY', 'openai_key', 'openai')

async function checkDefaultProvider(): Promise<HealthCheck> {
  // LLM_PROVIDER is the authoritative Iranti runtime var — set in the instance .env
  // (e.g. ~/.iranti-runtime/instances/local/.env) and merged into the CP env by db.ts
  // via the IRANTI_INSTANCE_ENV pointer. Project-binding files (.env.iranti) must NOT
  // set this var; they are connector pointers only and do not configure runtime behaviour.
  // IRANTI_DEFAULT_PROVIDER / DEFAULT_PROVIDER were CP-specific vars that blurred this
  // authority boundary — they have been removed from project binding files.
  const candidates = ['LLM_PROVIDER']
  const found = candidates.find((k) => {
    const val = process.env[k] ?? env[k]
    return typeof val === 'string' && val.trim() !== ''
  })

  if (!found) {
    return {
      name: 'default_provider_configured',
      status: 'warn',
      message: 'No default provider configured (LLM_PROVIDER not set in instance env)',
      detail: {
        checked: candidates,
        hint: 'Set LLM_PROVIDER in the instance .env file (e.g. LLM_PROVIDER=openai) and restart Iranti.',
      },
    }
  }

  const value = (process.env[found] ?? env[found] ?? '').trim().toLowerCase()
  const knownProviders = ['anthropic', 'openai', 'ollama', 'groq', 'mistral', 'together', 'gemini']
  const known = knownProviders.includes(value)

  return {
    name: 'default_provider_configured',
    status: known ? 'ok' : 'error',
    message: known
      ? `Default provider: ${value}`
      : `Default provider set to unknown value: ${value}`,
    detail: { key: found, value, knownProviders },
  }
}

async function checkMcpIntegration(): Promise<HealthCheck> {
  const mcpPath = join(process.cwd(), '.mcp.json')
  try {
    const raw = await readFile(mcpPath, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const servers = (parsed.mcpServers ?? parsed.servers ?? {}) as Record<string, unknown>
    const hasIranti =
      'iranti' in servers ||
      Object.values(servers).some(
        (s) =>
          typeof (s as Record<string, unknown>).url === 'string' &&
          ((s as Record<string, string>).url).includes('iranti')
      )

    return {
      name: 'mcp_integration',
      status: hasIranti ? 'ok' : 'warn',
      message: hasIranti
        ? '.mcp.json present and Iranti entry found'
        : '.mcp.json present but no Iranti server entry',
      detail: { path: mcpPath, servers: Object.keys(servers) },
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        name: 'mcp_integration',
        status: 'warn',
        message: '.mcp.json not found in current working directory',
        detail: { path: mcpPath },
      }
    }
    return {
      name: 'mcp_integration',
      status: 'warn',
      message: '.mcp.json present but could not be parsed',
      detail: { path: mcpPath, error: String(err) },
    }
  }
}

async function checkClaudeMdIntegration(): Promise<HealthCheck> {
  const claudeMdPath = join(process.cwd(), 'CLAUDE.md')
  try {
    const content = await readFile(claudeMdPath, 'utf8')
    const patterns = ['iranti', 'localhost:3001', 'mcp__iranti']
    const hasRef = patterns.some((p) => content.toLowerCase().includes(p.toLowerCase()))

    return {
      name: 'claude_md_integration',
      status: hasRef ? 'ok' : 'warn',
      message: hasRef
        ? 'CLAUDE.md present and references Iranti'
        : 'CLAUDE.md present but no Iranti reference detected',
      detail: { path: claudeMdPath, patternsChecked: patterns },
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        name: 'claude_md_integration',
        status: 'warn',
        message: 'CLAUDE.md not found in current working directory',
        detail: { path: claudeMdPath },
      }
    }
    return {
      name: 'claude_md_integration',
      status: 'warn',
      message: 'CLAUDE.md could not be read',
      detail: { path: claudeMdPath, error: String(err) },
    }
  }
}

async function checkRuntimeVersion(): Promise<HealthCheck> {
  // Fetch the live Iranti runtime version from its /health endpoint.
  // This is the authoritative source — the runtime version lives in the running
  // Iranti process, not in any local package.json.
  // The control-plane's own version is separate and is not surfaced here.
  const baseUrl = (env['IRANTI_URL'] ?? process.env['IRANTI_URL'] ?? 'http://localhost:3001').replace(/\/$/, '')
  const apiKey = env['IRANTI_API_KEY'] ?? process.env['IRANTI_API_KEY'] ?? ''

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['X-Iranti-Key'] = apiKey

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })

    if (!res.ok) {
      return {
        name: 'runtime_version',
        status: 'warn',
        message: 'Could not read Iranti runtime version — Iranti may not be running',
        detail: { hint: 'Start Iranti: iranti run --instance <name>' },
      }
    }

    const body = await res.json() as Record<string, unknown>

    // Prefer runtime.version (added in v0.2.16); fall back to top-level version field
    const runtime = body['runtime']
    let version: string | null = null
    if (runtime && typeof runtime === 'object') {
      const r = runtime as Record<string, unknown>
      if (typeof r['version'] === 'string' && r['version']) {
        version = r['version']
      }
    }
    if (!version && typeof body['version'] === 'string' && body['version']) {
      version = body['version']
    }

    if (!version) {
      return {
        name: 'runtime_version',
        status: 'warn',
        message: 'Iranti is running but did not report a version',
        detail: { url: `${baseUrl}/health` },
      }
    }

    return {
      name: 'runtime_version',
      status: 'ok',
      message: `Iranti runtime v${version}`,
      detail: { version, source: `${baseUrl}/health` },
    }
  } catch {
    return {
      name: 'runtime_version',
      status: 'warn',
      message: 'Could not reach Iranti to check runtime version',
      detail: { hint: 'Start Iranti: iranti run --instance <name>' },
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function checkStaffEventsTable(): Promise<HealthCheck> {
  try {
    const result = await query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'staff_events'
      ) AS exists`
    )

    const exists = result.rows[0]?.exists ?? false

    return {
      name: 'staff_events_table',
      status: exists ? 'ok' : 'warn',
      message: exists
        ? 'staff_events table exists'
        : 'staff_events table missing — run control plane migrations to enable the Staff Activity Stream',
      detail: exists ? undefined : { hint: 'Run: npm run migrate from your iranti-control-plane directory' },
    }
  } catch (err) {
    return {
      name: 'staff_events_table',
      status: 'error',
      message: 'Could not check staff_events table existence',
      detail: { error: String(err) },
    }
  }
}

// ---------------------------------------------------------------------------
// CP-T052: Decay config builder
// ---------------------------------------------------------------------------

interface DecayConfig {
  enabled: boolean
  stabilityBase: number
  stabilityIncrement: number
  stabilityMax: number
  decayThreshold: number
}

function buildDecayConfig(): DecayConfig {
  const getVal = (key: string): string =>
    process.env[key] ?? env[key] ?? ''

  const enabled = (getVal('IRANTI_DECAY_ENABLED') || 'false').toLowerCase() === 'true'
  const stabilityBase = parseInt(getVal('IRANTI_DECAY_STABILITY_BASE') || '30', 10)
  const stabilityIncrement = parseInt(getVal('IRANTI_DECAY_STABILITY_INCREMENT') || '5', 10)
  const stabilityMax = parseInt(getVal('IRANTI_DECAY_STABILITY_MAX') || '365', 10)
  const decayThreshold = parseInt(getVal('IRANTI_DECAY_THRESHOLD') || '10', 10)

  return {
    enabled,
    stabilityBase: isNaN(stabilityBase) ? 30 : stabilityBase,
    stabilityIncrement: isNaN(stabilityIncrement) ? 5 : stabilityIncrement,
    stabilityMax: isNaN(stabilityMax) ? 365 : stabilityMax,
    decayThreshold: isNaN(decayThreshold) ? 10 : decayThreshold,
  }
}

// ---------------------------------------------------------------------------
// CP-T052: Vector backend builder
// ---------------------------------------------------------------------------

type VectorBackendType = 'pgvector' | 'qdrant' | 'chroma' | 'unknown'
type VectorBackendStatus = 'ok' | 'warn' | 'error'

interface VectorBackendInfo {
  type: VectorBackendType
  configured: boolean
  url: string | null
  status: VectorBackendStatus
}

async function buildVectorBackendInfo(): Promise<VectorBackendInfo> {
  const getVal = (key: string): string =>
    process.env[key] ?? env[key] ?? ''

  const raw = getVal('IRANTI_VECTOR_BACKEND').trim().toLowerCase()

  let type: VectorBackendType
  if (raw === 'qdrant') type = 'qdrant'
  else if (raw === 'chroma') type = 'chroma'
  else if (raw === 'pgvector' || raw === '') type = 'pgvector'
  else type = 'unknown'

  if (type === 'pgvector' || type === 'unknown') {
    // pgvector reachability is covered by the existing db_reachability check.
    // unknown defaults to pgvector behaviour.
    return {
      type,
      configured: type === 'pgvector',
      url: null,
      status: 'ok',
    }
  }

  // qdrant or chroma — probe the configured URL
  const urlKey = type === 'qdrant' ? 'IRANTI_QDRANT_URL' : 'IRANTI_CHROMA_URL'
  const url = getVal(urlKey).trim()

  if (!url) {
    return {
      type,
      configured: false,
      url: null,
      status: 'warn',
    }
  }

  let status: VectorBackendStatus = 'error'
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    try {
      const probe = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      })
      status = probe.status < 500 ? 'ok' : 'warn'
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    status = 'error'
  }

  return {
    type,
    configured: true,
    url,
    status,
  }
}

// ---------------------------------------------------------------------------
// CP-T052: Attendant status — live probe
// ---------------------------------------------------------------------------

interface AttendantStatus {
  status: 'ok' | 'warn' | 'error' | 'unreachable'
  message: string
  checkedAt: string
}

/**
 * Probe the live Iranti Attendant by calling POST /memory/attend with a
 * minimal diagnostic payload. Returns a status and operator-readable message.
 * This replaces the previous static hardcoded message so the surface reflects
 * the actual attendant state rather than internal engineering notes.
 */
async function buildAttendantStatus(): Promise<AttendantStatus> {
  const baseUrl = (env['IRANTI_URL'] ?? process.env['IRANTI_URL'] ?? 'http://localhost:3001').replace(/\/$/, '')
  const apiKey = env['IRANTI_API_KEY'] ?? process.env['IRANTI_API_KEY'] ?? ''
  const checkedAt = new Date().toISOString()

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['X-Iranti-Key'] = apiKey

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const res = await fetch(`${baseUrl}/memory/attend`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent: 'control_plane_operator',
        query: 'health check probe',
        currentContext: 'health check probe',
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const isUnreachable = res.status === 404 || res.status === 503
      return {
        status: isUnreachable ? 'unreachable' : 'error',
        message: isUnreachable
          ? 'Attendant route not available — Iranti may not be running'
          : `Attendant returned HTTP ${res.status}`,
        checkedAt,
      }
    }

    // Parse for known classifier failure indicator
    let parseFailed = false
    try {
      const body = await res.json() as unknown
      if (JSON.stringify(body).includes('classification_parse_failed_default_false')) {
        parseFailed = true
      }
    } catch { /* 200 response — treat as ok even if body parse fails */ }

    if (parseFailed) {
      return {
        status: 'warn',
        message: 'Attendant responded but classifier reported a parse failure — memory injection may be unreliable. Use forceInject: true in iranti_attend as a workaround.',
        checkedAt,
      }
    }

    return {
      status: 'ok',
      message: 'Attendant is responding normally',
      checkedAt,
    }
  } catch {
    return {
      status: 'unreachable',
      message: 'Could not reach Attendant endpoint — Iranti may not be running',
      checkedAt,
    }
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

/**
 * Checks that affect the overall runtime health status.
 * Integration/setup checks (mcp_integration, claude_md_integration,
 * staff_events_table) are NOT included — they are informational and should
 * not degrade overall status when Iranti itself is healthy.
 */
const RUNTIME_CHECK_NAMES = new Set([
  'db_reachability',
  'db_schema_version',
  'vector_backend',
  'anthropic_key',
  'openai_key',
  'default_provider_configured',
  'runtime_version',
])

function computeOverall(checks: HealthCheck[]): 'healthy' | 'degraded' | 'error' {
  const runtime = checks.filter((c) => RUNTIME_CHECK_NAMES.has(c.name))
  if (runtime.some((c) => c.status === 'error')) return 'error'
  if (runtime.some((c) => c.status === 'warn')) return 'degraded'
  return 'healthy'
}

export async function runAllHealthChecks(): Promise<HealthResponse> {
  const checkedAt = new Date().toISOString()

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
  ]

  const [settled, runtime] = await Promise.all([
    Promise.allSettled(checkFunctions.map((fn) => fn())),
    fetchIrantiRuntime(),
  ])

  const checks: HealthCheck[] = settled.map((result, i) => {
    if (result.status === 'fulfilled') return result.value
    console.error(`[health] Check ${checkFunctions[i].name} threw:`, result.reason)
    return {
      name: checkFunctions[i].name.replace(/^check/, '').replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, ''),
      status: 'error' as const,
      message: 'Health check failed unexpectedly',
      detail: { error: String(result.reason) },
    }
  })

  const runtimeStatus = deriveRuntimeStatus(runtime)

  return {
    overall: computeOverall(checks),
    checks,
    checkedAt,
    runtime,
    runtimeStatus,
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

healthRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [result, vectorBackend, attendant] = await Promise.all([
      runAllHealthChecks(),
      buildVectorBackendInfo(),
      buildAttendantStatus(),
    ])
    // Always 200 — HTTP status reflects whether the endpoint itself worked.
    //
    // Note: `decay`, `vectorBackend`, and `attendant` are returned as top-level
    // fields alongside `checks`, not inside `checks`. This means a vectorBackend
    // probe failure does NOT affect the `overall` field, which is computed only
    // from the `checks` array. This is intentional — the operator capability fields
    // are additive context, not system-health gates. The UI must surface vectorBackend
    // status independently from the overall status indicator.
    res.status(200).json({
      ...result,
      decay: buildDecayConfig(),
      vectorBackend,
      attendant,
    })
  } catch (err) {
    next(err)
  }
})

healthRouter.use(
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const apiErr = err as ApiError
    res.status(apiErr.statusCode ?? 500).json({
      error: apiErr.message ?? 'Internal server error',
      code: apiErr.code ?? 'INTERNAL_ERROR',
    })
  }
)
