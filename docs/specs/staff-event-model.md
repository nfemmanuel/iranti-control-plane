# Staff Event Model Spec

**Spec ID**: CP-T001
**Phase**: 0
**Author**: system_architect
**Date**: 2026-03-20
**Status**: Complete — pending PM review

---

## Overview

This spec defines the structured event model for Iranti's four Staff components: Librarian, Attendant, Archivist, and Resolutionist. It is the authoritative source for the event schema used by the Staff Activity Stream (FR3) and the event stream endpoints specified in CP-T002.

The goal is a minimal but complete event model that:
- covers all meaningful Staff actions at appropriate granularity
- is queryable by component, agent, entity, and time
- supports real-time streaming to the control plane
- avoids emitting so much signal that the stream becomes noise

---

## 1. Event Schema

Every Staff event is a JSON object conforming to the following schema. All fields are required unless marked optional.

```typescript
interface StaffEvent {
  // Unique identifier for this event instance
  eventId: string;                    // UUID v4, generated at emission time

  // When the event occurred
  timestamp: string;                  // ISO 8601, e.g. "2026-03-20T09:58:46.371Z"

  // Which Staff component emitted this event
  staffComponent: StaffComponent;     // enum — see §1.1

  // The action that occurred within the component
  actionType: string;                 // component-scoped string — see §2

  // The agent whose operation triggered this event
  agentId: string;                    // e.g. "product_manager", "backend_developer"

  // The source surface that initiated the triggering operation
  source: string;                     // e.g. "claude_code", "api", "mcp", "cli"

  // The entity type this event targets, when applicable
  entityType?: string | null;         // e.g. "ticket", "agent", "decision"

  // The entity id this event targets, when applicable
  entityId?: string | null;           // e.g. "cp_t001"

  // The specific fact key this event targets, when applicable
  key?: string | null;                // e.g. "status", "current_assignment"

  // Human-readable note from the triggering operation, when available
  reason?: string | null;

  // Whether this is an always-on audit event or a configurable debug event
  level: EventLevel;                  // enum — see §4

  // Component-specific supplementary data, schema varies by actionType
  metadata?: Record<string, unknown> | null;
}
```

### 1.1 StaffComponent Enum

```typescript
type StaffComponent =
  | "Librarian"
  | "Attendant"
  | "Archivist"
  | "Resolutionist";
```

### 1.2 EventLevel Enum

```typescript
type EventLevel =
  | "audit"    // Always emitted; operator-accountability events
  | "debug";   // Configurable; off by default in production
```

### 1.3 Concrete Example

```json
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
}
```

---

## 2. Action Types per Component

### 2.1 Librarian

The Librarian is responsible for ingesting writes, detecting conflicts, managing confidence, and deciding whether a write is created, replaced, escalated, or rejected.

| actionType | Description | Level | Rationale |
|---|---|---|---|
| `write_created` | A new fact was written (no prior entry for entity+key existed). | `audit` | State change — operators need to know what was committed. |
| `write_replaced` | An existing fact was superseded by a higher-confidence or newer write. | `audit` | Destructive to prior state — must be attributable. |
| `write_escalated` | A write conflict was detected and escalated to the Resolutionist queue. | `audit` | Escalation is a significant state transition requiring operator visibility. |
| `write_rejected` | A write was rejected (e.g. confidence too low, validation failure). | `audit` | Operators need to know when writes are silently dropped. |
| `conflict_detected` | A write conflict was identified during ingestion, before the escalation decision was made. | `debug` | Intermediate step; the escalation event already covers the outcome. |
| `write_deduplicated` | A write was received but determined to be identical to the existing value; no change was made. | `debug` | Routine; useful for tracing but not operator-relevant at audit level. |
| `confidence_adjusted` | The Librarian modified the confidence score of a fact during ingestion. | `debug` | Internal computation step. |

**metadata shape for Librarian events:**

