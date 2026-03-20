# CP-T010 Implementation Plan — KB / Archive / Entity / Relationships API

**Ticket**: CP-T010
**Spec**: CP-T002 Groups 1–4
**Author**: backend_developer
**Date**: 2026-03-20
**Status**: Plan — ready for implementation

---

## 1. Architecture Fit

### 1.1 Route Mounting

All five endpoints in this ticket mount under a new Express router file:

```
src/routes/control-plane/kb.ts          ← GET /api/control-plane/kb
src/routes/control-plane/archive.ts     ← GET /api/control-plane/archive
src/routes/control-plane/entities.ts    ← GET /api/control-plane/entities/:entityType/:entityId
                                          GET /api/control-plane/entities/:entityType/:entityId/history/:key
src/routes/control-plane/relationships.ts ← GET /api/control-plane/relationships
```

A barrel file at `src/routes/control-plane/index.ts` registers all sub-routers and exports a single `controlPlaneRouter`. The main Express app mounts it at `/api/control-plane`:

```typescript
// src/app.ts (or wherever the main Express app is assembled)
import { controlPlaneRouter } from './routes/control-plane';
app.use('/api/control-plane', controlPlaneRouter);
```

**Conflict check**: The prefix `/api/control-plane/` is a new namespace with no overlap against existing Iranti routes (assumed to live at `/api/`, `/health`, `/version`, or `/mcp`). The implementer must verify this by inspecting the existing route registration in the Iranti Express app before mounting.

### 1.2 DB Query Layer

Iranti uses **Prisma v7** as its ORM (confirmed in CP-T010 ticket). All queries in this plan are written as Prisma Client calls or raw Prisma `$queryRaw` where Prisma's query builder is insufficient (e.g., UNION queries, ILIKE on JSONB).

**Prisma model field names**: Prisma maps PostgreSQL `snake_case` column names to `camelCase` model fields by default. The implementer must verify the actual Prisma schema file (`prisma/schema.prisma`) before writing field references. Assumed mappings:

| DB column (snake_case) | Prisma field (camelCase) | API response field (camelCase) |
|---|---|---|
| `entity_type` | `entityType` | `entityType` |
| `entity_id` | `entityId` | `entityId` |
| `agent_id` | `agentId` | `agentId` |
| `value_raw` | `valueRaw` | `valueRaw` |
| `valid_from` | `validFrom` | `validFrom` |
| `valid_until` | `validUntil` | `validUntil` |
| `created_at` | `createdAt` | `createdAt` |
| `updated_at` | `updatedAt` | `updatedAt` |
| `conflict_log` | `conflictLog` | `conflictLog` |
| `archived_at` | `archivedAt` | `archivedAt` |
| `archived_reason` | `archivedReason` | `archivedReason` |
| `superseded_by` | `supersededBy` | `supersededBy` |
| `resolution_state` | `resolutionState` | `resolutionState` |
| `resolution_note` | `resolutionNote` | `resolutionNote` |

Because Prisma already returns camelCase field names, the serialization layer does not need to rename fields manually — it only needs to validate that every Prisma field exists before passing through. **Flag**: If the Prisma schema uses custom `@map` annotations that differ from default conventions, re-verify against the schema file before writing the mappers.

### 1.3 Shared Error Middleware

A single error-handling middleware is registered after all control plane routes:

```typescript
// src/routes/control-plane/errorHandler.ts
import { Request, Response, NextFunction } from 'express';

interface ApiError extends Error {
  statusCode?: number;
  code?: string;
  detail?: object;
}

export function controlPlaneErrorHandler(
  err: ApiError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const statusCode = err.statusCode ?? 500;
  res.status(statusCode).json({
    error: err.message ?? 'Internal server error',
    code: err.code ?? 'INTERNAL_ERROR',
    ...(err.detail ? { detail: err.detail } : {}),
  });
}
```

