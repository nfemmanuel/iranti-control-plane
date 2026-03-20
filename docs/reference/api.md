# Control Plane API Reference

All endpoints are served under the `/api/control-plane/` namespace. All responses use `Content-Type: application/json` unless noted.

**Base URL (local development — server):** `http://localhost:3002/api/control-plane`

**Base URL (local development — Vite dev server proxy):** Vite dev server runs at `http://localhost:5173` and proxies `/api/control-plane` to the server at `http://localhost:3002`.

**Authentication:** None in v1. The API is served on localhost only. Port binding is the sole access control mechanism.

---

## Error Format

All error responses share a consistent shape:

```json
{
  "error": "No facts or relationships found for agent/unknown_agent",
  "code": "NOT_FOUND"
}
```

```json
{
  "error": "minConfidence must be an integer between 0 and 100",
  "code": "INVALID_PARAM",
  "detail": { "param": "minConfidence", "received": "abc" }
}
```

Common error codes:

| Code | Description |
|---|---|
| `NOT_FOUND` | The requested entity, fact, or resource does not exist. |
| `INVALID_PARAM` | A query or path parameter failed validation. |
| `INTERNAL_ERROR` | An unexpected server-side error occurred. |
| `DB_UNAVAILABLE` | The database connection could not be established or was lost. |
| `EVENTS_TABLE_MISSING` | `staff_events` migration has not been applied; run `npm run migrate` |

---

## Endpoint Group 1: Knowledge Base Browsing

### GET /kb

Returns a paginated, filterable view of the current knowledge base.

#### Query Parameters

| Name | Type | Default | Description |
|---|---|---|---|
| `entityType` | string | — | Filter by entity type. Example: `agent`, `ticket`, `decision`. |
| `entityId` | string | — | Filter by entity ID. Can be used without `entityType` to match across all types. |
| `key` | string | — | Filter by fact key (exact match). Example: `current_assignment`. |
| `source` | string | — | Filter by source label. Example: `mcp`, `claude_code`, `api`. |
| `createdBy` | string | — | Filter by agent ID that wrote the fact. |
| `minConfidence` | integer | — | Minimum confidence score, inclusive. Range: 0–100. |
| `search` | string | — | Substring search across value text and summary fields. |
| `limit` | integer | 50 | Max results per page. Maximum allowed: 500. |
| `offset` | integer | 0 | Pagination offset. |

#### Response: 200 OK

