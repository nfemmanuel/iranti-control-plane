# Phase 1 API Test Plan

**Plan ID**: QA-TP-001
**Spec ref**: CP-T002 (API spec), CP-T003 (instance metadata aggregation)
**Ticket**: CP-T018
**Author**: qa_engineer
**Date**: 2026-03-20
**Status**: Ready for execution — server must be running at localhost:3002

---

## 1. Scope

### 1.1 In Scope

All 10 endpoint paths from CP-T002, implemented across CP-T010, CP-T011, CP-T012:

| Group | Path | Implementation ticket |
|---|---|---|
| 1 | `GET /api/control-plane/kb` | CP-T010 |
| 2 | `GET /api/control-plane/archive` | CP-T010 |
| 3a | `GET /api/control-plane/entities/:entityType/:entityId` | CP-T010 |
| 3b | `GET /api/control-plane/entities/:entityType/:entityId/history/:key` | CP-T010 |
| 4 | `GET /api/control-plane/relationships` | CP-T010 |
| 5a | `GET /api/control-plane/instances` | CP-T011 |
| 5b | `GET /api/control-plane/instances/:instanceId/projects` | CP-T011 |
| 6 | `GET /api/control-plane/health` | CP-T011 |
| 7a | `GET /api/control-plane/events` | CP-T012 |
| 7b | `GET /api/control-plane/events/stream` | CP-T012 |

### 1.2 Environments

- **Primary**: local development database (`DATABASE_URL` from `.env.iranti`)
- **Base URL**: `http://localhost:3002/api/control-plane`
- **Recommended**: dedicated test database seeded with known fixtures to make filter tests reproducible (see §2.4)

### 1.3 Out of Scope for Phase 1 QA

- UI testing (covered separately in `phase1-ui-acceptance.md`)
- Performance / load testing
- Security penetration testing (basic credential leak check IS in scope — §3 below)
- Write endpoints (none exist in Phase 1)
- Alias endpoints (deferred to Phase 2 per CP-T002 Amendment CP-T006-A1)

---

## 2. Test Approach

### 2.1 Unit Tests

Target: utilities in `src/server/types.ts` that are stateless and independently testable.

- `snakeToCamel()` — key conversion and Date ISO serialization
- `serializeValueRaw()` — 4KB truncation logic, byte-accurate calculation
- `serializeFullValueRaw()` — no truncation variant
- `parsePagination()` — limit/offset validation and boundary cases
- `deriveInstanceId()` (in `instance-aggregator`) — hash stability and format

Files: `src/server/tests/unit/` — run with `vitest run`.

### 2.2 Integration Tests

Target: running server against real local database.