Per-route handlers use a `try/catch` wrapper and call `next(err)` for all non-200 paths. A `createApiError(message, code, statusCode, detail?)` helper function produces `ApiError` instances with the correct fields set.

**DB unavailable detection**: Catch Prisma `PrismaClientKnownRequestError` and `PrismaClientInitializationError` at the middleware level and map them to `{ statusCode: 503, code: 'DB_UNAVAILABLE' }`.

---

## 2. Endpoint Implementation Details

### 2.1 `GET /api/control-plane/kb`

**Route file**: `src/routes/control-plane/kb.ts`

#### Parameter Validation

Validate all query params before constructing the DB query. Use a validation helper that returns `{ valid: true, params }` or throws an `ApiError` with `code: 'INVALID_PARAM'`.

| Parameter | Type | Validation | Error if |
|---|---|---|---|
| `entityType` | string | No constraint | — |
| `entityId` | string | No constraint | — |
| `key` | string | No constraint | — |
| `source` | string | No constraint | — |
| `createdBy` | string | No constraint | — |
| `minConfidence` | integer | Parse with `parseInt(v, 10)`. Must be in range [0, 100]. | Not an integer, or outside [0, 100] |
| `archivedReason` | string | No constraint | — |
| `search` | string | No constraint | — |
| `limit` | integer | Parse with `parseInt(v, 10)`. Default 50. Clamp: min 1, max 500. | Not an integer, or < 1, or > 500 (return 400 for > 500; do not silently clamp) |
| `offset` | integer | Parse with `parseInt(v, 10)`. Default 0. Min 0. | Not an integer, or < 0 |

**Clamping rule clarification**: `limit` that exceeds 500 returns HTTP 400 `INVALID_PARAM`. Do not silently clamp — the caller must be informed they are exceeding the limit. A value of 0 also returns 400 (limit must be at least 1). For `offset`, values < 0 return 400.

#### SQL / Prisma Query

Use Prisma's `findMany` with a dynamic `where` clause built from validated params. Also run a `count` query in parallel for pagination.

```typescript
// Build where clause incrementally
const where: Prisma.KnowledgeBaseWhereInput = {};

if (entityType)     where.entityType    = entityType;
if (entityId)       where.entityId      = entityId;
if (key)            where.key           = key;
if (source)         where.source        = source;
if (createdBy)      where.agentId       = createdBy;   // createdBy param → agentId column
if (minConfidence !== undefined) {
  where.confidence = { gte: minConfidence };
}
if (archivedReason) where.archivedReason = archivedReason;

// Full-text search: ILIKE on value_raw (cast to text) and summary
// Prisma does not natively support ILIKE on JSONB cast — use $queryRaw for the search case
// See §2.1.1 below

const [items, total] = await Promise.all([
  prisma.knowledgeBase.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  }),
  prisma.knowledgeBase.count({ where }),
]);
```

**Note on `archivedReason` on the KB table**: The CP-T010 ticket lists this as a query param for `/kb`. Verify that the `knowledge_base` table has an `archived_reason` column — this may be an archive-only field. If absent, omit this filter from the KB endpoint and document the omission.

#### 2.1.1 Full-Text Search (`search` parameter)

When `search` is present, use `$queryRaw` to issue a parameterized ILIKE against both the `summary` column and the `value_raw` JSONB column cast to text. Do not use string interpolation — use Prisma's tagged template literal syntax which handles parameterization:

```typescript
// When search param is present, override to raw query approach for the filter case
// All other filters must be AND'd in — build the WHERE clause fragment carefully

const searchTerm = `%${search}%`;  // Wildcard wrapping done here in application code, not SQL

const rawItems = await prisma.$queryRaw<KnowledgeBaseRow[]>`
  SELECT *
  FROM knowledge_base
  WHERE (
    summary    ILIKE ${searchTerm}
    OR (value_raw::text) ILIKE ${searchTerm}
    OR entity_id ILIKE ${searchTerm}
    OR key       ILIKE ${searchTerm}
  )
  ${entityType    ? Prisma.sql`AND entity_type = ${entityType}`      : Prisma.empty}
  ${entityId      ? Prisma.sql`AND entity_id   = ${entityId}`        : Prisma.empty}
  ${key           ? Prisma.sql`AND key         = ${key}`             : Prisma.empty}
  ${source        ? Prisma.sql`AND source      = ${source}`          : Prisma.empty}
  ${createdBy     ? Prisma.sql`AND agent_id    = ${createdBy}`       : Prisma.empty}
  ${minConfidence !== undefined ? Prisma.sql`AND confidence >= ${minConfidence}` : Prisma.empty}
  ORDER BY created_at DESC
  LIMIT ${limit} OFFSET ${offset}
`;

const rawCount = await prisma.$queryRaw<[{ count: bigint }]>`
  SELECT COUNT(*) as count
  FROM knowledge_base
  WHERE (
    summary ILIKE ${searchTerm}
    OR (value_raw::text) ILIKE ${searchTerm}
    OR entity_id ILIKE ${searchTerm}
    OR key ILIKE ${searchTerm}
  )
  ${entityType ? Prisma.sql`AND entity_type = ${entityType}` : Prisma.empty}
  -- ... same filter fragments
`;
const total = Number(rawCount[0].count);
```

**JSONB cast note**: `value_raw::text` casts the JSONB column to its text representation before applying ILIKE. This is valid PostgreSQL but will not leverage any index. For Phase 1 this is acceptable (ILIKE is the explicit MVP approach). Phase 2 should evaluate `pg_tsvector` or a dedicated search column.

**`Prisma.sql` tagged template safety**: When using `Prisma.sql` and `Prisma.empty` with conditional fragments, all user-supplied values are parameterized automatically by Prisma's tagged template system. Never concatenate raw strings into `Prisma.sql` — always pass them as template literal interpolations.

#### 2.1.2 Response Assembly

Map each DB row to a `KBFact` response object. The key concern is `valueRaw` truncation:

```typescript
const VALUE_RAW_MAX_BYTES = 4096;  // 4KB

function serializeKBFact(row: KnowledgeBaseRow): KBFact {
  const valueRawStr = row.valueRaw != null
    ? JSON.stringify(row.valueRaw)  // JSONB comes back as parsed object from Prisma
    : null;

  const truncated = valueRawStr != null && Buffer.byteLength(valueRawStr, 'utf8') > VALUE_RAW_MAX_BYTES;
  const valueRaw  = truncated
    ? valueRawStr.slice(0, VALUE_RAW_MAX_BYTES)  // byte-approximate truncation; use Buffer for precision if needed
    : valueRawStr;

  return {
    id:                String(row.id),      // Ensure string even if DB returns integer PK
    entityType:        row.entityType,
    entityId:          row.entityId,
    key:               row.key,
    valueSummary:      row.summary ?? null,
    valueRaw:          valueRaw,
    valueRawTruncated: truncated,
    confidence:        row.confidence,
    source:            row.source,
    agentId:           row.agentId,
    validFrom:         row.validFrom?.toISOString() ?? null,
    validUntil:        row.validUntil?.toISOString() ?? null,
    createdAt:         row.createdAt.toISOString(),
    updatedAt:         row.updatedAt?.toISOString() ?? null,
    properties:        row.properties ?? null,
    conflictLog:       row.conflictLog ?? null,
  };
}
```

**Precision note on truncation**: `String.prototype.slice` operates on UTF-16 code units, not bytes. For most ASCII-dominant JSON this is sufficient. If values may contain multi-byte Unicode (e.g., CJK characters), use `Buffer.from(valueRawStr, 'utf8').slice(0, VALUE_RAW_MAX_BYTES).toString('utf8')` for byte-accurate truncation without introducing invalid UTF-8 sequences.

#### 2.1.3 Empty Result Set

