/**
 * Interactive Diagnostics Panel — CP-T059
 *
 * Routes:
 *   POST /diagnostics/run  — trigger a full diagnostic run (synchronous, ≤10s)
 *   GET  /diagnostics/last — return the most recent run result (in-memory cache)
 *
 * Seven checks run in parallel where safe:
 *   1. iranti_connectivity   — GET /health on Iranti
 *   2. iranti_auth           — GET /kb/search?query=test&limit=1 with API key
 *   3. db_connectivity       — SELECT 1 against the control plane local DB
 *   4. vector_backend        — HTTP probe (qdrant/chroma) or SELECT 1 (pgvector)
 *   5. ingest_roundtrip      — write probe fact, read it back, delete it (5s timeout)
 *   6. attend_check          — POST /memory/attend with minimal payload
 *   7. vector_search_check   — GET /kb/search?query=diagnostic+probe&limit=1
 *
 * Design decisions:
 *   - Per-check Promise.race timeouts (not a global timeout) per ticket spec.
 *   - ingest_roundtrip timeout: 5s. iranti_connectivity + iranti_auth: 3s each.
 *     All other checks: 8s.
 *   - Cache: single module-level variable (no DB persistence at MVP).
 *   - ingest_roundtrip probe entity: entityType='__diagnostics__', entityId='__probe__'.
 *     Frontend note: Memory Explorer should filter entityType='__diagnostics__' from
 *     normal browsing views. Cleanup (delete) is attempted after read; failure to delete
 *     does not affect check status (best-effort cleanup).
 *   - attend_check is informational — it checks the Iranti Attendant is reachable and
 *     returns a parseable result. It does not inject memory into a real conversation.
 *   - vector_search_check: vectorScore=0 for all results → warn (not fail).
 *   - Never 500: all check-level errors are caught and surfaced as fail results.
 */

import { Router, Request, Response, NextFunction } from 'express'
import { env, query } from '../../db.js'
import { ApiError } from '../../types.js'

export const diagnosticsRouter = Router()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
}

// ---------------------------------------------------------------------------
// In-memory cache for last run result
// ---------------------------------------------------------------------------

let lastDiagnosticResult: DiagnosticResult | null = null

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getIrantiUrl(): string {
  return (env['IRANTI_URL'] ?? process.env['IRANTI_URL'] ?? 'http://localhost:3001').replace(/\/$/, '')
}

function getIrantiApiKey(): string {
  return env['IRANTI_API_KEY'] ?? process.env['IRANTI_API_KEY'] ?? ''
}

function getVectorBackend(): string {
  return (env['IRANTI_VECTOR_BACKEND'] ?? process.env['IRANTI_VECTOR_BACKEND'] ?? '').trim().toLowerCase()
}

function getVectorBackendUrl(): string | null {
  const backend = getVectorBackend()
  if (backend === 'qdrant') {
    return (env['IRANTI_QDRANT_URL'] ?? process.env['IRANTI_QDRANT_URL'] ?? '').trim() || null
  }
  if (backend === 'chroma') {
    return (env['IRANTI_CHROMA_URL'] ?? process.env['IRANTI_CHROMA_URL'] ?? '').trim() || null
  }
  return null
}

function buildIrantiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const apiKey = getIrantiApiKey()
  if (apiKey) {
    headers['X-Iranti-Key'] = apiKey
  }
  return headers
}

/**
 * Wrap a promise with a per-check timeout using Promise.race.
 * On timeout, rejects with an Error whose message describes the timeout.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, checkName: string): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`${checkName} check timed out after ${ms}ms`)),
      ms
    )
  )
  return Promise.race([promise, timeoutPromise])
}

/**
 * Wrap a check function so that any thrown error is caught and returned as a
 * fail CheckResult. This guarantees the diagnostics endpoint never 500s.
 */
async function safeRun(
  checkName: string,
  fn: () => Promise<CheckResult>
): Promise<CheckResult> {
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

function computeOverallStatus(checks: CheckResult[]): OverallStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail'
  if (checks.some((c) => c.status === 'warn')) return 'warn'
  return 'pass'
}

// ---------------------------------------------------------------------------
// Check 1: iranti_connectivity
// ---------------------------------------------------------------------------

