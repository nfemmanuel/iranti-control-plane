# Upstream Bug Flags for Iranti Maintainer

**Prepared by:** product_manager
**Date:** 2026-03-21
**Last revised:** 2026-03-21 — v0.2.16 B6 fix applied
**Project context:** Iranti Control Plane — Phase 3/4
**Iranti version tested against:** 0.2.12 (audit), 0.2.13–0.2.14 (partial fix to B11), 0.2.16 (B6 confirmed fixed)

These flags are produced from the cross-repo audit (`docs/coordination/cross-repo-audit-2026-03-21.md`) and subsequent agent testing. They document confirmed Iranti bugs that affect control plane operators. The control plane team cannot fix these — they require changes to Iranti core.

### Revision notes — 2026-03-21

| Item | Previous status | Corrected status | Reason |
|------|----------------|-----------------|--------|
| `user/main` noise from `typescript_smoke` | Open — attributed to B11 | **RESOLVED upstream** | Upstream regression tests for this specific pattern pass; `user/main` entity recovery without `entityHints` now works correctly |
| Slash-value retrieval loss | Claimed confirmed | **UNDER VERIFICATION** | Upstream regressions for slash-bearing values through `query`, `search`, `observe`, and `attend` passed. Benchmark-side signal appears to be entity-extraction parse fallback noise, not a core product bug. Do not cite as confirmed. |
| Transaction timeout on LLM-arbitrated writes | Not previously tracked | **NEW — OPEN, HIGH PRIORITY** | Confirmed runtime defect: writes requiring LLM arbitration (conflict resolution path) are timing out at the transaction layer. See B12 below. |
| B6: ingest contamination | Critical/Unfixed (v0.2.14 and below) | **FIXED in v0.2.16** | `iranti_ingest` prose extraction is now benchmark-confirmed working per v0.2.16 CHANGELOG. Prior behavior where the Librarian extracted from existing KB instead of input text is resolved. |

---

## B6 — `iranti_ingest` Contamination: Librarian Extracts from Existing KB, Not Input Text

**Severity:** ~~Critical~~ — **FIXED in v0.2.16**
**Status:** **FIXED in v0.2.16** — `iranti_ingest` prose extraction is now benchmark-confirmed working (v0.2.16 CHANGELOG). Prior behavior where the Librarian extracted from existing KB instead of input text is resolved.
**Iranti versions affected:** v0.2.9 through v0.2.15. Fixed in v0.2.16.

> **Note for operators on v0.2.16+:** You can now use `iranti_ingest` for critical fact population. The `iranti_write` workaround documented in earlier versions is no longer required. Upgrade to v0.2.16 to get the fix.

### What was broken (v0.2.15 and earlier)

When an operator called `iranti_ingest` with free-text input (e.g., "The user prefers Python and dislikes JavaScript"), the Librarian was supposed to extract structured facts from the input text and write them to the knowledge base.

Instead, the Librarian extracted facts from **existing KB entries** for the target entity, not from the input text provided. This meant:
- Ingest calls produced writes that duplicated or re-affirmed existing facts rather than ingesting new information
- New facts from the input text were silently dropped
- Operators who used `iranti_ingest` extensively may have KB state that does not reflect what they ingested

### Evidence

From QA agent benchmarking (2026-03-21, against v0.2.12):
- 2/3 ingest test cases extracted values from existing KB, not from the test text
- 1/3 produced a correct extraction coincidentally because the KB already had a matching seed fact
- When the KB was empty and ingest was called, the extracted facts did not match the input text

### Fix (v0.2.16)

The v0.2.16 CHANGELOG states: "`iranti_ingest` prose extraction is now benchmark-confirmed working in v0.2.16." Benchmark rerun validation across ingest, relationships, search, observe, attend, persistence, and exact lookup was performed as part of the v0.2.16 release.

### Control plane team position

- The `iranti_write` workaround documented in v0.3.0 release notes is **no longer required** for operators running Iranti v0.2.16+
- The Getting Started guide note about this limitation should be updated to reflect the fix — Phase 5 documentation pass should include this
- Operators on v0.2.15 or earlier should upgrade to v0.2.16 to get reliable ingest behavior

---

## B11 — `iranti_attend` Classifier: `classification_parse_failed_default_false`

**Severity:** High (automatic memory injection non-functional)
**Status:** Partially fixed in v0.2.13 ("attend() no longer defaults ambiguous prompts to memory_not_needed so aggressively"). Was fully broken as of v0.2.12. The specific `user/main` recovery pattern — which was previously attributed as an open item under this bug — is now **RESOLVED upstream** as of v0.2.14 (upstream regression tests for `user/main` entity recovery without `entityHints` pass).
**Iranti versions affected:** Confirmed broken in v0.2.9–v0.2.12; partially fixed in v0.2.13; `user/main` recovery confirmed working in v0.2.14.

