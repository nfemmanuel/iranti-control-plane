# CHANGE_LOG_TAKEOVER.md — Hostile Audit & Rebuild Change Log

**Started:** 2026-03-23
**Format:** Newest first

---

## [IN PROGRESS] 2026-03-23 — Wave 20 + Hostile Audit Fixes

### Wave 20 (pre-existing uncommitted work, being audited and landed)

Files with uncommitted changes (1,078 insertions / 270 deletions):

| File | Change Summary | Status |
|---|---|---|
| `src/server/routes/control-plane/instance-identifiers.ts` | NEW: Shared utility for instance ID resolution using IRANTI_INSTANCE_ENV | LANDED (new file) |
| `src/server/routes/control-plane/instances.ts` | Instance discovery with IRANTI_INSTANCE_ENV, setup state, name derivation, proper path resolution | PENDING COMMIT |
| `src/server/routes/control-plane/lifecycle.ts` | Uses instance-identifiers.ts for path resolution | PENDING COMMIT |
| `src/server/routes/control-plane/sessions.ts` | Column name fix (agentId→createdBy), attendant state parser, 'active' state | PENDING COMMIT |
| `src/server/routes/control-plane/setup.ts` | Instance ID matching fix (dynamic via getConfiguredInstanceIdentifiers) | PENDING COMMIT |
| `src/server/routes/control-plane/overview.ts` | KB fallback to knowledge_base table when staff_events absent | PENDING COMMIT |
| `src/server/routes/control-plane/metrics.ts` | KB fallback to knowledge_base table | PENDING COMMIT |
| `src/server/routes/control-plane/agents.ts` | Normalization for new API response shape | PENDING COMMIT |
| `src/server/routes/control-plane/repair.ts` | Major repair workflow improvements | PENDING COMMIT |
| `src/client/src/components/stream/ActivityStream.tsx` | Removed CP-T025 internal chatter | PENDING COMMIT |
| `src/client/src/components/memory/ArchiveExplorer.tsx` | Removed CP-T025 refs; fixed conflict badge default case | PENDING COMMIT |
| `src/client/src/components/logs/StaffLogs.tsx` | Removed broken npm run migrate guidance | PENDING COMMIT |
| `src/client/src/components/shell/AppShell.tsx` | First-run redirect loop fix; Phase 2 → Soon | PENDING COMMIT |
| `src/client/src/components/overview/OverviewDashboard.tsx` | Health items not links; removed migrate copy; better KB copy | PENDING COMMIT |
| `src/client/src/components/onboarding/GettingStarted.tsx` | Dynamic instance ID via useInstanceContext | PENDING COMMIT |
| `src/client/src/components/metrics/MetricsDashboard.tsx` | Uses fallback KB data | PENDING COMMIT |
| `src/client/src/components/instances/InstanceManager.tsx` | Setup state labels; env authority fix | PENDING COMMIT |
| `src/client/src/components/sessions/SessionsView.tsx` | Better empty state copy | PENDING COMMIT |
| `src/client/src/components/providers/ProviderManager.tsx` | Routing editor improvements | PENDING COMMIT |
| `src/server/migrations/runner.ts` | Migration runner fixes | PENDING COMMIT |

### Hostile Audit Fixes (new, this session)

| Fix | File | Status |
|---|---|---|
| Remove `npm run migrate` from staff_events health hint | `health.ts` | PLANNED |
| Fix `setup.ts` KB query column names (snake_case → camelCase) | `setup.ts` | PLANNED |
| Improve runtime_version probe (check runtime.json) | `health.ts` | PLANNED |
| Add gitignore for tmp-cp-*.out/err files | `.gitignore` | PLANNED |
| Add operator workflow docs | `docs/guides/` | PLANNED |
| Add tests for critical paths | `src/server/tests/` | PLANNED |

---

## [COMMITTED] Previous Waves (reference)

| Commit | Description |
|---|---|
| 47f5894 | fix(health): correct iranti migrate, authority confusion, and overall status |
| a4f87d0 | fix(health): align health/diagnostics surfaces to live Iranti runtime truth |
| e5b4d6c | fix(diagnostics): align kb/write and attend probes to Iranti v0.2.21 API |
| 068d351 | feat(phase-7): Operator Configuration Management — v0.7.0 |
| 14fd91b | feat(dist): replace SEA binary with npm global package |
