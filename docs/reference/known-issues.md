# Iranti Control Plane — Known Issues

**Version:** v0.1.0
**Date:** 2026-03-20
**Maintained by:** technical_writer

This document lists all confirmed known issues in the v0.1.0 release of the Iranti Control Plane. It is kept separate from the release notes to make it easier to update as issues are resolved or newly discovered.

Each issue has a stable ID (KI-NNN) that can be referenced in bug reports and GitHub issues.

---

## Issue Index

| ID | Title | Affected View(s) | Severity | Status |
|---|---|---|---|---|
| KI-001 | CP-D001 — All data read paths fail on live DB without SQL column fix | Memory Explorer, Archive Explorer, Entity Detail, Temporal History, Activity Stream | P0 | **FIXED** — v0.1.0, commit `8e5479c` |
| KI-002 | `entity` field always `null` in entity detail response | Entity Detail | P1 | Known, no workaround |
| KI-003 | Staff Activity Stream: Attendant and Resolutionist events absent | Activity Stream | P1 | Known, Phase 2 fix |
| KI-004 | Search uses ILIKE substring matching only — no full-text ranked search | Memory Explorer, Archive Explorer | P2 | Known, Phase 2 fix |
| KI-005 | `staff_events` migration must be run manually — no auto-migration on first run | Activity Stream | P1 | Known, workaround: `npm run migrate` |
| KI-006 | Instance Manager repair actions write to `process.cwd()` regardless of `projectId` | Instance Manager | P1 | Known, Phase 2 gap |
| KI-007 | Getting Started / First-Run screen and repair button UI are backend-only — frontend not yet implemented | Getting Started, Instance Manager | P1 | In implementation |

---

## Detailed Entries

---

### KI-001 — CP-D001: All data read paths fail on live DB without SQL column fix

**Affected views:** Memory Explorer, Archive Explorer, Entity Detail, Temporal History, Staff Activity Stream

**Severity:** P0

**Status: FIXED — v0.1.0, commit `8e5479c`, CI green**

**Description:**

All SQL queries in `src/server/routes/control-plane/kb.ts` originally used snake_case column names (`entity_type`, `entity_id`, `valid_from`, `valid_until`, `archived_reason`, `archived_at`, `superseded_by`, `resolution_state`, `agent_id`, `created_at`, `updated_at`). The Iranti Prisma database schema uses camelCase column names (`entityType`, `entityId`, `validFrom`, etc.). On a live Iranti database, every read query returned zero rows or threw a column-not-found error. The fix applied explicit `AS` aliases to all column references in all KB, archive, entity detail, temporal history, and activity stream queries.

**Workaround (pre-fix):** Not applicable — the fix is applied in v0.1.0.

**Ticket:** CP-D001

---

### KI-002 — `entity` field always `null` in entity detail response

**Affected views:** Entity Detail

**Severity:** P1

**Status:** Known, no workaround in Phase 1

**Description:**

The Entity Detail API response includes an `entity` field intended to carry a canonical `EntityRecord` for the entity — including a `displayName` and optional metadata. In v0.1.0, this field always returns `null`. The `entities` table does not yet exist in the current Iranti schema; entities are inferred from facts written to `knowledge_base` and `archive`, not stored as first-class records.

As a result, the Entity Detail page header shows `entityType/entityId` derived from the fact rows rather than a canonical display name. No entity metadata (display name, description, aliases) is available.

**Workaround:** None. Entity information is fully functional via `entityType` and `entityId`; the absence of `displayName` is a cosmetic limitation.

**Phase 2 fix:** The `entities` table is upstream Iranti scope. The control plane API is ready to surface entity records when they are available.

**Ticket:** CP-T036 (noted as known limitation in acceptance criteria)

---

### KI-003 — Staff Activity Stream: Attendant and Resolutionist events absent

**Affected views:** Staff Activity Stream

**Severity:** P1

**Status:** Known, Phase 2 fix (CP-T025)

**Description:**

The Staff Activity Stream in Phase 1 covers Librarian events (fact writes, replacements, escalations, rejections) and Archivist events (archive runs, decay events, conflict processing) via a database polling adapter. The Attendant (handshakes, reconvenes, attend, observe) and Resolutionist (conflict file decisions, escalation processing) do not yet emit native events to the `staff_events` table.

The UI labels this limitation explicitly: the stream header includes a Phase 1 coverage indicator describing which components are instrumented and which are not.

**Workaround:** Attendant activity can be partially observed by watching `knowledge_base` writes that arrive with `source: mcp` or `source: claude_code`. Resolutionist decisions can be found by browsing the `archive` table filtered by `resolutionState: resolved` in the Archive Explorer.

**Phase 2 fix:** Native Staff emitter injection (CP-T025) adds `IStaffEventEmitter` injection to all four Staff components, bringing Attendant and Resolutionist events into the stream.

