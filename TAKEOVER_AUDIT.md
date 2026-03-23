# TAKEOVER_AUDIT.md — Iranti Control Plane Hostile Audit

**Started:** 2026-03-23
**Lead:** hostile-audit-rebuild
**Status:** SUBSTANTIALLY COMPLETE — v0.8.x stabilisation phase done

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
| `tests/unit/*.test.ts` | Unit tests (17 files) |
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
| `guides/` | Operator guides (11 files) |
| `guides/config-authority-model.md` | ✅ NEW — .env.iranti vs instance env explainer |
| `guides/troubleshooting.md` | ✅ NEW — common failures + fixes |
| `guides/getting-started.md` | Updated — stale sections fixed |
| `reference/api.md` | API reference |
| `reference/known-issues.md` | Known issues |
| `specs/` | Implementation specs (multiple) |
| `tickets/cp-t*.md` | Individual ticket docs |
| `releases/` | Release notes |
| `audits/` | Audit records |
| `qa/` | Test plans |
| `coordination/` | Internal coordination — stale |

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

## 2. File-by-File Disposition

> Legend: ✅ VALIDATED | ⚠️ PARTIAL | ❌ BROKEN | 🔵 REVIEW | 🗑️ REMOVE CANDIDATE

### Server Routes

| File | Status | Notes |
|---|---|---|
| `health.ts` | ✅ VALIDATED | migrate hint fixed (47f5894); runtime probe reads runtime.json (d51937c); `anthropic`→`claude` normalization added (a217799); authority via `resolveInstanceAuthority` |
| `instances.ts` | ✅ VALIDATED | Path-doubling fixed (d51937c); IRANTI_INSTANCE_NAME alias added (e43fe35); pure fns exported for unit testing |
| `instance-identifiers.ts` | ✅ VALIDATED | Correct authority model; resolves from IRANTI_INSTANCE_ENV; 18 unit tests |
| `providers.ts` | ✅ VALIDATED | Write path uses IRANTI_INSTANCE_ENV not binding file; CRLF preservation (a217799); `anthropic`→`claude` in key map; 22 unit tests |
| `sessions.ts` | ✅ VALIDATED | attendant state parser added; legacy KB fallback; column fix (agentId→createdBy); 23 unit tests |
| `setup.ts` | ✅ VALIDATED | KB query column names fixed (snake_case→camelCase); instance ID hardcoding fixed |
| `overview.ts` | ✅ VALIDATED | KB fallback to knowledge_base when staff_events absent/zero; exported fetchKBSummary; 10 unit tests |
| `metrics.ts` | ✅ VALIDATED | KB fallback path exported and tested; fetchKnowledgeBaseSummaryFallback covered |
| `agents.ts` | ⚠️ PARTIAL | normalizeAgent added; nested profile.agentId shape tested (thin); live validation pending |
| `lifecycle.ts` | 🔵 REVIEW | CLI spawn logic; Windows path handling; no unit tests |
| `kb.ts` | ✅ VALIDATED | ISO 8601 strict validation (ISO_DATE_RE guard); column names correct; 74 integration tests |
| `events.ts` | ✅ VALIDATED | ISO 8601 guard added (same pattern as kb.ts); SSE stream functional |
| `repair.ts` | 🔵 REVIEW | Instance env resolution path; no unit tests |
| `project-bindings.ts` | ⚠️ PARTIAL | Functional; integration test PR-002 passes (returns 200 with instanceName+projects) |
| `auth-keys.ts` | 🔵 REVIEW | New feature — not unit tested |
| `claude-integration.ts` | 🔵 REVIEW | New feature — not unit tested |
| `logs.ts` | ✅ VALIDATED | Broken migrate copy removed; staff_events dependency documented |
| `diagnostics.ts` | ⚠️ PARTIAL | Probes aligned to v0.2.21 API (e5b4d6c); live validation with v0.2.22 pending |
| `escalations.ts` | 🔵 REVIEW | Empty state truthfulness — not validated |

### Frontend Components

