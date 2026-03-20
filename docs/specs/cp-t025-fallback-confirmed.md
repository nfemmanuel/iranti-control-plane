# CP-T025 — Fallback Design Confirmation
## Enhanced Polling Strategy When Native Emitter Is Unavailable

**Spec ID**: CP-T025-fallback
**Author**: system_architect
**Date**: 2026-03-20
**Status**: Confirmed — ready for implementation if upstream PR is rejected or unmerged
**Parent spec**: `docs/specs/cp-t025-emitter-design.md` §11
**Implementation target**: `src/server/routes/control-plane/events.ts` (extend existing poller)

---

## 1. Trigger Condition

The fallback activates under either of these conditions:

**Condition A — Upstream PR rejected**: The maintainer of the Iranti package declines to merge `IStaffEventEmitter` injection. The `staff_events` table still exists (the control plane migration was applied), but it receives no rows from the Iranti server because no emitter is writing to it. The SSE stream returns an empty feed for Attendant and Resolutionist.

**Condition B — Control plane running without the upstream patch**: The Iranti server is running at version ≤ 0.2.9 (unpatched). The control plane is deployed and connected to the same database. The `staff_events` table exists but is empty or contains only manually inserted test rows.

In both cases, the control plane falls back to inferring Staff activity by polling the `knowledge_base` table (for Librarian) and the `archive` table (for Archivist). No code path in the control plane changes based on which condition triggered the fallback — the poller runs identically in both cases.

**Detection**: At SSE stream startup, the control plane can check whether the `staff_events` table has received any rows in the last 60 seconds. If not, it switches to the enhanced fallback poller and emits a structured `info` SSE event informing the client that the stream is operating in inferred mode. This detection is optional — the fallback poller is always safe to run regardless.

---

## 2. Poll Interval

**Confirmed interval: 500ms.**

The existing Phase 1 SSE poller runs at 1000ms (`POLL_INTERVAL_MS = 1000` in `src/server/routes/control-plane/events.ts`). The fallback poller reduces this to 500ms.

**Feasibility assessment:**

The control plane is explicitly designed for local-first, single-operator use. The Iranti server and the control plane share the same PostgreSQL (or SQLite) database instance running on the same machine. At 500ms polling:

- Each SSE connection issues 2 poll rounds per second.
- Each round executes 2 queries: one against `knowledge_base` (or equivalent Prisma-managed table), one against `archive`.
- Total: 4 queries per second per active SSE connection.
- For a single operator with one active browser tab: **4 queries/second** against a local database.

This is unambiguously acceptable for a local PostgreSQL instance, which comfortably handles 10,000+ simple indexed queries per second on consumer hardware. Even SQLite (if used by some Iranti deployments) handles sequential reads at this rate without issue. There is no connection pool pressure because the control plane's `pg.Pool` has a default pool size of 10 and each fallback poll query completes in <5ms on local hardware.

**At 500ms interval:**
- Queries per minute: 4 queries/second × 60 seconds = **240 queries/minute** (per active SSE connection).
- Expected query duration: 1–5ms each (indexed cursor scan on `created_at` / `archived_at`).
- CPU overhead: negligible on the DB server.
- Verdict: **feasible without reservation**.

---

## 3. Attendant Proxy

**Coverage without native emitter: zero — no DB table records Attendant activity.**

The `AttendantInstance` class maintains in-memory state and writes to no table directly. The `iranti_attend` function writes facts to the `knowledge_base` table, but those writes are attributed to the agent that called `attend` — they are indistinguishable from any other `iranti_write` call at the DB level. There is no `attendant_sessions` table, no `handshake_log` table, and no dedicated row written by `handshake()` or `reconvene()`.

**Consequence**: Attendant events (`handshake_completed`, `attend_completed`, `reconvene_completed`, `session_expired`) cannot be recovered from database polling under the fallback. The Staff Activity Stream will show no events for the Attendant component until native emitter injection is available.

**Partial proxy (imprecise)**: It is possible to infer Attendant activity by watching the `knowledge_base` table for writes whose `source` column equals `'mcp'` — most MCP writes go through the Attendant's working memory session. However, this is an unreliable heuristic: `source = 'mcp'` does not guarantee the write originated from an Attendant-managed session, and it does not distinguish `handshake_completed` from `attend_completed`. This heuristic is NOT included in the fallback poller because it would produce misleading events labelled as Attendant activity when they are simply Librarian writes from an MCP source.

