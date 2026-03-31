/**
 * KB / Archive / Entity / Relationships / Alias routes
 *
 * Covers:
 *   GET /kb              — paginated knowledge_base browse
 *   GET /archive         — paginated archive browse
 *   GET /entities/:entityType/:entityId           — entity detail
 *   GET /entities/:entityType/:entityId/history/:key — temporal history (UNION)
 *   GET /relationships   — entity_relationships browse
 *   GET /kb/entity/:entityType/:entityId/aliases  — list aliases (CP-T061, proxy to Iranti)
 *   POST /kb/alias                                — create alias  (CP-T061, proxy to Iranti)
 *
 * PHASE 1 NOTE: The `entities` table does not exist in the current Iranti DB schema.
 * EntityRecord will always be null until a canonical entities table is added upstream.
 * See CP-T010 ticket and CP-T002 spec §Group 3.
 */

import { Router, Request, Response, NextFunction } from 'express'
import pg from 'pg'
import { query, env } from '../../db.js'
import { resolveInstanceAuthority, ResolvedInstanceAuthority } from '../../lib/instance-authority.js'
import {
  KBFact,
  ArchiveFact,
  HistoryInterval,
  AsOfQueryResult,
  Relationship,
  createApiError,
  parsePagination,
  serializeValueRaw,
  serializeFullValueRaw,
  ApiError,
} from '../../types.js'

export const kbRouter = Router()
const { Pool } = pg

interface Queryable {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<pg.QueryResult<T>>
}

async function resolveScopeFromRequest(req: Request): Promise<ResolvedInstanceAuthority | null> {
  const instanceRef = typeof req.query.instanceId === 'string' ? req.query.instanceId.trim() : ''
  if (!instanceRef) return null
  const scope = await resolveInstanceAuthority(instanceRef)
  if (!scope) {
    throw createApiError(`Instance '${instanceRef}' not found`, 'INSTANCE_NOT_FOUND', 404)
  }
  return scope
}

async function withRequestQueryable<T>(
  req: Request,
  fn: (db: Queryable, scope: ResolvedInstanceAuthority | null) => Promise<T>
): Promise<T> {
  const scope = await resolveScopeFromRequest(req)
  if (!scope) {
    return fn({ query }, null)
  }
  if (!scope.databaseUrl) {
    throw createApiError(
      `Selected instance '${scope.instanceName}' does not have a configured DATABASE_URL`,
      'DB_UNAVAILABLE',
      503
    )
  }

  const pool = new Pool({
    connectionString: scope.databaseUrl,
    max: 1,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 3000,
  })

  try {
    return await fn(pool, scope)
  } finally {
    await pool.end().catch(() => {})
  }
}

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

// ISO 8601 requires a dash-separated date prefix: YYYY-MM-DD.
// Date.parse() is too permissive (accepts "2026/01/01", "Jan 1 2026", etc.).
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/

function parseIsoDate(val: string | undefined, field: string): Date | undefined {
  if (val === undefined) return undefined
  if (!ISO_DATE_RE.test(val) || isNaN(Date.parse(val))) {
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
// Archived reason labels (used by serializeArchiveRow and history endpoint)
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
    stability: row.stability != null ? Number(row.stability) : null,
    lastAccessedAt: toIso(row.last_accessed_at ?? row.lastAccessedAt),
    properties: (row.properties as Record<string, unknown> | null) ?? null,
    conflictLog: (row.conflict_log ?? row.conflictLog) as unknown[] | null ?? null,
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
    archivedReason: labelArchivedReason((row.archived_reason ?? row.archivedReason) as string | null ?? null),
    supersededBy: row.superseded_by != null ? String(row.superseded_by) : null,
    resolutionState: (row.resolution_state ?? row.resolutionState) as string | null ?? null,
    resolutionNote: (row.resolution_note ?? row.resolutionNote) as string | null ?? null,
    properties: (row.properties as Record<string, unknown> | null) ?? null,
    conflictLog: (row.conflict_log ?? row.conflictLog) as unknown[] | null ?? null,
    createdAt: toIso(row.created_at ?? row.createdAt) ?? new Date(0).toISOString(),
  }
}

