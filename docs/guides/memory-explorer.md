# Using the Memory Explorer

## What the Memory Explorer Shows

The Memory Explorer gives you a read-only view of everything Iranti currently believes. Iranti stores knowledge as individual **facts**, each scoped to a specific entity and key.

A fact is the atomic unit of Iranti's memory. Every fact has:

- an **entity** — a typed identifier like `agent/product_manager` or `ticket/cp_t001`
- a **key** — the name of the piece of information, like `current_assignment` or `status`
- a **value** — the actual content, stored as JSON
- **provenance** — who wrote it, from what source, with what confidence, and when

For example, if the agent `backend_developer` wrote a fact about ticket `cp_t013` saying its status is `in_progress`, that would appear in the Memory Explorer as:

- entityType: `ticket`
- entityId: `cp_t013`
- key: `status`
- value: `{"status": "in_progress"}`
- agentId: `backend_developer`
- confidence: 90

The Memory Explorer shows the **current knowledge base** — facts that are valid right now, with no `validUntil` date set. Facts that have been superseded or archived are in the **Archive** tab (see below).

---

## The Filter Bar

The filter bar sits at the top of the Memory Explorer. Each filter narrows the results independently:

| Filter | What it does |
|---|---|
| **Entity Type** | Show only facts for a specific type of entity. Common values: `agent`, `ticket`, `decision`, `roadmap`, `research`, `blocker`. Enter the type exactly — it's case-sensitive. |
| **Entity ID** | Show only facts for a specific entity. Use this together with Entity Type to drill into one entity. Example: set Entity Type to `agent` and Entity ID to `product_manager` to see all stored facts about the product manager agent. |
| **Key** | Show only facts with a specific key name. Useful when you want to see the `status` or `current_assignment` for many entities at once. |
| **Source** | Filter by the caller-supplied provenance label. Common values: `mcp`, `api`, `cli`, `claude_code`, `git`, `manual`. |
| **Written by** | Filter by the authenticated agent ID (`createdBy`) that wrote the fact. |
| **Min Confidence** | Show only facts at or above this confidence level (0–100). Use 90 to see only high-confidence facts; use 0 to see everything. |
| **Search** | Substring search across fact values and summaries. Uses `ILIKE %term%` matching — search for `in_progress` to find any fact whose value or summary contains that string. Full-text ranked search is Phase 2 (see [Known Issues KI-004](../reference/known-issues.md#ki-004----search-uses-ilike-substring-matching-only)). |

Filters combine with AND logic: if you set Entity Type to `agent` and Min Confidence to 80, you see only agent facts with confidence 80 or higher.

To reset all filters, clear each field or reload the page.

---

## Browsing the Table

The main table shows one row per fact. Each column:

| Column | What it shows |
|---|---|
| **Entity** | The `entityType/entityId` combination in monospace font. Example: `ticket/cp_t001`. |
| **Key** | The fact key in monospace font. Example: `current_assignment`. |
| **Summary** | A plain-language summary of the value, written by the agent at write time. This is the human-readable version — not the raw JSON. |
| **Confidence** | A number from 0 to 100. Higher means the writing agent was more certain. |
| **Source** | The caller-supplied provenance label: `mcp`, `api`, `cli`, `git`, `manual`, etc. This is set by the writing agent, not derived from the authenticated identity. |
| **Written by** | The authenticated agent ID (`createdBy`) that made the write. This maps to the agent's registered identity in the Agent Registry. |
| **Valid From** | When this version of the fact became valid. |
| **Created** | When this row was first written to the database. |

The table is sorted by creation time, newest first. Click any column header to resort.

---

## Expanding a Row

Click any row to expand it and see the full fact detail.

The expanded view shows all fields including:

- **Value (Summary)** — the human-readable summary, in full.
- **Value (Raw)** — the raw JSON stored in Iranti. This is what agents write and read. In the list view, values larger than 4 KB are truncated — you'll see a note saying "value truncated" with a link to view the full value. The entity detail page always shows the full value.
- **validFrom / validUntil** — the temporal window during which this fact is considered current. `validUntil` is `null` for a currently-valid fact; it will be set when this fact is superseded or archived.
- **Written by** — the authenticated agent ID (`createdBy`) that made the write API call. This is the agent's identity as established at `iranti_handshake` time, not a user-supplied label.
- **Source** — the caller-supplied provenance label (e.g., `mcp`, `git`, `manual`). This is distinct from "Written by": an agent with ID `backend_developer` might write a fact with `source: "git"` to indicate the provenance of the data, not the writing agent itself. If the tooltip isn't visible, hover over the field label.
- **Stability** — how many days of access stability this fact has accumulated. Higher stability means the fact has been read or refreshed recently and will be slower to decay. Only shown if non-null (relevant when memory decay is enabled — see [Health Dashboard](./health-dashboard.md#memory-decay-card)).
- **Last Accessed** — when this fact was last read by any agent. Only shown if non-null.
- **Properties** — optional JSONB metadata attached to the fact by the writing agent.
- **Updated At** — when this row was last modified.

### Conflict History

If a fact has had any conflicts — writes that were escalated, rejected, or resolved against it — a **Conflict History** section appears below the other fields. This replaces the old raw `conflictLog` JSON expand.

Each entry in the conflict timeline shows:

| Field | What it means |
|---|---|
| **Timestamp** | When the conflict event occurred (relative, with absolute time on hover). |
| **Event type** | One of: `CONFLICT_ESCALATED` (amber), `CONFLICT_REJECTED` (red), `CONFLICT_RESOLVED` (green), `IDEMPOTENT_SKIP` (grey). |
| **Reason** | The Librarian's explanation for what happened. |
| **Used LLM** | Whether the Librarian called an LLM to arbitrate this conflict. |
| **Existing vs. Incoming** | If scores are present: the confidence of the existing fact vs. the incoming challenger at the time of the conflict. |
| **Incoming Source** | The source label of the challenging write, if present. |

If `conflictLog` is empty, no Conflict History section appears — the fact has had no conflicts.

The Conflict History timeline also appears in the **Archive Explorer** expanded row. Archived facts carry the same `conflictLog` data, so you can see the full conflict history for a fact even after it's been archived.

> **Example**: If you expand the fact `ticket/cp_t001 → status`, you might see `valueRaw: {"status": "completed", "completedAt": "2026-03-20"}` and `confidence: 99`, written by `system_architect` via `mcp`.

---

## The Archive Tab

The Archive tab shows facts that are no longer current — they've been moved to the `archive` table by the Archivist.

Facts get archived for several reasons:

- **Superseded**: a newer write with higher confidence or a more recent timestamp replaced this fact. The old version moves to the archive with `archivedReason: "superseded"`.
- **Decay**: the Archivist applies a decay policy that expires old facts past a certain age. Decayed facts have `archivedReason: "decay"`.
- **Conflict resolved**: when the Resolutionist resolves a conflict, the losing value is archived with `archivedReason: "conflict_resolved"`.

The Archive table has additional columns: **Archived At**, **Archived Reason**, **Superseded By**, and **Resolution State**.

`resolutionState` can be `pending` (conflict escalated but not yet resolved), `resolved` (Resolutionist has filed a decision), or `rejected` (the resolution was rejected).

The Archive tab supports the same filter bar as the main Memory tab, plus additional filters for `archivedReason`, `resolutionState`, date ranges for `archivedAfter` / `archivedBefore`, and `supersededBy`.

---

## Entity Detail View

To open the entity detail page, expand any row (click it) and click the **"View Related Entities →"** button in the expanded row actions. This is the fastest way to answer: "What does Iranti currently believe about this entity?"

The entity detail page shows:

- **Current Facts** — all active knowledge base entries for this entity, across all keys.
- **Archived Facts** — all archived entries for this entity, ordered by `validFrom` descending, giving you the complete timeline.
- **Relationships** — all `entity_relationships` entries where this entity appears as either the source or target.

You can also navigate to an entity detail page directly from the Memory Explorer expanded row by clicking **"View History"** — this takes you to the Temporal History view for that specific entity+key pair (see below). The "View Related Entities →" button takes you to the full entity detail page for all facts about that entity.

### Temporal History

Within the entity detail page, click any key name to open the **key history view**. You can also click **"View History"** in a Memory Explorer expanded row to go directly to the history for that fact's entity+key. This view shows the complete temporal history for one `entity + key` pair — every version ever written, in order from newest to oldest.

Each interval in the history shows:
- **validFrom** — when this version became the current value
- **validUntil** — when it was superseded (null for the current version)
- **source** — `kb` (currently in the knowledge base) or `archive` (this version has been superseded)
- **archivedReason** — why it was archived, if applicable
- **Full raw value** — no truncation on the history view, so you can compare versions directly

> **Example**: The key history for `agent/product_manager → current_assignment` might show three intervals: the current value (validUntil = null), a prior value from last week (validUntil set, archivedReason = superseded), and an original value from a month ago. This tells you exactly how the assignment has changed over time.

### Point in Time — the asOf Picker

The Temporal History view includes a **Point in Time** date and time picker in the view header. Use it to answer the question: "What did Iranti believe about this fact on March 15 at 14:30?" — useful when debugging why an agent had stale or unexpected information at a specific moment.

**When to use it:**

- You want to reconstruct the KB state before a recent high-confidence write replaced a fact.
- You need to know whether a fact existed at all at a given time, not just its current value.
- A conflict or escalation happened at a known timestamp and you want to see which fact version was active at that moment.

**How to use it:**

1. Open the key history view for a specific `entityType / entityId / key`.
2. In the header, locate the **Point in Time** field and select a date and time. The picker accepts a datetime-local value (your local timezone). The picker will not accept a date in the future.
3. As soon as a date/time is selected, the view fires a query against the Iranti API (`GET /kb/query/:entityType/:entityId/:key?asOf=<ISO timestamp>&includeExpired=true`). No separate "Query" button is needed.
4. A callout box appears below the picker row showing the result.
5. The interval in the timeline that was active at the selected moment receives an **"active at query time"** badge and is visually highlighted (elevated styling).
6. To return to the normal full-history view, click the **✕** button next to the picker to clear the selection. The highlight and callout both disappear.

**What the callout shows:**

| Field | What it means |
|---|---|
| **Value** | The `valueSummary` at that point in time, or the raw JSON if no summary was written. |
| **Confidence** | The confidence score (0–100) at that moment. |
| **Source** | The `providerSource` (caller-supplied provenance label) of the fact at that time. |
| **Created by** | The `agentId` that wrote the fact (the authenticated agent identity). |
| **Interval** | The `validFrom` → `validUntil` window. "still active" appears in place of `validUntil` if this version is the current live fact. |

A **Raw value** expandable section below the callout fields shows the full JSON stored in Iranti at that point in time.

**If no fact existed at that time:**

The callout shows "No fact existed at this time." This is not an error — it means no fact with a matching `[validFrom, validUntil)` interval was found for the selected timestamp. This is expected for keys that were first written after the selected date.

**Known limitation:**

The asOf query is bounded by when the `staff_events` table began recording data. If you select a timestamp before Iranti was first run, the query may return no result even though a fact was written at a later date that is currently the live value. Use the interval list itself to read `validFrom` values and calibrate your time selection.

---

### Contributors Panel

The **Contributors** panel appears below the tab content on every entity detail page (`/memory/:entityType/:entityId`). It shows which agents have contributed facts to this entity, drawn from the `GET /memory/whoknows/:entityType/:entityId` Iranti endpoint.

**What it shows:**

Each contributor is shown as a card with three pieces of information:

| Field | What it means |
|---|---|
| **Agent ID** | The authenticated agent identity (`agentId`) that wrote facts to this entity. Shown in monospace. |
| **Write count** | How many facts this agent has written to the entity across all keys. |
| **Last contribution** | How long ago the agent last contributed a fact (relative time, e.g. "3h ago"). Hover for the absolute timestamp. |

Contributors are sorted by write count, highest first. This gives you an immediate sense of which agent has shaped this entity's memory most heavily.

**Agent Registry links:**

If an agent in the list is registered in the Agent Registry (CP-T051), its ID is displayed as a link to `/agents/:agentId`. If the agent is not registered (or the Agent Registry is unavailable), the ID is shown as plain monospace text. The panel always renders without breaking if the Agent Registry cannot be reached.

**Empty state:**

If no contributor data is available — for example, because no agents have written attributed facts to this entity yet — the panel shows:

> No attributed contributors for this entity.

This is not an error. It can occur on entities that predate the current `staff_events` table or entities that have only system-level writes with no agent attribution.

**Unavailable state:**

If the Contributors endpoint returns a 503 or any error (typically because the connected Iranti API key lacks `memory:read` scope), the panel shows:

> Contributor data unavailable. Check that your Iranti API key has `memory:read` scope.

All other facts and tabs on the entity detail page continue to function normally when the Contributors panel is in this state. See the Health Dashboard (`/health`) if you need to verify your API key's configured scopes.

---

## Relationships View

The Relationships section on the entity detail page shows all `entity_relationships` entries involving this entity.

Each relationship has:
- **From** — the source entity (`entityType/entityId`)
- **To** — the target entity
- **Relationship Type** — a string describing the relationship (e.g., `depends_on`, `assigned_to`, `related_to`)
- **Confidence** — optional, 0–100
- **Source** — which agent or system created the relationship
- **Created** — timestamp

The standalone Relationships view (accessible from the sidebar) shows the global relationship table with filters for `entityId`, `entityType`, `fromEntityId`, `toEntityId`, and `relationshipType`.

---

## Relationship Graph

The **Relationships** tab in the entity detail view includes a visual graph in addition to the flat list. This section describes the graph and how to use it.

### Where It Appears

Open any entity's detail page (click "View Related Entities" from a Memory Explorer expanded row, or navigate to `/memory/:entityType/:entityId` directly). The Relationships tab is one of three tabs on that page, alongside Current Facts and Archived Facts. The graph is the default rendering inside the Relationships tab.

### The Radial Layout

The graph uses a radial layout centered on the entity you are viewing:

- **Center node** — the root entity. Always shown in the center, labeled with `entityType / entityId`.
- **Inner ring** — direct neighbors (1 hop). Every entity that has a relationship directly to or from the root entity.
- **Outer ring** — depth-2 neighbors (2 hops). Every entity that has a relationship to or from a direct neighbor, excluding the root itself.

### Depth Toggle

A **1 / 2** toggle above the graph controls how many hops to render:

- **1** — shows only the root and its direct neighbors (inner ring only). Use this for dense graphs where the outer ring adds too much noise.
- **2** — shows root, inner ring, and outer ring. This is the default.

Switching the toggle re-renders the graph immediately; no page reload is needed.

### Graph and List View Toggle

A **Graph / List** toggle lets you switch between the two renderings of the same relationship data:

- **Graph** — the radial visualization described above. Best for exploring the shape of the neighborhood at a glance.
- **List** — a flat edge table. Each row shows one relationship with columns for direction (→ outbound / ← inbound), relationship type, confidence, and the source agent that created the relationship. Use the list view when you need to read exact values or copy entity IDs.

### Hover Tooltip

Hovering over any node in the graph shows a tooltip with three lines:

```
entityType
entityId
N facts
```

`N facts` is the count of currently-active knowledge base entries for that entity. This gives a quick sense of how much is known about a neighbor without navigating away.

### Navigating to a Neighbor

Click any node in the graph to navigate to that entity's detail page. The graph re-centers on the clicked entity, and the breadcrumb updates. Use the browser Back button or the breadcrumb to return to the previous entity.

### Empty State

If the entity has no recorded relationships in `entity_relationships`, the Relationships tab shows an empty state message: "No relationships recorded for this entity." This is not an error — it means no agent has called `iranti_relate` (or equivalent) for this entity, or all relationships have been removed.

### Truncation

The graph renders a maximum of **50 nodes per depth level** (50 direct neighbors + up to 50 depth-2 nodes per inner node, capped globally at 50 outer nodes total). If an entity has more than 50 relationships at a given depth, the graph shows the 50 most recently created and displays a notice: "Graph truncated — showing 50 of N neighbors." The full set is always accessible in List view, which has no truncation limit.

---

## Phase 1 Known Limitations

The following limitations apply in Phase 1 and are accepted scope boundaries — not bugs. See [`docs/reference/known-issues.md`](../reference/known-issues.md) for the complete known-issues list with severities, workarounds, and Phase 2 fix references.

**No alias lookup.** Iranti does not currently have an `entity_aliases` table. There is no way to search for an entity by an alternate name or display name. To find facts about a specific entity, you must know its exact `entityType` and `entityId`. For example, to find facts about the product manager agent, you must filter by `entityType=agent` and `entityId=product_manager` — searching for "PM" or "product manager" by name will not work.

**Entity field is always null in the entity detail view.** The control plane spec includes an `EntityRecord` field in the entity detail response that would carry a canonical `displayName` for the entity. In Phase 1 this field is always `null` because Iranti's current schema does not have an `entities` table. Entity display always uses the raw `entityType/entityId` string. See [KI-002](../reference/known-issues.md#ki-002----entity-field-always-null-in-entity-detail-response) in the known-issues doc.

**Search uses substring matching.** The `search` filter uses `ILIKE %term%` matching against value text and summaries. It is not full-text ranked search. For long or complex values, you may see unexpected matches or miss relevant results. Full-text search (tsvector-based) is planned for Phase 2. See [KI-004](../reference/known-issues.md#ki-004----search-uses-ilike-substring-matching-only).

**No write capability.** The Memory Explorer is entirely read-only. You cannot edit, delete, or directly archive facts from the UI. All mutations go through existing Iranti pathways (the MCP tools, CLI, or SDK).
