/**
 * fleet-ledger-repo.ts — Data-access layer for the mirrored fleet ledger.
 *
 * Owns all reads and writes to:
 *   - mirrored_staff_events      — audit events ingested from remote instances
 *   - instance_ledger_watermarks — per-instance poll cursors and health metadata
 *
 * The fleet poller (fleet-ledger-poller.ts) calls these functions; route
 * handlers query them via session-ledger.ts. Nothing else should touch
 * these tables directly.
 */

import { query } from '../db.js'

export interface MirroredEventInsert {
  instanceId: string
  remoteEventId: string
  timestamp: string           // ISO
  staffComponent: string | null
  actionType: string | null
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
}

/**
 * MirroredEvent represents a row read back from the database.
 * staffComponent and actionType are NOT NULL in the schema so they are
 * guaranteed strings here, unlike in MirroredEventInsert where they may
 * arrive null from an imperfect source.
 */
export interface MirroredEvent {
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

export interface WatermarkRow {
  instanceId: string
  lastEventTimestamp: string | null
  /** Alias for lastRemoteEventId — both fields reflect the same DB column. */
  lastEventId: string | null
  lastRemoteEventId: string | null
  lastPolledAt: string | null
  lastPollSucceeded: boolean
  lastPollError: string | null
  consecutiveFailures: number
  totalEventsIngested: number
  createdAt: string
  updatedAt: string
}

export interface FleetLedgerFilters {
  instanceId?: string
  source?: string
  host?: string
  agentId?: string
  sessionId?: string
  actionType?: string
  since?: string    // ISO
  until?: string    // ISO
  level?: 'audit' | 'debug'
  limit?: number    // 1–250, default 100
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return String(value)
}

function mapRowToMirroredEvent(row: Record<string, unknown>): MirroredEvent {
  return {
    id: row.id as number,
    instanceId: row.instance_id as string,
    remoteEventId: row.remote_event_id as string,
    timestamp: toIso(row.timestamp) as string,
    staffComponent: (row.staff_component as string | null) ?? '',
    actionType: (row.action_type as string | null) ?? '',
    agentId: (row.agent_id as string | null) ?? null,
    source: (row.source as string | null) ?? null,
    host: (row.host as string | null) ?? null,
    sessionId: (row.session_id as string | null) ?? null,
    entityType: (row.entity_type as string | null) ?? null,
    entityId: (row.entity_id as string | null) ?? null,
    key: (row.key as string | null) ?? null,
    reason: (row.reason as string | null) ?? null,
    level: row.level as 'audit' | 'debug',
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    ingestedAt: toIso(row.ingested_at) as string,
  }
}

function mapRowToWatermark(row: Record<string, unknown>): WatermarkRow {
  const lastRemoteEventId = (row.last_remote_event_id as string | null) ?? null
  return {
    instanceId: row.instance_id as string,
    lastEventTimestamp: toIso(row.last_event_timestamp),
    lastEventId: lastRemoteEventId,
    lastRemoteEventId,
    lastPolledAt: toIso(row.last_polled_at),
    lastPollSucceeded: row.last_poll_succeeded as boolean,
    lastPollError: (row.last_poll_error as string | null) ?? null,
    consecutiveFailures: row.consecutive_failures as number,
    totalEventsIngested: Number(row.total_events_ingested),
    createdAt: toIso(row.created_at) as string,
    updatedAt: toIso(row.updated_at) as string,
  }
}

// ---------------------------------------------------------------------------
// upsertMirroredEvents
// ---------------------------------------------------------------------------

/**
 * Batch-inserts events into mirrored_staff_events using a single multi-row
 * INSERT ... ON CONFLICT DO NOTHING for idempotency.
 *
 * Returns the count of rows actually inserted (new rows only).
 *
 * Column order (15 per row, excluding DB-generated id and ingested_at):
 *   instance_id, remote_event_id, timestamp, staff_component, action_type,
 *   agent_id, source, host, session_id, entity_type, entity_id, key, reason,
 *   level, metadata
 */
export async function upsertMirroredEvents(events: MirroredEventInsert[]): Promise<number> {
  if (events.length === 0) return 0

  const params: unknown[] = []
  const valueClauses: string[] = []

  for (const ev of events) {
    // Prefer ev.host; fall back to metadata.host if host was not set explicitly.
    const host =
      ev.host !== null && ev.host !== undefined
        ? ev.host
        : typeof ev.metadata?.host === 'string'
          ? ev.metadata.host
          : null

    const base = params.length + 1
    valueClauses.push(
      `($${base},$${base + 1},$${base + 2}::TIMESTAMPTZ,$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14}::jsonb)`
    )
    params.push(
      ev.instanceId,       // $base
      ev.remoteEventId,    // $base+1
      ev.timestamp,        // $base+2
      ev.staffComponent,   // $base+3
      ev.actionType,       // $base+4
      ev.agentId,          // $base+5
      ev.source,           // $base+6
      host,                // $base+7
      ev.sessionId,        // $base+8
      ev.entityType,       // $base+9
      ev.entityId,         // $base+10
      ev.key,              // $base+11
      ev.reason,           // $base+12
      ev.level,            // $base+13
      ev.metadata !== null && ev.metadata !== undefined
        ? JSON.stringify(ev.metadata)
        : null             // $base+14
    )
  }

  const sql = `
    INSERT INTO mirrored_staff_events
      (instance_id, remote_event_id, timestamp, staff_component, action_type,
       agent_id, source, host, session_id, entity_type, entity_id, key, reason,
       level, metadata)
    VALUES ${valueClauses.join(', ')}
    ON CONFLICT (instance_id, remote_event_id) DO NOTHING
  `

  const result = await query(sql, params)
  return result.rowCount ?? 0
}

// ---------------------------------------------------------------------------
// advanceWatermark
// ---------------------------------------------------------------------------

/**
 * Upserts the watermark for an instance after a successful poll.
 * Sets last_poll_succeeded = true, clears error, resets consecutive_failures,
 * and increments total_events_ingested by eventsCount.
 */
export async function advanceWatermark(
  instanceId: string,
  lastTimestamp: string | null,
  lastEventId: string | null,
  eventsCount: number
): Promise<void> {
  await query(
    `
    INSERT INTO instance_ledger_watermarks
      (instance_id, last_event_timestamp, last_remote_event_id,
       last_polled_at, last_poll_succeeded, last_poll_error,
       consecutive_failures, total_events_ingested,
       created_at, updated_at)
    VALUES
      ($1, $2::TIMESTAMPTZ, $3,
       now(), true, null,
       0, $4,
       now(), now())
    ON CONFLICT (instance_id) DO UPDATE SET
      last_event_timestamp  = EXCLUDED.last_event_timestamp,
      last_remote_event_id  = EXCLUDED.last_remote_event_id,
      last_polled_at        = now(),
      last_poll_succeeded   = true,
      last_poll_error       = null,
      consecutive_failures  = 0,
      total_events_ingested = instance_ledger_watermarks.total_events_ingested + $4,
      updated_at            = now()
    `,
    [instanceId, lastTimestamp, lastEventId, eventsCount]
  )
}

// ---------------------------------------------------------------------------
// recordPollFailure
// ---------------------------------------------------------------------------

/**
 * Records a poll failure for an instance.
 * Increments consecutive_failures and updates last_polled_at/updated_at.
 * Does NOT touch last_event_timestamp or last_remote_event_id.
 */
export async function recordPollFailure(instanceId: string, error: string): Promise<void> {
  await query(
    `
    INSERT INTO instance_ledger_watermarks
      (instance_id, last_polled_at, last_poll_succeeded, last_poll_error,
       consecutive_failures, total_events_ingested,
       created_at, updated_at)
    VALUES
      ($1, now(), false, $2,
       1, 0,
       now(), now())
    ON CONFLICT (instance_id) DO UPDATE SET
      last_polled_at       = now(),
      last_poll_succeeded  = false,
      last_poll_error      = $2,
      consecutive_failures = instance_ledger_watermarks.consecutive_failures + 1,
      updated_at           = now()
    `,
    [instanceId, error]
  )
}

// ---------------------------------------------------------------------------
// getWatermark / getAllWatermarks
// ---------------------------------------------------------------------------

/** Returns the watermark row for a single instance, or null if not found. */
export async function getWatermark(instanceId: string): Promise<WatermarkRow | null> {
  const result = await query(
    'SELECT * FROM instance_ledger_watermarks WHERE instance_id = $1',
    [instanceId]
  )
  if (result.rows.length === 0) return null
  return mapRowToWatermark(result.rows[0] as Record<string, unknown>)
}

/** Returns watermark rows for all known instances, ordered by instance_id. */
export async function getAllWatermarks(): Promise<WatermarkRow[]> {
  const result = await query(
    'SELECT * FROM instance_ledger_watermarks ORDER BY instance_id'
  )
  return (result.rows as Record<string, unknown>[]).map(mapRowToWatermark)
}

// ---------------------------------------------------------------------------
// queryFleetLedger
// ---------------------------------------------------------------------------

/**
 * Queries mirrored_staff_events with optional filters.
 * Returns paginated items and total count.
 */
export async function queryFleetLedger(
  filters: FleetLedgerFilters
): Promise<{ items: MirroredEvent[]; total: number }> {
  const limit = Math.min(filters.limit ?? 100, 250)
  const params: unknown[] = []
  const conditions: string[] = []

  function addFilter(col: string, value: string | undefined, cast?: string) {
    if (value === undefined) return
    params.push(value)
    const placeholder = cast ? `$${params.length}::${cast}` : `$${params.length}`
    conditions.push(`${col} = ${placeholder}`)
  }

  addFilter('instance_id', filters.instanceId)
  addFilter('source', filters.source)
  addFilter('host', filters.host)
  addFilter('agent_id', filters.agentId)
  addFilter('session_id', filters.sessionId)
  addFilter('action_type', filters.actionType)
  addFilter('level', filters.level)

  if (filters.since !== undefined) {
    params.push(filters.since)
    conditions.push(`timestamp >= $${params.length}::TIMESTAMPTZ`)
  }
  if (filters.until !== undefined) {
    params.push(filters.until)
    conditions.push(`timestamp <= $${params.length}::TIMESTAMPTZ`)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // Count query (reuses same params)
  const countSql = `
    SELECT COUNT(*) AS total
    FROM mirrored_staff_events
    ${whereClause}
  `
  const countResult = await query<{ total: string }>(countSql, params)
  const total = parseInt(countResult.rows[0]?.total ?? '0', 10)

  // Data query
  params.push(limit)
  const dataSql = `
    SELECT id, instance_id, remote_event_id, timestamp, staff_component, action_type,
           agent_id, source, host, session_id, entity_type, entity_id, key, reason,
           level, metadata, ingested_at
    FROM mirrored_staff_events
    ${whereClause}
    ORDER BY timestamp DESC, remote_event_id DESC
    LIMIT $${params.length}
  `

  const dataResult = await query(dataSql, params)
  const items = (dataResult.rows as Record<string, unknown>[]).map(mapRowToMirroredEvent)

  return { items, total }
}
