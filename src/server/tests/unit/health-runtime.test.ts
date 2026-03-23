/**
 * Unit tests for health.ts runtime-related functions.
 *
 * deriveRuntimeStatus() is the key exported function that determines whether
 * an Iranti instance is 'running', 'stale', 'stopped', or 'unknown' based on
 * the runtime metadata object (from runtime.json or Iranti health API).
 *
 * STALE_THRESHOLD_MS = 30_000 (30 seconds) — heartbeats older than this
 * cause a 'stale' classification even if status reports 'running'.
 */

import { describe, it, expect } from 'vitest'
import { deriveRuntimeStatus, type IrantiRuntimeMetadata } from '../../routes/control-plane/health.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRuntime(overrides: Partial<IrantiRuntimeMetadata> = {}): IrantiRuntimeMetadata {
  return {
    instanceName: 'local',
    pid: 12345,
    port: 3001,
    startedAt: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'running',
    version: '0.2.21',
    ...overrides,
  }
}

function pastIso(offsetMs: number): string {
  return new Date(Date.now() - offsetMs).toISOString()
}

// ---------------------------------------------------------------------------
// deriveRuntimeStatus — null input
// ---------------------------------------------------------------------------

describe('deriveRuntimeStatus — null input', () => {
  it('returns "unknown" when runtime is null', () => {
    expect(deriveRuntimeStatus(null)).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// deriveRuntimeStatus — explicit stopped/stopping states
// ---------------------------------------------------------------------------

describe('deriveRuntimeStatus — stopped/stopping status field', () => {
  it('returns "stopped" when status is "stopped"', () => {
    expect(deriveRuntimeStatus(makeRuntime({ status: 'stopped' }))).toBe('stopped')
  })

  it('returns "stopped" when status is "stopping"', () => {
    expect(deriveRuntimeStatus(makeRuntime({ status: 'stopping' }))).toBe('stopped')
  })

  it('returns "stopped" regardless of heartbeat recency when status is "stopped"', () => {
    // Even a fresh heartbeat should not override an explicit stopped status
    const runtime = makeRuntime({
      status: 'stopped',
      lastHeartbeatAt: new Date().toISOString(),
    })
    expect(deriveRuntimeStatus(runtime)).toBe('stopped')
  })
})

// ---------------------------------------------------------------------------
// deriveRuntimeStatus — running + heartbeat age
// ---------------------------------------------------------------------------

describe('deriveRuntimeStatus — running status + heartbeat age', () => {
  it('returns "running" when status is "running" and heartbeat is recent (< 30s)', () => {
    const runtime = makeRuntime({
      status: 'running',
      lastHeartbeatAt: pastIso(5_000), // 5 seconds ago
    })
    expect(deriveRuntimeStatus(runtime)).toBe('running')
  })

  it('returns "running" when heartbeat is exactly at the threshold boundary (< 30s)', () => {
    const runtime = makeRuntime({
      status: 'running',
      lastHeartbeatAt: pastIso(29_000), // 29 seconds ago (just under 30s threshold)
    })
    expect(deriveRuntimeStatus(runtime)).toBe('running')
  })

  it('returns "stale" when status is "running" but heartbeat is old (> 30s)', () => {
    const runtime = makeRuntime({
      status: 'running',
      lastHeartbeatAt: pastIso(60_000), // 60 seconds ago
    })
    expect(deriveRuntimeStatus(runtime)).toBe('stale')
  })

  it('returns "stale" when heartbeat is very old (hours ago)', () => {
    const runtime = makeRuntime({
      status: 'running',
      lastHeartbeatAt: pastIso(2 * 60 * 60 * 1000), // 2 hours ago
    })
    expect(deriveRuntimeStatus(runtime)).toBe('stale')
  })

  it('returns "stale" when lastHeartbeatAt is not a valid ISO string', () => {
    const runtime = makeRuntime({
      status: 'running',
      lastHeartbeatAt: 'not-a-date',
    })
    expect(deriveRuntimeStatus(runtime)).toBe('stale')
  })
})

// ---------------------------------------------------------------------------
// deriveRuntimeStatus — starting state
// ---------------------------------------------------------------------------

describe('deriveRuntimeStatus — starting status', () => {
  it('returns "unknown" when status is "starting" (not a handled case)', () => {
    const runtime = makeRuntime({ status: 'starting' })
    // 'starting' falls through to the final return 'unknown'
    expect(deriveRuntimeStatus(runtime)).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// deriveRuntimeStatus — version field presence
// ---------------------------------------------------------------------------

describe('deriveRuntimeStatus — version field does not affect status', () => {
  it('returns "running" with version present', () => {
    const runtime = makeRuntime({
      status: 'running',
      version: '0.2.21',
      lastHeartbeatAt: new Date().toISOString(),
    })
    expect(deriveRuntimeStatus(runtime)).toBe('running')
  })

  it('returns "running" with version absent', () => {
    const runtime = makeRuntime({
      status: 'running',
      version: undefined,
      lastHeartbeatAt: new Date().toISOString(),
    })
    expect(deriveRuntimeStatus(runtime)).toBe('running')
  })
})
