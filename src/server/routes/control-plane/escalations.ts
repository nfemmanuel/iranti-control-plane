/**
 * Escalation routes — CP-T021
 *
 * GET  /escalations          — list pending or resolved escalations
 * POST /escalations/:id/resolve — resolve a pending escalation
 *
 * Escalation data lives in the `archive` table.
 * Pending escalations: rows where "resolutionState" IS NULL AND "supersededBy" IS NOT NULL
 * Resolved escalations: rows where "resolutionState" IS NOT NULL
 *
 * PM decision (2026-03-20): escalation pathway is direct DB write with audit log.
 * No separate Resolutionist CLI pathway exists programmatically in Phase 2.
 */

import { Router, Request, Response, NextFunction } from 'express'
import { query } from '../../db.js'
import {
  ApiError,
  createApiError,
  serializeFullValueRaw,
} from '../../types.js'

export const escalationsRouter = Router()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EscalationFact {
  entityType: string
  entityId: string
  key: string
  valueRaw: string | null
  valueSummary: string | null
  confidence: number
  source: string | null
  createdBy: string | null
  createdAt: string
  validFrom: string | null
  reason: string | null
  note: string | null
}

interface PendingEscalationItem {
  id: string
  entityType: string
  entityId: string
  key: string
  conflictType: string
  age: string
  existing: EscalationFact | null
  challenger: EscalationFact
}

interface ResolvedEscalationItem {
  id: string
  entityType: string
  entityId: string
  key: string
  resolutionState: string
  archivedAt: string
  resolutionNote: string | null
}

type ResolutionChoice = 'keep_existing' | 'accept_challenger' | 'custom'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIso(val: unknown): string | null {
  if (val == null) return null
  if (val instanceof Date) return val.toISOString()
  if (typeof val === 'string') return val
  return null
}

function humanAge(iso: string | null): string {
  if (!iso) return 'unknown'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/**
 * Extract conflictType from conflictLog JSONB if available.
 * Falls back to "value_conflict" when absent or unparseable.
 */
function deriveConflictType(conflictLog: unknown): string {
  if (conflictLog == null) return 'value_conflict'
  try {
    const parsed = typeof conflictLog === 'string' ? JSON.parse(conflictLog) : conflictLog
    if (parsed && typeof parsed === 'object') {
      const ct = (parsed as Record<string, unknown>).conflictType
      if (typeof ct === 'string' && ct.length > 0) return ct
    }
  } catch {
    // unparseable — fall through
  }
  return 'value_conflict'
}

function serializeArchiveAsChallenger(row: Record<string, unknown>): EscalationFact {
  return {
    entityType: String(row.entityType ?? ''),
    entityId: String(row.entityId ?? ''),
    key: String(row.key ?? ''),
    valueRaw: serializeFullValueRaw(row.valueRaw),
    valueSummary: (row.valueSummary as string | null) ?? null,
    confidence: Number(row.confidence ?? 0),
    source: (row.source as string | null) ?? null,
    createdBy: (row.createdBy as string | null) ?? null,
    createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
    validFrom: toIso(row.validFrom),
    reason: (row.archivedReason as string | null) ?? null,
    note: (row.resolutionNote as string | null) ?? null,
  }
}

function serializeKBAsExisting(row: Record<string, unknown>): EscalationFact {
  return {
    entityType: String(row.entityType ?? ''),
    entityId: String(row.entityId ?? ''),
    key: String(row.key ?? ''),
    valueRaw: serializeFullValueRaw(row.valueRaw),
    valueSummary: (row.valueSummary as string | null) ?? null,
    confidence: Number(row.confidence ?? 0),
    source: (row.source as string | null) ?? null,
    createdBy: (row.createdBy as string | null) ?? null,
    createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
    validFrom: toIso(row.validFrom),
    reason: null,
    note: null,
  }
}

/**
 * Write an audit log entry to staff_events.
 * Follows the same pattern as repair.ts: fails silently if the table does not exist.
 */
async function writeAuditLog(
  action: string,
  detail: Record<string, unknown>
): Promise<void> {
  try {
    await query(
      `INSERT INTO staff_events
         (staff_component, action_type, agent_id, source, reason, level, metadata, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)`,
      [
        'Resolutionist',
        action,
        'control_plane_operator',
        'control_plane',
        `Escalation resolved: ${action}`,
        'audit',
        JSON.stringify(detail),
        new Date().toISOString(),
      ]
    )
  } catch {
    console.warn(`[escalations] audit log skipped (staff_events unavailable): ${action}`, detail)
  }
}

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const apiErr = err as ApiError
  const statusCode = apiErr.statusCode ?? 500
  const code = apiErr.code ?? 'INTERNAL_ERROR'
  const message = apiErr.message ?? 'Internal server error'

  const errMsg = String(err)
  const is503 =
    errMsg.includes('ECONNREFUSED') ||
    errMsg.includes('connection refused') ||
    errMsg.includes('connect ETIMEDOUT') ||
    code === 'DB_UNAVAILABLE'

  if (is503 && statusCode === 500) {
    res.status(503).json({ error: 'Database unavailable', code: 'DB_UNAVAILABLE' })
    return
  }

  res.status(statusCode).json({
    error: message,
    code,
    ...(apiErr.detail ? { detail: apiErr.detail } : {}),
  })
}

