# TEST_MATRIX.md — Test Coverage Matrix

**Updated:** 2026-03-23 (revised post-Wave 20 + hostile audit test pass)

---

## Existing Tests

| File | Tests | What It Covers | Quality |
|---|---|---|---|
| `tests/unit/agents-normalizer.test.ts` | normalizeAgent shapes | Backend agent normalization | THIN |
| `tests/unit/health-builders.test.ts` | Provider key checks, overall computation | Health check logic | ADEQUATE |
| `tests/unit/health-diagnostics-scope.test.ts` | Instance scoping in health/diagnostics | Cross-instance access control | ADEQUATE |
| `tests/unit/health-runtime.test.ts` | ✅ NEW — deriveRuntimeStatus | Runtime status derivation + heartbeat age | ADEQUATE |
| `tests/unit/history-endpoint.test.ts` | History API shape | Archive fact history | THIN |
| `tests/unit/instance-authority.test.ts` | resolveInstanceAuthority, resolveBoundProjectPath | Instance authority resolution | ADEQUATE |
| `tests/unit/instance-id.test.ts` | deriveInstanceId | Instance ID derivation | ADEQUATE |
| `tests/unit/instance-identifiers.test.ts` | ✅ NEW — getConfiguredInstanceIdentifiers | Instance identifier resolution from IRANTI_INSTANCE_ENV | ADEQUATE |
| `tests/unit/kb-serializers.test.ts` | KB fact serialization | KB data transforms | ADEQUATE |
| `tests/unit/logs-serializers.test.ts` | Log serialization | Logs data transforms | THIN |
| `tests/unit/providers-write.test.ts` | ✅ NEW — isPlaceholderKey, getPreferredEnvFilePath, writeEnvVar | Provider write path + authority model | ADEQUATE |
| `tests/unit/sessions-parser.test.ts` | ✅ NEW — buildSessionsFromAttendantStateRows, buildSessionFromLegacyKBRows | Session data parsing | ADEQUATE |
| `tests/unit/snake-to-camel.test.ts` | Column name conversion | DB field normalization | THIN |
| `tests/integration/kb-endpoints.test.ts` | KB read/filter API | KB HTTP endpoints | PARTIAL |
| `tests/integration/kb-active-only.test.ts` | active_only filter | KB filtering | PARTIAL |

**Total unit tests as of 2026-03-23: 275 passing across 13 test files.**

---

## Critical Coverage Gaps

### P0 — No tests, highest risk

| Route / Area | What to Test | Why Critical | Status |
|---|---|---|---|
| `instance-identifiers.ts` | `getConfiguredInstanceIdentifiers()` on Windows paths with backslash | Authority model correctness; Windows path normalization | ✅ DONE — `instance-identifiers.test.ts` (18 tests) |
| `sessions.ts` buildSessionsFromAttendantStateRows | Parsing attendant state rows with nested sessionCheckpoint | New parser; session recovery depends on it | ✅ DONE — `sessions-parser.test.ts` (23 tests) |
| `providers.ts` writeEnvVar | Key write to IRANTI_INSTANCE_ENV path, not binding file | Authority model; wrong file = wrong instance | ✅ DONE — `providers-write.test.ts` (22 tests) |
| `health.ts` deriveRuntimeStatus | Heartbeat age check, stopped/stale/running/unknown states | Runtime health probe depends on correct state | ✅ DONE — `health-runtime.test.ts` (12 tests) |
| `lifecycle.ts` start/stop | CLI spawn logic, PID tracking, Windows process management | Lifecycle is untested; failure is silent | ⚠️ OPEN |
| `instances.ts` discovery | `discoverInstances()` with registry vs scan, runtime.json reading | Core page depends on this | ⚠️ OPEN |
| `repair.ts` resolveInstanceEnv | Instance ID resolution across hash, name, scan | Repair won't work if instance can't be resolved | ⚠️ OPEN |

### P1 — Thin coverage, medium risk

| Route / Area | What to Test |
|---|---|
| `overview.ts` fetchKBSummary | Fallback path when staff_events table absent |
| `metrics.ts` fetchKnowledgeBaseSummaryFallback | Returns real counts from knowledge_base |
| `agents.ts` normalizeAgent | Handles nested profile.agentId shape, empty stats |
| `setup.ts` checkProjectBinding | Returns correct count from knowledge_base |
| `health.ts` computeOverall | Degraded if runtime_version warn but OK otherwise; error if db error |