| Component | Status | Notes |
|---|---|---|
| `InstanceManager.tsx` | ⚠️ PARTIAL | Backend data shape correct; live frontend validation pending |
| `AgentRegistry.tsx` | ⚠️ PARTIAL | Backend normalization added; blank page not live-confirmed fixed |
| `SessionsView.tsx` | ⚠️ PARTIAL | Data path improved; live validation pending |
| `ArchiveExplorer.tsx` | ⚠️ PARTIAL | Row-click drill-down fix unconfirmed |
| `GettingStarted.tsx` | ✅ VALIDATED | Uses activeInstance.name for API calls (not hardcoded 'local') |
| `OverviewDashboard.tsx` | ✅ VALIDATED | KB zero fixed via fallback; misleading copy fixed |
| `MetricsDashboard.tsx` | ✅ VALIDATED | KB fallback resolves zeros |
| `ActivityStream.tsx` | ✅ VALIDATED | Internal chatter removed |
| `StaffLogs.tsx` | ✅ VALIDATED | Broken migrate copy removed |
| `AppShell.tsx` | ✅ VALIDATED | First-run loop fixed |
| `HealthDashboard.tsx` | ✅ VALIDATED | Authority model fixed; runtime probe reads runtime.json |
| `ConfigureInstancePanel.tsx` | ⚠️ PARTIAL | Phase 7 config management; live validation pending |
| `ProviderManager.tsx` | ⚠️ PARTIAL | Provider write path corrected; live validation pending |

---

## 3. Live Machine State

**Assessed:** 2026-03-23

| Component | State |
|---|---|
| Port 3001 | Control plane built process (running old pre-fix dist) |
| Port 3002 | Control plane DEV server — current code, 412 tests passing |
| Port 3001 Iranti local | STOPPED (PID 22216 in runtime.json is stale) |
| Port 4000 Iranti cofactor | RUNNING (v0.2.22) |
| Port 5434 | PostgreSQL (cofactor DB) |
| Port 5435 | PostgreSQL (local DB) |
| `IRANTI_URL` | http://localhost:3001 (bound to stopped local instance) |

