# Using the Staff Activity Stream

## What the Staff Is

Iranti's internal operations are carried out by four components collectively called the Staff. Each one has a distinct responsibility:

- **Librarian** — handles all writes to the knowledge base. When an agent calls `iranti_write`, the Librarian decides whether to create a new fact, replace an existing one, escalate a conflict to the Resolutionist, or reject the write entirely.
- **Attendant** — manages per-agent working memory. It handles `iranti_handshake`, `iranti_attend`, `iranti_observe`, and `iranti_reconvene` — loading and refreshing the relevant memory a given agent needs for its current task.
- **Archivist** — runs in the background and moves facts from the active knowledge base to the archive. It applies decay policies, processes escalation resolutions from the Resolutionist, and handles supersession when a write replaces an older fact.
- **Resolutionist** — reviews write conflicts that the Librarian has escalated. It files resolution decisions (accept the existing value, accept the challenger, or write a custom value) and those decisions are then consumed by the Archivist.

The Staff Activity Stream shows you what these four components are doing, as it happens.

---

## How to Read an Event Row

Each row in the Activity Stream represents one Staff event. Reading left to right:

| Field | What it means |
|---|---|
| **Timestamp** | When the event occurred, in ISO 8601 format. Displayed as local time. |
| **Component** | Which Staff member emitted the event: Librarian, Attendant, Archivist, or Resolutionist. Color-coded (see below). |
| **Action** | What the component did. Examples: `write_created`, `entry_archived`, `resolution_applied`. See the full action type reference below. |
| **Agent** | The agent whose operation triggered this event. Example: `product_manager`, `backend_developer`. This is the `agentId` passed in the original MCP/API/CLI call. |
| **Source** | The surface that initiated the operation: `mcp`, `api`, `cli`, or `claude_code`. |
| **Entity** | The `entityType/entityId` the event targeted, if applicable. Example: `ticket/cp_t013`. Not all events target a specific entity — system-level events (like a scan completing) may show `—` here. |
| **Key** | The specific fact key targeted, if applicable. Example: `status`, `current_assignment`. |
| **Reason** | A human-readable note from the operation, if provided. The Librarian includes this for conflict and rejection events. |
| **Level** | `audit` or `debug`. Audit events are always emitted. Debug events are opt-in and off by default. |

Click any row to expand it and see the full event JSON, including the `metadata` field. Metadata is component-specific — the Librarian includes `confidence` and `valuePreview`; the Archivist includes `archivedReason` and `entriesScanned`; the Resolutionist includes `escalationId` and `winnerSource`.

---

## Component Color Coding

Each Staff component has a dedicated color used for event labels, timeline markers, and accent dots throughout the Activity Stream. These colors come from the visual token system and work in both light and dark mode.

| Component | Color | Semantic meaning |
|---|---|---|
| **Librarian** | Amber (`#F59E0B` dark / `#D97706` light) | Writes, ingestion, fact creation and conflict decisions |
| **Attendant** | Violet (`#A78BFA` dark / `#7C3AED` light) | Session presence, handshakes, memory retrieval |
| **Archivist** | Sky blue (`#38BDF8` dark / `#0EA5E9` light) | Decay scanning, archival, supersession |
| **Resolutionist** | Mint (`#10B981` dark / `#059669` light) | Conflict resolution, accepted and rejected decisions |

The color appears as a small indicator dot and an uppercase component label on each row. You can quickly see whether a burst of activity is the Librarian processing a batch of writes (amber) or the Archivist running a decay scan (sky blue).

---

## Filtering the Stream

The filter bar above the stream lets you narrow what you see:

| Filter | What it does |
|---|---|
| **Component** | Show only events from one Staff component. Choose from `Librarian`, `Attendant`, `Archivist`, `Resolutionist`, or leave blank for all. |
| **Action Type** | Filter to a specific action, like `write_created` or `entry_archived`. Exact match. |
| **Agent ID** | Show only events triggered by a specific agent. Useful when you want to trace everything a particular agent did in a session. |
| **Entity Type** | Show only events that targeted entities of this type. Example: `ticket`. |
| **Entity ID** | Show only events targeting a specific entity. Combine with Entity Type to see all Staff activity for `ticket/cp_t013`. |
| **Level** | `audit` shows only operator-accountability events (the default). `debug` includes all events including routine internal steps like per-turn `attend_completed` calls. Be aware that switching to `debug` significantly increases volume. |
| **Since / Until** | ISO 8601 timestamps. Use these to look at a specific time window — for example, "what happened between 09:00 and 10:00 this morning?" |

Filters combine with AND logic. The stream updates in real time as you adjust filters — you don't need to submit.

---

## Pause and Resume