- Test runner: **vitest** (ESM-compatible, matches project's `"type": "module"`)
- Transport: `fetch()` (Node 18+ built-in)
- All integration tests require `DATABASE_URL` set and server running on port 3002
- SSE tests use a Node.js `EventSource` polyfill or raw `http.request` with stream reading

Files: `src/server/tests/integration/`

### 2.3 Manual Tests

For edge cases that require environment manipulation (missing env file, offline instance, absent DB table):

- Each edge case includes explicit setup steps to configure the environment for that test
- After each edge case test, restore the environment to a working state
- Document actual vs expected for each

### 2.4 Seed Data Requirements

To make filter tests deterministic, request the following seed fixtures from backend_developer before beginning Group 1–4 tests:

- At least **10 KB facts** for entity type `agent`, entity ID `test_agent_001`
- At least **3 KB facts** with `confidence = 100` for filtering tests
- At least **5 archive facts** for `agent/test_agent_001` with varied `archivedReason` values (`superseded`, `decay`)
- At least **2 relationships** between `agent/test_agent_001` and other entities
- At least **1 KB fact** with `valueRaw` exceeding 4096 bytes for truncation tests
- At least **5 staff_events** rows in the `staff_events` table for event listing tests

If seed data is unavailable, filter tests against live Iranti data are still runnable but results will be non-deterministic. In that case, document the actual values observed.

---

## 3. Per-Endpoint Test Cases

### 3.1 Group 1: `GET /api/control-plane/kb`

Base URL: `GET /api/control-plane/kb`

| ID | Name | Input | Expected | Pass/Fail | Actual |
|---|---|---|---|---|---|
| KB-001 | Happy path — default params | No params | 200, `items` array, `total` >= 0, `limit=50`, `offset=0` | — | — |
| KB-002 | Filter by entityType | `?entityType=agent` | 200, all items have `entityType === 'agent'` | — | — |
| KB-003 | Filter by entityId | `?entityId=test_agent_001` | 200, all items have `entityId === 'test_agent_001'` | — | — |
| KB-004 | Filter by key | `?key=current_assignment` | 200, all items have `key === 'current_assignment'` | — | — |
| KB-005 | Filter by source | `?source=mcp` | 200, all items have `source === 'mcp'` | — | — |
| KB-006 | Filter by createdBy | `?createdBy=product_manager` | 200, all items have `agentId === 'product_manager'` | — | — |
| KB-007 | Filter by minConfidence=100 | `?minConfidence=100` | 200, all items have `confidence >= 100` | — | — |
| KB-008 | Filter by minConfidence=0 | `?minConfidence=0` | 200, all items (no filter effectively applied — 0 is minimum possible) | — | — |
| KB-009 | minConfidence boundary — 100 | `?minConfidence=100` | 200, only items with confidence=100 returned | — | — |
| KB-010 | minConfidence invalid — not integer | `?minConfidence=abc` | 400, `code: 'INVALID_PARAM'`, `error` string present | — | — |
| KB-011 | minConfidence invalid — negative | `?minConfidence=-1` | 400, `code: 'INVALID_PARAM'` | — | — |
| KB-012 | minConfidence invalid — 101 | `?minConfidence=101` | 400, `code: 'INVALID_PARAM'` | — | — |
| KB-013 | Search — text in summary | `?search=assignment` | 200, all returned items contain 'assignment' in `valueSummary` or `valueRaw` | — | — |
| KB-014 | Search — no results | `?search=__zzz_impossible_string__` | 200, `items: []`, `total: 0` | — | — |
| KB-015 | Pagination — limit | `?limit=5` | 200, `items.length <= 5`, `limit: 5` | — | — |
| KB-016 | Pagination — offset | `?limit=5&offset=5` | 200, `offset: 5`, items differ from KB-015 | — | — |
| KB-017 | limit=1 (minimum) | `?limit=1` | 200, `items.length <= 1`, `limit: 1` | — | — |
| KB-018 | limit=500 (maximum allowed) | `?limit=500` | 200, `limit: 500` | — | — |
| KB-019 | limit=501 (over maximum) | `?limit=501` | 400, `code: 'INVALID_PARAM'` | — | — |
| KB-020 | limit=0 (under minimum) | `?limit=0` | 400, `code: 'INVALID_PARAM'` | — | — |
| KB-021 | limit=abc (non-integer) | `?limit=abc` | 400, `code: 'INVALID_PARAM'` | — | — |
| KB-022 | offset negative | `?offset=-1` | 400, `code: 'INVALID_PARAM'` | — | — |
| KB-023 | Empty result set | `?entityType=__nonexistent_type__` | 200, `items: []`, `total: 0` | — | — |
| KB-024 | camelCase response fields | `?limit=1` (item exists) | Item has `entityType`, `entityId`, `agentId`, `validFrom`, `createdAt` — no snake_case keys | — | — |
| KB-025 | valueRaw truncation — >4KB value | Seed: 1 item with >4KB valueRaw | `valueRawTruncated: true`, `valueRaw` is 4096 bytes or fewer | — | — |
| KB-026 | valueRaw no truncation — <4KB value | Seed: item with small valueRaw | `valueRawTruncated: false`, `valueRaw` is complete | — | — |
| KB-027 | No credentials in response | Any request | `DATABASE_URL` value not present in raw JSON response body | — | — |
| KB-028 | Combined filters | `?entityType=agent&minConfidence=50&limit=10` | 200, all items satisfy all filters simultaneously | — | — |
| KB-029 | archivedReason filter | `?archivedReason=superseded` | 200 or note if field absent on KB table (document finding) | — | — |

### 3.2 Group 2: `GET /api/control-plane/archive`

Base URL: `GET /api/control-plane/archive`

| ID | Name | Input | Expected | Pass/Fail | Actual |
|---|---|---|---|---|---|
| AR-001 | Happy path | No params | 200, `items` array, `total` >= 0, `limit: 50`, `offset: 0` | — | — |
| AR-002 | Filter by entityType | `?entityType=agent` | 200, all items `entityType === 'agent'` | — | — |
| AR-003 | Filter by archivedReason | `?archivedReason=superseded` | 200, all items `archivedReason === 'superseded'` | — | — |
| AR-004 | Filter by resolutionState | `?resolutionState=pending` | 200, all items `resolutionState === 'pending'` | — | — |
| AR-005 | Filter by supersededBy | `?supersededBy=some-id` | 200, filtered to that supersession chain | — | — |
| AR-006 | archivedAfter — valid ISO 8601 | `?archivedAfter=2026-01-01T00:00:00Z` | 200, all items `archivedAt > '2026-01-01T00:00:00Z'` | — | — |
| AR-007 | archivedBefore — valid ISO 8601 | `?archivedBefore=2027-01-01T00:00:00Z` | 200, all items `archivedAt <= '2027-01-01T00:00:00Z'` | — | — |
| AR-008 | archivedAfter + archivedBefore range | `?archivedAfter=2026-01-01T00:00:00Z&archivedBefore=2027-01-01T00:00:00Z` | 200, items within that range only | — | — |
| AR-009 | archivedAfter — invalid (not ISO 8601) | `?archivedAfter=not-a-date` | 400, `code: 'INVALID_PARAM'`, `detail.field === 'archivedAfter'` | — | — |
| AR-010 | archivedBefore — invalid | `?archivedBefore=2026/01/01` | 400, `code: 'INVALID_PARAM'`, `detail.field === 'archivedBefore'` | — | — |
| AR-011 | limit > 500 | `?limit=501` | 400, `code: 'INVALID_PARAM'` | — | — |
| AR-012 | minConfidence=abc | `?minConfidence=abc` | 400, `code: 'INVALID_PARAM'` | — | — |
| AR-013 | Empty result | `?entityType=__nonexistent__` | 200, `items: []`, `total: 0` | — | — |
| AR-014 | camelCase response fields | `?limit=1` (item exists) | Item has `archivedAt`, `archivedReason`, `supersededBy`, `resolutionState`, `resolutionNote` — no snake_case | — | — |
| AR-015 | `archivedAt` is non-null | Any item | `archivedAt` is an ISO 8601 string, not null | — | — |
| AR-016 | valueRawTruncated on archive list | Seed: 1 item with >4KB valueRaw | `valueRawTruncated: true` | — | — |
| AR-017 | No credentials in response | Any request | `DATABASE_URL` value not present in raw JSON body | — | — |

### 3.3 Group 3a: `GET /api/control-plane/entities/:entityType/:entityId`

Base URL: `GET /api/control-plane/entities/{entityType}/{entityId}`

| ID | Name | Input | Expected | Pass/Fail | Actual |
|---|---|---|---|---|---|
| EN-001 | Happy path — entity with data | `GET /entities/agent/test_agent_001` | 200, `entity: null` (Phase 1 invariant), `currentFacts` array, `archivedFacts` array, `relationships` array | — | — |
| EN-002 | `entity` field is always null | `GET /entities/agent/test_agent_001` | `body.entity === null` — unconditionally null in Phase 1 | — | — |
| EN-003 | 404 — entity with no data | `GET /entities/__fake__/__also_fake__` | 404, `code: 'NOT_FOUND'` | — | — |
| EN-004 | includeArchived=false | `GET /entities/agent/test_agent_001?includeArchived=false` | 200, `archivedFacts: []` | — | — |
| EN-005 | includeRelationships=false | `GET /entities/agent/test_agent_001?includeRelationships=false` | 200, `relationships: []` | — | — |
| EN-006 | currentFacts are camelCase | `GET /entities/agent/test_agent_001` | Each item in `currentFacts` has `entityType`, `agentId`, `validFrom` — no snake_case keys | — | — |
| EN-007 | archivedFacts have archivedAt | `GET /entities/agent/test_agent_001` | Each item in `archivedFacts` has `archivedAt` as ISO 8601 string | — | — |
| EN-008 | relationships have correct shape | `GET /entities/agent/test_agent_001` | Each item in `relationships` has `fromEntityType`, `fromEntityId`, `toEntityType`, `toEntityId`, `relationshipType` | — | — |
| EN-009 | entity with only relationships (no KB facts) | Setup: entity that only appears in `entity_relationships` | 200, `currentFacts: []`, `archivedFacts: []`, `relationships` non-empty | — | — |
| EN-010 | valueRaw truncated in currentFacts list | Seed: item with >4KB valueRaw | `valueRawTruncated: true` on the item within currentFacts | — | — |
| EN-011 | No credentials in response | Any request | `DATABASE_URL` value not present | — | — |

### 3.4 Group 3b: `GET /api/control-plane/entities/:entityType/:entityId/history/:key`

Base URL: `GET /api/control-plane/entities/{entityType}/{entityId}/history/{key}`

| ID | Name | Input | Expected | Pass/Fail | Actual |
|---|---|---|---|---|---|
| HI-001 | Happy path — key with history | `GET /entities/agent/test_agent_001/history/current_assignment` | 200, `entityType: 'agent'`, `entityId: 'test_agent_001'`, `key: 'current_assignment'`, `intervals` array, `totalIntervals` = intervals.length | — | — |
| HI-002 | 404 — no history for key | `GET /entities/agent/test_agent_001/history/__nonexistent_key__` | 404, `code: 'NOT_FOUND'` | — | — |
| HI-003 | intervals contain both kb and archive sources | Seed: entity with current fact and at least one archived version of same key | `intervals` has items with `source: 'kb'` and items with `source: 'archive'` | — | — |
| HI-004 | Full valueRaw returned (no truncation) | Seed: interval with >4KB valueRaw | `valueRaw` is complete (not truncated to 4KB) — full value present | — | — |
| HI-005 | intervals ordered validFrom DESC | Any entity with multiple history intervals | First interval has the most recent `validFrom` or `createdAt` | — | — |
| HI-006 | `providerSource` field present | Any interval | Each interval has `providerSource` field (renamed from `source` to avoid JS reserved conflict) | — | — |
| HI-007 | archivedAt null for kb intervals | Any kb-source interval | `archivedAt === null` | — | — |
| HI-008 | archivedAt set for archive intervals | Any archive-source interval | `archivedAt` is an ISO 8601 string | — | — |
| HI-009 | camelCase fields | Any interval | Fields are `validFrom`, `validUntil`, `archivedAt`, `archivedReason`, `supersededBy`, `resolutionState` — no snake_case | — | — |

### 3.5 Group 4: `GET /api/control-plane/relationships`

Base URL: `GET /api/control-plane/relationships`

| ID | Name | Input | Expected | Pass/Fail | Actual |
|---|---|---|---|---|---|
| RL-001 | Happy path | No params | 200, `items` array, `total` >= 0, `limit: 50`, `offset: 0` | — | — |
| RL-002 | Filter by entityId (bidirectional) | `?entityId=test_agent_001` | 200, all items have `fromEntityId === 'test_agent_001'` OR `toEntityId === 'test_agent_001'` | — | — |
| RL-003 | Filter by entityId + entityType | `?entityId=test_agent_001&entityType=agent` | 200, items match bidirectional lookup scoped to entity type | — | — |
| RL-004 | Filter by fromEntityId | `?fromEntityId=test_agent_001` | 200, all items have `fromEntityId === 'test_agent_001'` | — | — |
| RL-005 | Filter by toEntityId | `?toEntityId=some_other_entity` | 200, all items have `toEntityId === 'some_other_entity'` | — | — |
| RL-006 | Filter by relationshipType | `?relationshipType=depends_on` | 200, all items have `relationshipType === 'depends_on'` | — | — |
| RL-007 | limit > 500 | `?limit=501` | 400, `code: 'INVALID_PARAM'` | — | — |
| RL-008 | limit=0 | `?limit=0` | 400, `code: 'INVALID_PARAM'` | — | — |
| RL-009 | Empty result | `?entityId=__nobody_knows_this_entity__` | 200, `items: []`, `total: 0` | — | — |
| RL-010 | camelCase fields | Any item | `fromEntityType`, `fromEntityId`, `toEntityType`, `toEntityId`, `relationshipType`, `createdAt` — no snake_case | — | — |
| RL-011 | No credentials in response | Any request | `DATABASE_URL` value not present | — | — |

### 3.6 Group 5a: `GET /api/control-plane/instances`

Base URL: `GET /api/control-plane/instances`

| ID | Name | Input | Expected | Pass/Fail | Actual |
|---|---|---|---|---|---|
| IN-001 | Happy path — running instance | Normal env, server running | 200, `instances` array with >= 1 item, `discoveredAt` ISO 8601, `discoverySource` in `['registry','scan','hybrid']` | — | — |
| IN-002 | instanceId format | Any instance | `instanceId` is exactly 8 hex characters (matches `/^[0-9a-f]{8}$/`) | — | — |
| IN-003 | instanceId stable across calls | Two consecutive requests with same environment | Same `instanceId` value returned both times | — | — |
| IN-004 | DATABASE_URL redacted | Any instance with DB configured | `database.urlRedacted` starts with `postgresql://***@` or `postgres://***@` — raw credentials not present | — | — |
| IN-005 | Raw DATABASE_URL never returned | Any instance | Full `DATABASE_URL` value from `.env.iranti` is absent from entire response body | — | — |
| IN-006 | API key values never returned | Any instance | `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` values not present in response — only boolean `providerKeys.anthropic` and `providerKeys.openai` | — | — |
| IN-007 | Running instance runningStatus | Instance with server running | `runningStatus === 'running'` | — | — |
| IN-008 | Missing .env.iranti (edge case) | See §4.1 setup | `envFile.present: false`, `database: null`, `integration.providerKeys.anthropic: false`, `integration.providerKeys.openai: false`, `envFile.keyCompleteness: null` | — | — |
| IN-009 | Instance not running — stopped (edge case) | See §4.2 setup | `runningStatus === 'stopped'` or `'unreachable'`, env file fields still populated | — | — |
| IN-010 | Always returns 200 | Even when all instances stopped | HTTP 200, `instances` may be empty or all stopped, no 5xx | — | — |
| IN-011 | discoverySource label | Any | `discoverySource` is one of `'registry'`, `'scan'`, `'hybrid'` | — | — |
| IN-012 | envFile.keyCompleteness when present | Instance with complete .env.iranti | `keyCompleteness.allRequiredKeysPresent` is boolean, `keyCompleteness.requiredKeys` is array | — | — |
| IN-013 | Projects always empty in Phase 1 | Any instance | `projects: []` (Phase 1 stub) | — | — |

### 3.7 Group 5b: `GET /api/control-plane/instances/:instanceId/projects`

Base URL: `GET /api/control-plane/instances/{instanceId}/projects`

| ID | Name | Input | Expected | Pass/Fail | Actual |
|---|---|---|---|---|---|
| PR-001 | Phase 1 stub response | Any instanceId (even fake) | 200, `instanceId` echoed, `projects: []`, `projectBindingsUnavailable: true` | — | — |
| PR-002 | Stub note field present | Any instanceId | Response includes `note` string explaining stub status | — | — |

### 3.8 Group 6: `GET /api/control-plane/health`

Base URL: `GET /api/control-plane/health`

| ID | Name | Input | Expected | Pass/Fail | Actual |
|---|---|---|---|---|---|
| HL-001 | Happy path — returns 200 always | No params | HTTP 200, even if `overall === 'error'` | — | — |
| HL-002 | Response shape | Any | `overall` in `['healthy','degraded','error']`, `checkedAt` ISO 8601, `checks` is array | — | — |
| HL-003 | All 10 required checks present | Any | `checks` contains items with `name` matching: `db_reachability`, `db_schema_version`, `vector_backend`, `anthropic_key`, `openai_key`, `default_provider_configured`, `mcp_integration`, `claude_md_integration`, `runtime_version`, `staff_events_table` | — | — |
| HL-004 | Each check has required fields | Any | Every check has `name` (string), `status` in `['ok','warn','error']`, `message` (string) | — | — |
| HL-005 | db_reachability — connected | Normal env | `db_reachability.status === 'ok'`, `message` includes 'Connected', `detail.latencyMs` is a number | — | — |
| HL-006 | db_schema_version check | Normal env | `db_schema_version.status` is `'ok'` or `'warn'` — never `'error'` unless migrations table missing | — | — |
| HL-007 | vector_backend check | Normal env | `vector_backend.status` is `'ok'` if pgvector installed, `'warn'` if missing | — | — |
| HL-008 | anthropic_key — present | Env with key | `anthropic_key.status === 'ok'`, no key value in response | — | — |
| HL-009 | anthropic_key — missing | Env without key | `anthropic_key.status === 'warn'` | — | — |
| HL-010 | openai_key — present | Env with key | `openai_key.status === 'ok'` | — | — |
| HL-011 | openai_key — missing | Env without key | `openai_key.status === 'warn'` | — | — |
| HL-012 | default_provider_configured — set to known provider | `IRANTI_DEFAULT_PROVIDER=anthropic` in env | `default_provider_configured.status === 'ok'` | — | — |
| HL-013 | default_provider_configured — unknown value | `IRANTI_DEFAULT_PROVIDER=fakevendor` in env | `default_provider_configured.status === 'error'` | — | — |
| HL-014 | default_provider_configured — missing | No provider env var | `default_provider_configured.status === 'warn'` | — | — |
| HL-015 | mcp_integration — file present with iranti entry | `.mcp.json` with iranti server | `mcp_integration.status === 'ok'` | — | — |
| HL-016 | mcp_integration — file absent | No `.mcp.json` in cwd | `mcp_integration.status === 'warn'` | — | — |
| HL-017 | mcp_integration — file present, no iranti entry | `.mcp.json` without iranti server entry | `mcp_integration.status === 'warn'` | — | — |
| HL-018 | mcp_integration — malformed JSON | `.mcp.json` with invalid JSON | `mcp_integration.status === 'warn'`, error detail present | — | — |
| HL-019 | claude_md_integration — file present with reference | `CLAUDE.md` referencing iranti | `claude_md_integration.status === 'ok'` | — | — |
| HL-020 | claude_md_integration — file absent | No `CLAUDE.md` in cwd | `claude_md_integration.status === 'warn'` | — | — |
| HL-021 | runtime_version check | Any env | `runtime_version.status` is `'ok'` if version detectable, `'warn'` otherwise | — | — |
| HL-022 | staff_events_table — table exists (CP-T001 applied) | Normal env after migration | `staff_events_table.status === 'ok'` | — | — |
| HL-023 | staff_events_table — table missing (edge case) | See §4.4 setup | `staff_events_table.status === 'warn'`, message references CP-T001 migration | — | — |
| HL-024 | overall=healthy logic | All checks ok | `overall === 'healthy'` | — | — |
| HL-025 | overall=degraded logic | At least one warn, no error | `overall === 'degraded'` | — | — |
| HL-026 | overall=error logic | At least one error | `overall === 'error'` | — | — |
| HL-027 | No credentials in response | Any | API key values absent from raw JSON body | — | — |

### 3.9 Group 7a: `GET /api/control-plane/events`

Base URL: `GET /api/control-plane/events`

| ID | Name | Input | Expected | Pass/Fail | Actual |
|---|---|---|---|---|---|
| EV-001 | Happy path | No params | 200, `items` array, `total` (number or null), `limit: 100`, `offset: 0`, `oldestEventTimestamp` (string or null) | — | — |
| EV-002 | Filter by staffComponent=Librarian | `?staffComponent=Librarian` | 200, all items `staffComponent === 'Librarian'` | — | — |
| EV-003 | Filter by staffComponent=Archivist | `?staffComponent=Archivist` | 200, all items `staffComponent === 'Archivist'` | — | — |
| EV-004 | staffComponent invalid value | `?staffComponent=Janitor` | 400, `code: 'INVALID_PARAM'`, `detail.field === 'staffComponent'`, `detail.allowedValues` lists valid components | — | — |
| EV-005 | Filter by actionType | `?actionType=write_created` | 200, all items `actionType === 'write_created'` | — | — |
| EV-006 | Filter by agentId | `?agentId=product_manager` | 200, all items `agentId === 'product_manager'` | — | — |
| EV-007 | Filter by entityType | `?entityType=ticket` | 200, all items `entityType === 'ticket'` | — | — |
| EV-008 | Filter by entityId | `?entityId=cp_t001` | 200, all items `entityId === 'cp_t001'` | — | — |
| EV-009 | level=audit (default) | `?level=audit` | 200, same result as no level param | — | — |
| EV-010 | level=debug | `?level=debug` | 200, may include debug-level events if any exist | — | — |
| EV-011 | level invalid value | `?level=verbose` | 400, `code: 'INVALID_PARAM'` | — | — |
| EV-012 | since — valid ISO 8601 | `?since=2026-03-01T00:00:00Z` | 200, all items `timestamp > '2026-03-01T00:00:00Z'` | — | — |
| EV-013 | until — valid ISO 8601 | `?until=2027-01-01T00:00:00Z` | 200, all items `timestamp <= '2027-01-01T00:00:00Z'` | — | — |
| EV-014 | since + until range | `?since=2026-01-01T00:00:00Z&until=2027-01-01T00:00:00Z` | 200, items within range | — | — |
| EV-015 | since invalid | `?since=not-a-date` | 400, `code: 'INVALID_PARAM'`, `detail.field === 'since'` | — | — |
| EV-016 | until invalid | `?until=2026/01/01` | 400, `code: 'INVALID_PARAM'`, `detail.field === 'until'` | — | — |
| EV-017 | limit=1000 (maximum allowed) | `?limit=1000` | 200, `limit: 1000` | — | — |
| EV-018 | limit=1001 (over maximum) | `?limit=1001` | 400, `code: 'INVALID_PARAM'` | — | — |
| EV-019 | Empty result | `?agentId=__nobody__` | 200, `items: []` | — | — |
| EV-020 | camelCase fields | Any item | `eventId`, `staffComponent`, `actionType`, `agentId`, `entityType`, `entityId` — no snake_case | — | — |
| EV-021 | staff_events table absent (edge case) | See §4.4 setup | 503, `code: 'EVENTS_TABLE_MISSING'`, message directs to apply CP-T001 migration | — | — |
| EV-022 | No credentials in response | Any request | `DATABASE_URL` value not present | — | — |

### 3.10 Group 7b: `GET /api/control-plane/events/stream` (SSE)

Base URL: `GET /api/control-plane/events/stream`

| ID | Name | Input | Expected | Pass/Fail | Actual |
|---|---|---|---|---|---|
| SS-001 | Content-Type header | Connect | Response `Content-Type: text/event-stream` | — | — |
| SS-002 | Cache-Control header | Connect | Response `Cache-Control: no-cache` | — | — |
| SS-003 | Connection keeps alive | Connect, wait 15s | Connection remains open, no timeout error | — | — |
| SS-004 | Heartbeat emitted | Connect, wait 15s without new events | `: keep-alive` comment line received within 16 seconds | — | — |
| SS-005 | Event format — data line | New KB write → wait for event | Received line `data: {...json...}` parseable as `StaffEvent` | — | — |
| SS-006 | Event format — id line | New KB write → wait for event | Received `id: {uuid}` line after data line | — | — |
| SS-007 | StaffEvent schema — Librarian | New KB write triggers event | `staffComponent: 'Librarian'`, `actionType: 'write_created'` or `'write_replaced'`, `eventId` is UUID, `timestamp` is ISO 8601 | — | — |
| SS-008 | StaffEvent schema — Archivist | Archive row inserted | `staffComponent: 'Archivist'`, `actionType: 'entry_archived'` | — | — |
| SS-009 | Event within 2 seconds of DB write | DB row inserted, stream connected | Event appears on stream within 2 seconds (adapter poll is 2s) | — | — |
| SS-010 | Filter by staffComponent | `?staffComponent=Librarian` | Only Librarian events received; Archivist events not emitted on this connection | — | — |
| SS-011 | Invalid filter — stream closes | `?staffComponent=InvalidComponent` | HTTP 400 before stream is established (error returned as JSON, not SSE) | — | — |
| SS-012 | Last-Event-ID resume — no missed events | Connect, receive 3 events, disconnect (note last eventId), reconnect with `Last-Event-ID: {eventId}` header | Events after the cursor eventId are replayed; the cursor event itself is NOT re-emitted | — | — |
| SS-013 | Last-Event-ID resume — no duplicates | See SS-012 setup | Events received before disconnect are not re-emitted after reconnect | — | — |
| SS-014 | Disconnect cleanup | Connect, then close client | Server stops polling (verify via server logs: no further poll after disconnect) | — | — |
| SS-015 | staff_events table absent (edge case) | See §4.4 setup | HTTP 503 before stream is established, `code: 'EVENTS_TABLE_MISSING'` | — | — |
| SS-016 | DB loss error event | Simulate DB disconnect mid-stream | `event: error` SSE event emitted, then stream closes | — | — |

---

## 4. Edge Case Matrix

Each edge case requires deliberate environment manipulation. Document exact setup steps and restore after each test.

### 4.1 Missing `.env.iranti`

**Setup**: Rename (do not delete) `.env.iranti` to `.env.iranti.bak`. Restart server.

**Tests to run**: IN-008

**Expected behavior**:
- `GET /instances`: `envFile.present: false`, `database: null`, `integration.providerKeys.anthropic: false`, `integration.providerKeys.openai: false`, `envFile.keyCompleteness: null`
- No 500 error — response is 200 with the instance in a degraded state
- Health checks for `anthropic_key`, `openai_key`, `default_provider_configured` all return `warn` or reflect the missing env

**Restore**: Rename `.env.iranti.bak` back to `.env.iranti`. Restart server.

### 4.2 Instance Not Running (Stopped)

**Setup**: Stop the Iranti instance process. Server for the control plane remains running.

**Tests to run**: IN-009

**Expected behavior**:
- `GET /instances`: `runningStatus: 'stopped'` (ECONNREFUSED) or `'unreachable'` (timeout)
- All env file fields are still populated from the filesystem
- No 500 error — response is 200 with the stopped status surfaced inside the instance object
- Health probe timeout of 500ms is respected — response arrives within ~1 second of the probe completing

**Restore**: Start the Iranti instance process again.

### 4.3 Missing `.mcp.json` and `CLAUDE.md`

**Setup**: Move `.mcp.json` and `CLAUDE.md` out of the server's working directory (or confirm they don't exist).