When no rows match, the handler returns:
```json
{ "items": [], "total": 0, "limit": 50, "offset": 0 }
```
This is the natural output of the query — no special case is needed as long as Prisma returns an empty array for `findMany` with no results.

---

### 2.2 `GET /api/control-plane/archive`

**Route file**: `src/routes/control-plane/archive.ts`

Identical pattern to `/kb` with these additions:

#### Additional Parameter Validation

| Parameter | Type | Validation | Error if |
|---|---|---|---|
| `resolutionState` | string | No enum constraint in Phase 1 (pass through as exact match) | — |
| `supersededBy` | string | No constraint | — |
| `archivedAfter` | string | Must be valid ISO 8601: `!isNaN(Date.parse(v))` | Invalid ISO 8601 → 400 `INVALID_PARAM` with `detail: { field: 'archivedAfter', received: v }` |
| `archivedBefore` | string | Same validation as `archivedAfter` | Same |

#### Additional Prisma `where` Clauses

```typescript
if (resolutionState) where.resolutionState = resolutionState;
if (supersededBy)    where.supersededBy    = supersededBy;
if (archivedAfter)   where.archivedAt      = { ...where.archivedAt, gt: new Date(archivedAfter) };
if (archivedBefore)  where.archivedAt      = { ...where.archivedAt, lte: new Date(archivedBefore) };
```

**Date range overlap**: If both `archivedAfter` and `archivedBefore` are provided, the spread merge above produces `{ gt: ..., lte: ... }` which is a valid Prisma range filter. Verify no overwrite occurs when only one is present (the spread pattern handles this correctly by spreading an undefined value, which is a no-op — test explicitly).

#### Response Assembly: `ArchiveFact`

```typescript
function serializeArchiveFact(row: ArchiveRow): ArchiveFact {
  const valueRawStr = row.valueRaw != null ? JSON.stringify(row.valueRaw) : null;
  const truncated   = valueRawStr != null && Buffer.byteLength(valueRawStr, 'utf8') > VALUE_RAW_MAX_BYTES;

  return {
    id:              String(row.id),
    entityType:      row.entityType,
    entityId:        row.entityId,
    key:             row.key,
    valueSummary:    row.summary ?? null,
    valueRaw:        truncated ? valueRawStr!.slice(0, VALUE_RAW_MAX_BYTES) : valueRawStr,
    valueRawTruncated: truncated,
    confidence:      row.confidence,
    source:          row.source,
    agentId:         row.agentId,
    validFrom:       row.validFrom?.toISOString() ?? null,
    validUntil:      row.validUntil?.toISOString() ?? null,
    archivedAt:      row.archivedAt.toISOString(),
    archivedReason:  row.archivedReason ?? null,
    supersededBy:    row.supersededBy != null ? String(row.supersededBy) : null,
    resolutionState: row.resolutionState ?? null,
    resolutionNote:  row.resolutionNote ?? null,
    properties:      row.properties ?? null,
    conflictLog:     row.conflictLog ?? null,
    createdAt:       row.createdAt.toISOString(),
  };
}
```

**Flag — `archivedAt` nullability**: The spec defines `archivedAt` as a non-nullable string on `ArchiveFact`. If the DB column is nullable (e.g., some rows were inserted before the column was added), use `row.archivedAt?.toISOString() ?? new Date(0).toISOString()` as a safe fallback and log a warning. Do not let `undefined.toISOString()` throw in production.

---

### 2.3 `GET /api/control-plane/entities/:entityType/:entityId`

**Route file**: `src/routes/control-plane/entities.ts`

#### Important: No `entities` Table in Phase 1

The `entities` table does not exist in the current Iranti schema. The `entity` field in `EntityDetailResponse` **must always be `null`** in Phase 1. This must be documented in the code:

```typescript
// PHASE 1 NOTE: The `entities` table does not exist in the current Iranti DB schema.
// EntityRecord will always be null until a canonical entities table is added upstream.
// See CP-T010 ticket and CP-T002 spec §Group 3 for context.
const entity = null;
```

