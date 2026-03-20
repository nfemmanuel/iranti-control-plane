# Control Plane Read API Surface Spec

**Spec ID**: CP-T002
**Phase**: 0
**Author**: system_architect
**Date**: 2026-03-20
**Status**: Complete — pending PM review
**Depends on**: CP-T001 (staff-event-model.md), CP-T003 (instance-metadata-aggregation.md)

---

## Overview

This spec defines the complete read-only API surface for the Iranti Control Plane. It covers all 7 endpoint groups that power Phase 1 UI (Memory Explorer, Archive Browser, Entity Detail, Instance Manager, Diagnostics, and Staff Activity Stream).

All endpoints in this spec are:
- **Read-only**: GET only. No POST, PUT, PATCH, or DELETE endpoints are specified here.
- **Local-only, no auth required for v1**: The API is served on `localhost` only. Port binding is the sole access control mechanism in v1. This is a **v1 constraint** — documented explicitly here. Any future remote or team-mode deployment will require auth tokens and must revisit this decision before shipping.
- **Namespaced under `/api/control-plane/`**: This prefix separates control plane endpoints from Iranti's existing API routes.
- **JSON responses**: All responses use `Content-Type: application/json` unless noted (event stream uses `text/event-stream`).

### Error Format

All error responses use a consistent shape:

```typescript
interface ErrorResponse {
  error: string;        // Human-readable error message
  code: string;         // Machine-readable error code (e.g. "NOT_FOUND", "INVALID_PARAM")
  detail?: object;      // Optional additional context
}
```

Common error codes used throughout: `NOT_FOUND`, `INVALID_PARAM`, `INTERNAL_ERROR`, `DB_UNAVAILABLE`.

### Backend Implementation Classification

Each endpoint is classified as:
- **Existing query**: Can be implemented against existing DB tables with standard SQL — minimal new backend logic.
- **New query required**: Requires new SQL or backend logic not present in the current Iranti codebase.
- **New infrastructure required**: Requires a new system (event table, health aggregator, filesystem reader) that does not currently exist.

This classification helps `backend_developer` estimate Phase 1 implementation effort.

---

## Endpoint Group 1: Knowledge Base Browsing

**PRD Requirement**: FR1 (Read-Only Database Browsing)

### GET /api/control-plane/kb

Returns a paginated, filterable view of the current `knowledge_base` table.

**Backend classification**: Existing query — `knowledge_base` table with WHERE clauses and LIMIT/OFFSET.

#### Query Parameters

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `entityType` | string | No | — | Filter by entity type (e.g. `ticket`, `agent`, `decision`). |
| `entityId` | string | No | — | Filter by entity ID. If provided without `entityType`, matches across all entity types. |
| `key` | string | No | — | Filter by fact key (exact match). |
| `source` | string | No | — | Filter by source label (e.g. `claude_code`, `mcp`, `api`). |
| `createdBy` | string | No | — | Filter by agent ID that created the fact (maps to `agent_id` column). |
| `minConfidence` | integer | No | — | Minimum confidence score, 0–100 inclusive. Returns facts with confidence >= this value. |
| `archivedReason` | string | No | — | Filter by `archived_reason` if the KB table carries this field. |
| `search` | string | No | — | Full-text search across `value_raw` / `summary` fields. **MVP implementation: ILIKE `%term%`.** Advanced FTS deferred to Phase 2. |
| `limit` | integer | No | 50 | Max results per page. Max allowed: 500. |
| `offset` | integer | No | 0 | Pagination offset. |

#### Response: 200 OK

```typescript
interface KBListResponse {
  items: KBFact[];
  total: number;          // Total matching rows (for pagination UI)
  limit: number;          // Echoed from request
  offset: number;         // Echoed from request
}

interface KBFact {
  id: string;                     // Row primary key (UUID or integer — confirm against schema)
  entityType: string;
  entityId: string;
  key: string;
  valueSummary: string | null;    // The `summary` column
  valueRaw: string | null;        // The raw JSON value — may be large; truncated to 4KB in list view
  valueRawTruncated: boolean;     // True if valueRaw was truncated
  confidence: number;             // 0–100
  source: string;
  agentId: string;
  validFrom: string | null;       // ISO 8601
  validUntil: string | null;      // ISO 8601, null = currently valid
  createdAt: string;              // ISO 8601
  updatedAt: string | null;       // ISO 8601
  properties: object | null;      // JSONB properties column, if present
  conflictLog: object | null;     // JSONB conflict log, if present
}
```

