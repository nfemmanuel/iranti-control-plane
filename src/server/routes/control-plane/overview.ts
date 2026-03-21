/**
 * Overview Dashboard route — CP-T068
 *
 * GET /overview
 *
 * Returns an aggregated at-a-glance snapshot of the Iranti system.
 * All four data sources are fetched with Promise.allSettled — any
 * individual failure returns a zero/empty value for that field.
 * Never returns HTTP 500. Always returns 200 with partial data.
 *
 * Sources:
 *   1. health    — calls runAllHealthChecks() from health.ts (exported)
 *   2. kb        — inline SQL aggregate (same query as GET /metrics/summary)
 *   3. recentEvents — SELECT 8 most recent staff_events rows
 *   4. activeAgents — proxies GET /agents on the Iranti instance (3s timeout)
 */

import { Router, Request, Response } from 'express'
import { query, env } from '../../db.js'
import { runAllHealthChecks } from './health.js'

export const overviewRouter = Router()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OverviewHealthSummary {
  overall: string
  checks: Array<{ name: string; status: string }>
  fetchedAt: string
}

interface OverviewKBSummary {
  totalFacts: number
  factsLast24h: number
  activeAgentsLast7d: number
  truncated: boolean
  fetchedAt: string
}

interface OverviewRecentEvent {
  id: string
  staffComponent: string
  actionType: string
  agentId: string | null
  entityType: string | null
  entityId: string | null
  key: string | null
  reason: string | null
  timestamp: string
}

interface OverviewActiveAgent {
  agentId: string
  isActive: boolean
  lastSeen: string | null
  totalWrites: number
}

interface OverviewResponse {
  health: OverviewHealthSummary
  kb: OverviewKBSummary
  recentEvents: OverviewRecentEvent[]
  activeAgents: OverviewActiveAgent[]
  fetchedAt: string
}

// ---------------------------------------------------------------------------
// Health check fallback
// ---------------------------------------------------------------------------

const HEALTH_FALLBACK: OverviewHealthSummary = {
  overall: 'error',
  checks: [],
  fetchedAt: new Date().toISOString(),
}

// ---------------------------------------------------------------------------
// KB summary
// ---------------------------------------------------------------------------

const WRITE_ACTION_TYPES = ['write_created', 'write_replaced']
const ARCHIVAL_ACTION_TYPES = ['entry_archived', 'entry_decayed']

interface KBSummaryRow {
  total_writes_all_time: string
  total_archived_all_time: string
  facts_last_24h: string
  active_agents_last_7d: string
}

