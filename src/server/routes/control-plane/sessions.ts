/**
 * Session Recovery proxy routes — CP-T071
 *
 * Surfaces Iranti session lifecycle state so operators can see which sessions
 * are interrupted, checkpointed, complete, or abandoned.
 *
 * Routes:
 *   GET  /sessions                          — list sessions (Iranti proxy → local KB fallback)
 *   POST /sessions/:sessionId/resume        — resume a checkpointed/interrupted session
 *   POST /sessions/:sessionId/abandon       — abandon a session
 *
 * Session listing: Iranti does not expose a list-sessions endpoint (confirmed
 * by inspecting memory.ts routes). The route queries the local knowledge_base
 * for facts with entityType='session' as the primary surface. If nothing exists
 * there either, an empty array is returned with a note explaining what was checked.
 *
 * Error handling: never returns HTTP 500. All failures return HTTP 200 with an
 * error field and empty sessions array (list endpoint) or appropriate error
 * object (action endpoints).
 */

import { Router, Request, Response } from 'express'
import { env, query } from '../../db.js'
import { ApiError } from '../../types.js'

export const sessionsRouter = Router()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionState = 'interrupted' | 'checkpointed' | 'complete' | 'abandoned' | 'unknown'

const VALID_STATES: ReadonlySet<string> = new Set([
  'interrupted',
  'checkpointed',
  'active',
  'complete',
  'abandoned',
  'all',
])

export interface SessionRecord {
  sessionId: string
  agentId: string
  state: SessionState
  task: string | null
  startedAt: string | null
  lastCheckpointAt: string | null
  completedAt: string | null
  abandonedAt: string | null
}

export interface SessionsResponse {
  sessions: SessionRecord[]
  total: number
  fetchedAt: string
  note?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getIrantiUrl(): string {
  return (env['IRANTI_URL'] ?? process.env['IRANTI_URL'] ?? 'http://localhost:3001').replace(/\/$/, '')
}

function getIrantiApiKey(): string {
  return env['IRANTI_API_KEY'] ?? process.env['IRANTI_API_KEY'] ?? ''
}

function buildHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const incomingKey = req.headers['x-iranti-key']
  const apiKey =
    typeof incomingKey === 'string' && incomingKey.trim()
      ? incomingKey
      : getIrantiApiKey()
  if (apiKey) {
    headers['X-Iranti-Key'] = apiKey
  }
  return headers
}

// ---------------------------------------------------------------------------
// Iranti session list probe
//
// Iranti v0.2.16 added checkpoint/resume/abandon actions but does NOT expose
// a list-sessions endpoint. We attempt a GET /memory/sessions probe; if Iranti
// returns 404 or a non-OK status we fall through to the local KB query.
// ---------------------------------------------------------------------------

interface IrantiSessionRaw {
  sessionId?: string
  session_id?: string
  agentId?: string
  agent_id?: string
  state?: string
  task?: string
  startedAt?: string
  started_at?: string
  lastCheckpointAt?: string
  last_checkpoint_at?: string
  completedAt?: string
  completed_at?: string
  abandonedAt?: string
  abandoned_at?: string
}

function normaliseIrantiSession(raw: IrantiSessionRaw): SessionRecord {
  const rawState = raw.state ?? 'unknown'
  const validSessionStates: ReadonlySet<string> = new Set([
    'interrupted', 'checkpointed', 'complete', 'abandoned', 'unknown',
  ])
  const state: SessionState = validSessionStates.has(rawState)
    ? (rawState as SessionState)
    : 'unknown'
  return {
    sessionId: raw.sessionId ?? raw.session_id ?? '',
    agentId: raw.agentId ?? raw.agent_id ?? '',
    state,
    task: raw.task ?? null,
    startedAt: raw.startedAt ?? raw.started_at ?? null,
    lastCheckpointAt: raw.lastCheckpointAt ?? raw.last_checkpoint_at ?? null,
    completedAt: raw.completedAt ?? raw.completed_at ?? null,
    abandonedAt: raw.abandonedAt ?? raw.abandoned_at ?? null,
  }
}