Do not attempt a DB query for an entities table that does not exist — it will throw a Prisma error.

#### Query Parameters

| Parameter | Type | Default | Validation |
|---|---|---|---|
| `includeArchived` | boolean | `true` | Parse: `req.query.includeArchived !== 'false'` (truthy by default) |
| `includeRelationships` | boolean | `true` | Parse: `req.query.includeRelationships !== 'false'` |

#### Parallel Queries

Run all three queries in parallel using `Promise.all`. None depends on the others:

```typescript
const [currentFacts, archivedFacts, relationships] = await Promise.all([
  // Query 1: Current KB facts for this entity
  prisma.knowledgeBase.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'desc' },
  }),

  // Query 2: Archived facts for this entity (conditional)
  includeArchived
    ? prisma.archive.findMany({
        where: { entityType, entityId },
        orderBy: { validFrom: 'desc' },
      })
    : Promise.resolve([]),

  // Query 3: Relationships (conditional)
  includeRelationships
    ? prisma.entityRelationships.findMany({
        where: {
          OR: [
            { fromEntityId: entityId },
            { toEntityId: entityId },
          ],
        },
        orderBy: { createdAt: 'desc' },
      })
    : Promise.resolve([]),
]);
```

**Note on relationship query**: The relationship query here matches by `entityId` only (not `entityType`). If the schema stores `from_entity_type` and `to_entity_type`, add them to the `OR` conditions to ensure the bidirectional lookup is type-scoped:

```typescript
where: {
  OR: [
    { fromEntityType: entityType, fromEntityId: entityId },
    { toEntityType: entityType, toEntityId: entityId },
  ],
},
```

#### 404 Logic

Return 404 `NOT_FOUND` only if all three results are empty arrays:

```typescript
if (currentFacts.length === 0 && archivedFacts.length === 0 && relationships.length === 0) {
  throw createApiError(
    `No data found for entity ${entityType}/${entityId}`,
    'NOT_FOUND',
    404
  );
}
```

If at least one array is non-empty, return 200 with the partial data. Do not return 404 for an entity that has relationships but no current facts.

#### Response Assembly

```typescript
return res.json({
  entity: null,  // Phase 1: always null — no entities table
  currentFacts:   currentFacts.map(serializeKBFact),
  archivedFacts:  archivedFacts.map(serializeArchiveFact),
  relationships:  relationships.map(serializeRelationship),
});
```

`serializeKBFact` here returns full `valueRaw` (no truncation) because the entity detail endpoint is a focused view. **Wait** — the spec says full value is only on the `/history/:key` endpoint; the entity detail endpoint inherits the same truncation as the list endpoints. Apply `VALUE_RAW_MAX_BYTES` truncation on `currentFacts` and `archivedFacts` in entity detail as well. Only `/history/:key` skips truncation.

---

### 2.4 `GET /api/control-plane/entities/:entityType/:entityId/history/:key`

**Route file**: `src/routes/control-plane/entities.ts` (same file, additional route handler)

#### Query: UNION of KB and Archive

Prisma does not support SQL UNION natively. Use `$queryRaw`:

```typescript
const rows = await prisma.$queryRaw<HistoryRow[]>`
  SELECT
    id::text        AS "id",
    'kb'            AS "source",
    summary         AS "valueSummary",
    value_raw       AS "valueRaw",       -- returned as parsed JSON object by Prisma $queryRaw
    confidence,
    agent_id        AS "agentId",
    source          AS "providerSource",
    valid_from      AS "validFrom",
    valid_until     AS "validUntil",
    NULL::timestamptz AS "archivedAt",
    NULL::text      AS "archivedReason",
    NULL::text      AS "supersededBy",
    NULL::text      AS "resolutionState",
    created_at      AS "createdAt"
  FROM knowledge_base
  WHERE entity_type = ${entityType}
    AND entity_id   = ${entityId}
    AND key         = ${key}

  UNION ALL

  SELECT
    id::text        AS "id",
    'archive'       AS "source",
    summary         AS "valueSummary",
    value_raw       AS "valueRaw",
    confidence,
    agent_id        AS "agentId",
    source          AS "providerSource",
    valid_from      AS "validFrom",
    valid_until     AS "validUntil",
    archived_at     AS "archivedAt",
    archived_reason AS "archivedReason",
    superseded_by   AS "supersededBy",
    resolution_state AS "resolutionState",
    created_at      AS "createdAt"
  FROM archive
  WHERE entity_type = ${entityType}
    AND entity_id   = ${entityId}
    AND key         = ${key}

  ORDER BY "validFrom" DESC NULLS LAST, "createdAt" DESC