**Tests to run**: HL-016, HL-020

**Expected behavior**:
- `mcp_integration.status === 'warn'` with message indicating file absent
- `claude_md_integration.status === 'warn'` with message indicating file absent
- No 500 error

**Restore**: Restore files to their original locations.

### 4.4 `staff_events` Table Absent (CP-T001 Migration Not Applied)

**Setup**: Either use a database without the CP-T001 migration applied, or (on a test database only, not production) `DROP TABLE staff_events;`.

**Warning**: Only perform this on a dedicated test database. Never on the live Iranti development database.

**Tests to run**: EV-021, SS-015, HL-023

**Expected behavior**:
- `GET /events`: HTTP 503, `code: 'EVENTS_TABLE_MISSING'`, message directs user to apply CP-T001 migration
- `GET /events/stream`: HTTP 503 before stream established, same code
- `GET /health`: `staff_events_table.status === 'warn'`, message references CP-T001 migration

**Restore**: Apply the CP-T001 migration (`prisma migrate deploy` or equivalent DDL).

### 4.5 Malformed `.mcp.json`

**Setup**: Create a `.mcp.json` with invalid JSON content (e.g., `{ broken: `).

**Tests to run**: HL-018

**Expected behavior**:
- `mcp_integration.status === 'warn'`
- `detail.error` field present with parse error message
- No 500 error