async function checkIrantiConnectivity(): Promise<CheckResult> {
  const start = Date.now()
  const baseUrl = getIrantiUrl()

  const work = async (): Promise<CheckResult> => {
    const controller = new AbortController()
    let irantiRes: globalThis.Response
    try {
      irantiRes = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        headers: buildIrantiHeaders(),
        signal: controller.signal,
      })
    } finally {
      // AbortController cleanup is implicit; timeout handled by withTimeout
    }

    const durationMs = Date.now() - start

    if (irantiRes.status === 200) {
      // Try to parse the version from the response body for the message
      let version = ''
      try {
        const body = await irantiRes.json() as Record<string, unknown>
        if (typeof body.version === 'string') {
          version = ` v${body.version}`
        }
      } catch { /* body parse failure doesn't affect pass status */ }

      return {
        check: 'iranti_connectivity',
        status: 'pass',
        message: `Iranti${version} reachable at ${baseUrl}`,
        fixHint: null,
        durationMs,
      }
    }

    return {
      check: 'iranti_connectivity',
      status: 'fail',
      message: `Iranti /health returned HTTP ${irantiRes.status}`,
      fixHint: 'Iranti may not be running. Run: iranti run --instance <name>',
      durationMs,
    }
  }

  return withTimeout(work(), 3000, 'iranti_connectivity').catch((err: unknown) => ({
    check: 'iranti_connectivity',
    status: 'fail' as CheckStatus,
    message: String((err as Error)?.message ?? err),
    fixHint: 'Iranti may not be running. Run: iranti run --instance <name>',
    durationMs: Date.now() - start,
  }))
}

// ---------------------------------------------------------------------------
// Check 2: iranti_auth
// ---------------------------------------------------------------------------

async function checkIrantiAuth(): Promise<CheckResult> {
  const start = Date.now()
  const baseUrl = getIrantiUrl()

  const work = async (): Promise<CheckResult> => {
    const irantiRes = await fetch(`${baseUrl}/kb/search?query=test&limit=1`, {
      method: 'GET',
      headers: buildIrantiHeaders(),
    })

    const durationMs = Date.now() - start

    if (irantiRes.status === 200) {
      return {
        check: 'iranti_auth',
        status: 'pass',
        message: 'Iranti API key accepted — kb:read scope confirmed',
        fixHint: null,
        durationMs,
      }
    }

    if (irantiRes.status === 401 || irantiRes.status === 403) {
      return {
        check: 'iranti_auth',
        status: 'fail',
        message: `Iranti auth rejected (HTTP ${irantiRes.status})`,
        fixHint: 'API key missing or insufficient scope. Check IRANTI_API_KEY in your .env.iranti. Required scope: kb:read, kb:write, memory:read, memory:write.',
        durationMs,
      }
    }

    // 404 = Iranti not running (no route matched at all), not an auth problem
    if (irantiRes.status === 404) {
      return {
        check: 'iranti_auth',
        status: 'warn',
        message: 'Iranti /kb/search returned 404 — Iranti is likely not running',
        fixHint: 'Start Iranti first: iranti run --instance <name>. Auth cannot be verified until Iranti is reachable.',
        durationMs,
      }
    }

    return {
      check: 'iranti_auth',
      status: 'warn',
      message: `Iranti /kb/search returned unexpected status ${irantiRes.status}`,
      fixHint: 'API key missing or insufficient scope. Check IRANTI_API_KEY in your .env.iranti. Required scope: kb:read, kb:write, memory:read, memory:write.',
      durationMs,
    }
  }

  return withTimeout(work(), 3000, 'iranti_auth').catch((err: unknown) => ({
    check: 'iranti_auth',
    status: 'fail' as CheckStatus,
    message: String((err as Error)?.message ?? err),
    fixHint: 'Iranti may not be running. Start with: iranti run --instance <name>',
    durationMs: Date.now() - start,
  }))
}

// ---------------------------------------------------------------------------
// Check 3: db_connectivity
// ---------------------------------------------------------------------------

async function checkDbConnectivity(): Promise<CheckResult> {
  const start = Date.now()

  const work = async (): Promise<CheckResult> => {
    const result = await query('SELECT 1 AS one')
    const durationMs = Date.now() - start

    const row = result.rows[0] as Record<string, unknown> | undefined
    if (row && (row.one === 1 || row.one === '1')) {
      return {
        check: 'db_connectivity',
        status: 'pass',
        message: 'Control plane database reachable',
        fixHint: null,
        durationMs,
      }
    }

    return {
      check: 'db_connectivity',
      status: 'fail',
      message: 'SELECT 1 did not return expected row',
      fixHint: null,
      durationMs,
    }
  }

  return withTimeout(work(), 8000, 'db_connectivity').catch((err: unknown) => ({
    check: 'db_connectivity',
    status: 'fail' as CheckStatus,
    message: String((err as Error)?.message ?? err),
    fixHint: null,
    durationMs: Date.now() - start,
  }))
}

