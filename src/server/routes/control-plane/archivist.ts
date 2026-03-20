/**
 * Archivist Decision Transparency routes  (CP-T049)
 *
 * Routes:
 *   GET  /archive/:id/archivist-events  — Archivist staff_events for a specific archived fact
 *   POST /archive/:id/flag              — Flag an archive row for operator review
 *   DELETE /archive/:id/flag            — Remove the flag
 *   POST /archive/:id/restore           — Restore a flagged archived fact to knowledge_base
 *                                         Requires ?confirm=true and the row to be flagged (OQ-2).
 *                                         If an active KB row exists for the same entity+key it is
 *                                         superseded first (OQ-3).
 *
 * Flag storage decision (OQ-1):
 *   Flags are stored in a separate `archive_flags` table rather than as a JSONB column
 *   on the archive row. Rationale:
 *   - The archive table is upstream Iranti schema; ALTER TABLE risks upstream collision.
 *   - A dedicated table gives us cascade semantics, a clean index, and keeps
 *     control-plane concerns out of Iranti's core schema.
 *   - Querying all flagged facts is a simple JOIN rather than a JSONB scan.
 *   - See migration 002_create_archive_flags.sql for the full DDL and reasoning.
 *
 * Table-existence handling:
 *   - staff_events: graceful empty-array response if table missing (42P01), consistent
 *     with the pattern in events.ts.
 *   - archive_flags: returns 503 with ARCHIVE_FLAGS_TABLE_MISSING if migration not applied.
 *   - knowledge_base / archive: assumed always present (core Iranti schema).
 */

import { Router, Request, Response, NextFunction } from 'express'
import { query, pool } from '../../db.js'
import { StaffEvent, createApiError, ApiError } from '../../types.js'

export const archivistRouter = Router()

// ---------------------------------------------------------------------------
// Table-existence caches  (mirror the pattern from events.ts)
// ---------------------------------------------------------------------------

let staffEventsTableExists: boolean | null = null
let archiveFlagsTableExists: boolean | null = null

async function checkStaffEventsTable(): Promise<boolean> {
  if (staffEventsTableExists === true) return true
  try {
    const r = await query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'staff_events'
       ) AS exists`
    )
    staffEventsTableExists = r.rows[0]?.exists ?? false
  } catch {
    staffEventsTableExists = false
  }
  return staffEventsTableExists
}

async function assertArchiveFlagsTable(): Promise<void> {
  if (archiveFlagsTableExists === true) return
  try {
    const r = await query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'archive_flags'
       ) AS exists`
    )
    archiveFlagsTableExists = r.rows[0]?.exists ?? false
  } catch {
    archiveFlagsTableExists = false
  }
  if (!archiveFlagsTableExists) {
    throw createApiError(
      'archive_flags table does not exist. Apply migration 002_create_archive_flags.sql to enable flagging.',
      'ARCHIVE_FLAGS_TABLE_MISSING',
      503
    )
  }
}

function invalidateArchiveFlagsCache(): void {
  archiveFlagsTableExists = null
}

// ---------------------------------------------------------------------------
// Row serializers
// ---------------------------------------------------------------------------

function serializeEventRow(row: Record<string, unknown>): StaffEvent {
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
    entityType: (row.entity_type ?? row.entityType) as string | null ?? null,
    entityId: (row.entity_id ?? row.entityId) as string | null ?? null,
    key: row.key as string | null ?? null,
    reason: row.reason as string | null ?? null,
    level: (row.level ?? 'audit') as StaffEvent['level'],
    metadata: row.metadata as Record<string, unknown> | null ?? null,
  }
}

interface ArchiveRow {
  id: string
  entityType: string
  entityId: string
  key: string
  valueSummary: string | null
  valueRaw: unknown
  confidence: number
  source: string | null
  agentId: string | null
  validFrom: unknown
  validUntil: unknown
}

function parseArchiveRow(raw: Record<string, unknown>): ArchiveRow {
  return {
    id: String(raw.id ?? ''),
    entityType: String(raw.entityType ?? ''),
    entityId: String(raw.entityId ?? ''),
    key: String(raw.key ?? ''),
    valueSummary: (raw.valueSummary as string | null) ?? null,
    valueRaw: raw.valueRaw ?? null,
    confidence: Number(raw.confidence ?? 0),
    source: (raw.source as string | null) ?? null,
    agentId: (raw.agentId as string | null) ?? null,
    validFrom: raw.validFrom ?? null,
    validUntil: raw.validUntil ?? null,
  }
}

