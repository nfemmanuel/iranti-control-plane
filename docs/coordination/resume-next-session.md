# Resume Prompt — Next PM Session

**Last updated:** 2026-03-22 (Phase 7 COMPLETE — v0.7.0 RC)
**Current branch:** master
**Phase:** 7 DONE — release + publishing work next

---

## Current State Summary

### Phase / Wave status

| Phase | Waves | Version | Status |
|-------|-------|---------|--------|
| Phase 0 | Foundation | — | **COMPLETE** |
| Phase 1 | Operability MVP | v0.1.0 | **SHIPPED** |
| Phase 2 | Interactive Management | v0.2.0-beta | **COMPLETE** |
| Phase 3 | Advanced Operator Features | v0.3.0 | **PM-ACCEPTED 2026-03-21** |
| Phase 4 | Iranti Desktop | v0.4.0 | **PM-ACCEPTED 2026-03-21** |
| Phase 5 | Session Recovery & Runtime Lifecycle | v0.5.0 | **PM-ACCEPTED 2026-03-22** |
| Phase 6 | Actionable Control Plane | v0.6.0 | **PM-ACCEPTED 2026-03-22** |
| Phase 7 | Operator Configuration Management | v0.7.0 | **COMPLETE (2026-03-22) — v0.7.0 RC** |

### Phase 7 Wave status

| Wave | Tickets | Status |
|------|---------|--------|
| Wave 17 | CP-T085, CP-T086, CP-T087 | **DONE — PM-ACCEPTED 2026-03-22** |
| Wave 18 | CP-T088 | **DONE — PM-ACCEPTED 2026-03-22** |
| Wave 19 | CP-T089, CP-T090, CP-T091 | **DONE — PM-ACCEPTED 2026-03-22** |
| Wave 20 | CP-T092, CP-T093, CP-T094 | **DONE — PM-ACCEPTED 2026-03-22** |
| Wave 21 | CP-T095, CP-T096 | **DONE — PM-ACCEPTED 2026-03-22** |

### Release status

| Version | Status | Blocker |
|---------|--------|---------|
| v0.1.0 | Shipped | — |
| v0.2.0-beta | Shipped | — |
| v0.3.0 | **Release Candidate** | Release notes exist; GitHub Release tag pending |
| v0.4.0 | **Release Candidate** | Release notes exist; GitHub Release tag pending |
| v0.5.0 | **Release Candidate** | Release notes PENDING before GitHub Release tag |
| v0.6.0 | **Release Candidate** | Release notes PENDING before GitHub Release tag |
| v0.7.0 | **Release Candidate** | Release notes PENDING before GitHub Release tag |

npm publish has NOT been run. `npm install -g iranti-control-plane` will 404 until it is. Reminder saved in memory.

---

## Phase 7 Completion Summary

### All 12 tickets PM-ACCEPTED

| Ticket | Title | Wave | Acceptance Notes |
|--------|-------|------|-----------------|
| CP-T085 | Provider Key Write Path | 17 | writeEnvVar() targets live instance env; placeholder detection |
| CP-T086 | Provider Default + Fallback Chain Config | 17 | reads + writes LLM_PROVIDER + LLM_PROVIDER_FALLBACK |
| CP-T087 | Provider Task-Model Routing Editor | 17 | 6 task types; compatibility matrix; W2 drift bug filed separately |
| CP-T088 | Iranti Client API Key Manager | 18 | registry as JSON blob in knowledge_base; crypto matches Iranti exactly |
| CP-T089 | Instance Create | 19 | full dir structure; DB migration note in response |
| CP-T090 | Instance Configure | 19 | editable port/db-url/provider; restart warning if running |
| CP-T091 | Project Binding Create + Rebind | 19 | .env.iranti written; projects.json registry; rebind to new instance |
| CP-T092 | Claude Code Integration Manager | 20 | 6 diagnostic issues; direct file-write scaffold |
| CP-T093 | MCP and Hook Visibility | 20 | integration-summary endpoint; aggregated InstanceManager view |
| CP-T094 | Session Recovery Actions | 20 | closed — already done in CP-T071 |
| CP-T095 | Codex Integration Manager | 21 | codex-integration.ts; CodexIntegrationPanel.tsx; machine-level |
| CP-T096 | Attendant Debug Tools | 21 | attendant-debug.ts; X-Iranti-Key auth; currentContext field corrected |

