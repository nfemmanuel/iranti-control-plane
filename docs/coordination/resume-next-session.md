# Resume Prompt — Next PM Session

**Last updated:** 2026-03-21 (Wave 8 PM acceptance complete, Wave 9 dispatched)
**Current branch:** master
**Phase:** 3 — Advanced Operator Features

---

## Immediate Status

### Wave 3 — CP-T048 (Platform Installer Packages)
- **State:** Implementation complete. AC-11 (clean-machine validation) is the only remaining gate.
- **Blocked on:** Physical/VM clean-machine testing. Cannot be automated. QA engineer (or user) must run the test plan.
- **AC-11 gate:** Windows, macOS, Linux clean-machine pass table required before PM can accept.
- **Test plan:** `docs/qa/cp-t048-clean-machine-test-plan.md`

### Wave 4 — ALL PM-ACCEPTED 2026-03-21
- CP-T051 (Agent Registry View) — PM-ACCEPTED
- CP-T052 (Health: Decay + Vector + Attend) — PM-ACCEPTED
- CP-T053 (Memory Explorer: ConflictLog + Labels) — PM-ACCEPTED

### Wave 5 — ALL PM-ACCEPTED 2026-03-21
- CP-T056 (Temporal History asOf Query) — PM-ACCEPTED
- CP-T057 (WhoKnows Contributor Panel) — PM-ACCEPTED
- CP-T058 (UX Guidance Labels M4/M5/H8) — PM-ACCEPTED

### Wave 6 — PM-ACCEPTED 2026-03-21
- CP-T059 (Interactive Diagnostics Panel) — PM-ACCEPTED

### Wave 7 — PM-ACCEPTED 2026-03-21
- CP-T060 (Metrics Dashboard) — PM-ACCEPTED 2026-03-21

### Wave 8 — PM ACCEPTANCE COMPLETE 2026-03-21

| Ticket | Title | Result |
|--------|-------|--------|
| CP-T061 | Entity Alias Management UI | **Backend PM-ACCEPTED; Frontend REJECTED** — shape mismatch (see CP-T065) |
| CP-T062 | Relationship Graph: B9 note | **PM-ACCEPTED** |
| CP-T063 | API Key Scope Audit View | **PM-ACCEPTED** (scope fields gracefully null — Iranti doesn't expose scope via API) |
| CP-T064 | Documentation: asOf + Contributors + Metrics | **PM-ACCEPTED** (two spec gaps noted, docs match actual implementation) |

### Wave 9 — DISPATCHED 2026-03-21

| Ticket | Title | Assignees | Priority | State |
|--------|-------|-----------|----------|-------|
| CP-T065 | Entity Alias Panel: Rewrite for Real Iranti Shape | frontend_developer | P2 | OPEN |

---

## CP-T061 Shape Mismatch — Full Record

The CP-T006 spike assumed aliases were entity cross-references:
```json
{ "aliasEntityType": "user", "aliasEntityId": "alice", "createdAt": "..." }
```

Iranti v0.2.15 actually returns flat alias tokens:
```json
{
  "canonicalEntity": "user/alice-doe",
  "aliases": [{ "alias": "alice", "aliasNorm": "alice", "source": "query", "confidence": 50, "createdAt": "..." }],
  "total": 1
}
```

The backend proxy (accepted) uses the real shape. The frontend was built against the spec. CP-T065 rewrites the frontend: single-token list (no entity links), single-field create form, corrected types.

---

## Patch Still Needed — "Created by" Column Header in Memory Explorer

During CP-T053 acceptance, the PM noted the column header reads "Created by" but the expanded row reads "Written by" (AC-3 of CP-T053).

- **File:** `src/client/src/components/memory/MemoryExplorer.tsx`
- **Line ~695:** `<th>Created by</th>` — should be `<th>Written by</th>`
- **Filter input placeholder (~line 420):** `placeholder="Created by"` — should be `placeholder="Written by"`

Non-blocking one-line patch. Bundle into next commit or assign to frontend_developer.

---

## Open Gaps (Wave 9+ candidates)

### Medium priority
- **CP-T065** (in progress — Wave 9): Fix alias panel frontend for real Iranti shape
- **Full-text search across fact values** — `GET /kb/search` not yet surfaced in the control plane; Memory Explorer uses ILIKE substring matching only
- **CP-T025 native emitter PR submission** — system_architect carryover. Spec PM-approved. Long deferred. PM should follow up on submission status.
- **Multi-instance comparison view** — high value for operators with multiple Iranti instances
- **Agent Registry sidebar badge** — CP-T051 AC-10 stretch (badge for high-escalation inactive agents) not implemented; acceptable at MVP, should revisit if operators request it
- **Command palette search/recent items** — deferred from CP-T024; CP-T042 added shortcuts help but full search was not implemented
- **Staff Logs export end-to-end verification** — JSONL/CSV export included in CP-T050; confirm it's working

### Low priority
- Force-write / operator override path for C2 conflict limitation — needs UX scoping
- Site integration — iranti.dev has no mention of the control plane (cross-repo ticket needed)
- 90d period option for Metrics Dashboard — deferred from CP-T060; add when `staff_events` history is long enough

---

## CP-T048 PM Position

AC-11 (clean-machine validation) is a hard gate. Cannot accept without a real pass table from clean-machine tests. The implementation is solid. Recommendation: run `docs/qa/cp-t048-clean-machine-test-plan.md` when a VM is available.

---

## Iranti Version Context

- **Current Iranti version:** 0.2.15 (Unreleased — "Pending release notes" only; no breaking changes confirmed by backend agent's alias API investigation)
- **Last audited:** 0.2.12 (cross-repo audit 2026-03-21)
- **Key changes since audit:**
  - v0.2.13: Hybrid search fallback to deterministic semantic scoring; attend() classifier improvement; Python smoke fixes
  - v0.2.14: Windows updater EBUSY race condition fixed (no API changes)
  - v0.2.15: Unreleased — changelog placeholder only; alias API investigation confirmed real shape is flat string tokens, not entity cross-references
- **Confirmed alias API shape (v0.2.15):**
  - GET /kb/entity/:type/:id/aliases → `{ canonicalEntity, aliases: [{ alias, aliasNorm, source, confidence, createdAt }], total }`
  - POST /kb/alias → `{ canonicalEntity, alias, source?, confidence?, force? }`
- **Next drift check:** When Iranti reaches v0.2.16 or when v0.2.15 is formally released with full release notes.
- **Confirmed Iranti bugs (upstream flags sent via memo):** B6 (ingest contamination), B11 (attend classifier — partial fix in v0.2.13), B4 (vector scoring — improved in v0.2.13), B9 (no MCP read tool for relationships — CP-T062 adds a note about this in the UI).

---

## TypeScript Status (2026-03-21 Wave 8 Review)

- `src/server` — tsc --noEmit: **CLEAN** (0 errors)
- `src/client` — tsc --noEmit: **CLEAN** (0 errors)

Note: The client compiles clean despite the alias shape mismatch because the types were invented to match the wrong spec. CP-T065 will correct this — after the fix, the types will match the real API and TypeScript will catch future regressions against the spec.
