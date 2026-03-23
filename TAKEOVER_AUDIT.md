# TAKEOVER_AUDIT.md — Iranti Control Plane Hostile Audit

**Started:** 2026-03-23
**Lead:** hostile-audit-rebuild
**Status:** IN PROGRESS — updating continuously

---

## 1. Repo Inventory

### Root
| Path | Role |
|---|---|
| `CLAUDE.md` | Project instructions |
| `README.md` | Install/usage docs |
| `package.json` | Root package (npm global entry point) |
| `docker-compose.yml` | Dev DB setup |
| `.env.iranti` | Project binding pointer (NOT runtime config authority) |
| `.mcp.json` | MCP server config |
| `.gitignore`, `.gitattributes`, `.npmignore` | VCS/publish hygiene |
| `REVIEW_NOTES_2026-03-22.md` | Operator audit findings — internal |
| `RESUME_NEXT_SESSION_PROMPT.md` | Session context — internal |
| `tmp-cp-*.out/err` | Dev server log files — SHOULD BE GITIGNORED |

### `src/server/` — Express backend
| File | Role |
|---|---|
| `index.ts` | Entry point, port discovery, migration auto-run, static serve |
| `db.ts` | DB connection, env loading |
| `types.ts` | Shared types (ApiError, HealthCheck, etc.) |
| `lib/staff-event-adapter.ts` | CP-local staff event polling |
| `migrations/runner.ts` | Control-plane-local migration runner |
| `migrations/001_*.sql` | staff_events table |
| `migrations/002_*.sql` | archive_flags table |
| `migrations/003_*.sql` | Metrics index |
| `routes/control-plane/index.ts` | Router composition |
| `routes/control-plane/agents.ts` | GET /agents — Iranti agent registry proxy |
| `routes/control-plane/archivist.ts` | GET /archive — archived KB facts |
| `routes/control-plane/attendant-debug.ts` | POST /debug/handshake,attend |
| `routes/control-plane/auth-keys.ts` | GET/POST/DELETE /auth-keys |
| `routes/control-plane/chat.ts` | POST /chat — proxy to Iranti LLM |
| `routes/control-plane/claude-integration.ts` | Claude Code .mcp.json management |
| `routes/control-plane/codex-integration.ts` | Codex integration |
| `routes/control-plane/diagnostics.ts` | POST /diagnostics/run |
| `routes/control-plane/escalations.ts` | GET /escalations — conflict review |
| `routes/control-plane/events.ts` | SSE staff events stream |
| `routes/control-plane/health.ts` | GET /health — all health checks |
| `routes/control-plane/install-state.ts` | GET /install-state |
| `routes/control-plane/instance-identifiers.ts` | Shared instance ID resolution utility |
| `routes/control-plane/instance-lifecycle.ts` | POST /instances, PATCH /instances/:name |
| `routes/control-plane/instances.ts` | GET /instances — discovery + metadata |
| `routes/control-plane/kb.ts` | GET/POST /kb — knowledge base |
| `routes/control-plane/lifecycle.ts` | POST /instances/:name/start|stop |
| `routes/control-plane/logs.ts` | GET /logs — staff_events query |
| `routes/control-plane/metrics.ts` | GET /metrics/summary|kb-growth|agent-activity |
| `routes/control-plane/open-file.ts` | POST /open-file — shell open |
| `routes/control-plane/overview.ts` | GET /overview — dashboard summary |
| `routes/control-plane/project-bindings.ts` | GET/POST/PATCH /instances/:id/projects |
| `routes/control-plane/providers.ts` | GET/POST /providers — provider config |
| `routes/control-plane/repair.ts` | POST /instances/:id/repair/:action |
| `routes/control-plane/sessions.ts` | GET /sessions — session recovery |
| `routes/control-plane/setup.ts` | GET/POST /instances/:id/setup-status |
| `routes/control-plane/upgrade.ts` | POST /instances/:name/upgrade |
| `routes/control-plane/version-sync.ts` | GET /version-sync |
| `routes/control-plane/whoknows.ts` | GET /kb/whoknows/:entity/:id |
| `tests/unit/*.test.ts` | Unit tests (7 files) |
| `tests/integration/*.test.ts` | Integration tests (2 files) |

