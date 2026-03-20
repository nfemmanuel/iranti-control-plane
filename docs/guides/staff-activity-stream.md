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

## Phase 1 Limitations

**Phase 1 covers Librarian and Archivist events only.**

In Phase 1, the Staff event stream is populated by an adapter that instruments the Librarian and Archivist. The Attendant and Resolutionist have not yet received event emission hooks. **Attendant and Resolutionist events require native emitter injection (Phase 2: CP-T025).** Until CP-T025 ships, this means:

- You will not see `handshake_completed`, `attend_completed`, `reconvene_completed`, or `session_expired` events from the Attendant.
- You will not see `resolution_filed`, `resolution_applied`, `resolution_rejected`, `escalation_deferred`, or `escalation_expired` events from the Resolutionist.

What you **will** see in Phase 1:
- All Librarian write events: `write_created`, `write_replaced`, `write_escalated`, `write_rejected`
- All Archivist lifecycle events: `entry_archived`, `entry_decayed`, `escalation_processed`, `resolution_consumed`

This is enough to observe the primary memory write and archival lifecycle. Full four-component event coverage (all four Staff members in the stream) is planned for Phase 2 (CP-T025), when native event emitters are added to the Attendant and Resolutionist in the upstream Iranti codebase. When CP-T025 ships, the adapter layer becomes unnecessary — the control plane will receive events through the injected `IStaffEventEmitter` interface rather than by polling the database tables. The `staff_events` table schema and SSE stream infrastructure are unchanged; only the event production path changes.

**The `staff_events` table must exist.** If `npm run migrate` hasn't been run, the Activity Stream shows an error rather than events. The Health dashboard's `staff_events_table` check tells you whether the migration has been applied.

**Debug events are off by default.** The default `level` filter is `audit`. Intermediate steps like `conflict_detected`, `write_deduplicated`, `archive_scan_completed`, and `escalation_reviewed` are debug-level and won't appear unless you switch the Level filter to `debug`. Debug events can produce significant volume during active agent sessions.