**Note on `valueRaw` truncation**: In the list view, `valueRaw` is truncated to 4KB to keep list responses reasonable. The full value is always available on the entity detail endpoint. `valueRawTruncated: true` signals to the UI that a "view full value" action is needed.

#### Error States

| HTTP Status | Code | Condition |
|---|---|---|
| 400 | `INVALID_PARAM` | `minConfidence` is not an integer in [0, 100]; `limit` exceeds 500 or is < 1. |
| 503 | `DB_UNAVAILABLE` | Database connection failed. |

---

## Endpoint Group 2: Archive Browsing

**PRD Requirement**: FR1 (Read-Only Database Browsing), FR2 (Temporal Fact History)

### GET /api/control-plane/archive

Returns a paginated, filterable view of the `archive` table.

**Backend classification**: Existing query — `archive` table with WHERE clauses.

#### Query Parameters

All filter params from `/api/control-plane/kb` apply, plus:

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `entityType` | string | No | — | Same as KB. |
| `entityId` | string | No | — | Same as KB. |
| `key` | string | No | — | Same as KB. |
| `source` | string | No | — | Same as KB. |
| `createdBy` | string | No | — | Same as KB. |
| `minConfidence` | integer | No | — | Same as KB. |
| `search` | string | No | — | Same as KB. |
| `archivedReason` | string | No | — | Filter by the reason the entry was archived (e.g. `superseded`, `decay`, `conflict_resolved`). |
| `resolutionState` | string | No | — | Filter by `resolution_state` column (e.g. `pending`, `resolved`, `rejected`). |
| `supersededBy` | string | No | — | Filter by the ID of the entry that superseded this one. |
| `archivedAfter` | string | No | — | ISO 8601 timestamp. Return only entries archived after this time. |
| `archivedBefore` | string | No | — | ISO 8601 timestamp. Return only entries archived before this time. |
| `limit` | integer | No | 50 | Max 500. |
| `offset` | integer | No | 0 | |

#### Response: 200 OK

```typescript
interface ArchiveListResponse {
  items: ArchiveFact[];
  total: number;
  limit: number;
  offset: number;
}

interface ArchiveFact {
  id: string;
  entityType: string;
  entityId: string;
  key: string;
  valueSummary: string | null;
  valueRaw: string | null;
  valueRawTruncated: boolean;
  confidence: number;
  source: string;
  agentId: string;
  validFrom: string | null;       // ISO 8601 — when this version was valid
  validUntil: string | null;      // ISO 8601 — when this version expired
  archivedAt: string;             // ISO 8601 — when the Archivist moved this to archive
  archivedReason: string | null;  // e.g. "superseded", "decay", "conflict_resolved"
  supersededBy: string | null;    // ID of the KB or archive entry that replaced this one
  resolutionState: string | null; // "pending" | "resolved" | "rejected" | null
  resolutionNote: string | null;
  properties: object | null;
  conflictLog: object | null;
  createdAt: string;
}
```

#### Error States

| HTTP Status | Code | Condition |
|---|---|---|
| 400 | `INVALID_PARAM` | Invalid date format for `archivedAfter`/`archivedBefore`; `limit` out of range. |
| 503 | `DB_UNAVAILABLE` | Database connection failed. |

---

## Endpoint Group 3: Entity Detail with Temporal History

**PRD Requirement**: FR1 (Read-Only Database Browsing), FR2 (Temporal Fact History)

### GET /api/control-plane/entities/:entityType/:entityId

Returns all current facts, archived facts, and relationships for a single entity. This is the primary surface for "what does Iranti currently believe about this entity?" (ER1 — fast time to clarity: under 30 seconds).

**Backend classification**: Existing query — joins across `knowledge_base`, `archive`, and `entity_relationships` with a WHERE on `entity_type` + `entity_id`.

#### Path Parameters

| Name | Type | Description |
|---|---|---|
| `entityType` | string | Entity type (e.g. `ticket`, `agent`, `decision`). |
| `entityId` | string | Entity ID. |

#### Query Parameters

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `includeArchived` | boolean | No | true | Whether to include archived facts in the response. |
| `includeRelationships` | boolean | No | true | Whether to include `entity_relationships` entries. |

#### Response: 200 OK

```typescript
interface EntityDetailResponse {
  entity: EntityRecord | null;    // From `entities` table, if it exists
  currentFacts: KBFact[];         // All current KB entries for this entity
  archivedFacts: ArchiveFact[];   // All archived entries, ordered by validFrom desc
  relationships: Relationship[];
}

interface EntityRecord {
  id: string;
  entityType: string;
  entityId: string;
  displayName: string | null;
  properties: object | null;
  createdAt: string;
  updatedAt: string | null;
}

interface Relationship {
  id: string;
  fromEntityType: string;
  fromEntityId: string;
  toEntityType: string;
  toEntityId: string;
  relationshipType: string;
  confidence: number | null;
  source: string | null;
  createdAt: string;
  properties: object | null;
}
```