**Restore**: Delete or fix the `.mcp.json`.

### 4.6 Project Path Missing from Filesystem (Future: Phase 2)

**Note**: The `/instances/:instanceId/projects` endpoint is a Phase 1 stub returning `projects: []`. The edge case of a missing project path (`projectExists: false`) is deferred to Phase 2 when project binding discovery is implemented. **This edge case cannot be tested in Phase 1.** Document this as a known gap.

---

## 5. SSE Stream Test Cases (Expanded)

The SSE stream is the most complex endpoint. This section provides detailed step-by-step test procedures for the key stream scenarios.

### 5.1 Basic Connection and Event Flow

**Tool**: `curl` command or a small Node.js test script

```bash
# Test SS-001 through SS-004: Connect and observe headers + heartbeat
curl -N -H "Accept: text/event-stream" \
  "http://localhost:3002/api/control-plane/events/stream"
```

Observe:
1. Headers include `Content-Type: text/event-stream`, `Cache-Control: no-cache`
2. Connection stays open
3. Within 15 seconds: `: keep-alive` line emitted

### 5.2 Event Emission Test (SS-005 through SS-009)

**Setup**: Keep the stream connection open in one terminal. In a second terminal, trigger a new Iranti KB write via MCP tool or `iranti_write`.

**Observation**: Within 2 seconds, the stream emits:
```
data: {"eventId":"...","timestamp":"...","staffComponent":"Librarian","actionType":"write_created",...}

id: {uuid}

```

