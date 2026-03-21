# Resume Prompt — Next PM Session

**Last updated:** 2026-03-21
**Current branch:** master
**Phase:** 3 — Advanced Operator Features

---

## Immediate Status

### Wave 3 — CP-T048 (Platform Installer Packages)
- **State:** Implementation complete. AC-11 (clean-machine validation) is the only remaining gate.
- **What's done:** Node SEA build scripts (`build-windows.mjs`, `build-macos.mjs`, `build-linux.mjs`), CI pipeline (`.github/workflows/package.yml`), QA test plan (`docs/qa/cp-t048-clean-machine-test-plan.md`).
- **Bugs fixed this session:** ISSUE-6 (CI macOS launcher missing shell wrapper — `package.yml` `build-macos-universal` job now matches `build-macos.mjs`), ISSUE-7 (AppImage version detection — `package.json` now also copied to `usr/bin/`).
- **Blocked on:** Physical/VM clean-machine testing. Cannot be automated. QA engineer (or user) must run the test plan.
- **AC-11 gate:** Windows, macOS, Linux clean-machine pass table required before PM can accept.

### Wave 4 — Three new tickets issued 2026-03-21
All three are **OPEN**. No implementation has started.

| Ticket | Title | Assignees | Key scope |
|--------|-------|-----------|-----------|
| CP-T051 | Agent Registry View | backend_developer + frontend_developer | Proxy `GET /agents` from Iranti; `/agents` route in sidebar with list + detail |
| CP-T052 | Health: Decay + Vector + Attend | backend_developer + frontend_developer | Extend health endpoint with decay config, vector backend reachability, Attendant informational; three new Health Dashboard cards |
| CP-T053 | Memory Explorer: ConflictLog + Labels | frontend_developer | ConflictLog timeline in expanded rows (Memory + Archive), "Written by" label for createdBy, stability/lastAccessedAt fields |

---

## Completed This Session (2026-03-21)

1. **PM cross-repo audit** — `docs/coordination/cross-repo-audit-2026-03-21.md` — 10 major alignment gaps found vs Iranti v0.2.12 (control plane was specced against v0.2.9). Full findings in audit doc.
2. **Three Wave 4 tickets created:** CP-T051, CP-T052, CP-T053 in `docs/tickets/`.
3. **Roadmap updated** — Phase 3 Wave 4 section added; ticket table updated.
4. **Agent assignments updated** — `docs/coordination/agent-assignments-phase3.md` — Wave 4 assignment blocks appended with full scope details.
5. **ISSUE-6 fixed** — `package.yml` `build-macos-universal` job updated with shell launcher wrapper (CFBundleExecutable fix).
6. **ISSUE-7 fixed** — `build-linux.mjs` now copies `package.json` to `usr/bin/` for AppImage version detection.
7. **Logs serializer test suite** — `src/server/tests/unit/logs-serializers.test.ts` — 59 tests, all pass.
8. **H7 done** — `docs/guides/getting-started.md` — Added `iranti doctor --debug` section at top of Troubleshooting.
9. **Backlog updated** — CP-E011 (Advanced Operator Features) added; all prior epics marked complete.
10. **PRD header updated** — stale v0.1.0 hold warning removed.

---

## Open Gaps and Follow-On Work

### High priority
- **CP-T048 AC-11**: Clean-machine validation still required. QA test plan at `docs/qa/cp-t048-clean-machine-test-plan.md`. PM cannot accept CP-T048 without pass table.
- **CP-T051, CP-T052, CP-T053**: All open. PM should dispatch backend_developer and frontend_developer for Wave 4 kickoff once CP-T048 is accepted or parallelized at PM's discretion.

### Medium priority (from audit)
- **M4 gap**: Provider Manager should show label "To change providers, run `iranti setup`" since write path is deferred.
- **M5 gap**: When instance is unreachable, surface `iranti run --instance <name>` command in the UI.
- **H6**: Verify `iranti doctor` project-bound fix (0.2.11) — add regression note to Health view QA.
- **H8**: Show `IRANTI_PROJECT_MODE` value in Instance Manager.

### Low priority / upstream
- **C1/C2**: Flag `iranti_attend` classifier bug and ingest contamination (B6) to upstream Iranti team. These are benchmark findings — not control plane bugs — but operators hitting them will be confused.
- **C3**: Ingest audit trail — a new ticket may be warranted if the B6 contamination is confirmed in production use.
- **CP-T025**: system_architect should submit the upstream PR to Iranti maintainer. Carryover from Phase 2.

