# Development Protocols — Iranti Control Plane

Owner: `devops_engineer`
Last updated: 2026-03-20

These protocols exist to prevent CI failures, type errors, and critical bugs from reaching master. They apply to all contributors — human and AI agent alike.

---

## Background: Why These Protocols Exist

The following failure modes occurred before these protocols were established:

1. **CI failing silently** — `vite-env.d.ts` missing (TS2307 on CSS module imports), vitest not resolvable from server tsconfig.
2. **6 critical bugs caught only at code review**, not before push:
   - Instance shape mismatch between server response and client type definition
   - Wrong Vite proxy port (3001 vs 3002)
   - SSE `id:` / `data:` field order emitted incorrectly
   - `activeOnly` filter parameter silently ignored in handler
   - Multi-component SSE filter logic broken
   - `pool.end()` called on a shared pool in a migration script
3. **No pre-push typecheck** — TypeScript errors only discovered in CI minutes after push.
4. **No standard agent protocol** — agents marked tickets complete without verifying their own changes compiled or passed tests.

These protocols close each of those gaps.

---

## 1. Pre-Push Checklist

Every contributor — human or agent — must run all of the following and confirm they pass before pushing to `master` or any branch that will be merged to `master`.

### 1.1 Server typecheck

```bash
cd src/server && npx tsc --noEmit
```

This catches: missing types, wrong shapes, unused imports (noUnusedLocals is strict), and bad module references in server code.

### 1.2 Client typecheck

```bash
cd src/client && npx tsc --noEmit
```

Requires `node_modules` to be installed in `src/client`. If they are not installed:

```bash
npm install --prefix src/client
cd src/client && npx tsc --noEmit
```

This catches: CSS module type errors (TS2307 on `*.module.css`), missing component imports, and client-side shape mismatches.

### 1.3 Server unit tests

```bash
cd src/server && npx vitest run tests/unit
```

All tests must pass. Do not ignore failures. If a test fails because the interface intentionally changed, update the test and document the change in your commit message.

### 1.4 CI must be green after push

After pushing, check CI within 5 minutes:

```bash
gh run list --limit 3 --repo nfemmanuel/iranti-control-plane
```

If the latest run fails, do not continue other work. Fix it immediately per the CI Failure Response Protocol (section 4).

---

## 2. Agent Completion Protocol

An agent may not write `status: completed` to Iranti for a ticket until all of the following steps are confirmed.

### Step 1 — Typecheck modified files

Run the typecheck command for every package containing files you modified:

- Modified anything in `src/server/` → `cd src/server && npx tsc --noEmit`
- Modified anything in `src/client/` → `cd src/client && npx tsc --noEmit`

Both must exit with code 0.

### Step 2 — Verify no new unused imports

TypeScript is configured with `noUnusedLocals: true`. Any unused import you introduce will fail the typecheck. Before pushing, scan the files you modified for imports that are no longer used.

### Step 3 — API shape alignment (backend changes)

If your change adds or modifies a backend route, API handler, or shared type:

1. Open `src/client/src/api/types.ts` (and any relevant `src/client/src/api/*.ts`)
2. Confirm that the response shape your route returns exactly matches the TypeScript interface the client uses
3. If the shapes diverged, update one of them and re-run both typechecks

This check is what would have caught the instance shape mismatch and the SSE field order bug before they reached review.

### Step 4 — Import resolution (frontend changes)

If your change adds or modifies a React component, page, or hook:

1. Confirm every `import` in the modified files resolves to a real file
2. If you import a CSS module (`*.module.css`), confirm the file exists and `vite-env.d.ts` is present in `src/client/src/`
3. Confirm no path aliases are broken (`@/` should resolve to `src/client/src/`)

### Step 5 — Check CI after pushing

After pushing, run:

```bash
gh run list --limit 3 --repo nfemmanuel/iranti-control-plane
```

Wait for the run triggered by your push to complete. If it fails, fix it before proceeding.

