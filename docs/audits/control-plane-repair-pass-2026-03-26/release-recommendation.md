# Control Plane Audit Release Recommendation

## Bounded Repair Pass: Stopped-Instance Lifecycle Truth and Doctor Behavior

## What Was Actually Broken
1. Control-plane `Start` semantics were wrong for stopped instances:
   - spawn attempt was treated as runtime success
   - operators could see a success message before durable runtime truth existed
2. Control-plane `Run Doctor` semantics were too coarse on stopped instances:
   - runtime-down truth was not its own explicit check
   - useful non-runtime findings were harder to read than they should have been

## Was This A Control-Plane Bug Or An Upstream Iranti Bug?

### Control-plane bugs
- `Start` success was claimed too early
- doctor decomposition was too coarse for stopped instances
- operator-visible lifecycle truth was weaker than upstream Iranti truth

### Upstream Iranti behavior
- Upstream Iranti was mostly correct for this slice:
  - `iranti status --json` already exposed the richer runtime truth needed for confirmation
  - `iranti doctor --json` already allowed useful partial truth on stopped instances
- Remaining instance-side issues observed during validation are not the stopped-instance control-plane bug:
  - the current instance under test can still have configuration quality problems that doctor reports truthfully
  - slow startup can still cause confirmation timeout if the runtime does not become truthful in time

## What Was Fixed
1. `Start` now requires confirmed running-state truth before success is returned.
2. `Run Doctor` now exposes explicit runtime availability while preserving useful non-runtime checks.
3. Focused route tests now cover:
   - stopped-instance start failure
   - confirmed stopped-instance start success
   - stopped-instance doctor decomposition
   - invalid-config doctor truth
   - unhealthy-runtime doctor truth
4. Audit artifacts and the user test matrix now reflect the current stopped-instance slice without depending on the deleted disposable instance.

## Release Recommendation
- This bounded slice is acceptable for iterative product testing.
- For this specific stopped-instance surface, no broader release block remains **if** the manual browser validation in the user test matrix passes on `iranti_dev` or another intentionally stopped configured instance.

## Remaining Risk
- start confirmation is intentionally fail-closed; unusually slow runtime startup can still surface as timeout
- runtime availability is based on health reachability, so local network/proxy oddities can still present as runtime unavailable
- in-memory lifecycle tracking remains non-durable across control-plane restarts
- whichever instance is used for manual rerun can still have instance-side env/auth quality issues that are outside this slice

## Recommendation
- No full control-plane re-audit is needed for this slice.
- No upstream Iranti product fix is immediately required to close the exact stopped-instance bug that was observed.
- The next step is a focused manual browser pass on `iranti_dev` or another intentionally stopped configured instance, not another code broadening pass.
