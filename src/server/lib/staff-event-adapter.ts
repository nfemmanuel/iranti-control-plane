/**
 * Staff Event Adapter
 *
 * Polls knowledge_base and archive tables for new rows and inserts synthetic
 * events into staff_events. This bridges the gap between the existing Iranti DB
 * state and the control plane's event stream, without requiring upstream changes.
 *
 * PHASE 1 LIMITATIONS:
 * - Attendant session lifecycle events cannot be reconstructed from DB state.
 * - Resolutionist decision events cannot be reconstructed from DB state.
 * - write_replaced detection is approximate (5s window heuristic).
 * - Cursor precision on restart: events written while adapter was down may be missed.
 *   Phase 2 fix: use metadata.sourceCreatedAt as cursor instead of event timestamp.
 * - No deduplication beyond cursor: parallel adapter instances could insert duplicates.
 *   Phase 2 fix: unique constraint on (action_type, metadata->>'sourceRowId').
 */

import { query } from '../db.js'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface AdapterCursor {
  kbCursor: string    // ISO timestamp — last processed knowledge_base created_at
  archiveCursor: string  // ISO timestamp — last processed archive created_at
}

let cursor: AdapterCursor | null = null
let isPolling = false
let adapterInterval: ReturnType<typeof setInterval> | null = null

const POLL_INTERVAL_MS = 2000

// ---------------------------------------------------------------------------
// Cursor initialization
// ---------------------------------------------------------------------------

async function loadCursor(): Promise<AdapterCursor> {
  const ADAPTER_ACTION_TYPES = ['write_created', 'write_replaced', 'entry_archived']

  try {
    const result = await query<{ max_ts: Date | null }>(
      `SELECT MAX(timestamp) AS max_ts FROM staff_events WHERE action_type = ANY($1)`,
      [ADAPTER_ACTION_TYPES]
    )

    const lastTs = result.rows[0]?.max_ts
    if (lastTs) {
      const iso = lastTs instanceof Date ? lastTs.toISOString() : String(lastTs)
      return { kbCursor: iso, archiveCursor: iso }
    }
  } catch {
    // staff_events table may not exist yet — start from 60s ago
  }

  // First run or table not yet created: look back 60 seconds to catch recent activity
  const INITIAL_LOOKBACK_MS = 60_000
  const initialCursor = new Date(Date.now() - INITIAL_LOOKBACK_MS).toISOString()
  return { kbCursor: initialCursor, archiveCursor: initialCursor }
}

// ---------------------------------------------------------------------------
// Helper: truncate a JSON value for preview
// ---------------------------------------------------------------------------

function truncateJson(val: unknown, maxChars: number): string | null {
  if (val == null) return null
  const str = typeof val === 'string' ? val : JSON.stringify(val)
  return str.length > maxChars ? str.slice(0, maxChars) + '...' : str
}

// ---------------------------------------------------------------------------
// Batch insert helper
// ---------------------------------------------------------------------------

