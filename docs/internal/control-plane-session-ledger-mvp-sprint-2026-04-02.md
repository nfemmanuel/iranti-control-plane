# Control Plane Session Ledger MVP — Sprint Plan
**Date:** 2026-04-02
**Author:** Orchestrator (claude_code)
**Status:** In progress

---

## Goal

Turn the per-instance Iranti session ledger into a true fleet-wide control-plane-visible ledger using a **pull-based mirror model**. At least two instances can be ingested. Duplicate polls do not duplicate rows. Operators can filter by instance, host, session, and action type. Ingestion health is visible per instance.

---

## Architecture: Pull-Mirror Model

```
Per-instance Iranti (source of truth)
  staff_events table (local DB)
  ↓ exposed via /memory/ledger API
Control Plane Poller
  ↓ polls periodically, bounded batches of 250
  ↓ upserts with ON CONFLICT DO NOTHING
Control Plane DB (mirror)
  mirrored_staff_events
  instance_ledger_watermarks
  ↓ queried by fleet API
Fleet Query API
  GET /api/control-plane/session-ledger
  GET /api/control-plane/session-ledger/ingestion-health
  ↓ consumed by
Operator UI
  Fleet Ledger Stream + Ingestion Health Panel
```

**Hard constraints:**
- Runtime write paths (per-instance) remain independent of CP availability
- No push streaming, no event emission coupling
- Mirror table is CP-local only — never write back to instances
- Watermark uses both timestamp AND remote_event_id
- Batches are bounded at 250; drain until caught up if batch fills

---

## Shared Interface Contracts

### Migration 004: Fleet Ledger Tables

**File:** `src/server/migrations/004_create_fleet_ledger.sql`

```sql
CREATE TABLE IF NOT EXISTS mirrored_staff_events (
  id                BIGSERIAL PRIMARY KEY,
  instance_id       TEXT NOT NULL,
  remote_event_id   TEXT NOT NULL,
  timestamp         TIMESTAMPTZ NOT NULL,
  staff_component   VARCHAR(32) NOT NULL,
  action_type       VARCHAR(64) NOT NULL,
  agent_id          TEXT,
  source            TEXT,
  host              TEXT,
  session_id        TEXT,
  entity_type       TEXT,
  entity_id         TEXT,
  key               TEXT,
  reason            TEXT,
  level             VARCHAR(16) NOT NULL DEFAULT 'audit',
  metadata          JSONB,
  ingested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instance_id, remote_event_id)
);

CREATE TABLE IF NOT EXISTS instance_ledger_watermarks (
  instance_id             TEXT PRIMARY KEY,
  last_event_timestamp    TIMESTAMPTZ,
  last_remote_event_id    TEXT,
  last_polled_at          TIMESTAMPTZ,
  last_poll_succeeded     BOOLEAN NOT NULL DEFAULT true,
  last_poll_error         TEXT,
  consecutive_failures    INTEGER NOT NULL DEFAULT 0,
  total_events_ingested   BIGINT NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Indexes required on `mirrored_staff_events`:
- `(timestamp DESC)` — primary stream query
- `(instance_id, timestamp DESC)` — per-instance filter
- `(agent_id)` — agent filter
- `(action_type)` — action type filter
- `(session_id)` — session filter

### Fleet Ledger API Types

**`FleetLedgerEvent`:**
```typescript
{
  id: number
  instanceId: string
  remoteEventId: string
  timestamp: string          // ISO
  staffComponent: string
  actionType: string
  agentId: string | null
  source: string | null      // raw source value
  host: string | null        // raw host from metadata
  sessionId: string | null
  entityType: string | null
  entityId: string | null
  key: string | null
  reason: string | null
  level: 'audit' | 'debug'
  metadata: Record<string, unknown> | null
  ingestedAt: string         // ISO
}
```

**`FleetLedgerResponse`:**
```typescript
{
  items: FleetLedgerEvent[]
  total: number
  fetchedAt: string
  note?: string
}
```

**`IngestionHealthEntry`:**
```typescript
{
  instanceId: string
  lastEventTimestamp: string | null
  lastRemoteEventId: string | null
  lastPolledAt: string | null
  lastPollSucceeded: boolean
  lastPollError: string | null
  consecutiveFailures: number
  totalEventsIngested: number
  status: 'healthy' | 'degraded' | 'failing' | 'never_polled'
}
```

**`IngestionHealthResponse`:**
```typescript
{
  instances: IngestionHealthEntry[]
  fetchedAt: string
}
```

### Fleet API Endpoints

**`GET /api/control-plane/session-ledger`**

Query params:
- `instanceId` — filter by instance
- `source` — filter by raw source
- `host` — filter by raw host
- `agentId` — filter by agent
- `sessionId` — filter by session
- `actionType` — filter by action type
- `since` — ISO timestamp lower bound (inclusive)
- `until` — ISO timestamp upper bound (inclusive)
- `level` — 'audit' | 'debug'
- `limit` — integer 1–250, default 100

Response: `FleetLedgerResponse`
Order: `timestamp DESC, remote_event_id DESC` (stable)

**`GET /api/control-plane/session-ledger/ingestion-health`**

Response: `IngestionHealthResponse`

### Poller Interface

The poller (`src/server/lib/fleet-ledger-poller.ts`) exports:
```typescript
export function startFleetLedgerPoller(): void
export function stopFleetLedgerPoller(): void
export async function pollAllInstancesOnce(): Promise<void>
```

Poll interval: 60 seconds (configurable via `FLEET_LEDGER_POLL_INTERVAL_MS` env var)

Instance discovery: iterate all runtime root candidates, enumerate instance dirs, read `.env` to get `IRANTI_PORT`/`IRANTI_URL` and `IRANTI_API_KEY`.

Instance Iranti API: `GET ${apiBaseUrl}/memory/ledger?since=<ISO>&limit=250&level=audit`

Watermark advancement: only advance after successful upsert batch. If poll fails, record failure in watermarks and continue with next instance.

### Repo Helper Interface

File: `src/server/lib/fleet-ledger-repo.ts`

```typescript
export interface MirroredEvent { ... }   // matches DB columns camelCase
export interface WatermarkRow { ... }    // matches DB columns camelCase

