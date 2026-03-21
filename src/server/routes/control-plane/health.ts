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
 *   6. default_provider_configured — IRANTI_DEFAULT_PROVIDER or DEFAULT_PROVIDER
 *   7. mcp_integration        — .mcp.json in cwd
 *   8. claude_md_integration  — CLAUDE.md in cwd
 *   9. runtime_version        — package.json version
 *  10. staff_events_table     — information_schema.tables check
 */

import { Router, Request, Response, NextFunction } from 'express'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { query, env } from '../../db.js'
import { HealthCheck, HealthResponse, ApiError } from '../../types.js'

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
    const result = await query<{ installed_version: string | null }>(
      `SELECT installed_version FROM pg_extension WHERE extname = 'vector' LIMIT 1`
    )

    if (result.rows.length === 0 || !result.rows[0].installed_version) {
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
      message: `pgvector installed (version ${result.rows[0].installed_version})`,
      detail: { version: result.rows[0].installed_version },
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

function makeProviderKeyCheck(keyName: string, checkName: string): () => Promise<HealthCheck> {
  return async (): Promise<HealthCheck> => {
    // Check process.env first, then loaded .env.iranti values
    const value = process.env[keyName] ?? env[keyName]
    const present = typeof value === 'string' && value.trim() !== ''
    return {
      name: checkName,
      status: present ? 'ok' : 'warn',
      message: present ? `${keyName} is present` : `${keyName} not found in environment`,
      // SECURITY: never include the value or any part of it
    }
  }
}

const checkAnthropicKey = makeProviderKeyCheck('ANTHROPIC_API_KEY', 'anthropic_key')
const checkOpenAIKey = makeProviderKeyCheck('OPENAI_API_KEY', 'openai_key')

async function checkDefaultProvider(): Promise<HealthCheck> {
  const candidates = ['IRANTI_DEFAULT_PROVIDER', 'DEFAULT_PROVIDER', 'DEFAULT_LLM_PROVIDER']
  const found = candidates.find((k) => {
    const val = process.env[k] ?? env[k]
    return typeof val === 'string' && val.trim() !== ''
  })

  if (!found) {
    return {
      name: 'default_provider_configured',
      status: 'warn',
      message: 'No default provider configured (IRANTI_DEFAULT_PROVIDER not set)',
      detail: { checked: candidates },
    }
  }

  const value = (process.env[found] ?? env[found] ?? '').trim().toLowerCase()
  const knownProviders = ['anthropic', 'openai']
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
  const pkgCandidates = [
    join(process.cwd(), 'package.json'),
    join(process.cwd(), 'node_modules', 'iranti', 'package.json'),
  ]

  let version: string | null = null
  for (const pkgPath of pkgCandidates) {
    try {
      const raw = await readFile(pkgPath, 'utf8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (typeof parsed.version === 'string') {
        version = parsed.version
        break
      }
    } catch { /* try next */ }
  }

  if (!version) {
    return {
      name: 'runtime_version',
      status: 'warn',
      message: 'Could not detect Iranti runtime version',
      detail: { checked: pkgCandidates },
    }
  }

  return {
    name: 'runtime_version',
    status: 'ok',
    message: `Running Iranti version ${version}`,
    detail: { version },
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
        : 'staff_events table missing — CP-T001 migration not applied; event stream will not work',
      detail: exists ? undefined : { hint: 'Apply the CP-T001 migration to create the staff_events table.' },
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
// CP-T052: Attendant status builder
// ---------------------------------------------------------------------------

interface AttendantStatus {
  status: 'informational'
  message: string
  upstreamPRRequired: string
}

function buildAttendantStatus(): AttendantStatus {
  return {
    status: 'informational',
    message:
      'Attendant automatic injection has known reliability limitations without native emitter injection (CP-T025). Iranti v0.2.13 improved classification accuracy. If injection appears unreliable, provide explicit entityHints to iranti_observe.',
    upstreamPRRequired: 'CP-T025',
  }
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

function computeOverall(checks: HealthCheck[]): 'healthy' | 'degraded' | 'error' {
  if (checks.some((c) => c.status === 'error')) return 'error'
  if (checks.some((c) => c.status === 'warn')) return 'degraded'
  return 'healthy'
}

async function runAllHealthChecks(): Promise<HealthResponse> {
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

  const settled = await Promise.allSettled(checkFunctions.map((fn) => fn()))

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

  return { overall: computeOverall(checks), checks, checkedAt }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

healthRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [result, vectorBackend] = await Promise.all([
      runAllHealthChecks(),
      buildVectorBackendInfo(),
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
      attendant: buildAttendantStatus(),
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