**Columns to watch (for future native emitter — reference only)**:
If a future Iranti version adds a lightweight `attendant_events` table, the relevant columns would be: `agent_id`, `event_type` (`handshake | attend | reconvene`), `session_started_at`, `context_call_count`, `brief_size`, `timestamp`. The fallback poller would be extended to query this table identically to the `staff_events` cursor pattern.

---

## 4. Resolutionist Proxy

**Coverage without native emitter: zero — resolution decisions are written to markdown files on the filesystem, not to any database table.**

The Resolutionist's `resolveInteractive()` function writes a modified escalation file to disk (typically under `~/.iranti/escalations/`). The Archivist later reads these files and processes them, updating the `archive` table's `resolution_state` column. However:

- The Resolutionist's decision itself (which option the operator chose, when they chose it) is only recorded in the file content, not in any queryable row.
- The timestamp of `resolution_filed` is therefore not recoverable from the DB until the Archivist processes the file and writes back — which may happen many minutes later.
- File system polling (watching for `mtime` changes on escalation files) is fragile on Windows 11 and is explicitly ruled out: `fs.watch` on Windows uses I/O completion ports with known edge cases around network drives and WSL paths; the control plane should not take a filesystem watcher dependency.

**Consequence**: `resolution_filed` and `escalation_deferred` events are unrecoverable from any fallback strategy. The stream will be silent for Resolutionist activity.

**Partial proxy via archive table (deferred outcomes only)**:
Once the Archivist processes a resolution file, it updates the `archive` row's `resolution_state` to `'resolved'`. The fallback poller can detect this by watching for archive rows where `resolution_state` changes from null to `'resolved'` — but this captures the Archivist's consumption of the resolution, not the Resolutionist's filing of it. It can be surfaced as a synthetic `resolution_consumed` event attributed to the Archivist, with a note that it represents deferred detection.

**Filter for this proxy** (Archivist resolution consumption via archive table):

```sql
-- Detect Resolutionist resolutions as processed by Archivist
-- Poll cursor: archived_at (or a resolution_updated_at column if available)
SELECT
  id,
  entity_type,
  entity_id,
  key,
  archived_at,
  archived_reason,
  resolution_state
FROM archive
WHERE
  resolution_state = 'resolved'
  AND archived_at > $cursor
ORDER BY archived_at ASC
LIMIT 50
```

This query emits a synthetic event with `staffComponent: 'Archivist'`, `actionType: 'resolution_consumed'` — not `resolution_filed`. The distinction must be communicated to the operator in the UI (e.g., a tooltip: "Detected when Archivist processed the resolution, not when it was filed").

---

## 5. SSE Broadcast Shape — Polled Row to StaffEvent

The existing `serializeEventRow()` function in `events.ts` handles rows from the `staff_events` table. The fallback poller synthesizes `StaffEvent` objects from `knowledge_base` and `archive` rows using a parallel serializer. The shape must be identical to a native `StaffEvent` so the frontend's existing event rendering code requires no changes.

### Librarian events (from knowledge_base)

The Prisma-managed table name may be `knowledge_entry` or `knowledge_base` depending on the Iranti schema version. The fallback queries the table directly via raw SQL through the `pg` pool (same pattern as `events.ts`).

**Inferred write_created:**

```typescript
// Triggered by: new row in knowledge_base with created_at > cursor
{
  eventId: `inferred-${row.id}`,          // Stable synthetic ID from row primary key
  timestamp: row.created_at.toISOString(),
  staffComponent: 'Librarian',
  actionType: 'write_created',
  agentId: row.created_by,
  source: row.source ?? 'unknown',
  entityType: row.entity_type,
  entityId: row.entity_id,
  key: row.key,
  reason: null,
  level: 'audit',
  metadata: {
    confidence: row.confidence,
    inferredEvent: true,                   // Flag: this is a polled inference, not native
  },
  emittedAt: null,
  deliveredAt: new Date().toISOString(),
  latencyMs: null,
}
```

**Inferred write_replaced / write_escalated (from archive table):**

