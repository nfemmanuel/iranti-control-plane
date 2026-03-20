/**
 * KB / Archive / Entity / Relationships routes
 *
 * Covers:
 *   GET /kb              — paginated knowledge_base browse
 *   GET /archive         — paginated archive browse
 *   GET /entities/:entityType/:entityId           — entity detail
 *   GET /entities/:entityType/:entityId/history/:key — temporal history (UNION)
 *   GET /relationships   — entity_relationships browse
 *
 * PHASE 1 NOTE: The `entities` table does not exist in the current Iranti DB schema.
 * EntityRecord will always be null until a canonical entities table is added upstream.
 * See CP-T010 ticket and CP-T002 spec §Group 3.
 */

import { Router, Request, Response, NextFunction } from 'express'
import { query } from '../../db.js'
import {
  KBFact,
  ArchiveFact,
  HistoryInterval,
  Relationship,
  createApiError,
  parsePagination,
  serializeValueRaw,
  serializeFullValueRaw,
  ApiError,
} from '../../types.js'

export const kbRouter = Router()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseMinConfidence(val: string | undefined): number | undefined {
  if (val === undefined) return undefined
  const n = parseInt(val, 10)
  if (isNaN(n) || n < 0 || n > 100) {
    throw createApiError('minConfidence must be an integer in [0, 100]', 'INVALID_PARAM', 400, {
      field: 'minConfidence',
      received: val,
    })
  }
  return n
}

function parseIsoDate(val: string | undefined, field: string): Date | undefined {
  if (val === undefined) return undefined
  if (isNaN(Date.parse(val))) {
    throw createApiError(`${field} must be a valid ISO 8601 timestamp`, 'INVALID_PARAM', 400, {
      field,
      received: val,
    })
  }
  return new Date(val)
}

function toIso(val: unknown): string | null {
  if (val == null) return null
  if (val instanceof Date) return val.toISOString()
  if (typeof val === 'string') return val
  return null
}

// ---------------------------------------------------------------------------
// Row serializers
// ---------------------------------------------------------------------------

function serializeKBRow(row: Record<string, unknown>): KBFact {
  const { valueRaw, valueRawTruncated } = serializeValueRaw(row.value_raw ?? row.valueRaw)
  return {
    id: String(row.id),
    entityType: String(row.entity_type ?? row.entityType ?? ''),
    entityId: String(row.entity_id ?? row.entityId ?? ''),
    key: String(row.key ?? ''),
    valueSummary: (row.summary ?? row.valueSummary) as string | null ?? null,
    valueRaw,
    valueRawTruncated,
    confidence: Number(row.confidence ?? 0),
    source: (row.source as string | null) ?? null,
    agentId: (row.agent_id ?? row.agentId) as string | null ?? null,
    validFrom: toIso(row.valid_from ?? row.validFrom),
    validUntil: toIso(row.valid_until ?? row.validUntil),
    createdAt: toIso(row.created_at ?? row.createdAt) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updated_at ?? row.updatedAt),
    properties: (row.properties as Record<string, unknown> | null) ?? null,
    conflictLog: (row.conflict_log ?? row.conflictLog) as Record<string, unknown> | null ?? null,
  }
}

function serializeArchiveRow(row: Record<string, unknown>): ArchiveFact {
  const { valueRaw, valueRawTruncated } = serializeValueRaw(row.value_raw ?? row.valueRaw)
  return {
    id: String(row.id),
    entityType: String(row.entity_type ?? row.entityType ?? ''),
    entityId: String(row.entity_id ?? row.entityId ?? ''),
    key: String(row.key ?? ''),
    valueSummary: (row.summary ?? row.valueSummary) as string | null ?? null,
    valueRaw,
    valueRawTruncated,
    confidence: Number(row.confidence ?? 0),
    source: (row.source as string | null) ?? null,
    agentId: (row.agent_id ?? row.agentId) as string | null ?? null,
    validFrom: toIso(row.valid_from ?? row.validFrom),
    validUntil: toIso(row.valid_until ?? row.validUntil),
    archivedAt: toIso(row.archived_at ?? row.archivedAt) ?? new Date(0).toISOString(),
    archivedReason: (row.archived_reason ?? row.archivedReason) as string | null ?? null,
    supersededBy: row.superseded_by != null ? String(row.superseded_by) : null,
    resolutionState: (row.resolution_state ?? row.resolutionState) as string | null ?? null,
    resolutionNote: (row.resolution_note ?? row.resolutionNote) as string | null ?? null,
    properties: (row.properties as Record<string, unknown> | null) ?? null,
    conflictLog: (row.conflict_log ?? row.conflictLog) as Record<string, unknown> | null ?? null,
    createdAt: toIso(row.created_at ?? row.createdAt) ?? new Date(0).toISOString(),
  }
}

