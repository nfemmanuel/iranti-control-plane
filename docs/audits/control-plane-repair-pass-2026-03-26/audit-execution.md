# Control Plane Audit Execution

## Bounded Repair Pass: Stopped-Instance Lifecycle Truth and Doctor Behavior

### Selected Slice
- stopped-instance `Start` truth
- stopped-instance `Run Doctor` decomposition
- operator-facing lifecycle / doctor message truth for stopped instances

### Environment
- Control-plane repo: `C:\Users\NF\Documents\Projects\iranti-control-plane`
- Iranti repo: `C:\Users\NF\Documents\Projects\iranti`
- Runtime root: `C:\Users\NF\.iranti-runtime`
- Live control-plane backend: `http://localhost:3002`
- Historical validation target: a disposable stopped local instance
- Current manual rerun target: `iranti_dev` or another intentionally stopped configured instance

### Files Reviewed
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

### Exact Defects Confirmed
1. `POST /api/control-plane/instances/:name/start` treated spawn attempt as a started runtime:
   - spawn PID alone was enough to produce success semantics
   - no durable runtime confirmation was required
2. `POST /api/control-plane/instances/:id/doctor` returned partial truth, but did not explicitly decompose runtime-unavailable state for stopped instances.
3. Operator-visible lifecycle semantics were too optimistic:
   - success happened too early
   - runtime-down doctor truth was not explicit enough

### Root-Cause Boundary

#### Start
- The control plane invoked Iranti correctly enough to attempt a launch.
- The defect was in control-plane interpretation:
  - “spawn returned a PID” was being treated as “the runtime started”
  - runtime status was not rechecked before success was returned

#### Doctor
- Upstream Iranti already supports useful doctor output while the runtime is down.
- The defect was in control-plane decomposition:
  - stopped-instance runtime-unavailable truth was not elevated into an explicit check
  - runtime-only omission was not clearly distinguished from broader config/env/DB truth

### Repairs Made

#### 1. Start confirmation truth
Changed:
- `src/server/routes/control-plane/lifecycle.ts`

Repair:
- Added explicit confirmation logic that waits for authoritative runtime truth before returning success.
- Confirmation now requires:
  - the instance appears in `iranti status --json`
  - classification is `running`
  - runtime state is `running: true`
  - reported runtime PID matches the spawned child PID

Failure handling now distinguishes:
- process exited before confirmation
- runtime invalid after launch
- confirmation timeout

Effect:
- no fake success on spawn-only state
- success is now tied to durable runtime truth

#### 2. Doctor decomposition for stopped instances
Changed:
- `src/server/routes/control-plane/repair.ts`

Repair:
- Added explicit runtime availability check for doctor.
- Runtime availability is now surfaced as its own result:
  - `pass` if the runtime health endpoint is reachable and healthy
  - `fail` if reachable but unhealthy
  - `warn` if runtime is not running or unreachable
- Non-runtime checks are still returned:
  - DB reachability
  - provider config
  - binding/integration checks
  - upstream Iranti doctor output

Effect:
- stopped-instance doctor remains useful
- runtime-only omission is explicit instead of collapsing into one coarse failure

### Files Changed
- `src/server/routes/control-plane/lifecycle.ts`
- `src/server/routes/control-plane/repair.ts`
- `src/server/tests/unit/lifecycle-routes.test.ts`
- `src/server/tests/unit/repair-routes.test.ts`
- `CONTROL_PLANE_AUDIT_PLAN.md`
- `CONTROL_PLANE_AUDIT_EXECUTION.md`
- `CONTROL_PLANE_AUDIT_VALIDATION.md`
- `CONTROL_PLANE_AUDIT_RELEASE_RECOMMENDATION.md`
- `CONTROL_PLANE_USER_TEST_MATRIX.md`

### Reviewed Files Left Unchanged
- `src/server/lib/iranti-cli.ts`
  - upstream command invocation and JSON capture were already adequate for this slice
- `src/server/lib/instance-authority.ts`
  - authority resolution was already correct enough for the stopped-instance path
- `src/client/src/components/instances/DoctorDrawer.tsx`
  - existing result rendering already supports pass/warn/fail decomposition
- `src/client/src/api/client.ts`
  - no contract changes required for this slice
- `src/client/src/api/types.ts`
  - no new wire types required
- `docs/guides/troubleshooting.md`
  - reviewed; current operator fallback commands already remain valid for this slice

### Tests Added or Updated
- `src/server/tests/unit/lifecycle-routes.test.ts`
  - confirmed-start success path
  - timeout / failed-start path
- `src/server/tests/unit/repair-routes.test.ts`
  - stopped-instance doctor path
  - runtime-unhealthy classification path
  - invalid-config path

### Commands Run
- `npm --prefix C:\Users\NF\Documents\Projects\iranti-control-plane\src\server test -- --run tests/unit/lifecycle-routes.test.ts`
- `npm --prefix C:\Users\NF\Documents\Projects\iranti-control-plane\src\server test -- --run tests/unit/repair-routes.test.ts`
- `npm --prefix C:\Users\NF\Documents\Projects\iranti-control-plane\src\server run build`
- `npm --prefix C:\Users\NF\Documents\Projects\iranti-control-plane\src\client run build`
- `node C:\Users\NF\Documents\Projects\iranti\bin\iranti.js status --root C:\Users\NF\.iranti-runtime --json`
- `Invoke-RestMethod http://localhost:3002/api/control-plane/instances`
- `Invoke-RestMethod -Method Post http://localhost:3002/api/control-plane/instances/9214d590/doctor`
- `Invoke-RestMethod -Method Post http://localhost:3002/api/control-plane/instances/:name/start`

### Remaining Risks
- start confirmation depends on status becoming truthful within timeout; very slow startup will fail closed as timeout
- runtime availability check relies on `/health` reachability; network-local issues can still surface as runtime unavailable
- in-memory lifecycle state remains ephemeral across control-plane restarts
- whichever instance is used for manual rerun can still surface real env/auth/config warnings that are outside this lifecycle-truth slice
