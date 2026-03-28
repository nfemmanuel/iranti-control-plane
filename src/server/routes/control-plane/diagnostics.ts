import { Router, Request, Response, NextFunction } from 'express'
import pg from 'pg'
import { ApiError, InstanceScopeSummary } from '../../types.js'
import { resolveInstanceAuthority, ResolvedInstanceAuthority } from '../../lib/instance-authority.js'

export const diagnosticsRouter = Router()
const { Pool } = pg

type CheckStatus = 'pass' | 'warn' | 'fail'
type OverallStatus = 'pass' | 'warn' | 'fail'

interface CheckResult {
  check: string
  status: CheckStatus
  message: string
  fixHint: string | null
  durationMs: number
}

interface DiagnosticResult {
  runAt: string
  overallStatus: OverallStatus
  checks: CheckResult[]
  totalDurationMs: number
  scope: InstanceScopeSummary
}

const DIAGNOSTIC_ENTITY_TYPE = '__diagnostics__'
const DIAGNOSTIC_ENTITY_ID = '__probe__'
const ROUNDTRIP_KEY = 'roundtrip_marker'
const ROUNDTRIP_VALUE = 'control-plane-roundtrip-ok'
const ROUNDTRIP_SUMMARY = 'Stable control-plane round-trip probe'
const VECTOR_PROBE_KEY = 'semantic_probe'
const VECTOR_PROBE_VALUE = 'Shared memory helps research teams preserve handoffs and working context.'
const VECTOR_PROBE_SUMMARY = 'Semantic probe for vector-search diagnostics'
const VECTOR_PROBE_QUERY = 'team memory for research workflows'

const lastDiagnosticResult = new Map<string, DiagnosticResult>()

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

function buildRunCommand(scope: ResolvedInstanceAuthority): string {
  const quotedRoot = /\s/.test(scope.runtimeRoot) ? `"${scope.runtimeRoot}"` : scope.runtimeRoot
  return `iranti run --instance ${scope.instanceName} --root ${quotedRoot}`
}

function buildRestartCommand(scope: ResolvedInstanceAuthority): string {
  const quotedRoot = /\s/.test(scope.runtimeRoot) ? `"${scope.runtimeRoot}"` : scope.runtimeRoot
  return `iranti instance restart ${scope.instanceName} --root ${quotedRoot}`
}

function buildKbQueryUrl(scope: ResolvedInstanceAuthority, key: string): string {
  return `${scope.apiBaseUrl}/kb/query/${encodeURIComponent(DIAGNOSTIC_ENTITY_TYPE)}/${encodeURIComponent(DIAGNOSTIC_ENTITY_ID)}/${encodeURIComponent(key)}`
}

function looksLikeBackendDbFailure(body: string): boolean {
  const text = body.toLowerCase()
  return text.includes('server has closed the connection')
    || text.includes('invalid `db.')
    || text.includes('prisma')
}

