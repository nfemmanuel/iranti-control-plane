# Fleet Ledger — Operator Guide

## What the Fleet Ledger Is

The fleet ledger is a read-only mirror of Staff events from all registered Iranti instances, stored in the control-plane database. It gives you a single place to inspect Staff activity across every instance you operate — without connecting to each one individually.

Each Iranti instance maintains its own `staff_events` table as the authoritative record of what its Staff components did. The control plane pulls those events on a schedule and writes copies into a local `mirrored_staff_events` table. The fleet ledger UI and API read from that mirror.

---

## Architecture

```
Per-instance staff_events  →  CP poller (per instance)  →  mirrored_staff_events  →  Fleet API  →  UI
```

- **Per-instance `staff_events`** — the source of truth. Each Iranti instance records every Librarian, Attendant, Archivist, and Resolutionist action here. This table is not affected by the control plane.
- **CP poller** — a background process in the control plane that polls each registered instance's `/memory/ledger` API on a configurable interval (default: 60 seconds).
- **`mirrored_staff_events`** — the control-plane local copy. Events are inserted with `ON CONFLICT DO NOTHING` for idempotency: running the poller twice for the same window inserts nothing new.
- **Fleet API** — `GET /api/control-plane/session-ledger` and `GET /api/control-plane/session-ledger/ingestion-health`.
- **UI** — the Fleet Ledger view in the control-plane dashboard.

---

## Source of Truth vs Mirror

The per-instance `staff_events` table is always authoritative. The mirror is a convenience layer — it is eventually consistent, not real-time.

Practical implications:

- An event that just occurred on instance `inst-2` will not appear in the fleet ledger until the next poll cycle completes.
- If the control plane was offline for several hours, events from that window are ingested in bulk at the next successful poll. No events are skipped as long as the instance is reachable.
- If an instance is unreachable, the mirror for that instance lags. The ingestion health endpoint tells you which instances are behind and by how much.

---

## Watermarks

The control plane tracks ingestion progress per instance using a watermark row in `instance_ledger_watermarks`. Each row records:

| Field | Meaning |
|---|---|
| `instanceId` | Identifies the Iranti instance. |
| `lastEventTimestamp` | The timestamp of the most recent event ingested from this instance. |
| `lastRemoteEventId` | The event ID of the most recent ingested event. Used to resume polling from the right position. |
| `lastPolledAt` | When the poller last attempted to contact this instance (success or failure). |
| `lastPollSucceeded` | Whether the most recent poll attempt completed without error. |
| `lastPollError` | The error message from the most recent failed poll, if any. |
| `consecutiveFailures` | How many consecutive poll attempts have failed. Resets to 0 on the next success. |
| `totalEventsIngested` | Cumulative count of events ingested from this instance since the watermark was created. |

When an instance is unreachable, the poller records a failure and increments `consecutiveFailures`. The watermark position (`lastEventTimestamp`, `lastRemoteEventId`) does not change — it stays at the last successful ingestion point. When the instance becomes reachable again, the next poll resumes from where it left off and ingests all events that accumulated during the outage.

---

## Ingestion Health

The ingestion health endpoint reports one entry per registered instance with a `status` derived from watermark state:

| Status | Condition |
|---|---|
| `never_polled` | `lastPolledAt` is null — the instance has been registered but the poller has not yet run for it. |
| `healthy` | The most recent poll succeeded (`consecutiveFailures === 0`). |
| `degraded` | Between 1 and 2 consecutive poll failures. Ingestion is behind but likely to recover soon. |
| `failing` | 3 or more consecutive poll failures. The instance may be down or unreachable. |

A `failing` instance does not affect other instances — each instance is polled and tracked independently.

---

## Viewing the Fleet Ledger

Open the Fleet Ledger view in the control-plane dashboard. Events are displayed in reverse chronological order (newest first) with stable ordering for events that share the same timestamp.

### Filters

| Filter | What it does |
|---|---|
| **Instance** | Show only events from a specific Iranti instance. Matches on `instanceId`. |
| **Host** | Show only events emitted from a specific host machine. |
| **Agent ID** | Show only events triggered by a specific agent. |
| **Session ID** | Show only events associated with a specific session. |
| **Action Type** | Exact match on action type, e.g. `write_created`, `entry_archived`. |
| **Since / Until** | ISO 8601 timestamps. Limits events to a specific time window. |

