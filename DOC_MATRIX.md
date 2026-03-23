# DOC_MATRIX.md — Documentation Coverage Matrix

**Updated:** 2026-03-23

---

## Summary

The project has a large number of internal process docs (tickets, specs, coordination notes) but very thin operator-facing documentation. Architecture docs are partially outdated. No install guide or troubleshooting guide exists for operators.

---

## Existing Documentation Inventory

### Reference Docs

| File | Covers | Accuracy | Action |
|---|---|---|---|
| `docs/reference/api.md` | REST API endpoints with request/response shapes | PARTIAL — missing: instances write paths, providers write paths, repair endpoints, auth-keys, claude-integration, codex-integration added in Phase 6-7 | **UPDATE** |
| `docs/reference/known-issues.md` | Known bugs, v0.1.0-era issues | STALE — still at v0.1.0 date (2026-03-20); KI-005 references `npm run migrate` workaround that is broken in dist; many new issues from hostile audit are not listed | **UPDATE** |
| `docs/reference/v010-release-notes.md` | v0.1.0 release | ADEQUATE — covers that release; no subsequent release notes | **SUPPLEMENT** |

### Architecture / Guide Docs

| File | Covers | Accuracy | Action |
|---|---|---|---|
| `docs/guides/architecture.md` | System diagram, component overview | STALE — diagram shows port 3001 for Iranti (correct) and port 3002 for CP; still accurate structurally but authority model section is absent; no mention of `IRANTI_INSTANCE_ENV`, instance registry, runtime.json | **UPDATE** |
| `docs/guides/staff-activity-stream.md` | Staff events architecture | ADEQUATE for its scope; still accurate | KEEP |
| `docs/guides/agent-registry.md` | Agent registry page | Status unknown — likely docs the page before stats-crash fix | REVIEW |
| `docs/guides/building-installers.md` | Build and distribution | Covers the SEA build path; now outdated (replaced by npm global package) | **UPDATE** |

### Specs (Internal Use)

| File | Covers | Accuracy | Action |
|---|---|---|---|
| `docs/specs/control-plane-api.md` | API spec | May be superseded by `api.md` | REVIEW |
| `docs/specs/staff-event-model.md` | Staff event data model | ADEQUATE | KEEP |
| `docs/specs/instance-metadata-aggregation.md` | Instance metadata shapes | PARTIAL — predates `IRANTI_INSTANCE_ENV` authority model | REVIEW |
| `docs/specs/installer-concept.md` | Installer design concept | STALE — installer path changed from SEA to npm global | ARCHIVE |
| `docs/specs/visual-tokens.md` | Design tokens | ADEQUATE | KEEP |
| `docs/specs/shell-design-exploration.md` | Shell UX exploration | Historical | ARCHIVE |
| `docs/specs/entity-aliases-spike.md` | Spike doc | Historical | ARCHIVE |
| `docs/specs/cp-t023-wizard-design.md` | Wizard UX design | Historical | ARCHIVE |
| `docs/specs/cp-t025-fallback-confirmed.md` | Staff events fallback | ADEQUATE for its scope | KEEP |
| `docs/specs/cp-t025-upstream-pr.md` | Upstream PR spec | Historical | ARCHIVE |
| `docs/specs/cp-t020-integration-findings.md` | Integration findings | Historical | ARCHIVE |

### Test Plans

| File | Covers | Accuracy | Action |
|---|---|---|---|
| `docs/test-plans/phase1-api-test-plan.md` | Phase 1 API tests | STALE — doesn't cover Phase 2-7 routes | SUPPLEMENT |
| `docs/test-plans/phase1-ui-acceptance.md` | Phase 1 UI acceptance | STALE — doesn't cover Phase 2-7 pages | SUPPLEMENT |
| `docs/test-plans/phase2-test-plan.md` | Phase 2 test plan | ADEQUATE for its phase | KEEP |
| `docs/qa/cp-t048-clean-machine-test-plan.md` | Clean machine install test | ADEQUATE — covers npm global install path | KEEP |

### Runbooks

| File | Covers | Accuracy | Action |
|---|---|---|---|
| `docs/runbooks/devops.md` | DevOps operations | PARTIAL — covers server start; no troubleshooting guide for common operator errors | **UPDATE** |

