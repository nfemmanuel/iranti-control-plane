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
| **Source** | Filter by the source label of the write. Common values: `mcp`, `api`, `cli`, `claude_code`. |
| **Created By** | Filter by the agent ID that wrote the fact. |
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
| **Source** | Where the write came from: `mcp`, `api`, `cli`, or `claude_code`. |
| **Agent** | The agent ID that created the fact. |
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
- **Properties** — optional JSONB metadata attached to the fact by the writing agent.
- **Conflict Log** — if this fact was written after a conflict was detected, the conflict log records the prior value and the resolution decision.
- **Updated At** — when this row was last modified.

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

## Phase 1 Known Limitations

The following limitations apply in Phase 1 and are accepted scope boundaries — not bugs. See [`docs/reference/known-issues.md`](../reference/known-issues.md) for the complete known-issues list with severities, workarounds, and Phase 2 fix references.

**No alias lookup.** Iranti does not currently have an `entity_aliases` table. There is no way to search for an entity by an alternate name or display name. To find facts about a specific entity, you must know its exact `entityType` and `entityId`. For example, to find facts about the product manager agent, you must filter by `entityType=agent` and `entityId=product_manager` — searching for "PM" or "product manager" by name will not work.

**Entity field is always null in the entity detail view.** The control plane spec includes an `EntityRecord` field in the entity detail response that would carry a canonical `displayName` for the entity. In Phase 1 this field is always `null` because Iranti's current schema does not have an `entities` table. Entity display always uses the raw `entityType/entityId` string. See [KI-002](../reference/known-issues.md#ki-002----entity-field-always-null-in-entity-detail-response) in the known-issues doc.

**Search uses substring matching.** The `search` filter uses `ILIKE %term%` matching against value text and summaries. It is not full-text ranked search. For long or complex values, you may see unexpected matches or miss relevant results. Full-text search (tsvector-based) is planned for Phase 2. See [KI-004](../reference/known-issues.md#ki-004----search-uses-ilike-substring-matching-only).

**No write capability.** The Memory Explorer is entirely read-only. You cannot edit, delete, or directly archive facts from the UI. All mutations go through existing Iranti pathways (the MCP tools, CLI, or SDK).