**Verify**: Parse the data JSON. Confirm all `StaffEvent` fields are present and correctly typed.

### 5.3 Last-Event-ID Resume (SS-012 and SS-013)

**Step-by-step procedure**:

1. Connect to stream: `curl -N "http://localhost:3002/api/control-plane/events/stream"`
2. Trigger 3 KB writes. Note the `id:` values for each event received.
3. Record the `eventId` of the **third** (last) event received.
4. Disconnect the stream (Ctrl-C).
5. Trigger 2 more KB writes (while disconnected).
6. Reconnect with: `curl -N -H "Last-Event-ID: {third-event-id}" "http://localhost:3002/api/control-plane/events/stream"`
7. Observe: The 2 events written while disconnected appear immediately.
8. Verify: The third event (the one used as the cursor) does NOT appear again.
9. Verify: The first and second events do NOT appear again.

**Pass criteria**: Steps 7–9 all confirmed.

### 5.4 Disconnect Cleanup (SS-014)

**Procedure**:
1. Check server logs for polling activity when stream is connected.
2. Disconnect the client.
3. Wait 5 seconds.
4. Verify: Server logs show no further polling activity for that connection.

### 5.5 Filter Validation Before Stream Opens (SS-011)

```bash
curl -v "http://localhost:3002/api/control-plane/events/stream?staffComponent=Janitor"
```

