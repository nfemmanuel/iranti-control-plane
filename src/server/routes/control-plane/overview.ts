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
import pg from 'pg'
import { query, env } from '../../db.js'
import { runAllHealthChecks } from './health.js'
import { resolveInstanceAuthority, type ResolvedInstanceAuthority } from '../../lib/instance-authority.js'

const { Pool } = pg

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
// Instance-scoped DB pool
// ---------------------------------------------------------------------------

/**
 * Create a short-lived pg.Pool for a specific instance's DATABASE_URL.
 * The pool is torn down after `fn` completes. If databaseUrl is null,
 * `fn` receives null and should return fallback data.
 */
async function withScopedPool<T>(
  databaseUrl: string | null,
  fn: (pool: pg.Pool | null) => Promise<T>
): Promise<T> {
  if (!databaseUrl) return fn(null)
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    idleTimeoutMillis: 2000,
    connectionTimeoutMillis: 5000,
  })
  try {
    return await fn(pool)
  } finally {
    await pool.end().catch(() => {})
  }
}

/**
 * Build a query function scoped to a specific pg.Pool, matching the
 * signature of the singleton `query()` from db.ts.
 */
function scopedQuery(pool: pg.Pool) {
  return <T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<pg.QueryResult<T>> => pool.query<T>(text, params)
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

interface KnowledgeBaseSummaryRow {
  total_facts: string
  facts_last_24h: string
  active_agents_last_7d: string
}

type QueryFn = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
) => Promise<pg.QueryResult<T>>

