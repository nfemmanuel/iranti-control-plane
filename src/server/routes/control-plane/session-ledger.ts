/**
 * session-ledger.ts — Fleet Ledger query and ingestion-health routes.
 *
 * Routes:
 *   GET /session-ledger                    — Paginated, filterable list of
 *                                            mirrored audit events from all
 *                                            known Iranti instances.
 *   GET /session-ledger/ingestion-health   — Per-instance poll watermark
 *                                            status (healthy / degraded / failing).
 *
 * Both routes degrade gracefully when the fleet-ledger migration has not
 * been applied: they return empty results with a note rather than 500.
 */

import { Router, Request, Response } from 'express'
import { ApiError } from '../../types.js'
import {
  FleetLedgerFilters,
  queryFleetLedger,
  getAllWatermarks,
  WatermarkRow,
} from '../../lib/fleet-ledger-repo.js'

export const sessionLedgerRouter = Router()

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface FleetLedgerEvent {
  id: number
  instanceId: string
  remoteEventId: string
  timestamp: string
  staffComponent: string
  actionType: string
  agentId: string | null
  source: string | null
  host: string | null
  sessionId: string | null
  entityType: string | null
  entityId: string | null
  key: string | null
  reason: string | null
  level: 'audit' | 'debug'
  metadata: Record<string, unknown> | null
  ingestedAt: string
}

export interface FleetLedgerResponse {
  items: FleetLedgerEvent[]
  total: number
  fetchedAt: string
  note?: string
}

export interface IngestionHealthEntry {
  instanceId: string
  lastEventTimestamp: string | null
  lastRemoteEventId: string | null
  lastPolledAt: string | null
  lastPollSucceeded: boolean
  lastPollError: string | null
  consecutiveFailures: number
  totalEventsIngested: number
  status: 'healthy' | 'degraded' | 'failing' | 'never_polled'
}

export interface IngestionHealthResponse {
  instances: IngestionHealthEntry[]
  fetchedAt: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseLimit(value: unknown, defaultVal = 100, max = 250): number {
  if (value === undefined || value === null || String(value).trim() === '') return defaultVal
  const n = Number.parseInt(String(value), 10)
  if (!Number.isFinite(n) || n < 1) throw new Error('limit must be a positive integer')
  return Math.min(n, max)
}

/** Extract a non-empty trimmed string from a query param, or return undefined. */
function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Consecutive-failure thresholds for ingestion health classification.
 * 1–2 failures = degraded (transient); 3+ failures = failing (persistent).
 */
const INGESTION_FAILING_THRESHOLD = 3

function deriveIngestionStatus(w: WatermarkRow): IngestionHealthEntry['status'] {
  if (!w.lastPolledAt) return 'never_polled'
  const failures = w.consecutiveFailures ?? 0
  if (failures === 0) return 'healthy'
  if (failures < INGESTION_FAILING_THRESHOLD) return 'degraded'
  return 'failing'
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /api/control-plane/session-ledger
sessionLedgerRouter.get('/', async (req: Request, res: Response) => {
  let limit: number
  try {
    limit = parseLimit(req.query['limit'])
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
    return
  }

  try {
    const rawLevel = String(req.query['level'] ?? '').trim().toLowerCase()
    let level: 'audit' | 'debug' | undefined
    if (rawLevel === 'audit') level = 'audit'
    else if (rawLevel === 'debug') level = 'debug'
    else if (rawLevel !== '') {
      res.status(400).json({ error: "level must be 'audit' or 'debug'" })
      return
    }

    const filters: FleetLedgerFilters = {
      limit,
      instanceId: queryString(req.query['instanceId']),
      source:     queryString(req.query['source']),
      host:       queryString(req.query['host']),
      agentId:    queryString(req.query['agentId']),
      sessionId:  queryString(req.query['sessionId']),
      actionType: queryString(req.query['actionType']),
      since:      queryString(req.query['since']),
      until:      queryString(req.query['until']),
      level,
    }

    const { items, total } = await queryFleetLedger(filters)
    const body: FleetLedgerResponse = {
      items,
      total,
      fetchedAt: new Date().toISOString(),
    }
    res.json(body)
  } catch (error) {
    // Non-fatal: DB not ready yet or migrations pending
    res.json({
      items: [],
      total: 0,
      fetchedAt: new Date().toISOString(),
      note: error instanceof Error ? error.message : String(error),
    } satisfies FleetLedgerResponse)
  }
})

// GET /api/control-plane/session-ledger/ingestion-health
sessionLedgerRouter.get('/ingestion-health', async (_req: Request, res: Response) => {
  try {
    const watermarks = await getAllWatermarks()
    const instances: IngestionHealthEntry[] = watermarks.map((w) => ({
      instanceId: w.instanceId,
      lastEventTimestamp: w.lastEventTimestamp ?? null,
      lastRemoteEventId: w.lastRemoteEventId ?? null,
      lastPolledAt: w.lastPolledAt ?? null,
      lastPollSucceeded: w.lastPollSucceeded ?? false,
      lastPollError: w.lastPollError ?? null,
      consecutiveFailures: w.consecutiveFailures ?? 0,
      totalEventsIngested: w.totalEventsIngested ?? 0,
      status: deriveIngestionStatus(w),
    }))
    const body: IngestionHealthResponse = {
      instances,
      fetchedAt: new Date().toISOString(),
    }
    res.json(body)
  } catch (error) {
    // Non-fatal: DB not ready yet or migrations pending
    res.json({
      instances: [],
      fetchedAt: new Date().toISOString(),
      note: error instanceof Error ? error.message : String(error),
    } as IngestionHealthResponse & { note?: string })
  }
})

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

sessionLedgerRouter.use((err: unknown, _req: Request, res: Response, _next: unknown) => {
  const apiErr = err as ApiError
  res.status(apiErr.statusCode ?? 500).json({
    error: apiErr.message ?? 'Internal server error',
    code: apiErr.code ?? 'INTERNAL_ERROR',
  })
})