**Note on temporal history**: `archivedFacts` ordered by `validFrom DESC` gives the operator a complete timeline of every version of every key for this entity. The combination of `currentFacts` (validUntil = null) and `archivedFacts` (validUntil set) provides the full bitemporal picture.

**Note on `entity` field**: If the `entities` table does not contain a row for this `entityType/entityId` (i.e., facts exist but no canonical entity record), `entity` is `null`. The response still returns all facts and relationships.

#### Error States

| HTTP Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | No KB facts, archive facts, or entity records found for this entityType/entityId combination. |
| 503 | `DB_UNAVAILABLE` | Database connection failed. |

---

### GET /api/control-plane/entities/:entityType/:entityId/history/:key

Returns the complete temporal history for a specific `entity + key` combination, spanning both the knowledge base and archive.

**Backend classification**: Existing query — union of `knowledge_base` and `archive` WHERE entity_type, entity_id, key; ordered by validFrom desc.

#### Path Parameters

| Name | Type | Description |
|---|---|---|
| `entityType` | string | Entity type. |
| `entityId` | string | Entity ID. |
| `key` | string | Fact key (e.g. `status`, `current_assignment`). |

#### Response: 200 OK

```typescript
interface KeyHistoryResponse {
  entityType: string;
  entityId: string;
  key: string;
  intervals: HistoryInterval[];   // All KB + archive entries, ordered by validFrom desc
  totalIntervals: number;
}

interface HistoryInterval {
  id: string;
  source: "kb" | "archive";       // Which table this interval came from
  valueSummary: string | null;
  valueRaw: string | null;        // Full value — no truncation on history endpoint
  confidence: number;
  agentId: string;
  providerSource: string;         // 'source' column renamed to avoid JS reserved word conflict
  validFrom: string | null;
  validUntil: string | null;
  archivedAt: string | null;      // Set for archive intervals
  archivedReason: string | null;
  supersededBy: string | null;
  resolutionState: string | null;
  createdAt: string;
}
```

**Note**: `valueRaw` is returned in full on this endpoint — no 4KB truncation — because the operator is explicitly inspecting history and may need the full value for comparison.

#### Error States

| HTTP Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | No history found for this entity+key. |
| 503 | `DB_UNAVAILABLE` | Database connection failed. |

---

## Endpoint Group 4: Entity Relationships

**PRD Requirement**: FR1 (Read-Only Database Browsing)

### GET /api/control-plane/relationships

Returns `entity_relationships` entries with optional filtering. This is the data source for a relationship graph view in Phase 1.

**Backend classification**: Existing query — `entity_relationships` table with WHERE clauses.

#### Query Parameters

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `entityId` | string | No | — | Return all relationships where fromEntityId OR toEntityId = this value. |
| `entityType` | string | No | — | Narrow the above to a specific entity type. |
| `fromEntityId` | string | No | — | Return only relationships originating from this entity ID. |
| `toEntityId` | string | No | — | Return only relationships pointing to this entity ID. |
| `relationshipType` | string | No | — | Filter by relationship type (exact match). |
| `limit` | integer | No | 50 | Max 500. |
| `offset` | integer | No | 0 | |

**Note on `entityId` vs `fromEntityId`/`toEntityId`**: Providing `entityId` returns all relationships where the entity appears in either position (bidirectional lookup). Providing `fromEntityId` or `toEntityId` constrains to a specific direction. They can be combined.

#### Response: 200 OK

```typescript
interface RelationshipListResponse {
  items: Relationship[];          // Same Relationship type as entity detail
  total: number;
  limit: number;
  offset: number;
}
```

#### Error States

| HTTP Status | Code | Condition |
|---|---|---|
| 400 | `INVALID_PARAM` | `limit` out of range. |
| 503 | `DB_UNAVAILABLE` | Database connection failed. |

---

## Endpoint Group 5: Instance and Project Metadata

**PRD Requirements**: FR4 (Instance Awareness), FR5 (Project Binding Management)

All schemas in this endpoint group are defined in full in CP-T003 (`docs/specs/instance-metadata-aggregation.md`). The endpoint descriptions here reference those schemas by name.

### GET /api/control-plane/instances