### Research Docs (Internal)

| File | Covers | Accuracy | Action |
|---|---|---|---|
| `docs/research/operator-personas.md` | Operator personas | ADEQUATE | KEEP |
| `docs/research/jobs-to-be-done.md` | JTBD analysis | ADEQUATE | KEEP |
| `docs/research/operator-dashboard-best-practices.md` | Dashboard patterns | ADEQUATE | KEEP |
| `docs/research/phase1-usability-risks.md` | Phase 1 risks | Historical | ARCHIVE |
| `docs/research/v010-success-criteria.md` | v0.1.0 success criteria | Historical | ARCHIVE |
| `docs/research/v020-success-criteria.md` | v0.2.0 success criteria | Historical | ARCHIVE |
| `docs/research/competitor-analysis.md` | Competitor analysis | ADEQUATE | KEEP |
| `docs/research/design-partner-brief.md` | Design partner outreach | Internal | KEEP |
| `docs/research/design-partner-outreach.md` | Partner outreach | Internal | KEEP |

### PRD

| File | Covers | Accuracy | Action |
|---|---|---|---|
| `docs/prd/control-plane.md` | Full product requirements | PRIMARY SOURCE OF TRUTH — assume current | VERIFY |

### Implementation Notes (Internal)

| File | Covers | Action |
|---|---|---|
| `docs/implementation/cp-t010-kb-api.md` | KB API implementation | Historical — ARCHIVE |
| `docs/implementation/cp-t011-instance-health-api.md` | Health API implementation | Historical — ARCHIVE |
| `docs/implementation/cp-t012-staff-events.md` | Staff events implementation | Historical — ARCHIVE |

### Coordination Docs (Internal)

| File | Covers | Action |
|---|---|---|
| `docs/coordination/pm-phase2-session-2026-03-20.md` | PM session notes | Historical |
| `docs/coordination/agent-assignments-phase2.md` | Phase 2 agent assignments | Historical |
| `docs/coordination/cross-repo-audit-2026-03-21.md` | Cross-repo audit | Historical |

### Retrospectives (Internal)

| File | Covers | Action |
|---|---|---|
| `docs/retrospectives/phase1-retro.md` | Phase 1 retro | Historical |
| `docs/retrospectives/phase2-retrospective.md` | Phase 2 retro | Historical |
| `docs/retrospectives/cp-d001-postmortem.md` | CP-D001 postmortem | Historical |

### Protocols (Internal)

| File | Covers | Action |
|---|---|---|
| `docs/protocols/development.md` | Development protocol | REVIEW — may have stale dev setup instructions |

---

## Critical Documentation Gaps

### P0 — Missing, operators cannot self-serve

| Missing Doc | Why Critical | Suggested Path |
|---|---|---|
| **Install / Getting Started guide** | No operator-facing doc explaining how to install, configure, and open the control plane for the first time | `docs/guides/getting-started.md` |
| **Authority model explainer** | `.env.iranti` vs `IRANTI_INSTANCE_ENV` confusion is the #1 operator confusion point. No doc explains the two-file model | `docs/guides/config-authority-model.md` |
| **Troubleshooting guide** | No guide for "instances not showing up", "health shows unreachable", "provider keys not saving" — the three most common failures | `docs/guides/troubleshooting.md` |
| **`IRANTI_INSTANCE_ENV` setup doc** | Operators don't know they must set this; the project binding file is not the authoritative source | Part of getting-started or authority model |

### P1 — Stale, misleads operators

| Doc | Issue | Fix |
|---|---|---|
| `docs/reference/known-issues.md` | Still at v0.1.0; KI-005 says `npm run migrate` works — it doesn't in dist | Update to v0.7.0 with accurate workarounds |
| `docs/guides/architecture.md` | Missing `IRANTI_INSTANCE_ENV`, authority model, instance registry, runtime.json | Add authority model section |
| `docs/reference/api.md` | Missing ~10 routes added in Phase 4-7 | Add: instances PATCH/POST, providers PUT/DELETE, repair, auth-keys, integrations |
| `docs/guides/building-installers.md` | References SEA binary; now uses npm global package | Rewrite for npm global path |
| `docs/runbooks/devops.md` | No troubleshooting section | Add common error patterns and resolutions |