### TypeScript status

- `src/server` — tsc --noEmit: **CLEAN** (verified 2026-03-22 after Wave 21)
- `src/client` — tsc --noEmit: **CLEAN** (verified 2026-03-22 after Wave 21)

---

## Iranti Upstream State

- **Current Iranti version:** 0.2.16 (confirmed on npm 2026-03-21)
- **CP-T025 upstream PR:** Live at https://github.com/nfemmanuel/iranti/pull/1 — awaiting maintainer review/merge
- **Last cross-repo audit:** v0.2.16 — `docs/coordination/cross-repo-audit-v0216-2026-03-21.md`

---

## Bug Flag Status

| Bug | Status |
|-----|--------|
| B6: ingest contamination | **FIXED in v0.2.16** |
| B11: attend classifier | `user/main` recovery resolved in v0.2.14; edge cases may remain |
| B12: transaction timeout on LLM-arbitrated writes | **OPEN** |
| B4: vectorScore=0 | Stable (fallback added v0.2.13) |
| B9: no MCP read for relationships | **OPEN** |
| **NEW: anthropic/claude provider ID drift** | **OPEN** — CP writes `LLM_PROVIDER=anthropic`; Iranti router uses `claude`. Pre-existing. Needs ticket (CP-T097). |

---

## Open Items

| Item | Status | Notes |
|------|--------|-------|
| v0.5.0 release notes | **PENDING** | Must be written before v0.5.0 GitHub Release tag |
| v0.6.0 release notes | **PENDING** | Must be written before v0.6.0 GitHub Release tag |
| v0.7.0 release notes | **PENDING** | Must be written before v0.7.0 GitHub Release tag |
| v0.3.0–v0.7.0 GitHub Releases | **PENDING** | Release notes needed for v0.5.0–v0.7.0. `git tag vX.Y.Z && git push origin vX.Y.Z` then `gh release create`. |
| npm publish | **PENDING** | Steps: `npm login` → `cd repo root` → `node scripts/package/bundle.mjs` → `npm publish --access public`. Also add `NPM_TOKEN` to GitHub repo secrets. |
| anthropic/claude ID drift bug | **NEEDS TICKET** | Pre-existing bug surfaced by CP-T087 review. CP writes `LLM_PROVIDER=anthropic`; Iranti router uses `claude`. File as CP-T097. |
| CP-T025 upstream PR | **PENDING** | Awaiting maintainer at https://github.com/nfemmanuel/iranti/pull/1 |

---

## Next PM Actions (Priority Order)

1. **Write v0.5.0 release notes** — summarise Session Recovery & Runtime Lifecycle (CP-T071–T075)
2. **Write v0.6.0 release notes** — summarise Actionable Control Plane (CP-T076–T083)
3. **Write v0.7.0 release notes** — summarise all 12 Phase 7 tickets
4. **Tag and release** v0.3.0 → v0.7.0 (five GitHub Releases)
5. **npm publish** — unblocks `npm install -g iranti-control-plane` globally
6. **File CP-T097** — anthropic/claude provider ID drift bug ticket
7. **Plan Phase 8** if needed — or declare product stable at v0.7.0

---

## Key Env Resolution Architecture (reference)

- `cwd/.env.iranti` is the project binding file (contains `IRANTI_INSTANCE_ENV` pointer)
- `C:\Users\NF\.iranti-runtime\instances\local\.env` is the live instance env
- All reads AND writes target the instance env via the pointer
- `db.ts:loadEnv()` merges: `{ ...bindingVars, ...instanceVars }` — instance vars win
- `providers.ts:getPreferredEnvFilePath()` checks `env['IRANTI_INSTANCE_ENV']` first
- Iranti restart is required after any env change (`loadRuntimeEnv()` runs once at startup)
- Auth proxies use `X-Iranti-Key` header (not `Authorization: Bearer`)
- `/memory/attend` context field is `currentContext` (not `context`)