Returns metadata for all discovered Iranti instances on this host. Aggregated at request time (pull-on-request strategy per CP-T003 §2 recommendation).

**Backend classification**: New infrastructure required — filesystem read, env file parse, health endpoint check, DB query. No existing endpoint or query covers this.

#### Response: 200 OK

Returns `InstanceListResponse` as defined in CP-T003 §5.1–5.5.

```typescript
// See docs/specs/instance-metadata-aggregation.md §5 for full type definitions.
// Summary:
interface InstanceListResponse {
  instances: InstanceMetadata[];
  discoveredAt: string;
  discoverySource: "registry" | "scan" | "hybrid";
}
```

**Note on latency**: This endpoint performs I/O including a health check with a 500ms timeout. Expected response time: 50–600ms depending on instance running state. The UI should show a loading state for this endpoint.

**Note on sensitive data**: `DATABASE_URL` is never returned in raw form. Credentials are redacted. API key values are never returned — only presence (boolean).

#### Error States

| HTTP Status | Code | Condition |
|---|---|---|
| 200 | — | Always returns 200, even if instances array is empty or all instances are stopped. Individual instance errors are surfaced within each `InstanceMetadata` object. |
| 503 | `INTERNAL_ERROR` | Unrecoverable error in aggregation (e.g. registry file exists but is corrupted). Returns partial data when possible. |

---

### GET /api/control-plane/instances/:instanceId/projects

Returns the project bindings for a specific instance. Useful for the per-instance drill-down view.

**Backend classification**: New infrastructure required — same filesystem aggregation as `/instances`, filtered to a single instance.

#### Path Parameters

| Name | Type | Description |
|---|---|---|
| `instanceId` | string | The derived instance ID from `InstanceMetadata.instanceId`. |

#### Response: 200 OK

```typescript
interface InstanceProjectsResponse {
  instanceId: string;
  projects: ProjectBinding[];     // See CP-T003 §5.5 for ProjectBinding type
}
```

#### Error States

| HTTP Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | No instance found with the given `instanceId`. |
| 503 | `INTERNAL_ERROR` | Aggregation error. |

---

## Endpoint Group 6: Diagnostics and Health Summary

**PRD Requirements**: FR4 (Instance Awareness, implicitly), ER2 (Fast Time to Root Cause)

### GET /api/control-plane/health

Returns a structured health summary consolidating the checks that `iranti doctor` would run, plus additional integration and provider checks. This is designed to be the first screen a new user sees after install.

**Backend classification**: New infrastructure required — orchestrates DB reachability check, vector backend check, env file inspection, integration file checks. Some of these may overlap with existing `iranti doctor` implementation; architect recommends reusing that logic if accessible.

#### Query Parameters

None.

#### Response: 200 OK

```typescript
interface HealthSummaryResponse {
  overall: "healthy" | "degraded" | "error";
  checkedAt: string;                    // ISO 8601
  checks: HealthCheck[];
}

interface HealthCheck {
  name: string;                         // Human-readable check name (see list below)
  status: "ok" | "warn" | "error";
  message: string;                      // Short status message (e.g. "Connected", "Key missing")
  detail?: object;                      // Optional structured additional info
}
```

**Overall status logic:**
- `healthy`: all checks are `ok`
- `degraded`: at least one check is `warn`, none are `error`
- `error`: at least one check is `error`

**Required checks (minimum set):**

| Check `name` | What it tests | Possible statuses |
|---|---|---|
| `db_reachability` | Can the backend connect to PostgreSQL? | `ok` (connected), `error` (connection refused or timeout) |
| `db_schema_version` | Is the DB schema at the expected migration version? | `ok`, `warn` (behind), `error` (unknown) |
| `vector_backend` | Is the vector backend (pgvector or external) reachable and configured? | `ok`, `warn` (not configured), `error` (connection failed) |
| `anthropic_key` | Is `ANTHROPIC_API_KEY` present and non-empty in `.env.iranti`? | `ok`, `warn` (missing — no provider key present), `error` not used (missing key is a warn, not error) |
| `openai_key` | Is `OPENAI_API_KEY` present and non-empty? | `ok`, `warn` (missing) |
| `default_provider_configured` | Is `IRANTI_DEFAULT_PROVIDER` (or equivalent) set? | `ok`, `warn` (not set — will use fallback), `error` (set to unknown provider) |
| `mcp_integration` | Is `.mcp.json` present in the current project and does it include an Iranti server entry? | `ok`, `warn` (file absent or Iranti entry missing), scoped to current project if determinable |
| `claude_md_integration` | Is `CLAUDE.md` present and does it reference Iranti? | `ok`, `warn` (file absent or no reference) |
| `runtime_version` | What version of Iranti is running? | `ok` (version detected), `warn` (version not detectable) |
| `staff_events_table` | Does the `staff_events` table exist in the DB? | `ok`, `warn` (missing — event stream will not work; CP-T001 migration not applied) |

