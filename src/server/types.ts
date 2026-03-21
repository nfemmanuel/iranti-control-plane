// Shared types for the Iranti Control Plane API

export interface KBFact {
  id: string
  entityType: string
  entityId: string
  key: string
  valueSummary: string | null
  valueRaw: string | null
  valueRawTruncated: boolean
  confidence: number
  source: string | null
  agentId: string | null
  validFrom: string | null
  validUntil: string | null
  createdAt: string
  updatedAt: string | null
  stability: number | null
  lastAccessedAt: string | null
  properties: Record<string, unknown> | null
  /** Append-only array of conflict events. Typed as unknown[] because the server
   * receives this as Prisma's raw Json type. Frontend should cast to ConflictEntry[]. */
  conflictLog: unknown[] | null
}

export interface ArchiveFact {
  id: string
  entityType: string
  entityId: string
  key: string
  valueSummary: string | null
  valueRaw: string | null
  valueRawTruncated: boolean
  confidence: number
  source: string | null
  agentId: string | null
  validFrom: string | null
  validUntil: string | null
  archivedAt: string
  archivedReason: string | null
  supersededBy: string | null
  resolutionState: string | null
  resolutionNote: string | null
  properties: Record<string, unknown> | null
  /** Append-only array of conflict events. Typed as unknown[] because the server
   * receives this as Prisma's raw Json type. Frontend should cast to ConflictEntry[]. */
  conflictLog: unknown[] | null
  createdAt: string
}

export interface HistoryInterval {
  id: string
  source: 'kb' | 'archive'
  valueSummary: string | null
  valueRaw: string | null
  confidence: number
  agentId: string | null
  providerSource: string | null
  validFrom: string | null
  validUntil: string | null
  archivedAt: string | null
  /** Human-readable label — raw archive reason codes are mapped before leaving the backend. */
  archivedReason: string | null
  supersededBy: string | null
  resolutionState: string | null
  conflictLog: Record<string, unknown> | null
  createdAt: string
}

export interface Relationship {
  id: string
  fromEntityType: string
  fromEntityId: string
  toEntityType: string
  toEntityId: string
  relationshipType: string
  confidence: number | null
  source: string | null
  createdAt: string
  properties: Record<string, unknown> | null
}

export interface StaffEvent {
  eventId: string
  timestamp: string
  staffComponent: 'Librarian' | 'Attendant' | 'Archivist' | 'Resolutionist'
  actionType: string
  agentId: string
  source: string
  entityType?: string | null
  entityId?: string | null
  key?: string | null
  reason?: string | null
  level: 'audit' | 'debug'
  metadata?: Record<string, unknown> | null
}

export interface HealthCheck {
  name: string
  status: 'ok' | 'warn' | 'error'
  message: string
  detail?: Record<string, unknown>
}

export interface HealthResponse {
  overall: 'healthy' | 'degraded' | 'error'
  checks: HealthCheck[]
  checkedAt: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

// DB row to camelCase conversion utility
export function snakeToCamel(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v instanceof Date ? v.toISOString() : v,
    ])
  )
}

// Serialization helpers
const VALUE_RAW_MAX_BYTES = 4096

export function serializeValueRaw(raw: unknown): { valueRaw: string | null; valueRawTruncated: boolean } {
  if (raw == null) return { valueRaw: null, valueRawTruncated: false }
  const str = typeof raw === 'string' ? raw : JSON.stringify(raw)
  const byteLen = Buffer.byteLength(str, 'utf8')
  if (byteLen > VALUE_RAW_MAX_BYTES) {
    // Byte-accurate truncation
    const truncated = Buffer.from(str, 'utf8').slice(0, VALUE_RAW_MAX_BYTES).toString('utf8')
    return { valueRaw: truncated, valueRawTruncated: true }
  }
  return { valueRaw: str, valueRawTruncated: false }
}

export function serializeFullValueRaw(raw: unknown): string | null {
  if (raw == null) return null
  return typeof raw === 'string' ? raw : JSON.stringify(raw)
}

// API error helper
export interface ApiError extends Error {
  statusCode: number
  code: string
  detail?: Record<string, unknown>
}

export function createApiError(
  message: string,
  code: string,
  statusCode: number,
  detail?: Record<string, unknown>
): ApiError {
  const err = new Error(message) as ApiError
  err.statusCode = statusCode
  err.code = code
  if (detail) err.detail = detail
  return err
}

// Pagination helpers
export function parsePagination(
  limitStr: string | undefined,
  offsetStr: string | undefined,
  defaultLimit = 50,
  maxLimit = 500
): { limit: number; offset: number } {
  let limit = defaultLimit
  let offset = 0

  if (limitStr !== undefined) {
    const parsed = parseInt(limitStr, 10)
    if (isNaN(parsed) || parsed < 1) {
      throw createApiError(`limit must be an integer >= 1`, 'INVALID_PARAM', 400, { field: 'limit', received: limitStr })
    }
    if (parsed > maxLimit) {
      throw createApiError(`limit must be <= ${maxLimit}`, 'INVALID_PARAM', 400, { field: 'limit', received: limitStr, max: maxLimit })
    }
    limit = parsed
  }

  if (offsetStr !== undefined) {
    const parsed = parseInt(offsetStr, 10)
    if (isNaN(parsed) || parsed < 0) {
      throw createApiError(`offset must be an integer >= 0`, 'INVALID_PARAM', 400, { field: 'offset', received: offsetStr })
    }
    offset = parsed
  }

  return { limit, offset }
}