```typescript
interface LibrarianEventMetadata {
  confidence?: number;           // 0–100, for write_created / write_replaced
  priorConfidence?: number;      // for write_replaced — what was displaced
  valuePreview?: string;         // truncated JSON string of the value
  conflictReason?: string;       // for write_escalated / conflict_detected
  rejectionReason?: string;      // for write_rejected
  escalationId?: string;         // for write_escalated — UUID of the escalation file/record
}
```

---

### 2.2 Attendant

The Attendant manages agent working-memory briefs: handshakes load relevant context, attend/observe/reconvene retrieve or refresh it.

| actionType | Description | Level | Rationale |
|---|---|---|---|
| `handshake_completed` | An agent completed a session handshake and received a working-memory brief. | `debug` | Routine per-session event; useful for debugging but not operator-critical unless showing session cadence. |
| `attend_completed` | A per-turn attend call retrieved relevant memory for the agent. | `debug` | High-frequency; operators only need this for tracing, not routine observability. |
| `observe_completed` | An observe call recorded a new observation into the agent's working memory. | `debug` | Internal memory update; routine. |
| `reconvene_completed` | A reconvene call refreshed the agent's working-memory brief mid-session. | `audit` | Reconvene is a meaningful mid-session context reset — auditable when it occurs. |
| `session_expired` | An agent's working-memory session expired or was evicted. | `audit` | Session lifecycle event — relevant for diagnosing context loss. |
| `brief_empty` | A handshake or attend returned an empty brief (no relevant memory found). | `debug` | Diagnostic signal for memory coverage issues. |

**metadata shape for Attendant events:**

```typescript
interface AttendantEventMetadata {
  briefSize?: number;            // number of facts in the returned brief
  taskSummary?: string;          // truncated task description from handshake
  relevantEntities?: string[];   // entity ids surfaced in the brief
  sessionId?: string;            // internal session identifier
}
```

---

### 2.3 Archivist

The Archivist transitions facts from the knowledge base to the archive: decay, escalation processing, and resolution consumption.

| actionType | Description | Level | Rationale |
|---|---|---|---|
| `entry_archived` | A KB entry was moved to the archive (decay, supersession, or manual archive). | `audit` | Removes a fact from the active KB — operators must be able to trace this. |
| `entry_decayed` | An entry was archived specifically due to age/decay policy, not conflict. | `audit` | Distinct from conflict archival; important for diagnosing why facts disappear. |
| `escalation_processed` | The Archivist processed an escalation file from the Resolutionist queue. | `audit` | Represents the Archivist consuming a resolution decision — traceable state change. |
| `resolution_consumed` | An archive entry's resolutionState was updated from `pending` to `resolved`. | `audit` | Resolution lifecycle completion — must be auditable. |
| `archive_scan_completed` | The Archivist completed a periodic scan for decayable or resolvable entries. | `debug` | Routine background job; not operator-relevant unless debugging decay behavior. |
| `archive_read` | The Archivist read from the archive to support a query or conflict check. | `debug` | Read-only internal operation; debug only. |

**metadata shape for Archivist events:**

```typescript
interface ArchivistEventMetadata {
  archivedReason?: string;       // e.g. "decay", "superseded", "conflict_resolved"
  archivedFactId?: string;       // KB or archive row identifier
  escalationId?: string;         // for escalation_processed / resolution_consumed
  decayPolicy?: string;          // which decay rule triggered entry_decayed
  entriesScanned?: number;       // for archive_scan_completed
}
```

---

### 2.4 Resolutionist

The Resolutionist reviews escalations, files resolution decisions, and applies or rejects resolutions.

| actionType | Description | Level | Rationale |
|---|---|---|---|
| `resolution_filed` | A resolution decision was written to the escalation queue. | `audit` | Initiates a state change to a conflicted fact — must be attributable. |
| `resolution_applied` | A filed resolution was applied — the winning value was written back to the KB. | `audit` | Terminal outcome of a conflict — highest-importance audit event. |
| `resolution_rejected` | A resolution was rejected (e.g. invalid decision, post-deadline). | `audit` | Rejection of a resolution is a significant error-state outcome. |
| `escalation_reviewed` | The Resolutionist reviewed an escalation without yet filing a resolution. | `debug` | Intermediate review step; the resolution_filed event covers the outcome. |
| `escalation_deferred` | An escalation was deferred — no resolution was made this cycle. | `audit` | Operators need to know when conflicts are aging without resolution. |
| `escalation_expired` | An escalation exceeded its TTL without resolution and was expired. | `audit` | Represents data loss potential — must be visible to operators. |