async function probeIrantiSessionList(
  req: Request
): Promise<{ sessions: SessionRecord[] | null; note: string }> {
  const baseUrl = getIrantiUrl()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    const irantiRes = await fetch(`${baseUrl}/memory/sessions`, {
      method: 'GET',
      headers: buildHeaders(req),
      signal: controller.signal,
    })

    if (!irantiRes.ok) {
      // 404 is expected — Iranti does not have this endpoint
      return {
        sessions: null,
        note: `Iranti /memory/sessions returned HTTP ${irantiRes.status} — falling back to local KB query.`,
      }
    }

    const body = await irantiRes.json() as unknown

    let raw: IrantiSessionRaw[]
    if (Array.isArray(body)) {
      raw = body as IrantiSessionRaw[]
    } else if (
      body !== null &&
      typeof body === 'object' &&
      'sessions' in (body as Record<string, unknown>) &&
      Array.isArray((body as Record<string, unknown>).sessions)
    ) {
      raw = (body as { sessions: IrantiSessionRaw[] }).sessions
    } else {
      return {
        sessions: null,
        note: 'Iranti /memory/sessions returned an unrecognised shape — falling back to local KB query.',
      }
    }

    return { sessions: raw.map(normaliseIrantiSession), note: '' }
  } catch (err: unknown) {
    const name = (err as Error)?.name
    if (name === 'AbortError' || name === 'TypeError') {
      return {
        sessions: null,
        note: 'Iranti instance unreachable — falling back to local KB query.',
      }
    }
    return {
      sessions: null,
      note: `Iranti probe error: ${String(err)} — falling back to local KB query.`,
    }
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// Local KB fallback
//
// Sessions written via iranti_ingest or the SDK may appear as KB facts with
// entityType='session'. We query the local knowledge_base table for these.
// ---------------------------------------------------------------------------

// knowledge_base uses camelCase column names (Iranti's Prisma schema)
export interface LegacyKBSessionRow {
  entityId: string
  key: string
  valueSummary: string | null
  valueRaw: unknown
  createdBy: string | null
  createdAt: Date | string
  updatedAt: Date | string | null
  properties: Record<string, unknown> | null
}

export interface AttendantStateRow {
  entityId: string
  valueRaw: unknown
  createdAt: Date | string
  updatedAt: Date | string | null
}

function coerceDate(d: Date | string | null | undefined): string | null {
  if (!d) return null
  if (d instanceof Date) return d.toISOString()
  return String(d)
}

export function buildSessionFromLegacyKBRows(rows: LegacyKBSessionRow[]): SessionRecord[] {
  // Group by entityId (sessionId)
  const bySession = new Map<string, LegacyKBSessionRow[]>()
  for (const row of rows) {
    const existing = bySession.get(row.entityId) ?? []
    existing.push(row)
    bySession.set(row.entityId, existing)
  }

  const sessions: SessionRecord[] = []
  for (const [sessionId, sessionRows] of bySession) {
    const getVal = (key: string): string | null => {
      const row = sessionRows.find((r) => r.key === key)
      if (!row) return null
      if (typeof row.valueSummary === 'string') return row.valueSummary
      if (typeof row.valueRaw === 'string') return row.valueRaw
      return null
    }

    // Derive state: look for a 'state' key
    let state: SessionState = 'unknown'
    const rawState = getVal('state')
    if (rawState) {
      const s = rawState.toLowerCase()
      if (s === 'interrupted') state = 'interrupted'
      else if (s === 'checkpointed') state = 'checkpointed'
      else if (s === 'complete') state = 'complete'
      else if (s === 'abandoned') state = 'abandoned'
    }

    // Determine agentId: look in a dedicated key or fall back to the row's createdBy column
    const anyRow = sessionRows[0]
    const agentId =
      getVal('agentId') ??
      (typeof anyRow?.createdBy === 'string' ? anyRow.createdBy : null) ??
      ''

    sessions.push({
      sessionId,
      agentId,
      state,
      task: getVal('task'),
      startedAt: getVal('startedAt') ?? coerceDate(anyRow?.createdAt),
      lastCheckpointAt: getVal('lastCheckpointAt'),
      completedAt: getVal('completedAt'),
      abandonedAt: getVal('abandonedAt'),
    })
  }

  return sessions
}

export function buildSessionsFromAttendantStateRows(rows: AttendantStateRow[]): SessionRecord[] {
  const sessions: SessionRecord[] = []

  for (const row of rows) {
    if (!row.valueRaw || typeof row.valueRaw !== 'object') continue

    const raw = row.valueRaw as Record<string, unknown>
    const checkpoint = raw['sessionCheckpoint']
    if (!checkpoint || typeof checkpoint !== 'object') continue

    const record = checkpoint as Record<string, unknown>
    const rawState = typeof record['status'] === 'string' ? record['status'] : 'unknown'
    const validSessionStates: ReadonlySet<string> = new Set([
      'interrupted', 'checkpointed', 'complete', 'completed', 'abandoned', 'active', 'unknown',
    ])
    const normalizedState = validSessionStates.has(rawState) ? rawState : 'unknown'

    let state: SessionState
    if (normalizedState === 'active') state = 'checkpointed'
    else if (normalizedState === 'completed') state = 'complete'
    else state = normalizedState as SessionState

    sessions.push({
      sessionId: typeof record['sessionId'] === 'string' ? record['sessionId'] : row.entityId,
      agentId: row.entityId,
      state,
      task: typeof record['task'] === 'string' ? record['task'] : null,
      startedAt: typeof record['startedAt'] === 'string' ? record['startedAt'] : coerceDate(row.createdAt),
      lastCheckpointAt:
        typeof record['updatedAt'] === 'string'
          ? record['updatedAt']
          : typeof record['lastHeartbeatAt'] === 'string'
            ? record['lastHeartbeatAt']
            : coerceDate(row.updatedAt),
      completedAt: typeof record['completedAt'] === 'string' ? record['completedAt'] : null,
      abandonedAt: typeof record['abandonedAt'] === 'string' ? record['abandonedAt'] : null,
    })
  }

  return sessions
}

async function queryLocalKBForSessions(): Promise<{
  sessions: SessionRecord[]
  note: string
}> {
  try {
    // Check if knowledge_base table exists
    const existsResult = await query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'knowledge_base'
       ) AS exists`
    )
    const tableExists = existsResult.rows[0]?.exists ?? false

    if (!tableExists) {
      return {
        sessions: [],
        note: 'Checked Iranti /memory/sessions (no endpoint) and local knowledge_base (table not found). No sessions available.',
      }
    }

    const attendantStateResult = await query<AttendantStateRow>(
      `SELECT "entityId", "valueRaw", "createdAt", "updatedAt"
       FROM knowledge_base
       WHERE "entityType" = 'agent' AND key = 'attendant_state'
       ORDER BY "createdAt" DESC
       LIMIT 500`
    )

    const attendantSessions = buildSessionsFromAttendantStateRows(attendantStateResult.rows)
    if (attendantSessions.length > 0) {
      return {
        sessions: attendantSessions,
        note: 'Sessions sourced from agent/attendant_state in local knowledge_base. Iranti does not expose a list-sessions endpoint.',
      }
    }

    const legacyResult = await query<LegacyKBSessionRow>(
      `SELECT "entityId", key, "valueSummary", "valueRaw", "createdBy", "createdAt", "updatedAt", properties
       FROM knowledge_base
       WHERE "entityType" = 'session'
       ORDER BY "createdAt" DESC
       LIMIT 500`
    )

    if (legacyResult.rows.length === 0) {
      return {
        sessions: [],
        note: 'Checked Iranti /memory/sessions (no endpoint), agent/attendant_state, and legacy entityType=session rows. No session facts found.',
      }
    }

    const sessions = buildSessionFromLegacyKBRows(legacyResult.rows)
    return {
      sessions,
      note: sessions.length > 0
        ? 'Sessions sourced from legacy entityType=session rows in local knowledge_base. Iranti does not expose a list-sessions endpoint.'
        : 'No session facts found in local knowledge_base (entityType=session).',
    }
  } catch (err: unknown) {
    return {
      sessions: [],
      note: `Local KB query failed: ${String(err)}. Checked Iranti /memory/sessions (no endpoint) and local knowledge_base.`,
    }
  }
}

// ---------------------------------------------------------------------------
// State filtering
// ---------------------------------------------------------------------------

function filterByState(sessions: SessionRecord[], state: string): SessionRecord[] {
  if (state === 'all') return sessions
  if (state === 'active') {
    return sessions.filter((s) => s.state !== 'complete' && s.state !== 'abandoned')
  }
  // 'interrupted' filter includes both 'interrupted' and 'checkpointed' states
  // since they both represent sessions needing attention, per AC-2
  if (state === 'interrupted') {
    return sessions.filter((s) => s.state === 'interrupted' || s.state === 'checkpointed')
  }
  return sessions.filter((s) => s.state === state)
}

// ---------------------------------------------------------------------------
// GET /sessions
// ---------------------------------------------------------------------------

sessionsRouter.get('/', async (req: Request, res: Response) => {
  const fetchedAt = new Date().toISOString()

  // Validate state param
  const stateParam = (req.query['state'] as string | undefined) ?? 'all'
  if (!VALID_STATES.has(stateParam)) {
    res.status(400).json({
      error: `Invalid state parameter: "${stateParam}". Valid values: interrupted, checkpointed, active, complete, abandoned, all`,
      code: 'INVALID_PARAM',
    })
    return
  }

  // Validate limit param
  const limitParam = req.query['limit'] as string | undefined
  let limit = 50
  if (limitParam !== undefined) {
    const parsed = parseInt(limitParam, 10)
    if (isNaN(parsed) || parsed < 1) {
      res.status(400).json({
        error: `Invalid limit parameter: "${limitParam}". Must be a positive integer.`,
        code: 'INVALID_PARAM',
      })
      return
    }
    limit = Math.min(parsed, 500)
  }

  const agentIdFilter = req.query['agentId'] as string | undefined

  try {
    // Step 1: try the Iranti sessions endpoint
    const { sessions: irantiSessions, note: irantiNote } = await probeIrantiSessionList(req)

    let sessions: SessionRecord[]
    let note: string

    if (irantiSessions !== null) {
      // Iranti had a sessions endpoint that returned data
      sessions = irantiSessions
      note = irantiNote
    } else {
      // Step 2: fall back to local KB
      const { sessions: kbSessions, note: kbNote } = await queryLocalKBForSessions()
      sessions = kbSessions
      note = irantiNote ? `${irantiNote} ${kbNote}` : kbNote
    }

    // Apply agentId filter
    if (agentIdFilter) {
      sessions = sessions.filter((s) => s.agentId === agentIdFilter)
    }

    // Apply state filter
    sessions = filterByState(sessions, stateParam)

    // Apply limit
    const sliced = sessions.slice(0, limit)

    const response: SessionsResponse = {
      sessions: sliced,
      total: sliced.length,
      fetchedAt,
      ...(note ? { note } : {}),
    }

    res.status(200).json(response)
  } catch (err: unknown) {
    // Never 500 — degrade gracefully
    console.error('[sessions] Unexpected error in GET /sessions:', err)
    const response: SessionsResponse = {
      sessions: [],
      total: 0,
      fetchedAt,
      error: `Unexpected error fetching sessions: ${String(err)}`,
      note: 'Checked Iranti /memory/sessions and local knowledge_base. Both failed due to an unexpected error.',
    }
    res.status(200).json(response)
  }
})

// ---------------------------------------------------------------------------
// POST /sessions/:sessionId/resume
// ---------------------------------------------------------------------------

sessionsRouter.post('/:sessionId/resume', async (req: Request, res: Response) => {
  const { sessionId } = req.params
  const body = req.body as Record<string, unknown>

  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null
  if (!agentId) {
    res.status(400).json({ error: 'agentId is required', code: 'MISSING_PARAM' })
    return
  }

  const baseUrl = getIrantiUrl()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    let irantiRes: globalThis.Response
    try {
      irantiRes = await fetch(`${baseUrl}/memory/resume`, {
        method: 'POST',
        headers: buildHeaders(req),
        signal: controller.signal,
        body: JSON.stringify({ sessionId, agentId }),
      })
    } finally {
      clearTimeout(timeout)
    }

    const responseBody = await irantiRes.json() as unknown
    res.status(irantiRes.status).json(responseBody)
  } catch (err: unknown) {
    clearTimeout(timeout)
    const name = (err as Error)?.name
    if (name === 'AbortError' || name === 'TypeError') {
      res.status(503).json({ error: 'Iranti instance unreachable', code: 'IRANTI_UNREACHABLE' })
      return
    }
    res.status(500).json({ error: `Resume failed: ${String(err)}`, code: 'INTERNAL_ERROR' })
  }
})

// ---------------------------------------------------------------------------
// POST /sessions/:sessionId/abandon
// ---------------------------------------------------------------------------

sessionsRouter.post('/:sessionId/abandon', async (req: Request, res: Response) => {
  const { sessionId } = req.params
  const body = req.body as Record<string, unknown>

  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null
  if (!agentId) {
    res.status(400).json({ error: 'agentId is required', code: 'MISSING_PARAM' })
    return
  }

  const baseUrl = getIrantiUrl()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    let irantiRes: globalThis.Response
    try {
      irantiRes = await fetch(`${baseUrl}/memory/abandon`, {
        method: 'POST',
        headers: buildHeaders(req),
        signal: controller.signal,
        body: JSON.stringify({ sessionId, agentId }),
      })
    } finally {
      clearTimeout(timeout)
    }

    const responseBody = await irantiRes.json() as unknown
    res.status(irantiRes.status).json(responseBody)
  } catch (err: unknown) {
    clearTimeout(timeout)
    const name = (err as Error)?.name
    if (name === 'AbortError' || name === 'TypeError') {
      res.status(503).json({ error: 'Iranti instance unreachable', code: 'IRANTI_UNREACHABLE' })
      return
    }
    res.status(500).json({ error: `Abandon failed: ${String(err)}`, code: 'INTERNAL_ERROR' })
  }
})

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

sessionsRouter.use((err: unknown, _req: Request, res: Response, _next: unknown) => {
  const apiErr = err as ApiError
  res.status(apiErr.statusCode ?? 500).json({
    error: apiErr.message ?? 'Internal server error',
    code: apiErr.code ?? 'INTERNAL_ERROR',
  })
})