// ---------------------------------------------------------------------------
// Check 4: vector_backend
// ---------------------------------------------------------------------------

async function checkVectorBackend(): Promise<CheckResult> {
  const start = Date.now()
  const backend = getVectorBackend()
  const backendUrl = getVectorBackendUrl()

  // pgvector (default) — verify the extension is installed via DB
  if (backend === '' || backend === 'pgvector') {
    const work = async (): Promise<CheckResult> => {
      const result = await query<{ extversion: string | null }>(
        `SELECT extversion FROM pg_extension WHERE extname = 'vector' LIMIT 1`
      )
      const durationMs = Date.now() - start

      if (result.rows.length > 0 && result.rows[0].extversion) {
        return {
          check: 'vector_backend',
          status: 'pass',
          message: `pgvector installed (version ${result.rows[0].extversion})`,
          fixHint: null,
          durationMs,
        }
      }

      return {
        check: 'vector_backend',
        status: 'warn',
        message: 'pgvector extension not installed in PostgreSQL',
        fixHint: 'Vector backend unreachable. Vector search will use in-process fallback. Check IRANTI_QDRANT_URL or IRANTI_CHROMA_URL.',
        durationMs,
      }
    }

    return withTimeout(work(), 3000, 'vector_backend').catch((err: unknown) => ({
      check: 'vector_backend',
      status: 'warn' as CheckStatus,
      message: String((err as Error)?.message ?? err),
      fixHint: 'Vector backend unreachable. Vector search will use in-process fallback. Check IRANTI_QDRANT_URL or IRANTI_CHROMA_URL.',
      durationMs: Date.now() - start,
    }))
  }

  // qdrant or chroma — probe the configured URL
  if (!backendUrl) {
    return {
      check: 'vector_backend',
      status: 'warn',
      message: `Vector backend configured as '${backend}' but no URL set`,
      fixHint: 'Vector backend unreachable. Vector search will use in-process fallback. Check IRANTI_QDRANT_URL or IRANTI_CHROMA_URL.',
      durationMs: Date.now() - start,
    }
  }

  const work = async (): Promise<CheckResult> => {
    const controller = new AbortController()
    const probeRes = await fetch(backendUrl, {
      method: 'GET',
      signal: controller.signal,
    })
    const durationMs = Date.now() - start

    if (probeRes.status < 500) {
      return {
        check: 'vector_backend',
        status: 'pass',
        message: `${backend} backend reachable at ${backendUrl} (HTTP ${probeRes.status})`,
        fixHint: null,
        durationMs,
      }
    }

    return {
      check: 'vector_backend',
      status: 'warn',
      message: `${backend} backend returned HTTP ${probeRes.status} at ${backendUrl}`,
      fixHint: 'Vector backend unreachable. Vector search will use in-process fallback. Check IRANTI_QDRANT_URL or IRANTI_CHROMA_URL.',
      durationMs,
    }
  }

  return withTimeout(work(), 3000, 'vector_backend').catch((err: unknown) => ({
    check: 'vector_backend',
    status: 'warn' as CheckStatus,
    message: String((err as Error)?.message ?? err),
    fixHint: 'Vector backend unreachable. Vector search will use in-process fallback. Check IRANTI_QDRANT_URL or IRANTI_CHROMA_URL.',
    durationMs: Date.now() - start,
  }))
}

// ---------------------------------------------------------------------------
// Check 5: ingest_roundtrip
// ---------------------------------------------------------------------------