function serializeRelationshipRow(row: Record<string, unknown>): Relationship {
  return {
    id: String(row.id),
    fromEntityType: String(row.from_entity_type ?? row.fromEntityType ?? ''),
    fromEntityId: String(row.from_entity_id ?? row.fromEntityId ?? ''),
    toEntityType: String(row.to_entity_type ?? row.toEntityType ?? ''),
    toEntityId: String(row.to_entity_id ?? row.toEntityId ?? ''),
    relationshipType: String(row.relationship_type ?? row.relationshipType ?? ''),
    confidence: row.confidence != null ? Number(row.confidence) : null,
    source: (row.source as string | null) ?? null,
    createdAt: toIso(row.created_at ?? row.createdAt) ?? new Date(0).toISOString(),
    properties: (row.properties as Record<string, unknown> | null) ?? null,
  }
}

// ---------------------------------------------------------------------------
// DB query builder for KB / archive filter params
// ---------------------------------------------------------------------------

interface KBFilters {
  entityType?: string
  entityId?: string
  key?: string
  source?: string
  createdBy?: string
  minConfidence?: number
  search?: string
  activeOnly?: boolean
}

interface ArchiveFilters extends KBFilters {
  archivedReason?: string
  resolutionState?: string
  supersededBy?: string
  archivedAfter?: Date
  archivedBefore?: Date
}

function buildKBWhereClause(
  filters: KBFilters,
  params: unknown[],
  tablePrefix = ''
): string {
  const clauses: string[] = []
  const t = tablePrefix ? `${tablePrefix}.` : ''

  if (filters.search) {
    params.push(`%${filters.search}%`)
    const p = params.length
    clauses.push(
      `(${t}"entityId" ILIKE $${p} OR ${t}key ILIKE $${p} OR COALESCE(${t}"valueSummary",'') ILIKE $${p} OR (${t}"valueRaw"::text) ILIKE $${p})`
    )
  }
  if (filters.entityType) {
    params.push(filters.entityType)
    clauses.push(`${t}"entityType" = $${params.length}`)
  }
  if (filters.entityId) {
    params.push(filters.entityId)
    clauses.push(`${t}"entityId" = $${params.length}`)
  }
  if (filters.key) {
    params.push(filters.key)
    clauses.push(`${t}key = $${params.length}`)
  }
  if (filters.source) {
    params.push(filters.source)
    clauses.push(`${t}source = $${params.length}`)
  }
  if (filters.createdBy) {
    params.push(filters.createdBy)
    clauses.push(`${t}"agentId" = $${params.length}`)
  }
  if (filters.minConfidence !== undefined) {
    params.push(filters.minConfidence)
    clauses.push(`${t}confidence >= $${params.length}`)
  }
  if (filters.activeOnly) {
    clauses.push(`(${t}"validUntil" IS NULL OR ${t}"validUntil" > NOW())`)
  }

  return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
}

