import { Router, Request, Response } from 'express'
import { env, query } from '../../db.js'
import { ApiError } from '../../types.js'

export const sessionsRouter = Router()

export type SessionRawStatus = 'active' | 'interrupted' | 'completed' | 'abandoned' | null
export type SessionOperatorState = 'none' | 'active' | 'interrupted' | 'completed' | 'abandoned'
export type SessionComplianceStatus = 'healthy' | 'degraded' | 'non_compliant'
export type SessionListSort = 'operator' | 'updated_desc' | 'agent_asc'

export interface SessionComplianceRecord {
  status: SessionComplianceStatus
  summary: string
  issues: Array<{
    code: string
    severity: 'warn' | 'error'
    count: number
    message: string
    requiredAction: string
  }>
  lastUpdated: string | null
  counters: {
    attendsWithoutPersist: number
    consecutivePreResponseWithoutPost: number
    pendingPostResponse: boolean
    lastAttendPhase: 'pre-response' | 'post-response' | 'mid-turn' | null
  }
}

export interface SessionRecord {
  sessionId: string
  agentId: string
  status: SessionRawStatus
  operatorState: SessionOperatorState
  state?: 'checkpointed' | 'interrupted' | 'complete' | 'abandoned' | 'unknown'
  task: string | null
  startedAt: string | null
  lastHeartbeatAt: string | null
  updatedAt: string | null
  lastCheckpointAt?: string | null
  completedAt: string | null
  abandonedAt: string | null
  resumedAt?: string | null
  isStale: boolean
  persistedBriefGeneratedAt?: string | null
  checkpointSummary?: {
    currentStep: string | null
    nextStep: string | null
    openRiskCount: number
    entityTargetCount: number
  } | null
  compliance?: SessionComplianceRecord | null
  checkpoint?: Record<string, unknown> | null
  recovery?: Record<string, unknown> | null
}

export interface SessionsResponse {
  sessions: SessionRecord[]
  total: number
  fetchedAt: string
  note?: string
  error?: string
}

export interface SessionLedgerRecord {
  eventId: string
  timestamp: string
  staffComponent: 'Librarian' | 'Attendant' | 'Archivist' | 'Resolutionist'
  actionType: string
  agentId: string
  source: string
  entityType?: string | null
  entityId?: string | null
  key?: string | null
  reason?: string | null
  level: 'audit' | 'debug'
  metadata?: Record<string, unknown> | null
}

export interface SessionLedgerResponse {
  items: SessionLedgerRecord[]
  total: number
  fetchedAt: string
  note?: string
  error?: string
}

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

function getIrantiUrl(): string {
  const explicit = env['IRANTI_URL'] ?? process.env['IRANTI_URL'] ?? ''
  if (explicit.trim()) return explicit.trim().replace(/\/$/, '')
  const port = env['IRANTI_PORT'] ?? process.env['IRANTI_PORT'] ?? '3001'
  return `http://localhost:${port}`
}

function getIrantiApiKey(): string {
  return env['IRANTI_API_KEY'] ?? process.env['IRANTI_API_KEY'] ?? ''
}

function buildHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const incomingKey = req.headers['x-iranti-key']
  const apiKey = typeof incomingKey === 'string' && incomingKey.trim()
    ? incomingKey
    : getIrantiApiKey()
  if (apiKey) headers['X-Iranti-Key'] = apiKey
  return headers
}

function coerceDate(value: Date | string | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : String(value)
}

function normalizeStatus(value: unknown): SessionRawStatus {
  switch (value) {
    case 'active':
    case 'interrupted':
    case 'completed':
    case 'abandoned':
      return value
    case 'complete':
      return 'completed'
    default:
      return null
  }
}

function normalizeOperatorState(value: unknown): SessionOperatorState {
  switch (value) {
    case 'active':
    case 'interrupted':
    case 'completed':
    case 'abandoned':
    case 'none':
      return value
    case 'complete':
      return 'completed'
    case 'checkpointed':
      return 'active'
    default:
      return 'none'
  }
}