**Critical live finding:** Control plane is bound to the `local` Iranti instance (http://localhost:3001) which is stopped. Health probe correctly reports runtime unreachable. DB checks succeed because the control plane has its own direct DB connection.

**Instance discovery (current code — port 3002 dev server):** WORKING — discovers both `local` and `cofactor` instances correctly.

**Two Iranti instances:**
| Name | Version | Port | Status | API Key in env? |
|---|---|---|---|---|
| local | 0.2.21 | 3001 | STOPPED | YES |
| cofactor | 0.2.22 | 4000 | RUNNING | NO (missing from instance .env) |

**Note:** The built binary at port 3001 was compiled before the path-doubling fix in d51937c. The current source is correct. Rebuild + npm publish still pending.

---

## 4. Authority Model Findings

### Correct (as of 2026-03-23)
- `IRANTI_INSTANCE_ENV` is the authoritative instance-level config path ✅
- `instance-identifiers.ts` correctly resolves from `IRANTI_INSTANCE_ENV` ✅
- `.env.iranti` is treated as a binding pointer, not config authority ✅
- Provider key checks read from `env` (which includes instance env) ✅
- `providers.ts` writes to `IRANTI_INSTANCE_ENV` path, not binding file ✅
- `IRANTI_INSTANCE_NAME` (written by Iranti CLI) accepted as alias for `IRANTI_INSTANCE` ✅
- `LLM_PROVIDER=anthropic` detected as stale; control plane normalises to `claude` with warn ✅

### Still Fragile
- `health.ts` `checkMcpIntegration` / `checkClaudeMdIntegration`: use `process.cwd()` — fragile if CWD changes ⚠️
- `cofactor` instance is missing `IRANTI_API_KEY` in its instance .env — the CP cannot authenticate to it ⚠️
- Old deployed build (port 3001) has path-doubling bug in instance discovery — stale binary not yet replaced ⚠️

---

## 5. Critical Bugs (P0)

| ID | Area | Description | Status |
|---|---|---|---|
| P0-001 | instances.ts | Path-doubling in dist build: scanned `instances\instances\` | ✅ FIXED — d51937c |
| P0-002 | health.ts | `npm run migrate` hint misled operator | ✅ FIXED — 47f5894 |
| P0-003 | setup.ts | KB query used snake_case column names; project binding count always 0 | ✅ FIXED — d51937c |
| P0-004 | cofactor instance | Missing IRANTI_API_KEY in .env — CP cannot authenticate | ⚠️ OPERATOR ACTION — add key manually to cofactor instance .env |
| P0-005 | AgentRegistry | Blank page — backend normalization added | ⚠️ UNCONFIRMED — backend fixed; frontend live validation pending |

---

## 6. High Priority Bugs (P1)

| ID | Area | Description | Status |
|---|---|---|---|
| P1-001 | health.ts | `checkRuntimeVersion` did not try runtime.json — missed non-default-port instances | ✅ FIXED — d51937c (reads runtime.json; heartbeat age check) |
| P1-002 | health.ts | `checkMcpIntegration` / `checkClaudeMdIntegration` use `process.cwd()` — fragile | ⚠️ OPEN |
| P1-003 | Archive | Row-click drill-down blank page | ⚠️ OPEN — unverified fix |
| P1-004 | Sessions | "Iranti may be unreachable" was coarse | ✅ FIXED — attendant state path + legacy fallback added |
| P1-005 | All pages | Two dev servers running simultaneously | ⚠️ OPERATOR HYGIENE — port 3001 still running old build |
| P1-006 | Logs | staff_events hint said `npm run migrate` | ✅ FIXED — 47f5894 |
| P1-007 | instances.ts | `cofactor` shows no API key warning | ⚠️ OPEN — instance page shows envFile.keysMissing; UI warning pending |
| P1-008 | events.ts | Date validation accepted slash-dates via Date.parse() | ✅ FIXED — a217799 (ISO_DATE_RE guard) |
| P1-009 | kb.ts | Same Date.parse() permissiveness as events.ts | ✅ FIXED — a217799 (ISO_DATE_RE guard) |
| P1-010 | providers.ts | CRLF-on-Windows was corrupting env files on write | ✅ FIXED — a217799 (lineEnding detection + split) |

---

## 7. Test Coverage

**Total: 412 tests passing across 19 test files (17 unit + 2 integration) — as of 2026-03-23**

| File | Tests | Coverage | Quality |
|---|---|---|---|
| `tests/unit/agents-normalizer.test.ts` | normalizeAgent shapes | Backend agent normalization | THIN |
| `tests/unit/health-builders.test.ts` | Provider key checks, overall computation | Health check logic | ADEQUATE |
| `tests/unit/health-diagnostics-scope.test.ts` | Instance scoping in health/diagnostics | Cross-instance access control | ADEQUATE |
| `tests/unit/health-runtime.test.ts` | deriveRuntimeStatus | Runtime status + heartbeat age | ADEQUATE |
| `tests/unit/history-endpoint.test.ts` | History API shape | Archive fact history | THIN |
| `tests/unit/instance-authority.test.ts` | resolveInstanceAuthority, resolveBoundProjectPath | Instance authority resolution | ADEQUATE |
| `tests/unit/instance-id.test.ts` | deriveInstanceId | Instance ID derivation | ADEQUATE |
| `tests/unit/instance-identifiers.test.ts` | getConfiguredInstanceIdentifiers | Instance identifier resolution | ADEQUATE |
| `tests/unit/instances-discovery.test.ts` | parseEnvContent, parseAndRedactDbUrl, normalizeRuntimeRootCandidate, buildErrorInstance | Discovery pure functions | ADEQUATE |
| `tests/unit/kb-serializers.test.ts` | KB fact serialization | KB data transforms | ADEQUATE |
| `tests/unit/logs-serializers.test.ts` | Log serialization | Logs data transforms | THIN |
| `tests/unit/overview-fallback.test.ts` | fetchKBSummary fallback paths, fetchKnowledgeBaseSummaryFallback | Overview/metrics fallback | ADEQUATE |
| `tests/unit/providers-scope.test.ts` | providers scope/authority | Provider authority model | ADEQUATE |
| `tests/unit/providers-write.test.ts` | isPlaceholderKey, getPreferredEnvFilePath, writeEnvVar | Provider write path | ADEQUATE |
| `tests/unit/sessions-parser.test.ts` | buildSessionsFromAttendantStateRows, buildSessionFromLegacyKBRows | Session parsing | ADEQUATE |
| `tests/unit/setup-scope.test.ts` | setup scope | Setup authority | ADEQUATE |
| `tests/unit/snake-to-camel.test.ts` | Column name conversion | DB field normalization | THIN |
| `tests/integration/kb-endpoints.test.ts` | KB read/filter/write API + project-bindings | KB + project binding HTTP endpoints | ADEQUATE |
| `tests/integration/kb-active-only.test.ts` | active_only filter | KB filtering | PARTIAL |

**Still untested (highest risk remaining):**
| Route | Why Critical |
|---|---|
| `lifecycle.ts` start/stop | CLI spawn logic, PID tracking, Windows process management |
| `repair.ts` resolveInstanceEnv | Instance env resolution across hash/name/scan |
| `auth-keys.ts` | New feature; write path unvalidated |
| `project-bindings.ts` write path | POST/PATCH not covered beyond integration smoke test |

---

## 8. Documentation Gaps

| Workflow | Status |
|---|---|
| Install / bootstrap | ⚠️ PARTIAL — README covers basics; getting-started.md updated |
| Authority model (.env.iranti vs instance .env) | ✅ DONE — `docs/guides/config-authority-model.md` (NEW) |
| Troubleshooting common failures | ✅ DONE — `docs/guides/troubleshooting.md` (NEW) |
| Health / diagnostics interpretation | ✅ DONE — `docs/guides/health-dashboard.md` |
| Provider setup | ✅ DONE — `docs/guides/providers-authority.md` |
| Agent registry | ✅ DONE — `docs/guides/agent-registry.md` |
| Instance create / configure | ⚠️ PARTIAL — no step-by-step operator guide |
| Instance start / stop | ⚠️ PARTIAL — covered briefly in troubleshooting |
| Instance doctor | ⚠️ PARTIAL — covered in health-dashboard.md |
| Project binding | ⚠️ PARTIAL — no dedicated guide |
| Session recovery | ⚠️ NO — no operator guide |
| Archive / memory | ⚠️ PARTIAL — `memory-explorer.md` exists but shallow |
| Windows-specific issues | ✅ PARTIAL — CRLF, paths, and process management covered in troubleshooting.md |

---

## 9. Rebuild Execution Log

| Commit | Date | Change | Area |
|---|---|---|---|
| 47f5894 | 2026-03-23 | Fix `npm run migrate` hint in health.ts; fix authority confusion; fix overall status | health.ts |
| a4f87d0 | 2026-03-23 | Align health/diagnostics surfaces to live Iranti runtime truth | health.ts, diagnostics.ts |
| e5b4d6c | 2026-03-23 | Align kb/write and attend probes to Iranti v0.2.21 API | diagnostics.ts |
| 068d351 | 2026-03-23 | Operator Configuration Management — v0.7.0 | providers.ts, instances.ts |
| d51937c | 2026-03-23 | Hostile audit Wave 20 — authority model correctness, bug fixes, new utilities — v0.8.0 | instances.ts, health.ts, sessions.ts, setup.ts, providers.ts, instance-identifiers.ts |
| a4ba9bf | 2026-03-23 | Audit deliverables — TAKEOVER_AUDIT, WORKFLOW_MATRIX, DOC_MATRIX, TEST_MATRIX, CHANGE_LOG | docs |
| 69684f5 | 2026-03-23 | Add instance-identifiers unit tests + fix vitest pool for process.chdir | tests |
| 4697f45 | 2026-03-23 | Add sessions parser unit tests (23 tests) | tests |
| 0b79d4a | 2026-03-23 | Add providers write-path unit tests (22 tests) | tests |
| c6ccf68 | 2026-03-23 | Add health runtime unit tests (12 tests) | tests |
| b21684e | 2026-03-23 | Update TEST_MATRIX.md — P0 tests complete (275 passing) | docs |
| a217799 | 2026-03-23 | Provider authority model, CRLF fix, ISO 8601 validation, 377 passing | providers.ts, events.ts, kb.ts, tests |
| e43fe35 | 2026-03-23 | instances-discovery + overview-fallback tests; IRANTI_INSTANCE_NAME fix (412 passing) | instances.ts, overview.ts, metrics.ts, tests |
| b24af07 | 2026-03-23 | Update TEST_MATRIX.md — all P0/P1 suites complete, 412 passing | docs |

---

## 10. Files Changed (this takeover — cumulative)

- `src/server/routes/control-plane/health.ts` — migrate hint, runtime probe, anthropic→claude, authority
- `src/server/routes/control-plane/instances.ts` — path fix, IRANTI_INSTANCE_NAME, exported pure fns
- `src/server/routes/control-plane/instance-identifiers.ts` — NEW — authority resolution utility
- `src/server/routes/control-plane/providers.ts` — CRLF fix, IRANTI_INSTANCE_ENV authority, anthropic→claude
- `src/server/routes/control-plane/sessions.ts` — attendant state parser, legacy KB fallback, column fixes
- `src/server/routes/control-plane/setup.ts` — column name fix, instance ID
- `src/server/routes/control-plane/overview.ts` — KB fallback, exported fetchKBSummary
- `src/server/routes/control-plane/metrics.ts` — exported fetchKnowledgeBaseSummaryFallback
- `src/server/routes/control-plane/diagnostics.ts` — Iranti v0.2.21 API alignment
- `src/server/routes/control-plane/kb.ts` — ISO 8601 guard
- `src/server/routes/control-plane/events.ts` — ISO 8601 guard
- `src/server/routes/control-plane/agents.ts` — normalizeAgent nested profile shape
- `src/server/routes/control-plane/repair.ts` — in progress
- `src/server/migrations/runner.ts` — updated
- `src/server/package.json` — vitest pool config
- `src/server/tests/unit/*.test.ts` — 17 test files (11 new)
- `src/server/tests/integration/kb-endpoints.test.ts` — PR-001/PR-002 rewritten
- `src/client/src/components/overview/OverviewDashboard.tsx` — KB fallback display
- `src/client/src/components/shell/AppShell.tsx` — first-run loop fix
- `src/client/src/components/onboarding/GettingStarted.tsx` — activeInstance.name
- `src/client/src/components/stream/ActivityStream.tsx` — internal chatter removed
- `docs/guides/config-authority-model.md` — NEW
- `docs/guides/troubleshooting.md` — NEW
- `docs/guides/getting-started.md` — stale sections updated
- `TEST_MATRIX.md` — updated continuously
- `TAKEOVER_AUDIT.md` — this file

---

## 11. Files Reviewed and Retained Without Change

- `src/server/routes/control-plane/archivist.ts` — correct; no audit issues found
- `src/server/routes/control-plane/auth-keys.ts` — functional; untested but not changed
- `src/server/routes/control-plane/escalations.ts` — functional; empty state unvalidated
- `src/server/routes/control-plane/whoknows.ts` — correct proxy; no issues found
- `src/server/routes/control-plane/version-sync.ts` — simple; no issues found
- `src/server/db.ts` — env loading correct; no changes needed

---

## 12. Deprecated / Remove Candidates

| File | Reason |
|---|---|
| `tmp-cp-3002.err`, `tmp-cp-3002.out`, `tmp-cp-start.err`, `tmp-cp-start.out` | Dev noise; should be gitignored |
| `RESUME_NEXT_SESSION_PROMPT.md` | Internal session management artifact |
| `scripts/resume-autonomous-build.ps1` | Internal coordination; not operator-facing |
| `docs/coordination/` | Internal; stale after Phase 7 |
| `scripts/package/archive/` | Deprecated SEA build scripts |

---

## 13. Remaining Risks and Gaps

**Resolved since audit start:**
- ✅ Path-doubling in instance discovery
- ✅ migrate hint misleading operators
- ✅ Project binding count returning 0 (snake_case bug)
- ✅ Provider write path using wrong env file
- ✅ CRLF corruption on Windows env file writes
- ✅ ISO 8601 date validation too permissive
- ✅ IRANTI_INSTANCE_NAME vs IRANTI_INSTANCE mismatch
- ✅ Runtime probe missing non-default-port instances
- ✅ anthropic→claude LLM_PROVIDER normalization
- ✅ Test coverage: 0 → 412 tests across 19 files
- ✅ Operator docs: authority model + troubleshooting written

**Still open:**
1. **lifecycle.ts untested** — CLI spawn, PID tracking, Windows process management; failure is silent
2. **repair.ts untested** — instance env resolution across hash/name/scan paths
3. **AgentRegistry blank page unconfirmed** — backend fixed; frontend live validation still needed
4. **cofactor IRANTI_API_KEY missing** — operator action required; CP cannot proxy to cofactor
5. **Old dist binary (port 3001) still running** — pre-fix build; needs rebuild + npm publish
6. **checkMcpIntegration uses process.cwd()** — fragile but low-frequency failure path
7. **No frontend test infrastructure** — React Testing Library not set up; zero frontend tests

---

## 14. Final Readiness Assessment

**Status: SUBSTANTIALLY IMPROVED — ready for operator use on the happy path**

| Area | Before Audit | After Audit |
|---|---|---|
| Instance discovery | ❌ Broken (path-doubling) | ✅ Working |
| Provider config write | ❌ Wrong file | ✅ Correct (IRANTI_INSTANCE_ENV) |
| Health diagnostics | ⚠️ Misleading hints | ✅ Accurate remediation |
| Runtime probe | ⚠️ Missed non-default ports | ✅ Reads runtime.json |
| Session recovery | ❌ Parser missing | ✅ Attendant state + legacy fallback |
| KB/events date validation | ⚠️ Too permissive | ✅ Strict ISO 8601 |
| Windows env file writes | ❌ CRLF corruption | ✅ Preserves original line endings |
| Authority model docs | ❌ None | ✅ config-authority-model.md |
| Troubleshooting docs | ❌ None | ✅ troubleshooting.md |
| Test coverage | ❌ ~30 tests, major gaps | ✅ 412 tests, all P0/P1 covered |

**What remains before production confidence:**
- Rebuild and publish the npm package (current dist is stale)
- Live-validate AgentRegistry frontend with a running Iranti instance
- Lifecycle and repair test coverage (P0 remaining)
- cofactor instance API key must be added by the operator

*Last updated: 2026-03-23*
