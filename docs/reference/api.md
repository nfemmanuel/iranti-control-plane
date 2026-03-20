# Control Plane API Reference

All endpoints are served under the `/api/control-plane/` namespace. All responses use `Content-Type: application/json` unless noted. The API is read-only — no POST, PUT, PATCH, or DELETE endpoints exist in v1.

**Base URL (local development):** `http://localhost:4000/api/control-plane`

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

Common error codes: `NOT_FOUND`, `INVALID_PARAM`, `INTERNAL_ERROR`, `DB_UNAVAILABLE`, `EVENTS_TABLE_MISSING`.

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

The following are explicitly out of scope for the v1 API:

- **Write endpoints** — no POST, PUT, PATCH, or DELETE. Mutations go through existing Iranti CLI/API/MCP pathways.
- **Authentication** — no token-based auth in v1. Any non-local deployment must add auth before exposing this API.
- **Provider credit/quota endpoints** — deferred to Phase 2 (requires per-provider capability matrix).
- **Conflict review endpoints** — deferred to Phase 2.
- **Entity aliases endpoint** — deferred until the `entity_aliases` table exists in the upstream Iranti schema.
- **WebSocket alternative to SSE** — SSE is sufficient for v1 unidirectional streaming.
- **Advanced full-text search** — the `search` param uses ILIKE substring matching in v1. tsvector-based FTS is Phase 2.
