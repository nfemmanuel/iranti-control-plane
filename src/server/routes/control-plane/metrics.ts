/**
 * Metrics Dashboard routes — CP-T060
 *
 * GET /metrics/kb-growth?period=7d|30d
 *   Daily fact counts: new writes vs archival events, plus running totalFacts.
 *
 * GET /metrics/agent-activity?period=7d|30d
 *   Per-agent write volume by day, capped to top 10 agents.
 *
 * GET /metrics/summary
 *   Lightweight scalar aggregates. SQL only — no unbounded memory loads.
 *
 * Design notes:
 * - action_type strings match actual adapter output: write_created / write_replaced
 *   for KB writes; entry_archived / entry_decayed / fact_restored_by_operator for
 *   archival events. The spec used placeholder uppercase strings; this implementation
 *   uses the real strings from staff-event-adapter.ts.
 * - "Write events" = write_created + write_replaced (facts added to the KB).
 * - "Archival events" = entry_archived + entry_decayed (facts leaving the KB).
 *   fact_restored_by_operator is an Archivist action but adds back a fact, so it is
 *   NOT counted as an archival event (it counteracts one).
 * - totalFacts in kb-growth: running sum of (cumulative writes - cumulative archival)
 *   from the earliest row in staff_events to each day. This is an approximation —
 *   facts written before the adapter was deployed are not reflected.
 * - Graceful degradation: if staff_events does not exist, return empty data with
 *   truncated: true rather than a 500.
 * - No unbounded memory loads: all results are SQL aggregates.
 *
 * Index dependency: Migration 003 adds idx_staff_events_metrics (timestamp, agent_id,
 * action_type) to support the GROUP BY queries in this file efficiently.
 */

import { Router, Request, Response, NextFunction } from 'express'
import { query } from '../../db.js'
import { createApiError, ApiError } from '../../types.js'

export const metricsRouter = Router()

// ---------------------------------------------------------------------------
// Action type constants
// These match the actual strings written by staff-event-adapter.ts and the
// archivist/escalations routes. Kept as a typed union for AC-4 (no any).
// ---------------------------------------------------------------------------

const WRITE_ACTION_TYPES: readonly string[] = ['write_created', 'write_replaced']
const ARCHIVAL_ACTION_TYPES: readonly string[] = ['entry_archived', 'entry_decayed']
const REJECTION_ACTION_TYPES: readonly string[] = ['write_rejected', 'write_escalated']

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type Period = '7d' | '30d'

const PERIOD_DAYS: Record<Period, number> = {
  '7d': 7,
  '30d': 30,
}

/**
 * Parse and validate the ?period= query param.
 * Only '7d' and '30d' are accepted at MVP. Throws a 400 ApiError for anything else.
 */
function parsePeriod(raw: unknown): Period {
  if (raw === '7d' || raw === '30d') return raw
  if (raw === undefined || raw === null || raw === '') return '30d'
  throw createApiError(
    `period must be '7d' or '30d'`,
    'INVALID_PARAM',
    400,
    { field: 'period', allowedValues: ['7d', '30d'], received: String(raw) }
  )
}

/**
 * Check whether staff_events exists. Returns false (not throws) on DB errors so
 * callers can degrade gracefully.
 */