**Expected**: HTTP 400 response with JSON body `{"error":"...", "code":"INVALID_PARAM"}`. Connection NOT upgraded to SSE (no `text/event-stream` content-type). Stream is not opened.

---

## 6. Health Check Individual Test Cases

The health endpoint runs 10 checks. Each must be independently verifiable.

| Check | How to set `ok` | How to set `warn` | How to set `error` |
|---|---|---|---|
| `db_reachability` | Normal env, DB running | — | Stop the DB; restart CP server |
| `db_schema_version` | Migrations applied | Apply partial migration | Drop `_prisma_migrations` table |
| `vector_backend` | `CREATE EXTENSION vector;` applied | `DROP EXTENSION vector;` | — |
| `anthropic_key` | Set `ANTHROPIC_API_KEY` in env | Unset the key | — (no error state per spec) |
| `openai_key` | Set `OPENAI_API_KEY` in env | Unset the key | — |
| `default_provider_configured` | Set to `anthropic` or `openai` | Unset entirely | Set to `fakevendor` |
| `mcp_integration` | `.mcp.json` with iranti entry | No `.mcp.json` or file lacks entry | — |
| `claude_md_integration` | `CLAUDE.md` references iranti | `CLAUDE.md` absent | — |
| `runtime_version` | `package.json` with `version` field present | No `package.json` found | — |
| `staff_events_table` | CP-T001 migration applied | Migration not applied | — |