**metadata shape for Resolutionist events:**

```typescript
interface ResolutionistEventMetadata {
  escalationId?: string;         // UUID or file path of the escalation
  conflictingAgents?: string[];  // which agents wrote the conflicting facts
  winnerSource?: string;         // for resolution_applied — "existing" | "challenger" | "custom"
  resolutionNote?: string;       // human-readable rationale from the resolution
  deferralReason?: string;       // for escalation_deferred
}
```

---

## 3. Persistence Strategy

### Option 1: Append-Only DB Table (`staff_events`)

**Description**: A new `staff_events` table in the existing PostgreSQL database. Each event is a row. Columns map directly to the StaffEvent schema. The table is append-only by convention (no updates or deletes from application code).

**Schema sketch:**

```sql
CREATE TABLE staff_events (
  event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
  staff_component TEXT NOT NULL,           -- 'Librarian' | 'Attendant' | 'Archivist' | 'Resolutionist'
  action_type     TEXT NOT NULL,
  agent_id        TEXT NOT NULL,
  source          TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       TEXT,
  key             TEXT,
  reason          TEXT,
  level           TEXT NOT NULL,           -- 'audit' | 'debug'
  metadata        JSONB
);

CREATE INDEX idx_staff_events_timestamp    ON staff_events (timestamp DESC);
CREATE INDEX idx_staff_events_component    ON staff_events (staff_component);
CREATE INDEX idx_staff_events_agent        ON staff_events (agent_id);
CREATE INDEX idx_staff_events_entity       ON staff_events (entity_type, entity_id);
CREATE INDEX idx_staff_events_level        ON staff_events (level);
```

**Pros:**
- Fully queryable with arbitrary filters (component, agent, entity, key, level, time range).
- Survives process restart — events are durable.
- Works with existing PostgreSQL infrastructure — no new dependencies.
- Supports pagination via `LIMIT/OFFSET` and keyset pagination via `timestamp`.
- Can be queried by the control plane directly through existing DB connection.
- Retention can be managed with a simple `DELETE WHERE timestamp < now() - interval '30 days'` cron or trigger.
- Last N events, streaming since a cursor, and filter combinations are all standard SQL.

**Cons:**
- Requires a schema migration to add the `staff_events` table.
- Write overhead per event (every Librarian/Archivist operation writes a row). For high-throughput local use, this is acceptable; for extremely frequent debug events, it may add latency.
- Debug-level events at scale could grow the table quickly if not TTL-managed.

**Implementation complexity**: Low to medium. Schema migration + a thin emit function in each Staff component. The existing Postgres connection is already available.

**Query capability**: Excellent — full SQL expressiveness.

**Retention**: Configurable. Default recommendation: keep `audit` events for 90 days, `debug` events for 7 days, with a background cleanup job.

---

### Option 2: Structured Log File (Append-Only JSONL)

**Description**: Each Staff event is written as a single JSON line to a rotating `.jsonl` file in the Iranti runtime directory (e.g., `~/.iranti/logs/staff-events.jsonl`).

**Pros:**
- Zero DB schema change required.
- Simple to implement — standard file append.
- Easy to inspect manually with `tail`, `jq`, or any log viewer.
- Familiar to operators with a syslog background.

**Cons:**
- Querying requires parsing the entire file or an auxiliary index — no native filter-by-component or filter-by-entity without scanning.
- Streaming requires `tail -f` emulation, which is platform-specific (difficult on Windows without a special implementation).
- Log rotation adds complexity if the file grows large.
- Cross-restart durability depends on the file being on a persistent path.
- Multiple concurrent writers may interleave partial lines without atomic write guards.