async function insertEvents(events: Record<string, unknown>[]): Promise<void> {
  if (events.length === 0) return

  // Build parameterized bulk insert
  const values = events
    .map((_, i) => {
      const base = i * 11
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10}::jsonb,$${base + 11}::timestamptz)`
    })
    .join(',')

  const params = events.flatMap((e) => [
    e.staff_component,
    e.action_type,
    e.agent_id ?? null,
    e.source ?? null,
    e.entity_type ?? null,
    e.entity_id ?? null,
    e.key ?? null,
    e.reason ?? null,
    e.level ?? 'audit',
    e.metadata != null ? JSON.stringify(e.metadata) : null,
    e.timestamp ?? new Date().toISOString(),
  ])

  await query(
    `INSERT INTO staff_events
       (staff_component, action_type, agent_id, source, entity_type, entity_id, key, reason, level, metadata, timestamp)
     VALUES ${values}
     ON CONFLICT DO NOTHING`,
    params
  )
}

// ---------------------------------------------------------------------------
// Poll knowledge_base
// ---------------------------------------------------------------------------

async function pollKnowledgeBase(cur: AdapterCursor): Promise<void> {
  type KbRow = {
    id: unknown
    entity_type: string | null
    entity_id: string | null
    key: string | null
    agent_id: string | null
    source: string | null
    confidence: number | null
    value_raw: unknown
    created_at: Date
  }

  let rows: KbRow[]
  try {
    const result = await query<KbRow>(
      `SELECT id, entity_type, entity_id, key, agent_id, source, confidence, value_raw, created_at
       FROM knowledge_base
       WHERE created_at > $1
       ORDER BY created_at ASC
       LIMIT 100`,
      [cur.kbCursor]
    )
    rows = result.rows
  } catch {
    // Table may not have expected columns or may not exist — skip silently
    return
  }

  if (rows.length === 0) return

  const events: Record<string, unknown>[] = []

  for (const row of rows) {
    // Determine write_created vs write_replaced:
    // A row is a "replace" if there is an archive row for the same entity+key
    // archived within 5 seconds of this row's created_at (approximate heuristic).
    let actionType = 'write_created'
    try {
      const priorResult = await query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM archive
         WHERE entity_type = $1 AND entity_id = $2 AND key = $3
           AND archived_at > $4 AND archived_at <= $5`,
        [
          row.entity_type,
          row.entity_id,
          row.key,
          new Date(row.created_at.getTime() - 5000).toISOString(),
          new Date(row.created_at.getTime() + 5000).toISOString(),
        ]
      )
      if (parseInt(priorResult.rows[0]?.count ?? '0', 10) > 0) {
        actionType = 'write_replaced'
      }
    } catch { /* heuristic check failed — default to write_created */ }

    events.push({
      staff_component: 'Librarian',
      action_type: actionType,
      agent_id: row.agent_id ?? null,
      source: row.source ?? null,
      entity_type: row.entity_type ?? null,
      entity_id: row.entity_id ?? null,
      key: row.key ?? null,
      reason: 'Detected by control plane adapter (Phase 1)',
      level: 'audit',
      metadata: {
        confidence: row.confidence,
        valuePreview: truncateJson(row.value_raw, 200),
        sourceCreatedAt: row.created_at.toISOString(),
        sourceRowId: String(row.id),
      },
      timestamp: row.created_at.toISOString(),
    })
  }

  try {
    await insertEvents(events)
    // Advance cursor to the latest processed row
    const lastRow = rows[rows.length - 1]
    cur.kbCursor = lastRow.created_at.toISOString()
  } catch {
    // Insert failed (table may not exist yet) — skip silently, cursor not advanced
  }
}

// ---------------------------------------------------------------------------
// Poll archive
// ---------------------------------------------------------------------------

async function pollArchive(cur: AdapterCursor): Promise<void> {
  type ArchiveRow = {
    id: unknown
    entity_type: string | null
    entity_id: string | null
    key: string | null
    agent_id: string | null
    source: string | null
    archived_reason: string | null
    created_at: Date
  }

  let rows: ArchiveRow[]
  try {
    const result = await query<ArchiveRow>(
      `SELECT id, entity_type, entity_id, key, agent_id, source, archived_reason, created_at
       FROM archive
       WHERE created_at > $1
       ORDER BY created_at ASC
       LIMIT 100`,
      [cur.archiveCursor]
    )
    rows = result.rows
  } catch {
    return
  }

  if (rows.length === 0) return

  const events: Record<string, unknown>[] = rows.map((row) => ({
    staff_component: 'Archivist',
    action_type: 'entry_archived',
    agent_id: row.agent_id ?? null,
    source: row.source ?? null,
    entity_type: row.entity_type ?? null,
    entity_id: row.entity_id ?? null,
    key: row.key ?? null,
    reason: row.archived_reason ?? 'Detected by control plane adapter (Phase 1)',
    level: 'audit',
    metadata: {
      archivedReason: row.archived_reason ?? null,
      archivedFactId: String(row.id),
      sourceCreatedAt: row.created_at.toISOString(),
    },
    timestamp: row.created_at.toISOString(),
  }))

  try {
    await insertEvents(events)
    const lastRow = rows[rows.length - 1]
    cur.archiveCursor = lastRow.created_at.toISOString()
  } catch {
    // Skip silently — staff_events table may not exist yet
  }
}

// ---------------------------------------------------------------------------
// Poll once
// ---------------------------------------------------------------------------

async function pollOnce(): Promise<void> {
  if (!cursor) return
  // Run both polls in parallel — they are independent
  await Promise.all([pollKnowledgeBase(cursor), pollArchive(cursor)])
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function startAdapter(): Promise<void> {
  try {
    cursor = await loadCursor()
    console.log(`[staff-events-adapter] Starting. KB cursor: ${cursor.kbCursor}`)
  } catch (err) {
    console.warn('[staff-events-adapter] Failed to load cursor — adapter will not start:', err)
    return
  }

  adapterInterval = setInterval(() => {
    if (isPolling) return
    isPolling = true
    pollOnce()
      .catch((err) => console.error('[staff-events-adapter] Poll error:', err))
      .finally(() => { isPolling = false })
  }, POLL_INTERVAL_MS)
}

export function stopAdapter(): void {
  if (adapterInterval !== null) {
    clearInterval(adapterInterval)
    adapterInterval = null
    console.log('[staff-events-adapter] Stopped.')
  }
}
