# CP-T025 — SDK Injection Point Diffs

**File**: `src/sdk/index.ts`
**Spec reference**: cp-t025-upstream-pr.md §Modified files — `src/sdk/index.ts`

The SDK is the single public entry point for all Iranti consumers. Three changes are required:

1. Extend `IrantiConfig` with an optional `staffEventEmitter` field.
2. In the `Iranti` constructor, call `setStaffEventEmitter(...)` with the provided emitter
   or a new `NoopEventEmitter()` if none is provided.
3. Re-export the public emitter types and functions so consumers can use them without
   importing from internal paths.

---

## Change 1 — `IrantiConfig` Extension

**Trigger**: Add optional `staffEventEmitter` field to the configuration interface.
**Backward compatibility**: The field is optional (`?:`). All existing callers that do not
pass this field continue to work unchanged — the constructor defaults to `NoopEventEmitter`.

```typescript
// BEFORE
export interface IrantiConfig {
  databaseUrl: string;
  escalationsDir?: string;
  memoryDecayThreshold?: number;
  memoryDecayPolicy?: 'confidence_threshold' | 'none';
  // ... other existing config fields
}

// AFTER
import { IStaffEventEmitter } from '../lib/staffEventEmitter'; // CP-T025 (added to imports)

export interface IrantiConfig {
  databaseUrl: string;
  escalationsDir?: string;
  memoryDecayThreshold?: number;
  memoryDecayPolicy?: 'confidence_threshold' | 'none';
  // ... other existing config fields

  /**
   * Optional Staff event emitter for observability integrations.
   *
   * If provided, all four Staff components (Librarian, Attendant, Archivist,
   * Resolutionist) will emit typed events at every meaningful decision point
   * to this emitter. Implementations must be synchronous from the caller's
   * perspective — emit() returns void immediately and handles async delivery
   * internally.
   *
   * If not provided, a NoopEventEmitter is used. Zero overhead.
   *
   * @example
   *   new Iranti({ databaseUrl: '...', staffEventEmitter: new DbStaffEventEmitter(pool) })
   */
  staffEventEmitter?: IStaffEventEmitter; // CP-T025
}
```

**Ambiguity note**: The exact fields in `IrantiConfig` are inferred from the compiled output
and `.d.ts` file at version 0.2.9. The field names (`databaseUrl`, `escalationsDir`, etc.)
must be confirmed against the TypeScript source. The new field is simply appended to the
existing interface — it does not affect any existing field.

---

## Change 2 — Constructor: `setStaffEventEmitter` Call

**Trigger**: In the `Iranti` class constructor, register the provided emitter (or the default
no-op) with the module-level registry before any Staff component can be called.

```typescript
// BEFORE
import { setStaffEventEmitter, NoopEventEmitter } from '../lib/staffEventRegistry';
// (This import does not exist yet — add it)

export class Iranti {
  private config: IrantiConfig;

  constructor(config: IrantiConfig) {
    this.config = config;
    // ... existing constructor logic (DB client setup, etc.)
  }
}

// AFTER
import { setStaffEventEmitter } from '../lib/staffEventRegistry'; // CP-T025
import { NoopEventEmitter } from '../lib/staffEventEmitter';     // CP-T025

export class Iranti {
  private config: IrantiConfig;

  constructor(config: IrantiConfig) {
    this.config = config;

    // CP-T025: register the Staff event emitter at construction time.
    // This is the single point where the emitter is bound for the entire
    // process lifetime. All Staff components call getStaffEventEmitter()
    // from the registry — they never reference this directly.
    setStaffEventEmitter(config.staffEventEmitter ?? new NoopEventEmitter());

    // ... existing constructor logic (DB client setup, etc.)
  }
}
```

**Ambiguity note**: The compiled output shows the `Iranti` class constructor initialises
the Prisma client and sets up other config. The `setStaffEventEmitter` call should be
placed early in the constructor — before any Staff component could theoretically be called.
In practice, Staff components are only called via instance methods (not at construction time),
so the exact position within the constructor is not critical.

---

## Change 3 — Re-exports

**Trigger**: Add public re-exports so consumers of the `iranti` npm package can use the
emitter interface without importing from internal paths (which would break on package
restructuring).

The re-exports should be placed in `src/sdk/index.ts` (or the appropriate barrel file that
constitutes the package's public surface). The exact location depends on whether Iranti uses
a single barrel file or splits exports by type.

```typescript
// BEFORE (end of src/sdk/index.ts or equivalent barrel)
export { Iranti } from './iranti';
export type { IrantiConfig } from './iranti';
// ... other existing exports

// AFTER
export { Iranti } from './iranti';
export type { IrantiConfig } from './iranti';
// ... other existing exports

// CP-T025: public emitter surface — consumers of the iranti package use these
// to implement their own observability integrations.
export type { IStaffEventEmitter, StaffEvent, StaffEventInput, StaffComponent, EventLevel } from '../lib/staffEventEmitter';
export { NoopEventEmitter, buildStaffEvent } from '../lib/staffEventEmitter';
export { setStaffEventEmitter, getStaffEventEmitter, resetStaffEventEmitter } from '../lib/staffEventRegistry';
```

**Ambiguity note**: The exact structure of the SDK barrel file depends on the TypeScript
source layout. The compiled `dist/src/sdk/index.js` shows what is currently exported. The
new exports should be appended without removing any existing export.

**Why re-export `resetStaffEventEmitter`**: Consumers who write test suites that use the
Iranti SDK need `resetStaffEventEmitter` to isolate tests. Exporting it explicitly from the
package surface is preferable to consumers importing from internal paths. It is safe to
export because the function is clearly documented as test-only — production code has no
reason to call it.

---

## Full diff summary for `src/sdk/index.ts`

| Change | Description |
|---|---|
| Add `IStaffEventEmitter` import | From `'../lib/staffEventEmitter'` — needed for `IrantiConfig` field type |
| Add `setStaffEventEmitter` import | From `'../lib/staffEventRegistry'` — called in constructor |
| Add `NoopEventEmitter` import | From `'../lib/staffEventEmitter'` — used as default in constructor |
| Add `staffEventEmitter?: IStaffEventEmitter` | To `IrantiConfig` interface |
| Add `setStaffEventEmitter(...)` call | In `Iranti` constructor, early |
| Add re-exports | 7 symbols re-exported from emitter and registry modules |
