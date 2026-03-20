# DevOps Runbook — Iranti Control Plane

Owner: `devops_engineer`
Last updated: 2026-03-20

---

## 1. CI Pipeline Structure

The CI pipeline is defined in `.github/workflows/ci.yml`. It runs on every push and pull request targeting `master` or `main`.

### Jobs

| Job | Name | Depends on | What it does |
|-----|------|------------|--------------|
| `lint-and-typecheck` | Lint & Type Check | — | Runs `tsc --noEmit` on both client (`src/client`) and server (`src/server`) |
| `build` | Build | `lint-and-typecheck` | Runs `npm run build` in both `src/client` and `src/server` |
| `unit-tests` | Unit Tests | `lint-and-typecheck` | Runs `npx vitest run tests/unit` in `src/server` |

### Node version
All jobs use `node: '20'` via `actions/setup-node@v4`.

### Dependency installation
Each job installs dependencies independently:
```bash
npm install                        # root
npm install --prefix src/client    # client
npm install --prefix src/server    # server (where relevant)
```

---

## 2. CI Monitoring

### Automated monitor
A scheduled workflow runs every 15 minutes: `.github/workflows/ci-monitor.yml`

It:
1. Fetches the last 5 CI runs on `master`
2. Finds the most recently completed run
3. If it failed, emits `::error::` with the run URL and prints the first 40 lines of failed-step logs filtered for known error patterns

### Manual monitoring script
`scripts/ci-monitor.sh` replicates the same logic locally. Run it any time with:

```bash
bash scripts/ci-monitor.sh
```

Requires `gh` CLI authenticated (`gh auth status`).

### Session-start protocol
At the start of every devops session:

```bash
gh run list --limit 5 --repo nfemmanuel/iranti-control-plane \
  --json status,conclusion,name,databaseId
```

If the latest `conclusion` is `"failure"`, immediately get logs:

```bash
gh run view {databaseId} --log-failed
```

Fix the root cause and push within one build cycle.

---

## 3. Diagnosing and Fixing TypeScript Errors in CI

### Symptoms
CI fails at the `Type check client` or `Type check server` step with exit code 2.

### Log pattern to look for
```
error TS2322: Type '...' is not assignable to type '...'
error TS2307: Cannot find module '...'
error TS5023: Unknown compiler option '...'
```

### Diagnosis steps

1. Find the failing file and line from the log: e.g., `src/components/instances/InstanceManager.tsx(296,7)`
2. Read the file at that line with context
3. Identify the relevant type definition (usually in `src/client/src/api/types.ts` or `src/client/src/api/instances.ts`)
4. Understand the union type mismatch

### Common causes

| Error | Likely cause | Fix |
|-------|-------------|-----|
| `TS2322` type not assignable | Value produced doesn't fit the target union | Adjust the mapping to use only valid union members |
| `TS2307` cannot find module | Missing type declaration file or path alias | Add `*.d.ts` or check `tsconfig.json` paths |
| `TS2339` property does not exist | Accessing a field not in the interface | Add the field to the interface or use optional chaining |
| `TS5023` unknown compiler option | Local `tsc` version too old | CI uses the project-local `tsc` via `npx`; do not test locally with a system `tsc` |

### Testing the fix locally

CI uses the project-local `tsc` (installed in `node_modules`). To replicate CI exactly:

```bash
cd src/client && npm install && npx tsc --noEmit
cd src/server && npm install && npx tsc --noEmit
```

Do not use a system-level `tsc` — version mismatches will produce false errors (e.g., `TS5023` for `bundler` moduleResolution on tsc < 5.0).

---

## 4. Diagnosing and Fixing Build Failures

### Symptoms
CI passes `lint-and-typecheck` but fails at the `Build client` or `Build server` step.

### Client build (`src/client`)
Uses Vite. Common failures:

| Symptom | Cause | Fix |
|---------|-------|-----|
| `[vite]: Rollup failed to resolve import` | Missing dependency or wrong import path | Check `package.json`, run `npm install --prefix src/client` |
| `ENOENT` on a static asset | Referenced file doesn't exist | Add the missing file or fix the import path |
| `Failed to resolve "react"` | Node modules not installed | Ensure `npm install --prefix src/client` ran before build |