async function checkIngestRoundtrip(): Promise<CheckResult> {
  const start = Date.now()
  const baseUrl = getIrantiUrl()
  const probeTimestamp = new Date().toISOString()

  const work = async (): Promise<CheckResult> => {
    // Step 1: Write the probe fact via POST /kb/write
    // Iranti v0.2.21: entity field uses "type/id" slash format; agent is required.
    const writeRes = await fetch(`${baseUrl}/kb/write`, {
      method: 'POST',
      headers: buildIrantiHeaders(),
      body: JSON.stringify({
        entity: '__diagnostics__/__probe__',
        agent: 'control_plane_operator',
        key: 'probe_timestamp',
        value: probeTimestamp,
        summary: 'Diagnostic probe — safe to delete',
        confidence: 50,
        source: 'control_plane_diagnostics',
      }),
    })

    if (!writeRes.ok) {
      return {
        check: 'ingest_roundtrip',
        status: 'fail',
        message: `Write probe failed: POST /kb/write returned HTTP ${writeRes.status}`,
        fixHint: writeRes.status === 404
          ? 'Iranti is not running — start it first: iranti run --instance <name>'
          : 'Check IRANTI_API_KEY scope (requires kb:write) and confirm Iranti is running.',
        durationMs: Date.now() - start,
      }
    }

    // Step 2: Read back via GET /kb/search (Iranti v0.2.21 uses /kb/search, not /kb/query)
    const queryRes = await fetch(
      `${baseUrl}/kb/search?query=probe_timestamp&limit=5`,
      {
        method: 'GET',
        headers: buildIrantiHeaders(),
      }
    )

    if (!queryRes.ok) {
      // Write succeeded but read failed — still a fail
      await deleteProbeFact(baseUrl)
      return {
        check: 'ingest_roundtrip',
        status: 'fail',
        message: `Read probe failed: GET /kb/search returned HTTP ${queryRes.status}`,
        fixHint: null,
        durationMs: Date.now() - start,
      }
    }

    const queryBody = await queryRes.json() as unknown
    // Filter search results to only the probe entity (entity is normalized to __diagnostics__/probe)
    const readValue = extractProbeValueFromSearch(queryBody)

    // Step 3: Best-effort delete
    await deleteProbeFact(baseUrl)

    const durationMs = Date.now() - start

    if (readValue !== null) {
      return {
        check: 'ingest_roundtrip',
        status: 'pass',
        message: `Ingest round-trip succeeded: wrote and read back probe fact in ${durationMs}ms`,
        fixHint: null,
        durationMs,
      }
    }

    return {
      check: 'ingest_roundtrip',
      status: 'fail',
      message: 'Probe fact was written but could not be read back (value missing from query response)',
      fixHint: null,
      durationMs,
    }
  }

  return withTimeout(work(), 5000, 'ingest_roundtrip').catch((err: unknown) => {
    // Best-effort probe cleanup on timeout/error
    deleteProbeFact(baseUrl).catch(() => { /* ignore cleanup errors */ })
    return {
      check: 'ingest_roundtrip',
      status: 'fail' as CheckStatus,
      message: String((err as Error)?.message ?? err),
      fixHint: null,
      durationMs: Date.now() - start,
    }
  })
}

/**
 * Extract the probe value from Iranti's /kb/search response.
 * Filters to items whose entity matches the probe entity before extracting value.
 * Returns null if the probe entity is not found.
 */
function extractProbeValueFromSearch(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null
  const obj = body as Record<string, unknown>

  // /kb/search returns { results: [...] }
  const items = Array.isArray(obj.results) ? obj.results as unknown[]
    : Array.isArray(obj.facts) ? obj.facts as unknown[]
    : Array.isArray(obj.items) ? obj.items as unknown[]
    : Array.isArray(body) ? body as unknown[]
    : []

  for (const item of items) {
    if (item === null || typeof item !== 'object') continue
    const f = item as Record<string, unknown>
    // Match probe entity — Iranti normalizes __diagnostics__/__probe__ → __diagnostics__/probe
    const entityStr = typeof f.entity === 'string' ? f.entity : ''
    if (!entityStr.startsWith('__diagnostics__')) continue
    if (f.key !== 'probe_timestamp') continue
    const val = f.value ?? f.valueRaw ?? f.valueSummary
    if (val !== null && val !== undefined) return String(val)
  }

  return null
}

/**
 * Extract the value from a generic Iranti KB response body.
 * Handles multiple response shapes across API versions.
 */