**Detail field examples:**

```json
{
  "name": "db_reachability",
  "status": "ok",
  "message": "Connected to postgresql://localhost:5432/iranti_dev",
  "detail": {
    "host": "localhost",
    "port": 5432,
    "database": "iranti_dev",
    "latencyMs": 4
  }
}
```

```json
{
  "name": "anthropic_key",
  "status": "warn",
  "message": "ANTHROPIC_API_KEY not found in .env.iranti",
  "detail": {
    "envFilePath": "/Users/nf/.iranti/.env.iranti",
    "keysPresent": ["DATABASE_URL", "PORT"]
  }
}
```

#### Error States

| HTTP Status | Code | Condition |
|---|---|---|
| 200 | — | Always returns 200, even if overall status is `error`. The HTTP status code reflects whether the health endpoint itself worked, not the health of the system. |
| 503 | `INTERNAL_ERROR` | The health aggregator itself failed (e.g. env file read threw an uncaught error). Rare — should be treated as a bug. |

---

## Endpoint Group 7: Staff Event Stream

**PRD Requirement**: FR3 (Live Staff Logs)

The event schema for this endpoint group is defined in CP-T001 (`docs/specs/staff-event-model.md`). No independent event field definitions are introduced here. All `StaffEvent` field names, types, and semantics are authoritative from that spec.

### GET /api/control-plane/events

Returns a paginated list of past Staff events from the `staff_events` table. This is the query-and-browse interface; real-time streaming is on `/events/stream`.

**Backend classification**: New infrastructure required — requires the `staff_events` table from CP-T001 §3 and associated indexes.

#### Query Parameters

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `staffComponent` | string | No | — | Filter by component: `Librarian`, `Attendant`, `Archivist`, `Resolutionist`. |
| `actionType` | string | No | — | Filter by action type (exact match, e.g. `write_created`). |
| `agentId` | string | No | — | Filter by the agent that triggered the event. |
| `entityType` | string | No | — | Filter by entity type targeted by the event. |
| `entityId` | string | No | — | Filter by entity ID targeted by the event. |
| `level` | string | No | `audit` | Filter by event level: `audit` or `debug`. Default `audit` hides debug noise unless explicitly requested. |
| `since` | string | No | — | ISO 8601 timestamp. Return only events with `timestamp > since`. |
| `until` | string | No | — | ISO 8601 timestamp. Return only events with `timestamp <= until`. |
| `limit` | integer | No | 100 | Max 1000. |
| `offset` | integer | No | 0 | |

#### Response: 200 OK

```typescript
interface EventListResponse {
  items: StaffEvent[];            // See CP-T001 for full StaffEvent type
  total: number | null;           // Total matching rows. May be null if COUNT is expensive at scale.
  limit: number;
  offset: number;
  oldestEventTimestamp: string | null;   // Timestamp of oldest event in the table (for UI "loaded from" display)
}

// StaffEvent is defined in full in docs/specs/staff-event-model.md §1
// Reproducing the minimal shape here for implementer convenience:
interface StaffEvent {
  eventId: string;
  timestamp: string;
  staffComponent: "Librarian" | "Attendant" | "Archivist" | "Resolutionist";
  actionType: string;
  agentId: string;
  source: string;
  entityType?: string | null;
  entityId?: string | null;
  key?: string | null;
  reason?: string | null;
  level: "audit" | "debug";
  metadata?: Record<string, unknown> | null;
}
```

#### Error States

| HTTP Status | Code | Condition |
|---|---|---|
| 400 | `INVALID_PARAM` | `staffComponent` not a valid enum value; `level` not `audit` or `debug`; invalid ISO 8601 for `since`/`until`; `limit` > 1000. |
| 503 | `DB_UNAVAILABLE` | Database connection failed. |
| 503 | `EVENTS_TABLE_MISSING` | `staff_events` table does not exist (CP-T001 migration not applied). Return a clear message directing the operator to apply the migration. |

---

### GET /api/control-plane/events/stream

SSE endpoint for real-time streaming of Staff events. Uses the SSE (Server-Sent Events) transport as recommended in CP-T001 §5.

**Backend classification**: New infrastructure required — SSE handler + DB polling loop. See CP-T001 §5 for the recommended implementation sketch.