### `src/client/src/` — React frontend
| Path | Role |
|---|---|
| `main.tsx` | React router, route config |
| `api/client.ts` | Fetch wrapper |
| `api/types.ts` | API type definitions |
| `api/instances.ts` | Instance API helpers |
| `hooks/useInstanceContext.tsx` | Active instance context provider |
| `hooks/useToasts.ts` | Toast notifications |
| `hooks/useViewNavigationShortcuts.ts` | Keyboard shortcuts |
| `lib/path.ts` | Path utilities |
| `styles/global.css` | Global styles |
| `styles/tokens.css` | Design tokens |
| `components/agents/AgentRegistry.*` | Agent list page |
| `components/chat/ChatPanel.*` | Chat panel |
| `components/conflicts/ConflictReview.*` | Conflict review page |
| `components/health/HealthDashboard.*` | Health/diagnostics page |
| `components/health/ProviderStatus.*` | Provider status widget |
| `components/health/remediationText.ts` | Remediation copy |
| `components/health/AttendantDebugPanel.*` | Attendant debug |
| `components/instances/InstanceManager.*` | Instance management |
| `components/instances/ConfigureInstancePanel.*` | Instance configure |
| `components/instances/CreateInstanceForm.*` | Instance create |
| `components/instances/ApiKeyManager.*` | API key management |
| `components/instances/BindProjectForm.*` | Project binding form |
| `components/instances/ClaudeIntegrationPanel.*` | Claude Code integration |
| `components/instances/CodexIntegrationPanel.*` | Codex integration |
| `components/instances/DoctorDrawer.*` | Doctor/diagnostics drawer |
| `components/instances/UpgradeSection.*` | Upgrade workflow |
| `components/logs/StaffLogs.*` | Staff activity logs |
| `components/memory/ArchiveExplorer.*` | Archive browser |
| `components/memory/MemoryExplorer.*` | KB explorer |
| `components/memory/EntityDetail.*` | Entity fact detail |
| `components/memory/RelationshipGraphView.*` | Relationship graph |
| `components/memory/TemporalHistory.*` | Fact history |
| `components/metrics/MetricsDashboard.*` | Metrics page |
| `components/onboarding/GettingStarted.*` | Setup/onboarding wizard |
| `components/overview/OverviewDashboard.*` | Home/overview page |
| `components/providers/ProviderManager.*` | Provider config |
| `components/providers/RoutingEditor.*` | Task routing config |
| `components/sessions/SessionsView.*` | Session recovery |
| `components/setup/SetupWizard.*` | Setup wizard |
| `components/shell/AppShell.*` | Shell + nav |
| `components/shell/CommandPalette.*` | Command palette |
| `components/stream/ActivityStream.*` | Live staff event stream |
| `components/ui/*` | Shared UI primitives |

### `docs/` — Documentation
| Path | Role |
|---|---|
| `prd/control-plane.md` | Product requirements |
| `roadmap.md` | Phase roadmap |
| `backlog.md` | Ticket backlog |
| `guides/` | Operator guides (6 files) |
| `reference/api.md` | API reference |
| `reference/known-issues.md` | Known issues |
| `specs/` | Implementation specs (multiple) |
| `tickets/cp-t*.md` | Individual ticket docs |
| `releases/` | Release notes |
| `audits/` | Audit records |
| `qa/` | Test plans |
| `coordination/` | Internal coordination — stale |
| `upstream-pr/cp-t025/` | CP-T025 upstream PR artifacts — internal |

