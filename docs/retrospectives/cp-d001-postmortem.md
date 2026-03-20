# CP-D001 Post-Mortem — SQL Column Name Mismatch (snake_case vs Prisma camelCase)

**Author:** product_manager
**Date:** 2026-03-20
**Defect:** CP-D001 — P0 Blocker: all KB/archive/entity/history data routes fail on live Iranti DB
**Severity:** P0 — all data read paths broken on live DB
**Discovered by:** qa_engineer, during CP-T030 seed test execution
**Status:** Under active fix by backend_developer

---

## What Happened

The SQL queries in `src/server/routes/control-plane/kb.ts` were written using snake_case column names (e.g., `entity_type`, `created_at`, `value_raw`, `agent_id`, `valid_from`). The live Iranti PostgreSQL database, generated and managed by Prisma, uses camelCase column names (e.g., `"entityType"`, `"createdAt"`, `"valueRaw"`, `"agentId"`, `"validFrom"`).

Every WHERE clause, ORDER BY clause, and explicit SELECT column list in `kb.ts` used the wrong casing. PostgreSQL is case-sensitive on quoted identifiers, and the unquoted snake_case names do not match any column in the schema — causing `ERROR 42703: column "summary" does not exist` on every query.

The defect was invisible in testing because:
1. The 104 unit tests in `tests/unit/` test pure function logic (serializers, where-clause builders, query constructors) against mock data — they do not execute against a live PostgreSQL database.
2. The integration test environment used for CI does not connect to a live Iranti instance.
3. No end-to-end test against a seeded live database was run before the Phase 1 acceptance was granted.

The QA seed test (CP-T030) was the first test to hit a real Iranti database with real data — and it surfaced the defect immediately.

---

## Root Cause Analysis

### Immediate cause

The developer writing `kb.ts` used snake_case column names from conventional SQL instinct. Prisma's behavior — storing columns in the DB as camelCase when the Prisma schema uses camelCase field names — is a non-obvious default that is easy to miss unless you explicitly verify against the live schema.

The serializer functions were written defensively with dual-read fallbacks (`row.entity_type ?? row.entityType`) — indicating the author was aware of the casing question at the row serialization layer — but this awareness did not propagate to the WHERE/ORDER BY/SELECT layers where the error actually originates.

### Contributing factors

1. **No raw SQL column name verification step in the development protocol.** The development protocol (at the time) covered TypeScript compilation, unit tests, and CI but did not include a step requiring developers to verify raw SQL column names against the Prisma schema (or the live DB) before pushing.

2. **Unit tests don't cover live DB behavior.** This is by design for unit test isolation, but it created a gap: the behavior that unit tests could not catch (SQL column names) was also not covered by any automated integration test.

3. **Phase 1 acceptance was granted without a live DB smoke test.** The PM accepted Phase 1 based on CI green (unit tests) and functional review. A single live-DB smoke test — even just `GET /kb` returning rows — would have caught this before acceptance.

4. **Dual-read serializer pattern gave false confidence.** The presence of `row.entity_type ?? row.entityType` fallbacks in the serializers (the right approach for handling both casing conventions) may have created an implicit belief that the casing ambiguity was already handled end-to-end. It was not: the error occurs before rows are returned, in the WHERE/ORDER BY clauses.

---

## What Changed as a Result

### Process change 1: Step 0 added to development protocol

A pre-implementation verification step has been added to `docs/protocols/development.md`:

> **Step 0 — If you write raw SQL, verify column names against the Prisma schema before pushing.**
> Every column name used in raw SQL (WHERE, ORDER BY, SELECT, JOIN) must be verified against the actual Prisma schema field names (camelCase) or the live DB schema (`\d tablename` in psql). If there is any ambiguity, quote the column name. Do not rely on serializer fallbacks to catch WHERE/ORDER BY errors — they run before any row is returned.

### Process change 2: Live DB smoke test added to Phase acceptance criteria

Any future Phase acceptance by the PM will require evidence that at least one live-DB end-to-end request returned expected data (not a SQL error). This is documented in the PM's acceptance checklist.

### Process change 3: QA seed test (CP-T030) mandated at the end of each phase

The CP-T030 seed test pattern (write known data, then verify it returns correctly through the API) is now a required part of every phase's acceptance gate, not an optional verification step.

---

## Timeline

| Time | Event |
|------|-------|
| 2026-03-20 (earlier) | Phase 1 accepted by PM — CI green (104 unit tests), functional review passed |
| 2026-03-20 | qa_engineer runs CP-T030 seed test against live Iranti DB |
| 2026-03-20 | `column "summary" does not exist` errors surface on all KB/archive routes |
| 2026-03-20 | CP-D001 filed by qa_engineer, escalated to PM |
| 2026-03-20 | PM: v0.1.0 hold declared, backend_developer assigned to fix |
| 2026-03-20 | PM: postmortem written, protocol update drafted |

---

## Impact

- All Memory Explorer, Archive Explorer, Entity Detail, Temporal History, and Staff Activity Stream data routes fail on a live Iranti database.
- v0.1.0 design partner handoff is on hold.
- Phase 2 test execution is blocked until live DB reads work.
- CP-T036 (Entity Detail + Temporal History frontend, already implemented) cannot be validated against real data until the fix is in.

---

## What Does NOT Need to Change

- The unit test suite is working correctly and should remain isolated from live DB dependencies. This is the right test design.
- The serializer dual-read pattern (`row.entity_type ?? row.entityType`) is a reasonable defensive pattern for forward compatibility. It should be kept.
- The CI pipeline is working correctly — it is not designed or expected to catch live DB column errors.

---

## Open Questions

1. Are there any other raw SQL files in the codebase that may have the same snake_case column name issue? The fix covers `kb.ts`, `health.ts`, and `events.ts`. A broader audit should be done before Phase 2 tickets add new SQL.

2. Should the project add a lightweight integration test that connects to a test database and runs one query per route? This would catch this class of bug automatically in CI. This is a Phase 2 DX investigation item for the devops_engineer.

---

## Lessons

1. Prisma's camelCase-in-DB behavior is a footgun for raw SQL use. Any future raw SQL added to this codebase must be reviewed against the Prisma schema before it reaches review.
2. Unit test pass rates are not a proxy for live DB correctness. A green CI on unit tests does not mean the API works against a real database.
3. End-to-end smoke tests — even a single one — are worth more than any number of unit tests for catching infrastructure-level bugs like column name mismatches.
4. When a serializer has casing fallbacks, verify that the query layer (WHERE, ORDER BY, SELECT) shares the same awareness. Fallbacks in serializers do not propagate backward to the query string.

---

*Written by: product_manager*
*Filed under: docs/retrospectives/cp-d001-postmortem.md*
*Related: CP-D001, CP-T030, docs/protocols/development.md*