The Activity Stream auto-scrolls to show new events as they arrive via the live SSE (Server-Sent Events) connection. When the stream is active, new rows appear at the top of the table approximately every second.

To pause the live feed and read the current rows without them shifting, click **Pause** in the stream toolbar. The connection stays open but the table stops updating. Click **Resume** to re-enable auto-update and catch up on any events that arrived while paused.

If the browser tab loses focus or the connection drops (for example, the control plane server restarts), the stream reconnects automatically using the `Last-Event-ID` header. Events that arrived during the disconnection are backfilled — you won't miss events just because the tab was in the background.

The stream shows the most recent 100 events on initial load. Use the **Since** filter or scroll through the paginated **Events** table (available under the same view) to look further back in history.

---

## Live Mode

The Activity Stream operates in one of two rendering states at all times. A badge in the top-right corner of the stream panel indicates the current state.

### Status Badges

**`● LIVE`** — The stream is connected and actively receiving events via the SSE (Server-Sent Events) connection. New events appear at the top of the table as they arrive. The `●` pulse animates to indicate an active connection.

**`⏸ PAUSED`** — The stream is connected but rendering is suspended. New events are buffered in memory and will be flushed to the table when rendering resumes. The badge appears in either of two cases:

- **Manual pause:** Click the `● LIVE` badge to toggle to `⏸ PAUSED`. Click the badge again (or click **Resume**) to return to live rendering and flush all buffered events at once.
- **Hover-pause:** While your mouse is over the event list, rendering pauses automatically so rows don't shift under your cursor. When your mouse leaves the list, rendering resumes immediately and all buffered events are flushed. Hover-pause does not change the badge to `⏸ PAUSED` — it is a transparent rendering hold, not a user-initiated pause.

Clicking the badge is the primary way to toggle between live and paused states. The stream connection itself remains open in both states — no events are lost, only deferred.

### Velocity Counter

The stream panel displays a **velocity counter** alongside the status badge: for example, `14 evt/min`. This is the rate of events arriving over a **60-second rolling window**. The counter updates each time a new event arrives.

- If no events have arrived in the last 60 seconds, the counter shows `0 evt/min`.
- Velocity is calculated from the live SSE stream, not from the database. It reflects the current activity rate, not the total event count.
- High velocity (hundreds of events per minute) typically indicates active agent sessions with many writes or an Archivist decay scan in progress. Switching the Level filter to `audit` (if it isn't already) is the most effective way to reduce noise at high velocity.

### Reconnection Behavior

If the browser tab loses focus or the SSE connection drops (for example, the control plane server restarts), the stream reconnects automatically using the `Last-Event-ID` header. Events that arrived during the disconnection are backfilled — you won't miss events just because the tab was briefly in the background.

---

## Phase 2 Coverage

**Phase 2 covers all four Staff components for UI and live mode features. Event coverage for Attendant and Resolutionist is pending CP-T025.**

The stream UI (live mode, velocity counter, filter bar, hover-pause) ships in Phase 2 and applies to all events the stream receives. However, which Staff components actually emit events to the stream depends on the upstream Iranti emitter work:

| Component | Event coverage | Source |
|---|---|---|
| **Librarian** | Full — all write events | Phase 1 DB adapter |
| **Archivist** | Full — all archive/decay events | Phase 1 DB adapter (polling) |
| **Attendant** | Pending CP-T025 | Native emitter not yet injected |
| **Resolutionist** | Pending CP-T025 | Native emitter not yet injected |

Until CP-T025 ships:

- You will not see `handshake_completed`, `attend_completed`, `reconvene_completed`, or `session_expired` events from the Attendant.
- You will not see `resolution_filed`, `resolution_applied`, `resolution_rejected`, `escalation_deferred`, or `escalation_expired` events from the Resolutionist.

What you **will** see:
- All Librarian write events: `write_created`, `write_replaced`, `write_escalated`, `write_rejected`
- All Archivist lifecycle events: `entry_archived`, `entry_decayed`, `escalation_processed`, `resolution_consumed`

When CP-T025 ships, the polling adapter becomes unnecessary — the control plane will receive events through the injected `IStaffEventEmitter` interface. The `staff_events` table schema and SSE stream infrastructure are unchanged; only the event production path changes.

**The `staff_events` table must exist.** If `npm run migrate` hasn't been run, the Activity Stream shows an error rather than events. The Health dashboard's `staff_events_table` check tells you whether the migration has been applied.

**Debug events are off by default.** The default `level` filter is `audit`. Intermediate steps like `conflict_detected`, `write_deduplicated`, `archive_scan_completed`, and `escalation_reviewed` are debug-level and won't appear unless you switch the Level filter to `debug`. Debug events can produce significant volume during active agent sessions.