```typescript
// Triggered by: new row in archive with archived_at > cursor
// archived_reason determines the actionType mapping:
//   'superseded'  → write_replaced   (staffComponent: Librarian)
//   'escalated'   → write_escalated  (staffComponent: Librarian)
//   'expired'     → entry_archived   (staffComponent: Archivist)
//   'decay'       → entry_decayed    (staffComponent: Archivist)

const ACTION_TYPE_MAP: Record<string, { actionType: string; staffComponent: StaffComponent }> = {
  superseded:  { actionType: 'write_replaced',    staffComponent: 'Librarian'  },
  escalated:   { actionType: 'write_escalated',   staffComponent: 'Librarian'  },
  expired:     { actionType: 'entry_archived',    staffComponent: 'Archivist'  },
  decay:       { actionType: 'entry_decayed',     staffComponent: 'Archivist'  },
  resolved:    { actionType: 'resolution_consumed', staffComponent: 'Archivist' },
};

// Synthesized StaffEvent:
{
  eventId: `inferred-archive-${row.id}`,
  timestamp: row.archived_at.toISOString(),
  staffComponent: mapped.staffComponent,
  actionType: mapped.actionType,
  agentId: row.archived_by ?? 'archivist',
  source: 'internal',
  entityType: row.entity_type,
  entityId: row.entity_id,
  key: row.key,
  reason: row.archived_reason,
  level: 'audit',
  metadata: {
    archivedReason: row.archived_reason,
    archivedFactId: String(row.id),
    inferredEvent: true,
  },
  emittedAt: null,
  deliveredAt: new Date().toISOString(),
  latencyMs: null,
}
```

**Key invariant**: Synthesized events include `metadata.inferredEvent: true`. The frontend's ActivityStream renders an "inferred" badge on these events to distinguish polled inferences from native emitter events. This is a UI concern; the `StaffEvent` type shape is identical.

**Deduplication**: The fallback poller uses a cursor pattern (`timestamp > $cursor`, updated after each batch). Synthetic event IDs are deterministic (`inferred-${row.id}`, `inferred-archive-${row.id}`). If the same row is accidentally polled twice (e.g., on cursor boundary), the frontend deduplicates by `eventId` in its in-memory ring buffer.

---

## 6. DB Query Cost Estimate

**At 500ms poll interval, per active SSE connection:**

| Query | Table | Index used | Est. rows returned | Est. duration | Frequency |
|---|---|---|---|---|---|
| New knowledge_base entries | `knowledge_entry` (or `knowledge_base`) | `created_at DESC` | 0–5 (normal operation) | 1–3ms | 2/second |
| New archive entries | `archive` | `archived_at DESC` | 0–2 (archivist runs infrequently) | 1–3ms | 2/second |

**Total queries per minute**: 4 queries/second × 60 = **240 queries/minute** per active SSE connection.

**On a local PostgreSQL instance (typical operator setup):**
- PostgreSQL on consumer hardware (2020-era laptop or desktop) handles 5,000–50,000 simple indexed queries per second.
- 240 queries/minute = **4 queries/second** — less than 0.1% of capacity even on a slow machine.
- Acceptable without qualification.

**On SQLite (if an Iranti deployment uses it instead of PostgreSQL):**
- SQLite in WAL mode handles sequential indexed reads at 10,000–50,000 queries/second.
- 4 queries/second is negligible.
- Acceptable without qualification.

**Connection pool impact:**
- The `pg.Pool` default size is 10 connections.
- Each fallback poll acquires a pool connection for <5ms and releases it immediately.
- Maximum concurrent pool usage from the poller: 1 connection at a time (the `isPolling` guard prevents concurrent poll rounds, as already implemented in the existing SSE poller).
- No pool exhaustion risk under normal single-operator use.

**Verdict: 500ms polling is fully feasible.** The DB cost is negligible on any hardware the Iranti server would typically run on. The bottleneck concern at this scale is not DB load but latency — events may arrive up to 500ms after they occurred, versus the <200ms target with native NOTIFY. This latency gap is the primary reason to prefer the upstream PR, not performance.

---

## Coverage Summary

| Component | Fallback coverage | Recoverable events | Unrecoverable events |
|---|---|---|---|
| Librarian | **Partial** | `write_created`, `write_replaced` (as `superseded` in archive), `write_escalated` (as `escalated` in archive) | `write_rejected`, `write_deduplicated`, `conflict_detected` |
| Attendant | **None** | — | All events (`handshake_completed`, `attend_completed`, `reconvene_completed`, `session_expired`) |
| Archivist | **Good** | `entry_archived`, `entry_decayed`, `resolution_consumed` | `archive_scan_completed` (cycle-level stats) |
| Resolutionist | **Deferred only** | `resolution_consumed` (via archive, with delay) | `resolution_filed`, `escalation_deferred` |

**Conclusion**: The fallback is viable as a temporary bridge for Librarian and Archivist events. It cannot satisfy the CP-T025 acceptance criteria for full coverage (which requires Attendant and Resolutionist events). If the upstream PR is rejected, the PM must be escalated with the recommendation to either maintain a local patch of the Iranti package or formally accept permanent gaps in Attendant and Resolutionist coverage.