async function readResponseBodySafe(res: globalThis.Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

function buildKbRouteFailure(
  scope: ResolvedInstanceAuthority,
  routeLabel: string,
  statusCode: number,
  responseBody: string,
  authFixHint: string
): Pick<CheckResult, 'status' | 'message' | 'fixHint'> {
  if (statusCode === 401 || statusCode === 403) {
    return {
      status: 'fail',
      message: `${routeLabel} was rejected by Iranti auth (HTTP ${statusCode})`,
      fixHint: authFixHint,
    }
  }

  if (looksLikeBackendDbFailure(responseBody)) {
    return {
      status: 'fail',
      message: `${routeLabel} hit a backend database error even though the instance is reachable`,
      fixHint: `Restart the instance with: ${buildRestartCommand(scope)}`,
    }
  }

  return {
    status: 'warn',
    message: `${routeLabel} returned HTTP ${statusCode}`,
    fixHint: `Restart the instance with: ${buildRestartCommand(scope)}`,
  }
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

function withTimeout<T>(promise: Promise<T>, ms: number, checkName: string): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${checkName} check timed out after ${ms}ms`)), ms)
  )
  return Promise.race([promise, timeoutPromise])
}

function computeOverallStatus(checks: CheckResult[]): OverallStatus {
  if (checks.some((check) => check.status === 'fail')) return 'fail'
  if (checks.some((check) => check.status === 'warn')) return 'warn'
  return 'pass'
}

async function safeRun(checkName: string, fn: () => Promise<CheckResult>): Promise<CheckResult> {
  try {
    return await fn()
  } catch (err: unknown) {
    return {
      check: checkName,
      status: 'fail',
      message: String((err as Error)?.message ?? err),
      fixHint: null,
      durationMs: 0,
    }
  }
}

async function checkIrantiConnectivity(scope: ResolvedInstanceAuthority): Promise<CheckResult> {
  const start = Date.now()
  const work = async (): Promise<CheckResult> => {
    const res = await fetch(`${scope.apiBaseUrl}/health`, {
      method: 'GET',
      headers: buildHeaders(scope),
    })

    if (!res.ok) {
      return {
        check: 'iranti_connectivity',
        status: 'fail',
        message: `Iranti /health returned HTTP ${res.status}`,
        fixHint: `Start the instance with: ${buildRunCommand(scope)}`,
        durationMs: Date.now() - start,
      }
    }

    let version = ''
    try {
      const body = await res.json() as Record<string, unknown>
      if (typeof body['version'] === 'string') version = ` v${body['version']}`
    } catch {
      // ignore version parsing
    }

    return {
      check: 'iranti_connectivity',
      status: 'pass',
      message: `Iranti${version} reachable at ${scope.apiBaseUrl}`,
      fixHint: null,
      durationMs: Date.now() - start,
    }
  }

  return withTimeout(work(), 3000, 'iranti_connectivity')
}

async function checkIrantiAuth(scope: ResolvedInstanceAuthority): Promise<CheckResult> {
  const start = Date.now()
  const work = async (): Promise<CheckResult> => {
    const res = await fetch(`${scope.apiBaseUrl}/kb/search?query=test&limit=1`, {
      method: 'GET',
      headers: buildHeaders(scope),
    })

    if (res.status === 200) {
      return {
        check: 'iranti_auth',
        status: 'pass',
        message: 'Iranti API key accepted - kb:read scope confirmed',
        fixHint: null,
        durationMs: Date.now() - start,
      }
    }

    const body = await readResponseBodySafe(res)
    const failure = buildKbRouteFailure(
      scope,
      'GET /kb/search',
      res.status,
      body,
      `Check IRANTI_API_KEY for instance ${scope.instanceName}.`
    )

    return {
      check: 'iranti_auth',
      status: failure.status,
      message: failure.message,
      fixHint: failure.fixHint,
      durationMs: Date.now() - start,
    }
  }

  return withTimeout(work(), 3000, 'iranti_auth')
}

async function checkDbConnectivity(pool: pg.Pool | null): Promise<CheckResult> {
  const start = Date.now()
  if (!pool) {
    return {
      check: 'db_connectivity',
      status: 'fail',
      message: 'DATABASE_URL is not configured for this instance.',
      fixHint: null,
      durationMs: Date.now() - start,
    }
  }

  const work = async (): Promise<CheckResult> => {
    const result = await pool.query('SELECT 1 AS one')
    const row = result.rows[0] as Record<string, unknown> | undefined
    return {
      check: 'db_connectivity',
      status: row?.one === 1 || row?.one === '1' ? 'pass' : 'fail',
      message: row?.one === 1 || row?.one === '1'
        ? 'Database connection is healthy'
        : 'SELECT 1 did not return the expected result',
      fixHint: null,
      durationMs: Date.now() - start,
    }
  }

  return withTimeout(work(), 8000, 'db_connectivity')
}

async function checkVectorBackend(scope: ResolvedInstanceAuthority, pool: pg.Pool | null): Promise<CheckResult> {
  const start = Date.now()
  const backend = (scope.env['IRANTI_VECTOR_BACKEND'] ?? '').trim().toLowerCase()

  if (!backend || backend === 'pgvector') {
    if (!pool) {
      return {
        check: 'vector_backend',
        status: 'warn',
        message: 'DATABASE_URL is not configured for this instance.',
        fixHint: null,
        durationMs: Date.now() - start,
      }
    }

    const work = async (): Promise<CheckResult> => {
      const result = await pool.query<{ extversion: string | null }>(
        `SELECT extversion FROM pg_extension WHERE extname = 'vector' LIMIT 1`
      )

      if (result.rows.length > 0 && result.rows[0].extversion) {
        return {
          check: 'vector_backend',
          status: 'pass',
          message: `pgvector installed (version ${result.rows[0].extversion})`,
          fixHint: null,
          durationMs: Date.now() - start,
        }
      }

      return {
        check: 'vector_backend',
        status: 'warn',
        message: 'pgvector extension is not installed',
        fixHint: 'Run: CREATE EXTENSION IF NOT EXISTS vector;',
        durationMs: Date.now() - start,
      }
    }

    return withTimeout(work(), 3000, 'vector_backend')
  }

  const urlKey = backend === 'qdrant' ? 'IRANTI_QDRANT_URL' : 'IRANTI_CHROMA_URL'
  const url = scope.env[urlKey]?.trim() || ''
  if (!url) {
    return {
      check: 'vector_backend',
      status: 'warn',
      message: `Vector backend configured as '${backend}' but ${urlKey} is missing`,
      fixHint: `Set ${urlKey} in the instance env and restart Iranti.`,
      durationMs: Date.now() - start,
    }
  }

  const work = async (): Promise<CheckResult> => {
    const res = await fetch(url, { method: 'GET' })
    return {
      check: 'vector_backend',
      status: res.status < 500 ? 'pass' : 'warn',
      message: res.status < 500
        ? `${backend} reachable at ${url}`
        : `${backend} returned HTTP ${res.status} at ${url}`,
      fixHint: res.status < 500 ? null : `Check ${urlKey} in the instance env.`,
      durationMs: Date.now() - start,
    }
  }

  return withTimeout(work(), 3000, 'vector_backend')
}

function extractExactQueryValue(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null
  const obj = body as Record<string, unknown>
  if (obj['found'] !== true) return null
  const raw = obj['value']
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object' && raw !== null && typeof (raw as Record<string, unknown>)['text'] === 'string') {
    return String((raw as Record<string, unknown>)['text'])
  }
  return String(raw)
}

async function writeDiagnosticFact(
  scope: ResolvedInstanceAuthority,
  key: string,
  value: string,
  summary: string
): Promise<globalThis.Response> {
  return fetch(`${scope.apiBaseUrl}/kb/write`, {
    method: 'POST',
    headers: buildHeaders(scope),
    body: JSON.stringify({
      entity: `${DIAGNOSTIC_ENTITY_TYPE}/${DIAGNOSTIC_ENTITY_ID}`,
      agent: 'control_plane_operator',
      key,
      value,
      summary,
      confidence: 50,
      source: 'control_plane_diagnostics',
    }),
  })
}

async function checkIngestRoundtrip(scope: ResolvedInstanceAuthority): Promise<CheckResult> {
  const start = Date.now()

  const work = async (): Promise<CheckResult> => {
    const writeRes = await writeDiagnosticFact(scope, ROUNDTRIP_KEY, ROUNDTRIP_VALUE, ROUNDTRIP_SUMMARY)

    if (!writeRes.ok) {
      const body = await readResponseBodySafe(writeRes)
      const failure = buildKbRouteFailure(
        scope,
        'POST /kb/write',
        writeRes.status,
        body,
        `Check API key scopes for ${scope.instanceName}.`
      )
      return {
        check: 'ingest_roundtrip',
        status: failure.status,
        message: `Write probe failed: ${failure.message}`,
        fixHint: failure.fixHint,
        durationMs: Date.now() - start,
      }
    }

    const queryRes = await fetch(buildKbQueryUrl(scope, ROUNDTRIP_KEY), {
      method: 'GET',
      headers: buildHeaders(scope),
    })

    if (!queryRes.ok) {
      return {
        check: 'ingest_roundtrip',
        status: 'fail',
        message: `Read probe failed: GET /kb/query returned HTTP ${queryRes.status}`,
        fixHint: null,
        durationMs: Date.now() - start,
      }
    }

    const body = await queryRes.json() as unknown
    const value = extractExactQueryValue(body)
    return {
      check: 'ingest_roundtrip',
      status: value === ROUNDTRIP_VALUE ? 'pass' : 'fail',
      message: value === ROUNDTRIP_VALUE
        ? 'Ingest round-trip succeeded'
        : 'Probe fact was written but could not be read back exactly',
      fixHint: null,
      durationMs: Date.now() - start,
    }
  }

  return withTimeout(work(), 5000, 'ingest_roundtrip')
}

async function checkAttend(scope: ResolvedInstanceAuthority): Promise<CheckResult> {
  const start = Date.now()
  const work = async (): Promise<CheckResult> => {
    const res = await fetch(`${scope.apiBaseUrl}/memory/attend`, {
      method: 'POST',
      headers: buildHeaders(scope),
      body: JSON.stringify({
        agent: 'control_plane_operator',
        latestMessage: 'diagnostic probe',
        currentContext: 'diagnostic probe',
        suppressEvents: true,
      }),
    })

    if (!res.ok) {
      return {
        check: 'attend_check',
        status: 'fail',
        message: `POST /memory/attend returned HTTP ${res.status}`,
        fixHint: `Check Iranti logs for instance ${scope.instanceName}.`,
        durationMs: Date.now() - start,
      }
    }

    try {
      const body = await res.json() as unknown
      if (JSON.stringify(body).includes('classification_parse_failed_default_false')) {
        return {
          check: 'attend_check',
          status: 'warn',
          message: 'Attendant returned 200, but the diagnostic probe fell back to a conservative no-memory decision.',
          fixHint: 'This usually means the synthetic probe was ambiguous, not that the Attendant is down. Re-test with a clearer task prompt if real memory injection seems weak.',
          durationMs: Date.now() - start,
        }
      }
    } catch {
      // ignore parse errors
    }

    return {
      check: 'attend_check',
      status: 'pass',
      message: 'Attendant responded successfully',
      fixHint: null,
      durationMs: Date.now() - start,
    }
  }

  return withTimeout(work(), 8000, 'attend_check')
}

function extractSearchItems(body: unknown): unknown[] {
  if (Array.isArray(body)) return body
  if (body !== null && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    if (Array.isArray(obj['results'])) return obj['results'] as unknown[]
    if (Array.isArray(obj['items'])) return obj['items'] as unknown[]
    if (Array.isArray(obj['facts'])) return obj['facts'] as unknown[]
  }
  return []
}

async function checkVectorSearch(scope: ResolvedInstanceAuthority): Promise<CheckResult> {
  const start = Date.now()
  const work = async (): Promise<CheckResult> => {
    const writeRes = await writeDiagnosticFact(scope, VECTOR_PROBE_KEY, VECTOR_PROBE_VALUE, VECTOR_PROBE_SUMMARY)
    if (!writeRes.ok) {
      const body = await readResponseBodySafe(writeRes)
      const failure = buildKbRouteFailure(
        scope,
        'POST /kb/write',
        writeRes.status,
        body,
        `Check API key scopes for ${scope.instanceName}.`
      )
      return {
        check: 'vector_search_check',
        status: failure.status,
        message: `Write probe failed: ${failure.message}`,
        fixHint: failure.fixHint,
        durationMs: Date.now() - start,
      }
    }

    const res = await fetch(`${scope.apiBaseUrl}/kb/search?query=${encodeURIComponent(VECTOR_PROBE_QUERY)}&limit=5`, {
      method: 'GET',
      headers: buildHeaders(scope),
    })

    if (!res.ok) {
      const body = await readResponseBodySafe(res)
      const failure = buildKbRouteFailure(
        scope,
        'GET /kb/search',
        res.status,
        body,
        `Check IRANTI_API_KEY for instance ${scope.instanceName}.`
      )
      return {
        check: 'vector_search_check',
        status: failure.status,
        message: failure.message,
        fixHint: failure.fixHint,
        durationMs: Date.now() - start,
      }
    }

    let matchedProbe = false
    let hasVectorScore = false
    try {
      const body = await res.json() as unknown
      const items = extractSearchItems(body)
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const fact = item as Record<string, unknown>
        const entity = String(fact['entity'] ?? '')
        const key = String(fact['key'] ?? '')
        if (entity !== `${DIAGNOSTIC_ENTITY_TYPE}/${DIAGNOSTIC_ENTITY_ID}` || key !== VECTOR_PROBE_KEY) continue
        matchedProbe = true
        const score = fact['vectorScore']
        hasVectorScore = typeof score === 'number' && score > 0
        break
      }
    } catch {
      matchedProbe = true
      hasVectorScore = true
    }

    return {
      check: 'vector_search_check',
      status: matchedProbe && hasVectorScore ? 'pass' : 'warn',
      message: matchedProbe && hasVectorScore
        ? 'Semantic vector probe returned a non-zero vectorScore'
        : matchedProbe
        ? 'Semantic probe surfaced, but only through lexical matching (vectorScore=0)'
        : 'Semantic vector probe did not appear in hybrid search results',
      fixHint: matchedProbe && hasVectorScore
        ? null
        : matchedProbe
        ? 'Vector backend is reachable, so this usually means embeddings are stale or the semantic probe is underweighted. Re-run doctor and inspect vector index consistency if real search feels weak.'
        : 'Vector backend is reachable, but semantic ranking did not surface the known probe. Re-run doctor and inspect vector index consistency if this persists.',
      durationMs: Date.now() - start,
    }
  }

  return withTimeout(work(), 8000, 'vector_search_check')
}

async function runDiagnostics(scope: ResolvedInstanceAuthority): Promise<DiagnosticResult> {
  const runAt = new Date().toISOString()
  const totalStart = Date.now()

  return withScopedPool(scope.databaseUrl, async (pool) => {
    const checks = await Promise.all([
      safeRun('iranti_connectivity', () => checkIrantiConnectivity(scope)),
      safeRun('iranti_auth', () => checkIrantiAuth(scope)),
      safeRun('db_connectivity', () => checkDbConnectivity(pool)),
      safeRun('vector_backend', () => checkVectorBackend(scope, pool)),
      safeRun('ingest_roundtrip', () => checkIngestRoundtrip(scope)),
      safeRun('attend_check', () => checkAttend(scope)),
      safeRun('vector_search_check', () => checkVectorSearch(scope)),
    ])

    return {
      runAt,
      overallStatus: computeOverallStatus(checks),
      checks,
      totalDurationMs: Date.now() - totalStart,
      scope: scopeSummary(scope),
    }
  })
}

diagnosticsRouter.post('/run', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const instanceId = typeof req.query['instanceId'] === 'string' ? req.query['instanceId'] : undefined
    const scope = await resolveScopeOrThrow(instanceId)
    const result = await runDiagnostics(scope)
    lastDiagnosticResult.set(scope.instanceId, result)
    res.json(result)
  } catch (err) {
    next(err)
  }
})

diagnosticsRouter.get('/last', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const instanceId = typeof req.query['instanceId'] === 'string' ? req.query['instanceId'] : undefined
    const scope = await resolveScopeOrThrow(instanceId)
    const result = lastDiagnosticResult.get(scope.instanceId)
    if (!result) {
      res.status(404).json({
        error: `No diagnostic run has been performed for instance '${scope.instanceName}' in this server session`,
        code: 'NO_DIAGNOSTIC_RUN',
      })
      return
    }
    res.json(result)
  } catch (err) {
    next(err)
  }
})

diagnosticsRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const apiErr = err as ApiError
  res.status(apiErr.statusCode ?? 500).json({
    error: apiErr.message ?? 'Internal server error',
    code: apiErr.code ?? 'INTERNAL_ERROR',
  })
})