### Server build (`src/server`)
Uses `tsc` to emit JS. Common failures:

| Symptom | Cause | Fix |
|---------|-------|-----|
| TypeScript errors | Type regressions introduced after typecheck passed | Should not happen if `lint-and-typecheck` ran first; if it does, treat as TS error (section 3) |
| Missing output file | `outDir` misconfigured | Check `src/server/tsconfig.json` for `outDir` |

### Reproducing locally

```bash
cd src/client && npm install && npm run build
cd src/server && npm install && npm run build
```

---

## 5. Running Unit Tests Locally

Unit tests live in `src/server/tests/unit/`. The test runner is Vitest.

```bash
cd src/server && npx vitest run tests/unit
```

All 28 tests across 2 test files should pass. If any fail:

1. Read the failing test file
2. Identify whether the failure is in test expectations or in the production code under test
3. If production code is wrong, fix the source in `src/server/src/`
4. If test expectations are outdated due to an intentional interface change, update them — but only after confirming the interface change was intentional

---

## 6. Adding a New Workflow

1. Create `.github/workflows/<name>.yml`
2. Follow the existing pattern:
   - Pin `actions/checkout` and `actions/setup-node` to `@v4`
   - Use `node-version: '20'`
   - Install deps with `npm install` + `--prefix` per workspace
3. Test the workflow manually via `workflow_dispatch` before relying on it in the scheduled/push flow
4. Update this runbook's CI Pipeline Structure table (section 1)

### Workflow template

```yaml
name: My Workflow

on:
  push:
    branches: [master, main]
  workflow_dispatch:

jobs:
  my-job:
    name: My Job
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: |
            package.json
            src/client/package.json
            src/server/package.json
      - name: Install deps
        run: |
          npm install
          npm install --prefix src/client
          npm install --prefix src/server
      - name: Your step
        run: echo "do work here"
```

---

## 7. Escalation: Self-remediate vs. Escalate to PM

### Self-remediate (devops_engineer handles autonomously)

- TypeScript type errors that are clearly implementation bugs (wrong value in a mapping, stale type in a local component)
- Build failures caused by missing dependencies or misconfigured paths
- Unit test failures in utility functions with no product ambiguity
- CI infrastructure issues (flaky runner, caching bug, workflow YAML syntax)
- CRLF/line-ending normalization
- Dependency version bumps with no API surface changes

### Escalate to PM before acting

- Any change that touches a public API contract (`src/server/src/routes/`, shared types in `api/types.ts` used by product features)
- Removing or renaming a type union member that affects product behavior (e.g., adding or removing an instance status value)
- Disabling a CI check
- Changing acceptance criteria implied by a test (if a test documents a product behavior and that behavior needs to change, PM approval is required)
- Any change that affects the release workflow or packaging

### How to escalate

1. Write a fact to Iranti: entity `blocker/ci-<topic>`, key `status`, with a description of the issue and the decision needed
2. Notify the PM in the session summary
3. Do not merge or push workarounds that bypass the product contract

---

## 8. CRLF / Line Ending Issues

The repo uses `.gitattributes` to normalize line endings:

```
* text=auto eol=lf
*.bat text eol=crlf
*.ps1 text eol=crlf
```

This ensures all text files use LF on commit, with the exception of `.bat` and `.ps1` files which require CRLF on Windows. If you see CRLF warnings in `git commit` output, ensure `.gitattributes` is present at the repo root and run:

```bash
git add --renormalize .
git commit -m "chore: normalize line endings"
```

---

## 9. Key File Locations

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | Main CI pipeline (lint, build, test) |
| `.github/workflows/ci-monitor.yml` | Scheduled CI health check (every 15 min) |
| `.github/workflows/release.yml` | Tag-triggered release build and archive |
| `scripts/ci-monitor.sh` | Local CI health check script |
| `scripts/dev-setup.sh` | Local dev environment bootstrap (Linux/Mac) |
| `scripts/dev-setup.ps1` | Local dev environment bootstrap (Windows) |
| `src/client/tsconfig.json` | TypeScript config for Vite/React client |
| `src/server/tsconfig.json` | TypeScript config for Node/Express server |
| `src/server/tests/unit/` | Vitest unit test files |