### `scripts/`
| File | Role |
|---|---|
| `dev-setup.sh` / `dev-setup.ps1` | Dev environment setup |
| `package/bundle.mjs` | esbuild bundle script |
| `package/archive/` | Platform-specific SEA build scripts (deprecated) |
| `scripts/setup-wizard.js` | Pre-install setup script |
| `scripts/resume-autonomous-build.ps1` | Internal coordination — remove candidate |
| `scripts/ci-monitor.sh` | CI monitoring |

---

## 2. File-by-File Disposition (WIP — completing with subagent input)

> Legend: ✅ VALIDATED | ⚠️ PARTIAL | ❌ BROKEN | 🔵 REVIEW | 🗑️ REMOVE CANDIDATE

### Server Routes

| File | Status | Critical Issues |
|---|---|---|
| `health.ts` | ⚠️ PARTIAL | `npm run migrate` hint at line 496; runtime probe misleading when Iranti stopped |
| `instances.ts` | ⚠️ PARTIAL | Discovery working on dev (port 3002); built version has path-doubling bug |
| `instance-identifiers.ts` | ✅ VALIDATED | Correct authority model; properly resolves from IRANTI_INSTANCE_ENV |
| `lifecycle.ts` | 🔵 REVIEW | CLI spawn logic; Windows path handling needs audit |
| `sessions.ts` | ⚠️ PARTIAL | Column name fixes in progress (agentId→createdBy); attendant state parser added |
| `setup.ts` | ⚠️ PARTIAL | Instance ID hardcoding fixed; `entity_id`→`entityId` column name bug found |
| `overview.ts` | ⚠️ PARTIAL | KB fallback added; agent shape normalization in progress |
| `metrics.ts` | ⚠️ PARTIAL | KB fallback added |
| `agents.ts` | ⚠️ PARTIAL | Normalization added |
| `providers.ts` | 🔵 REVIEW | Read path unknown; write path unknown |
| `repair.ts` | 🔵 REVIEW | Major changes in progress |
| `project-bindings.ts` | 🔵 REVIEW | New feature — untested |
| `auth-keys.ts` | 🔵 REVIEW | New feature — untested |
| `claude-integration.ts` | 🔵 REVIEW | New feature — untested |
| `logs.ts` | ⚠️ PARTIAL | Remediation copy fixed; underlying staff_events dependency unchanged |
| `kb.ts` | 🔵 REVIEW | Column names need audit |
| `diagnostics.ts` | 🔵 REVIEW | Probe accuracy vs live Iranti |
| `escalations.ts` | 🔵 REVIEW | Empty state truthfulness |
| `events.ts` | 🔵 REVIEW | SSE stream health |

### Frontend Components

| Component | Status | Critical Issues |
|---|---|---|
| `InstanceManager.tsx` | ⚠️ PARTIAL | Was blank; backend data shape improved; need live validation |
| `AgentRegistry.tsx` | ❌ BROKEN | Was blank; normalization added to backend but frontend not yet confirmed |
| `SessionsView.tsx` | ⚠️ PARTIAL | Coarse error fixed; data path improved |
| `ArchiveExplorer.tsx` | ⚠️ PARTIAL | Row-click blank still unconfirmed; CP-T025 refs removed |
| `GettingStarted.tsx` | ⚠️ PARTIAL | Instance not found fixed via useInstanceContext |
| `OverviewDashboard.tsx` | ⚠️ PARTIAL | KB zero fixed via fallback; misleading copy fixed |
| `MetricsDashboard.tsx` | ⚠️ PARTIAL | KB fallback added; zeros should be resolved |
| `ActivityStream.tsx` | ⚠️ PARTIAL | Internal chatter removed |
| `StaffLogs.tsx` | ⚠️ PARTIAL | Broken migrate copy removed |
| `AppShell.tsx` | ⚠️ PARTIAL | First-run loop fixed; Phase 2 → Soon |
| `HealthDashboard.tsx` | ✅ VALIDATED | Authority model fixed; runtime version probe remains misleading when stopped |

---

## 3. Live Machine State

**Assessed:** 2026-03-23