**Implementation complexity**: Low to write, moderate to query. Building a JSONL query layer that supports all required filter combinations is non-trivial.

**Query capability**: Poor for structured queries. Requires full-file scan or an external tool (grep, jq) — not suitable for the control plane to call programmatically.

**Retention**: File-rotation-based. Harder to enforce per-field retention rules (audit vs debug).

---

### Option 3: In-Memory Ring Buffer

**Description**: Each Staff component writes events to a shared in-process ring buffer (e.g., a fixed-size circular array of the last N events). The control plane reads from the buffer directly.

**Pros:**
- Zero I/O overhead — pure memory operation.
- Zero schema migration.
- Fastest possible emit path.

**Cons:**
- All events lost on process restart. This is a dealbreaker for audit-grade events — operators need to diagnose issues that may occur across restarts.
- Buffer size limits how far back you can look (e.g., last 1000 events). If a high-volume burst occurs, earlier events are evicted silently.
- No persistence means no "what happened yesterday" queries.
- Streaming requires a polling loop against the buffer — no push mechanism without additional infrastructure.
- Not queryable by external processes without an IPC bridge.

**Implementation complexity**: Low to implement, high to make reliable across restarts, process isolation, and concurrent access.

**Query capability**: Limited to what is currently in the buffer. No historical queries.

**Retention**: Ephemeral — survives only as long as the Iranti process is running.

---

### Recommendation: Option 1 — Append-Only DB Table

**Rationale:**

The control plane's core requirement for the Staff Activity Stream (FR3) is:
> filter by component, filter by agent, filter by entity, show last N events, and stream new events

All five of these requirements are trivially satisfied by a DB table with appropriate indexes. Options 2 and 3 would require significant custom infrastructure to match this.

The most important design constraint for this project is that **audit-grade events must survive a process restart**. Operators need to diagnose "why did that write conflict" after the fact, potentially hours or days later. Option 3 is disqualified on this basis alone. Option 2 is disqualified by poor query capability and the Windows streaming problem.

The schema migration cost is real but low: one table, five indexes, and a thin emit helper added to each Staff component. This is a one-time cost that pays for itself with every debugging session.

**Debug event volume concern (addressed):** Debug-level events are off by default in production. When enabled, a shorter retention window (7 days) and optional per-session scoping limit table growth.

---

## 4. Event Levels

### Definitions

**`audit`** — Always emitted, regardless of runtime configuration. These events cover state changes that operators need for accountability and post-hoc diagnosis. Turning these off is not supported.

**`debug`** — Off by default. Configurable at runtime via environment variable or Iranti config (e.g., `IRANTI_STAFF_DEBUG_EVENTS=true`). These cover intermediate computation steps, read operations, and routine background activity. They are useful during development and active debugging but produce noise in normal operation.

### Level Assignment by Action Type

#### Librarian

| actionType | Level | Rationale |
|---|---|---|
| `write_created` | `audit` | New fact committed — operator-accountable state change. |
| `write_replaced` | `audit` | Prior fact superseded — destructive to existing state. |
| `write_escalated` | `audit` | Conflict detected and queued — significant lifecycle event. |
| `write_rejected` | `audit` | Write dropped — operators need to know when writes fail silently. |
| `conflict_detected` | `debug` | Intermediate step before escalation decision is made. |
| `write_deduplicated` | `debug` | No-op — identical value received. Routine. |
| `confidence_adjusted` | `debug` | Internal computation; outcome visible in write_created/replaced. |

#### Attendant

| actionType | Level | Rationale |
|---|---|---|
| `handshake_completed` | `debug` | Routine session start; every agent call emits this. Too frequent for audit. |
| `attend_completed` | `debug` | Per-turn retrieval; high-frequency, low-criticality. |
| `observe_completed` | `debug` | Internal working-memory update; routine. |
| `reconvene_completed` | `audit` | Mid-session context reset — meaningful when it occurs. |
| `session_expired` | `audit` | Session lifecycle event — context loss is operator-relevant. |
| `brief_empty` | `debug` | Diagnostic signal but not a state change. |