function legacyState(status: SessionRawStatus, operatorState: SessionOperatorState): SessionRecord['state'] {
  if (operatorState === 'interrupted') return 'interrupted'
  if (operatorState === 'completed') return 'complete'
  if (operatorState === 'abandoned') return 'abandoned'
  if (operatorState === 'active' || status === 'active') return 'checkpointed'
  return 'unknown'
}

function buildCheckpointSummary(value: unknown): SessionRecord['checkpointSummary'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  return {
    currentStep: typeof raw['currentStep'] === 'string' ? raw['currentStep'] : null,
    nextStep: typeof raw['nextStep'] === 'string' ? raw['nextStep'] : null,
    openRiskCount: Array.isArray(raw['openRisks']) ? raw['openRisks'].length : Number(raw['openRiskCount'] ?? 0),
    entityTargetCount: Array.isArray(raw['entityTargets']) ? raw['entityTargets'].length : Number(raw['entityTargetCount'] ?? 0),
  }
}

function buildComplianceSummary(value: unknown): SessionComplianceRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const status = raw['status']
  if (status !== 'healthy' && status !== 'degraded' && status !== 'non_compliant') return null

  const countersRaw = raw['counters']
  const counters = countersRaw && typeof countersRaw === 'object' && !Array.isArray(countersRaw)
    ? countersRaw as Record<string, unknown>
    : {}
  const lastAttendPhase = counters['lastAttendPhase']

  return {
    status,
    summary: typeof raw['summary'] === 'string' ? raw['summary'] : '',
    issues: Array.isArray(raw['issues'])
      ? raw['issues']
          .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
          .map((entry) => ({
            code: typeof entry['code'] === 'string' ? entry['code'] : 'unknown',
            severity: entry['severity'] === 'error' ? 'error' : 'warn',
            count: typeof entry['count'] === 'number' ? entry['count'] : 0,
            message: typeof entry['message'] === 'string' ? entry['message'] : '',
            requiredAction: typeof entry['requiredAction'] === 'string' ? entry['requiredAction'] : '',
          }))
      : [],
    lastUpdated: typeof raw['lastUpdated'] === 'string' ? raw['lastUpdated'] : null,
    counters: {
      attendsWithoutPersist: typeof counters['attendsWithoutPersist'] === 'number' ? counters['attendsWithoutPersist'] : 0,
      consecutivePreResponseWithoutPost: typeof counters['consecutivePreResponseWithoutPost'] === 'number' ? counters['consecutivePreResponseWithoutPost'] : 0,
      pendingPostResponse: counters['pendingPostResponse'] === true,
      lastAttendPhase:
        lastAttendPhase === 'pre-response' || lastAttendPhase === 'post-response' || lastAttendPhase === 'mid-turn'
          ? lastAttendPhase
          : null,
    },
  }
}

export function normalizeSessionSummary(raw: Record<string, unknown>): SessionRecord {
  const status = normalizeStatus(raw['status'])
  const operatorState = normalizeOperatorState(raw['operatorState'])
  const lastHeartbeatAt = typeof raw['lastHeartbeatAt'] === 'string' ? raw['lastHeartbeatAt'] : null
  const updatedAt = typeof raw['updatedAt'] === 'string' ? raw['updatedAt'] : null
  return {
    sessionId: typeof raw['sessionId'] === 'string' ? raw['sessionId'] : '',
    agentId: typeof raw['agentId'] === 'string' ? raw['agentId'] : '',
    status,
    operatorState,
    state: legacyState(status, operatorState),
    task: typeof raw['task'] === 'string' ? raw['task'] : null,
    startedAt: typeof raw['startedAt'] === 'string' ? raw['startedAt'] : null,
    lastHeartbeatAt,
    updatedAt,
    lastCheckpointAt: updatedAt ?? lastHeartbeatAt,
    completedAt: typeof raw['completedAt'] === 'string' ? raw['completedAt'] : null,
    abandonedAt: typeof raw['abandonedAt'] === 'string' ? raw['abandonedAt'] : null,
    resumedAt: typeof raw['resumedAt'] === 'string' ? raw['resumedAt'] : null,
    isStale: raw['isStale'] === true,
    persistedBriefGeneratedAt: typeof raw['persistedBriefGeneratedAt'] === 'string' ? raw['persistedBriefGeneratedAt'] : null,
    checkpointSummary: buildCheckpointSummary(raw['checkpointSummary']),
    compliance: buildComplianceSummary(raw['compliance']),
    checkpoint: raw['checkpoint'] && typeof raw['checkpoint'] === 'object' && !Array.isArray(raw['checkpoint'])
      ? raw['checkpoint'] as Record<string, unknown>
      : null,
    recovery: raw['recovery'] && typeof raw['recovery'] === 'object' && !Array.isArray(raw['recovery'])
      ? raw['recovery'] as Record<string, unknown>
      : null,
  }
}