`;
```

**Ordering strategy**: Order by `validFrom DESC` first (facts with a known `validFrom` indicate explicit temporal intervals). For rows where `validFrom` is `NULL` (facts written without a temporal anchor), fall back to `createdAt DESC`. `NULLS LAST` ensures NULL `validFrom` rows sort after rows with explicit `validFrom` values.

**`id` cast**: If the `id` column is a `bigint` or `integer` PK, cast to `::text` in the SELECT to ensure consistent string output. Adjust if UUID.

#### Response Assembly

```typescript
function serializeHistoryInterval(row: HistoryRow): HistoryInterval {
  // No valueRaw truncation on the history endpoint — full value returned
  const valueRawStr = row.valueRaw != null
    ? (typeof row.valueRaw === 'string' ? row.valueRaw : JSON.stringify(row.valueRaw))
    : null;

  return {
    id:              row.id,
    source:          row.source as 'kb' | 'archive',
    valueSummary:    row.valueSummary ?? null,
    valueRaw:        valueRawStr,
    confidence:      row.confidence,
    agentId:         row.agentId,
    providerSource:  row.providerSource,
    validFrom:       row.validFrom ? new Date(row.validFrom).toISOString() : null,
    validUntil:      row.validUntil ? new Date(row.validUntil).toISOString() : null,
    archivedAt:      row.archivedAt ? new Date(row.archivedAt).toISOString() : null,
    archivedReason:  row.archivedReason ?? null,
    supersededBy:    row.supersededBy ?? null,
    resolutionState: row.resolutionState ?? null,
    createdAt:       new Date(row.createdAt).toISOString(),
  };
}
```

**Date handling in `$queryRaw`**: Prisma's `$queryRaw` returns `TIMESTAMPTZ` columns as JavaScript `Date` objects on most drivers. If they come back as strings (driver-dependent), the `new Date(row.validFrom)` wrapping handles both cases safely. Test this explicitly against the actual Prisma/pg driver version in use.

#### 404 Logic

```typescript
if (rows.length === 0) {
  throw createApiError(
    `No history found for ${entityType}/${entityId}/${key}`,
    'NOT_FOUND',
    404
  );
}
```

#### Full Response

```typescript
return res.json({
  entityType,
  entityId,
  key,
  intervals:      rows.map(serializeHistoryInterval),
  totalIntervals: rows.length,
});
```

---

### 2.5 `GET /api/control-plane/relationships`

**Route file**: `src/routes/control-plane/relationships.ts`

#### Parameter Validation

| Parameter | Type | Validation |
|---|---|---|
| `entityId` | string | No constraint |
| `entityType` | string | No constraint |
| `fromEntityId` | string | No constraint |
| `toEntityId` | string | No constraint |
| `relationshipType` | string | No constraint (exact match) |
| `limit` | integer | Default 50, max 500, min 1 — same rules as `/kb` |
| `offset` | integer | Default 0, min 0 |

#### Query Construction

The `entityId` parameter is a bidirectional lookup — it must match either `fromEntityId` OR `toEntityId`. Combine with other filters using AND:

```typescript
const where: Prisma.EntityRelationshipsWhereInput = {};

// Bidirectional lookup: entityId appears on either side
if (entityId) {
  where.OR = [
    { fromEntityId: entityId },
    { toEntityId: entityId },
  ];
}

// Type scope for bidirectional lookup: if entityType also provided,
// require it to match the entity's side of the relationship
if (entityId && entityType) {
  where.OR = [
    { fromEntityType: entityType, fromEntityId: entityId },
    { toEntityType: entityType, toEntityId: entityId },
  ];
}

// Directed filters (can combine with entityId OR clause)
if (fromEntityId) {
  // AND fromEntityId = ? (overrides or supplements the OR clause)
  where.fromEntityId = fromEntityId;
  // If fromEntityId is set, the OR clause from entityId becomes ambiguous.
  // Resolution: fromEntityId and toEntityId take precedence; entityId is advisory.
  // Document this precedence rule clearly.
}
if (toEntityId)          where.toEntityId           = toEntityId;
if (relationshipType)    where.relationshipType      = relationshipType;

const [items, total] = await Promise.all([
  prisma.entityRelationships.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  }),
  prisma.entityRelationships.count({ where }),
]);
```

**Precedence caveat**: If both `entityId` and `fromEntityId` are provided simultaneously, the query becomes logically ambiguous (`OR` from `entityId` combined with an `AND` on `fromEntityId`). The implementer should define precedence explicitly: `fromEntityId`/`toEntityId` take precedence over `entityId`. Document this in a code comment.

#### Response Assembly

```typescript
function serializeRelationship(row: EntityRelationshipRow): Relationship {
  return {
    id:               String(row.id),
    fromEntityType:   row.fromEntityType,
    fromEntityId:     row.fromEntityId,
    toEntityType:     row.toEntityType,
    toEntityId:       row.toEntityId,
    relationshipType: row.relationshipType,
    confidence:       row.confidence ?? null,
    source:           row.source ?? null,
    createdAt:        row.createdAt.toISOString(),
    properties:       row.properties ?? null,
  };
}

return res.json({
  items: items.map(serializeRelationship),
  total,
  limit,
  offset,
});
```

---

## 3. Shared Concerns

### 3.1 Route Registration Pattern

```typescript
// src/routes/control-plane/index.ts
import { Router } from 'express';
import { kbRouter }             from './kb';
import { archiveRouter }        from './archive';
import { entitiesRouter }       from './entities';
import { relationshipsRouter }  from './relationships';
import { controlPlaneErrorHandler } from './errorHandler';

const controlPlaneRouter = Router();

controlPlaneRouter.use('/kb',            kbRouter);
controlPlaneRouter.use('/archive',       archiveRouter);
controlPlaneRouter.use('/entities',      entitiesRouter);
controlPlaneRouter.use('/relationships', relationshipsRouter);

// Error handler must be last
controlPlaneRouter.use(controlPlaneErrorHandler);

export { controlPlaneRouter };
```

### 3.2 camelCase / snake_case Mapping Summary

All DB → API field transformations are handled in the `serialize*` functions (§2.1.2, §2.2, §2.3, §2.4, §2.5). There is no global transform middleware — transformations are explicit and per-endpoint, which keeps them auditable.

**Prisma handles the heavy lifting**: Because Prisma maps `snake_case` DB columns to `camelCase` model fields automatically (by default, without `@map` annotations), the `serialize*` functions primarily handle:
1. ISO 8601 formatting of Date objects
2. Null coalescing (`?? null`)
3. String coercion of non-string PKs (`String(row.id)`)
4. `valueRaw` truncation and truncation flag

**Exception — `$queryRaw`**: For the UNION query in `/history/:key`, Prisma returns raw column names as-is from the SQL SELECT aliases. The SQL aliases in §2.4 are therefore written in camelCase (`"agentId"`, `"validFrom"`, etc.) so no post-processing rename is needed.

### 3.3 Query Parameterization

