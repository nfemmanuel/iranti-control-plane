# Publish Readiness - 2026-03-27

This note captures the current npm-publish state of `iranti-control-plane` after the operator UX sprint and the publish-surface cleanup pass.

---

## What Was Tightened

### Operator-facing truth

- README now reflects the real install path and the real port model.
- Getting Started no longer claims `v0.7.0+` or says Memory Explorer is always the landing page.
- API reference now distinguishes source-dev base URLs from packaged-binary behavior.
- The configure-instance form now clearly edits the **Iranti runtime port**, not the control-plane UI port.

### Publish surface

- `package.json` now has standard npm metadata:
  - `repository`
  - `homepage`
  - `bugs`
  - `keywords`
  - `author`
  - `license`
- Added a dedicated release guide:
  - `docs/guides/releasing.md`
- Marked installer packaging guidance as legacy/default-secondary:
  - `docs/guides/building-installers.md`

### Packaging fix

The bundled control-plane server still loads migration SQL from disk at runtime.

That was a real publish risk because the npm whitelist referenced a root `migrations/` folder that did not exist until the bundle step created it.

The bundle script now copies:

- `src/server/migrations/001_create_staff_events.sql`
- `src/server/migrations/002_create_archive_flags.sql`
- `src/server/migrations/003_staff_events_metrics_index.sql`

into the published root `migrations/` folder before packaging.

---

## Validation Run

### Passed

- `npm run build:client`
- `npm run build`
- `npm pack --json --dry-run`

The dry-run tarball now includes:

- `dist/server/bundle.cjs`
- `public/control-plane/*`
- `migrations/001_create_staff_events.sql`
- `migrations/002_create_archive_flags.sql`
- `migrations/003_staff_events_metrics_index.sql`

### Partially passed / environment-sensitive

- `npm test --prefix src/server`

Result:
- unit coverage remained healthy
- integration coverage still depends on a live `localhost:3002` server and seeded runtime state

Observed failures were not tied to the publish-surface changes. They were:

- reachability timeouts against `localhost:3002`
- health endpoint timeout assertions built around that same assumption
- one instance-projects expectation returning `404` instead of `200` in the current live environment

Treat those as environment/test-harness follow-up, not as evidence that the package bundle is broken.

---

## Remaining Risks Before npm Publish

1. Manual operator validation still needs to be run against the packaged CLI path.
2. Older historical docs and release notes still contain mixed phase/version language.
3. The repo still has unrelated local modifications from the broader UX sprint, so this is not a clean "tag now" state yet.

---

## Recommended Next Step

Run the manual checklist in:

- `docs/guides/releasing.md`

If that passes on the packaged `iranti-cp` path, npm publish is a reasonable next move.