export function buildSessionFromLegacyKBRows(rows: LegacyKBSessionRow[]): SessionRecord[] {
  const bySession = new Map<string, LegacyKBSessionRow[]>()
  for (const row of rows) {
    const existing = bySession.get(row.entityId) ?? []
    existing.push(row)
    bySession.set(row.entityId, existing)
  }

  return Array.from(bySession.entries()).map(([sessionId, sessionRows]) => {
    const getVal = (key: string): string | null => {
      const row = sessionRows.find((entry) => entry.key === key)
      if (!row) return null
      if (typeof row.valueSummary === 'string') return row.valueSummary
      if (typeof row.valueRaw === 'string') return row.valueRaw
      return null
    }

    const status = normalizeStatus(getVal('status') ?? getVal('state'))
    const operatorState = normalizeOperatorState(status ?? getVal('state'))
    const firstRow = sessionRows[0]
    const updatedAt = coerceDate(firstRow?.updatedAt)
    const lastHeartbeatAt = getVal('lastHeartbeatAt') ?? getVal('lastCheckpointAt') ?? updatedAt
    return {
      sessionId,
      agentId: getVal('agentId') ?? (typeof firstRow?.createdBy === 'string' ? firstRow.createdBy : ''),
      status,
      operatorState,
      state: legacyState(status, operatorState),
      task: getVal('task'),
      startedAt: getVal('startedAt') ?? coerceDate(firstRow?.createdAt),
      lastHeartbeatAt,
      updatedAt,
      lastCheckpointAt: lastHeartbeatAt,
      completedAt: getVal('completedAt'),
      abandonedAt: getVal('abandonedAt'),
      resumedAt: getVal('resumedAt'),
      isStale: false,
      checkpointSummary: null,
      checkpoint: null,
      recovery: null,
    }
  })
}

