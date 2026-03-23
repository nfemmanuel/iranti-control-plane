import { Router, Request, Response, NextFunction } from 'express'
import pg from 'pg'
import { HealthCheck, HealthResponse, ApiError, InstanceScopeSummary } from '../../types.js'
import { resolveInstanceAuthority, ResolvedInstanceAuthority } from '../../lib/instance-authority.js'
import { inspectProjectIntegration } from '../../lib/project-integration.js'

export const healthRouter = Router()
const { Pool } = pg

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

const STALE_THRESHOLD_MS = 30_000

export function deriveRuntimeStatus(runtime: IrantiRuntimeMetadata | null): RuntimeStatus {
  if (!runtime) return 'unknown'
  if (runtime.status === 'stopped' || runtime.status === 'stopping') return 'stopped'
  if (runtime.status === 'running') {
    const heartbeat = Date.parse(runtime.lastHeartbeatAt)
    if (Number.isNaN(heartbeat)) return 'stale'
    return Date.now() - heartbeat > STALE_THRESHOLD_MS ? 'stale' : 'running'
  }
  return 'unknown'
}

interface DecayConfig {
  enabled: boolean
  stabilityBase: number
  stabilityIncrement: number
  stabilityMax: number
  decayThreshold: number
}

type VectorBackendType = 'pgvector' | 'qdrant' | 'chroma' | 'unknown'
type VectorBackendStatus = 'ok' | 'warn' | 'error'

interface VectorBackendInfo {
  type: VectorBackendType
  configured: boolean
  url: string | null
  status: VectorBackendStatus
}

interface AttendantStatus {
  status: 'ok' | 'warn' | 'error' | 'unreachable'
  message: string
  checkedAt: string
}

const RUNTIME_CHECK_NAMES = new Set([
  'db_reachability',
  'db_schema_version',
  'vector_backend',
  'anthropic_key',
  'openai_key',
  'default_provider_configured',
  'runtime_version',
])

function scopeSummary(scope: ResolvedInstanceAuthority): InstanceScopeSummary {
  return {
    instanceId: scope.instanceId,
    instanceName: scope.instanceName,
    source: scope.source,
  }
}

async function resolveScopeOrThrow(instanceRef?: string): Promise<ResolvedInstanceAuthority> {
  const scope = await resolveInstanceAuthority(instanceRef)
  if (!scope) {
    const err = new Error('Instance not found') as ApiError
    err.statusCode = 404
    err.code = 'INSTANCE_NOT_FOUND'
    throw err
  }
  return scope
}

function buildHeaders(scope: ResolvedInstanceAuthority): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (scope.apiKey) headers['X-Iranti-Key'] = scope.apiKey
  return headers
}

async function withScopedPool<T>(
  databaseUrl: string | null,
  fn: (pool: pg.Pool | null) => Promise<T>
): Promise<T> {
  if (!databaseUrl) return fn(null)
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 3000,
  })

  try {
    return await fn(pool)
  } finally {
    await pool.end().catch(() => {})
  }
}