export async function fetchKBSummary(queryFn: QueryFn = query): Promise<OverviewKBSummary> {
  const fetchedAt = new Date().toISOString()
  const fallbackFromKnowledgeBase = async (truncated: boolean): Promise<OverviewKBSummary> => {
    try {
      const result = await queryFn<KnowledgeBaseSummaryRow>(
        `SELECT
           COUNT(*)::text AS total_facts,
           COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '24 hours')::text AS facts_last_24h,
           COUNT(DISTINCT "createdBy") FILTER (
             WHERE "createdAt" >= NOW() - INTERVAL '7 days' AND "createdBy" <> 'system'
           )::text AS active_agents_last_7d
         FROM knowledge_base`
      )

      const row = result.rows[0]
      return {
        totalFacts: parseInt(row?.total_facts ?? '0', 10),
        factsLast24h: parseInt(row?.facts_last_24h ?? '0', 10),
        activeAgentsLast7d: parseInt(row?.active_agents_last_7d ?? '0', 10),
        truncated,
        fetchedAt,
      }
    } catch {
      return { totalFacts: 0, factsLast24h: 0, activeAgentsLast7d: 0, truncated: true, fetchedAt }
    }
  }

  // Check table exists first
  try {
    const existsResult = await queryFn<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'staff_events'
      ) AS exists`
    )
    const tableExists = existsResult.rows[0]?.exists ?? false

    if (!tableExists) {
      return await fallbackFromKnowledgeBase(true)
    }

    const result = await queryFn<KBSummaryRow>(
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
    if (totalFacts === 0) {
      return await fallbackFromKnowledgeBase(true)
    }

    return {
      totalFacts,
      factsLast24h: parseInt(row?.facts_last_24h ?? '0', 10),
      activeAgentsLast7d: parseInt(row?.active_agents_last_7d ?? '0', 10),
      truncated: false,
      fetchedAt,
    }
  } catch {
    return await fallbackFromKnowledgeBase(true)
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

async function fetchRecentEvents(queryFn: QueryFn = query): Promise<OverviewRecentEvent[]> {
  try {
    const result = await queryFn<StaffEventRow>(
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
  profile?: { agentId: string }
  stats?: IrantiAgentStats
}

function normalizeOverviewAgent(raw: unknown): IrantiAgentRaw | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  if (typeof obj['agentId'] === 'string') {
    return {
      agentId: obj['agentId'],
      stats: typeof obj['stats'] === 'object' && obj['stats'] !== null
        ? obj['stats'] as IrantiAgentStats
        : undefined,
    }
  }

  if (obj['profile'] && typeof obj['profile'] === 'object') {
    const profile = obj['profile'] as Record<string, unknown>
    if (typeof profile['agentId'] === 'string') {
      return {
        agentId: profile['agentId'],
        profile: { agentId: profile['agentId'] },
        stats: typeof obj['stats'] === 'object' && obj['stats'] !== null
          ? obj['stats'] as IrantiAgentStats
          : undefined,
      }
    }
  }

  return null
}

async function fetchOverviewAgentDetails(baseUrl: string, headers: Record<string, string>, agentId: string): Promise<IrantiAgentRaw | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)
  try {
    const res = await fetch(`${baseUrl}/agents/${encodeURIComponent(agentId)}`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    if (!res.ok) return null
    return normalizeOverviewAgent(await res.json() as unknown)
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
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

async function fetchActiveAgents(instanceBaseUrl?: string, instanceApiKey?: string): Promise<OverviewActiveAgent[]> {
  try {
    const baseUrl = instanceBaseUrl ?? getIrantiUrl()
    const apiKey = instanceApiKey ?? getIrantiApiKey()
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
      agents = (await Promise.all(
        body.map(async (item) => {
          const normalized = normalizeOverviewAgent(item)
          if (!normalized) return null
          if (normalized.stats) return normalized
          return await fetchOverviewAgentDetails(baseUrl, headers, normalized.agentId) ?? normalized
        })
      )).filter((item): item is IrantiAgentRaw => item !== null)
    } else if (
      body !== null &&
      typeof body === 'object' &&
      'agents' in (body as Record<string, unknown>) &&
      Array.isArray((body as Record<string, unknown>).agents)
    ) {
      agents = (await Promise.all(
        (body as { agents: unknown[] }).agents.map(async (item) => {
          const normalized = normalizeOverviewAgent(item)
          if (!normalized) return null
          if (normalized.stats) return normalized
          return await fetchOverviewAgentDetails(baseUrl, headers, normalized.agentId) ?? normalized
        })
      )).filter((item): item is IrantiAgentRaw => item !== null)
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

overviewRouter.get('/', async (req: Request, res: Response) => {
  const fetchedAt = new Date().toISOString()
  const instanceId = typeof req.query['instanceId'] === 'string' ? req.query['instanceId'] : undefined

  // If an instanceId is provided, resolve the instance's DB and API details.
  // Otherwise fall back to the singleton pool (backwards compatible).
  let scope: ResolvedInstanceAuthority | null = null
  if (instanceId) {
    scope = await resolveInstanceAuthority(instanceId).catch(() => null)
  }

  /**
   * When we have a resolved instance scope, create a short-lived DB pool
   * for that instance and run all four data sources against it.
   * Otherwise use the default singleton pool (original behaviour).
   */
  const buildResponse = async (pool: pg.Pool | null): Promise<OverviewResponse> => {
    const qFn: QueryFn = pool ? scopedQuery(pool) : query
    const instanceBaseUrl = scope?.apiBaseUrl
    const instanceApiKey = scope?.apiKey ?? undefined

    const [healthResult, kbResult, eventsResult, agentsResult] = await Promise.allSettled([
      (async (): Promise<OverviewHealthSummary> => {
        const full = await runAllHealthChecks(instanceId)
        return {
          overall: full.overall,
          checks: full.checks.map((c) => ({ name: c.name, status: c.status })),
          fetchedAt: full.checkedAt,
        }
      })(),
      fetchKBSummary(qFn),
      fetchRecentEvents(qFn),
      fetchActiveAgents(instanceBaseUrl, instanceApiKey),
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

    return { health, kb, recentEvents, activeAgents, fetchedAt }
  }

  const databaseUrl = scope?.databaseUrl ?? null
  const response = scope
    ? await withScopedPool(databaseUrl, (pool) => buildResponse(pool))
    : await buildResponse(null) // null pool → default singleton query()

  res.status(200).json(response)
})