#### Transport: Server-Sent Events (SSE)

- Response `Content-Type: text/event-stream`
- Response `Cache-Control: no-cache`
- Response `Connection: keep-alive`
- Events are sent as `data: {json}\n\nid: {eventId}\n\n`
- Heartbeat keep-alive comment sent every 15 seconds: `: keep-alive\n\n`
- Client reconnection: browser sends `Last-Event-ID` header; server resumes from the event with that `eventId` (inclusive cursor)

#### Query Parameters

Same as `GET /api/control-plane/events` except `offset` (not applicable to streaming):

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `staffComponent` | string | No | — | Same as events list. |
| `actionType` | string | No | — | Same. |
| `agentId` | string | No | — | Same. |
| `entityType` | string | No | — | Same. |
| `entityId` | string | No | — | Same. |
| `level` | string | No | `audit` | Same. |
| `since` | string | No | now | ISO 8601. Stream only events with `timestamp > since`. Defaults to the time the stream connection was opened (i.e., live events only, not historical replay). |

#### Server Behavior

1. On connection: validate filter params. If invalid, send an error event and close the stream.
2. On connection: if `Last-Event-ID` header is present, treat it as the cursor — resume from that `eventId`.
3. Polling interval: every 1 second, query `SELECT * FROM staff_events WHERE timestamp > :cursor [AND filters] ORDER BY timestamp ASC LIMIT 50`.
4. For each new row: emit `data: {StaffEvent JSON}\n\nid: {eventId}\n\n`.
5. If no new rows: skip (no event, just next poll).
6. Heartbeat: every 15 seconds without an event, emit `: keep-alive\n\n`.
7. On disconnect: stop polling. Resources are released.

#### Example SSE event

```
id: a3f9c2e1-84b7-4f12-9c3d-000000000001
data: {"eventId":"a3f9c2e1-84b7-4f12-9c3d-000000000001","timestamp":"2026-03-20T09:58:46.371Z","staffComponent":"Librarian","actionType":"write_created","agentId":"product_manager","source":"mcp","entityType":"ticket","entityId":"cp_t001","key":"status","reason":"No existing entry found. Created.","level":"audit","metadata":{"confidence":95}}

```

#### Error States (stream events)

If the stream encounters a fatal error after the connection is established, the server emits an error event before closing:

```
event: error
data: {"error": "Database connection lost", "code": "DB_UNAVAILABLE"}

```

---

## General Notes

### Endpoints by Implementation Effort

**Existing queries (low effort — standard SQL against existing tables):**
- `GET /api/control-plane/kb` — SELECT from `knowledge_base`
- `GET /api/control-plane/archive` — SELECT from `archive`
- `GET /api/control-plane/entities/:entityType/:entityId` — JOIN across `knowledge_base`, `archive`, `entity_relationships`
- `GET /api/control-plane/entities/:entityType/:entityId/history/:key` — UNION of `knowledge_base` and `archive` for one key
- `GET /api/control-plane/relationships` — SELECT from `entity_relationships`

**New infrastructure required (higher effort — new logic or new DB tables):**
- `GET /api/control-plane/instances` — filesystem reader, env parser, health check aggregator (see CP-T003)
- `GET /api/control-plane/instances/:instanceId/projects` — same, filtered
- `GET /api/control-plane/health` — multi-source health aggregator
- `GET /api/control-plane/events` — requires `staff_events` table from CP-T001 migration
- `GET /api/control-plane/events/stream` — requires SSE handler + polling loop + `staff_events` table

### Scope Boundaries (v1 Constraints — Explicit)

The following are out of scope for this spec and must be deferred:

1. **Write endpoints**: No POST, PUT, PATCH, or DELETE. Any mutations go through existing Iranti CLI/API pathways.
2. **Authentication**: No token-based auth in v1. Local port binding is the sole access control mechanism. **This must be revisited before any non-local deployment.**
3. **Rate limiting and caching**: Not specified. Note as implementation considerations for Phase 2.
4. **Provider credit / quota endpoints**: Deferred. FR8 is not covered in this spec — it requires a separate capability matrix per provider. Flag to PM.
5. **Conflict review endpoints**: FR10 is not in scope for this Phase 0 read API. Deferred to Phase 2.
6. **Advanced full-text search**: The `search` param on `/kb` and `/archive` uses ILIKE for MVP. Full FTS (tsvector, Elasticsearch, etc.) deferred.
7. **WebSocket alternative to SSE**: Deferred. SSE is sufficient for v1 unidirectional streaming.

