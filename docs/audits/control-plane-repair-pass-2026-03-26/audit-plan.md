# Control Plane Audit Plan

## Scope
Bounded repair pass for stopped-instance lifecycle truth and doctor behavior in `iranti-control-plane`.

This pass is limited to:
- stopped-instance `Start` truth
- stopped-instance `Run Doctor` truth
- operator-visible lifecycle and doctor messaging for stopped instances
- targeted tests and audit/docs updates for this slice

This pass explicitly does **not** reopen broader control-plane audit work.

## Ownership
- Lead: slice selection, implementation integration, live validation, audit artifacts, release recommendation
- Worker A: lifecycle/start truth, confirmation semantics, operator banners
- Worker B: doctor decomposition, stopped-instance partial truth, runtime-only check classification
- Worker C: targeted tests, audit artifacts, user test matrix, operator docs for this slice only

## Exact Problems
1. `Start` on a stopped instance reported success too early:
   - spawn attempt was treated as a started runtime
   - operators saw success semantics before durable runtime truth existed
2. `Run Doctor` on a stopped instance was too coarse:
   - runtime-down truth was not decomposed clearly enough
   - useful non-runtime checks were mixed into a noisier result than necessary
3. Operator-visible lifecycle and doctor messaging did not clearly distinguish:
   - runtime not running
   - runtime unhealthy
   - config/env truth that is still inspectable while stopped

## Baseline Assumptions To Verify
- Upstream `iranti status --json` already has a richer stopped/stale/runtime classification than the control plane was surfacing.
- Upstream `iranti doctor --json` can still return useful config/env/provider/DB truth when the runtime process is down.
- The control-plane bugs are likely in truth handling and lifecycle confirmation, not in instance discovery.

## Current Pass
- Selected slice: stopped-instance lifecycle truth and doctor decomposition
- Why this slice:
  - instance discovery is already working
  - instance selection is already working
  - the remaining operator-trust gap is stopped-instance behavior

## Success Criteria

### A. Start behavior
Success means:
- a real process was launched
- runtime truth is confirmed via authoritative status
- runtime metadata/process identity is defensible
- no fake success banner appears before confirmation

Failure means:
- exact failure reason is surfaced
- no “spawn succeeded” language remains unless durable runtime truth was confirmed

### B. Doctor behavior
Doctor on a stopped instance is fixed only if:
- useful non-runtime checks still run
- runtime-only checks are explicitly classified as unavailable / skipped / unreachable / runtime not running
- one runtime-down condition does not collapse the whole doctor result into noise

## Files Reviewed
- `src/server/routes/control-plane/lifecycle.ts`
- `src/server/routes/control-plane/repair.ts`
- `src/server/lib/iranti-cli.ts`
- `src/server/lib/instance-authority.ts`
- `src/server/routes/control-plane/index.ts`
- `src/client/src/components/instances/InstanceManager.tsx`
- `src/client/src/components/instances/DoctorDrawer.tsx`
- `src/client/src/api/client.ts`
- `src/client/src/api/types.ts`
- `src/server/tests/unit/lifecycle-routes.test.ts`
- `src/server/tests/unit/repair-routes.test.ts`
- `docs/guides/troubleshooting.md`

## Planned Outputs
- `CONTROL_PLANE_AUDIT_EXECUTION.md`
- `CONTROL_PLANE_AUDIT_VALIDATION.md`
- `CONTROL_PLANE_AUDIT_RELEASE_RECOMMENDATION.md`
- `CONTROL_PLANE_USER_TEST_MATRIX.md`

## Status
- Scope verified and bounded
- Exact stopped-instance defects reproduced on a real local stopped instance
- Start-path truth boundary fixed in code
- Doctor stopped-instance decomposition fixed in code
- Focused tests added/updated
- Live validation completed on a real local stopped instance
