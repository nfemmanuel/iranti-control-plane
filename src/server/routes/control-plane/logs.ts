/**
 * Staff Logs routes — CP-T050
 *
 * GET /logs        — paginated query over staff_events with full filter support
 * GET /logs/export — download as JSONL or CSV (max 10,000 rows)
 *
 * Graceful degradation: if staff_events table does not exist (migration not applied),
 * both endpoints return HTTP 503 with a clear migration instruction.
 *
 * Filter params (all optional, all combinable):
 *   staffComponent — comma-separated: Librarian,Attendant,Archivist,Resolutionist
 *   eventType / actionType — filter by action_type column
 *   agentId       — exact match on agent_id
 *   entityType    — exact match on entity_type
 *   search        — ILIKE %search% against action_type, agent_id, entity_type, entity_id, key, reason
 *   since         — ISO timestamp lower bound on timestamp (exclusive)
 *   until         — ISO timestamp upper bound on timestamp (inclusive)
 *   level         — audit | debug
 *   limit         — default 50, max 10000
 *   offset        — default 0
 */

import { Router, Request, Response, NextFunction } from 'express'
import { query } from '../../db.js'
import { StaffEvent, createApiError, ApiError } from '../../types.js'

export const logsRouter = Router()

// ---------------------------------------------------------------------------
// Table existence detection (lightweight check, cached per process)
// ---------------------------------------------------------------------------

const PG_UNDEFINED_TABLE = '42P01'