### PRD Functional Requirement Coverage

| FR | Description | Covered by |
|---|---|---|
| FR1 | Read-Only Database Browsing | `/kb`, `/archive`, `/entities/:type/:id`, `/relationships` |
| FR2 | Temporal Fact History | `/entities/:type/:id`, `/entities/:type/:id/history/:key`, `/archive` |
| FR3 | Live Staff Logs | `/events`, `/events/stream` |
| FR4 | Instance Awareness | `/instances`, `/health` |
| FR5 | Project Binding Management | `/instances`, `/instances/:id/projects` |
| FR6 | Embedded Chat | Not in scope for read API spec. |
| FR7 | Provider and Model Configuration | Not in read-only scope for Phase 0. |
| FR8 | Provider Credit Visibility | Deferred — requires provider capability matrix. |
| FR9 | Installation and Setup | Not in scope for read API spec. |
| FR10 | Conflict Review | Deferred to Phase 2. |
| FR11 | Safe Mutations | All endpoints are GET-only — no mutation possible. |
| FR12 | Auditability | Satisfied by Staff events (FR3 endpoints); mutations are out of scope here. |
| FR13 | Local-First Operation | Enforced by local-only auth posture documented in this spec. |

**Note on FR6, FR7, FR8, FR9**: These are product requirements not covered by the read API spec and should be tracked as dependencies for Phase 2 specs. The PM should confirm whether any of these need a Phase 0 spec of their own.

---

## Open Questions

1. **Actual DB schema column names**: This spec uses camelCase names (e.g. `entityType`, `agentId`) following the TypeScript convention. The actual PostgreSQL column names may be `snake_case` (e.g. `entity_type`, `agent_id`). The backend implementation must map between them. Confirm actual column names before Phase 1 implementation.

2. **`knowledge_base` primary key type**: Assumed to be UUID. If it is a sequential integer, the `id` field type in `KBFact` should be `number`, not `string`. Confirm against the DB schema.

3. **`entities` table existence**: This spec assumes a separate `entities` table. If Iranti stores all entity metadata in `knowledge_base` with a convention (e.g., `key = "_meta"`), the `EntityRecord` type and entity detail endpoint must be adjusted. Flag to PM.

4. **`entity_aliases` table**: The PRD lists `entity_aliases` as a data source. It is not covered in this spec because its shape and query patterns are unknown. If it is needed for the Memory Explorer view, a follow-on spec is required before Phase 1 implementation.

5. **FR8 (Provider Credit Visibility)**: This is a Must Have / Should Have item in the MVP backlog but is deferred here. The PM should confirm whether FR8 needs a Phase 0 spec or can wait for Phase 2.

6. **`staff_events` table and CP-T001 upstream changes**: This entire spec assumes the `staff_events` table exists and is populated by the upstream Iranti Staff components. If the proposed upstream changes in CP-T001 §6 are not approved or not implemented in time, the events endpoints will return empty data. The `/health` check `staff_events_table` is designed to surface this clearly to the operator.

---

## Acceptance Criteria Check

- [x] All 7 endpoint groups specified with HTTP method, path, query params, response schema, and error states.
- [x] All PRD functional requirements FR1–FR5 covered by at least one endpoint; FR6–FR10 gaps documented explicitly.
- [x] FR8 deferred with explicit note to PM.
- [x] Each endpoint classified for backend implementation effort (existing query vs new infrastructure).
- [x] Staff event stream endpoint references CP-T001 StaffEvent schema — no independent field definitions introduced.
- [x] Transport decision for event stream: SSE with DB polling — rationale documented (references CP-T001 §5).
- [x] v1 constraints (no auth, read-only) documented explicitly.
- [x] Spec is concrete enough for backend_developer and frontend_developer to implement without further design input.
- [ ] PM review: pending.

---

## Amendment — Phase 1 Entity Scope (CP-T006)

**Amendment ID**: CP-T006-A1
**Date**: 2026-03-20
**Author**: system_architect
**Spike**: docs/specs/entity-aliases-spike.md
**Status**: Pending PM acceptance

---

### Context

CP-T002 open question #4 deferred the `entity_aliases` table as unknown. This amendment resolves that open question following the CP-T006 architecture spike.

**Finding**: The running Iranti database has exactly three tables: `knowledge_base`, `archive`, `entity_relationships`. There is no `entities` table and no `entity_aliases` table in the current schema. No alias storage convention (e.g., `key = "_alias"` entries in `knowledge_base`) has been confirmed. No MCP tool or SDK method for writing aliases exists.