```json
{
  "items": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "entityType": "ticket",
      "entityId": "cp_t013",
      "key": "status",
      "valueSummary": "Backend KB API endpoint implementation is in progress",
      "valueRaw": "{\"status\": \"in_progress\", \"startedAt\": \"2026-03-20T09:00:00Z\"}",
      "valueRawTruncated": false,
      "confidence": 90,
      "source": "mcp",
      "agentId": "backend_developer",
      "validFrom": "2026-03-20T09:00:00.000Z",
      "validUntil": null,
      "createdAt": "2026-03-20T09:00:14.331Z",
      "updatedAt": null,
      "properties": null,
      "conflictLog": null
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

**Note on `valueRaw` truncation:** In the list view, `valueRaw` is truncated at 4 KB. `valueRawTruncated: true` signals that the full value is available from the entity detail endpoint.

#### Error Responses

| HTTP Status | Code | Condition |
|---|---|---|
| 400 | `INVALID_PARAM` | `minConfidence` is not an integer in [0, 100]; `limit` is less than 1 or exceeds 500. |
| 503 | `DB_UNAVAILABLE` | Database connection failed. |

---

## Endpoint Group 2: Archive Browsing

### GET /archive

Returns a paginated, filterable view of the archive table. The archive contains facts that have been superseded, decayed, or conflict-resolved.

#### Query Parameters

All KB filter params apply, plus:

| Name | Type | Default | Description |
|---|---|---|---|
| `entityType` | string | — | Same as `/kb`. |
| `entityId` | string | — | Same as `/kb`. |
| `key` | string | — | Same as `/kb`. |
| `source` | string | — | Same as `/kb`. |
| `createdBy` | string | — | Same as `/kb`. |
| `minConfidence` | integer | — | Same as `/kb`. |
| `search` | string | — | Same as `/kb`. |
| `archivedReason` | string | — | Filter by reason: `superseded`, `decay`, `conflict_resolved`. |
| `resolutionState` | string | — | Filter by resolution state: `pending`, `resolved`, `rejected`. |
| `supersededBy` | string | — | Filter by the ID of the entry that superseded this one. |
| `archivedAfter` | string | — | ISO 8601. Return entries archived after this timestamp. |
| `archivedBefore` | string | — | ISO 8601. Return entries archived before this timestamp. |
| `limit` | integer | 50 | Max 500. |
| `offset` | integer | 0 | |

#### Response: 200 OK

```json
{
  "items": [
    {
      "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "entityType": "ticket",
      "entityId": "cp_t013",
      "key": "status",
      "valueSummary": "Backend KB API endpoint is planned but not started",
      "valueRaw": "{\"status\": \"planned\"}",
      "valueRawTruncated": false,
      "confidence": 85,
      "source": "mcp",
      "agentId": "product_manager",
      "validFrom": "2026-03-19T14:00:00.000Z",
      "validUntil": "2026-03-20T09:00:00.000Z",
      "archivedAt": "2026-03-20T09:00:14.331Z",
      "archivedReason": "superseded",
      "supersededBy": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "resolutionState": null,
      "resolutionNote": null,
      "properties": null,
      "conflictLog": null,
      "createdAt": "2026-03-19T14:00:05.112Z"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

#### Error Responses

| HTTP Status | Code | Condition |
|---|---|---|
| 400 | `INVALID_PARAM` | Invalid ISO 8601 date for `archivedAfter`/`archivedBefore`; `limit` out of range. |
| 503 | `DB_UNAVAILABLE` | Database connection failed. |

---

## Endpoint Group 3: Entity Detail with Temporal History

### GET /entities/:entityType/:entityId

Returns all current facts, archived facts, and relationships for a single entity. This is the primary endpoint for answering "what does Iranti currently believe about this entity?"

#### Path Parameters

| Name | Type | Description |
|---|---|---|
| `entityType` | string | Entity type. Example: `agent`, `ticket`, `decision`. |
| `entityId` | string | Entity ID. Example: `product_manager`, `cp_t001`. |

#### Query Parameters

| Name | Type | Default | Description |
|---|---|---|---|
| `includeArchived` | boolean | true | Whether to include archived facts in the response. |
| `includeRelationships` | boolean | true | Whether to include `entity_relationships` entries. |

#### Response: 200 OK

```json
{
  "entity": null,
  "currentFacts": [
    {
      "id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
      "entityType": "agent",
      "entityId": "product_manager",
      "key": "current_assignment",
      "valueSummary": "PM coordinating Phase 1 delivery across all specialist agents",
      "valueRaw": "{\"phase\": \"Phase 1\", \"focus\": \"roadmap, backlog, ticket quality\", \"session_started\": \"2026-03-20\"}",
      "valueRawTruncated": false,
      "confidence": 95,
      "source": "mcp",
      "agentId": "product_manager",
      "validFrom": "2026-03-20T08:00:00.000Z",
      "validUntil": null,
      "createdAt": "2026-03-20T08:00:22.881Z",
      "updatedAt": null,
      "properties": null,
      "conflictLog": null
    }
  ],
  "archivedFacts": [],
  "relationships": [
    {
      "id": "d4e5f6a7-b8c9-0123-defa-234567890123",
      "fromEntityType": "agent",
      "fromEntityId": "product_manager",
      "toEntityType": "project",
      "toEntityId": "iranti_control_plane",
      "relationshipType": "manages",
      "confidence": 95,
      "source": "mcp",
      "createdAt": "2026-03-20T08:00:22.881Z",
      "properties": null
    }
  ]
}
```

**Note on `entity` field:** Always `null` in Phase 1. The `entities` table does not exist in the current Iranti schema. This field is present in the response shape for forward compatibility — it will be populated when Iranti adds an `entities` table in a future release.

#### Error Responses

| HTTP Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | No KB facts, archive facts, or entity records found for this entityType/entityId. |
| 503 | `DB_UNAVAILABLE` | Database connection failed. |

---

### GET /entities/:entityType/:entityId/history/:key

Returns the complete temporal history for a specific `entity + key` pair, spanning both the knowledge base and archive. Values are returned in full — no 4 KB truncation.

#### Path Parameters

| Name | Type | Description |
|---|---|---|
| `entityType` | string | Entity type. |
| `entityId` | string | Entity ID. |
| `key` | string | Fact key. Example: `status`, `current_assignment`. |

#### Response: 200 OK

```json
{
  "entityType": "ticket",
  "entityId": "cp_t013",
  "key": "status",
  "intervals": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "source": "kb",
      "valueSummary": "Backend KB API endpoint implementation is in progress",
      "valueRaw": "{\"status\": \"in_progress\", \"startedAt\": \"2026-03-20T09:00:00Z\"}",
      "confidence": 90,
      "agentId": "backend_developer",
      "providerSource": "mcp",
      "validFrom": "2026-03-20T09:00:00.000Z",
      "validUntil": null,
      "archivedAt": null,
      "archivedReason": null,
      "supersededBy": null,
      "resolutionState": null,
      "createdAt": "2026-03-20T09:00:14.331Z"
    },
    {
      "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "source": "archive",
      "valueSummary": "Backend KB API endpoint is planned but not started",
      "valueRaw": "{\"status\": \"planned\"}",
      "confidence": 85,
      "agentId": "product_manager",
      "providerSource": "mcp",
      "validFrom": "2026-03-19T14:00:00.000Z",
      "validUntil": "2026-03-20T09:00:00.000Z",
      "archivedAt": "2026-03-20T09:00:14.331Z",
      "archivedReason": "superseded",
      "supersededBy": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "resolutionState": null,
      "createdAt": "2026-03-19T14:00:05.112Z"
    }
  ],
  "totalIntervals": 2
}
```

#### Error Responses

| HTTP Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | No history found for this entity+key combination. |
| 503 | `DB_UNAVAILABLE` | Database connection failed. |

---

## Endpoint Group 4: Entity Relationships

### GET /relationships

Returns `entity_relationships` entries with optional filtering. Powers the relationship graph view.

#### Query Parameters

| Name | Type | Default | Description |
|---|---|---|---|
| `entityId` | string | — | Return all relationships where `fromEntityId` OR `toEntityId` equals this value (bidirectional). |
| `entityType` | string | — | Narrows `entityId` lookup to a specific entity type. |
| `fromEntityId` | string | — | Return only relationships originating from this entity ID. |
| `toEntityId` | string | — | Return only relationships pointing to this entity ID. |
| `relationshipType` | string | — | Filter by relationship type (exact match). Example: `depends_on`, `assigned_to`. |
| `limit` | integer | 50 | Max 500. |
| `offset` | integer | 0 | |

**Note:** `entityId` performs a bidirectional lookup (either position). `fromEntityId` and `toEntityId` constrain direction. They can be combined.

#### Response: 200 OK

```json
{
  "items": [
    {
      "id": "e5f6a7b8-c9d0-1234-efab-345678901234",
      "fromEntityType": "ticket",
      "fromEntityId": "cp_t013",
      "toEntityType": "ticket",
      "toEntityId": "cp_t001",
      "relationshipType": "depends_on",
      "confidence": 95,
      "source": "mcp",
      "createdAt": "2026-03-20T08:30:00.000Z",
      "properties": null
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

#### Error Responses

| HTTP Status | Code | Condition |
|---|---|---|
| 400 | `INVALID_PARAM` | `limit` is less than 1 or exceeds 500. |
| 503 | `DB_UNAVAILABLE` | Database connection failed. |

---

## Endpoint Group 5: Instance and Project Metadata

### GET /instances

Returns metadata for all discovered Iranti instances on this host. Aggregated at request time by reading the filesystem, env files, and performing a health check against each instance's configured port.

**Note on latency:** This endpoint performs I/O including a health check with a 500ms timeout. Expected response time: 50–600ms depending on instance running state. The UI shows a loading state for this endpoint.

**Note on sensitive data:** `DATABASE_URL` credentials are always redacted. API key values are never returned — only presence (boolean).

#### Response: 200 OK

```json
{
  "instances": [
    {
      "instanceId": "a1b2c3d4",
      "runtimeRoot": "/Users/nf/.iranti",
      "database": {
        "host": "localhost",
        "port": 5432,
        "name": "iranti",
        "urlRedacted": "postgresql://***@localhost:5432/iranti"
      },
      "configuredPort": 3001,
      "runningStatus": "running",
      "runningStatusCheckedAt": "2026-03-20T10:00:00.000Z",
      "irantVersion": "1.4.2",
      "envFile": {
        "present": true,
        "path": "/Users/nf/.iranti/.env.iranti",
        "keyCompleteness": {
          "allRequiredKeysPresent": true,
          "requiredKeys": [
            { "key": "DATABASE_URL", "present": true },
            { "key": "PORT", "present": true }
          ],
          "extraProviderKeys": ["ANTHROPIC_API_KEY"]
        }
      },
      "integration": {
        "defaultProvider": "anthropic",
        "defaultModel": "claude-sonnet-4-5",
        "providerKeys": {
          "anthropic": true,
          "openai": false,
          "otherKeys": []
        },
        "providerRoutingOverrides": null
      },
      "projects": [
        {
          "projectId": "b5c6d7e8",
          "projectPath": "/Users/nf/projects/myapp",
          "projectName": "myapp",
          "projectExists": true,
          "claudeIntegration": {
            "claudeMdPresent": true,
            "claudeMdHasIrantiRef": true,
            "claudeMdError": null,
            "mcpConfigPresent": true,
            "mcpConfigHasIranti": true,
            "mcpConfigError": null
          },
          "codexIntegration": {
            "configPresent": false
          },
          "lastActiveTimestamp": "2026-03-19T22:45:00.000Z",
          "boundAt": "2026-01-15T10:00:00.000Z"
        }
      ],
      "registeredAt": "2026-01-15T10:00:00.000Z",
      "notes": null
    }
  ],
  "discoveredAt": "2026-03-20T10:00:00.000Z",
  "discoverySource": "registry"
}
```

**`runningStatus` values:**
- `running` — health check returned HTTP 200 within 500ms
- `stopped` — TCP connection refused
- `unreachable` — TCP connection timed out (>500ms)

**`discoverySource` values:**
- `registry` — instances found via `~/.iranti/instances.json`
- `scan` — registry absent; instances found by scanning candidate paths
- `hybrid` — registry used but supplemented by scan

#### Error Responses

| HTTP Status | Code | Condition |
|---|---|---|
| 200 | — | Always returns 200, even if the instances array is empty. Per-instance errors are surfaced within each object. |
| 503 | `INTERNAL_ERROR` | Unrecoverable aggregation error (e.g., registry file is corrupted). |

---

### GET /instances/:instanceId/projects

Returns project bindings for a specific instance.

#### Path Parameters

| Name | Type | Description |
|---|---|---|
| `instanceId` | string | The derived instance ID from `InstanceMetadata.instanceId`. |

#### Response: 200 OK

```json
{
  "instanceId": "a1b2c3d4",
  "projects": [
    {
      "projectId": "b5c6d7e8",
      "projectPath": "/Users/nf/projects/myapp",
      "projectName": "myapp",
      "projectExists": true,
      "claudeIntegration": {
        "claudeMdPresent": true,
        "claudeMdHasIrantiRef": true,
        "claudeMdError": null,
        "mcpConfigPresent": true,
        "mcpConfigHasIranti": true,
        "mcpConfigError": null
      },
      "codexIntegration": {
        "configPresent": false
      },
      "lastActiveTimestamp": "2026-03-19T22:45:00.000Z",
      "boundAt": "2026-01-15T10:00:00.000Z"
    }
  ]
}
```

#### Error Responses

| HTTP Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | No instance found with the given `instanceId`. |
| 503 | `INTERNAL_ERROR` | Aggregation error. |

---

## Endpoint Group 6: Diagnostics and Health Summary

### GET /health

Returns a structured health summary consolidating database reachability, schema version, provider key presence, integration file checks, and runtime state. This endpoint always returns HTTP 200 — the health status of the system is expressed in the response body, not the HTTP status code.

#### Query Parameters

None.

#### Response: 200 OK

```json
{
  "overall": "healthy",
  "checkedAt": "2026-03-20T10:00:00.000Z",
  "checks": [
    {
      "name": "db_reachability",
      "status": "ok",
      "message": "Connected to postgresql://localhost:5432/iranti",
      "detail": {
        "host": "localhost",
        "port": 5432,
        "database": "iranti",
        "latencyMs": 4
      }
    },
    {
      "name": "db_schema_version",
      "status": "ok",
      "message": "Schema at expected version"
    },
    {
      "name": "vector_backend",
      "status": "ok",
      "message": "pgvector extension available"
    },
    {
      "name": "anthropic_key",
      "status": "warn",
      "message": "ANTHROPIC_API_KEY not found in .env.iranti",
      "detail": {
        "envFilePath": "/Users/nf/.iranti/.env.iranti",
        "keysPresent": ["DATABASE_URL", "PORT"]
      }
    },
    {
      "name": "openai_key",
      "status": "warn",
      "message": "OPENAI_API_KEY not found in .env.iranti"
    },
    {
      "name": "default_provider_configured",
      "status": "warn",
      "message": "IRANTI_DEFAULT_PROVIDER not set — using built-in fallback"
    },
    {
      "name": "mcp_integration",
      "status": "ok",
      "message": "Iranti MCP server entry found in .mcp.json"
    },
    {
      "name": "claude_md_integration",
      "status": "ok",
      "message": "CLAUDE.md present with Iranti reference"
    },
    {
      "name": "runtime_version",
      "status": "ok",
      "message": "Iranti 1.4.2 detected"
    },
    {
      "name": "staff_events_table",
      "status": "ok",
      "message": "staff_events table exists"
    }
  ]
}
```

**`overall` status logic:**
- `healthy` — all checks are `ok`
- `degraded` — at least one check is `warn`, none are `error`
- `error` — at least one check is `error`

**Check names and what they test:**

| Check name | Tests |
|---|---|
| `db_reachability` | Can the backend connect to PostgreSQL? |
| `db_schema_version` | Is the DB schema at the expected migration version? |
| `vector_backend` | Is pgvector configured and reachable? |
| `anthropic_key` | Is `ANTHROPIC_API_KEY` present and non-empty in `.env.iranti`? |
| `openai_key` | Is `OPENAI_API_KEY` present and non-empty? |
| `default_provider_configured` | Is `IRANTI_DEFAULT_PROVIDER` set? |
| `mcp_integration` | Does `.mcp.json` in the current project include an Iranti server entry? |
| `claude_md_integration` | Does `CLAUDE.md` exist and reference Iranti? |
| `runtime_version` | What version of Iranti is running? |
| `staff_events_table` | Does the `staff_events` table exist in the DB? |

#### Error Responses

| HTTP Status | Code | Condition |
|---|---|---|
| 200 | — | Always 200, even when `overall` is `error`. |
| 503 | `INTERNAL_ERROR` | The health aggregator itself failed. Rare — treat as a bug. |

---

## Endpoint Group 7: Staff Event Stream

### GET /events

Returns a paginated list of past Staff events from the `staff_events` table.

#### Query Parameters

| Name | Type | Default | Description |
|---|---|---|---|
| `staffComponent` | string | — | Filter by component: `Librarian`, `Attendant`, `Archivist`, `Resolutionist`. |
| `actionType` | string | — | Filter by action type (exact match). Example: `write_created`, `entry_archived`. |
| `agentId` | string | — | Filter by the agent that triggered the event. |
| `entityType` | string | — | Filter by entity type targeted by the event. |
| `entityId` | string | — | Filter by entity ID targeted by the event. |
| `level` | string | `audit` | Event level: `audit` or `debug`. Default `audit` hides debug noise. |
| `since` | string | — | ISO 8601. Return only events with timestamp after this value. |
| `until` | string | — | ISO 8601. Return only events with timestamp at or before this value. |
| `limit` | integer | 100 | Max 1000. |
| `offset` | integer | 0 | |

#### Response: 200 OK

```json
{
  "items": [
    {
      "eventId": "a3f9c2e1-84b7-4f12-9c3d-000000000001",
      "timestamp": "2026-03-20T09:58:46.371Z",
      "staffComponent": "Librarian",
      "actionType": "write_created",
      "agentId": "product_manager",
      "source": "mcp",
      "entityType": "ticket",
      "entityId": "cp_t001",
      "key": "status",
      "reason": "No existing entry found. Created.",
      "level": "audit",
      "metadata": {
        "confidence": 95,
        "valuePreview": "{\"status\": \"completed\"}"
      }
    },
    {
      "eventId": "b4f0d3e2-95c8-5a23-0d4e-000000000002",
      "timestamp": "2026-03-20T09:57:11.004Z",
      "staffComponent": "Archivist",
      "actionType": "entry_archived",
      "agentId": "system",
      "source": "archivist",
      "entityType": "ticket",
      "entityId": "cp_t001",
      "key": "status",
      "reason": "Superseded by higher-confidence write",
      "level": "audit",
      "metadata": {
        "archivedReason": "superseded",
        "archivedFactId": "b2c3d4e5-f6a7-8901-bcde-f12345678901"
      }
    }
  ],
  "total": 2,
  "limit": 100,
  "offset": 0,
  "oldestEventTimestamp": "2026-03-20T08:00:00.000Z"
}
```

#### Error Responses

| HTTP Status | Code | Condition |
|---|---|---|
| 400 | `INVALID_PARAM` | `staffComponent` not a valid enum value; `level` not `audit` or `debug`; invalid ISO 8601 for `since`/`until`; `limit` exceeds 1000. |
| 503 | `DB_UNAVAILABLE` | Database connection failed. |
| 503 | `EVENTS_TABLE_MISSING` | The `staff_events` table does not exist. Run `npm run migrate`. |

---

### GET /events/stream

SSE endpoint for real-time streaming of Staff events. Opens a long-lived connection; new events are pushed as they are written to the `staff_events` table.

**Transport:** Server-Sent Events (SSE)
- Response `Content-Type: text/event-stream`
- Response `Cache-Control: no-cache`
- Response `Connection: keep-alive`
- Heartbeat comment every 15 seconds: `: keep-alive`
- Browser reconnects automatically using the `Last-Event-ID` header; the server resumes from that event cursor

#### Query Parameters

Same as `GET /events` except `offset` (not applicable to streaming). `since` defaults to the moment the connection was opened — live events only unless overridden.

#### Example SSE event

```
id: a3f9c2e1-84b7-4f12-9c3d-000000000001
data: {"eventId":"a3f9c2e1-84b7-4f12-9c3d-000000000001","timestamp":"2026-03-20T09:58:46.371Z","staffComponent":"Librarian","actionType":"write_created","agentId":"product_manager","source":"mcp","entityType":"ticket","entityId":"cp_t001","key":"status","reason":"No existing entry found. Created.","level":"audit","metadata":{"confidence":95}}

```

#### Fatal error event (sent before closing on unrecoverable error)

```
event: error
data: {"error": "Database connection lost", "code": "DB_UNAVAILABLE"}

```

#### Error Responses

| HTTP Status | Code | Condition |
|---|---|---|
| 400 | `INVALID_PARAM` | Invalid filter params — returned as a standard JSON error response before the SSE stream is opened. |
| 503 | `EVENTS_TABLE_MISSING` | The `staff_events` table does not exist. |

---

## v1 Scope Boundaries

The following are explicitly out of scope for the Phase 1 read-only API:

- **Write endpoints** — no POST, PUT, PATCH, or DELETE in Phase 1. Phase 2 adds targeted repair and status endpoints (see below).
- **Authentication** — no token-based auth in v1. Any non-local deployment must add auth before exposing this API.
- **Provider credit/quota endpoints** — deferred to Phase 2 (requires per-provider capability matrix).
- **Conflict review endpoints** — deferred to Phase 2.
- **Entity aliases endpoint** — deferred until the `entity_aliases` table exists in the upstream Iranti schema.
- **WebSocket alternative to SSE** — SSE is sufficient for v1 unidirectional streaming.
- **Advanced full-text search** — the `search` param uses ILIKE substring matching in v1. tsvector-based FTS is Phase 2.

---

## Phase 2 Endpoints (In Progress)

The following endpoints are part of Phase 2 and are currently in implementation. They are documented here as stubs so frontend and backend can develop against a shared contract. Response shapes may change before final acceptance.

**Phase 2 base URL:** Same as Phase 1 — `http://localhost:3002/api/control-plane`

**Authentication:** None (same as Phase 1 — localhost only).

**Confirmation requirement:** All Phase 2 endpoints that mutate files or state require `?confirm=true` as a query parameter to prevent accidental mutation from a misrouted request. Requests without `?confirm=true` return `400 CONFIRM_REQUIRED`.

---

### GET /instances/:instanceId/setup-status

*(Phase 2 — in implementation, CP-T035)*

Returns the first-run and setup completion status for a specific Iranti instance. Used by the Getting Started screen to determine which setup steps are complete or incomplete.

#### Path Parameters

| Name | Type | Description |
|---|---|---|
| `instanceId` | string | The instance ID from `InstanceMetadata.instanceId`. |

#### Response: 200 OK

```json
{
  "instanceId": "a1b2c3d4",
  "steps": [
    {
      "id": "database",
      "label": "Database connection",
      "status": "complete",
      "message": "Connected to PostgreSQL at localhost:5432/iranti. 1,204 facts in knowledge base.",
      "actionRequired": null,
      "repairAction": null
    },
    {
      "id": "provider",
      "label": "Provider configuration",
      "status": "incomplete",
      "message": "No LLM provider configured. Iranti cannot process writes without a provider key.",
      "actionRequired": "Add ANTHROPIC_API_KEY or OPENAI_API_KEY to your .env.iranti file, then restart Iranti and click Refresh.",
      "repairAction": null
    },
    {
      "id": "project_binding",
      "label": "Project binding",
      "status": "complete",
      "message": "1 project bound at /Users/nf/projects/myapp.",
      "actionRequired": null,
      "repairAction": null
    },
    {
      "id": "claude_integration",
      "label": "Claude / Codex integration",
      "status": "incomplete",
      "message": ".mcp.json not found for myapp.",
      "actionRequired": "Run `iranti setup --mcp /Users/nf/projects/myapp` or use the Repair button.",
      "repairAction": "/api/control-plane/instances/a1b2c3d4/projects/b5c6d7e8/repair/mcp-json"
    }
  ],
  "isFullyConfigured": false,
  "firstRunDetected": true
}
```

**Step IDs and their complete/incomplete conditions:**

| Step ID | Complete condition | Incomplete condition |
|---|---|---|
| `database` | DB reachable, migrations current | DB unreachable or not configured |
| `provider` | At least one provider key present and reachable | No provider key configured |
| `project_binding` | At least one project bound to this instance | No projects bound |
| `claude_integration` | `.mcp.json` present for at least one bound project | No projects have `.mcp.json` |

**`status` values:** `complete`, `incomplete`, `warning`, `not_applicable`

**`firstRunDetected`:** `true` if the instance-level setup completion flag has not been set. `false` after the user clicks "Mark setup complete" in the Getting Started screen.

#### Error Responses

| HTTP Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | No instance found with the given `instanceId`. |
| 503 | `DB_UNAVAILABLE` | Database connection failed. |

---

### POST /instances/:instanceId/setup-status/complete

*(Phase 2 — in implementation, CP-T035)*

Marks first-run setup as complete for this instance. Sets a persistent flag in the instance runtime root so the Getting Started screen does not auto-show again.

#### Path Parameters

| Name | Type | Description |
|---|---|---|
| `instanceId` | string | The instance ID. |

#### Query Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `confirm` | string | Yes | Must be `true`. Requests without this return `400 CONFIRM_REQUIRED`. |

#### Request Body

None.

#### Response: 200 OK

```json
{
  "instanceId": "a1b2c3d4",
  "firstRunDetected": false,
  "completedAt": "2026-03-20T12:00:00.000Z",
  "flagPath": "/Users/nf/.iranti/.iranti-cp-setup-complete"
}
```

#### Error Responses

| HTTP Status | Code | Condition |
|---|---|---|
| 400 | `CONFIRM_REQUIRED` | `?confirm=true` was not provided. |
| 404 | `NOT_FOUND` | Instance not found. |
| 503 | `INTERNAL_ERROR` | Could not write the completion flag to the runtime root (e.g., filesystem permission error). |

---

### POST /instances/:instanceId/setup-status/refresh

*(Phase 2 — in implementation, CP-T035)*

Re-runs all setup status checks for this instance without a full page reload. Used by the "Refresh" button on individual Getting Started steps (particularly the provider step, where the user may have just added an API key).

#### Path Parameters

| Name | Type | Description |
|---|---|---|
| `instanceId` | string | The instance ID. |

#### Request Body

None.

#### Response: 200 OK

Same shape as `GET /instances/:instanceId/setup-status`. All step statuses are freshly evaluated at request time.

#### Error Responses

| HTTP Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | Instance not found. |
| 503 | `DB_UNAVAILABLE` | Database connection failed. |

---

### POST /instances/:instanceId/projects/:projectId/repair/mcp-json

*(Phase 2 — in implementation, CP-T033)*

Generates a fresh `.mcp.json` file at the project root using the current instance configuration (database host, port, runtime root). This is a destructive file-write operation. If `.mcp.json` already exists at the project path, it is overwritten.

#### Path Parameters

| Name | Type | Description |
|---|---|---|
| `instanceId` | string | The instance ID. |
| `projectId` | string | The project ID from `ProjectBinding.projectId`. |

#### Query Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `confirm` | string | Yes | Must be `true`. Requests without this return `400 CONFIRM_REQUIRED`. |

#### Request Body

None.

#### Response: 200 OK

```json
{
  "action": "mcp_json_generated",
  "projectPath": "/Users/nf/projects/myapp",
  "filePath": "/Users/nf/projects/myapp/.mcp.json",
  "fileWritten": true,
  "revertable": false,
  "auditEntry": {
    "agentId": "control_plane_repair",
    "source": "control_plane",
    "actionType": "repair_mcp_json",
    "timestamp": "2026-03-20T12:05:00.000Z"
  },
  "generatedContent": {
    "mcpServers": {
      "iranti": {
        "command": "node",
        "args": ["/Users/nf/.iranti/mcp-server.js"],
        "env": {
          "DATABASE_URL": "postgresql://***@localhost:5432/iranti"
        }
      }
    }
  }
}
```

**`revertable: false`:** File writes are not transactional. If you need to undo this action, restore from a `.mcp.json.bak` backup written alongside the new file (implementation detail — confirm with backend at acceptance).

#### Error Responses

| HTTP Status | Code | Condition |
|---|---|---|
| 400 | `CONFIRM_REQUIRED` | `?confirm=true` was not provided. |
| 404 | `NOT_FOUND` | Instance or project not found. |
| 403 | `PERMISSION_DENIED` | The server process does not have write access to the project directory. Includes a `detail.suggestedFix` field. |
| 503 | `INTERNAL_ERROR` | Unexpected file write failure. |

---

### POST /instances/:instanceId/projects/:projectId/repair/claude-md

*(Phase 2 — in implementation, CP-T033)*

Appends or replaces the Iranti integration block in the project's `CLAUDE.md` file. Preserves all user-authored content outside the Iranti-delimited block. If no `CLAUDE.md` exists, the endpoint returns an error — it does not create `CLAUDE.md` from scratch.

#### Path Parameters

| Name | Type | Description |
|---|---|---|
| `instanceId` | string | The instance ID. |
| `projectId` | string | The project ID. |

#### Query Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `confirm` | string | Yes | Must be `true`. Requests without this return `400 CONFIRM_REQUIRED`. |

#### Request Body

None.

#### Response: 200 OK

```json
{
  "action": "claude_md_updated",
  "projectPath": "/Users/nf/projects/myapp",
  "filePath": "/Users/nf/projects/myapp/CLAUDE.md",
  "fileWritten": true,
  "revertable": false,
  "blockAction": "replaced",
  "auditEntry": {
    "agentId": "control_plane_repair",
    "source": "control_plane",
    "actionType": "repair_claude_md",
    "timestamp": "2026-03-20T12:06:00.000Z"
  }
}
```

**`blockAction` values:**
- `"replaced"` — an existing Iranti block was found and replaced
- `"appended"` — no existing Iranti block was found; new block appended to end of file

#### Error Responses

| HTTP Status | Code | Condition |
|---|---|---|
| 400 | `CONFIRM_REQUIRED` | `?confirm=true` was not provided. |
| 404 | `NOT_FOUND` | Instance or project not found; or `CLAUDE.md` does not exist at the project root. |
| 422 | `BLOCK_DETECTION_FAILED` | A `CLAUDE.md` exists but the Iranti block delimiter could not be reliably detected. The file was not modified. |
| 403 | `PERMISSION_DENIED` | The server process does not have write access to `CLAUDE.md`. |
| 503 | `INTERNAL_ERROR` | Unexpected file write failure. |

---

### POST /instances/:instanceId/doctor

*(Phase 2 — in implementation, CP-T033)*

Runs a structured diagnostic pass scoped to one instance. Returns pass/fail per check, plain-English descriptions, and suggested remediation steps. Where a check has a registered repair action, the response includes the repair endpoint URL inline.

This is a structured diagnostic endpoint — it is not a shell command executor. It runs the same internal checks as `GET /health` but scoped to the specified instance, and includes more detail about remediation paths.

#### Path Parameters

| Name | Type | Description |
|---|---|---|
| `instanceId` | string | The instance ID. |

#### Query Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `confirm` | string | Yes | Must be `true`. Requests without this return `400 CONFIRM_REQUIRED`. The `confirm` requirement signals to callers that this endpoint may trigger I/O operations with side effects (health probes, filesystem reads). |

#### Request Body

None.

#### Response: 200 OK

```json
{
  "instanceId": "a1b2c3d4",
  "checkedAt": "2026-03-20T12:07:00.000Z",
  "overall": "degraded",
  "checks": [
    {
      "id": "db_reachability",
      "label": "Database connection",
      "status": "pass",
      "message": "Connected to PostgreSQL at localhost:5432/iranti",
      "repairAction": null
    },
    {
      "id": "provider_key",
      "label": "Provider key",
      "status": "fail",
      "message": "No provider key found in .env.iranti. Iranti cannot process LLM-dependent writes.",
      "suggestedFix": "Add ANTHROPIC_API_KEY or OPENAI_API_KEY to /Users/nf/.iranti/.env.iranti and restart Iranti.",
      "repairAction": null
    },
    {
      "id": "mcp_json_myapp",
      "label": ".mcp.json — myapp",
      "status": "fail",
      "message": ".mcp.json not found at /Users/nf/projects/myapp/.mcp.json",
      "suggestedFix": "Use the Repair button or run: iranti setup --mcp /Users/nf/projects/myapp",
      "repairAction": "/api/control-plane/instances/a1b2c3d4/projects/b5c6d7e8/repair/mcp-json"
    }
  ]
}
```

**`overall` values:** `healthy` (all checks pass), `degraded` (at least one fail, no critical failure), `critical` (at least one check indicates the instance is non-functional).

**`status` values per check:** `pass`, `fail`, `warn`

#### Error Responses

| HTTP Status | Code | Condition |
|---|---|---|
| 400 | `CONFIRM_REQUIRED` | `?confirm=true` was not provided. |
| 404 | `NOT_FOUND` | Instance not found. |
| 503 | `INTERNAL_ERROR` | Doctor aggregation failed unexpectedly. |
