/**
 * Integration tests for the activeOnly filter on GET /kb and the multi-component
 * staffComponent filter on GET /events.
 *
 * Also covers the instance response shape regression check (CP-T011 shape mismatch fix).
 *
 * Prerequisites:
 *   - Server running at http://localhost:3002
 *   - DATABASE_URL env var set (or .env.iranti loaded)
 *
 * Run: vitest run src/server/tests/integration/kb-active-only.test.ts
 */

import { describe, it, expect } from 'vitest'

const BASE = 'http://localhost:3002/api/control-plane'

async function get(path: string): Promise<{ status: number; body: unknown; text: string }> {
  const res = await fetch(`${BASE}${path}`)
  const text = await res.text()
  let body: unknown = null
  try { body = JSON.parse(text) } catch { /* non-JSON */ }
  return { status: res.status, body, text }
}

// ---------------------------------------------------------------------------
// Connectivity guard
// ---------------------------------------------------------------------------

describe('Server reachability', () => {
  it('server is reachable at localhost:3002', async () => {
    const res = await fetch(`${BASE}/health`).catch(() => null)
    expect(res, 'Server must be running at localhost:3002 before integration tests can run').not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// GET /kb — activeOnly filter (KB-029-ext)
// Bug ref: activeOnly KB filter was not being applied server-side before fix.
// ---------------------------------------------------------------------------

describe('GET /kb — activeOnly filter', () => {
  it('KB-ACTIVE-001: activeOnly=true returns 200', async () => {
    const { status } = await get('/kb?activeOnly=true')
    expect(status).toBe(200)
  })

  it('KB-ACTIVE-002: activeOnly=true response has correct pagination envelope', async () => {
    const { status, body } = await get('/kb?activeOnly=true&limit=20')
    expect(status).toBe(200)
    const b = body as Record<string, unknown>
    expect(Array.isArray(b.items)).toBe(true)
    expect(typeof b.total).toBe('number')
    expect(b.limit).toBe(20)
    expect(typeof b.offset).toBe('number')
  })

  it('KB-ACTIVE-003: activeOnly=true items either have null validUntil or validUntil in the future', async () => {
    const { status, body } = await get('/kb?activeOnly=true&limit=50')
    expect(status).toBe(200)
    const items = (body as Record<string, unknown>).items as Record<string, unknown>[]
    const now = Date.now()
    for (const item of items) {
      const validUntil = item.validUntil as string | null
      if (validUntil !== null) {
        // validUntil must be in the future if present
        expect(new Date(validUntil).getTime()).toBeGreaterThan(now)
      }
      // null validUntil is always acceptable (no expiry)
    }
  })

  it('KB-ACTIVE-004: activeOnly=false returns 200 (treated as no filter — falsy activeOnly)', async () => {
    const { status } = await get('/kb?activeOnly=false')
    expect(status).toBe(200)
  })

  it('KB-ACTIVE-005: activeOnly=true combined with entityType filter returns 200 with all items satisfying entityType', async () => {
    const { status, body } = await get('/kb?activeOnly=true&entityType=agent&limit=20')
    expect(status).toBe(200)
    const items = (body as Record<string, unknown>).items as Record<string, unknown>[]
    for (const item of items) {
      expect(item.entityType).toBe('agent')
    }
  })

  it('KB-ACTIVE-006: activeOnly=true combined with minConfidence=50 returns 200 with all items confidence >= 50', async () => {
    const { status, body } = await get('/kb?activeOnly=true&minConfidence=50&limit=20')
    expect(status).toBe(200)
    const items = (body as Record<string, unknown>).items as Record<string, unknown>[]
    for (const item of items) {
      expect(Number(item.confidence)).toBeGreaterThanOrEqual(50)
    }
  })

  it('KB-ACTIVE-007: activeOnly with nonexistent entityType returns empty result (not an error)', async () => {
    const { status, body } = await get('/kb?activeOnly=true&entityType=__nonexistent_xyz__')
    expect(status).toBe(200)
    const b = body as Record<string, unknown>
    expect(b.items).toEqual([])
    expect(b.total).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// GET /events — multi-component staffComponent filter
//
// KNOWN BUG: As of 2026-03-20, validateEventFilters() checks
//   VALID_COMPONENTS.includes(staffComponent) on the raw string.
// A comma-separated value like "Librarian,Archivist" is NOT in VALID_COMPONENTS,
// so this returns 400 INVALID_PARAM. The fix requires splitting in validateEventFilters
// before performing the includes check.
//
// These tests document the current behavior and the correct expected behavior,
// with the failing test marked to aid debugging.
// ---------------------------------------------------------------------------

describe('GET /events — multi-component staffComponent filter (EV-MULTI)', () => {
  it('EV-MULTI-001: staffComponent=Librarian returns 200 or 503 (single component)', async () => {
    const { status, body } = await get('/events?staffComponent=Librarian')
    if (status === 503) {
      expect((body as Record<string, unknown>).code).toBe('EVENTS_TABLE_MISSING')
      return
    }
    expect(status).toBe(200)
    const items = (body as Record<string, unknown>).items as Record<string, unknown>[]
    for (const item of items) {
      expect(item.staffComponent).toBe('Librarian')
    }
  })

  it('EV-MULTI-002: staffComponent=Archivist returns 200 or 503 (single component)', async () => {
    const { status, body } = await get('/events?staffComponent=Archivist')
    if (status === 503) {
      expect((body as Record<string, unknown>).code).toBe('EVENTS_TABLE_MISSING')
      return
    }
    expect(status).toBe(200)
    const items = (body as Record<string, unknown>).items as Record<string, unknown>[]
    for (const item of items) {
      expect(item.staffComponent).toBe('Archivist')
    }
  })

  it('EV-MULTI-003 [BUG]: staffComponent=Librarian,Archivist (comma-separated) should return 200 with IN-clause filtering — currently returns 400 due to validation bug', async () => {
    // EXPECTED CORRECT BEHAVIOR: 200, items have staffComponent in ['Librarian', 'Archivist']
    // CURRENT ACTUAL BEHAVIOR: 400 INVALID_PARAM because validateEventFilters()
    //   does VALID_COMPONENTS.includes('Librarian,Archivist') — which fails.
    //
    // The fix: split on comma in validateEventFilters before the includes check,
    // validate each component individually.
    //
    // This test is written against the CORRECT expected behavior.
    // It will fail until the bug is fixed in events.ts validateEventFilters().
    const { status, body } = await get('/events?staffComponent=Librarian,Archivist')

    if (status === 503) {
      // Table missing — cannot test filter behavior
      expect((body as Record<string, unknown>).code).toBe('EVENTS_TABLE_MISSING')
      return
    }

    // Correct behavior: 200 with only Librarian or Archivist events
    expect(status, 'staffComponent=Librarian,Archivist should return 200 — validateEventFilters() must split on comma before the VALID_COMPONENTS.includes() check').toBe(200)

    const items = (body as Record<string, unknown>).items as Record<string, unknown>[]
    for (const item of items) {
      expect(['Librarian', 'Archivist']).toContain(item.staffComponent)
    }
  })

  it('EV-MULTI-004 [BUG]: comma-separated staffComponent with an invalid value should return 400', async () => {
    // "Librarian,Janitor" — Janitor is invalid. Should return 400 INVALID_PARAM.
    // After the fix, validateEventFilters() will split and check each component.
    const { status, body } = await get('/events?staffComponent=Librarian,Janitor')

    if (status === 503) {
      expect((body as Record<string, unknown>).code).toBe('EVENTS_TABLE_MISSING')
      return
    }

    // Both 400 (current behavior — rejects the whole string) and
    // the expected post-fix 400 (rejects Janitor after split) are correct here.
    // The important thing is this does NOT return 200.
    expect(status).toBe(400)
    expect((body as Record<string, unknown>).code).toBe('INVALID_PARAM')
  })

  it('EV-MULTI-005: staffComponent=Janitor (single invalid) returns 400 INVALID_PARAM', async () => {
    const { status, body } = await get('/events?staffComponent=Janitor')
    expect(status).toBe(400)
    const b = body as Record<string, unknown>
    expect(b.code).toBe('INVALID_PARAM')
    const detail = b.detail as Record<string, unknown>
    expect(detail?.field).toBe('staffComponent')
    expect(Array.isArray(detail?.allowedValues)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// GET /events — SSE stream multi-component filter (SS-010-ext)
//
// Same bug applies to the SSE stream's poll() function: it uses
//   staff_component = $N  (equality)
// instead of IN when filters.staffComponent is comma-separated.
// The poll function does not split either — it passes the raw comma-separated
// value as a single equality operand, which would match no rows.
// ---------------------------------------------------------------------------

describe('GET /events/stream — multi-component filter bug documentation', () => {
  it('SSE-MULTI-001: stream with staffComponent=Librarian,Archivist is rejected before stream opens (400 from validateEventFilters)', async () => {
    // Because validateEventFilters rejects comma-separated values,
    // the SSE stream also returns 400 before the stream is opened.
    // This is consistent with EV-MULTI-003's bug — the same root cause.
    const res = await fetch(`${BASE}/events/stream?staffComponent=Librarian,Archivist`)
    // Should be 400 (current) or ideally 200 text/event-stream after the fix
    const status = res.status
    // We accept either 400 (bug present) or 200 (bug fixed) — the important
    // thing is it's not 500 or a crash.
    expect([200, 400]).toContain(status)
    if (status === 400) {
      const body = await res.json() as Record<string, unknown>
      expect(body.code).toBe('INVALID_PARAM')
    }
    // Close the connection
    res.body?.cancel()
  })
})

// ---------------------------------------------------------------------------
// GET /instances — shape regression check
// Verifies the shape fix from CP-T011: instanceId, database, envFile, integration
// ---------------------------------------------------------------------------

describe('GET /instances — shape regression (CP-T011 fix)', () => {
  it('IN-SHAPE-001: response has instances array with discoveredAt and discoverySource', async () => {
    const { status, body } = await get('/instances')
    expect(status).toBe(200)
    const b = body as Record<string, unknown>
    expect(Array.isArray(b.instances)).toBe(true)
    expect(typeof b.discoveredAt).toBe('string')
    expect(isNaN(Date.parse(b.discoveredAt as string))).toBe(false)
    expect(['registry', 'scan', 'hybrid']).toContain(b.discoverySource)
  })

  it('IN-SHAPE-002: each instance has all required top-level fields', async () => {
    const { body } = await get('/instances')
    const instances = (body as Record<string, unknown>).instances as Record<string, unknown>[]
    for (const inst of instances) {
      expect(inst).toHaveProperty('instanceId')
      expect(inst).toHaveProperty('runtimeRoot')
      expect(inst).toHaveProperty('runningStatus')
      expect(inst).toHaveProperty('runningStatusCheckedAt')
      expect(inst).toHaveProperty('envFile')
      expect(inst).toHaveProperty('integration')
      expect(inst).toHaveProperty('projects')
    }
  })

  it('IN-SHAPE-003: instanceId is 8 lowercase hex characters', async () => {
    const { body } = await get('/instances')
    const instances = (body as Record<string, unknown>).instances as Record<string, unknown>[]
    for (const inst of instances) {
      expect(inst.instanceId as string).toMatch(/^[0-9a-f]{8}$/)
    }
  })

  it('IN-SHAPE-004: runningStatus is a valid enum value', async () => {
    const { body } = await get('/instances')
    const instances = (body as Record<string, unknown>).instances as Record<string, unknown>[]
    for (const inst of instances) {
      expect(['running', 'stopped', 'unreachable']).toContain(inst.runningStatus)
    }
  })

  it('IN-SHAPE-005: envFile shape — has present and keyCompleteness fields', async () => {
    const { body } = await get('/instances')
    const instances = (body as Record<string, unknown>).instances as Record<string, unknown>[]
    for (const inst of instances) {
      const envFile = inst.envFile as Record<string, unknown>
      expect(typeof envFile.present).toBe('boolean')
      // keyCompleteness is null when envFile.present === false
      if (envFile.present) {
        const kc = envFile.keyCompleteness as Record<string, unknown> | null
        if (kc) {
          expect(typeof kc.allRequiredKeysPresent).toBe('boolean')
          expect(Array.isArray(kc.requiredKeys)).toBe(true)
        }
      } else {
        expect(envFile.keyCompleteness).toBeNull()
      }
    }
  })

  it('IN-SHAPE-006: integration shape — has providerKeys with boolean anthropic and openai', async () => {
    const { body } = await get('/instances')
    const instances = (body as Record<string, unknown>).instances as Record<string, unknown>[]
    for (const inst of instances) {
      const integration = inst.integration as Record<string, unknown>
      expect(integration).toHaveProperty('providerKeys')
      const keys = integration.providerKeys as Record<string, unknown>
      expect(typeof keys.anthropic).toBe('boolean')
      expect(typeof keys.openai).toBe('boolean')
    }
  })

  it('IN-SHAPE-007: database field is null or has urlRedacted without raw credentials', async () => {
    const { body } = await get('/instances')
    const instances = (body as Record<string, unknown>).instances as Record<string, unknown>[]
    for (const inst of instances) {
      const db = inst.database as Record<string, unknown> | null
      if (db !== null) {
        if (db.urlRedacted) {
          // Must start with protocol://***@ — credentials redacted
          expect(db.urlRedacted as string).toMatch(/^(postgresql|postgres):\/\/\*\*\*@/)
        }
      }
    }
  })

  it('IN-SHAPE-008: projects is always [] in Phase 1', async () => {
    const { body } = await get('/instances')
    const instances = (body as Record<string, unknown>).instances as Record<string, unknown>[]
    for (const inst of instances) {
      expect(inst.projects).toEqual([])
    }
  })

  it('IN-SHAPE-009: raw ANTHROPIC_API_KEY value is not present in response body', async () => {
    const anthropicKey = process.env.ANTHROPIC_API_KEY ?? ''
    if (anthropicKey.length <= 10) return // Cannot test without a real key
    const res = await fetch(`${BASE}/instances`)
    const text = await res.text()
    expect(text).not.toContain(anthropicKey)
  })

  it('IN-SHAPE-010: raw OPENAI_API_KEY value is not present in response body', async () => {
    const openaiKey = process.env.OPENAI_API_KEY ?? ''
    if (openaiKey.length <= 10) return
    const res = await fetch(`${BASE}/instances`)
    const text = await res.text()
    expect(text).not.toContain(openaiKey)
  })

  it('IN-SHAPE-011: response is always HTTP 200 even when no instances found', async () => {
    const { status } = await get('/instances')
    expect(status).toBe(200)
  })
})
