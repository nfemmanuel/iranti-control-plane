# Releasing Iranti Control Plane

This guide is the practical release path for `iranti-control-plane` on npm.

It covers:
- what to validate before we ship
- the local commands to run
- the manual operator checks that still matter
- the actual `npm publish` step

---

## Port Model

The control plane has two normal local startup modes:

- **Source development**: server on `3002`, Vite on `5173`
- **Packaged CLI (`iranti-cp`)**: first free port in `3000-3010`, unless `CONTROL_PLANE_PORT` is set

Iranti runtimes usually start on `3001`.
Local PostgreSQL usually stays on `5432`.

Do not collapse those into one fake "default port" in release notes or test plans.

---

## Pre-Release Rules

Before publishing:

1. The root build must pass.
2. The bundled CLI must start and serve the built frontend.
3. The instance/operator flows must be manually smoke-tested against a real Iranti runtime.
4. The npm package metadata must be sane:
   - `name`
   - `version`
   - `bin`
   - `files`
   - `repository`
   - `homepage`
   - `bugs`
   - `license`

---

## Local Build Checks

Run these from the repo root:

```bash
npm install
npm run setup
npm run build:client
npm run build:server
npm run build
```

If you want the exact packaged bundle path that npm will publish:

```bash
node scripts/package/bundle.mjs
npm pack
```

---

## Manual Validation Checklist

Use one real local Iranti runtime and one real project binding. Treat these as release gates, not optional niceties.

### 1. Startup and packaging

- [ ] `npm run dev` starts the server and Vite client
- [ ] source dev loads at `http://localhost:5173`
- [ ] packaged CLI starts with `node dist/server/bundle.cjs` or `iranti-cp`
- [ ] packaged CLI opens on the actual chosen port and serves `/control-plane`
- [ ] favicon shows in the browser tab

### 2. Runtime and health

- [ ] Health page loads
- [ ] runtime summary reflects the real selected instance
- [ ] version banner distinguishes runtime upgrades from global CLI install state
- [ ] database reachability is correct
- [ ] diagnostics run returns actionable output

### 3. Instance and project wiring

- [ ] Instances page discovers real runtimes
- [ ] project readiness summary renders
- [ ] create-instance flow can build a PostgreSQL URL from parts
- [ ] configure-instance flow edits the Iranti runtime port, not the control-plane port
- [ ] bind project flow writes `.env.iranti`
- [ ] rebind flow updates the binding cleanly

### 4. Claude and Codex surfaces

- [ ] Claude integration panel reports capability state, not just file presence
- [ ] Codex integration panel reports capability state, not just registration trivia
- [ ] workspace MCP (`.vscode/mcp.json`) is treated as valid wiring
- [ ] root MCP (`.mcp.json`) is still treated as valid wiring
- [ ] Windows `iranti.cmd` is accepted as a valid Iranti command

### 5. Memory and operator surfaces

- [ ] Memory Explorer loads current KB rows
- [ ] Archive Explorer loads archived rows
- [ ] Sessions page loads without crashing
- [ ] Agents page loads when the bound runtime is reachable
- [ ] Staff activity / logs render after migration

### 6. Upgrade and repair actions

- [ ] upgrade banner only appears when the selected runtime is actually behind
- [ ] doctor/repair recommendations are copyable
- [ ] allowlisted run actions succeed where enabled
- [ ] migrations can still be run manually if `staff_events` is missing

---

## Suggested Local Release Pass

This is the shortest serious release pass:

```bash
npm run build
npm test --prefix src/server
npm pack
```

Then manually verify:
- `/instances`
- `/health`
- one project binding flow
- Claude integration panel
- Codex integration panel
- one packaged CLI launch

---

## Publish

When the checks above are green:

```bash
npm publish --access public
```

### CI npm token requirement

If you publish from GitHub Actions, `NPM_TOKEN` must be an **npm Automation token**.

- A standard npm token that still requires interactive 2FA will fail in CI with:
  - `npm error code EOTP`
  - `This operation requires a one-time password from your authenticator.`
- That failure means the token exists, but it is the wrong type for unattended publish.
- Fix by replacing the repository `NPM_TOKEN` secret with an npm Automation token, then rerun the workflow.

If this repo later adds CI-driven publish automation, keep this guide as the human fallback and operator checklist.