**Overall status logic tests**:
- All `ok` → `overall: 'healthy'`
- At least one `warn`, zero `error` → `overall: 'degraded'`
- At least one `error` (regardless of warn count) → `overall: 'error'`

---

## 7. Acceptance Criteria Checklist

Direct mapping from CP-T018 acceptance criteria to test case IDs:

| AC | Requirement | Test cases | Pass/Fail |
|---|---|---|---|
| AC-1 | Test plan document exists at `docs/test-plans/phase1-api-test-plan.md` | This document | Pass (document created) |
| AC-2 | Test plan covers all 10 endpoint paths | §3.1–§3.10 | Pass (all 10 covered) |
| AC-3 | Every filter param has ≥1 valid + ≥1 invalid test | See per-endpoint tables above | — |
| AC-3a | `minConfidence=abc` returns 400 | KB-010 | — |
| AC-3b | `minConfidence=50` returns filtered results | KB-007 | — |
| AC-3c | `archivedAfter` invalid ISO 8601 returns 400 | AR-009 | — |
| AC-3d | `level=verbose` returns 400 | EV-011 | — |
| AC-3e | `staffComponent=Janitor` returns 400 | EV-004 | — |
| AC-3f | `since=not-a-date` returns 400 | EV-015 | — |
| AC-4 | All CP-T003 §4 edge cases tested | §4 edge case matrix | — |
| AC-4a | Missing `.env.iranti` → `envFile.present: false` and null fields | IN-008, §4.1 | — |
| AC-4b | Instance not running → `runningStatus: 'stopped'` or `'unreachable'` | IN-009, §4.2 | — |
| AC-4c | Project path missing from filesystem | **Deferred to Phase 2** — projects endpoint is a stub in Phase 1 | N/A |
| AC-4d | Malformed `.mcp.json` → `mcpConfigPresent: true`, parse error surfaced | HL-018, §4.5 | — |
| AC-5 | Response shapes validated: camelCase, correct types, correct nullability | KB-024, AR-014, EN-006, HI-009, RL-010, EV-020 | — |
| AC-6 | Credentials never returned | KB-027, AR-017, EN-011, IN-005, IN-006, HL-027, EV-022 | — |
| AC-7 | `staff_events_table` check returns `warn` when migration absent | HL-023, §4.4 | — |
| AC-8 | SSE connect, verify StaffEvent schema, Last-Event-ID resume | SS-001–SS-016, §5 | — |
| AC-9 | All test results documented (this table + per-endpoint Pass/Fail columns) | All rows above | — |
| AC-10 | Failures reported to backend_developer with test case ID and actual vs expected | Ongoing during execution | — |

---

## 8. Known Phase 1 Limitations

The following are accepted limitations for Phase 1. They are not bugs — they are known deviations that must be documented and communicated to the PM.

1. **`entity` field always null**: `GET /entities/:entityType/:entityId` always returns `entity: null`. The `entities` table does not exist in the current Iranti schema. This is correct Phase 1 behavior per CP-T002 Amendment CP-T006-A1. No entity display name is available.

2. **Project bindings always empty stub**: `GET /instances/:instanceId/projects` always returns `projects: []` with `projectBindingsUnavailable: true`. No project binding discovery source exists in Phase 1. Edge case AC-4c (project path missing) cannot be tested.

3. **Attendant and Resolutionist events absent from stream**: The events adapter infers events from DB state changes only. It cannot reconstruct Attendant session lifecycle events (`handshake_completed`, `session_expired`) or Resolutionist decision events. These event types will not appear in the stream in Phase 1.

4. **Adapter cursor precision on restart**: If the adapter process restarts unexpectedly, KB/archive rows written between the last adapter poll and the restart may not produce staff_events entries. The cursor limitation is documented in CP-T012 §3.2.

