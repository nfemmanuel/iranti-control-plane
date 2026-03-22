# Resume Prompt — Next PM Session

**Last updated:** 2026-03-21 (Wave 11 dispatched — CP-T071/T072 DONE; T073 in progress; T074/T075 committed)
**Current branch:** master
**Phase:** 5 — Session Recovery & Runtime Lifecycle

---

## Current State Summary

### Phase / Wave status

| Phase | Waves | Version | Status |
|-------|-------|---------|--------|
| Phase 0 | Foundation | — | **COMPLETE** |
| Phase 1 | Operability MVP | v0.1.0 | **SHIPPED** |
| Phase 2 | Interactive Management | v0.2.0-beta | **COMPLETE** |
| Phase 3 | Advanced Operator Features | v0.3.0 | **PM-ACCEPTED** (all Waves 1–9) |
| Phase 4 | Iranti Desktop | v0.4.0 | **PM-ACCEPTED 2026-03-21** (Wave 10: CP-T068, CP-T069, CP-T070) |
| Phase 5 | Session Recovery & Runtime Lifecycle | v0.5.0 | **IN PROGRESS** — Wave 11 dispatched; CP-T071 DONE, CP-T072 DONE, CP-T073 in progress |

### Release status

| Version | Status | Blocker |
|---------|--------|---------|
| v0.1.0 | Shipped | — |
| v0.2.0-beta | Shipped | — |
| v0.3.0 | **Release Candidate** | CP-T048 AC-11 clean-machine validation pending (CP-T075) |
| v0.4.0 | **Release Candidate** | CP-T048 AC-11 (same gate); no GitHub Release tag pushed |

Neither v0.3.0 nor v0.4.0 has a formal GitHub Release or pushed tag. The binary builds exist in dist/. The release gate is CP-T048 AC-11.

---

## Iranti Upstream State

- **Current Iranti version:** 0.2.16 (released 2026-03-21)
- **Last cross-repo audit:** v0.2.16 — `docs/coordination/cross-repo-audit-v0216-2026-03-21.md`
- **Key v0.2.16 additions:**
  - Durable interrupted-session recovery: `/memory/checkpoint`, `/memory/resume`, `/memory/complete`, `/memory/abandon` routes
  - Runtime lifecycle tracking: `runtime.json` per instance, `GET /health` now includes `runtime` field with `InstanceRuntimeState`
  - `iranti upgrade --restart --instance <name>` — coordinates restart for named running instance
  - `iranti_ingest` prose extraction benchmark-confirmed working (B6 fixed)
  - Relationship traversal confirmed working end-to-end (write → read → depth traversal)

---

## Bug Flag Status (upstream-bug-flags-2026-03-21.md)

| Bug | Status as of 2026-03-21 |
|-----|-------------------------|
| B6: ingest contamination | **FIXED in v0.2.16** — `iranti_write` workaround no longer required |
| B11: attend classifier | `user/main` recovery **RESOLVED** in v0.2.14; edge cases may remain |
| B12: transaction timeout on LLM-arbitrated writes | **OPEN** — not fixed through v0.2.16 |
| B4: vectorScore=0 | Improved in v0.2.13 (fallback added); stable |
| Slash-value retrieval loss | **RETRACTED** — v6.0 revalidation: no defect; benchmark harness noise |
| B9: no MCP read for relationships | **OPEN** — not fixed through v0.2.16 |

---

## TypeScript Status

- `src/server` — tsc --noEmit: **CLEAN** (0 errors, post-CP-T071/T072)
- `src/client` — tsc --noEmit: **CLEAN** (0 errors, post-CP-T071/T072)

---

## Open Items

### Hard blockers

| Item | Ticket | Owner | Notes |
|------|--------|-------|-------|
| CP-T048 AC-11 — clean-machine installer validation | CP-T075 | qa_engineer | Automated assessment done (`docs/qa/ac11-automated-assessment-2026-03-21.md`). Execution guide written (`docs/qa/ac11-execution-guide.md`). Requires human tester on clean machine. |

### Carryover deliverables

| Item | Ticket | Owner | Notes |
|------|--------|-------|-------|
| CP-T025 upstream PR submission | CP-T074 | system_architect | Branch `feat/staff-event-emitter-injection` created in iranti repo. PR submission in progress (Architect agent running). |

### Phase 5 ticket status

| Ticket | Title | Status | Notes |
|--------|-------|--------|-------|
| CP-T071 | Session Recovery Visibility | **DONE** | Sessions backend proxy + Sessions view committed. tsc-clean. |
| CP-T072 | Runtime Lifecycle Dashboard | **DONE** | Runtime field extracted from /health; per-instance runtimeStatus; InstanceManager RUNNING/STALE/STOPPED badge. tsc-clean. |
| CP-T073 | Iranti Upgrade Coordination | **IN PROGRESS** | Backend + frontend agents dispatched. Awaiting completion and TypeScript verification. |
| CP-T074 | Submit CP-T025 Upstream PR | **IN PROGRESS** | Architect agent applying diffs to iranti repo. Awaiting PR URL. |
| CP-T075 | CP-T048 AC-11 Closure | **DONE (QA portion)** | Assessment + execution guide committed. Human testing required for final closure. |

**Next PM action:** When CP-T073 and CP-T074 complete — verify tsc-clean, accept Wave 11/12, update tickets to ACCEPTED, update resume-next-session. Then PM-accept Phase 5 when all tickets complete and tsc is clean.

---

## Phase 4 Wave 10 Acceptance Summary — 2026-03-21

All three tickets PM-ACCEPTED 2026-03-21. Full notes in `docs/releases/v0.4.0-release-notes.md`.

- **CP-T068** (Home Overview Dashboard): `GET /api/control-plane/overview` endpoint, 5-card landing dashboard, alert banner, quick actions. `/` now redirects to `/overview`. Home nav item added.
- **CP-T069** (Proactive Health Alert Toasts): Health poller at 60s, state-transition-only toasts (warn/error/info), deduplicated, bottom-right corner.
- **CP-T070** (Global Keyboard Shortcuts): `G + key` navigation, go mode chip, all 12 views covered, palette integration.

---

## Phase 5 Direction

Phase 5 is driven by Iranti v0.2.16 new capabilities that the control plane has no surface for. Three feature areas:

1. **Session recovery surface** — Iranti now tracks interrupted, checkpointed, abandoned, and complete sessions via `/memory/checkpoint`, `/memory/resume`, `/memory/complete`, `/memory/abandon`. The control plane shows no session state. Operators cannot see which sessions are interrupted or resume/abandon them from the UI.

2. **Runtime lifecycle visibility** — Iranti instances now emit runtime metadata (`runtime.json`, `GET /health` runtime field). The Instance Manager shows instances but does not distinguish live processes from stale metadata. Operators need running vs stale status.

3. **Upgrade coordination** — `iranti upgrade --restart --instance <name>` is a new CLI flow. Operators should be able to trigger this from the Instance Manager without a terminal.

Additionally: CP-T025 upstream PR submission and CP-T048 AC-11 closure are Phase 5 deliverables (not features).

---

## Iranti Version Context

- **Current upstream version:** 0.2.16 (released 2026-03-21)
- **Next drift check:** When Iranti reaches v0.2.17 or PM initiates Phase 5 kickoff
- **Cross-repo audit:** `docs/coordination/cross-repo-audit-v0216-2026-03-21.md`