// ---------------------------------------------------------------------------
// GET /escalations
// ---------------------------------------------------------------------------

escalationsRouter.get('/escalations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = (req.query.status as string | undefined) ?? 'pending'

    if (status !== 'pending' && status !== 'resolved') {
      throw createApiError(
        'status must be "pending" or "resolved"',
        'INVALID_PARAM',
        400,
        { field: 'status', received: status }
      )
    }

    if (status === 'pending') {
      // Pending: resolutionState IS NULL AND supersededBy IS NOT NULL
      const archiveResult = await query(
        `SELECT
          id::text            AS id,
          "entityType",
          "entityId",
          key,
          "valueRaw",
          "valueSummary",
          confidence,
          source,
          "createdBy",
          "createdAt",
          "validFrom",
          "archivedAt",
          "archivedReason",
          "resolutionNote",
          "supersededBy"::text AS "supersededBy",
          "conflictLog"
        FROM archive
        WHERE "resolutionState" IS NULL AND "supersededBy" IS NOT NULL
        ORDER BY "archivedAt" ASC`
      )

      if (archiveResult.rows.length === 0) {
        res.json({ pending: [], total: 0 })
        return
      }

      // For each pending row, fetch the current KB fact for same entityType/entityId/key
      const pendingRows = archiveResult.rows as Record<string, unknown>[]

      // Batch KB lookups: build a lookup map keyed by entityType+entityId+key
      const uniqueKeys = [
        ...new Set(
          pendingRows.map(r => `${String(r.entityType)}::${String(r.entityId)}::${String(r.key)}`)
        ),
      ]

      // Fetch all matching KB rows in one query using unnest
      const kbMap = new Map<string, Record<string, unknown>>()

      if (uniqueKeys.length > 0) {
        // Build a parameterized OR clause for the KB lookup
        const params: unknown[] = []
        const conditions = pendingRows.map((r) => {
          params.push(r.entityType, r.entityId, r.key)
          const p = params.length
          return `("entityType" = $${p - 2} AND "entityId" = $${p - 1} AND key = $${p})`
        })

        const kbResult = await query(
          `SELECT
            id::text        AS id,
            "entityType",
            "entityId",
            key,
            "valueRaw",
            "valueSummary",
            confidence,
            source,
            "createdBy",
            "createdAt",
            "validFrom"
          FROM knowledge_base
          WHERE ${conditions.join(' OR ')}`,
          params
        )

        for (const row of kbResult.rows as Record<string, unknown>[]) {
          const mapKey = `${String(row.entityType)}::${String(row.entityId)}::${String(row.key)}`
          kbMap.set(mapKey, row)
        }
      }

      const pending: PendingEscalationItem[] = pendingRows.map((row) => {
        const mapKey = `${String(row.entityType)}::${String(row.entityId)}::${String(row.key)}`
        const kbRow = kbMap.get(mapKey) ?? null

        return {
          id: String(row.id),
          entityType: String(row.entityType),
          entityId: String(row.entityId),
          key: String(row.key),
          conflictType: deriveConflictType(row.conflictLog),
          age: humanAge(toIso(row.archivedAt)),
          existing: kbRow ? serializeKBAsExisting(kbRow) : null,
          challenger: serializeArchiveAsChallenger(row),
        }
      })

      res.json({ pending, total: pending.length })
    } else {
      // Resolved: resolutionState IS NOT NULL
      const resolvedResult = await query(
        `SELECT
          id::text              AS id,
          "entityType",
          "entityId",
          key,
          "resolutionState",
          "archivedAt",
          "resolutionNote"
        FROM archive
        WHERE "resolutionState" IS NOT NULL
        ORDER BY "archivedAt" DESC
        LIMIT 500`
      )

      const resolved: ResolvedEscalationItem[] = (resolvedResult.rows as Record<string, unknown>[]).map(
        (row) => ({
          id: String(row.id),
          entityType: String(row.entityType),
          entityId: String(row.entityId),
          key: String(row.key),
          resolutionState: String(row.resolutionState),
          archivedAt: toIso(row.archivedAt) ?? new Date(0).toISOString(),
          resolutionNote: (row.resolutionNote as string | null) ?? null,
        })
      )

      res.json({ resolved, total: resolved.length })
    }
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// POST /escalations/:id/resolve
// ---------------------------------------------------------------------------

escalationsRouter.post(
  '/escalations/:id/resolve',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params
      const body = req.body as Record<string, unknown>
      const resolution = body.resolution as string | undefined
      const customValue = body.customValue as string | undefined

      // Validate resolution value
      const validResolutions: ResolutionChoice[] = ['keep_existing', 'accept_challenger', 'custom']
      if (!resolution || !validResolutions.includes(resolution as ResolutionChoice)) {
        throw createApiError(
          'resolution must be one of: keep_existing, accept_challenger, custom',
          'INVALID_PARAM',
          400,
          { field: 'resolution', received: resolution }
        )
      }

      // Validate custom value when resolution is "custom"
      if (resolution === 'custom') {
        if (!customValue || !customValue.trim()) {
          throw createApiError(
            'customValue is required when resolution is "custom"',
            'INVALID_PARAM',
            400,
            { field: 'customValue' }
          )
        }
        try {
          JSON.parse(customValue)
        } catch {
          throw createApiError(
            'customValue must be valid JSON',
            'INVALID_PARAM',
            400,
            { field: 'customValue', received: customValue }
          )
        }
      }

      // Fetch the archive row
      const archiveResult = await query(
        `SELECT
          id::text              AS id,
          "entityType",
          "entityId",
          key,
          "valueRaw",
          "valueSummary",
          confidence,
          source,
          "createdBy",
          "validFrom",
          "validUntil",
          "resolutionState",
          "conflictLog"
        FROM archive
        WHERE id = $1::uuid`,
        [id]
      )

      if (archiveResult.rows.length === 0) {
        throw createApiError(`Escalation not found: ${id}`, 'NOT_FOUND', 404)
      }

      const archiveRow = archiveResult.rows[0] as Record<string, unknown>

      // 404 if already resolved
      if (archiveRow.resolutionState != null) {
        throw createApiError(
          `Escalation ${id} is already resolved (resolutionState: ${archiveRow.resolutionState})`,
          'ALREADY_RESOLVED',
          404
        )
      }

      const entityType = String(archiveRow.entityType)
      const entityId = String(archiveRow.entityId)
      const key = String(archiveRow.key)
      const resolvedAt = new Date().toISOString()

      if (resolution === 'keep_existing') {
        // Mark archive row as resolved_keep_existing — no KB change
        await query(
          `UPDATE archive SET "resolutionState" = 'resolved_keep_existing' WHERE id = $1::uuid`,
          [id]
        )
      } else if (resolution === 'accept_challenger') {
        // Write new KB fact from the archive row values, then mark resolved
        const valueRaw = archiveRow.valueRaw
        const valueSummary = archiveRow.valueSummary as string | null
        const confidence = Number(archiveRow.confidence ?? 0)
        const source = (archiveRow.source as string | null) ?? null
        const createdBy = (archiveRow.createdBy as string | null) ?? 'control_plane_operator'
        const validFrom = archiveRow.validFrom as string | null ?? null
        const validUntil = archiveRow.validUntil as string | null ?? null

        await query(
          `INSERT INTO knowledge_base
             ("entityType", "entityId", key, "valueRaw", "valueSummary", confidence, source, "createdBy", "validFrom", "validUntil", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, NOW(), NOW())
           ON CONFLICT ("entityType", "entityId", key)
           DO UPDATE SET
             "valueRaw"     = EXCLUDED."valueRaw",
             "valueSummary" = EXCLUDED."valueSummary",
             confidence     = EXCLUDED.confidence,
             source         = EXCLUDED.source,
             "createdBy"    = EXCLUDED."createdBy",
             "validFrom"    = EXCLUDED."validFrom",
             "validUntil"   = EXCLUDED."validUntil",
             "updatedAt"    = NOW()`,
          [entityType, entityId, key, JSON.stringify(valueRaw), valueSummary, confidence, source, createdBy, validFrom, validUntil]
        )

        await query(
          `UPDATE archive SET "resolutionState" = 'resolved_accept_challenger' WHERE id = $1::uuid`,
          [id]
        )
      } else {
        // custom — customValue already validated above
        const parsedCustom = JSON.parse(customValue!)
        const createdBy = (archiveRow.createdBy as string | null) ?? 'control_plane_operator'

        await query(
          `INSERT INTO knowledge_base
             ("entityType", "entityId", key, "valueRaw", "valueSummary", confidence, source, "createdBy", "validFrom", "validUntil", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4::jsonb, NULL, 85, 'control_plane', $5, NULL, NULL, NOW(), NOW())
           ON CONFLICT ("entityType", "entityId", key)
           DO UPDATE SET
             "valueRaw"     = EXCLUDED."valueRaw",
             "valueSummary" = NULL,
             confidence     = 85,
             source         = 'control_plane',
             "createdBy"    = EXCLUDED."createdBy",
             "validFrom"    = NULL,
             "validUntil"   = NULL,
             "updatedAt"    = NOW()`,
          [entityType, entityId, key, JSON.stringify(parsedCustom), createdBy]
        )

        await query(
          `UPDATE archive SET "resolutionState" = 'resolved_custom' WHERE id = $1::uuid`,
          [id]
        )
      }

      // Audit log
      await writeAuditLog('conflict_resolved', {
        archiveId: id,
        entityType,
        entityId,
        key,
        resolution,
        resolvedAt,
      })

      res.json({
        id,
        resolution,
        resolvedAt,
        entityType,
        entityId,
        key,
      })
    } catch (err) {
      next(err)
    }
  }
)

// Error handler must be last
escalationsRouter.use(errorHandler)