### P2 — Missing for completeness

| Missing Doc | Suggested Path |
|---|---|
| Release notes for v0.2.0–v0.7.0 | `docs/reference/v020-v070-release-notes.md` |
| Instance lifecycle guide (start/stop PID tracking limitation) | `docs/guides/instance-lifecycle.md` |
| Provider configuration guide (requires restart, authority model) | `docs/guides/provider-setup.md` |
| Multi-instance setup guide | `docs/guides/multi-instance.md` |
| Windows-specific setup notes | `docs/guides/windows-setup.md` |

---

## Stale Content Audit: High-Risk Claims

These specific claims in existing docs are **known to be wrong** and should be corrected before operator use:

| Doc | Stale Claim | Correct State |
|---|---|---|
| `known-issues.md` KI-005 | "workaround: `npm run migrate`" | `npm run migrate` does not work in the distributed build; manual SQL migration is required |
| `known-issues.md` KI-008 | "DATABASE_URL must be in project-root `.env.iranti`" | DATABASE_URL must be in the **instance env** (`IRANTI_INSTANCE_ENV` path), not the project binding |
| `architecture.md` | Diagram shows port 3001 exclusively for Iranti | CP now uses `findAvailablePort(3000, 3010)` — port is not fixed |
| `api.md` | Lists KB, archive, agents, sessions, health endpoints | Missing: instances (write), providers (write), repair, auth-keys, claude-integration, codex-integration, project-bindings, upgrade |
| `building-installers.md` | SEA binary build path | Replaced by `npm install -g iranti-control-plane` |

---

## Recommended Documentation Writes (Priority Order)

### 1. `docs/guides/getting-started.md` (P0)
```
- Prerequisites: Node 18+, PostgreSQL running, Iranti CLI installed
- Installation: npm install -g iranti-control-plane
- First run: iranti-cp (or iranti-control-plane)
- What it opens (http://localhost:3002/control-plane)
- Expected first-run state (Getting Started wizard)
- How to point it at your Iranti instance
```

### 2. `docs/guides/config-authority-model.md` (P0)
```
- The two files: .env.iranti (pointer) vs instance .env (truth)
- What IRANTI_INSTANCE_ENV is and why it matters
- When to edit each file
- What happens if you edit the wrong one
- How to verify which file the CP is reading
```

### 3. `docs/guides/troubleshooting.md` (P0)
```
- "Instances page shows nothing" → runtime root path, IRANTI_INSTANCE_ENV
- "Health shows unreachable" → port collision, runtime.json heartbeat
- "Provider keys not saving" → IRANTI_INSTANCE_ENV not set, wrong file
- "Database queries fail" → DATABASE_URL in wrong file
- "staff_events absent" → manual migration steps
- "Getting Started loops" → firstRunDetected flag, how to reset
```

### 4. Update `docs/reference/known-issues.md` (P1)
```
- Bump to v0.7.0
- Fix KI-005 (npm run migrate broken in dist — use manual SQL)
- Fix KI-008 (DATABASE_URL location)
- Add: port collision health false-negative
- Add: in-memory PID tracking (stop only works for CP's own lifetime)
- Add: provider key changes require Iranti restart
- Add: Windows path backslash in IRANTI_INSTANCE_ENV
```

### 5. Update `docs/reference/api.md` (P1)
```
- Add Phase 4-7 routes: instances CRUD, providers write, repair,
  auth-keys, claude-integration, codex-integration, project-bindings,
  upgrade, version-sync
```

### 6. Update `docs/guides/architecture.md` (P1)
```
- Add authority model section (two env files)
- Add instance registry / runtime.json lifecycle
- Add instance-identifiers.ts shared utility
- Fix port note (not fixed at 3001/3002)
```

---

## Upstream Docs (in `docs/upstream-pr/`)

These files are proposed changes to the Iranti core repo (not the control plane itself). They are not part of the operator-facing control plane docs. Status unknown — may or may not have been merged upstream.

| File | Purpose |
|---|---|
| `docs/upstream-pr/cp-t025/` | Staff event emitter PR for Iranti core | Proposed upstream PR diffs for librarian, archivist, resolutionist, attendant, SDK |