function buildArchiveWhereClause(filters: ArchiveFilters, params: unknown[]): string {
  const clauses: string[] = []

  if (filters.search) {
    params.push(`%${filters.search}%`)
    const p = params.length
    clauses.push(
      `("entityId" ILIKE $${p} OR key ILIKE $${p} OR COALESCE("valueSummary",'') ILIKE $${p} OR ("valueRaw"::text) ILIKE $${p})`
    )
  }
  if (filters.entityType) {
    params.push(filters.entityType)
    clauses.push(`"entityType" = $${params.length}`)
  }
  if (filters.entityId) {
    params.push(filters.entityId)
    clauses.push(`"entityId" = $${params.length}`)
  }
  if (filters.key) {
    params.push(filters.key)
    clauses.push(`key = $${params.length}`)
  }
  if (filters.source) {
    params.push(filters.source)
    clauses.push(`source = $${params.length}`)
  }
  if (filters.createdBy) {
    params.push(filters.createdBy)
    clauses.push(`"agentId" = $${params.length}`)
  }
  if (filters.minConfidence !== undefined) {
    params.push(filters.minConfidence)
    clauses.push(`confidence >= $${params.length}`)
  }
  if (filters.archivedReason) {
    params.push(filters.archivedReason)
    clauses.push(`"archivedReason" = $${params.length}`)
  }
  if (filters.resolutionState) {
    params.push(filters.resolutionState)
    clauses.push(`"resolutionState" = $${params.length}`)
  }
  if (filters.supersededBy) {
    params.push(filters.supersededBy)
    clauses.push(`"supersededBy"::text = $${params.length}`)
  }
  if (filters.archivedAfter) {
    params.push(filters.archivedAfter.toISOString())
    clauses.push(`"archivedAt" > $${params.length}`)
  }
  if (filters.archivedBefore) {
    params.push(filters.archivedBefore.toISOString())
    clauses.push(`"archivedAt" <= $${params.length}`)
  }

  return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
}

// ---------------------------------------------------------------------------
// Error handler middleware (registered last on this router)
// ---------------------------------------------------------------------------

function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const apiErr = err as ApiError
  const statusCode = apiErr.statusCode ?? 500
  const code = apiErr.code ?? 'INTERNAL_ERROR'
  const message = apiErr.message ?? 'Internal server error'

  // Map DB connection errors to 503
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
// GET /kb
// ---------------------------------------------------------------------------