**Ticket:** CP-T025 (Phase 2), CP-T026 (Phase 1 coverage label, PM-accepted)

---

### KI-004 — Search uses ILIKE substring matching only

**Affected views:** Memory Explorer, Archive Explorer

**Severity:** P2

**Status:** Known, Phase 2 fix

**Description:**

The `search` filter in the Memory Explorer and Archive Explorer uses `ILIKE %term%` matching against `valueSummary` and `valueRaw` text. This is not full-text ranked search. Consequences:

- Long JSON values may produce unexpected substring matches (e.g., searching for `error` matches any fact whose raw JSON value contains the string "error" anywhere, including inside property names or unrelated strings).
- Results are not ranked by relevance — all matches are returned in the default sort order.
- Very short or very common terms generate high false-positive rates.

**Workaround:** Use more specific search terms, and combine the search filter with entity type, entity ID, or key filters to narrow results before searching.

**Phase 2 fix:** Full-text search using PostgreSQL `tsvector` indexing is planned for Phase 2. Results will be relevance-ranked.

---

### KI-005 — `staff_events` migration must be run manually

**Affected views:** Staff Activity Stream

**Severity:** P1

**Status:** Known, workaround available

**Description:**

The control plane adds one table to your Iranti database (`staff_events`) to store the structured event stream used by the Staff Activity Stream. This migration is not applied automatically on first run. If you start the server without running the migration, the Activity Stream endpoint returns a `500` error and the UI shows a "migration not applied" warning. The Health Dashboard also shows a `warn` status for the Staff Events Table check.

**Workaround:** Run the migration manually once after installation:

```bash
npm run migrate
```

This is a one-time operation. The table persists across server restarts. The migration is a no-op if the table already exists, so it is safe to run again.

**Phase 2 fix:** Auto-migration on startup is being evaluated for Phase 2 as part of the first-run experience (CP-T035). Until then, the `getting-started.md` guide documents this as a required step.

---

### KI-006 — Instance Manager repair actions write to `process.cwd()` regardless of `projectId`

**Affected views:** Instance Manager

**Severity:** P1

**Status:** Known, Phase 2 gap

**Description:**

The repair action endpoints (`/api/control-plane/repair/mcp-json`, `/api/control-plane/repair/claude-md`, `/api/control-plane/repair/doctor`) write integration files to the server process's current working directory (`process.cwd()`) regardless of which `projectId` is passed in the request. In a single-project setup where the control plane is run from the project root, this behaves correctly. In a multi-project setup where the user is managing multiple project bindings, the repair action writes to the wrong directory.

**Workaround:** In v0.1.0, the repair UI is not yet exposed in the frontend (see KI-007), so this issue is not user-facing in practice. When repair actions are surfaced in the UI (Phase 2), users should be aware that the backend fix (binding registry lookup for `projectId`) must ship alongside the UI.

**Phase 2 fix:** CP-T006 (binding registry) will supply the correct project root path per `projectId`. The repair endpoints will be updated to use the registry path rather than `process.cwd()`.

**Ticket:** CP-T033 (Phase 2 repair actions UI), CP-T006 (binding registry)

---

### KI-007 — Getting Started / First-Run screen and repair button UI are backend-only

**Affected views:** Getting Started (first-run), Instance Manager (repair actions)

**Severity:** P1

**Status:** In implementation

**Description:**

Two frontend surfaces are backed by completed server endpoints but do not yet have a functional UI:

1. **Getting Started / First-Run screen (CP-T035):** The setup detection and preflight check endpoints (`/api/control-plane/setup/status`, `/api/control-plane/setup/check`) are implemented on the server. The frontend first-run experience that would guide new users through initial configuration does not yet exist.

2. **Repair action buttons (CP-T033):** The repair endpoints (`/api/control-plane/repair/mcp-json`, `/api/control-plane/repair/claude-md`, `/api/control-plane/repair/doctor`) are implemented on the server. The Instance Manager page does not yet show repair buttons — it is read-only in v0.1.0.

**Workaround:** For repair operations, use the existing Iranti CLI directly (`iranti doctor`, manual `.mcp.json` editing). The Health Dashboard and Instance Manager show the current state of integration files so you can identify what needs to be fixed.

**Phase 2 fix:** Both surfaces are actively in implementation. The Getting Started screen (CP-T035) and repair action UI (CP-T033) will ship in Phase 2.

**Ticket:** CP-T035 (first-run screen), CP-T033 (repair actions UI)

---

## Reporting New Issues

If you encounter a bug not listed here, please file a GitHub issue:

```
https://github.com/your-org/iranti-control-plane/issues
```

Include: your OS, Node.js version, Iranti version, browser, and relevant Health Dashboard output. Reference the KI ID if the issue appears related to a listed item.

This document is updated as issues are resolved or newly confirmed. Check the version header to confirm you are reading the current revision.
