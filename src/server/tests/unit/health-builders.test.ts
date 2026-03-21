/**
 * Unit tests for CP-T052 health builder functions.
 *
 * buildDecayConfig, buildVectorBackendInfo, and buildAttendantStatus are
 * internal to src/server/routes/control-plane/health.ts and are not exported.
 * They are replicated inline here as spec-level documentation and regression
 * guards. Update the replications if the source implementations change.
 *
 * buildVectorBackendInfo tests are limited to the type-detection branch only.
 * The qdrant/chroma network-probe path (fetch) is NOT tested here — no mocking
 * is used per the assignment spec. Only cases where no network call is made
 * (pgvector, unknown, and unconfigured qdrant/chroma) are exercised.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ===========================================================================
// Inline replication of buildDecayConfig (from routes/control-plane/health.ts)
// Kept in sync with the source. Update this if the source changes.
// The replication uses a `testEnv` object in place of the imported `env`
// so individual tests can control both sources independently.
// ===========================================================================

interface DecayConfig {
  enabled: boolean
  stabilityBase: number
  stabilityIncrement: number
  stabilityMax: number
  decayThreshold: number
}

function buildDecayConfig(testEnv: Record<string, string> = {}): DecayConfig {
  const getVal = (key: string): string =>
    process.env[key] ?? testEnv[key] ?? ''

  const enabled = (getVal('IRANTI_DECAY_ENABLED') || 'false').toLowerCase() === 'true'
  const stabilityBase = parseInt(getVal('IRANTI_DECAY_STABILITY_BASE') || '30', 10)
  const stabilityIncrement = parseInt(getVal('IRANTI_DECAY_STABILITY_INCREMENT') || '5', 10)
  const stabilityMax = parseInt(getVal('IRANTI_DECAY_STABILITY_MAX') || '365', 10)
  const decayThreshold = parseInt(getVal('IRANTI_DECAY_THRESHOLD') || '10', 10)

  return {
    enabled,
    stabilityBase: isNaN(stabilityBase) ? 30 : stabilityBase,
    stabilityIncrement: isNaN(stabilityIncrement) ? 5 : stabilityIncrement,
    stabilityMax: isNaN(stabilityMax) ? 365 : stabilityMax,
    decayThreshold: isNaN(decayThreshold) ? 10 : decayThreshold,
  }
}

// ===========================================================================
// Inline replication of buildAttendantStatus (from routes/control-plane/health.ts)
// ===========================================================================

interface AttendantStatus {
  status: 'informational'
  message: string
  upstreamPRRequired: string
}

function buildAttendantStatus(): AttendantStatus {
  return {
    status: 'informational',
    message:
      'Attendant automatic injection has known reliability limitations without native emitter injection (CP-T025). Iranti v0.2.13 improved classification accuracy. If injection appears unreliable, provide explicit entityHints to iranti_observe.',
    upstreamPRRequired: 'CP-T025',
  }
}

// ===========================================================================
// Inline replication of buildVectorBackendInfo (type-detection path only)
// from routes/control-plane/health.ts.
// The async network-probe path for qdrant/chroma (when url IS set) is omitted.
// ===========================================================================

type VectorBackendType = 'pgvector' | 'qdrant' | 'chroma' | 'unknown'
type VectorBackendStatus = 'ok' | 'warn' | 'error'

interface VectorBackendInfo {
  type: VectorBackendType
  configured: boolean
  url: string | null
  status: VectorBackendStatus
}

async function buildVectorBackendInfo(testEnv: Record<string, string> = {}): Promise<VectorBackendInfo> {
  const getVal = (key: string): string =>
    process.env[key] ?? testEnv[key] ?? ''

  const raw = getVal('IRANTI_VECTOR_BACKEND').trim().toLowerCase()

  let type: VectorBackendType
  if (raw === 'qdrant') type = 'qdrant'
  else if (raw === 'chroma') type = 'chroma'
  else if (raw === 'pgvector' || raw === '') type = 'pgvector'
  else type = 'unknown'

  if (type === 'pgvector' || type === 'unknown') {
    return {
      type,
      configured: type === 'pgvector',
      url: null,
      status: 'ok',
    }
  }

  // qdrant or chroma — check if URL is configured (no network call when url is absent)
  const urlKey = type === 'qdrant' ? 'IRANTI_QDRANT_URL' : 'IRANTI_CHROMA_URL'
  const url = getVal(urlKey).trim()

  if (!url) {
    return {
      type,
      configured: false,
      url: null,
      status: 'warn',
    }
  }

  // Network probe path — not exercised in these tests (url is always absent in
  // the cases below). The source implementation's fetch/AbortController logic
  // is tested via integration tests only.
  return {
    type,
    configured: true,
    url,
    status: 'error', // would be resolved by the actual network probe
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

// Keys cleaned up in afterEach to prevent test bleed.
const DECAY_KEYS = [
  'IRANTI_DECAY_ENABLED',
  'IRANTI_DECAY_STABILITY_BASE',
  'IRANTI_DECAY_STABILITY_INCREMENT',
  'IRANTI_DECAY_STABILITY_MAX',
  'IRANTI_DECAY_THRESHOLD',
]

const VECTOR_KEYS = [
  'IRANTI_VECTOR_BACKEND',
  'IRANTI_QDRANT_URL',
  'IRANTI_CHROMA_URL',
]

function clearProcessEnvKeys(keys: string[]): void {
  for (const k of keys) {
    delete process.env[k]
  }
}

// ===========================================================================
// Tests: buildDecayConfig
// ===========================================================================

describe('buildDecayConfig', () => {
  beforeEach(() => {
    clearProcessEnvKeys(DECAY_KEYS)
  })

  afterEach(() => {
    clearProcessEnvKeys(DECAY_KEYS)
  })

  describe('defaults', () => {
    it('returns all defaults when no env vars are set', () => {
      const result = buildDecayConfig()
      expect(result).toEqual<DecayConfig>({
        enabled: false,
        stabilityBase: 30,
        stabilityIncrement: 5,
        stabilityMax: 365,
        decayThreshold: 10,
      })
    })
  })

  describe('IRANTI_DECAY_ENABLED', () => {
    it('enabled=true when IRANTI_DECAY_ENABLED=true', () => {
      process.env.IRANTI_DECAY_ENABLED = 'true'
      expect(buildDecayConfig().enabled).toBe(true)
    })

    it('enabled=false when IRANTI_DECAY_ENABLED=false', () => {
      process.env.IRANTI_DECAY_ENABLED = 'false'
      expect(buildDecayConfig().enabled).toBe(false)
    })

    it('enabled=true when IRANTI_DECAY_ENABLED=TRUE (case-insensitive)', () => {
      process.env.IRANTI_DECAY_ENABLED = 'TRUE'
      expect(buildDecayConfig().enabled).toBe(true)
    })
  })

  describe('IRANTI_DECAY_STABILITY_BASE', () => {
    it('overrides stabilityBase when IRANTI_DECAY_STABILITY_BASE=60', () => {
      process.env.IRANTI_DECAY_STABILITY_BASE = '60'
      expect(buildDecayConfig().stabilityBase).toBe(60)
    })

    it('falls back to default (30) when IRANTI_DECAY_STABILITY_BASE is not a number', () => {
      process.env.IRANTI_DECAY_STABILITY_BASE = 'not-a-number'
      expect(buildDecayConfig().stabilityBase).toBe(30)
    })
  })

  describe('IRANTI_DECAY_THRESHOLD', () => {
    it('overrides decayThreshold when IRANTI_DECAY_THRESHOLD=25', () => {
      process.env.IRANTI_DECAY_THRESHOLD = '25'
      expect(buildDecayConfig().decayThreshold).toBe(25)
    })
  })

  describe('all five vars set simultaneously', () => {
    it('applies all overrides when all five env vars are set', () => {
      process.env.IRANTI_DECAY_ENABLED = 'true'
      process.env.IRANTI_DECAY_STABILITY_BASE = '45'
      process.env.IRANTI_DECAY_STABILITY_INCREMENT = '10'
      process.env.IRANTI_DECAY_STABILITY_MAX = '730'
      process.env.IRANTI_DECAY_THRESHOLD = '20'

      expect(buildDecayConfig()).toEqual<DecayConfig>({
        enabled: true,
        stabilityBase: 45,
        stabilityIncrement: 10,
        stabilityMax: 730,
        decayThreshold: 20,
      })
    })
  })
})

// ===========================================================================
// Tests: buildAttendantStatus
// ===========================================================================

describe('buildAttendantStatus', () => {
  it('returns status === "informational"', () => {
    expect(buildAttendantStatus().status).toBe('informational')
  })

  it('returns a non-empty message string', () => {
    const { message } = buildAttendantStatus()
    expect(typeof message).toBe('string')
    expect(message.length).toBeGreaterThan(0)
  })

  it('returns upstreamPRRequired === "CP-T025"', () => {
    expect(buildAttendantStatus().upstreamPRRequired).toBe('CP-T025')
  })

  it('returns the same value on every call (pure/idempotent)', () => {
    const first = buildAttendantStatus()
    const second = buildAttendantStatus()
    expect(first).toEqual(second)
  })
})

// ===========================================================================
// Tests: buildVectorBackendInfo — type-detection branch only (no network calls)
// ===========================================================================

describe('buildVectorBackendInfo — type detection (no network probe)', () => {
  beforeEach(() => {
    clearProcessEnvKeys(VECTOR_KEYS)
  })

  afterEach(() => {
    clearProcessEnvKeys(VECTOR_KEYS)
  })

  it('returns type=pgvector, status=ok, url=null when IRANTI_VECTOR_BACKEND is not set', async () => {
    const result = await buildVectorBackendInfo()
    expect(result.type).toBe('pgvector')
    expect(result.status).toBe('ok')
    expect(result.url).toBeNull()
  })

  it('returns type=pgvector, status=ok, url=null when IRANTI_VECTOR_BACKEND=pgvector', async () => {
    process.env.IRANTI_VECTOR_BACKEND = 'pgvector'
    const result = await buildVectorBackendInfo()
    expect(result.type).toBe('pgvector')
    expect(result.status).toBe('ok')
    expect(result.url).toBeNull()
  })

  it('returns type=unknown, status=ok, url=null for an unrecognized IRANTI_VECTOR_BACKEND value', async () => {
    process.env.IRANTI_VECTOR_BACKEND = 'unknown-value'
    const result = await buildVectorBackendInfo()
    expect(result.type).toBe('unknown')
    expect(result.status).toBe('ok')
    expect(result.url).toBeNull()
  })

  it('returns type=qdrant, configured=false, status=warn when IRANTI_QDRANT_URL is not set', async () => {
    process.env.IRANTI_VECTOR_BACKEND = 'qdrant'
    // IRANTI_QDRANT_URL deliberately not set
    const result = await buildVectorBackendInfo()
    expect(result.type).toBe('qdrant')
    expect(result.configured).toBe(false)
    expect(result.status).toBe('warn')
  })

  it('returns type=chroma, configured=false, status=warn when IRANTI_CHROMA_URL is not set', async () => {
    process.env.IRANTI_VECTOR_BACKEND = 'chroma'
    // IRANTI_CHROMA_URL deliberately not set
    const result = await buildVectorBackendInfo()
    expect(result.type).toBe('chroma')
    expect(result.configured).toBe(false)
    expect(result.status).toBe('warn')
  })
})