export function buildSessionsFromAttendantStateRows(rows: AttendantStateRow[]): SessionRecord[] {
  const sessions: SessionRecord[] = []

  for (const row of rows) {
    if (!row.valueRaw || typeof row.valueRaw !== 'object' || Array.isArray(row.valueRaw)) continue
    const state = row.valueRaw as Record<string, unknown>
    const checkpoint = state['sessionCheckpoint']
    if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) continue
    const checkpointRecord = checkpoint as Record<string, unknown>
    const status = normalizeStatus(checkpointRecord['status'])
    const operatorState = normalizeOperatorState(
      checkpointRecord['operatorState'] ?? checkpointRecord['status']
    )
    const updatedAt = typeof checkpointRecord['updatedAt'] === 'string' ? checkpointRecord['updatedAt'] : coerceDate(row.updatedAt)
    const lastHeartbeatAt = typeof checkpointRecord['lastHeartbeatAt'] === 'string'
      ? checkpointRecord['lastHeartbeatAt']
      : updatedAt
    sessions.push({
      sessionId: typeof checkpointRecord['sessionId'] === 'string' ? checkpointRecord['sessionId'] : row.entityId,
      agentId: row.entityId,
      status,
      operatorState,
      state: legacyState(status, operatorState),
      task: typeof checkpointRecord['task'] === 'string' ? checkpointRecord['task'] : null,
      startedAt: typeof checkpointRecord['startedAt'] === 'string' ? checkpointRecord['startedAt'] : coerceDate(row.createdAt),
      lastHeartbeatAt,
      updatedAt,
      lastCheckpointAt: lastHeartbeatAt,
      completedAt: typeof checkpointRecord['completedAt'] === 'string' ? checkpointRecord['completedAt'] : null,
      abandonedAt: typeof checkpointRecord['abandonedAt'] === 'string' ? checkpointRecord['abandonedAt'] : null,
      resumedAt: typeof checkpointRecord['resumedAt'] === 'string' ? checkpointRecord['resumedAt'] : null,
      isStale: checkpointRecord['isStale'] === true || operatorState === 'interrupted',
      persistedBriefGeneratedAt: typeof state['briefGeneratedAt'] === 'string' ? state['briefGeneratedAt'] : null,
      checkpointSummary: buildCheckpointSummary(checkpointRecord['checkpoint']),
      compliance: buildComplianceSummary(state['compliance']),
      checkpoint: checkpointRecord['checkpoint'] && typeof checkpointRecord['checkpoint'] === 'object' && !Array.isArray(checkpointRecord['checkpoint'])
        ? checkpointRecord['checkpoint'] as Record<string, unknown>
        : null,
      recovery: state['sessionRecovery'] && typeof state['sessionRecovery'] === 'object' && !Array.isArray(state['sessionRecovery'])
        ? state['sessionRecovery'] as Record<string, unknown>
        : null,
    })
  }

  return sessions
}

function mergeSessions(primary: SessionRecord[], secondary: SessionRecord[]): SessionRecord[] {
  const merged = new Map<string, SessionRecord>()
  for (const session of secondary) merged.set(`${session.agentId}:${session.sessionId}`, session)
  for (const session of primary) merged.set(`${session.agentId}:${session.sessionId}`, session)
  return Array.from(merged.values())
}

function normalizeOperatorStateFilter(value: unknown): SessionOperatorState | undefined {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'active':
      return 'active'
    case 'interrupted':
      return 'interrupted'
    case 'completed':
    case 'complete':
      return 'completed'
    case 'abandoned':
      return 'abandoned'
    case 'none':
      return 'none'
    default:
      return undefined
  }
}

function normalizeSort(value: unknown): SessionListSort | undefined {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'operator':
      return 'operator'
    case 'agent_asc':
      return 'agent_asc'
    case 'updated_desc':
      return 'updated_desc'
    default:
      return undefined
  }
}

function normalizeLedgerLevel(value: unknown): 'audit' | 'debug' | undefined {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'audit':
      return 'audit'
    case 'debug':
      return 'debug'
    default:
      return undefined
  }
}

function parseLedgerLimit(value: unknown): number {
  if (value === undefined || value === null || String(value).trim() === '') {
    return 50
  }
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error('limit must be an integer >= 1')
  }
  return Math.min(parsed, 200)
}

function normalizeLedgerEvent(raw: Record<string, unknown>): SessionLedgerRecord {
  const level = normalizeLedgerLevel(raw['level']) ?? 'audit'
  const metadata = raw['metadata']
  return {
    eventId: String(raw['eventId'] ?? raw['event_id'] ?? raw['id'] ?? ''),
    timestamp: raw['timestamp'] instanceof Date ? raw['timestamp'].toISOString() : String(raw['timestamp'] ?? ''),
    staffComponent: String(raw['staffComponent'] ?? raw['staff_component'] ?? 'Attendant') as SessionLedgerRecord['staffComponent'],
    actionType: String(raw['actionType'] ?? raw['action_type'] ?? ''),
    agentId: String(raw['agentId'] ?? raw['agent_id'] ?? ''),
    source: String(raw['source'] ?? ''),
    entityType: typeof raw['entityType'] === 'string'
      ? raw['entityType']
      : typeof raw['entity_type'] === 'string'
        ? raw['entity_type']
        : null,
    entityId: typeof raw['entityId'] === 'string'
      ? raw['entityId']
      : typeof raw['entity_id'] === 'string'
        ? raw['entity_id']
        : null,
    key: typeof raw['key'] === 'string' ? raw['key'] : null,
    reason: typeof raw['reason'] === 'string' ? raw['reason'] : null,
    level,
    metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata as Record<string, unknown>
      : null,
  }
}