export async function upsertMirroredEvents(events: MirroredEventInsert[]): Promise<number>
export async function advanceWatermark(instanceId: string, lastTimestamp: string, lastRemoteEventId: string, eventsCount: number): Promise<void>
export async function recordPollFailure(instanceId: string, error: string): Promise<void>
export async function getWatermark(instanceId: string): Promise<WatermarkRow | null>
export async function getAllWatermarks(): Promise<WatermarkRow[]>
export async function queryFleetLedger(filters: FleetLedgerFilters): Promise<{ items: MirroredEvent[], total: number }>
```

---

## Agent Ownership Matrix

| Agent | Owns | Must not touch |
|-------|------|----------------|
| 1 — Schema | `migrations/004_*.sql`, `migrations/runner.ts`, `lib/fleet-ledger-repo.ts` | All dirty files, existing migrations |
| 2 — Poller | `lib/fleet-ledger-poller.ts`, `index.ts` (start/stop poller hooks only) | All dirty files, routes |
| 3 — Fleet API | `routes/control-plane/session-ledger.ts`, `routes/control-plane/index.ts` | All dirty files, other routes, sessions.ts |
| 4 — UI | `client/src/components/sessions/FleetLedgerView.tsx`, `client/src/components/sessions/FleetLedgerView.module.css`, `client/src/api/fleet-ledger.ts` | All dirty files (esp. SessionsView.tsx, types.ts, client.ts) |
| 5 — Validation | `tests/unit/fleet-ledger-*.test.ts`, `docs/guides/fleet-ledger-operator.md` | All dirty files, implementation files |

### Dirty files — DO NOT TOUCH:
- `package-lock.json`, `package.json`
- `src/client/src/api/client.ts`
- `src/client/src/api/types.ts`
- `src/client/src/components/instances/ApiKeyManager.tsx`
- `src/client/src/components/instances/InstanceManager.tsx`
- `src/client/src/components/sessions/SessionsView.module.css`
- `src/client/src/components/sessions/SessionsView.tsx`
- `src/server/routes/control-plane/auth-keys.ts`
- `src/server/routes/control-plane/instance-lifecycle.ts`
- `src/server/routes/control-plane/repair.ts`
- `src/server/routes/control-plane/sessions.ts`
- `src/server/tests/unit/auth-keys-routes.test.ts`
- `src/server/tests/unit/instance-lifecycle-provider-normalization.test.ts`

### Untracked (new) — can read but coordinate writes:
- `src/server/lib/db-provision.ts` — owned by prior work, read-only for all agents
- `src/server/tests/unit/sessions-ledger-routes.test.ts` — owned by prior work, read-only for all agents

---

## Definition of Done

- [ ] `mirrored_staff_events` and `instance_ledger_watermarks` tables exist with migrations
- [ ] Uniqueness on `(instance_id, remote_event_id)` enforced at DB level
- [ ] Poller enumerates all instances, fetches bounded batches, upserts idempotently
- [ ] Watermark advances only on success; failures recorded without advancing
- [ ] `GET /api/control-plane/session-ledger` returns filtered, ordered, bounded fleet events
- [ ] `GET /api/control-plane/session-ledger/ingestion-health` returns per-instance health
- [ ] UI shows fleet ledger stream with filter controls and ingestion health panel
- [ ] Tests cover: idempotent ingest, same-timestamp ordering, failed poll, multi-instance
- [ ] Operator docs explain per-instance source of truth vs mirrored CP ledger