| Component | State |
|---|---|
| Port 3001 | Control plane DIST/built process (PID 48788) |
| Port 3002 | Control plane DEV server (uncommitted code) |
| Port 3001 Iranti local | STOPPED (PID 22216 in runtime.json is stale) |
| Port 4000 Iranti cofactor | RUNNING (PID 376, v0.2.22) |
| Port 5434 | PostgreSQL (cofactor DB) |
| Port 5435 | PostgreSQL (local DB) |
| `IRANTI_URL` | http://localhost:3001 (bound to stopped local instance) |

**Critical live finding:** Control plane is bound to the `local` Iranti instance (http://localhost:3001) which is stopped. Health probe correctly reports runtime unreachable. DB checks succeed because the control plane has its own direct DB connection.

**Instance discovery:**
- Port 3001 (dist): BROKEN — scans `instances\instances\` (path doubling — built from stale pre-fix code)
- Port 3002 (dev): WORKING — discovers both `local` and `cofactor` instances

**Two Iranti instances found:**
| Name | Version | Port | Status | API Key in env? |
|---|---|---|---|---|
| local | 0.2.21 | 3001 | STOPPED | YES |
| cofactor | 0.2.22 | 4000 | RUNNING | NO (missing from .env) |

---

## 4. Authority Model Findings

### Correct
- `IRANTI_INSTANCE_ENV` is the authoritative instance-level config path ✅
- `instance-identifiers.ts` correctly resolves from `IRANTI_INSTANCE_ENV` ✅
- `.env.iranti` is treated as a binding pointer, not config authority ✅
- Provider key checks read from `env` (which includes instance env) ✅

### Broken / Problematic
- `health.ts` line 496: Still says `npm run migrate` in staff_events hint ❌
- `health.ts` `checkMcpIntegration` / `checkClaudeMdIntegration`: use `process.cwd()` — fragile if CWD changes ⚠️
- `setup.ts` KB query: used snake_case column names (`entity_id`, `entity_type`) — should be camelCase (`entityId`, `entityType`) ⚠️
- Old deployed build (port 3001) has path-doubling bug in instance discovery ❌
- `cofactor` instance is missing `IRANTI_API_KEY` in its .env — the control plane cannot authenticate to it ⚠️

---

## 5. Critical Bugs (P0)

| ID | Area | Description | Impact |
|---|---|---|---|
| P0-001 | instances.ts | Path-doubling in dist build: scans `instances\instances\` | All instance discovery broken in production |
| P0-002 | health.ts | `npm run migrate` hint still present (operator told to run broken command) | Misleading remediation |
| P0-003 | setup.ts | KB query uses snake_case (`entity_id`) but Prisma schema is camelCase | Project binding count always returns 0 |
| P0-004 | cofactor instance | Missing IRANTI_API_KEY in .env — control plane cannot authenticate | cofactor instance unusable from CP |
| P0-005 | AgentRegistry | Blank page — unknown if fixed by normalization changes | Core surface broken |

---

## 6. High Priority Bugs (P1)

| ID | Area | Description |
|---|---|---|
| P1-001 | health.ts | `checkRuntimeVersion` does not try reading `runtime.json` — misses running instances on non-default ports |
| P1-002 | health.ts | `checkMcpIntegration` / `checkClaudeMdIntegration` use `process.cwd()` — fragile |
| P1-003 | Archive | Row-click drill-down blank page — unverified |
| P1-004 | Sessions | "Iranti may be unreachable" is coarse and misleading |
| P1-005 | All pages | Two dev servers running simultaneously — risk of inconsistent behavior |
| P1-006 | Logs | `staff_events_table` health hint still says `npm run migrate` (health.ts line 496) |
| P1-007 | instances.ts | `cofactor` instance shows `setupState: running` but has no IRANTI_API_KEY — should show warning |

---

## 7. Test Coverage Gaps (preliminary)

| Route | Unit Tests | Integration Tests |
|---|---|---|
| instances.ts | agents-normalizer.test.ts (partial) | None |
| lifecycle.ts | None | None |
| sessions.ts | None | None |
| health.ts | health-builders.test.ts (partial) | None |
| setup.ts | None | None |
| providers.ts | None | None |
| repair.ts | None | None |
| auth-keys.ts | None | None |
| project-bindings.ts | None | None |
| overview.ts | None | None |
| metrics.ts | None | None |
| lifecycle (start/stop) | None | None |

---

## 8. Documentation Gaps (preliminary)

| Workflow | Operator Doc? | Troubleshooting? |
|---|---|---|
| Install / bootstrap | Partial (README) | No |
| Instance create | No | No |
| Instance configure | No | No |
| Instance start / stop | No | No |
| Instance doctor | No | No |
| Provider setup | No | No |
| Provider task routing | No | No |
| Project binding | No | No |
| Authority model (.env.iranti vs instance .env) | No | No |
| Session recovery | No | No |
| Health / diagnostics interpretation | Partial | No |
| Archive / memory | Partial | No |
| Windows-specific issues | No | No |

---

## 9. Rebuild Execution Log

| Date | Change | Area | Status |
|---|---|---|---|
| 2026-03-23 | Fix `npm run migrate` hint in health.ts staff_events check | health.ts | PLANNED |
| 2026-03-23 | Fix `setup.ts` KB query column names | setup.ts | PLANNED |
| 2026-03-23 | Improve runtime_version probe to check runtime.json | health.ts | PLANNED |
| 2026-03-23 | Commit Wave 20 baseline | all modified files | PLANNED |
| 2026-03-23 | Validate ArchiveExplorer row-click | frontend | PLANNED |
| 2026-03-23 | Validate AgentRegistry | frontend | PLANNED |
| 2026-03-23 | Add test coverage for critical paths | tests | PLANNED |
| 2026-03-23 | Write operator docs for key workflows | docs | PLANNED |

---

## 10. Files Changed (this takeover)

*Will be updated as changes land.*

---

## 11. Files Reviewed But Retained

*Will be updated as audit completes.*

---

## 12. Deprecated / Remove Candidates

| File | Reason |
|---|---|
| `tmp-cp-3002.err`, `tmp-cp-3002.out`, `tmp-cp-start.err`, `tmp-cp-start.out` | Dev noise; should be gitignored |
| `RESUME_NEXT_SESSION_PROMPT.md` | Internal session management artifact |
| `scripts/resume-autonomous-build.ps1` | Internal coordination; not operator-facing |
| `docs/upstream-pr/cp-t025/` | Implementation artifacts; not operator docs |
| `docs/coordination/` | Internal; stale after Phase 7 |
| `scripts/package/archive/` | Deprecated SEA build scripts |

---

## 13. Remaining Risks and Gaps

1. **No automated tests for lifecycle, sessions, providers, repair** — these are the highest-risk routes
2. **The dist build (port 3001) is broken** — instances discovery fails; operators relying on the packaged version are broken
3. **cofactor missing IRANTI_API_KEY** — any UI action that proxies to cofactor will fail auth
4. **Archive drill-down blank page** — unverified fix
5. **AgentRegistry blank page** — unverified fix
6. **No docs for operator workflows** — an operator cannot figure out how to use this product from docs alone

---

## 14. Final Readiness Assessment

**Status: NOT READY FOR PRODUCTION**

Current state:
- Observability pages (Memory, Health, Conflicts): ✅ Mostly correct
- Configuration pages (Providers, Instances): ⚠️ Functionally present but not live-validated
- Activity/Logs/Stream: ⚠️ Partially functional; depends on optional staff_events
- Core routes (Agents, Sessions): ⚠️ Recently fixed but not built/validated
- Tests: ❌ Insufficient for confidence
- Docs: ❌ Operator documentation largely absent
- Build: ❌ Uncommitted changes not yet deployed

*This document updates continuously. Last update: 2026-03-23.*
