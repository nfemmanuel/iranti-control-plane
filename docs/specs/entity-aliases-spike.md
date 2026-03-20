# Architecture Spike: entity_aliases — CP-T006

**Spike ID**: CP-T006
**Phase**: 1
**Author**: system_architect
**Date**: 2026-03-20
**Status**: Complete — pending PM acceptance
**Depends on**: CP-T002 (API spec — amendment appended)

---

## Summary

This spike resolves open question #4 from CP-T002 and the investigation mandate in ticket CP-T006. The finding is definitive: **no `entity_aliases` table exists in the current Iranti schema**. The running Iranti database has exactly three tables: `knowledge_base`, `archive`, and `entity_relationships`. Phase 1 Memory Explorer is unblocked — entity detail works via `entityType + entityId` directly from `knowledge_base`. The `entity` field in `EntityDetailResponse` is `null` in Phase 1, which the API spec already accommodates. Alias display is deferred to a future phase gated on upstream Iranti table additions.

---

## Part 1: What the PRD Says About entity_aliases

### PRD Data Sources Reference

The PRD's "Data Sources the Control Plane Needs" section (Technical Approach) lists `entity_aliases` as one of the required data sources alongside `knowledge_base`, `archive`, `entity_relationships`, and `entities`.

### FR1 Reference

FR1 states: "The control plane must let the user inspect current KB, archive, relationships, entities, and **aliases** without direct SQL."

This is the only functional requirement that explicitly names aliases. The PRD does not define what an alias is, what the table shape looks like, or what query patterns it supports. It treats `entity_aliases` as a peer of the other tables — a data source to expose, not a feature to design.

### Memory Explorer Reference

The Memory Explorer section (Product Surface §2) lists these core views:
- current facts table for `knowledge_base`
- archive table for `archive`
- entity detail page
- temporal history timeline per `entity/key`
- relationship view for `entity_relationships`
- raw JSON inspector for `valueRaw`, `properties`, and `conflictLog`

`entity_aliases` is **not listed as a required Memory Explorer view**. It appears only in the data sources list in the Technical Approach section. This means the PRD treats aliases as infrastructure to expose, not as a first-class Phase 1 UI view.

### What the PRD Expects entity_aliases to Contain

The PRD does not specify the schema. Based on the name and typical usage in systems like this, aliases would be expected to map alternate identifiers or names to a canonical `entityType/entityId` pair. The user value described in the ticket is: "understanding that `ticket/cp_t001` and `CP-T001` refer to the same thing, or that an entity has multiple known identifiers."

The PRD's intent is: if a user searches for an alternate name, they should resolve to the canonical entity. Without this, entities that are referenced under multiple identifiers may appear as duplicates in the Memory Explorer.

---

## Part 2: Impact on Phase 1 Given the Table Does Not Exist

### Finding

Confirmed: the running Iranti database has exactly **three tables**: `knowledge_base`, `archive`, `entity_relationships`. There is no `entities` table and no `entity_aliases` table.

The investigation scope for this spike covered:
- confirmed schema via PM-provided schema report
- no evidence of alias storage by convention in `knowledge_base` (e.g., no `key = "_alias"` convention documented or confirmed in Iranti source material available to this repo)
- no Iranti SDK surface or MCP tool that writes or queries aliases

### Impact Analysis

#### Memory Explorer Entity Detail Page

**Assessment: unblocked for Phase 1.**

The entity detail page — answering "what does Iranti believe about `ticket/cp_t001`?" — does not require an `entity_aliases` table. The page is driven by:

```
GET /api/control-plane/entities/:entityType/:entityId
```

This endpoint queries `knowledge_base` (current facts), `archive` (historical facts), and `entity_relationships` (relationships) — all three of which exist. An operator can navigate directly to an entity by its `entityType/entityId` pair and see a complete picture of current state and history.

**What is missing without entity_aliases**: A user cannot discover an entity by an alternate name or identifier. If the same real-world entity is recorded under two different `entityId` values (e.g., `cp_t001` and `CP-T001`), those will appear as two separate entities with no visible link between them. This is a known Phase 1 limitation, not a blocker.