### P2 — Missing platform tests

| Area | What to Test |
|---|---|
| `db.ts` loadEnv | IRANTI_INSTANCE_ENV with Windows backslash paths |
| `instances.ts` parseEnvFile | CRLF line endings (Windows) |
| `lifecycle.ts` spawn | `where iranti` on Windows vs `which iranti` on macOS |
| `instance-identifiers.ts` | Path derivation with Windows backslashes |

---

## Tests to Write (Priority Order)

> **Note:** Items 1-4 below have been written and are passing as of 2026-03-23.
> Items 5-6 remain open.

### ✅ 1. `instance-identifiers.test.ts` (P0) — DONE
```
- getConfiguredInstanceIdentifiers() with IRANTI_INSTANCE_ENV set
- getConfiguredInstanceIdentifiers() without IRANTI_INSTANCE_ENV (falls back to process.cwd)
- matches() returns true for both hash ID and instance name
- matches() returns false for unknown string
- Windows backslash path normalization
- instanceName derived from IRANTI_INSTANCE_ENV basename
```

### ✅ 2. `sessions-parser.test.ts` (P0) — DONE
```
- buildSessionsFromAttendantStateRows() with valid sessionCheckpoint
- handles missing sessionCheckpoint gracefully (returns empty array)
- state mapping: 'active' → 'checkpointed', 'completed' → 'complete'
- buildSessionFromLegacyKBRows() with createdBy column (not agentId)
- handles null/undefined valueRaw gracefully
```

### ✅ 3. `providers-write.test.ts` (P0) — DONE
```
- getPreferredEnvFilePath() returns IRANTI_INSTANCE_ENV when set
- getPreferredEnvFilePath() falls back to .env.iranti when IRANTI_INSTANCE_ENV absent
- writeEnvVar() writes to instance env, not project binding
- writeEnvVar() does NOT write if value is a placeholder
- writeEnvVar() deletes key when value is null
- isPlaceholderKey() correctly identifies sk-xxx, replace-me, etc.
```

### ✅ 4. `health-runtime.test.ts` (P0) — DONE (deriveRuntimeStatus)
```
- readRuntimeJson() returns version+port when heartbeat < 60s old
- readRuntimeJson() returns null when heartbeat > 60s old
- readRuntimeJson() returns null when file does not exist
- readRuntimeJson() returns null when version/port missing
- checkRuntimeVersion() falls back to readRuntimeJson() when HTTP probe fails
- checkRuntimeVersion() returns 'ok' when HTTP probe succeeds with version
```

### 5. `instances-discovery.test.ts` (P1)
```
- discoverInstances() reads instances from registry if present
- discoverInstances() scans candidate paths if registry empty
- normalizeRuntimeRootCandidate() strips trailing /instances/ segment
- buildErrorInstance() returns safe fallback when instance dir unreadable
- probeInstance() handles stopped instance (connection refused)
- probeInstance() handles unreachable instance (timeout)
```

### 6. `overview-fallback.test.ts` (P1)
```
- fetchKBSummary() returns real facts count from knowledge_base when staff_events absent
- fetchKBSummary() handles knowledge_base query failure gracefully
- metrics/summary returns real facts from knowledge_base when staff_events absent
```

---

## Test Infrastructure Notes

- Test runner: mocha (configured in `src/server/package.json`)
- Tests import from `.js` extensions (ESM)
- Integration tests require a live Postgres connection (use `TEST_DB_URL` env var)
- No frontend tests currently exist (React Testing Library not set up)
- Platform tests: use `process.platform` mocking or separate test files with `.win.test.ts` / `.unix.test.ts` suffixes

---

## Frontend Test Gap

No frontend test infrastructure currently exists. To add:
1. Install `@testing-library/react`, `@testing-library/user-event`, `vitest`
2. Stub the `/api/control-plane/instances` endpoint
3. Test critical paths:
   - AgentRegistry renders empty state when API returns empty agents
   - AgentRegistry does not crash when agent lacks stats field
   - GettingStarted uses activeInstance.name for API calls (not hardcoded 'local')
   - AppShell does not redirect-loop when firstRunDetected
