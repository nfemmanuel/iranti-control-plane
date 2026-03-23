# Diagnostics Authority Model

## Operator Summary

The Health Dashboard and Diagnostics panel are instance-scoped.

- The selected instance in the control plane is the authority for `/health`, `/diagnostics/run`, and `/diagnostics/last`.
- The response now includes `scope.instanceId` and `scope.instanceName` so the UI and API make the target explicit.
- A running process is only reported as `running` when `GET /health` returns a valid Iranti health payload. A random process answering on the port no longer counts as healthy.
- Provider checks in Health use the selected instance env. The control plane no longer implies that the project-root `.env.iranti` is the runtime authority for keys or default provider selection.

## Project Integration Authority

Project integration checks are no longer inferred from `process.cwd()` alone.

- `.mcp.json` and `CLAUDE.md` checks are based on projects explicitly bound to the selected instance.
- The current working directory is only counted when it has an explicit `.env.iranti` that points to the selected instance.
- If an instance has no bound projects, the control plane reports that integration status is unverified instead of pretending the current repo is authoritative.

## Repair Behavior

Repair endpoints now require an explicit bound project target.

- `POST /api/control-plane/instances/:instanceId/projects/:projectId/repair/mcp-json`
- `POST /api/control-plane/instances/:instanceId/projects/:projectId/repair/claude-md`

`:projectId` is `encodeURIComponent(projectPath)`.

If the project is not bound to the selected instance, the API returns `422 PROJECT_NOT_BOUND`.

## Doctor Behavior

`POST /api/control-plane/instances/:instanceId/doctor` now reports:

- database health for the selected instance
- provider-key presence for the selected instance env
- whether the instance has any bound projects
- per-project `.mcp.json` and `CLAUDE.md` results for each bound project

If no projects are bound, Doctor says that directly and does not emit fake repair links.

## CLI / UI Equivalence

- Start a stopped instance: `iranti run --instance <name>`
- Bind the current project: `iranti project init . --instance <name>`
- Rebuild Claude integration files for a bound project: `iranti claude-setup <path>`
- Check runtime health directly: `curl http://localhost:<port>/health`

## Maintainer Notes

Routes using the explicit instance authority helper:

- `src/server/routes/control-plane/health.ts`
- `src/server/routes/control-plane/diagnostics.ts`
- `src/server/routes/control-plane/repair.ts`
- `src/server/routes/control-plane/version-sync.ts`

Shared authority helpers:

- `src/server/lib/instance-authority.ts`
- `src/server/lib/project-integration.ts`