#### /api/control-plane/entities/:entityType/:entityId Endpoint

**Assessment: implementable as specified, with one explicit null.**

The `EntityDetailResponse` shape in CP-T002 includes:

```typescript
interface EntityDetailResponse {
  entity: EntityRecord | null;  // From `entities` table, if it exists
  currentFacts: KBFact[];
  archivedFacts: ArchiveFact[];
  relationships: Relationship[];
}
```

The `entity` field is already typed as `EntityRecord | null`. In Phase 1, because neither `entities` nor `entity_aliases` exists, `entity` is always `null`. The CP-T002 spec already has a note: "If the `entities` table does not contain a row for this `entityType/entityId`, `entity` is `null`." This is accurate and sufficient.

The backend implementation simply omits the `entities` table query — there is no table to join against. The response shape is unchanged.

**What is missing without entity_aliases**: The endpoint cannot return an `aliases` array in Phase 1. This field does not exist in the current `EntityDetailResponse` shape. Adding it is deferred (see Part 3).

#### Search and Entity Discovery

**Assessment: limited in Phase 1, not blocked.**

The `/api/control-plane/kb` endpoint accepts a `search` parameter (ILIKE against `value_raw` / `summary`). Entity discovery in Phase 1 works by:
- filtering by `entityType` to browse a class of entities
- filtering by `entityId` to navigate directly to a known entity
- keyword search against fact content

Without `entity_aliases`, a user cannot search for "CP-T001" and resolve it to `ticket/cp_t001` if the identifier mapping has not been recorded as a KB fact. Discovery is constrained to whatever identifiers are directly stored in `entityType` and `entityId` columns.

This is acceptable for Phase 1. The primary use cases — inspecting entities that agents have written to directly — are unaffected. The secondary use case — resolving a human-readable alias to a canonical entity — is a Phase 2+ capability.

---

## Part 3: Recommended Approach

### Phase 1 Recommendation: Skip entity_aliases Entirely

Do not introduce any alias handling in Phase 1. The rationale:

1. **No upstream table exists.** There is nothing to query. Building an alias UI without data would be empty scaffolding.
2. **No upstream write mechanism exists.** Iranti does not currently expose a way to write `entity_aliases` entries via MCP, SDK, or API. Even if a control plane endpoint existed, there would be no data to display.
3. **The Memory Explorer core use case is fully served** by `knowledge_base`, `archive`, and `entity_relationships`. Entity detail, history, and relationships all work.
4. **The `EntityDetailResponse` already accommodates this** — `entity: null` is a valid, documented response state.
5. **The PRD does not list alias display as a required Phase 1 Memory Explorer view.**

**Known Phase 1 limitations to document explicitly:**
- No "find entity by alternate name" capability.
- Entity detail page shows facts grouped by `entityType/entityId` — not by any canonical display name or alias list.
- `EntityRecord` in `EntityDetailResponse` is always `null` in Phase 1.
- Entities referenced under two different `entityId` values will appear as two separate entities with no visible link.

### Future Phases: entity_aliases When the Upstream Table Exists

This work is out of scope for this spike per the ticket's Out of Scope definition. The following is documented as forward intent, not a proposal for immediate implementation.

**What would need to happen upstream (not in this repo):**

1. Iranti would need to add an `entity_aliases` table to its core schema. A minimal schema would be:
   - `id` — primary key
   - `entity_type` — the canonical entity type
   - `entity_id` — the canonical entity ID
   - `alias` — the alternate name or identifier
   - `alias_type` — optional: e.g., `display_name`, `external_ref`, `short_code`
   - `created_at`
   - `source` — which agent or system wrote this alias
   - Unique index on `(entity_type, entity_id, alias)`
   - Index on `alias` for lookup performance

2. Iranti would need to expose an MCP tool or SDK method to write aliases.

**What would need to change in this repo when upstream catches up:**

- Add `GET /api/control-plane/entities/:entityType/:entityId/aliases` endpoint (deferred per CP-T006 amendment — see Part 4 and the API spec amendment).
- Populate `EntityRecord` from the `entities` table if/when that table is added.
- Add `aliases: Alias[]` to `EntityDetailResponse` (non-breaking extension — add the field with a default of `[]`).
- No breaking changes to the response shape: `entity` remains nullable, `aliases` would be additive.

