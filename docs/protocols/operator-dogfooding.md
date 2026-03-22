# Control Plane Operator Dogfooding Protocol

## Purpose
Keep the control plane aligned with how Iranti actually works for a real operator on a real machine.

## Rules
1. Use the live installed Iranti instance when validating operator workflows.
2. Treat `.env.iranti` as a project binding pointer only.
3. Treat `IRANTI_INSTANCE_ENV` as the authoritative instance config path.
4. Use the Iranti CLI as the oracle for live semantics.
5. If docs and runtime disagree, trust the runtime and document the drift.
6. Do not accept a slice until the control plane, CLI, and authoritative file/runtime state agree.

## Minimum Validation For Operator Slices
For a slice that changes setup, provider config, instance config, project binding, or integration state:
1. perform the action in the control plane
2. verify the live instance state changed
3. verify the CLI sees the same state
4. verify the relevant file or runtime metadata reflects the change
5. verify the UI reads the same state back correctly

## Required Report Shape
1. files changed
2. behavior implemented
3. live validation
4. acceptance-criteria coverage
5. known gaps with severity
6. accept/reject recommendation