function extractProbeValue(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null
  const obj = body as Record<string, unknown>

  const candidates: unknown[] = Array.isArray(body) ? body
    : Array.isArray(obj.results) ? obj.results as unknown[]
    : Array.isArray(obj.facts) ? obj.facts as unknown[]
    : Array.isArray(obj.items) ? obj.items as unknown[]
    : obj.fact !== undefined ? [obj.fact]
    : (obj.value !== undefined || obj.valueRaw !== undefined) ? [obj]
    : []

  for (const item of candidates) {
    if (item === null || typeof item !== 'object') continue
    const f = item as Record<string, unknown>
    const val = f.value ?? f.valueRaw ?? f.valueSummary
    if (val !== null && val !== undefined) return String(val)
  }

  return null
}

/**
 * Best-effort delete of the probe fact via DELETE /kb/entity (or equivalent).
 * Iranti may not expose a delete endpoint — failure is silently swallowed.
 */
async function deleteProbeFact(baseUrl: string): Promise<void> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    try {
      // Best-effort cleanup — no delete endpoint confirmed in Iranti v0.2.21;
      // probe facts accumulate but are confined to the __diagnostics__ entity namespace.
      await fetch(
        `${baseUrl}/kb/delete?entity=__diagnostics__/__probe__&key=probe_timestamp`,
        {
          method: 'DELETE',
          headers: buildIrantiHeaders(),
          signal: controller.signal,
        }
      )
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    // Cleanup failure is silently swallowed — does not affect check result
  }
}

// ---------------------------------------------------------------------------
// Check 6: attend_check
// ---------------------------------------------------------------------------

async function checkAttend(): Promise<CheckResult> {
  const start = Date.now()
  const baseUrl = getIrantiUrl()

  const work = async (): Promise<CheckResult> => {
    // Iranti v0.2.21: /memory/attend requires agent + query; currentContext is optional.
    const attendRes = await fetch(`${baseUrl}/memory/attend`, {
      method: 'POST',
      headers: buildIrantiHeaders(),
      body: JSON.stringify({
        agent: 'control_plane_operator',
        query: 'diagnostic probe',
        currentContext: 'diagnostic probe',
      }),
    })

    const durationMs = Date.now() - start

    if (!attendRes.ok) {
      const isUnreachable = attendRes.status === 404 || attendRes.status === 503
      return {
        check: 'attend_check',
        status: 'fail',
        message: `POST /memory/attend returned HTTP ${attendRes.status}`,
        fixHint: isUnreachable
          ? 'Iranti is not running or the Attendant route is unavailable. Start Iranti: iranti run --instance <name>'
          : 'Attendant endpoint returned an error. Check Iranti logs for details.',
        durationMs,
      }
    }

    // Parse response to check for classification_parse_failed_default_false indicator
    let parseFailed = false
    try {
      const body = await attendRes.json() as unknown
      const bodyStr = JSON.stringify(body)
      if (bodyStr.includes('classification_parse_failed_default_false')) {
        parseFailed = true
      }
    } catch { /* if body parse fails, we still got 200 — treat as pass */ }

    if (parseFailed) {
      return {
        check: 'attend_check',
        status: 'warn',
        message: 'Attendant returned 200 but classifier reported a parse failure — memory injection may be unreliable',
        fixHint: 'Use forceInject: true in iranti_attend to bypass the classifier, or provide explicit entityHints to iranti_observe.',
        durationMs,
      }
    }

    return {
      check: 'attend_check',
      status: 'pass',
      message: 'Attendant responded successfully — memory injection functional',
      fixHint: null,
      durationMs,
    }
  }

  return withTimeout(work(), 8000, 'attend_check').catch((err: unknown) => ({
    check: 'attend_check',
    status: 'fail' as CheckStatus,
    message: String((err as Error)?.message ?? err),
    fixHint: 'Iranti may not be running or timed out. Start with: iranti run --instance <name>',
    durationMs: Date.now() - start,
  }))
}

// ---------------------------------------------------------------------------
// Check 7: vector_search_check
// ---------------------------------------------------------------------------