async function assertLogsTableExists(): Promise<void> {
  try {
    await query('SELECT 1 FROM staff_events LIMIT 1', [])
  } catch (err: unknown) {
    const pgErr = err as { code?: string }
    if (pgErr.code === PG_UNDEFINED_TABLE) {
      throw createApiError(
        'staff_events table not found. Run: npm run migrate',
        'MIGRATION_REQUIRED',
        503
      )
    }
    // Any other DB error — rethrow as-is for the generic error handler
    throw err
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_COMPONENTS = ['Librarian', 'Attendant', 'Archivist', 'Resolutionist'] as const
const VALID_LEVELS = ['audit', 'debug'] as const

interface LogFilters {
  staffComponent?: string
  actionType?: string
  agentId?: string
  entityType?: string
  search?: string
  since?: Date
  until?: Date
  level?: string
}

function validateLogFilters(queryParams: Record<string, unknown>): LogFilters {
  const staffComponent = queryParams.staffComponent as string | undefined
  const level = queryParams.level as string | undefined
  const since = queryParams.since as string | undefined
  const until = queryParams.until as string | undefined

  if (staffComponent) {
    const components = staffComponent.split(',').map((s) => s.trim()).filter(Boolean)
    const invalid = components.filter((c) => !(VALID_COMPONENTS as readonly string[]).includes(c))
    if (invalid.length > 0) {
      throw createApiError(
        `Invalid staffComponent value(s): ${invalid.join(', ')}`,
        'INVALID_PARAM',
        400,
        { field: 'staffComponent', allowedValues: [...VALID_COMPONENTS], received: staffComponent }
      )
    }
  }

  if (level !== undefined && !(VALID_LEVELS as readonly string[]).includes(level)) {
    throw createApiError(
      `level must be 'audit' or 'debug'`,
      'INVALID_PARAM',
      400,
      { field: 'level', allowedValues: [...VALID_LEVELS], received: level }
    )
  }

  let sinceDate: Date | undefined
  if (since) {
    if (isNaN(Date.parse(since))) {
      throw createApiError('since must be a valid ISO 8601 timestamp', 'INVALID_PARAM', 400, {
        field: 'since',
        received: since,
      })
    }
    sinceDate = new Date(since)
  }

  let untilDate: Date | undefined
  if (until) {
    if (isNaN(Date.parse(until))) {
      throw createApiError('until must be a valid ISO 8601 timestamp', 'INVALID_PARAM', 400, {
        field: 'until',
        received: until,
      })
    }
    untilDate = new Date(until)
  }

  // Accept both eventType and actionType query params (aliases)
  const actionType =
    (queryParams.actionType as string | undefined) ??
    (queryParams.eventType as string | undefined)

  return {
    staffComponent,
    actionType,
    agentId: queryParams.agentId as string | undefined,
    entityType: queryParams.entityType as string | undefined,
    search: queryParams.search as string | undefined,
    since: sinceDate,
    until: untilDate,
    level,
  }
}

// ---------------------------------------------------------------------------
// Row serializer — re-uses the same shape as events.ts serializeEventRow
// ---------------------------------------------------------------------------

export function serializeEventRow(row: Record<string, unknown>): StaffEvent {
  const eventId = String(row.event_id ?? row.eventId ?? row.id ?? '')
  const timestamp =
    row.timestamp instanceof Date
      ? row.timestamp.toISOString()
      : String(row.timestamp ?? '')

  return {
    eventId,
    timestamp,
    staffComponent: (row.staff_component ?? row.staffComponent) as StaffEvent['staffComponent'],
    actionType: String(row.action_type ?? row.actionType ?? ''),
    agentId: String(row.agent_id ?? row.agentId ?? ''),
    source: String(row.source ?? ''),
    entityType: ((row.entity_type ?? row.entityType) as string | null) ?? null,
    entityId: ((row.entity_id ?? row.entityId) as string | null) ?? null,
    key: (row.key as string | null) ?? null,
    reason: (row.reason as string | null) ?? null,
    level: ((row.level ?? 'audit') as StaffEvent['level']),
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  }
}

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

function buildLogsWhereClause(filters: LogFilters, params: unknown[]): string {
  const clauses: string[] = []

  if (filters.level) {
    params.push(filters.level)
    clauses.push(`level = $${params.length}`)
  }

  if (filters.staffComponent) {
    const components = filters.staffComponent.split(',').map((s) => s.trim()).filter(Boolean)
    if (components.length === 1) {
      params.push(components[0])
      clauses.push(`staff_component = $${params.length}`)
    } else if (components.length > 1) {
      const placeholders = components.map((c) => {
        params.push(c)
        return `$${params.length}`
      })
      clauses.push(`staff_component IN (${placeholders.join(', ')})`)
    }
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

  if (filters.search) {
    params.push(`%${filters.search}%`)
    const p = params.length
    clauses.push(
      `(action_type ILIKE $${p} OR COALESCE(agent_id,'') ILIKE $${p} OR COALESCE(entity_type,'') ILIKE $${p} OR COALESCE(entity_id,'') ILIKE $${p} OR COALESCE(key,'') ILIKE $${p} OR COALESCE(reason,'') ILIKE $${p})`
    )
  }

  if (filters.since) {
    params.push(filters.since.toISOString())
    clauses.push(`timestamp > $${params.length}`)
  }

  if (filters.until) {
    params.push(filters.until.toISOString())
    clauses.push(`timestamp <= $${params.length}`)
  }

  return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
}

// ---------------------------------------------------------------------------
// GET /logs — paginated list
// ---------------------------------------------------------------------------

logsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await assertLogsTableExists()

    const filters = validateLogFilters(req.query as Record<string, unknown>)

    // Limit: default 50, max 10000
    const limitStr = req.query.limit as string | undefined
    let limit = 50
    if (limitStr !== undefined) {
      const parsed = parseInt(limitStr, 10)
      if (isNaN(parsed) || parsed < 1) {
        throw createApiError('limit must be an integer >= 1', 'INVALID_PARAM', 400, {
          field: 'limit',
          received: limitStr,
        })
      }
      if (parsed > 10000) {
        throw createApiError('limit must be <= 10000', 'INVALID_PARAM', 400, {
          field: 'limit',
          received: limitStr,
          max: 10000,
        })
      }
      limit = parsed
    }

    const offsetStr = req.query.offset as string | undefined
    let offset = 0
    if (offsetStr !== undefined) {
      const parsed = parseInt(offsetStr, 10)
      if (isNaN(parsed) || parsed < 0) {
        throw createApiError('offset must be an integer >= 0', 'INVALID_PARAM', 400, {
          field: 'offset',
          received: offsetStr,
        })
      }
      offset = parsed
    }

    const params: unknown[] = []
    const where = buildLogsWhereClause(filters, params)

    const dataParams = [...params, limit, offset]
    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT * FROM staff_events ${where} ORDER BY timestamp DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams
      ),
      query(`SELECT COUNT(*) AS total FROM staff_events ${where}`, params),
    ])

    const total = parseInt(
      (countResult.rows[0] as Record<string, unknown>).total as string,
      10
    )

    res.json({
      events: dataResult.rows.map((r) => serializeEventRow(r as Record<string, unknown>)),
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    })
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /logs/export — download as JSONL or CSV
// Max 10,000 rows regardless of limit param.
// Sets X-Export-Truncated: true if the query matched more rows than exported.
// ---------------------------------------------------------------------------