async function fetchKBSummary(): Promise<OverviewKBSummary> {
  const fetchedAt = new Date().toISOString()

  // Check table exists first
  try {
    const existsResult = await query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'staff_events'
      ) AS exists`
    )
    const tableExists = existsResult.rows[0]?.exists ?? false

    if (!tableExists) {
      return { totalFacts: 0, factsLast24h: 0, activeAgentsLast7d: 0, truncated: true, fetchedAt }
    }

    const result = await query<KBSummaryRow>(
      `SELECT
         COUNT(*) FILTER (WHERE action_type = ANY($1)) AS total_writes_all_time,
         COUNT(*) FILTER (WHERE action_type = ANY($2)) AS total_archived_all_time,
         COUNT(*) FILTER (WHERE action_type = ANY($1) AND timestamp >= NOW() - INTERVAL '24 hours') AS facts_last_24h,
         COUNT(DISTINCT agent_id) FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS active_agents_last_7d
       FROM staff_events`,
      [WRITE_ACTION_TYPES, ARCHIVAL_ACTION_TYPES]
    )

    const row = result.rows[0]
    const totalWrites = parseInt(row?.total_writes_all_time ?? '0', 10)
    const totalArchived = parseInt(row?.total_archived_all_time ?? '0', 10)
    const totalFacts = Math.max(0, totalWrites - totalArchived)

    return {
      totalFacts,
      factsLast24h: parseInt(row?.facts_last_24h ?? '0', 10),
      activeAgentsLast7d: parseInt(row?.active_agents_last_7d ?? '0', 10),
      truncated: false,
      fetchedAt,
    }
  } catch {
    return { totalFacts: 0, factsLast24h: 0, activeAgentsLast7d: 0, truncated: true, fetchedAt }
  }
}

// ---------------------------------------------------------------------------
// Recent events
// ---------------------------------------------------------------------------

interface StaffEventRow {
  id: string
  staff_component: string
  action_type: string
  agent_id: string | null
  entity_type: string | null
  entity_id: string | null
  key: string | null
  reason: string | null
  timestamp: Date
}

const PG_UNDEFINED_TABLE = '42P01'

async function fetchRecentEvents(): Promise<OverviewRecentEvent[]> {
  try {
    const result = await query<StaffEventRow>(
      `SELECT id, staff_component, action_type, agent_id, entity_type, entity_id, key, reason, timestamp
       FROM staff_events
       ORDER BY timestamp DESC
       LIMIT 8`
    )
    return result.rows.map((row) => ({
      id: row.id,
      staffComponent: row.staff_component,
      actionType: row.action_type,
      agentId: row.agent_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      key: row.key,
      reason: row.reason,
      timestamp: row.timestamp instanceof Date
        ? row.timestamp.toISOString()
        : String(row.timestamp),
    }))
  } catch (err: unknown) {
    // Table not found — not an error for this surface
    const pgErr = err as { code?: string }
    if (pgErr.code === PG_UNDEFINED_TABLE) return []
    return []
  }
}

// ---------------------------------------------------------------------------
// Active agents proxy
// ---------------------------------------------------------------------------

interface IrantiAgentStats {
  totalWrites: number
  lastSeen: string | null
  isActive: boolean
}

interface IrantiAgentRaw {
  agentId: string
  stats: IrantiAgentStats
}

function getIrantiUrl(): string {
  return (env['IRANTI_URL'] ?? process.env['IRANTI_URL'] ?? 'http://localhost:3001').replace(/\/$/, '')
}

function getIrantiApiKey(): string {
  return env['IRANTI_API_KEY'] ?? process.env['IRANTI_API_KEY'] ?? ''
}

async function fetchActiveAgents(): Promise<OverviewActiveAgent[]> {
  try {
    const baseUrl = getIrantiUrl()
    const apiKey = getIrantiApiKey()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['X-Iranti-Key'] = apiKey

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)

    let irantiRes: globalThis.Response
    try {
      irantiRes = await fetch(`${baseUrl}/agents`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!irantiRes.ok) return []

    const body = await irantiRes.json() as unknown

    let agents: IrantiAgentRaw[]
    if (Array.isArray(body)) {
      agents = body as IrantiAgentRaw[]
    } else if (
      body !== null &&
      typeof body === 'object' &&
      'agents' in (body as Record<string, unknown>) &&
      Array.isArray((body as Record<string, unknown>).agents)
    ) {
      agents = (body as { agents: IrantiAgentRaw[] }).agents
    } else {
      return []
    }

    // Filter to active agents, cap at 6
    const active = agents
      .filter((a) => a.stats?.isActive === true)
      .slice(0, 6)
      .map((a) => ({
        agentId: a.agentId,
        isActive: a.stats?.isActive ?? false,
        lastSeen: a.stats?.lastSeen ?? null,
        totalWrites: a.stats?.totalWrites ?? 0,
      }))

    return active
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// GET /overview
// ---------------------------------------------------------------------------

overviewRouter.get('/', async (_req: Request, res: Response) => {
  const fetchedAt = new Date().toISOString()

  const [healthResult, kbResult, eventsResult, agentsResult] = await Promise.allSettled([
    (async (): Promise<OverviewHealthSummary> => {
      const full = await runAllHealthChecks()
      return {
        overall: full.overall,
        checks: full.checks.map((c) => ({ name: c.name, status: c.status })),
        fetchedAt: full.checkedAt,
      }
    })(),
    fetchKBSummary(),
    fetchRecentEvents(),
    fetchActiveAgents(),
  ])

  const health: OverviewHealthSummary =
    healthResult.status === 'fulfilled'
      ? healthResult.value
      : { ...HEALTH_FALLBACK, fetchedAt }

  const kb: OverviewKBSummary =
    kbResult.status === 'fulfilled'
      ? kbResult.value
      : { totalFacts: 0, factsLast24h: 0, activeAgentsLast7d: 0, truncated: true, fetchedAt }

  const recentEvents: OverviewRecentEvent[] =
    eventsResult.status === 'fulfilled' ? eventsResult.value : []

  const activeAgents: OverviewActiveAgent[] =
    agentsResult.status === 'fulfilled' ? agentsResult.value : []

  const response: OverviewResponse = { health, kb, recentEvents, activeAgents, fetchedAt }
  res.status(200).json(response)
})