kbRouter.get('/kb', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit, offset } = parsePagination(
      req.query.limit as string | undefined,
      req.query.offset as string | undefined,
      50,
      500
    )

    const filters: KBFilters = {
      entityType: req.query.entityType as string | undefined,
      entityId: req.query.entityId as string | undefined,
      key: req.query.key as string | undefined,
      source: req.query.source as string | undefined,
      createdBy: req.query.createdBy as string | undefined,
      minConfidence: parseMinConfidence(req.query.minConfidence as string | undefined),
      search: req.query.search as string | undefined,
      activeOnly: req.query.activeOnly === 'true',
    }

    const params: unknown[] = []
    const where = buildKBWhereClause(filters, params)

    // Data query
    const dataParams = [...params, limit, offset]
    const dataResult = await query(
      `SELECT * FROM knowledge_base ${where} ORDER BY "createdAt" DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    )

    // Count query (same params, no limit/offset)
    const countResult = await query(
      `SELECT COUNT(*) AS total FROM knowledge_base ${where}`,
      params
    )

    const total = parseInt((countResult.rows[0] as Record<string, unknown>).total as string, 10)

    res.json({
      items: dataResult.rows.map((r) => serializeKBRow(r as Record<string, unknown>)),
      total,
      limit,
      offset,
    })
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /archive
// ---------------------------------------------------------------------------

kbRouter.get('/archive', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit, offset } = parsePagination(
      req.query.limit as string | undefined,
      req.query.offset as string | undefined,
      50,
      500
    )

    const filters: ArchiveFilters = {
      entityType: req.query.entityType as string | undefined,
      entityId: req.query.entityId as string | undefined,
      key: req.query.key as string | undefined,
      source: req.query.source as string | undefined,
      createdBy: req.query.createdBy as string | undefined,
      minConfidence: parseMinConfidence(req.query.minConfidence as string | undefined),
      search: req.query.search as string | undefined,
      archivedReason: req.query.archivedReason as string | undefined,
      resolutionState: req.query.resolutionState as string | undefined,
      supersededBy: req.query.supersededBy as string | undefined,
      archivedAfter: parseIsoDate(req.query.archivedAfter as string | undefined, 'archivedAfter'),
      archivedBefore: parseIsoDate(req.query.archivedBefore as string | undefined, 'archivedBefore'),
    }

    const params: unknown[] = []
    const where = buildArchiveWhereClause(filters, params)

    const dataParams = [...params, limit, offset]
    const dataResult = await query(
      `SELECT * FROM archive ${where} ORDER BY "createdAt" DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    )

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM archive ${where}`,
      params
    )

    const total = parseInt((countResult.rows[0] as Record<string, unknown>).total as string, 10)

    res.json({
      items: dataResult.rows.map((r) => serializeArchiveRow(r as Record<string, unknown>)),
      total,
      limit,
      offset,
    })
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /entities/:entityType/:entityId/history/:key  (must be registered before /:entityType/:entityId)
// ---------------------------------------------------------------------------

/**
 * Maps raw archivedReason codes to human-readable labels before they reach the frontend.
 * Unknown codes fall back to the raw code with an "(unknown reason)" suffix so that
 * undocumented values in production data do not silently vanish or break the UI.
 */
const ARCHIVED_REASON_LABELS: Record<string, string> = {
  superseded: 'Superseded by newer write',
  contradicted: 'Contradicted by conflicting source',
  expired: 'Expired (validUntil passed)',
  decayed: 'Decayed by Archivist',
}

function labelArchivedReason(raw: string | null): string | null {
  if (raw == null) return null
  return ARCHIVED_REASON_LABELS[raw] ?? `${raw} (unknown reason)`
}

kbRouter.get(
  '/entities/:entityType/:entityId/history/:key',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { entityType, entityId, key } = req.params

      // Run KB and archive queries in parallel for this entity+key.
      // Keeping them separate lets us distinguish "current" from "archived" intervals
      // cleanly and satisfy the { current, history, hasHistory } contract required by
      // CP-T030 without relying on a source discriminator column.
      const [kbResult, archiveResult] = await Promise.all([
        query(
          `SELECT
            id::text                AS id,
            "valueSummary",
            "valueRaw",
            confidence,
            "agentId",
            source                  AS "providerSource",
            "validFrom",
            "validUntil",
            "createdAt"
          FROM knowledge_base
          WHERE "entityType" = $1 AND "entityId" = $2 AND key = $3
          LIMIT 1`,
          [entityType, entityId, key]
        ),
        query(
          `SELECT
            id::text                AS id,
            "valueSummary",
            "valueRaw",
            confidence,
            "agentId",
            source                  AS "providerSource",
            "validFrom",
            "validUntil",
            "archivedAt",
            "archivedReason",
            "supersededBy"::text    AS "supersededBy",
            "resolutionState",
            "conflictLog",
            "createdAt"
          FROM archive
          WHERE "entityType" = $1 AND "entityId" = $2 AND key = $3
          ORDER BY "validFrom" DESC NULLS LAST, "createdAt" DESC`,
          [entityType, entityId, key]
        ),
      ])

      if (kbResult.rows.length === 0 && archiveResult.rows.length === 0) {
        throw createApiError(
          `No history found for ${entityType}/${entityId}/${key}`,
          'NOT_FOUND',
          404
        )
      }

      // Serialize the current KB fact (if it exists)
      const currentRow = kbResult.rows.length > 0
        ? (kbResult.rows[0] as Record<string, unknown>)
        : null

      const current = currentRow
        ? {
            id: String(currentRow.id),
            valueSummary: (currentRow.valueSummary as string | null) ?? null,
            valueRaw: serializeFullValueRaw(currentRow.valueRaw),
            confidence: Number(currentRow.confidence ?? 0),
            agentId: (currentRow.agentId as string | null) ?? null,
            providerSource: (currentRow.providerSource as string | null) ?? null,
            validFrom: toIso(currentRow.validFrom),
            validUntil: toIso(currentRow.validUntil),
            createdAt: toIso(currentRow.createdAt) ?? new Date(0).toISOString(),
          }
        : null

      // Serialize archived intervals with human-readable archivedReason labels
      const history: HistoryInterval[] = archiveResult.rows.map((row) => {
        const r = row as Record<string, unknown>
        return {
          id: String(r.id),
          source: 'archive' as const,
          valueSummary: (r.valueSummary as string | null) ?? null,
          valueRaw: serializeFullValueRaw(r.valueRaw),
          confidence: Number(r.confidence ?? 0),
          agentId: (r.agentId as string | null) ?? null,
          providerSource: (r.providerSource as string | null) ?? null,
          validFrom: toIso(r.validFrom),
          validUntil: toIso(r.validUntil),
          archivedAt: toIso(r.archivedAt),
          archivedReason: labelArchivedReason((r.archivedReason as string | null) ?? null),
          supersededBy: (r.supersededBy as string | null) ?? null,
          resolutionState: (r.resolutionState as string | null) ?? null,
          conflictLog: (r.conflictLog as Record<string, unknown> | null) ?? null,
          createdAt: toIso(r.createdAt) ?? new Date(0).toISOString(),
        }
      })

      res.json({
        entityType,
        entityId,
        key,
        current,
        history,
        hasHistory: history.length > 0,
      })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// GET /entities/:entityType/:entityId
// ---------------------------------------------------------------------------

kbRouter.get(
  '/entities/:entityType/:entityId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { entityType, entityId } = req.params
      const includeArchived = req.query.includeArchived !== 'false'
      const includeRelationships = req.query.includeRelationships !== 'false'

      // Run all queries in parallel
      const [currentResult, archivedResult, relResult] = await Promise.all([
        query(
          `SELECT * FROM knowledge_base WHERE "entityType" = $1 AND "entityId" = $2 ORDER BY "createdAt" DESC`,
          [entityType, entityId]
        ),
        includeArchived
          ? query(
              `SELECT * FROM archive WHERE "entityType" = $1 AND "entityId" = $2 ORDER BY "validFrom" DESC NULLS LAST`,
              [entityType, entityId]
            )
          : Promise.resolve({ rows: [] }),
        includeRelationships
          ? query(
              `SELECT * FROM entity_relationships
               WHERE ("fromEntityType" = $1 AND "fromEntityId" = $2)
                  OR ("toEntityType" = $1 AND "toEntityId" = $2)
               ORDER BY "createdAt" DESC`,
              [entityType, entityId]
            )
          : Promise.resolve({ rows: [] }),
      ])

      const currentFacts = currentResult.rows.map((r) => serializeKBRow(r as Record<string, unknown>))
      const archivedFacts = archivedResult.rows.map((r) => serializeArchiveRow(r as Record<string, unknown>))
      const relationships = relResult.rows.map((r) => serializeRelationshipRow(r as Record<string, unknown>))

      if (currentFacts.length === 0 && archivedFacts.length === 0 && relationships.length === 0) {
        throw createApiError(
          `No data found for entity ${entityType}/${entityId}`,
          'NOT_FOUND',
          404
        )
      }

      // PHASE 1: entity field is always null — entities table does not exist in current Iranti schema
      res.json({
        entity: null,
        currentFacts,
        archivedFacts,
        relationships,
      })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// GET /relationships
// ---------------------------------------------------------------------------

kbRouter.get('/relationships', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit, offset } = parsePagination(
      req.query.limit as string | undefined,
      req.query.offset as string | undefined,
      50,
      500
    )

    const entityId = req.query.entityId as string | undefined
    const entityType = req.query.entityType as string | undefined
    const fromEntityId = req.query.fromEntityId as string | undefined
    const toEntityId = req.query.toEntityId as string | undefined
    const relationshipType = req.query.relationshipType as string | undefined

    const params: unknown[] = []
    const clauses: string[] = []

    // Bidirectional lookup: entityId matches either side
    // fromEntityId/toEntityId take precedence over entityId when both are provided
    if (entityId && !fromEntityId && !toEntityId) {
      if (entityType) {
        params.push(entityType, entityId)
        const pt = params.length - 1
        const pi = params.length
        clauses.push(
          `(("fromEntityType" = $${pt} AND "fromEntityId" = $${pi}) OR ("toEntityType" = $${pt} AND "toEntityId" = $${pi}))`
        )
      } else {
        params.push(entityId)
        const p = params.length
        clauses.push(`("fromEntityId" = $${p} OR "toEntityId" = $${p})`)
      }
    }

    if (fromEntityId) {
      params.push(fromEntityId)
      clauses.push(`"fromEntityId" = $${params.length}`)
    }
    if (toEntityId) {
      params.push(toEntityId)
      clauses.push(`"toEntityId" = $${params.length}`)
    }
    if (relationshipType) {
      params.push(relationshipType)
      clauses.push(`"relationshipType" = $${params.length}`)
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''

    const dataParams = [...params, limit, offset]
    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT * FROM entity_relationships ${where} ORDER BY "createdAt" DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams
      ),
      query(`SELECT COUNT(*) AS total FROM entity_relationships ${where}`, params),
    ])

    const total = parseInt((countResult.rows[0] as Record<string, unknown>).total as string, 10)

    res.json({
      items: dataResult.rows.map((r) => serializeRelationshipRow(r as Record<string, unknown>)),
      total,
      limit,
      offset,
    })
  } catch (err) {
    next(err)
  }
})

// Error handler must be last
kbRouter.use(errorHandler)