function toIso(val: unknown): string | null {
  if (val == null) return null
  if (val instanceof Date) return val.toISOString()
  if (typeof val === 'string') return val
  return null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up a single archive row by id. Throws 404 if not found.
 */
async function getArchiveRow(archiveId: string): Promise<ArchiveRow> {
  const result = await query(
    `SELECT id, "entityType", "entityId", key, "valueSummary", "valueRaw",
            confidence, source, "agentId", "validFrom", "validUntil"
     FROM archive
     WHERE id::text = $1
     LIMIT 1`,
    [archiveId]
  )
  if (result.rows.length === 0) {
    throw createApiError(
      `Archive row ${archiveId} not found`,
      'NOT_FOUND',
      404
    )
  }
  return parseArchiveRow(result.rows[0] as Record<string, unknown>)
}

/**
 * Return the flag row for an archive id, or null if none exists.
 */
async function getFlagRow(archiveId: string): Promise<{ id: string; note: string | null; flaggedAt: string; createdBy: string | null } | null> {
  const result = await query(
    `SELECT id, note, flagged_at, created_by FROM archive_flags WHERE archive_id = $1 LIMIT 1`,
    [archiveId]
  )
  if (result.rows.length === 0) return null
  const row = result.rows[0] as Record<string, unknown>
  return {
    id: String(row.id ?? ''),
    note: (row.note as string | null) ?? null,
    flaggedAt: toIso(row.flagged_at) ?? new Date().toISOString(),
    createdBy: (row.created_by as string | null) ?? null,
  }
}

// ---------------------------------------------------------------------------
// GET /archive/:id/archivist-events
// ---------------------------------------------------------------------------

archivistRouter.get(
  '/archive/:id/archivist-events',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const archiveId = req.params.id

      // Look up the archive row to get entity_type / entity_id / key
      const archiveRow = await getArchiveRow(archiveId)

      // Check staff_events table exists; graceful empty array if not
      const tableExists = await checkStaffEventsTable()
      if (!tableExists) {
        res.json({ events: [], archiveId })
        return
      }

      // Query Archivist events matching this fact's entity_type + entity_id + key.
      // We use snake_case column names for staff_events (as confirmed by migration 001).
      const result = await query(
        `SELECT *
         FROM staff_events
         WHERE staff_component = 'Archivist'
           AND entity_type = $1
           AND entity_id   = $2
           AND key         = $3
         ORDER BY timestamp DESC
         LIMIT 200`,
        [archiveRow.entityType, archiveRow.entityId, archiveRow.key]
      )

      const events = result.rows.map((r) =>
        serializeEventRow(r as Record<string, unknown>)
      )

      res.json({ events, archiveId })
    } catch (err) {
      // Graceful degradation: if staff_events table doesn't exist (42P01), return empty
      const pgErr = err as { code?: string }
      if (pgErr.code === '42P01') {
        staffEventsTableExists = false
        res.json({ events: [], archiveId: req.params.id })
        return
      }
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// POST /archive/:id/flag
// ---------------------------------------------------------------------------

archivistRouter.post(
  '/archive/:id/flag',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const archiveId = req.params.id

      // Validate archive row exists
      await getArchiveRow(archiveId)

      // Ensure the flags table exists
      await assertArchiveFlagsTable()

      const body = req.body as Record<string, unknown>
      const note: string | null =
        typeof body.note === 'string' && body.note.trim().length > 0
          ? body.note.trim()
          : null

      // Upsert: if a flag already exists for this archive row, update the note
      const result = await query(
        `INSERT INTO archive_flags (archive_id, note, created_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (archive_id) DO UPDATE
           SET note = EXCLUDED.note,
               flagged_at = now()
         RETURNING id, flagged_at`,
        [archiveId, note, null]
      )

      const row = result.rows[0] as Record<string, unknown>
      const flaggedAt = toIso(row.flagged_at) ?? new Date().toISOString()

      res.json({ flagged: true, archiveId, flaggedAt, note })
    } catch (err) {
      invalidateArchiveFlagsCache()
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// DELETE /archive/:id/flag
// ---------------------------------------------------------------------------

archivistRouter.delete(
  '/archive/:id/flag',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const archiveId = req.params.id

      // Ensure the flags table exists
      await assertArchiveFlagsTable()

      await query(
        `DELETE FROM archive_flags WHERE archive_id = $1`,
        [archiveId]
      )

      res.json({ flagged: false, archiveId })
    } catch (err) {
      invalidateArchiveFlagsCache()
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// POST /archive/:id/restore
// ---------------------------------------------------------------------------

archivistRouter.post(
  '/archive/:id/restore',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const archiveId = req.params.id

      // Require ?confirm=true (consistent with CP-T033 pattern)
      if (req.query.confirm !== 'true') {
        throw createApiError(
          'Restore requires ?confirm=true. This is a destructive operator override that writes to knowledge_base.',
          'CONFIRM_REQUIRED',
          400,
          { hint: 'Add ?confirm=true to the request URL to proceed.' }
        )
      }

      // Ensure flags table exists
      await assertArchiveFlagsTable()

      // Look up the archive row
      const archiveRow = await getArchiveRow(archiveId)

      // OQ-2 (PM decision): restore is only allowed if the archive row is flagged
      const flagRow = await getFlagRow(archiveId)
      if (!flagRow) {
        throw createApiError(
          `Archive row ${archiveId} is not flagged for review. Flag it first before restoring.`,
          'NOT_FLAGGED',
          409,
          { hint: 'POST /archive/:id/flag to flag the row, then retry the restore.' }
        )
      }

      // Run all writes in a single transaction:
      //   1. (OQ-3) If an active KB row exists for this entity+key, supersede it by setting validUntil = now().
      //   2. Insert the restored fact into knowledge_base.
      //   3. Write a fact_restored_by_operator event to staff_events.
      //   4. Remove the flag.
      const client = await pool.connect()
      let superseded = false

      try {
        await client.query('BEGIN')

        // Step 1: Check for and supersede any active KB row for the same entity+key
        // A KB row is "active" if validUntil IS NULL or validUntil > now().
        // We set validUntil = now() to mark it as superseded by this operator restore.
        const supersededResult = await client.query(
          `UPDATE knowledge_base
           SET "validUntil" = now()
           WHERE "entityType" = $1
             AND "entityId"   = $2
             AND key          = $3
             AND ("validUntil" IS NULL OR "validUntil" > now())`,
          [archiveRow.entityType, archiveRow.entityId, archiveRow.key]
        )
        superseded = (supersededResult.rowCount ?? 0) > 0

        // Step 2: Re-insert the archived fact as a new active KB row.
        // source is set to 'operator_restore', createdBy to 'control_plane_operator'.
        // validFrom is set to now() — the fact is considered current from this moment.
        const restoreResult = await client.query(
          `INSERT INTO knowledge_base
             ("entityType", "entityId", key, "valueSummary", "valueRaw",
              confidence, source, "createdBy", "validFrom")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
           RETURNING id`,
          [
            archiveRow.entityType,
            archiveRow.entityId,
            archiveRow.key,
            archiveRow.valueSummary,
            archiveRow.valueRaw,
            archiveRow.confidence,
            'operator_restore',
            'control_plane_operator',
          ]
        )
        const newKbId = String(
          (restoreResult.rows[0] as Record<string, unknown>).id ?? ''
        )

        // Step 3: Write audit event to staff_events (if the table exists)
        const staffTableExists = await checkStaffEventsTable()
        if (staffTableExists) {
          await client.query(
            `INSERT INTO staff_events
               (staff_component, action_type, agent_id, source,
                entity_type, entity_id, key, level, metadata)
             VALUES ('Archivist', 'fact_restored_by_operator', 'control_plane_operator',
                     'control_plane', $1, $2, $3, 'audit', $4::jsonb)`,
            [
              archiveRow.entityType,
              archiveRow.entityId,
              archiveRow.key,
              JSON.stringify({
                archiveId,
                newKbId,
                restoredAt: new Date().toISOString(),
                operatorFlagNote: flagRow.note,
                superseded,
              }),
            ]
          )
        }

        // Step 4: Remove the flag now that the restore is complete
        await client.query(
          `DELETE FROM archive_flags WHERE archive_id = $1`,
          [archiveId]
        )

        await client.query('COMMIT')

        res.json({
          restored: true,
          archiveId,
          entityType: archiveRow.entityType,
          entityId: archiveRow.entityId,
          key: archiveRow.key,
          superseded,
        })
      } catch (txErr) {
        await client.query('ROLLBACK')
        throw txErr
      } finally {
        client.release()
      }
    } catch (err) {
      invalidateArchiveFlagsCache()
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

archivistRouter.use(
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