---

### Change 1: `entity` Field in EntityDetailResponse is Always `null` in Phase 1

**Affected endpoint**: `GET /api/control-plane/entities/:entityType/:entityId`

**Change**: The `entity: EntityRecord | null` field in `EntityDetailResponse` must be implemented as **unconditionally `null`** in Phase 1.

**Reason**: The `entities` table does not exist in the current Iranti schema. The backend must not attempt to query a non-existent table. The existing spec note ("If the `entities` table does not contain a row for this `entityType/entityId`, `entity` is `null`") already permits this — this amendment makes it a Phase 1 implementation requirement, not an edge case.

**Backend implementation instruction**: Do not include any query against an `entities` table in Phase 1. Emit `entity: null` unconditionally. When (and if) Iranti adds an `entities` table in a future release, this field can be populated without breaking the response shape.

**No schema change required.** The `EntityDetailResponse` type is unchanged:

```typescript
interface EntityDetailResponse {
  entity: EntityRecord | null;  // Always null in Phase 1 — entities table does not exist
  currentFacts: KBFact[];
  archivedFacts: ArchiveFact[];
  relationships: Relationship[];
}
```

---

### Change 2: Entity Aliases Endpoint Deferred to Phase 2+

**Affected endpoint**: `GET /api/control-plane/entities/:entityType/:entityId/aliases` (proposed, not yet in spec)

**Change**: This endpoint is **not part of Phase 1 scope**. It must not be implemented in Phase 1.

**Reason**: The `entity_aliases` table does not exist in the current Iranti schema. There is no upstream write mechanism to populate it. Building an endpoint with no data source would produce empty scaffolding.

**Deferral condition**: This endpoint may be added in a future amendment to this spec when both of the following are true:
1. Iranti has added an `entity_aliases` table to its core schema (upstream change — out of scope for this repo).
2. Iranti exposes an MCP tool or SDK method to write alias entries (upstream change — out of scope for this repo).

**When this endpoint is eventually added**, the recommended shape is:

```typescript
// GET /api/control-plane/entities/:entityType/:entityId/aliases
// Backend classification (future): Existing query against entity_aliases table
// Returns all aliases registered for the given entity.

interface EntityAliasesResponse {
  entityType: string;
  entityId: string;
  aliases: EntityAlias[];
}

interface EntityAlias {
  id: string;
  alias: string;               // The alternate name or identifier
  aliasType: string | null;    // e.g., "display_name", "external_ref", "short_code"
  source: string | null;       // Which agent or system registered this alias
  createdAt: string;           // ISO 8601
}
```

This shape is documented here as forward intent only. It is **not an active endpoint spec** and must not be implemented until the upstream table exists and a follow-on amendment formally activates it.

---

### Phase 1 Known Limitations (entity scope)

These limitations are accepted for Phase 1 and must be documented in Phase 1 release notes:

1. **No alias lookup**: Users cannot find an entity by an alternate name or identifier. Entity navigation requires knowing the exact `entityType` and `entityId`.
2. **No canonical display name**: The `EntityRecord` (which would carry `displayName`) is always `null`. Entity display in the UI uses `entityType/entityId` directly.
3. **Duplicate appearance for multi-identifier entities**: If the same real-world entity is recorded under two different `entityId` values, they will appear as two separate entities with no visible link. This is an Iranti data model limitation, not a control plane limitation.
4. **No `aliases` array in entity detail**: The `EntityDetailResponse` does not include an `aliases` field in Phase 1. The response shape is stable — when aliases are added in a future phase, `aliases: EntityAlias[]` would be additive (defaulting to `[]`), not a breaking change.

---

### Impact on Backend Developer (CP-T013 and related)

Backend developers implementing the entity detail endpoint must:

- **Do**: Query `knowledge_base`, `archive`, and `entity_relationships` for the given `entityType/entityId`.
- **Do**: Return `entity: null` unconditionally.
- **Do not**: Query any `entities` or `entity_aliases` table — they do not exist.
- **Do not**: Implement `GET /api/control-plane/entities/:entityType/:entityId/aliases` in Phase 1.

No other endpoint is affected by this amendment. All other endpoint groups in this spec are implementable as originally specified.

---

### Updated Open Questions Status

| # | Question | Status |
|---|---|---|
| OQ-3 | `entities` table existence | **Resolved**: Does not exist in current schema. `entity` field is `null` in Phase 1. |
| OQ-4 | `entity_aliases` table | **Resolved**: Does not exist. No alias mechanism confirmed. Endpoint deferred to Phase 2+. |
