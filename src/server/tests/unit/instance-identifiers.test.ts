/**
 * Unit tests for src/server/routes/control-plane/instance-identifiers.ts
 *
 * getConfiguredInstanceIdentifiers() reads IRANTI_INSTANCE_ENV (and IRANTI_INSTANCE)
 * from either the loaded env object (from db.ts, populated at startup from .env.iranti)
 * or process.env as fallback. In the unit test environment there is no .env.iranti, so
 * process.env is the controlling variable for all tests here.
 *
 * This tests the pure logic of the identifier resolution — no filesystem I/O,
 * no postgres, no network.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { getConfiguredInstanceIdentifiers } from '../../routes/control-plane/instance-identifiers.js'

// Use a platform-native base path so tests work on Windows and Unix.
// tmpdir() returns a proper absolute path for the current OS.
const BASE = join(tmpdir(), 'iranti-test-runtime')

// Save and restore process.env across tests so mutations don't leak.
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = {
    IRANTI_INSTANCE_ENV: process.env['IRANTI_INSTANCE_ENV'],
    IRANTI_INSTANCE: process.env['IRANTI_INSTANCE'],
  }
  delete process.env['IRANTI_INSTANCE_ENV']
  delete process.env['IRANTI_INSTANCE']
})

afterEach(() => {
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = val
    }
  }
})

// ---------------------------------------------------------------------------
// getConfiguredInstanceIdentifiers() — runtimeRoot derivation
// ---------------------------------------------------------------------------

describe('getConfiguredInstanceIdentifiers() — runtimeRoot', () => {
  it('derives runtimeRoot two levels above the .env file', () => {
    const instanceEnvPath = join(BASE, 'instances', 'local', '.env')
    process.env['IRANTI_INSTANCE_ENV'] = instanceEnvPath
    const ids = getConfiguredInstanceIdentifiers()
    // runtimeRoot should be BASE (two dirs up from .env)
    expect(ids.runtimeRoot).toBe(BASE)
  })

  it('runtimeRoot does not contain the instances dir segment', () => {
    const instanceEnvPath = join(BASE, 'instances', 'myinst', '.env')
    process.env['IRANTI_INSTANCE_ENV'] = instanceEnvPath
    const ids = getConfiguredInstanceIdentifiers()
    expect(ids.runtimeRoot).not.toMatch(/instances/)
  })

  it('falls back to process.cwd() when IRANTI_INSTANCE_ENV is not set', () => {
    const ids = getConfiguredInstanceIdentifiers()
    expect(ids.runtimeRoot).toBe(process.cwd())
  })

  it('falls back to process.cwd() when IRANTI_INSTANCE_ENV is whitespace only', () => {
    process.env['IRANTI_INSTANCE_ENV'] = '  '
    const ids = getConfiguredInstanceIdentifiers()
    expect(ids.runtimeRoot).toBe(process.cwd())
  })
})

// ---------------------------------------------------------------------------
// getConfiguredInstanceIdentifiers() — instanceName derivation
// ---------------------------------------------------------------------------

describe('getConfiguredInstanceIdentifiers() — instanceName', () => {
  it('derives instanceName from the parent dir of the .env file (local)', () => {
    process.env['IRANTI_INSTANCE_ENV'] = join(BASE, 'instances', 'local', '.env')
    const ids = getConfiguredInstanceIdentifiers()
    expect(ids.instanceName).toBe('local')
  })

  it('derives instanceName from the parent dir of the .env file (myinst)', () => {
    process.env['IRANTI_INSTANCE_ENV'] = join(BASE, 'instances', 'myinst', '.env')
    const ids = getConfiguredInstanceIdentifiers()
    expect(ids.instanceName).toBe('myinst')
  })

  it('prefers explicit IRANTI_INSTANCE over IRANTI_INSTANCE_ENV basename', () => {
    process.env['IRANTI_INSTANCE_ENV'] = join(BASE, 'instances', 'local', '.env')
    process.env['IRANTI_INSTANCE'] = 'cofactor'
    const ids = getConfiguredInstanceIdentifiers()
    expect(ids.instanceName).toBe('cofactor')
  })

  it('returns null when neither IRANTI_INSTANCE_ENV nor IRANTI_INSTANCE is set', () => {
    const ids = getConfiguredInstanceIdentifiers()
    expect(ids.instanceName).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getConfiguredInstanceIdentifiers() — instanceId
// ---------------------------------------------------------------------------

describe('getConfiguredInstanceIdentifiers() — instanceId', () => {
  it('returns an 8-character hex string', () => {
    process.env['IRANTI_INSTANCE_ENV'] = join(BASE, 'instances', 'local', '.env')
    const ids = getConfiguredInstanceIdentifiers()
    expect(ids.instanceId).toMatch(/^[0-9a-f]{8}$/)
  })

  it('instanceId is stable across calls with same env', () => {
    process.env['IRANTI_INSTANCE_ENV'] = join(BASE, 'instances', 'local', '.env')
    const id1 = getConfiguredInstanceIdentifiers().instanceId
    const id2 = getConfiguredInstanceIdentifiers().instanceId
    expect(id1).toBe(id2)
  })

  it('instanceId differs for different instance dirs', () => {
    process.env['IRANTI_INSTANCE_ENV'] = join(BASE, 'instances', 'local', '.env')
    const localId = getConfiguredInstanceIdentifiers().instanceId

    process.env['IRANTI_INSTANCE_ENV'] = join(BASE, 'instances', 'cofactor', '.env')
    const cofactorId = getConfiguredInstanceIdentifiers().instanceId

    expect(localId).not.toBe(cofactorId)
  })
})

// ---------------------------------------------------------------------------
// getConfiguredInstanceIdentifiers() — matches()
// ---------------------------------------------------------------------------

describe('getConfiguredInstanceIdentifiers() — matches()', () => {
  it('matches() returns true for the derived instanceId', () => {
    process.env['IRANTI_INSTANCE_ENV'] = join(BASE, 'instances', 'local', '.env')
    const ids = getConfiguredInstanceIdentifiers()
    expect(ids.matches(ids.instanceId)).toBe(true)
  })

  it('matches() returns true for the instanceName', () => {
    process.env['IRANTI_INSTANCE_ENV'] = join(BASE, 'instances', 'local', '.env')
    const ids = getConfiguredInstanceIdentifiers()
    expect(ids.matches('local')).toBe(true)
  })

  it('matches() returns false for an unrelated string', () => {
    process.env['IRANTI_INSTANCE_ENV'] = join(BASE, 'instances', 'local', '.env')
    const ids = getConfiguredInstanceIdentifiers()
    expect(ids.matches('cofactor')).toBe(false)
    expect(ids.matches('completely-unrelated')).toBe(false)
    expect(ids.matches('')).toBe(false)
  })

  it('matches() accepts both hash ID and name in the same call', () => {
    process.env['IRANTI_INSTANCE_ENV'] = join(BASE, 'instances', 'local', '.env')
    const ids = getConfiguredInstanceIdentifiers()
    const { instanceId, instanceName } = ids
    // Both must match
    expect(ids.matches(instanceId)).toBe(true)
    expect(ids.matches(instanceName!)).toBe(true)
    // And the hash ID must not accidentally match the name
    expect(instanceId).not.toBe(instanceName)
  })

  it('matches() returns false for the name when instanceName is null', () => {
    // No IRANTI_INSTANCE_ENV set → instanceName is null
    const ids = getConfiguredInstanceIdentifiers()
    expect(ids.matches('local')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// instanceDir derivation
// ---------------------------------------------------------------------------

describe('getConfiguredInstanceIdentifiers() — instanceDir', () => {
  it('instanceDir contains instances/<name> when instanceName is known', () => {
    process.env['IRANTI_INSTANCE_ENV'] = join(BASE, 'instances', 'local', '.env')
    const ids = getConfiguredInstanceIdentifiers()
    expect(ids.instanceDir).toContain('instances')
    expect(ids.instanceDir).toContain('local')
  })

  it('instanceDir equals runtimeRoot when instanceName is null', () => {
    const ids = getConfiguredInstanceIdentifiers()
    expect(ids.instanceDir).toBe(ids.runtimeRoot)
  })
})