const EXPORT_MAX_ROWS = 10000

const CSV_COLUMNS = [
  'event_id',
  'timestamp',
  'staffComponent',
  'actionType',
  'agentId',
  'entityType',
  'entityId',
  'key',
  'reason',
  'level',
] as const

type CsvColumn = (typeof CSV_COLUMNS)[number]

function escapeCsvField(value: unknown): string {
  if (value == null) return ''
  const str = String(value)
  // Quote fields that contain comma, double-quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function eventToCsvRow(event: StaffEvent): string {
  const fields: Record<CsvColumn, unknown> = {
    event_id: event.eventId,
    timestamp: event.timestamp,
    staffComponent: event.staffComponent,
    actionType: event.actionType,
    agentId: event.agentId,
    entityType: event.entityType ?? '',
    entityId: event.entityId ?? '',
    key: event.key ?? '',
    reason: event.reason ?? '',
    level: event.level,
  }
  return CSV_COLUMNS.map((col) => escapeCsvField(fields[col])).join(',')
}

logsRouter.get('/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await assertLogsTableExists()

    const filters = validateLogFilters(req.query as Record<string, unknown>)

    const format = (req.query.format as string | undefined) ?? 'json'
    if (format !== 'json' && format !== 'csv') {
      throw createApiError(
        `format must be 'json' or 'csv'`,
        'INVALID_PARAM',
        400,
        { field: 'format', allowedValues: ['json', 'csv'], received: format }
      )
    }

    const params: unknown[] = []
    const where = buildLogsWhereClause(filters, params)

    // Fetch one extra row beyond the max to detect truncation
    const fetchLimit = EXPORT_MAX_ROWS + 1
    const dataParams = [...params, fetchLimit]

    const dataResult = await query(
      `SELECT * FROM staff_events ${where} ORDER BY timestamp DESC LIMIT $${dataParams.length}`,
      dataParams
    )

    const rows = dataResult.rows as Record<string, unknown>[]
    const truncated = rows.length > EXPORT_MAX_ROWS
    const exportRows = truncated ? rows.slice(0, EXPORT_MAX_ROWS) : rows
    const events = exportRows.map((r) => serializeEventRow(r))

    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)

    if (truncated) {
      res.setHeader('X-Export-Truncated', 'true')
    }

    if (format === 'csv') {
      const filename = `staff-logs-${ts}.csv`
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)

      const header = CSV_COLUMNS.join(',')
      const lines = [header, ...events.map(eventToCsvRow)]
      res.send(lines.join('\n'))
    } else {
      const filename = `staff-logs-${ts}.jsonl`
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)

      const lines = events.map((e) => JSON.stringify(e))
      res.send(lines.join('\n'))
    }
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

logsRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const apiErr = err as ApiError
  const statusCode = apiErr.statusCode ?? 500

  const errMsg = String(err)
  const is503 =
    errMsg.includes('ECONNREFUSED') ||
    errMsg.includes('connection refused') ||
    errMsg.includes('connect ETIMEDOUT') ||
    apiErr.code === 'DB_UNAVAILABLE' ||
    apiErr.code === 'MIGRATION_REQUIRED'

  if (apiErr.code === 'MIGRATION_REQUIRED') {
    res.status(503).json({
      error: apiErr.message,
      code: 'MIGRATION_REQUIRED',
    })
    return
  }

  if (is503 && statusCode === 500) {
    res.status(503).json({ error: 'Database unavailable', code: 'DB_UNAVAILABLE' })
    return
  }

  res.status(statusCode).json({
    error: apiErr.message ?? 'Internal server error',
    code: apiErr.code ?? 'INTERNAL_ERROR',
    ...(apiErr.detail ? { detail: apiErr.detail } : {}),
  })
})