**The API spec amendment in CP-T002 is designed to avoid breaking changes** — the `entity` field is already nullable, and any future `aliases` array would be additive, not a replacement.

---

## Part 4: Amendment to CP-T002 API Spec

The amendment is appended directly to `docs/specs/control-plane-api.md` as a new section: `## Amendment — Phase 1 Entity Scope (CP-T006)`.

### What the amendment specifies:

1. The `entity` field in `EntityDetailResponse` is **always `null` in Phase 1** — no `entities` table exists in the current Iranti schema, so the backend must not attempt to query it. The backend implementation must emit `entity: null` unconditionally in Phase 1.

2. The `GET /api/control-plane/entities/:entityType/:entityId/aliases` endpoint is **deferred** — it will not be implemented in Phase 1. It is not listed in the Phase 1 implementation scope. It should be tracked as a Phase 2+ item gated on upstream Iranti adding an `entity_aliases` table.

3. No other endpoint changes are required. The three existing tables (`knowledge_base`, `archive`, `entity_relationships`) are sufficient for Phase 1 entity detail, history, and relationship display.

### What the amendment does NOT change:

- The `EntityDetailResponse` schema shape. `entity: EntityRecord | null` remains as-is.
- Any query parameters on the entity detail endpoint.
- Error codes or response codes.
- Any other endpoint group.

---

## Acceptance Criteria Verification

| Criterion | Status | Evidence |
|---|---|---|
| Investigation documents whether entity_aliases currently exist | Complete | Confirmed absent: DB has only `knowledge_base`, `archive`, `entity_relationships`. No alias convention found in MCP/SDK surface. |
| If no alias mechanism exists: concrete table schema proposed | Documented as forward intent in Part 3 — not a Phase 1 deliverable per ticket Out of Scope | Schema column list documented; full migration deferred per scope boundary |
| CP-T002 amendment produced | Complete | Appended to `docs/specs/control-plane-api.md` as `## Amendment — Phase 1 Entity Scope (CP-T006)` |
| Upstream Iranti changes flagged clearly as proposed, not in-scope | Complete | Part 3 explicitly marks upstream table and write mechanism as out of scope for this repo |
| Output written to docs/specs/control-plane-api.md as appended amendment section | Complete | See amendment section |

---

## Open Questions Resolved

**Is `entity_aliases` listed as a planned future table in any Iranti roadmap or issue tracker?**
Unknown — this repo does not have access to the Iranti upstream roadmap or issue tracker. The PM should verify with the Iranti core team whether `entity_aliases` is planned. This spike does not require that answer to unblock Phase 1.

**Are there any existing tests in the Iranti codebase that reference alias functionality?**
Not determinable from this repo. The PM or system_architect would need access to the Iranti core repo to confirm. Not required for Phase 1.

---

## Risks

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Iranti adds `entity_aliases` with a different schema shape than expected | Low–Medium | Low | The control plane API is additive — adding aliases won't break existing endpoints. When the upstream table lands, CP-T002 can be amended again with a concrete schema based on the actual column names. |
| Knowledge base contains alias-like facts by convention (`key="_alias"` etc.) that this spike missed | Low | Low | If this convention is discovered later, it can be surfaced through the existing `/kb` endpoint with a `key` filter — no new endpoint needed. Not a blocker. |
| PM scope changes require alias display in Phase 1 | Low | High | If the PM determines alias display is a Phase 1 requirement, this spike must be re-opened and upstream Iranti changes must be fast-tracked. This would be a schedule risk for Phase 1. PM should explicitly confirm that alias deferral is acceptable before closing this spike. |

---

## Recommendation to PM

Accept the Phase 1 deferral of `entity_aliases`. The Memory Explorer is fully functional without it. Document the limitation in Phase 1 release notes. Create a Phase 2 ticket gated on upstream Iranti adding the table and write mechanism.

The CP-T002 amendment is precise and implementable. A backend developer reading it will know exactly what to do: emit `entity: null` unconditionally, do not implement the aliases endpoint in Phase 1.