### Step 6 — Do not write "completed" until CI is green

If CI is red on your push, the ticket is not done. Fix CI, push again, confirm green, then update Iranti.

---

## 3. Code Review Protocol

The following changes require a code review agent pass before the work is considered complete. "Code review agent" means invoking the `qa_engineer` or requesting that the `backend_developer`/`frontend_developer` cross-review.

### Any new API endpoint

The code reviewer must verify:

- The route handler's response shape matches the client-side TypeScript interface exactly
- The route is registered in the Express router
- Error responses use the standard error shape
- No shared pool is terminated (`pool.end()`) inside a request handler

### Any new React component

The code reviewer must verify:

- All imports resolve (no `TS2307` errors)
- Any CSS module files exist and are referenced correctly
- The component is exported and imported correctly in its parent
- No props are typed as `any`

### Any change to shared types

When `src/client/src/api/types.ts`, `src/server/src/types.ts`, or any file re-exported as a shared contract changes:

- The code reviewer must identify all consumers of the changed type
- Each consumer must be checked for shape compatibility
- The review is not complete until all consumers have been verified

---

## 4. CI Failure Response Protocol

**Owner:** `devops_engineer`

### On detection

Within 15 minutes of a CI failure on `master`, the devops_engineer must retrieve the failure logs:

```bash
gh run view {run_id} --log-failed
```

Use `gh run list --limit 5 --repo nfemmanuel/iranti-control-plane` to find the run ID.

### Triage

Identify the root cause category:

| Category | Symptom | Section |
|----------|---------|---------|
| Typecheck failure | `TS2307`, `TS2322`, `TS2339`, `TS5023` | See runbook section 3 |
| Build failure | Vite/rollup resolve error, `ENOENT` | See runbook section 4 |
| Test failure | Vitest assertion failed | See runbook section 5 |
| CI infrastructure | Runner timeout, cache miss, YAML error | Re-run job; escalate if persistent |

### Fix

Push a fix within one build cycle (~3–5 minutes for this project). Do not leave master red.

### Verify

After pushing the fix, confirm:

```bash
gh run list --limit 3 --repo nfemmanuel/iranti-control-plane
```

Wait for the new run. Confirm `conclusion: success`.

### Log

Write the incident to Iranti:

```
entity: project/iranti_control_plane
key: ci_incident_log
value: { "date": "YYYY-MM-DD", "runId": "...", "cause": "...", "fix": "...", "resolvedAt": "..." }
```

---

## 5. Branch Protection (Recommended)

These checks should be enforced via GitHub repository settings. Go to **Settings → Branches → Add rule** for `master`:

- Require status checks to pass before merging:
  - `lint-and-typecheck`
  - `build`
- Require branches to be up to date before merging
- Do not allow bypassing the above settings

Note: branch protection must be configured by a repository admin. This is a one-time setup task for the `devops_engineer`.

---

## 6. Installing the Pre-Push Git Hook

The repo ships a pre-push hook at `.githooks/pre-push` that runs the server typecheck automatically before every push.

To activate it, run once after cloning:

```bash
git config core.hooksPath .githooks
```

This is included automatically when you run:

```bash
bash scripts/dev-setup.sh   # Linux/Mac
./scripts/dev-setup.ps1     # Windows
```

---

## 7. Quick Reference

| When | What to run |
|------|-------------|
| Before any push | `cd src/server && npx tsc --noEmit` |
| Before any push | `cd src/client && npx tsc --noEmit` |
| Before any push | `cd src/server && npx vitest run tests/unit` |
| After push | `gh run list --limit 3 --repo nfemmanuel/iranti-control-plane` |
| On CI failure | `gh run view {id} --log-failed` |
| After new API endpoint | Code review: verify client/server shape alignment |
| After shared type change | Code review: verify all consumers |
| Before marking ticket done | All steps in section 2 |

---

*See also: [DevOps Runbook](../runbooks/devops.md)*