**Invariant**: No user-supplied value is ever concatenated into a raw SQL string. All values must flow through one of:
- Prisma `findMany`/`count` with a typed `where` object (parameterized automatically by Prisma)
- `Prisma.$queryRaw` with template literal interpolation (parameterized by Prisma's tagged template)
- `Prisma.sql` fragment with template literal interpolation (same)

Prohibited patterns:
```typescript
// NEVER do this:
const raw = `SELECT * FROM knowledge_base WHERE entity_type = '${entityType}'`;
prisma.$queryRawUnsafe(raw);

// NEVER do this:
const raw = `SELECT * FROM knowledge_base WHERE entity_type = '${entityType}'`;
```

### 3.4 Performance Notes

- **`COUNT(*)` queries**: Each list endpoint runs a `count` query in parallel with the data query. For large tables (millions of rows) this adds latency. If this becomes an issue in testing, make `total` an optional field: return `null` for `total` and add a `totalApproximate: true` flag, computed from `offset + items.length + (items.length === limit ? 1 : 0)`. Flag this as a Phase 2 optimization if needed.
- **Response time target**: Under 500ms for ≤100 rows against local DB (per CP-T010 acceptance criteria). With Prisma + local PostgreSQL + no join operations, this target should be easily met.
- **Indexes**: The existing Iranti schema presumably has indexes on `entity_type`, `entity_id`, and `key` on `knowledge_base` and `archive`. Verify before assuming — a missing index on `agent_id` (mapped to `createdBy` filter) will cause a full table scan.

---

## 4. Acceptance Criteria Checklist (Pre-PM Review)

The implementer must check each item before marking CP-T010 done:

- [ ] All 5 endpoints return correct shape per CP-T002 spec, verified against spec types
- [ ] `GET /kb`: all 9 query params function; `search` ILIKE works on `value_raw::text` and `summary`
- [ ] `GET /archive`: date range filters return 400 for invalid ISO 8601 input with detail
- [ ] `GET /entities/:type/:id`: `entity` field is always `null`; code comment explains why
- [ ] `GET /entities/:type/:id/history/:key`: full `valueRaw` returned (no 4KB truncation); UNION ordering correct
- [ ] `GET /relationships`: bidirectional `entityId` lookup returns both sides
- [ ] `valueRawTruncated: true` set on list endpoints when value exceeds 4KB
- [ ] DB unavailable returns 503 `DB_UNAVAILABLE` across all endpoints
- [ ] `limit` > 500 returns 400 `INVALID_PARAM` (not silently clamped)
- [ ] `minConfidence` outside [0, 100] returns 400 `INVALID_PARAM`
- [ ] All response field names are camelCase and match CP-T002 spec exactly
- [ ] No string interpolation in any SQL query — all parameterized
- [ ] CP-T018 (QA) notified with endpoint list and test data instructions

---

## 5. Open Questions (Flagged for Implementer)

1. **Prisma model names**: Confirm that Prisma models are named `KnowledgeBase`, `Archive`, and `EntityRelationships` (or equivalent). The model name determines the `prisma.knowledgeBase.*` accessor names.
2. **`archivedReason` on `knowledge_base`**: Does this column exist on the KB table, or is it archive-only? If archive-only, remove the `archivedReason` filter from `/kb`.
3. **Primary key type**: Confirm whether `id` is UUID (`string`) or integer on `knowledge_base`, `archive`, and `entity_relationships`. This determines whether `String(row.id)` is a no-op or a necessary cast.
4. **`updatedAt` on `knowledge_base`**: Does this column exist? If not, return `null` always and document.
5. **`properties` column**: Does `knowledge_base` have a `properties` JSONB column? If not, return `null` always.
6. **`conflictLog` column**: Same question as `properties`. If absent, return `null`.
7. **`from_entity_type`/`to_entity_type` on `entity_relationships`**: Does this table store entity types on both sides, or just entity IDs? If only IDs, the type-scoped bidirectional query in §2.5 must be simplified.