function applySessionFilters(
  sessions: SessionRecord[],
  options: { agentId?: string; operatorState?: SessionOperatorState; staleOnly?: boolean; sort?: SessionListSort; limit?: number },
): SessionRecord[] {
  let filtered = sessions

  if (options.agentId) filtered = filtered.filter((entry) => entry.agentId === options.agentId)
  if (options.operatorState) filtered = filtered.filter((entry) => entry.operatorState === options.operatorState)
  if (options.staleOnly) filtered = filtered.filter((entry) => entry.isStale)

  switch (options.sort) {
    case 'agent_asc':
      filtered = [...filtered].sort((a, b) => a.agentId.localeCompare(b.agentId))
      break
    case 'operator':
      filtered = [...filtered].sort((a, b) => a.operatorState.localeCompare(b.operatorState))
      break
    case 'updated_desc':
    default:
      filtered = [...filtered].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      break
  }

  if (options.limit && options.limit > 0) filtered = filtered.slice(0, options.limit)
  return filtered
}

async function fetchIrantiSessions(req: Request): Promise<{ sessions: SessionRecord[]; note?: string; error?: string }> {
  const url = new URL(`${getIrantiUrl()}/memory/sessions`)
  const operatorState = normalizeOperatorStateFilter(req.query['operatorState'] ?? req.query['state'])
  const staleOnly = req.query['staleOnly'] === 'true'
  const agentId = typeof req.query['agentId'] === 'string' ? req.query['agentId'].trim() : ''
  const sort = normalizeSort(req.query['sort'])
  const limit = Number.parseInt(String(req.query['limit'] ?? ''), 10)

  if (agentId) url.searchParams.set('agentId', agentId)
  if (operatorState) url.searchParams.set('operatorState', operatorState)
  if (staleOnly) url.searchParams.set('staleOnly', 'true')
  if (sort) url.searchParams.set('sort', sort)
  if (Number.isFinite(limit) && limit > 0) url.searchParams.set('limit', String(limit))

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: buildHeaders(req),
      signal: controller.signal,
    })

    if (!response.ok) {
      return {
        sessions: [],
        error: `Iranti /memory/sessions returned HTTP ${response.status}`,
      }
    }

    const body = await response.json() as unknown
    const rawSessions = Array.isArray(body)
      ? body
      : body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>)['sessions'])
        ? (body as Record<string, unknown>)['sessions'] as unknown[]
        : []

    const sessions = rawSessions
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
      .map(normalizeSessionSummary)

    return {
      sessions,
      note: 'Source: Iranti /memory/sessions',
    }
  } catch (error) {
    return {
      sessions: [],
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timeout)
  }
}

interface LedgerFetchResult {
  items: SessionLedgerRecord[]
  error?: string
}