### What was broken (v0.2.12 and earlier)

The `iranti_attend` MCP tool is supposed to decide whether to inject memory before an agent turn. The classifier — which determines if memory injection is needed — was systematically returning `classification_parse_failed_default_false`, meaning:

- The LLM classifier response could not be parsed
- The system defaulted to `memory_not_needed = false` (i.e., always inject) OR to `memory_not_needed = true` (never inject) — the direction of the default was unclear from error messages
- Automatic context-aware injection was non-functional regardless of which direction the default went

### What is resolved (v0.2.13–v0.2.14)

The CHANGELOG for v0.2.13 states: "attend() no longer defaults ambiguous prompts to memory_not_needed so aggressively, and can now recover personal-memory facts like user/main without manual entity hints."

**2026-03-21 verification update:** Upstream regression tests for the `user/main` entity recovery pattern now pass without `entityHints`. The `user/main` noise previously observed in `typescript_smoke` benchmarks was caused by the classifier bug and is resolved. **Do not cite `user/main` recovery failure as an open defect.**

### What may still be open

The v0.2.13 fix addressed the over-aggressive default; it is not fully confirmed whether `classification_parse_failed_default_false` can still be emitted under edge conditions. The control plane team recommends the Iranti maintainer verify:
1. Is `classification_parse_failed_default_false` still being emitted in logs under any conditions with v0.2.14+?
2. Does `iranti_attend` now work correctly for all entity types, not just `user/main`?
3. Is the fix backward-compatible with agents that never supply `entityHints`?

### Operator impact

- Agents using `iranti_attend` without `entityHints` should now work correctly for `user/main` entities
- The control plane's Staff Activity Stream may still show stale `memory_not_needed` events from pre-v0.2.13 runs — these can be disregarded
- Users on v0.2.12 or earlier should upgrade; the classifier failure is not recoverable at the control plane layer

### Control plane team surface

- CP-T052: The "Attendant" card in the Health Dashboard surfaces the current classifier status including the v0.2.14 resolution note
- The `entityHints` workaround remains documented but is no longer required for `user/main` on v0.2.14+

---

## B4 — Vector Scoring: `vectorScore=0` for All KB Entries (Context)

**Severity:** Medium (search quality degraded)
**Status:** Partially addressed in v0.2.13 ("Hybrid search now falls back to deterministic in-process semantic scoring when pgvector is unavailable"). Active tracking in control plane via CP-T052.
**Iranti versions affected:** v0.2.9–v0.2.12 confirmed. v0.2.13 improves fallback behavior.

### What was observed

In environments without pgvector or an external vector backend, `vectorScore=0` for all KB entries in search results. The hybrid search was falling back to lexical-only ranking without surfacing this to operators.

### v0.2.13 status

The CHANGELOG confirms: "Hybrid search now falls back to deterministic in-process semantic scoring when pgvector is unavailable." This means vector scoring should now degrade gracefully to in-process scoring rather than zero-scoring. The "External vector backends now receive the metadata needed for filtered searches" note also suggests filtered vector search was broken.

### Remaining questions for maintainer

1. Does the in-process semantic scoring perform acceptably for production-scale knowledge bases (>1000 facts)?
2. Is the fallback visible to operators (surfaced in logs or health endpoint)?
3. Does `GET /health` or any endpoint now report which vector backend is active and whether it is healthy?

### Control plane team action

CP-T052 adds a Vector Backend health card to the control plane Health Dashboard that surfaces `IRANTI_VECTOR_BACKEND`, the configured URL, and a lightweight probe result. This gives operators visibility they currently lack.

---

## B9 — `iranti_relate` Writes Work, But No MCP Read Tool for `GET /kb/related`

**Severity:** Low (affects agent-to-agent coordination, not operator visibility)
**Status:** Known gap — not expected to be fixed imminently. Control plane reads relationships correctly via REST.
**Iranti versions affected:** v0.2.9–v0.2.14 (no fix noted in any CHANGELOG entry).

### What is missing

Agents can write relationship edges via `iranti_relate` (5/5 test cases pass). However, there is no MCP tool for reading relationships back — no `iranti_related` or equivalent. Agents who want to know which entities are related to a given entity must call the REST API directly, which is not possible in a Claude Code context where only MCP tools are available.

### Impact

- Agents cannot query relationships they wrote — relationship data is write-only from the agent perspective
- The control plane reads `GET /kb/related` correctly via REST, so the Entity Relationship Graph (CP-T032) works correctly for operators
- The gap only affects agents, not control plane operators

### Suggested action

Add an `iranti_related` MCP tool that maps to `GET /kb/related/:entityType/:entityId`. This would complete the agent relationship round-trip. Low urgency but high value for multi-agent coordination workflows.