Filters combine with AND logic. The default limit is 100 events; the maximum is 250 per request.

---

## API Reference

### `GET /api/control-plane/session-ledger`

Returns a paginated list of mirrored fleet events.

**Query parameters:**

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `limit` | integer | 100 | Maximum events to return. Range: 1–250. Values above 250 are capped. |
| `instanceId` | string | — | Filter to a single instance. |
| `source` | string | — | Filter by source surface (`mcp`, `api`, `cli`, `claude_code`). |
| `host` | string | — | Filter by originating host. |
| `agentId` | string | — | Filter by agent ID. |
| `sessionId` | string | — | Filter by session ID. |
| `actionType` | string | — | Filter by action type. Exact match. |
| `since` | ISO 8601 | — | Include only events at or after this timestamp. |
| `until` | ISO 8601 | — | Include only events at or before this timestamp. |
| `level` | `audit` or `debug` | — | Filter by event level. |

**Response shape:**

```json
{
  "items": [
    {
      "id": 1,
      "instanceId": "inst-local",
      "remoteEventId": "evt-abc123",
      "timestamp": "2026-04-02T10:00:00.000Z",
      "staffComponent": "Librarian",
      "actionType": "write_created",
      "agentId": "product_manager",
      "source": "mcp",
      "host": "codex",
      "sessionId": "sess-xyz",
      "entityType": "ticket",
      "entityId": "cp_t001",
      "key": "status",
      "reason": null,
      "level": "audit",
      "metadata": null,
      "ingestedAt": "2026-04-02T10:00:05.000Z"
    }
  ],
  "total": 1,
  "fetchedAt": "2026-04-02T10:00:10.000Z"
}
```

If the database is not available or migrations have not been applied, the route returns 200 with `items: []` and a `note` field describing the error. This non-fatal envelope prevents the UI from showing a hard error when the CP is partially initialised.

---

### `GET /api/control-plane/session-ledger/ingestion-health`

Returns the ingestion watermark and health status for every registered instance.

**Response shape:**

```json
{
  "instances": [
    {
      "instanceId": "inst-local",
      "lastEventTimestamp": "2026-04-02T09:58:00.000Z",
      "lastRemoteEventId": "evt-abc099",
      "lastPolledAt": "2026-04-02T10:00:00.000Z",
      "lastPollSucceeded": true,
      "lastPollError": null,
      "consecutiveFailures": 0,
      "totalEventsIngested": 312,
      "status": "healthy"
    }
  ],
  "fetchedAt": "2026-04-02T10:00:10.000Z"
}
```

Status values: `healthy`, `degraded`, `failing`, `never_polled`. See the Ingestion Health section above for definitions.

If the watermark table is not available, the route returns 200 with `instances: []` and a `note` field.

---

## Runtime Independence

Control-plane downtime does not affect per-instance event recording. Each Iranti instance writes to its own `staff_events` table independently of the CP. Events that occur while the control plane is offline are ingested at the next successful poll — the watermark ensures the poller knows where to resume.

---

## Polling Interval

The default polling interval is **60 seconds** per instance. Configure it with:

```
FLEET_LEDGER_POLL_INTERVAL_MS=60000
```

Set in `.env.iranti` or the environment. Reducing the interval increases ingestion freshness at the cost of more frequent API calls to each instance.

---

## Known MVP Limitations

- **No historical backfill.** Events that occurred before a watermark was first created are not retroactively ingested. The poller always resumes from `lastEventTimestamp`, so older events already in the per-instance `staff_events` table are not pulled unless a fresh watermark is manually reset.
- **No real-time streaming.** The fleet ledger is poll-based. Events appear after the next poll cycle completes, not immediately after they are recorded on the source instance.
- **No cross-instance deduplication.** If two instances emit events with the same `remoteEventId` (which should not happen in normal operation), the CP stores both keyed under their respective `instanceId`. Uniqueness is enforced on `(instance_id, remote_event_id)`.
- **Single batch size.** Each poll fetches up to the configured batch limit from the instance. Very high-traffic instances may need multiple poll cycles to catch up after an outage.
