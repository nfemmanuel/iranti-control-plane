# Control Plane User Test Matrix

Run these in order on the repaired stopped-instance slice.

Target instance:
- `iranti_dev`
- If you do not want to stop `iranti_dev`, create another disposable configured instance and substitute its name in the steps below.

Environment:
- control-plane backend on `http://localhost:3002`
- runtime root `C:\Users\NF\.iranti-runtime`

## 1. Stop the target instance
- Test goal: start the manual pass from a known stopped-instance state.
- Command:
  - stop `iranti_dev` through your usual local method if it is running
  - verify with:
    - `iranti status --root C:\Users\NF\.iranti-runtime --json`
- Expected result:
  - the target instance is not running
  - the upstream status JSON classifies it as stopped/stale/unreachable rather than running

## 2. Run Doctor while the target instance is stopped
- Test goal: confirm doctor returns useful partial truth while runtime is down.
- UI actions:
  - open `/instances`
  - select `iranti_dev` or your disposable stopped instance
  - click `Run Doctor`
- Expected result:
  - doctor drawer opens
  - runtime availability is shown explicitly as unavailable / warn / skipped / runtime not running
  - DB / provider / binding / env checks still render separately
  - the drawer does not collapse into one generic total failure
- Capture if it fails:
  - screenshot of the drawer
  - browser network response for `POST /api/control-plane/instances/:id/doctor`
  - `iranti doctor --instance iranti_dev --root C:\Users\NF\.iranti-runtime --json`

## 3. Start the target instance
- Test goal: confirm `Start` no longer reports fake success before the runtime is actually up.
- UI actions:
  - with the target instance still selected
  - click `Start`
- Expected result:
  - no `Spawn succeeded but no PID was assigned` banner
  - no optimistic success before the runtime is actually reachable/running
  - after success, the instance shows running truthfully
- Capture if it fails:
  - screenshot of the banner/detail panel
  - browser network response for `POST /api/control-plane/instances/:name/start`
  - `iranti status --root C:\Users\NF\.iranti-runtime --json`

## 4. Verify runtime truth after Start
- Test goal: confirm control-plane state matches upstream runtime state.
- Commands / checks:
  - `iranti status --root C:\Users\NF\.iranti-runtime --json`
  - refresh the Instances page
- Expected result:
  - the target instance is classified consistently in both places
  - if the control plane says running, upstream status also says running
  - if start failed, no stale success banner remains

## 5. Run Doctor again after Start
- Test goal: confirm doctor upgrades from runtime-unavailable to runtime-available truth once the target instance is running.
- UI actions:
  - click `Run Doctor` again on the running target instance
- Expected result:
  - runtime availability passes
  - non-runtime checks still render
  - any remaining warns/fails are about actual config/DB/auth truth, not the stopped-runtime condition

## 6. Record remaining issues
- Test goal: separate slice-closed behavior from anything still upstream or environment-specific.
- If anything still looks wrong, classify it as one of:
  - control-plane bug
  - upstream Iranti behavior
  - environment/setup problem
  - expected stopped-instance truth

## Manual-pass completion standard
This slice is manually acceptable only if:
1. stopped-instance doctor still gives useful partial truth
2. `Start` no longer claims success on spawn-only state
3. running-state truth matches upstream `iranti status --json`
4. any remaining warnings on the target instance are about actual instance config/runtime quality, not fake lifecycle semantics