---

## Under Verification — Slash-Value Retrieval Loss

**Severity:** Unconfirmed
**Status:** UNDER VERIFICATION — do not cite as a confirmed bug.
**Previously claimed:** Control plane benchmark testing appeared to show that fact values containing slashes (e.g., `http://...`, `file://...`, path strings) were being dropped or truncated by `iranti_query`, `iranti_search`, `iranti_observe`, and `iranti_attend`.

### 2026-03-21 update

Upstream regression tests for slash-bearing values through all four retrieval paths (`query`, `search`, `observe`, `attend`) have **passed**. The signal previously observed in benchmark output is now attributed to entity-extraction parse fallback noise in the benchmark harness itself, not a defect in Iranti core.

**Do not cite slash-value retrieval loss as a confirmed defect in upstream bug reports or operator-facing documentation until a clean reproduction outside the benchmark harness is established.**

### If investigating further

- Test with a direct `iranti_write` of a known slash-bearing value followed by `iranti_query` for that exact fact
- Confirm whether the value is stored correctly in the KB (`knowledge_base.value` column)
- If retrieval returns a truncated or absent value, reproduce with the full request/response logged and open a new bug flag

---

## B12 — Transaction Timeout on LLM-Arbitrated Writes

**Severity:** High (confirmed runtime defect, data loss risk under conflict)
**Status:** OPEN — confirmed by runtime testing 2026-03-21. Not listed as fixed in any CHANGELOG entry through v0.2.14.
**Iranti versions affected:** v0.2.14 and below (earliest affected version not determined).

### What is broken

When Iranti processes a write that requires LLM arbitration — specifically the conflict resolution path triggered when multiple values exist for the same fact key and the system must choose or merge — the database transaction times out before the LLM round-trip completes. The write is rolled back.

This means:
- Conflict resolution calls fail silently (or with a generic timeout error) rather than producing a merged or chosen value
- The original conflicting facts remain; no resolution is written
- Agents that rely on `iranti_write` for conflict-prone keys (e.g., preference facts that may be written by multiple agents) accumulate unresolved conflicts over time
- The failure is not surfaced as a user-visible error in most MCP tool responses — operators must inspect logs to detect it

### Evidence

Confirmed by runtime testing 2026-03-21. The transaction timeout occurs specifically on the conflict-resolution code path; non-conflicting writes succeed normally.

### Operator impact

- Any multi-agent workflow where two agents write to the same entity/key is affected
- Conflict accumulation degrades future search and attend quality (more candidate values, lower confidence scores)
- Operators who see unexpectedly low confidence facts in the KB should check whether conflict resolution has been silently failing

### Suggested investigation areas for upstream

- The LLM arbitration call should be moved outside the database transaction, or the transaction timeout should be extended for the arbitration path
- Consider a two-phase approach: record the conflict outside the transaction, then run arbitration and write the result in a fresh transaction
- The MCP tool response for a timed-out arbitration write should surface an error code rather than silently dropping the write

### Control plane team surface

- No CP ticket exists yet for this defect — it was confirmed after the current sprint was frozen
- CP-T052 Health Dashboard does not currently surface conflict resolution failures; a future ticket should add visibility into this failure mode
- Operators experiencing this can use `iranti_query` to inspect conflicting values and `iranti_write` with an explicit resolved value to manually resolve conflicts

---

## Summary Table

| Bug | Severity | Latest status | Control plane workaround | Upstream action needed |
|-----|----------|---------------|--------------------------|----------------------|
| B6: ingest contamination | ~~Critical~~ | **Fixed in v0.2.16** | `iranti_write` workaround no longer required on v0.2.16+ | None — resolved |
| B11: attend classifier | High | `user/main` recovery **RESOLVED** in v0.2.14; other edge cases may remain | `entityHints` no longer required for `user/main`; CP-T052 notes resolution | Verify classifier fully functional for all entity types without hints |
| B12: transaction timeout on LLM-arbitrated writes | High | **OPEN** (confirmed 2026-03-21, not fixed through v0.2.16) | Use `iranti_write` with explicit resolved value to manually resolve conflicts | Move LLM arbitration outside DB transaction or extend timeout |
| B4: vectorScore=0 | Medium | Improved in v0.2.13 (fallback added); no further changes in v0.2.14–v0.2.16 | CP-T052 vector health card | Confirm in-process scoring performance at scale |
| Slash-value retrieval loss | Unconfirmed | **UNDER VERIFICATION** — upstream regressions pass | None required until confirmed | Establish reproduction outside benchmark harness before filing |
| B9: no MCP read for relationships | Low | Not fixed through v0.2.16 | Control plane reads REST correctly | Add `iranti_related` MCP tool |
