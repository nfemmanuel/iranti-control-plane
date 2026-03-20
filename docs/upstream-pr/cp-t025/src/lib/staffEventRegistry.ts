// src/lib/staffEventRegistry.ts
// CP-T025 — upstream PR implementation file
//
// Module-level singleton registry for the active IStaffEventEmitter.
//
// Design rationale (Option 2 — Static Module-Level Setter):
//   The Librarian's internal call chain is: librarianWrite → withIdentityLock
//   → resolveConflict → escalateConflict. Emission must happen at the innermost
//   level. With constructor/parameter injection (Option 1), the emitter would
//   need to be threaded through 4+ function boundaries, all of which are internal
//   helpers not visible to callers. The static registry pattern requires zero
//   function signature changes — each injection point simply calls
//   getStaffEventEmitter().emit(...). The public API (librarianWrite, runArchivist,
//   resolveInteractive) is unchanged.
//
// Global state concern: The Iranti server runs as a single process with one Iranti
// SDK instance. Only one emitter is ever active at runtime. Tests that need
// isolation use setStaffEventEmitter + resetStaffEventEmitter in beforeEach/afterEach.
//
// See: src/lib/staffEventEmitter.ts for IStaffEventEmitter and NoopEventEmitter.
// See: src/sdk/index.ts for the single call to setStaffEventEmitter at startup.

import { IStaffEventEmitter, NoopEventEmitter } from './staffEventEmitter';

// Module-level singleton. Initialized to NoopEventEmitter so every call to
// getStaffEventEmitter().emit() is safe before setStaffEventEmitter is called.
// This means existing deployments that never call setStaffEventEmitter() get
// zero-overhead no-op behaviour without any conditional guards at injection points.
let _emitter: IStaffEventEmitter = new NoopEventEmitter();

/**
 * Set the active Staff event emitter.
 *
 * Called exactly once — by the Iranti SDK constructor — when a concrete emitter
 * is supplied in IrantiConfig. In production, this is called at server startup
 * and never called again.
 *
 * IMPORTANT: Do not call this after startup in production code. The only
 * legitimate use outside the SDK constructor is in tests (see resetStaffEventEmitter).
 *
 * @param emitter A concrete IStaffEventEmitter implementation.
 */
export function setStaffEventEmitter(emitter: IStaffEventEmitter): void {
  _emitter = emitter;
}

/**
 * Get the currently active Staff event emitter.
 *
 * Returns the NoopEventEmitter if no concrete emitter has been set.
 * Called at every injection point in all four Staff components.
 *
 * @returns The active IStaffEventEmitter.
 */
export function getStaffEventEmitter(): IStaffEventEmitter {
  return _emitter;
}

/**
 * Reset the active emitter to a fresh NoopEventEmitter.
 *
 * FOR USE IN TESTS ONLY (beforeEach / afterEach).
 * Ensures test isolation when tests call setStaffEventEmitter(mockEmitter).
 *
 * Never call this in production code.
 */
export function resetStaffEventEmitter(): void {
  _emitter = new NoopEventEmitter();
}