async function fetchLedgerByParams(
  req: Request,
  params: Record<string, string>,
): Promise<LedgerFetchResult> {
  const url = new URL(`${getIrantiUrl()}/memory/ledger`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: buildHeaders(req),
      signal: controller.signal,
    })
    const body = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) {
      const upstreamError = typeof body['error'] === 'string' ? body['error'] : null
      return {
        items: [],
        error: upstreamError
          ? `Iranti /memory/ledger returned HTTP ${response.status}: ${upstreamError}`
          : `Iranti /memory/ledger returned HTTP ${response.status}`,
      }
    }
    const rawItems = Array.isArray(body['items']) ? body['items'] : []
    return {
      items: rawItems
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
        .map(normalizeLedgerEvent),
    }
  } catch (err) {
    return { items: [], error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchIrantiSessionLedger(
  req: Request,
  sessionId: string,
): Promise<SessionLedgerResponse> {
  const limit = parseLedgerLimit(req.query['limit'])
  const agentId = typeof req.query['agentId'] === 'string' ? req.query['agentId'].trim() : ''
  const actionType = typeof req.query['actionType'] === 'string' ? req.query['actionType'].trim() : ''
  const host = typeof req.query['host'] === 'string' ? req.query['host'].trim() : ''
  const level = normalizeLedgerLevel(req.query['level'])
  const startedAt = typeof req.query['startedAt'] === 'string' ? req.query['startedAt'].trim() : ''
  const lastHeartbeatAt = typeof req.query['lastHeartbeatAt'] === 'string' ? req.query['lastHeartbeatAt'].trim() : ''

  const sharedParams: Record<string, string> = { limit: String(limit) }
  if (agentId) sharedParams['agentId'] = agentId
  if (actionType) sharedParams['actionType'] = actionType
  if (host) sharedParams['host'] = host
  if (level) sharedParams['level'] = level

  try {
    // Query 1: by named sessionId (catches checkpoint events)
    const bySessionId = fetchLedgerByParams(req, { ...sharedParams, sessionId })

    // Query 2: by agentId + time range (catches attend/inject events that use a
    // timestamp-based sessionId). Only possible when we have time bounds + agentId.
    let byTimeRange: Promise<LedgerFetchResult> = Promise.resolve({ items: [] })
    if (agentId && startedAt) {
      const after = new Date(new Date(startedAt).getTime() - 10 * 60_000).toISOString()
      const before = lastHeartbeatAt
        ? new Date(new Date(lastHeartbeatAt).getTime() + 2 * 60_000).toISOString()
        : new Date().toISOString()
      byTimeRange = fetchLedgerByParams(req, {
        ...sharedParams,
        agentId,
        after,
        before,
        limit: String(limit),
      })
    }

    const [sessionResult, rangeResult] = await Promise.all([bySessionId, byTimeRange])

    // If the primary query failed and the range query also returned nothing,
    // propagate the primary error so the client knows why data is missing.
    if (sessionResult.error && rangeResult.items.length === 0) {
      return {
        items: [],
        total: 0,
        fetchedAt: new Date().toISOString(),
        note: 'Source: Iranti /memory/ledger',
        error: sessionResult.error,
      }
    }

    // Merge and deduplicate by eventId
    const seen = new Set<string>()
    const merged: SessionLedgerRecord[] = []
    for (const item of [...sessionResult.items, ...rangeResult.items]) {
      if (item.eventId && !seen.has(item.eventId)) {
        seen.add(item.eventId)
        merged.push(item)
      }
    }

    // Sort by timestamp descending (newest first)
    merged.sort((a, b) => (b.timestamp > a.timestamp ? 1 : b.timestamp < a.timestamp ? -1 : 0))

    // Respect limit
    const limited = merged.slice(0, limit)

    return {
      items: limited,
      total: merged.length,
      fetchedAt: new Date().toISOString(),
      note: 'Source: Iranti /memory/ledger',
    }
  } catch (error) {
    return {
      items: [],
      total: 0,
      fetchedAt: new Date().toISOString(),
      note: 'Source: Iranti /memory/ledger',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function fetchLocalFallbackSessions(): Promise<SessionRecord[]> {
  const [legacyResult, attendantResult] = await Promise.all([
    query<LegacyKBSessionRow>(`
      SELECT "entityId", key, "valueSummary", "valueRaw", "createdBy", "createdAt", "updatedAt", properties
      FROM knowledge_base
      WHERE "entityType" = 'session'
    `).catch(() => []),
    query<AttendantStateRow>(`
      SELECT "entityId", "valueRaw", "createdAt", "updatedAt"
      FROM knowledge_base
      WHERE "entityType" = 'agent' AND key = 'attendant_state'
    `).catch(() => []),
  ])

  const legacyRows = Array.isArray(legacyResult) ? legacyResult : legacyResult.rows
  const attendantRows = Array.isArray(attendantResult) ? attendantResult : attendantResult.rows

  return mergeSessions(
    buildSessionsFromAttendantStateRows(attendantRows),
    buildSessionFromLegacyKBRows(legacyRows),
  )
}

sessionsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const iranti = await fetchIrantiSessions(req)
    const operatorState = normalizeOperatorStateFilter(req.query['operatorState'] ?? req.query['state'])
    const staleOnly = req.query['staleOnly'] === 'true'
    const agentId = typeof req.query['agentId'] === 'string' ? req.query['agentId'].trim() : undefined
    const sort = normalizeSort(req.query['sort'])
    const limit = Number.parseInt(String(req.query['limit'] ?? ''), 10)

    if (!iranti.error) {
      const sessions = applySessionFilters(iranti.sessions, {
        agentId,
        operatorState,
        staleOnly,
        sort,
        limit: Number.isFinite(limit) ? limit : undefined,
      })
      const body: SessionsResponse = {
        sessions,
        total: sessions.length,
        fetchedAt: new Date().toISOString(),
        note: iranti.note,
      }
      res.json(body)
      return
    }

    const fallbackSessions = applySessionFilters(await fetchLocalFallbackSessions(), {
      agentId,
      operatorState,
      staleOnly,
      sort,
      limit: Number.isFinite(limit) ? limit : undefined,
    })

    const body: SessionsResponse = {
      sessions: fallbackSessions,
      total: fallbackSessions.length,
      fetchedAt: new Date().toISOString(),
      note: 'Iranti session API unavailable - returned local fallback data from attendant/session facts.',
      error: iranti.error,
    }
    res.json(body)
  } catch (error) {
    res.status(200).json({
      sessions: [],
      total: 0,
      fetchedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    } satisfies SessionsResponse)
  }
})

sessionsRouter.get('/:sessionId/ledger', async (req: Request, res: Response) => {
  try {
    const sessionId = typeof req.params['sessionId'] === 'string' ? req.params['sessionId'].trim() : ''
    if (!sessionId) {
      res.status(400).json({
        items: [],
        total: 0,
        fetchedAt: new Date().toISOString(),
        error: 'sessionId path parameter is required.',
      } satisfies SessionLedgerResponse)
      return
    }

    const ledger = await fetchIrantiSessionLedger(req, sessionId)
    res.json(ledger)
  } catch (error) {
    res.status(400).json({
      items: [],
      total: 0,
      fetchedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    } satisfies SessionLedgerResponse)
  }
})

async function proxySessionAction(
  req: Request,
  res: Response,
  action: 'resume' | 'abandon',
): Promise<void> {
  const agentId = typeof req.body?.agentId === 'string' ? req.body.agentId.trim() : ''
  if (!agentId) {
    res.status(400).json({
      success: false,
      sessionId: req.params['sessionId'] ?? '',
      error: 'agentId is required.',
    })
    return
  }

  try {
    const response = await fetch(`${getIrantiUrl()}/memory/${action}`, {
      method: 'POST',
      headers: buildHeaders(req),
      body: JSON.stringify({ agentId, sessionId: req.params['sessionId'] }),
    })
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) {
      res.status(response.status).json({
        success: false,
        sessionId: req.params['sessionId'] ?? '',
        error: typeof payload['error'] === 'string' ? payload['error'] : `${action} failed`,
      })
      return
    }

    res.json({
      success: true,
      sessionId: req.params['sessionId'] ?? '',
      message: `${action} completed`,
    })
  } catch (error) {
    res.status(502).json({
      success: false,
      sessionId: req.params['sessionId'] ?? '',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

sessionsRouter.post('/:sessionId/resume', async (req: Request, res: Response) => {
  await proxySessionAction(req, res, 'resume')
})

sessionsRouter.post('/:sessionId/abandon', async (req: Request, res: Response) => {
  await proxySessionAction(req, res, 'abandon')
})

sessionsRouter.use((err: unknown, _req: Request, res: Response, _next: unknown) => {
  const apiErr = err as ApiError
  res.status(apiErr.statusCode ?? 500).json({
    error: apiErr.message ?? 'Internal server error',
    code: apiErr.code ?? 'INTERNAL_ERROR',
  })
})
