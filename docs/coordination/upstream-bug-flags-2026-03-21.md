# Upstream Bug Flags for Iranti Maintainer

**Prepared by:** product_manager
**Date:** 2026-03-21
**Project context:** Iranti Control Plane — Phase 3
**Iranti version tested against:** 0.2.12 (audit), 0.2.13–0.2.14 (partial fix to B11)

These flags are produced from the cross-repo audit (`docs/coordination/cross-repo-audit-2026-03-21.md`) and subsequent agent testing. They document confirmed Iranti bugs that affect control plane operators. The control plane team cannot fix these — they require changes to Iranti core.

---

## B6 — `iranti_ingest` Contamination: Librarian Extracts from Existing KB, Not Input Text

**Severity:** Critical (production data integrity risk)
**Status:** Confirmed by QA agent benchmark testing (2026-03-21). Partially confirmed by cross-repo audit.
**Iranti versions affected:** At least v0.2.9 through v0.2.12. Not listed as fixed in v0.2.13 or v0.2.14 CHANGELOG.

### What is broken

When an operator calls `iranti_ingest` with free-text input (e.g., "The user prefers Python and dislikes JavaScript"), the Librarian is supposed to extract structured facts from the input text and write them to the knowledge base.

Instead, the Librarian extracts facts from **existing KB entries** for the target entity, not from the input text provided. This means:
- Ingest calls produce writes that duplicate or re-affirm existing facts rather than ingesting new information
- New facts from the input text are silently dropped
- Operators who have used `iranti_ingest` extensively may have KB state that does not reflect what they ingested

### Evidence

From QA agent benchmarking (2026-03-21):
- 2/3 ingest test cases extracted values from existing KB, not from the test text
- 1/3 produced a correct extraction coincidentally because the KB already had a matching seed fact
- When the KB was empty and ingest was called, the extracted facts did not match the input text

### Reproduction

```bash
# Ensure entity has no facts (or clear them)
# Call iranti_ingest with text that contains a novel fact
# Check knowledge_base: the written fact is NOT from the input text
# It is either from existing KB or a hallucination
```

### Operator impact

- Any agent workflow that uses `iranti_ingest` to populate memory is unreliable
- Memory may appear populated while actually containing stale or incorrect data
- Operators have no visibility into this failure — ingest calls return 200 and appear successful

### Suggested investigation areas

- The Librarian's chunker/extractor step receives the ingest input text and should pass it to the LLM for extraction
- The LLM prompt for extraction may be accidentally receiving the KB context (existing facts) as the "input" instead of the raw text
- Check `src/staff/librarian.ts` or equivalent — the extraction step likely prepends KB context for enrichment and the prompt boundary may be wrong

### Control plane team workaround

- CP-T052 AC-4: the Health Dashboard's Attendant card surfaces this limitation informally
- Operators are advised to use `iranti_write` directly rather than `iranti_ingest` for critical fact population
- Documentation note added to `docs/guides/getting-started.md`

---

## B11 — `iranti_attend` Classifier: `classification_parse_failed_default_false`

**Severity:** High (automatic memory injection non-functional)
**Status:** Partially fixed in v0.2.13 ("attend() no longer defaults ambiguous prompts to memory_not_needed so aggressively"). Was fully broken as of v0.2.12.
**Iranti versions affected:** Confirmed broken in v0.2.9–v0.2.12; partially fixed in v0.2.13.

### What was broken (v0.2.12 and earlier)

The `iranti_attend` MCP tool is supposed to decide whether to inject memory before an agent turn. The classifier — which determines if memory injection is needed — was systematically returning `classification_parse_failed_default_false`, meaning:

- The LLM classifier response could not be parsed
- The system defaulted to `memory_not_needed = false` (i.e., always inject) OR to `memory_not_needed = true` (never inject) — the direction of the default was unclear from error messages
- Automatic context-aware injection was non-functional regardless of which direction the default went

### v0.2.13 partial fix

The CHANGELOG states: "attend() no longer defaults ambiguous prompts to memory_not_needed so aggressively, and can now recover personal-memory facts like user/main without manual entity hints."

This suggests the fix addressed the over-aggressive `memory_not_needed` default but may not have fully resolved the parse failure. The control plane team recommends the Iranti maintainer verify:
1. Is `classification_parse_failed_default_false` still being emitted in logs under any conditions?
2. Does `iranti_attend` now work correctly for entities that require `entityHints`?
3. Is the fix backward-compatible with agents that call `iranti_attend` without explicit `entityHints`?

### Operator impact

- Agents using `iranti_attend` for per-turn injection may not receive relevant context even when it exists
- The control plane's Staff Activity Stream may show `memory_not_needed` events that are incorrect
- Users debugging low memory quality will not find the root cause without reading internal logs

### Control plane team surface

- CP-T052: The "Attendant" card in the Health Dashboard surfaces this as an informational note, including the `entityHints` workaround and the CP-T025 context
- The v0.2.13 fix should be re-tested with a benchmark that does not supply `entityHints` to confirm the classifier now works correctly without hints

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

## Summary Table

| Bug | Severity | v0.2.13 status | Control plane workaround | Upstream action needed |
|-----|----------|----------------|--------------------------|----------------------|
| B6: ingest contamination | Critical | Not fixed | Use `iranti_write` directly | Investigate Librarian extraction prompt boundary |
| B11: attend classifier | High | Partially fixed | `entityHints` workaround; CP-T052 surfaces it | Verify classifier fully functional without hints |
| B4: vectorScore=0 | Medium | Improved (fallback added) | CP-T052 vector health card | Confirm in-process scoring performance at scale |
| B9: no MCP read for relationships | Low | Not fixed | Control plane reads REST correctly | Add `iranti_related` MCP tool |