5. **`write_replaced` detection is approximate**: The adapter uses a 5-second window heuristic to detect whether a new KB write replaced a prior fact. Some `write_replaced` events may be misclassified as `write_created`. Documented in CP-T012 §7.3.

6. **No deduplication across concurrent adapter processes**: If two adapter processes run simultaneously, duplicate staff_events rows may be inserted.

7. **ILIKE search is approximate**: The `search` filter on `/kb` and `/archive` uses `ILIKE '%term%'` — not full-text search. Results may be unexpected for multi-word queries or queries with special characters.

8. **`total` on `/events` may be null at scale**: The `total` field in `EventListResponse` may be `null` if the COUNT query is too expensive. This is acceptable behavior per the spec.

---

## 9. Test Results Log

*To be filled in during execution.*

**Execution date**: ___________
**Executor**: qa_engineer
**Server version**: ___________
**Database**: ___________
**Seed data applied**: ☐ Yes ☐ No

| Test ID | Pass | Fail | Skip | Notes |
|---|---|---|---|---|
| KB-001 | | | | |
| KB-002 | | | | |
| KB-003 | | | | |
| KB-004 | | | | |
| KB-005 | | | | |
| KB-006 | | | | |
| KB-007 | | | | |
| KB-008 | | | | |
| KB-009 | | | | |
| KB-010 | | | | |
| KB-011 | | | | |
| KB-012 | | | | |
| KB-013 | | | | |
| KB-014 | | | | |
| KB-015 | | | | |
| KB-016 | | | | |
| KB-017 | | | | |
| KB-018 | | | | |
| KB-019 | | | | |
| KB-020 | | | | |
| KB-021 | | | | |
| KB-022 | | | | |
| KB-023 | | | | |
| KB-024 | | | | |
| KB-025 | | | | |
| KB-026 | | | | |
| KB-027 | | | | |
| KB-028 | | | | |
| KB-029 | | | | |
| AR-001 | | | | |
| AR-002 | | | | |
| AR-003 | | | | |
| AR-004 | | | | |
| AR-005 | | | | |
| AR-006 | | | | |
| AR-007 | | | | |
| AR-008 | | | | |
| AR-009 | | | | |
| AR-010 | | | | |
| AR-011 | | | | |
| AR-012 | | | | |
| AR-013 | | | | |
| AR-014 | | | | |
| AR-015 | | | | |
| AR-016 | | | | |
| AR-017 | | | | |
| EN-001 | | | | |
| EN-002 | | | | |
| EN-003 | | | | |
| EN-004 | | | | |
| EN-005 | | | | |
| EN-006 | | | | |
| EN-007 | | | | |
| EN-008 | | | | |
| EN-009 | | | | |
| EN-010 | | | | |
| EN-011 | | | | |
| HI-001 | | | | |
| HI-002 | | | | |
| HI-003 | | | | |
| HI-004 | | | | |
| HI-005 | | | | |
| HI-006 | | | | |
| HI-007 | | | | |
| HI-008 | | | | |
| HI-009 | | | | |
| RL-001 | | | | |
| RL-002 | | | | |
| RL-003 | | | | |
| RL-004 | | | | |
| RL-005 | | | | |
| RL-006 | | | | |
| RL-007 | | | | |
| RL-008 | | | | |
| RL-009 | | | | |
| RL-010 | | | | |
| RL-011 | | | | |
| IN-001 | | | | |
| IN-002 | | | | |
| IN-003 | | | | |
| IN-004 | | | | |
| IN-005 | | | | |
| IN-006 | | | | |
| IN-007 | | | | |
| IN-008 | | | | |
| IN-009 | | | | |
| IN-010 | | | | |
| IN-011 | | | | |
| IN-012 | | | | |
| IN-013 | | | | |
| PR-001 | | | | |
| PR-002 | | | | |
| HL-001 | | | | |
| HL-002 | | | | |
| HL-003 | | | | |
| HL-004 | | | | |
| HL-005 | | | | |
| HL-006 | | | | |
| HL-007 | | | | |
| HL-008 | | | | |
| HL-009 | | | | |
| HL-010 | | | | |
| HL-011 | | | | |
| HL-012 | | | | |
| HL-013 | | | | |
| HL-014 | | | | |
| HL-015 | | | | |
| HL-016 | | | | |
| HL-017 | | | | |
| HL-018 | | | | |
| HL-019 | | | | |
| HL-020 | | | | |
| HL-021 | | | | |
| HL-022 | | | | |
| HL-023 | | | | |
| HL-024 | | | | |
| HL-025 | | | | |
| HL-026 | | | | |
| HL-027 | | | | |
| EV-001 | | | | |
| EV-002 | | | | |
| EV-003 | | | | |
| EV-004 | | | | |
| EV-005 | | | | |
| EV-006 | | | | |
| EV-007 | | | | |
| EV-008 | | | | |
| EV-009 | | | | |
| EV-010 | | | | |
| EV-011 | | | | |
| EV-012 | | | | |
| EV-013 | | | | |
| EV-014 | | | | |
| EV-015 | | | | |
| EV-016 | | | | |
| EV-017 | | | | |
| EV-018 | | | | |
| EV-019 | | | | |
| EV-020 | | | | |
| EV-021 | | | | |
| EV-022 | | | | |
| SS-001 | | | | |
| SS-002 | | | | |
| SS-003 | | | | |
| SS-004 | | | | |
| SS-005 | | | | |
| SS-006 | | | | |
| SS-007 | | | | |
| SS-008 | | | | |
| SS-009 | | | | |
| SS-010 | | | | |
| SS-011 | | | | |
| SS-012 | | | | |
| SS-013 | | | | |
| SS-014 | | | | |
| SS-015 | | | | |
| SS-016 | | | | |

**Defects raised**:

| Defect ID | Test case | Description | Assigned to | Status |
|---|---|---|---|---|
| | | | | |

---

*End of Phase 1 API Test Plan — QA-TP-001*