#### Archivist

| actionType | Level | Rationale |
|---|---|---|
| `entry_archived` | `audit` | Fact removed from active KB — must be traceable. |
| `entry_decayed` | `audit` | Fact removed due to policy — operators need to know why facts disappear. |
| `escalation_processed` | `audit` | Archivist consumed a resolution decision — state change. |
| `resolution_consumed` | `audit` | Conflict resolution finalized — terminal lifecycle event. |
| `archive_scan_completed` | `debug` | Routine background job. |
| `archive_read` | `debug` | Read-only; no state change. |

#### Resolutionist

| actionType | Level | Rationale |
|---|---|---|
| `resolution_filed` | `audit` | Resolution decision written — initiates state change. |
| `resolution_applied` | `audit` | Conflict resolved — highest-importance audit event. |
| `resolution_rejected` | `audit` | Resolution attempt failed — must be visible. |
| `escalation_reviewed` | `debug` | Intermediate review step before filing. |
| `escalation_deferred` | `audit` | Conflict aging without resolution — operator attention warranted. |
| `escalation_expired` | `audit` | Conflict TTL exceeded — data loss potential. |

---

## 5. Streaming Approach

### Options Considered

**Option A: SSE (Server-Sent Events) polling DB**
The control plane backend opens a long-lived HTTP connection. The server polls `staff_events WHERE timestamp > :cursor ORDER BY timestamp ASC LIMIT 50` on a short interval (e.g., 1–2 seconds) and pushes new rows as SSE events.

**Option B: WebSocket**
Bidirectional persistent connection. The server pushes events to connected clients; clients can send filter updates.

**Option C: Tail-follow of log file**
Backend tails the JSONL log file and streams lines to connected clients over HTTP or WebSocket.

### Recommendation: Option A — SSE with DB polling

**Rationale:**

For a local-only deployment with a single operator dashboard:

1. **SSE is sufficient for unidirectional streaming** — the operator only reads the event stream; there is no need for client-to-server messages over the stream channel.
2. **SSE is natively supported by every browser** without additional libraries, and is simpler to implement server-side than WebSocket (no handshake protocol, no frame encoding).
3. **DB polling at 1-second intervals is imperceptible latency for local use** and does not meaningfully load a local PostgreSQL instance.
4. **Cursor-based polling is resume-safe** — if the browser tab loses focus or the connection drops, the client reconnects with its last `eventId` and receives all missed events without gaps.
5. **Reconnection handling is built into the SSE protocol** via the `Last-Event-ID` header.

Option B (WebSocket) adds implementation complexity without providing benefits in a local, unidirectional streaming scenario. Option C (log file tail) is disqualified because we chose DB persistence in §3.

**Implementation sketch for the SSE endpoint:**

```
GET /api/control-plane/events/stream
  → Content-Type: text/event-stream
  → Poll: SELECT * FROM staff_events WHERE timestamp > :cursor [AND filters] ORDER BY timestamp ASC LIMIT 50
  → Every new row: write "data: {json}\n\nid: {eventId}\n\n"
  → Heartbeat: write ": keep-alive\n\n" every 15 seconds
  → Reconnect: browser sends Last-Event-ID header; server resumes from that eventId
```

---

## 6. Proposed Upstream Changes

The following changes are proposed for the upstream Iranti core. These are **out of scope for this repository to implement**. They are documented here so the PM can assess feasibility and sequence them against Iranti's own roadmap.

> **FLAG: All items in this section are proposed upstream changes — requires PM review before acting on.**

### 6.1 Librarian — Add event emission hooks

The Librarian currently handles writes, conflict detection, and escalation. It needs to call an event emitter at each decision point:
- After `write_created` or `write_replaced`: emit with entity, key, confidence, source.
- Before escalation: emit `conflict_detected`.
- On escalation: emit `write_escalated` with escalationId.
- On rejection: emit `write_rejected` with rejection reason.