async function checkVectorSearch(): Promise<CheckResult> {
  const start = Date.now()
  const baseUrl = getIrantiUrl()

  const work = async (): Promise<CheckResult> => {
    const searchRes = await fetch(
      `${baseUrl}/kb/search?query=diagnostic+probe&limit=1`,
      {
        method: 'GET',
        headers: buildIrantiHeaders(),
      }
    )

    const durationMs = Date.now() - start

    if (!searchRes.ok) {
      return {
        check: 'vector_search_check',
        status: 'fail',
        message: `GET /kb/search returned HTTP ${searchRes.status}`,
        fixHint: searchRes.status === 404
          ? 'Iranti is not running — start it first: iranti run --instance <name>'
          : 'Check IRANTI_API_KEY scope (requires kb:read) and confirm Iranti is running.',
        durationMs,
      }
    }

    // Parse results and check for non-zero vectorScore
    let hasVectorScore = false
    try {
      const body = await searchRes.json() as unknown
      const items = extractSearchItems(body)
      hasVectorScore = items.some((item) => {
        const f = item as Record<string, unknown>
        const score = f.vectorScore ?? f.vector_score ?? f.score
        return typeof score === 'number' && score > 0
      })
    } catch { /* parse failure — treat as pass since HTTP 200 */ }

    if (!hasVectorScore) {
      return {
        check: 'vector_search_check',
        status: 'warn',
        message: 'Vector search returned 200 but vectorScore=0 for all results (in-process fallback may be active)',
        fixHint: null,
        durationMs,
      }
    }

    return {
      check: 'vector_search_check',
      status: 'pass',
      message: 'Vector search returned results with non-zero vectorScore',
      fixHint: null,
      durationMs,
    }
  }

  return withTimeout(work(), 8000, 'vector_search_check').catch((err: unknown) => ({
    check: 'vector_search_check',
    status: 'fail' as CheckStatus,
    message: String((err as Error)?.message ?? err),
    fixHint: null,
    durationMs: Date.now() - start,
  }))
}

function extractSearchItems(body: unknown): unknown[] {
  if (Array.isArray(body)) return body
  if (body !== null && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    if (Array.isArray(obj.results)) return obj.results as unknown[]
    if (Array.isArray(obj.items)) return obj.items as unknown[]
    if (Array.isArray(obj.facts)) return obj.facts as unknown[]
  }
  return []
}

// ---------------------------------------------------------------------------
// Main diagnostic runner
// ---------------------------------------------------------------------------

async function runDiagnostics(): Promise<DiagnosticResult> {
  const runAt = new Date().toISOString()
  const totalStart = Date.now()

  // Run all checks in parallel using safeRun wrappers (never throws).
  // Order matches the ticket spec table for consistent output ordering.
  const checks = await Promise.all([
    safeRun('iranti_connectivity', checkIrantiConnectivity),
    safeRun('iranti_auth', checkIrantiAuth),
    safeRun('db_connectivity', checkDbConnectivity),
    safeRun('vector_backend', checkVectorBackend),
    safeRun('ingest_roundtrip', checkIngestRoundtrip),
    safeRun('attend_check', checkAttend),
    safeRun('vector_search_check', checkVectorSearch),
  ])

  const totalDurationMs = Date.now() - totalStart
  const overallStatus = computeOverallStatus(checks)

  return { runAt, overallStatus, checks, totalDurationMs }
}

// ---------------------------------------------------------------------------
// POST /diagnostics/run
// ---------------------------------------------------------------------------

diagnosticsRouter.post(
  '/run',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await runDiagnostics()
      // Update in-memory cache
      lastDiagnosticResult = result
      res.json(result)
    } catch (err) {
      // AC-3: catch any unexpected top-level error and return a degraded result
      // rather than letting this 500.
      const errorMessage = String((err as Error)?.message ?? err)
      const fallback: DiagnosticResult = {
        runAt: new Date().toISOString(),
        overallStatus: 'fail',
        checks: [
          {
            check: 'diagnostics_runner',
            status: 'fail',
            message: `Diagnostic run failed unexpectedly: ${errorMessage}`,
            fixHint: null,
            durationMs: 0,
          },
        ],
        totalDurationMs: 0,
      }
      lastDiagnosticResult = fallback
      res.json(fallback)
      next
    }
  }
)

// ---------------------------------------------------------------------------
// GET /diagnostics/last
// ---------------------------------------------------------------------------

diagnosticsRouter.get(
  '/last',
  (_req: Request, res: Response) => {
    if (lastDiagnosticResult === null) {
      res.status(404).json({
        error: 'No diagnostic run has been performed in this server session',
        code: 'NO_DIAGNOSTIC_RUN',
      })
      return
    }
    res.json(lastDiagnosticResult)
  }
)

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

diagnosticsRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const apiErr = err as ApiError
  res.status(apiErr.statusCode ?? 500).json({
    error: apiErr.message ?? 'Internal server error',
    code: apiErr.code ?? 'INTERNAL_ERROR',
  })
})
