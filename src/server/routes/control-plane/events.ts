/**
 * Staff Events routes
 *
 * GET /events        — paginated list of staff_events
 * GET /events/stream — SSE endpoint, polls DB every 1s, heartbeat every 15s
 *
 * Graceful degradation: if staff_events table does not exist (migration not applied),
 * /events returns empty results and /events/stream returns an empty stream with a
 * clear error event — no crash.
 *
 * PHASE 1 LIMITATION: Attendant and Resolutionist events cannot be reconstructed
 * from DB state alone. They require native emitter injection into the upstream
 * Iranti Staff components (planned for Phase 2 per PM decision OQ-1).
 * When filtering by staffComponent=Attendant or staffComponent=Resolutionist,
 * the response will be empty until native emitters are added upstream.
 */

import { Router, Request, Response, NextFunction } from 'express'
import { query } from '../../db.js'
import { StaffEvent, createApiError, ApiError } from '../../types.js'

export const eventsRouter = Router()

// ---------------------------------------------------------------------------
// Table existence cache
// ---------------------------------------------------------------------------

let staffEventsTableExists: boolean | null = null

async function assertStaffEventsTableExists(): Promise<boolean> {
  if (staffEventsTableExists === true) return true

  try {
    const result = await query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'staff_events'
      ) AS exists`
    )
    staffEventsTableExists = result.rows[0]?.exists ?? false
  } catch {
    staffEventsTableExists = false
  }

  return staffEventsTableExists
}

// Invalidate cache on DB errors
function invalidateTableCache(): void {
  staffEventsTableExists = null
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_COMPONENTS = ['Librarian', 'Attendant', 'Archivist', 'Resolutionist']
const VALID_LEVELS = ['audit', 'debug']

interface EventFilters {
  staffComponent?: string
  actionType?: string
  agentId?: string
  entityType?: string
  entityId?: string
  level: string
  since?: Date
  until?: Date
}

function validateEventFilters(queryParams: Record<string, unknown>): EventFilters {
  const staffComponent = queryParams.staffComponent as string | undefined
  const level = (queryParams.level as string | undefined) ?? 'audit'
  const since = queryParams.since as string | undefined
  const until = queryParams.until as string | undefined

  if (staffComponent && !VALID_COMPONENTS.includes(staffComponent)) {
    throw createApiError(
      `Invalid staffComponent: ${staffComponent}`,
      'INVALID_PARAM',
      400,
      { field: 'staffComponent', allowedValues: VALID_COMPONENTS, received: staffComponent }
    )
  }

  if (!VALID_LEVELS.includes(level)) {
    throw createApiError(
      `level must be 'audit' or 'debug'`,
      'INVALID_PARAM',
      400,
      { field: 'level', allowedValues: VALID_LEVELS, received: level }
    )
  }

  let sinceDate: Date | undefined
  if (since) {
    if (isNaN(Date.parse(since))) {
      throw createApiError(`since must be a valid ISO 8601 timestamp`, 'INVALID_PARAM', 400, { field: 'since', received: since })
    }
    sinceDate = new Date(since)
  }

  let untilDate: Date | undefined
  if (until) {
    if (isNaN(Date.parse(until))) {
      throw createApiError(`until must be a valid ISO 8601 timestamp`, 'INVALID_PARAM', 400, { field: 'until', received: until })
    }
    untilDate = new Date(until)
  }

  return {
    staffComponent,
    actionType: queryParams.actionType as string | undefined,
    agentId: queryParams.agentId as string | undefined,
    entityType: queryParams.entityType as string | undefined,
    entityId: queryParams.entityId as string | undefined,
    level,
    since: sinceDate,
    until: untilDate,
  }
}

// ---------------------------------------------------------------------------
// Row serializer
// ---------------------------------------------------------------------------

function serializeEventRow(row: Record<string, unknown>): StaffEvent {
  const eventId = String(row.event_id ?? row.eventId ?? row.id ?? '')
  const timestamp = row.timestamp instanceof Date
    ? row.timestamp.toISOString()
    : String(row.timestamp ?? '')

  return {
    eventId,
    timestamp,
    staffComponent: (row.staff_component ?? row.staffComponent) as StaffEvent['staffComponent'],
    actionType: String(row.action_type ?? row.actionType ?? ''),
    agentId: String(row.agent_id ?? row.agentId ?? ''),
    source: String(row.source ?? ''),
    entityType: (row.entity_type ?? row.entityType) as string | null ?? null,
    entityId: (row.entity_id ?? row.entityId) as string | null ?? null,
    key: row.key as string | null ?? null,
    reason: row.reason as string | null ?? null,
    level: (row.level ?? 'audit') as StaffEvent['level'],
    metadata: row.metadata as Record<string, unknown> | null ?? null,
  }
}

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

function buildEventWhereClause(filters: EventFilters, params: unknown[]): string {
  const clauses: string[] = []

  params.push(filters.level)
  clauses.push(`level = $${params.length}`)

  if (filters.staffComponent) {
    params.push(filters.staffComponent)
    clauses.push(`staff_component = $${params.length}`)
  }
  if (filters.actionType) {
    params.push(filters.actionType)
    clauses.push(`action_type = $${params.length}`)
  }
  if (filters.agentId) {
    params.push(filters.agentId)
    clauses.push(`agent_id = $${params.length}`)
  }
  if (filters.entityType) {
    params.push(filters.entityType)
    clauses.push(`entity_type = $${params.length}`)
  }
  if (filters.entityId) {
    params.push(filters.entityId)
    clauses.push(`entity_id = $${params.length}`)
  }
  if (filters.since) {
    params.push(filters.since.toISOString())
    clauses.push(`timestamp > $${params.length}`)
  }
  if (filters.until) {
    params.push(filters.until.toISOString())
    clauses.push(`timestamp <= $${params.length}`)
  }

  return `WHERE ${clauses.join(' AND ')}`
}

// ---------------------------------------------------------------------------
// GET /events (list)
// ---------------------------------------------------------------------------

eventsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tableExists = await assertStaffEventsTableExists()
    if (!tableExists) {
      throw createApiError(
        'staff_events table does not exist. Apply the CP-T001 migration to enable the event stream.',
        'EVENTS_TABLE_MISSING',
        503
      )
    }

    const filters = validateEventFilters(req.query as Record<string, unknown>)

    // Parse limit (max 1000)
    const limitStr = req.query.limit as string | undefined
    let limit = 100
    if (limitStr !== undefined) {
      const parsed = parseInt(limitStr, 10)
      if (isNaN(parsed) || parsed < 1) {
        throw createApiError('limit must be an integer >= 1', 'INVALID_PARAM', 400, { field: 'limit', received: limitStr })
      }
      if (parsed > 1000) {
        throw createApiError('limit must be <= 1000', 'INVALID_PARAM', 400, { field: 'limit', received: limitStr, max: 1000 })
      }
      limit = parsed
    }

    const offsetStr = req.query.offset as string | undefined
    let offset = 0
    if (offsetStr !== undefined) {
      const parsed = parseInt(offsetStr, 10)
      if (isNaN(parsed) || parsed < 0) {
        throw createApiError('offset must be an integer >= 0', 'INVALID_PARAM', 400, { field: 'offset', received: offsetStr })
      }
      offset = parsed
    }

    const params: unknown[] = []
    const where = buildEventWhereClause(filters, params)

    const dataParams = [...params, limit, offset]
    const [dataResult, countResult, oldestResult] = await Promise.all([
      query(
        `SELECT * FROM staff_events ${where} ORDER BY timestamp DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams
      ),
      query(`SELECT COUNT(*) AS total FROM staff_events ${where}`, params),
      query(`SELECT MIN(timestamp) AS oldest FROM staff_events`, []),
    ])

    const total = parseInt((countResult.rows[0] as Record<string, unknown>).total as string, 10)
    const oldestRow = oldestResult.rows[0] as Record<string, unknown> | undefined
    const oldestTs = oldestRow?.oldest instanceof Date ? oldestRow.oldest.toISOString() : null

    res.json({
      items: dataResult.rows.map((r) => serializeEventRow(r as Record<string, unknown>)),
      total,
      limit,
      offset,
      oldestEventTimestamp: oldestTs,
    })
  } catch (err) {
    invalidateTableCache()
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /events/stream (SSE)
// NOTE: registered first so Express doesn't match 'stream' as :id param
// ---------------------------------------------------------------------------

eventsRouter.get('/stream', async (req: Request, res: Response, next: NextFunction) => {
  // Step 1: Validate params before opening stream (so we can return JSON errors)
  let filters: EventFilters
  try {
    filters = validateEventFilters(req.query as Record<string, unknown>)
  } catch (err: unknown) {
    const apiErr = err as ApiError
    if (apiErr.code === 'INVALID_PARAM') {
      res.status(400).json({ error: apiErr.message, code: 'INVALID_PARAM', detail: apiErr.detail })
      return
    }
    return next(err)
  }

  // Step 2: Check table exists
  let tableExists: boolean
  try {
    tableExists = await assertStaffEventsTableExists()
  } catch {
    tableExists = false
  }

  if (!tableExists) {
    res.status(503).json({
      error: 'staff_events table does not exist. Apply the CP-T001 migration to enable the event stream.',
      code: 'EVENTS_TABLE_MISSING',
    })
    return
  }

  // Step 3: Set SSE headers — response is committed from here
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')  // Disable nginx buffering if behind a proxy
  res.flushHeaders()

  // Step 4: Determine initial cursor
  let pollCursor: Date
  const lastEventId = req.headers['last-event-id'] as string | undefined

  if (lastEventId) {
    try {
      const resumeResult = await query<{ timestamp: Date }>(
        `SELECT timestamp FROM staff_events WHERE event_id = $1 LIMIT 1`,
        [lastEventId]
      )
      pollCursor = resumeResult.rows[0]?.timestamp ?? new Date()
    } catch {
      pollCursor = new Date()
    }
  } else if (filters.since) {
    pollCursor = filters.since
  } else {
    pollCursor = new Date()
  }

  // Step 5: Polling loop
  let isPolling = false
  let lastHeartbeatTime = Date.now()
  const POLL_INTERVAL_MS = 1000
  const HEARTBEAT_INTERVAL_MS = 15_000

  const poll = async (): Promise<void> => {
    if (isPolling) return
    isPolling = true
    try {
      const params: unknown[] = [pollCursor.toISOString(), filters.level]
      const extraClauses: string[] = []

      if (filters.staffComponent) {
        params.push(filters.staffComponent)
        extraClauses.push(`AND staff_component = $${params.length}`)
      }
      if (filters.actionType) {
        params.push(filters.actionType)
        extraClauses.push(`AND action_type = $${params.length}`)
      }
      if (filters.agentId) {
        params.push(filters.agentId)
        extraClauses.push(`AND agent_id = $${params.length}`)
      }
      if (filters.entityType) {
        params.push(filters.entityType)
        extraClauses.push(`AND entity_type = $${params.length}`)
      }
      if (filters.entityId) {
        params.push(filters.entityId)
        extraClauses.push(`AND entity_id = $${params.length}`)
      }

      const result = await query(
        `SELECT * FROM staff_events
         WHERE timestamp > $1 AND level = $2 ${extraClauses.join(' ')}
         ORDER BY timestamp ASC LIMIT 50`,
        params
      )

      for (const row of result.rows) {
        const event = serializeEventRow(row as Record<string, unknown>)
        res.write(`data: ${JSON.stringify(event)}\n`)
        res.write(`id: ${event.eventId}\n`)
        res.write('\n')
        lastHeartbeatTime = Date.now()
        pollCursor = new Date(event.timestamp)
      }

      // Heartbeat if no events recently
      if (Date.now() - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
        res.write(`: keep-alive\n\n`)
        lastHeartbeatTime = Date.now()
      }
    } catch (err) {
      console.error('[events/stream] Poll error:', err)
      invalidateTableCache()
      res.write(`event: error\n`)
      res.write(`data: ${JSON.stringify({ error: 'Database connection lost', code: 'DB_UNAVAILABLE' })}\n`)
      res.write('\n')
      cleanup()
      res.end()
    } finally {
      isPolling = false
    }
  }

  const intervalId = setInterval(() => {
    poll().catch((err) => console.error('[events/stream] Unhandled poll error:', err))
  }, POLL_INTERVAL_MS)

  // Step 6: Cleanup on disconnect
  const cleanup = (): void => {
    clearInterval(intervalId)
  }

  req.on('close', cleanup)

  // Run first poll immediately
  await poll()
})

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

eventsRouter.use(
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const apiErr = err as ApiError
    const statusCode = apiErr.statusCode ?? 500

    const errMsg = String(err)
    const is503 =
      errMsg.includes('ECONNREFUSED') ||
      errMsg.includes('connection refused') ||
      errMsg.includes('connect ETIMEDOUT') ||
      apiErr.code === 'DB_UNAVAILABLE'

    if (is503 && statusCode === 500) {
      res.status(503).json({ error: 'Database unavailable', code: 'DB_UNAVAILABLE' })
      return
    }

    res.status(statusCode).json({
      error: apiErr.message ?? 'Internal server error',
      code: apiErr.code ?? 'INTERNAL_ERROR',
      ...(apiErr.detail ? { detail: apiErr.detail } : {}),
    })
  }
)