function serializeRelationshipRow(row: Record<string, unknown>): Relationship {
  return {
    id: String(row.id),
    fromEntityType: String(row.from_entity_type ?? row.fromType ?? row.fromEntityType ?? ''),
    fromEntityId: String(row.from_entity_id ?? row.fromId ?? row.fromEntityId ?? ''),
    toEntityType: String(row.to_entity_type ?? row.toType ?? row.toEntityType ?? ''),
    toEntityId: String(row.to_entity_id ?? row.toId ?? row.toEntityId ?? ''),
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
  /** When true, only return archive rows that have a corresponding archive_flags row */
  flaggedOnly?: boolean
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
  if (filters.flaggedOnly) {
    // Filter to rows that have an operator flag in the archive_flags table.
    // Uses EXISTS subquery so this degrades gracefully if the archive_flags table
    // does not exist (it will return an error surfaced through the normal error handler
    // rather than a silent empty set).
    clauses.push(`EXISTS (SELECT 1 FROM archive_flags af WHERE af.archive_id = id::text)`)
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
    await withRequestQueryable(req, async (db) => {
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

      const SORT_COLUMN_MAP: Record<string, string> = {
        updatedAt: '"updatedAt"',
        confidence: '"confidence"',
        entityType: '"entityType"',
        key: '"key"',
        source: '"source"',
      }
      const sortByRaw = req.query.sortBy as string | undefined
      const sortDirRaw = req.query.sortDir as string | undefined
      const orderByCol = (sortByRaw && SORT_COLUMN_MAP[sortByRaw]) ?? '"updatedAt"'
      const orderByDir = sortDirRaw === 'asc' ? 'ASC' : 'DESC'

      const params: unknown[] = []
      const where = buildKBWhereClause(filters, params)

      const dataParams = [...params, limit, offset]
      const dataResult = await db.query(
        `SELECT * FROM knowledge_base ${where} ORDER BY ${orderByCol} ${orderByDir} LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams
      )

      const countResult = await db.query(
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
    await withRequestQueryable(req, async (db) => {
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
        flaggedOnly: req.query.flagged === 'true',
      }

      const ARCHIVE_SORT_COLUMN_MAP: Record<string, string> = {
        updatedAt: '"updatedAt"',
        archivedAt: '"archivedAt"',
        confidence: '"confidence"',
        entityType: '"entityType"',
        key: '"key"',
        source: '"source"',
      }
      const archiveSortByRaw = req.query.sortBy as string | undefined
      const archiveSortDirRaw = req.query.sortDir as string | undefined
      const archiveOrderByCol = (archiveSortByRaw && ARCHIVE_SORT_COLUMN_MAP[archiveSortByRaw]) ?? '"archivedAt"'
      const archiveOrderByDir = archiveSortDirRaw === 'asc' ? 'ASC' : 'DESC'

      const params: unknown[] = []
      const where = buildArchiveWhereClause(filters, params)

      const dataParams = [...params, limit, offset]
      const dataResult = await db.query(
        `SELECT * FROM archive ${where} ORDER BY ${archiveOrderByCol} ${archiveOrderByDir} LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams
      )

      const countResult = await db.query(
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
    })
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /entities/:entityType/:entityId/history/:key  (must be registered before /:entityType/:entityId)
// ---------------------------------------------------------------------------

kbRouter.get(
  '/entities/:entityType/:entityId/history/:key',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await withRequestQueryable(req, async (db) => {
        const { entityType, entityId, key } = req.params

        const [kbResult, archiveResult] = await Promise.all([
          db.query(
            `SELECT
              id::text                AS id,
              "valueSummary",
              "valueRaw",
              confidence,
              "createdBy"             AS "agentId",
              source                  AS "providerSource",
              "validFrom",
              "validUntil",
              "createdAt"
            FROM knowledge_base
            WHERE "entityType" = $1 AND "entityId" = $2 AND key = $3
            LIMIT 1`,
            [entityType, entityId, key]
          ),
          db.query(
            `SELECT
              id::text                AS id,
              "valueSummary",
              "valueRaw",
              confidence,
              "createdBy"             AS "agentId",
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
      })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// GET /entities/:entityType/:entityId/relationships/graph  (CP-T032)
// Must be registered before /entities/:entityType/:entityId to prevent prefix capture.
// ---------------------------------------------------------------------------

interface GraphNode {
  entityType: string
  entityId: string
  factCount: number
  isRoot: boolean
}

interface GraphEdge {
  fromEntityType: string
  fromEntityId: string
  toEntityType: string
  toEntityId: string
  relationshipType: string
  confidence: number | null
  source: string | null
  createdBy: string | null
}

kbRouter.get(
  '/entities/:entityType/:entityId/relationships/graph',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await withRequestQueryable(req, async (db) => {
        const { entityType, entityId } = req.params

        const rawDepth = req.query.depth !== undefined ? parseInt(String(req.query.depth), 10) : 1
        const depth = isNaN(rawDepth) ? 1 : Math.min(Math.max(rawDepth, 1), 2)

        const rawLimit = req.query.limit !== undefined ? parseInt(String(req.query.limit), 10) : 50
        const perLevelLimit = isNaN(rawLimit) ? 50 : Math.min(Math.max(rawLimit, 1), 50)

        const relationshipTypesParam = req.query.relationshipTypes as string | undefined
        const typeFilter = relationshipTypesParam
          ? relationshipTypesParam.split(',').map(t => t.trim()).filter(Boolean)
          : null

        const visitedKey = (et: string, ei: string) => `${et}::${ei}`
        const visited = new Set<string>()
        visited.add(visitedKey(entityType, entityId))

        const allEdges: GraphEdge[] = []
        const allNodeKeys = new Set<string>()
        allNodeKeys.add(visitedKey(entityType, entityId))

        let truncated = false
        let frontier: Array<{ et: string; ei: string }> = [{ et: entityType, ei: entityId }]

        for (let d = 0; d < depth; d++) {
          if (frontier.length === 0) break

          const frontierParams: unknown[] = []
          const frontierConditions = frontier.map(({ et, ei }) => {
            frontierParams.push(et, ei)
            const base = frontierParams.length - 1
            return `("fromType" = $${base} AND "fromId" = $${base + 1}) OR ("toType" = $${base} AND "toId" = $${base + 1})`
          })

          const whereType = typeFilter && typeFilter.length > 0
            ? (() => {
                frontierParams.push(typeFilter)
                return ` AND "relationshipType" = ANY($${frontierParams.length}::text[])`
              })()
            : ''

          const limitParam = perLevelLimit + 1
          frontierParams.push(limitParam)
          const limitIdx = frontierParams.length

          const relResult = await db.query(
            `SELECT
              "fromType"         AS "fromEntityType",
              "fromId"           AS "fromEntityId",
              "toType"           AS "toEntityType",
              "toId"             AS "toEntityId",
              "relationshipType",
              confidence,
              source,
              "createdBy"
            FROM "EntityRelationship"
            WHERE (${frontierConditions.join(' OR ')})${whereType}
            ORDER BY "createdAt" DESC
            LIMIT $${limitIdx}`,
            frontierParams
          )

          const rows = relResult.rows as Record<string, unknown>[]

          if (rows.length > perLevelLimit) {
            truncated = true
          }

          const effectiveRows = rows.slice(0, perLevelLimit)

          const nextFrontier: Array<{ et: string; ei: string }> = []

          for (const row of effectiveRows) {
            const feType = String(row.fromEntityType ?? '')
            const feId = String(row.fromEntityId ?? '')
            const teType = String(row.toEntityType ?? '')
            const teId = String(row.toEntityId ?? '')

            const edge: GraphEdge = {
              fromEntityType: feType,
              fromEntityId: feId,
              toEntityType: teType,
              toEntityId: teId,
              relationshipType: String(row.relationshipType ?? ''),
              confidence: row.confidence != null ? Number(row.confidence) : null,
              source: (row.source as string | null) ?? null,
              createdBy: (row.createdBy as string | null) ?? null,
            }
            allEdges.push(edge)
            allNodeKeys.add(visitedKey(feType, feId))
            allNodeKeys.add(visitedKey(teType, teId))

            for (const [nt, ni] of [[feType, feId], [teType, teId]] as [string, string][]) {
              const k = visitedKey(nt, ni)
              if (!visited.has(k)) {
                visited.add(k)
                nextFrontier.push({ et: nt, ei: ni })
              }
            }
          }

          frontier = nextFrontier
        }

        const nodeEntries = Array.from(allNodeKeys).map(k => {
          const sep = k.indexOf('::')
          return { et: k.slice(0, sep), ei: k.slice(sep + 2) }
        })

        let nodes: GraphNode[]

        if (nodeEntries.length > 0) {
          const countParams: unknown[] = []
          const countConditions = nodeEntries.map(({ et, ei }) => {
            countParams.push(et, ei)
            const base = countParams.length - 1
            return `("entityType" = $${base} AND "entityId" = $${base + 1})`
          })

          const countResult = await db.query(
            `SELECT "entityType", "entityId", COUNT(*) AS cnt
             FROM knowledge_base
             WHERE ${countConditions.join(' OR ')}
             GROUP BY "entityType", "entityId"`,
            countParams
          )

          const countMap = new Map<string, number>()
          for (const row of countResult.rows as Record<string, unknown>[]) {
            countMap.set(
              visitedKey(String(row.entityType ?? ''), String(row.entityId ?? '')),
              Number(row.cnt ?? 0)
            )
          }

          nodes = nodeEntries.map(({ et, ei }) => ({
            entityType: et,
            entityId: ei,
            factCount: countMap.get(visitedKey(et, ei)) ?? 0,
            isRoot: et === entityType && ei === entityId,
          }))
        } else {
          nodes = []
        }

        res.json({
          rootEntity: { entityType, entityId },
          nodes,
          edges: allEdges,
          truncated,
        })
      })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// GET /entities/:entityType/:entityId/query/:key?asOf=<ISO>&includeExpired=true
//
// CP-T056 — Point-in-time fact query.
// Returns the fact (from KB or archive) whose validity interval contained the
// requested timestamp.  Logic mirrors Iranti's own /kb/query?asOf endpoint:
//   active candidate  = KB row where validFrom <= asOf AND (validUntil IS NULL OR validUntil > asOf)
//   archived candidate = archive row where validFrom <= asOf AND validUntil > asOf
//   (includeExpired is accepted as a param but always treated as true here since
//    this is an operator point-in-time debug tool)
//
// Must be registered before /entities/:entityType/:entityId to avoid prefix capture.
// ---------------------------------------------------------------------------

kbRouter.get(
  '/entities/:entityType/:entityId/query/:key',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await withRequestQueryable(req, async (db) => {
        const { entityType, entityId, key } = req.params
        const asOfRaw = req.query.asOf as string | undefined

        if (!asOfRaw) {
          throw createApiError('asOf query parameter is required', 'INVALID_PARAM', 400, {
            field: 'asOf',
          })
        }

        const asOfDate = parseIsoDate(asOfRaw, 'asOf')
        if (!asOfDate) {
          throw createApiError('asOf must be a valid ISO 8601 timestamp', 'INVALID_PARAM', 400, {
            field: 'asOf',
            received: asOfRaw,
          })
        }

        const asOfIso = asOfDate.toISOString()

        const kbResult = await db.query(
          `SELECT
            id::text                AS id,
            "valueSummary",
            "valueRaw",
            confidence,
            "createdBy"             AS "agentId",
            source                  AS "providerSource",
            "validFrom",
            "validUntil",
            "createdAt"
          FROM knowledge_base
          WHERE "entityType" = $1
            AND "entityId"   = $2
            AND key          = $3
            AND ("validFrom" IS NULL OR "validFrom" <= $4)
            AND ("validUntil" IS NULL OR "validUntil" > $4)
          ORDER BY "validFrom" DESC NULLS LAST
          LIMIT 1`,
          [entityType, entityId, key, asOfIso]
        )

        if (kbResult.rows.length > 0) {
          const r = kbResult.rows[0] as Record<string, unknown>
          const fact: HistoryInterval = {
            id: String(r.id),
            source: 'kb',
            valueSummary: (r.valueSummary as string | null) ?? null,
            valueRaw: serializeFullValueRaw(r.valueRaw),
            confidence: Number(r.confidence ?? 0),
            agentId: (r.agentId as string | null) ?? null,
            providerSource: (r.providerSource as string | null) ?? null,
            validFrom: toIso(r.validFrom),
            validUntil: toIso(r.validUntil),
            archivedAt: null,
            archivedReason: null,
            supersededBy: null,
            resolutionState: null,
            conflictLog: null,
            createdAt: toIso(r.createdAt) ?? new Date(0).toISOString(),
          }
          const result: AsOfQueryResult = { entityType, entityId, key, asOf: asOfIso, fact }
          res.json(result)
          return
        }

        const archiveResult = await db.query(
          `SELECT
            id::text                AS id,
            "valueSummary",
            "valueRaw",
            confidence,
            "createdBy"             AS "agentId",
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
          WHERE "entityType" = $1
            AND "entityId"   = $2
            AND key          = $3
            AND ("validFrom" IS NULL OR "validFrom" <= $4)
            AND "validUntil" IS NOT NULL
            AND "validUntil" > $4
          ORDER BY "validFrom" DESC NULLS LAST
          LIMIT 1`,
          [entityType, entityId, key, asOfIso]
        )

        if (archiveResult.rows.length > 0) {
          const r = archiveResult.rows[0] as Record<string, unknown>
          const fact: HistoryInterval = {
            id: String(r.id),
            source: 'archive',
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
          const result: AsOfQueryResult = { entityType, entityId, key, asOf: asOfIso, fact }
          res.json(result)
          return
        }

        const result: AsOfQueryResult = { entityType, entityId, key, asOf: asOfIso, fact: null }
        res.json(result)
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
      await withRequestQueryable(req, async (db) => {
        const { entityType, entityId } = req.params
        const includeArchived = req.query.includeArchived !== 'false'
        const includeRelationships = req.query.includeRelationships !== 'false'

        const [currentResult, archivedResult, relResult] = await Promise.all([
          db.query(
            `SELECT * FROM knowledge_base WHERE "entityType" = $1 AND "entityId" = $2 ORDER BY "createdAt" DESC`,
            [entityType, entityId]
          ),
          includeArchived
            ? db.query(
                `SELECT * FROM archive WHERE "entityType" = $1 AND "entityId" = $2 ORDER BY "validFrom" DESC NULLS LAST`,
                [entityType, entityId]
              )
            : Promise.resolve({ rows: [] }),
          includeRelationships
            ? db.query(
                `SELECT * FROM "EntityRelationship"
                 WHERE ("fromType" = $1 AND "fromId" = $2)
                    OR ("toType" = $1 AND "toId" = $2)
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

        res.json({
          entity: null,
          currentFacts,
          archivedFacts,
          relationships,
        })
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
    await withRequestQueryable(req, async (db) => {
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

      if (entityId && !fromEntityId && !toEntityId) {
        if (entityType) {
          params.push(entityType, entityId)
          const pt = params.length - 1
          const pi = params.length
          clauses.push(
            `(("fromType" = $${pt} AND "fromId" = $${pi}) OR ("toType" = $${pt} AND "toId" = $${pi}))`
          )
        } else {
          params.push(entityId)
          const p = params.length
          clauses.push(`("fromId" = $${p} OR "toId" = $${p})`)
        }
      }

      if (fromEntityId) {
        params.push(fromEntityId)
        clauses.push(`"fromId" = $${params.length}`)
      }
      if (toEntityId) {
        params.push(toEntityId)
        clauses.push(`"toId" = $${params.length}`)
      }
      if (relationshipType) {
        params.push(relationshipType)
        clauses.push(`"relationshipType" = $${params.length}`)
      }

      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''

      const dataParams = [...params, limit, offset]
      const [dataResult, countResult] = await Promise.all([
        db.query(
          `SELECT * FROM "EntityRelationship" ${where} ORDER BY "createdAt" DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
          dataParams
        ),
        db.query(`SELECT COUNT(*) AS total FROM "EntityRelationship" ${where}`, params),
      ])

      const total = parseInt((countResult.rows[0] as Record<string, unknown>).total as string, 10)

      res.json({
        items: dataResult.rows.map((r) => serializeRelationshipRow(r as Record<string, unknown>)),
        total,
        limit,
        offset,
      })
    })
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// CP-T061 — Entity Alias proxy routes
//
// These two routes proxy Iranti's alias API to the control plane.
// They sit here in kb.ts because aliases are a KB-layer concept and the
// existing KB proxy pattern (buildHeaders, env resolution) is already established
// in whoknows.ts — we replicate the same lightweight helper approach here.
//
// Iranti API shapes (confirmed against v0.2.15):
//
//   GET /kb/entity/:entityType/:entityId/aliases
//     Response: {
//       canonicalEntity: string,
//       aliases: Array<{ alias: string, aliasNorm: string, source: string,
//                        confidence: number, createdAt: string }>
//     }
//
//   POST /kb/alias
//     Body:    { canonicalEntity: string, alias: string, source?: string,
//                confidence?: number, force?: boolean }
//     Success: 200 { ok: true, canonicalEntity: string, aliasNormalized: string, created: boolean }
//     Error:   400 { error: string }  (bad entity, validation failure, etc.)
// ---------------------------------------------------------------------------

function getIrantiBaseUrl(scope: ResolvedInstanceAuthority | null): string {
  return (scope?.apiBaseUrl ?? env['IRANTI_URL'] ?? process.env['IRANTI_URL'] ?? 'http://localhost:3001').replace(/\/$/, '')
}

function getIrantiApiKey(scope: ResolvedInstanceAuthority | null): string {
  return scope?.apiKey ?? env['IRANTI_API_KEY'] ?? process.env['IRANTI_API_KEY'] ?? ''
}

function buildIrantiHeaders(req: Request, scope: ResolvedInstanceAuthority | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const incomingKey = req.headers['x-iranti-key']
  const apiKey = typeof incomingKey === 'string' && incomingKey.trim()
    ? incomingKey
    : getIrantiApiKey(scope)
  if (apiKey) headers['X-Iranti-Key'] = apiKey
  return headers
}

// ---------------------------------------------------------------------------
// Alias types
// ---------------------------------------------------------------------------

interface IrantiAliasEntry {
  alias: string
  aliasNorm: string
  source: string
  confidence: number
  createdAt: string
}

interface AliasListResponse {
  canonicalEntity: string
  aliases: IrantiAliasEntry[]
  total: number
}

interface AliasCreateRequest {
  canonicalEntity: string
  alias: string
  source?: string
  confidence?: number
  force?: boolean
}

interface AliasCreateResponse {
  ok: boolean
  canonicalEntity: string
  aliasNormalized: string
  created: boolean
}

// ---------------------------------------------------------------------------
// GET /kb/entity/:entityType/:entityId/aliases  (CP-T061 AC-1)
//
// Note: must be registered before any route with the same prefix that could
// match — in practice the existing KB routes mount on /entities/..., not
// /kb/entity/..., so there is no conflict.
// ---------------------------------------------------------------------------

kbRouter.get(
  '/kb/entity/:entityType/:entityId/aliases',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { entityType, entityId } = req.params
      const scope = await resolveScopeFromRequest(req)
      const baseUrl = getIrantiBaseUrl(scope)
      const upstreamUrl = `${baseUrl}/kb/entity/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/aliases`

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8000)

      let irantiRes: globalThis.Response
      try {
        irantiRes = await fetch(upstreamUrl, {
          method: 'GET',
          headers: buildIrantiHeaders(req, scope),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutId)
      }

      if (irantiRes.status === 401 || irantiRes.status === 403) {
        res.status(503).json({
          error: 'Iranti kb:read scope required to list aliases',
          code: 'ALIASES_UNAVAILABLE',
        })
        return
      }

      if (irantiRes.status === 404) {
        // Entity has no aliases — return empty list (not an error)
        const response: AliasListResponse = {
          canonicalEntity: `${entityType}/${entityId}`,
          aliases: [],
          total: 0,
        }
        res.json(response)
        return
      }

      if (!irantiRes.ok) {
        res.status(503).json({
          error: `Iranti alias endpoint returned unexpected status ${irantiRes.status}`,
          code: 'ALIASES_UNAVAILABLE',
        })
        return
      }

      const body = await irantiRes.json() as unknown

      // Normalize: Iranti returns { canonicalEntity, aliases: [...] }
      let canonicalEntity = `${entityType}/${entityId}`
      let aliases: IrantiAliasEntry[] = []

      if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
        const raw = body as Record<string, unknown>
        if (typeof raw['canonicalEntity'] === 'string') {
          canonicalEntity = raw['canonicalEntity']
        }
        if (Array.isArray(raw['aliases'])) {
          aliases = (raw['aliases'] as unknown[]).map((item): IrantiAliasEntry => {
            const a = item as Record<string, unknown>
            return {
              alias: String(a['alias'] ?? ''),
              aliasNorm: String(a['aliasNorm'] ?? a['alias'] ?? ''),
              source: String(a['source'] ?? ''),
              confidence: Number(a['confidence'] ?? 0),
              createdAt: String(a['createdAt'] ?? ''),
            }
          })
        }
      } else if (Array.isArray(body)) {
        // Defensive: if Iranti returns a bare array, wrap it
        aliases = (body as unknown[]).map((item): IrantiAliasEntry => {
          const a = (item ?? {}) as Record<string, unknown>
          return {
            alias: String(a['alias'] ?? ''),
            aliasNorm: String(a['aliasNorm'] ?? a['alias'] ?? ''),
            source: String(a['source'] ?? ''),
            confidence: Number(a['confidence'] ?? 0),
            createdAt: String(a['createdAt'] ?? ''),
          }
        })
      }

      const response: AliasListResponse = { canonicalEntity, aliases, total: aliases.length }
      res.json(response)
    } catch (err: unknown) {
      const name = (err as Error)?.name
      if (name === 'AbortError' || name === 'TypeError') {
        res.status(503).json({
          error: 'Iranti instance unreachable for alias lookup',
          code: 'ALIASES_UNAVAILABLE',
        })
        return
      }
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// POST /kb/alias  (CP-T061 AC-2)
//
// Proxies POST /kb/alias on Iranti.
//
// Request body:
//   { canonicalEntity: string, alias: string, source?: string,
//     confidence?: number, force?: boolean }
//
// Success: 201 { ok, canonicalEntity, aliasNormalized, created }
// 400: bad entity / validation failure (passthrough from Iranti)
// 503: Iranti unreachable or auth failure
// ---------------------------------------------------------------------------

kbRouter.post(
  '/kb/alias',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { canonicalEntity, alias, source, confidence, force } = req.body as Partial<AliasCreateRequest>
      const scope = await resolveScopeFromRequest(req)

      if (!canonicalEntity || typeof canonicalEntity !== 'string' || !canonicalEntity.trim()) {
        res.status(400).json({
          error: 'canonicalEntity is required and must be a non-empty string (e.g. "user/alice")',
          code: 'INVALID_REQUEST',
        })
        return
      }

      if (!alias || typeof alias !== 'string' || !alias.trim()) {
        res.status(400).json({
          error: 'alias is required and must be a non-empty string',
          code: 'INVALID_REQUEST',
        })
        return
      }

      const upstreamBody: AliasCreateRequest = {
        canonicalEntity: canonicalEntity.trim(),
        alias: alias.trim(),
      }
      if (typeof source === 'string' && source.trim()) upstreamBody.source = source.trim()
      if (typeof confidence === 'number') upstreamBody.confidence = confidence
      if (typeof force === 'boolean') upstreamBody.force = force

      const baseUrl = getIrantiBaseUrl(scope)
      const upstreamUrl = `${baseUrl}/kb/alias`

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8000)

      let irantiRes: globalThis.Response
      try {
        irantiRes = await fetch(upstreamUrl, {
          method: 'POST',
          headers: buildIrantiHeaders(req, scope),
          body: JSON.stringify(upstreamBody),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutId)
      }

      // Iranti 400 → passthrough with 400 (bad entity, validation error)
      if (irantiRes.status === 400) {
        const errBody = await irantiRes.json() as Record<string, unknown>
        res.status(400).json({
          error: typeof errBody['error'] === 'string' ? errBody['error'] : 'Invalid alias request',
          code: 'ALIAS_CREATE_INVALID',
        })
        return
      }

      // Auth failures
      if (irantiRes.status === 401 || irantiRes.status === 403) {
        res.status(503).json({
          error: 'Iranti kb:write scope required to create aliases',
          code: 'ALIASES_UNAVAILABLE',
        })
        return
      }

      if (!irantiRes.ok) {
        res.status(503).json({
          error: `Iranti alias create endpoint returned unexpected status ${irantiRes.status}`,
          code: 'ALIASES_UNAVAILABLE',
        })
        return
      }

      const body = await irantiRes.json() as Record<string, unknown>
      const response: AliasCreateResponse = {
        ok: Boolean(body['ok'] ?? true),
        canonicalEntity: String(body['canonicalEntity'] ?? canonicalEntity),
        aliasNormalized: String(body['aliasNormalized'] ?? alias),
        created: Boolean(body['created'] ?? true),
      }

      res.status(201).json(response)
    } catch (err: unknown) {
      const name = (err as Error)?.name
      if (name === 'AbortError' || name === 'TypeError') {
        res.status(503).json({
          error: 'Iranti instance unreachable for alias creation',
          code: 'ALIASES_UNAVAILABLE',
        })
        return
      }
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// GET /kb/search — CP-T066
//
// Proxy to Iranti's GET /kb/search (hybrid lexical+vector search).
// Required: query
// Optional: limit (default 20, cap 50), entityType, minScore
// Does NOT forward lexicalWeight / vectorWeight — let Iranti use defaults.
// ---------------------------------------------------------------------------

kbRouter.get('/kb/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const queryParam = req.query.query as string | undefined
    if (!queryParam || queryParam.trim() === '') {
      res.status(400).json({
        error: 'MISSING_QUERY',
        message: 'query parameter is required',
      })
      return
    }

    const rawLimit = parseInt((req.query.limit as string | undefined) ?? '20', 10)
    const limit = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 50)

    const entityType = req.query.entityType as string | undefined
    const minScore = req.query.minScore as string | undefined

    const upstreamParams = new URLSearchParams()
    upstreamParams.set('query', queryParam)
    upstreamParams.set('limit', String(limit))
    if (entityType) upstreamParams.set('entityType', entityType)
    if (minScore) upstreamParams.set('minScore', minScore)

    const scope = await resolveScopeFromRequest(req)
    const baseUrl = getIrantiBaseUrl(scope)
    const upstreamUrl = `${baseUrl}/kb/search?${upstreamParams.toString()}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    let irantiRes: globalThis.Response
    try {
      irantiRes = await fetch(upstreamUrl, {
        method: 'GET',
        headers: buildIrantiHeaders(req, scope),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (irantiRes.status === 401 || irantiRes.status === 403) {
      res.status(403).json({
        error: 'SCOPE_ERROR',
        message: 'Search requires a global-scope API key.',
      })
      return
    }

    if (!irantiRes.ok) {
      res.status(502).json({
        error: 'IRANTI_ERROR',
        message: `Iranti /kb/search returned unexpected status ${irantiRes.status}`,
      })
      return
    }

    const body = await irantiRes.json() as unknown
    res.json(body)
  } catch (err: unknown) {
    const name = (err as Error)?.name
    if (name === 'AbortError' || name === 'TypeError') {
      res.status(503).json({
        error: 'IRANTI_UNAVAILABLE',
        message: 'Iranti instance unreachable.',
      })
      return
    }
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /kb/entity-types — CP-T067
//
// Returns distinct entity types in the local knowledge_base table with
// fact counts and last-updated timestamps. Direct Postgres query — no Iranti
// API call required.
// ---------------------------------------------------------------------------

interface EntityTypeSummaryRow {
  entityType: string
  factCount: string
  lastUpdatedAt: string | null
}

kbRouter.get('/kb/entity-types', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await withRequestQueryable(req, async (db) => {
      const result = await db.query<EntityTypeSummaryRow>(
        `SELECT
           "entityType",
           COUNT(*) AS "factCount",
           MAX(COALESCE("updatedAt", "createdAt")) AS "lastUpdatedAt"
         FROM knowledge_base
         GROUP BY "entityType"
         ORDER BY "factCount" DESC`
      )

      const entityTypes = result.rows.map((row) => ({
        entityType: String(row.entityType),
        factCount: parseInt(String(row.factCount), 10),
        lastUpdatedAt: row.lastUpdatedAt != null ? toIso(row.lastUpdatedAt) : null,
      }))

      res.json({
        entityTypes,
        total: entityTypes.length,
      })
    })
  } catch (err) {
    next(err)
  }
})

// Error handler must be last
kbRouter.use(errorHandler)