---

## Key Files for Next Session

- `docs/tickets/cp-t051.md` — Agent Registry View (full ACs)
- `docs/tickets/cp-t052.md` — Health extensions (full ACs)
- `docs/tickets/cp-t053.md` — ConflictLog timeline (full ACs)
- `docs/coordination/agent-assignments-phase3.md` — Wave 4 assignment briefs for specialists
- `docs/qa/cp-t048-clean-machine-test-plan.md` — CP-T048 test plan for AC-11
- `docs/coordination/cross-repo-audit-2026-03-21.md` — Full audit report (reference)

---

## New Ticket: CP-T056 (Issued This Session)

**CP-T056 — Temporal History: Point-in-Time `asOf` Query**
- Priority: P3, Wave 4+, frontend-only
- Ticket: `docs/tickets/cp-t056.md`
- Scope: Add `asOf` date/time picker to Temporal History view. When selected, calls `GET /kb/query/:entityType/:entityId/:key?asOf=<ISO>&includeExpired=true` and highlights the matching interval. No backend work — `asOf` parameter already supported.

## Additional Audit Agent Findings (2026-03-21)

Two parallel PM audit agents completed with expanded findings. Key additions beyond the main audit report:

**Confirmed — no action needed:**
- `staff_events` is a control-plane-local table (CP-T039), not in Iranti core Prisma schema. Iranti core never writes to it — the control plane populates it via event capture. This was always the design; not a new risk. CP-T050 is PM-ACCEPTED and the scope is correct.
- No breaking route changes in Iranti 0.2.10–0.2.12. Control plane API client code targeting 0.2.9 routes still works.

**Site benchmark discrepancy (site coordination, not control plane ticket):**
- The iranti.dev Hero shows `16/16 conflict benchmark` (internal 4-suite adversarial benchmark). The Proof page shows `4/5 (80%)` for B3 (external program). These are two different benchmarks. Not overclaiming, but confusing to readers. Site PM should add clarifying copy. No control plane ticket needed.

**Confirmed critical Iranti bugs (upstream flag required):**
- **B6**: `iranti_ingest` contamination — Librarian extracts values from existing KB entries, not input text. Production risk: operators who used ingest may have contaminated data. Needs upstream flag to Iranti maintainer.
- **B11**: `iranti_attend` classifier returns `classification_parse_failed_default_false`. Automatic injection non-functional. Covered in CP-T052 AC-4.
- **B4**: Vector scoring `vectorScore=0` for all KB entries. Vector indexing inactive. Covered in CP-T052 AC-2/AC-3.
- **B9**: `iranti_relate` writes work (5/5) but agents cannot read relationships via MCP (no MCP tool for `GET /kb/related`). The control plane reads them correctly via REST. Needs a UI note in the relationship graph.

**Additional P3+ opportunities (not yet ticketed):**
- `GET /memory/whoknows/:entityType/:entityId` not surfaced in Entity Detail — shows which agents contributed to each entity
- Force-write / operator override path for C2 conflict limitation (high-confidence first write blocks corrections)
- Entity alias management UI (`POST /kb/alias`, `GET /kb/entity/.../aliases`) — deferred since Phase 1 and still not done
- API key scope audit view — namespace-aware scopes (v0.2.1) not visible in Provider/Health view
- Site integration: iranti.dev has no mention of the control plane — needs cross-repo coordination ticket

**Complete Iranti API route map confirmed** — saved to Iranti memory at `project/iranti_control_plane/iranti_route_map_confirmed_2026_03_21`.

## Iranti Version Context

- **Current Iranti version:** 0.2.12
- **Control plane was specced against:** 0.2.9
- **Key additions since 0.2.9:** `conflictLog` field (v0.2.10), `createdBy` vs `source` distinction, `stability`/`lastAccessedAt` fields, `iranti doctor --debug` flag, Agent Registry API (`GET /agents`), decay config env vars, vector backend config.
- **Known broken in Iranti:** `iranti_attend` classifier (B11 — `classification_parse_failed_default_false`); entity auto-detection from raw text (B4 — requires `entityHints`); ingest contamination (B6 — Librarian extracts from existing KB, not input text).

---

## CP-T047 Status

CP-T047 (Documentation Round 5: Getting Started Guide Polish) — all 3 ACs complete, status updated to PM-ACCEPTED 2026-03-21 in ticket file. The getting-started.md now includes: Phase 2 complete section, Phase 3 in-progress section, `iranti doctor --debug` troubleshooting note, Archivist History row in What's Available Now table.