**Proposed change**: Add an optional `EventEmitter` dependency injected into the Librarian constructor. If present, emit at each decision point. If absent (default in existing deployments without the control plane), the Librarian behaves identically to today.

### 6.2 Attendant — Add session lifecycle events

The Attendant manages working-memory briefs. It needs to emit:
- `handshake_completed` after building a brief.
- `attend_completed` after a per-turn retrieval.
- `reconvene_completed` after a mid-session reconvene.
- `session_expired` when a session TTL passes.

**Proposed change**: Same pattern as Librarian — optional injected emitter.

### 6.3 Archivist — Add archive lifecycle events

The Archivist transitions KB entries to the archive. It needs to emit:
- `entry_archived` / `entry_decayed` when entries are moved.
- `escalation_processed` and `resolution_consumed` when escalation files are consumed.

**Proposed change**: Same pattern.

### 6.4 Resolutionist — Add resolution decision events

The Resolutionist files and applies resolutions. It needs to emit:
- `resolution_filed` when a decision is written.
- `resolution_applied` or `resolution_rejected` at outcome.
- `escalation_deferred` / `escalation_expired` for aging or TTL violations.

**Proposed change**: Same pattern.

### 6.5 Shared EventEmitter interface

To keep upstream changes cohesive, a shared `IStaffEventEmitter` interface should be defined in the Iranti core, with a no-op default implementation. The DB-backed emitter (writing to `staff_events`) lives in the control plane backend and is injected at startup when the control plane is active.

```typescript
// Proposed upstream interface — in-scope for PM to approve or reject
interface IStaffEventEmitter {
  emit(event: Omit<StaffEvent, 'eventId' | 'timestamp'>): void;
}

class NoopEventEmitter implements IStaffEventEmitter {
  emit(_event: Omit<StaffEvent, 'eventId' | 'timestamp'>): void {}
}
```

This pattern ensures zero behavioral change in existing Iranti deployments that do not activate the control plane.

---

## 7. Open Questions

1. **Upstream access**: The Iranti core codebase was not directly inspected during this spike. The proposed upstream changes in §6 are based on architectural inference from the PRD and ticket descriptions. The PM should verify whether the Librarian, Attendant, Archivist, and Resolutionist are implemented in a way that supports injection before committing to the proposed emitter pattern.

2. **Event volume at audit level**: In a high-frequency agent session, `write_created` and `write_replaced` could emit hundreds of events per minute. The DB table approach handles this, but the control plane's event stream view will need client-side throttling (e.g., batch updates at 1-second intervals) to remain readable. This is a Phase 1 UI concern, but the backend spec should plan for it.

3. **Escalation file format**: `escalation_deferred` and `escalation_expired` events reference escalation IDs. If the Resolutionist uses file-based escalations (markdown files), the "escalation ID" may be a file path rather than a UUID. The spec assumes a UUID-or-path string is acceptable in `metadata.escalationId` for now — to be confirmed when upstream is inspected.

4. **Multi-instance**: If multiple Iranti instances run on the same host and share a PostgreSQL database, events from all instances will appear in the same `staff_events` table. An `instanceId` field is not in the current schema. This may need to be added if CP-T003 surfaces multiple-instance scenarios. Flagged for PM awareness.

---

## 8. Acceptance Criteria Check

- [x] Event schema covers all 4 Staff components with at least 3 distinct action types per component.
- [x] Each event type definition includes all required fields (staffComponent, actionType, entityType, entityId, key, agentId, source, reason, timestamp, level).
- [x] Persistence strategy documents at least 3 options with explicit tradeoffs; recommended option identified with rationale.
- [x] Event levels defined with clear, implementable separation; level assigned to every action type with rationale.
- [x] Spec is concrete enough for backend_developer to implement the event bus.
- [x] Proposed upstream changes flagged clearly as out-of-scope for this repo.
- [ ] PM review: pending.