async function staffEventsTableExists(): Promise<boolean> {
  try {
    const result = await query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'staff_events'
      ) AS exists`
    )
    return result.rows[0]?.exists ?? false
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// GET /metrics/kb-growth?period=7d|30d
// ---------------------------------------------------------------------------

interface KbGrowthRow {
  date: string
  new_facts: string
  archived_facts: string
}

interface KbGrowthDataPoint {
  date: string
  totalFacts: number
  newFacts: number
  archivedFacts: number
}

interface KbGrowthResponse {
  period: Period
  truncated: boolean
  data: KbGrowthDataPoint[]
}

metricsRouter.get('/kb-growth', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = parsePeriod(req.query.period)
    const days = PERIOD_DAYS[period]

    const tableExists = await staffEventsTableExists()
    if (!tableExists) {
      const response: KbGrowthResponse = { period, truncated: true, data: [] }
      res.json(response)
      return
    }

    // Query 1: daily new/archived counts within the requested period window
    const periodResult = await query<KbGrowthRow>(
      `SELECT
         DATE(timestamp AT TIME ZONE 'UTC') AS date,
         COUNT(*) FILTER (WHERE action_type = ANY($1)) AS new_facts,
         COUNT(*) FILTER (WHERE action_type = ANY($2)) AS archived_facts
       FROM staff_events
       WHERE timestamp >= NOW() - ($3 || ' days')::INTERVAL
       GROUP BY DATE(timestamp AT TIME ZONE 'UTC')
       ORDER BY date ASC`,
      [WRITE_ACTION_TYPES, ARCHIVAL_ACTION_TYPES, String(days)]
    )

    // Query 2: cumulative totals from the beginning of all staff_events data
    // (not just the period window) so we can compute an accurate running totalFacts.
    const cumulativeResult = await query<{ date: string; cum_new: string; cum_archived: string }>(
      `SELECT
         DATE(timestamp AT TIME ZONE 'UTC') AS date,
         SUM(COUNT(*) FILTER (WHERE action_type = ANY($1))) OVER (ORDER BY DATE(timestamp AT TIME ZONE 'UTC') ASC) AS cum_new,
         SUM(COUNT(*) FILTER (WHERE action_type = ANY($2))) OVER (ORDER BY DATE(timestamp AT TIME ZONE 'UTC') ASC) AS cum_archived
       FROM staff_events
       GROUP BY DATE(timestamp AT TIME ZONE 'UTC')
       ORDER BY date ASC`,
      [WRITE_ACTION_TYPES, ARCHIVAL_ACTION_TYPES]
    )

    // Build a map: date → cumulative totalFacts
    const cumulativeByDate = new Map<string, number>()
    for (const row of cumulativeResult.rows) {
      const cumNew = parseInt(row.cum_new ?? '0', 10)
      const cumArchived = parseInt(row.cum_archived ?? '0', 10)
      cumulativeByDate.set(String(row.date), Math.max(0, cumNew - cumArchived))
    }

    // Determine distinct day count to set truncated flag
    const distinctDays = periodResult.rows.length
    const truncated = distinctDays < 2

    const data: KbGrowthDataPoint[] = periodResult.rows.map((row) => {
      const dateStr = String(row.date)
      const newFacts = parseInt(row.new_facts ?? '0', 10)
      const archivedFacts = parseInt(row.archived_facts ?? '0', 10)
      const totalFacts = cumulativeByDate.get(dateStr) ?? 0

      return { date: dateStr, totalFacts, newFacts, archivedFacts }
    })

    const response: KbGrowthResponse = { period, truncated, data }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /metrics/agent-activity?period=7d|30d
// ---------------------------------------------------------------------------

interface AgentDailyRow {
  agent_id: string
  date: string
  writes: string
  rejections: string
  escalations: string
}

interface AgentTotalRow {
  agent_id: string
  total_writes: string
}

interface AgentActivityDataPoint {
  date: string
  writes: number
  rejections: number
  escalations: number
}

interface AgentActivityEntry {
  agentId: string
  data: AgentActivityDataPoint[]
}

interface AgentActivityResponse {
  period: Period
  agents: AgentActivityEntry[]
}

metricsRouter.get('/agent-activity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = parsePeriod(req.query.period)
    const days = PERIOD_DAYS[period]

    const tableExists = await staffEventsTableExists()
    if (!tableExists) {
      const response: AgentActivityResponse = { period, agents: [] }
      res.json(response)
      return
    }

    // Step 1: find top 10 agents by total write count within the period
    const topAgentsResult = await query<AgentTotalRow>(
      `SELECT
         COALESCE(agent_id, '(unknown)') AS agent_id,
         COUNT(*) FILTER (WHERE action_type = ANY($1)) AS total_writes
       FROM staff_events
       WHERE timestamp >= NOW() - ($2 || ' days')::INTERVAL
         AND action_type = ANY($1)
       GROUP BY COALESCE(agent_id, '(unknown)')
       ORDER BY total_writes DESC
       LIMIT 10`,
      [WRITE_ACTION_TYPES, String(days)]
    )

    if (topAgentsResult.rows.length === 0) {
      const response: AgentActivityResponse = { period, agents: [] }
      res.json(response)
      return
    }

    const topAgentIds = topAgentsResult.rows.map((r) => String(r.agent_id))

    // Step 2: per-agent, per-day breakdown for the top agents
    const dailyResult = await query<AgentDailyRow>(
      `SELECT
         COALESCE(agent_id, '(unknown)') AS agent_id,
         DATE(timestamp AT TIME ZONE 'UTC') AS date,
         COUNT(*) FILTER (WHERE action_type = ANY($1)) AS writes,
         COUNT(*) FILTER (WHERE action_type = ANY($2)) AS rejections,
         COUNT(*) FILTER (WHERE action_type = 'write_escalated') AS escalations
       FROM staff_events
       WHERE timestamp >= NOW() - ($3 || ' days')::INTERVAL
         AND COALESCE(agent_id, '(unknown)') = ANY($4)
       GROUP BY COALESCE(agent_id, '(unknown)'), DATE(timestamp AT TIME ZONE 'UTC')
       ORDER BY agent_id ASC, date ASC`,
      [WRITE_ACTION_TYPES, REJECTION_ACTION_TYPES, String(days), topAgentIds]
    )

    // Group rows by agent_id
    const byAgent = new Map<string, AgentActivityDataPoint[]>()
    for (const agentId of topAgentIds) {
      byAgent.set(agentId, [])
    }
    for (const row of dailyResult.rows) {
      const agentId = String(row.agent_id)
      const entry = byAgent.get(agentId)
      if (entry !== undefined) {
        entry.push({
          date: String(row.date),
          writes: parseInt(row.writes ?? '0', 10),
          rejections: parseInt(row.rejections ?? '0', 10),
          escalations: parseInt(row.escalations ?? '0', 10),
        })
      }
    }

    const agents: AgentActivityEntry[] = topAgentIds
      .filter((id) => (byAgent.get(id)?.length ?? 0) > 0)
      .map((id) => ({ agentId: id, data: byAgent.get(id) ?? [] }))

    const response: AgentActivityResponse = { period, agents }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /metrics/summary
// ---------------------------------------------------------------------------

interface SummaryResponse {
  totalFacts: number
  factsLast24h: number
  factsLast7d: number
  activeAgentsLast7d: number
  rejectionRateLast7d: number
  archiveRateLast7d: number
}

metricsRouter.get('/summary', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const tableExists = await staffEventsTableExists()
    if (!tableExists) {
      const response: SummaryResponse = {
        totalFacts: 0,
        factsLast24h: 0,
        factsLast7d: 0,
        activeAgentsLast7d: 0,
        rejectionRateLast7d: 0,
        archiveRateLast7d: 0,
      }
      res.json(response)
      return
    }

    // Single aggregate query — all values computed in one SQL round-trip.
    // Uses FILTER clauses so no data is loaded into application memory.
    const result = await query<{
      total_writes_all_time: string
      total_archived_all_time: string
      facts_last_24h: string
      facts_last_7d: string
      active_agents_last_7d: string
      writes_last_7d: string
      rejections_last_7d: string
      archived_last_7d: string
    }>(
      `SELECT
         -- All-time accumulators for totalFacts approximation
         COUNT(*) FILTER (WHERE action_type = ANY($1))                                         AS total_writes_all_time,
         COUNT(*) FILTER (WHERE action_type = ANY($2))                                         AS total_archived_all_time,

         -- Last 24h write count
         COUNT(*) FILTER (WHERE action_type = ANY($1) AND timestamp >= NOW() - INTERVAL '24 hours') AS facts_last_24h,

         -- Last 7d write count
         COUNT(*) FILTER (WHERE action_type = ANY($1) AND timestamp >= NOW() - INTERVAL '7 days')   AS facts_last_7d,

         -- Distinct active agents last 7d (by any action)
         COUNT(DISTINCT agent_id) FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days')             AS active_agents_last_7d,

         -- Denominator for rates last 7d: all write attempts (writes + rejections + escalations)
         COUNT(*) FILTER (
           WHERE action_type = ANY($3) AND timestamp >= NOW() - INTERVAL '7 days'
         )                                                                                     AS writes_last_7d,

         -- Rejection count last 7d
         COUNT(*) FILTER (
           WHERE action_type = ANY($4) AND timestamp >= NOW() - INTERVAL '7 days'
         )                                                                                     AS rejections_last_7d,

         -- Archive count last 7d
         COUNT(*) FILTER (
           WHERE action_type = ANY($2) AND timestamp >= NOW() - INTERVAL '7 days'
         )                                                                                     AS archived_last_7d

       FROM staff_events`,
      [
        WRITE_ACTION_TYPES,
        ARCHIVAL_ACTION_TYPES,
        // denominator for rates: writes + rejections + escalations
        [...WRITE_ACTION_TYPES, ...REJECTION_ACTION_TYPES],
        REJECTION_ACTION_TYPES,
      ]
    )

    const row = result.rows[0]
    if (!row) {
      const response: SummaryResponse = {
        totalFacts: 0,
        factsLast24h: 0,
        factsLast7d: 0,
        activeAgentsLast7d: 0,
        rejectionRateLast7d: 0,
        archiveRateLast7d: 0,
      }
      res.json(response)
      return
    }

    const totalWritesAllTime = parseInt(row.total_writes_all_time ?? '0', 10)
    const totalArchivedAllTime = parseInt(row.total_archived_all_time ?? '0', 10)
    const writesLast7d = parseInt(row.writes_last_7d ?? '0', 10)
    const rejectionsLast7d = parseInt(row.rejections_last_7d ?? '0', 10)
    const archivedLast7d = parseInt(row.archived_last_7d ?? '0', 10)

    // rejectionRate = rejections / (writes + rejections + escalations), or 0 if denominator is 0
    const rejectionRateLast7d = writesLast7d > 0
      ? Math.round((rejectionsLast7d / writesLast7d) * 10000) / 10000
      : 0

    // archiveRate = archival events / write events last 7d, or 0 if no writes
    const factsLast7d = parseInt(row.facts_last_7d ?? '0', 10)
    const archiveRateLast7d = factsLast7d > 0
      ? Math.round((archivedLast7d / factsLast7d) * 10000) / 10000
      : 0

    const response: SummaryResponse = {
      totalFacts: Math.max(0, totalWritesAllTime - totalArchivedAllTime),
      factsLast24h: parseInt(row.facts_last_24h ?? '0', 10),
      factsLast7d,
      activeAgentsLast7d: parseInt(row.active_agents_last_7d ?? '0', 10),
      rejectionRateLast7d,
      archiveRateLast7d,
    }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

metricsRouter.use(
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
