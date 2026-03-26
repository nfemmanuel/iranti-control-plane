# Control Plane Audit Validation

## Bounded Repair Pass: Stopped-Instance Lifecycle Truth and Doctor Behavior

## Validation Target
- Control-plane backend: `http://localhost:3002`
- Runtime root: `C:\Users\NF\.iranti-runtime`
- Historical live-validation target: a disposable stopped local instance
- Current manual rerun target: `iranti_dev` or another intentionally stopped configured instance

## Automated Validation
- `npm --prefix C:\Users\NF\Documents\Projects\iranti-control-plane\src\server test -- --run tests/unit/lifecycle-routes.test.ts`
- `npm --prefix C:\Users\NF\Documents\Projects\iranti-control-plane\src\server test -- --run tests/unit/repair-routes.test.ts`
- `npm --prefix C:\Users\NF\Documents\Projects\iranti-control-plane\src\server run build`
- `npm --prefix C:\Users\NF\Documents\Projects\iranti-control-plane\src\client run build`

## Automated Validation Interpretation
- lifecycle route coverage now proves:
  - success only returns after confirmed running-state truth
  - timeout / failed-start paths no longer report fake success
- doctor route coverage now proves:
  - stopped-instance runtime availability becomes an explicit check
  - invalid config still returns useful partial truth
  - unhealthy runtime is distinguished from stopped runtime

## Live Validation

### 1. Baseline: stopped local instance
- The validation target was stopped by terminating its runtime PID.
- Upstream truth via:
  - `node C:\Users\NF\Documents\Projects\iranti\bin\iranti.js status --root C:\Users\NF\.iranti-runtime --json`
- Observed upstream classification:
  - `classification: "stale"`
  - `running: false`
  - `processAlive: false`
  - `health.detail: "process not running"`

### 2. Doctor on a stopped instance
Command:
- `POST http://localhost:3002/api/control-plane/instances/9214d590/doctor`

Observed useful partial truth:
- `runtime_availability` -> `warn`
  - `Iranti runtime is not running or not reachable at http://localhost:3501; runtime-only checks were skipped.`
- `database_reachability` -> `fail`
- `provider_config` -> `pass`
- `project_bindings` -> `warn`
- upstream `iranti_doctor:*` checks still returned pass / warn / fail results

Interpretation:
- doctor no longer collapses stopped runtime into one coarse failure
- non-runtime checks remain visible and useful

### 3. Start on a stopped instance
Command:
- `POST http://localhost:3002/api/control-plane/instances/:name/start`

Observed result:
- response returned only after durable runtime confirmation
- measured wall time on the confirmed cycle: approximately `2.93s`
- response:
  - `{"instanceName":"<target>","pid":18796,"status":"started","startedAt":"2026-03-25T12:41:17.464Z"}`

Immediate upstream truth after response:
- `runtimeClassification: "running"`
- `runtimeRunning: true`
- `runtimePid: 18796`

Interpretation:
- `Start` no longer returns success on spawn-only state
- success now aligns with actual upstream running-state truth and PID identity

### 4. Backend truth check
- `GET http://localhost:3002/api/control-plane/instances`
- confirmed:
  - the selected target instance transitions correctly between stopped/stale and running across the repaired path
  - upstream `iranti status --json` agrees with the control plane after the repaired start path

## Remaining Validation Needed
- Manual browser validation on `iranti_dev` or another intentionally stopped configured instance:
  - click `Run Doctor` while the selected instance is stopped
  - confirm the UI shows runtime availability as warn while still rendering DB/provider/binding checks
  - click `Start`
  - confirm no fake success banner appears before runtime comes up
  - rerun `Run Doctor` once running and confirm runtime availability passes

## Validation Confidence
- start truth: high
- doctor decomposition: high
- UI render-path confidence: medium-high pending one manual browser pass on the repaired backend with the current remaining instance set