async function fetchInstanceHealth(scope: ResolvedInstanceAuthority): Promise<Record<string, unknown> | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)
  try {
    const res = await fetch(`${scope.apiBaseUrl}/health`, {
      method: 'GET',
      headers: buildHeaders(scope),
      signal: controller.signal,
    })
    if (!res.ok) return null
    return await res.json() as Record<string, unknown>
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchIrantiRuntime(scope: ResolvedInstanceAuthority): Promise<IrantiRuntimeMetadata | null> {
  const body = await fetchInstanceHealth(scope)
  if (!body) return null
  const runtime = body['runtime']
  if (!runtime || typeof runtime !== 'object') return null

  const r = runtime as Record<string, unknown>
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
}

async function checkDbReachability(pool: pg.Pool | null): Promise<HealthCheck> {
  if (!pool) {
    return {
      name: 'db_reachability',
      status: 'error',
      message: 'DATABASE_URL is not configured for this instance',
    }
  }

  const start = Date.now()
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB query timeout after 2s')), 2000)),
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

async function checkDbSchemaVersion(pool: pg.Pool | null): Promise<HealthCheck> {
  if (!pool) {
    return {
      name: 'db_schema_version',
      status: 'warn',
      message: 'DATABASE_URL is not configured for this instance',
    }
  }

  try {
    const result = await pool.query<{ migration_name: string; finished_at: Date | null }>(
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

async function checkVectorBackend(scope: ResolvedInstanceAuthority, pool: pg.Pool | null): Promise<HealthCheck> {
  const raw = (scope.env['IRANTI_VECTOR_BACKEND'] ?? '').trim().toLowerCase()
  const type = raw === 'qdrant' || raw === 'chroma' ? raw : 'pgvector'

  if (type === 'pgvector') {
    if (!pool) {
      return {
        name: 'vector_backend',
        status: 'warn',
        message: 'DATABASE_URL is not configured for this instance',
      }
    }

    try {
      const result = await pool.query<{ extversion: string | null }>(
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

  const urlKey = type === 'qdrant' ? 'IRANTI_QDRANT_URL' : 'IRANTI_CHROMA_URL'
  const url = scope.env[urlKey]?.trim() ?? ''
  if (!url) {
    return {
      name: 'vector_backend',
      status: 'warn',
      message: `${type} is configured but ${urlKey} is missing`,
    }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    try {
      const probe = await fetch(url, { method: 'GET', signal: controller.signal })
      return {
        name: 'vector_backend',
        status: probe.status < 500 ? 'ok' : 'warn',
        message: probe.status < 500
          ? `${type} reachable at ${url}`
          : `${type} returned HTTP ${probe.status} at ${url}`,
      }
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return {
      name: 'vector_backend',
      status: 'error',
      message: `${type} is unreachable at ${url}`,
    }
  }
}

function makeProviderKeyCheck(
  scope: ResolvedInstanceAuthority,
  keyName: string,
  checkName: string,
  providerName: string
): HealthCheck {
  const present = (scope.env[keyName] ?? '').trim() !== ''
  if (present) {
    return { name: checkName, status: 'ok', message: `${keyName} is set` }
  }

  const activeProvider = (scope.env['LLM_PROVIDER'] ?? '').trim().toLowerCase()
  const fallbackChain = (scope.env['LLM_PROVIDER_FALLBACK'] ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)

  if (activeProvider !== providerName && !fallbackChain.includes(providerName)) {
    return {
      name: checkName,
      status: 'ok',
      message: `${keyName} not set — ${providerName} is not the active provider`,
      detail: { activeProvider: activeProvider || 'not set' },
    }
  }

  return {
    name: checkName,
    status: 'warn',
    message: `${keyName} not found — ${providerName} is active but has no API key configured`,
    detail: { activeProvider },
  }
}

function checkDefaultProvider(scope: ResolvedInstanceAuthority): HealthCheck {
  const value = (scope.env['LLM_PROVIDER'] ?? '').trim().toLowerCase()
  if (!value) {
    return {
      name: 'default_provider_configured',
      status: 'warn',
      message: 'No default provider configured (LLM_PROVIDER not set in instance env)',
    }
  }

  const knownProviders = ['anthropic', 'openai', 'ollama', 'groq', 'mistral', 'together', 'gemini']
  const known = knownProviders.includes(value)
  return {
    name: 'default_provider_configured',
    status: known ? 'ok' : 'error',
    message: known ? `Default provider: ${value}` : `Default provider set to unknown value: ${value}`,
    detail: { value, knownProviders },
  }
}

function summarizeProjectIntegration(
  scope: ResolvedInstanceAuthority,
  checkName: 'mcp_integration' | 'claude_md_integration'
): HealthCheck {
  if (scope.boundProjects.length === 0) {
    return {
      name: checkName,
      status: 'warn',
      message: 'No bound projects found for this instance. Project integration cannot be verified until a project is bound.',
    }
  }

  const statuses = scope.boundProjects.map((project) => inspectProjectIntegration(project.projectPath))
  const healthyCount = statuses.filter((status) =>
    checkName === 'mcp_integration'
      ? status.mcpJsonPresent && status.mcpJsonHasIranti
      : status.claudeMdPresent && status.claudeMdHasIranti
  ).length

  const label = checkName === 'mcp_integration' ? '.mcp.json' : 'CLAUDE.md'
  if (healthyCount === statuses.length) {
    return {
      name: checkName,
      status: 'ok',
      message: `${label} is configured for all ${statuses.length} bound project${statuses.length === 1 ? '' : 's'}`,
    }
  }

  const missingProjects = statuses
    .filter((status) =>
      checkName === 'mcp_integration'
        ? !(status.mcpJsonPresent && status.mcpJsonHasIranti)
        : !(status.claudeMdPresent && status.claudeMdHasIranti)
    )
    .map((status) => status.projectPath)

  return {
    name: checkName,
    status: 'warn',
    message: `${healthyCount}/${statuses.length} bound project${statuses.length === 1 ? '' : 's'} have ${label} configured`,
    detail: { missingProjects },
  }
}

async function checkRuntimeVersion(scope: ResolvedInstanceAuthority): Promise<HealthCheck> {
  const body = await fetchInstanceHealth(scope)
  if (!body) {
    return {
      name: 'runtime_version',
      status: 'warn',
      message: 'Could not read Iranti runtime version — Iranti may not be running',
    }
  }

  const runtime = body['runtime']
  let version: string | null = null
  if (runtime && typeof runtime === 'object' && typeof (runtime as Record<string, unknown>)['version'] === 'string') {
    version = (runtime as Record<string, unknown>)['version'] as string
  }
  if (!version && typeof body['version'] === 'string') {
    version = body['version']
  }

  if (!version) {
    return {
      name: 'runtime_version',
      status: 'warn',
      message: 'Iranti is running but did not report a version',
    }
  }

  return {
    name: 'runtime_version',
    status: 'ok',
    message: `Iranti runtime v${version}`,
    detail: { source: `${scope.apiBaseUrl}/health`, version },
  }
}

async function checkStaffEventsTable(pool: pg.Pool | null): Promise<HealthCheck> {
  if (!pool) {
    return {
      name: 'staff_events_table',
      status: 'warn',
      message: 'DATABASE_URL is not configured for this instance',
    }
  }

  try {
    const result = await pool.query<{ exists: boolean }>(
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

function buildDecayConfig(scope: ResolvedInstanceAuthority): DecayConfig {
  const getVal = (key: string): string => scope.env[key] ?? ''
  const enabled = (getVal('IRANTI_DECAY_ENABLED') || 'false').toLowerCase() === 'true'
  const stabilityBase = parseInt(getVal('IRANTI_DECAY_STABILITY_BASE') || '30', 10)
  const stabilityIncrement = parseInt(getVal('IRANTI_DECAY_STABILITY_INCREMENT') || '5', 10)
  const stabilityMax = parseInt(getVal('IRANTI_DECAY_STABILITY_MAX') || '365', 10)
  const decayThreshold = parseInt(getVal('IRANTI_DECAY_THRESHOLD') || '10', 10)

  return {
    enabled,
    stabilityBase: Number.isNaN(stabilityBase) ? 30 : stabilityBase,
    stabilityIncrement: Number.isNaN(stabilityIncrement) ? 5 : stabilityIncrement,
    stabilityMax: Number.isNaN(stabilityMax) ? 365 : stabilityMax,
    decayThreshold: Number.isNaN(decayThreshold) ? 10 : decayThreshold,
  }
}

async function buildVectorBackendInfo(scope: ResolvedInstanceAuthority, pool: pg.Pool | null): Promise<VectorBackendInfo> {
  const raw = (scope.env['IRANTI_VECTOR_BACKEND'] ?? '').trim().toLowerCase()
  const type: VectorBackendType =
    raw === 'qdrant' || raw === 'chroma'
      ? raw
      : raw === '' || raw === 'pgvector'
      ? 'pgvector'
      : 'unknown'

  if (type === 'pgvector' || type === 'unknown') {
    if (!pool) {
      return { type, configured: type === 'pgvector', url: null, status: 'warn' }
    }

    try {
      const result = await pool.query<{ extversion: string | null }>(
        `SELECT extversion FROM pg_extension WHERE extname = 'vector' LIMIT 1`
      )
      return {
        type,
        configured: type === 'pgvector',
        url: null,
        status: result.rows.length > 0 && result.rows[0].extversion ? 'ok' : 'warn',
      }
    } catch {
      return { type, configured: type === 'pgvector', url: null, status: 'error' }
    }
  }

  const urlKey = type === 'qdrant' ? 'IRANTI_QDRANT_URL' : 'IRANTI_CHROMA_URL'
  const url = scope.env[urlKey]?.trim() || null
  if (!url) return { type, configured: false, url: null, status: 'warn' }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    try {
      const probe = await fetch(url, { method: 'GET', signal: controller.signal })
      return { type, configured: true, url, status: probe.status < 500 ? 'ok' : 'warn' }
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return { type, configured: true, url, status: 'error' }
  }
}

async function buildAttendantStatus(scope: ResolvedInstanceAuthority): Promise<AttendantStatus> {
  const checkedAt = new Date().toISOString()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const res = await fetch(`${scope.apiBaseUrl}/memory/attend`, {
      method: 'POST',
      headers: buildHeaders(scope),
      body: JSON.stringify({
        agent: 'control_plane_operator',
        query: 'health check probe',
        currentContext: 'health check probe',
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      return {
        status: res.status === 404 || res.status === 503 ? 'unreachable' : 'error',
        message: res.status === 404 || res.status === 503
          ? 'Attendant route not available — Iranti may not be running'
          : `Attendant returned HTTP ${res.status}`,
        checkedAt,
      }
    }

    try {
      const body = await res.json() as unknown
      if (JSON.stringify(body).includes('classification_parse_failed_default_false')) {
        return {
          status: 'warn',
          message: 'Attendant responded but classifier reported a parse failure — memory injection may be unreliable.',
          checkedAt,
        }
      }
    } catch {
      // keep ok state
    }

    return { status: 'ok', message: 'Attendant is responding normally', checkedAt }
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

function computeOverall(checks: HealthCheck[]): 'healthy' | 'degraded' | 'error' {
  const runtimeChecks = checks.filter((check) => RUNTIME_CHECK_NAMES.has(check.name))
  if (runtimeChecks.some((check) => check.status === 'error')) return 'error'
  if (runtimeChecks.some((check) => check.status === 'warn')) return 'degraded'
  return 'healthy'
}

export async function runAllHealthChecks(instanceRef?: string): Promise<HealthResponse> {
  const scope = await resolveScopeOrThrow(instanceRef)
  const checkedAt = new Date().toISOString()

  return withScopedPool(scope.databaseUrl, async (pool) => {
    const [runtime, checks, vectorBackend, attendant] = await Promise.all([
      fetchIrantiRuntime(scope),
      Promise.all([
        checkDbReachability(pool),
        checkDbSchemaVersion(pool),
        checkVectorBackend(scope, pool),
        Promise.resolve(makeProviderKeyCheck(scope, 'ANTHROPIC_API_KEY', 'anthropic_key', 'anthropic')),
        Promise.resolve(makeProviderKeyCheck(scope, 'OPENAI_API_KEY', 'openai_key', 'openai')),
        Promise.resolve(checkDefaultProvider(scope)),
        Promise.resolve(summarizeProjectIntegration(scope, 'mcp_integration')),
        Promise.resolve(summarizeProjectIntegration(scope, 'claude_md_integration')),
        checkRuntimeVersion(scope),
        checkStaffEventsTable(pool),
      ]),
      buildVectorBackendInfo(scope, pool),
      buildAttendantStatus(scope),
    ])

    return {
      overall: computeOverall(checks),
      checks,
      checkedAt,
      scope: scopeSummary(scope),
      runtime,
      runtimeStatus: deriveRuntimeStatus(runtime),
      decay: buildDecayConfig(scope),
      vectorBackend,
      attendant,
    } as HealthResponse & {
      decay: DecayConfig
      vectorBackend: VectorBackendInfo
      attendant: AttendantStatus
    }
  })
}

healthRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const instanceId = typeof req.query['instanceId'] === 'string' ? req.query['instanceId'] : undefined
    res.status(200).json(await runAllHealthChecks(instanceId))
  } catch (err) {
    next(err)
  }
})

healthRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const apiErr = err as ApiError
  res.status(apiErr.statusCode ?? 500).json({
    error: apiErr.message ?? 'Internal server error',
    code: apiErr.code ?? 'INTERNAL_ERROR',
  })
})
