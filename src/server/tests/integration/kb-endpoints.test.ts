// Integration test scaffold — runs against a real local server and database.
//
// Prerequisites:
//   - Server running at http://localhost:3002
//   - DATABASE_URL env var set (or .env.iranti loaded)
//   - CP-T001 migration applied (staff_events table must exist for event tests)
//   - Seed data present in DB (see docs/test-plans/phase1-api-test-plan.md §2.4)
//
// Run: vitest run src/server/tests/integration/kb-endpoints.test.ts
// Watch: vitest src/server/tests/integration/kb-endpoints.test.ts

import { describe, it, expect, beforeAll } from 'vitest'

const BASE = 'http://localhost:3002/api/control-plane'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`)
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

function assertCamelCase(obj: Record<string, unknown>, ...expectedKeys: string[]): void {
  for (const key of expectedKeys) {
    expect(obj, `Expected camelCase key '${key}' to be present`).toHaveProperty(key)
    // Verify the snake_case version is NOT present
    const snakeVersion = key.replace(/([A-Z])/g, '_$1').toLowerCase()
    if (snakeVersion !== key) {
      expect(obj, `snake_case key '${snakeVersion}' should NOT be present`).not.toHaveProperty(snakeVersion)
    }
  }
}

// ---------------------------------------------------------------------------
// Connectivity check
// ---------------------------------------------------------------------------

describe('Server reachability', () => {
  it('server is reachable at localhost:3002', async () => {
    const res = await fetch(`${BASE}/health`).catch(() => null)
    expect(res, 'Server must be running at localhost:3002 before integration tests can run').not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// GROUP 1: GET /kb
// ---------------------------------------------------------------------------

describe('GET /kb', () => {
  describe('default behavior', () => {
    it('KB-001: returns 200 with correct pagination envelope', async () => {
      const { status, body } = await get('/kb')
      expect(status).toBe(200)
      const b = body as Record<string, unknown>
      expect(b).toHaveProperty('items')
      expect(b).toHaveProperty('total')
      expect(b).toHaveProperty('limit')
      expect(b).toHaveProperty('offset')
      expect(Array.isArray(b.items)).toBe(true)
      expect(b.limit).toBe(50)
      expect(b.offset).toBe(0)
      expect(typeof b.total).toBe('number')
    })

    it('KB-023: returns 200 with empty items when no results match filter', async () => {
      const { status, body } = await get('/kb?entityType=__nonexistent_type_xyz__')
      expect(status).toBe(200)
      const b = body as Record<string, unknown>
      expect(b.items).toEqual([])
      expect(b.total).toBe(0)
    })

    it('KB-024: response fields are camelCase, not snake_case', async () => {
      const { status, body } = await get('/kb?limit=1')
      expect(status).toBe(200)
      const b = body as Record<string, unknown>
      const items = b.items as Record<string, unknown>[]
      if (items.length > 0) {
        const item = items[0]
        assertCamelCase(item, 'entityType', 'entityId', 'agentId', 'validFrom', 'createdAt', 'valueRawTruncated')
      }
    })
  })

  describe('pagination', () => {
    it('KB-015: limit param is respected', async () => {
      const { status, body } = await get('/kb?limit=5')
      expect(status).toBe(200)
      const b = body as Record<string, unknown>
      const items = b.items as unknown[]
      expect(items.length).toBeLessThanOrEqual(5)
      expect(b.limit).toBe(5)
    })

    it('KB-016: offset param is respected', async () => {
      const { body: page1 } = await get('/kb?limit=5&offset=0')
      const { body: page2 } = await get('/kb?limit=5&offset=5')
      const p1 = page1 as Record<string, unknown>
      const p2 = page2 as Record<string, unknown>
      const p1Items = p1.items as Record<string, unknown>[]
      const p2Items = p2.items as Record<string, unknown>[]
      expect(p2.offset).toBe(5)
      // If there are enough rows, pages should differ
      if (p1Items.length === 5 && p2Items.length > 0) {
        expect(p1Items[0].id).not.toBe(p2Items[0].id)
      }
    })

    it('KB-017: limit=1 returns at most 1 item', async () => {
      const { status, body } = await get('/kb?limit=1')
      expect(status).toBe(200)
      const b = body as Record<string, unknown>
      expect((b.items as unknown[]).length).toBeLessThanOrEqual(1)
    })

    it('KB-018: limit=500 is accepted (maximum allowed)', async () => {
      const { status, body } = await get('/kb?limit=500')
      expect(status).toBe(200)
      expect((body as Record<string, unknown>).limit).toBe(500)
    })
  })

  describe('parameter validation — limit', () => {
    it('KB-019: limit=501 returns 400 INVALID_PARAM (over maximum)', async () => {
      const { status, body } = await get('/kb?limit=501')
      expect(status).toBe(400)
      expect((body as Record<string, unknown>).code).toBe('INVALID_PARAM')
    })

    it('KB-020: limit=0 returns 400 INVALID_PARAM (under minimum)', async () => {
      const { status, body } = await get('/kb?limit=0')
      expect(status).toBe(400)
      expect((body as Record<string, unknown>).code).toBe('INVALID_PARAM')
    })

    it('KB-021: limit=abc returns 400 INVALID_PARAM (non-integer)', async () => {
      const { status, body } = await get('/kb?limit=abc')
      expect(status).toBe(400)
      expect((body as Record<string, unknown>).code).toBe('INVALID_PARAM')
    })

    it('KB-022: offset=-1 returns 400 INVALID_PARAM', async () => {
      const { status, body } = await get('/kb?offset=-1')
      expect(status).toBe(400)
      expect((body as Record<string, unknown>).code).toBe('INVALID_PARAM')
    })
  })

  describe('parameter validation — minConfidence', () => {
    it('KB-010: minConfidence=abc returns 400 INVALID_PARAM', async () => {
      const { status, body } = await get('/kb?minConfidence=abc')
      expect(status).toBe(400)
      expect((body as Record<string, unknown>).code).toBe('INVALID_PARAM')
    })

    it('KB-011: minConfidence=-1 returns 400 INVALID_PARAM', async () => {
      const { status, body } = await get('/kb?minConfidence=-1')
      expect(status).toBe(400)
      expect((body as Record<string, unknown>).code).toBe('INVALID_PARAM')
    })

    it('KB-012: minConfidence=101 returns 400 INVALID_PARAM', async () => {
      const { status, body } = await get('/kb?minConfidence=101')
      expect(status).toBe(400)
      expect((body as Record<string, unknown>).code).toBe('INVALID_PARAM')
    })

    it('KB-007: minConfidence=100 returns only items with confidence >= 100', async () => {
      const { status, body } = await get('/kb?minConfidence=100')
      expect(status).toBe(200)
      const items = (body as Record<string, unknown>).items as Record<string, unknown>[]
      for (const item of items) {
        expect(Number(item.confidence)).toBeGreaterThanOrEqual(100)
      }
    })

    it('KB-008: minConfidence=0 returns 200 (valid boundary)', async () => {
      const { status } = await get('/kb?minConfidence=0')
      expect(status).toBe(200)
    })
  })

  describe('filters', () => {
    it('KB-002: entityType filter returns only matching items', async () => {
      const { status, body } = await get('/kb?entityType=agent')
      expect(status).toBe(200)
      const items = (body as Record<string, unknown>).items as Record<string, unknown>[]
      for (const item of items) {
        expect(item.entityType).toBe('agent')
      }
    })

    it('KB-003: entityId filter returns only matching items', async () => {
      const { status, body } = await get('/kb?entityId=test_agent_001')
      expect(status).toBe(200)
      const items = (body as Record<string, unknown>).items as Record<string, unknown>[]
      for (const item of items) {
        expect(item.entityId).toBe('test_agent_001')
      }
    })

    it('KB-014: search with no matches returns empty array', async () => {
      const { status, body } = await get('/kb?search=__zzz_impossible_string__')
      expect(status).toBe(200)
      const b = body as Record<string, unknown>
      expect(b.items).toEqual([])
      expect(b.total).toBe(0)
    })
  })

  describe('valueRaw truncation', () => {
    it('KB-026: items with small valueRaw have valueRawTruncated=false', async () => {
      const { body } = await get('/kb?limit=20')
      const items = (body as Record<string, unknown>).items as Record<string, unknown>[]
      const smallItems = items.filter(i => {
        const raw = i.valueRaw as string | null
        return raw !== null && Buffer.byteLength(raw, 'utf8') <= 4096
      })
      for (const item of smallItems) {
        expect(item.valueRawTruncated).toBe(false)
      }
    })

    it('KB-025: items with large valueRaw have valueRawTruncated=true and truncated value', async () => {
      // This test only passes if seed data includes an item with >4KB valueRaw
      // Skip gracefully if no such item exists
      const { body } = await get('/kb?limit=100')
      const items = (body as Record<string, unknown>).items as Record<string, unknown>[]
      const truncatedItems = items.filter(i => i.valueRawTruncated === true)
      if (truncatedItems.length === 0) {
        console.warn('KB-025: No items with valueRawTruncated=true found — seed data may not include >4KB items')
        return
      }
      for (const item of truncatedItems) {
        const raw = item.valueRaw as string
        expect(Buffer.byteLength(raw, 'utf8')).toBeLessThanOrEqual(4096)
      }
    })
  })

  describe('security — credential leak check', () => {
    it('KB-027: DATABASE_URL value is not present in response body', async () => {
      const databaseUrl = process.env.DATABASE_URL ?? ''
      if (!databaseUrl) return // Cannot test without knowing the value
      const res = await fetch(`${BASE}/kb`)
      const text = await res.text()
      // Strip common URL prefix for matching (avoid false positives on host:port that may appear in detail)
      const credentialPart = databaseUrl.match(/:\/\/([^@]+)@/)
      if (credentialPart) {
        expect(text).not.toContain(credentialPart[1])
      }
    })
  })
})

// ---------------------------------------------------------------------------
// GROUP 2: GET /archive
// ---------------------------------------------------------------------------

describe('GET /archive', () => {
  it('AR-001: returns 200 with pagination envelope', async () => {
    const { status, body } = await get('/archive')
    expect(status).toBe(200)
    const b = body as Record<string, unknown>
    expect(b).toHaveProperty('items')
    expect(Array.isArray(b.items)).toBe(true)
    expect(b).toHaveProperty('total')
    expect(b.limit).toBe(50)
    expect(b.offset).toBe(0)
  })

  it('AR-013: empty result when no match', async () => {
    const { status, body } = await get('/archive?entityType=__nonexistent__')
    expect(status).toBe(200)
    expect((body as Record<string, unknown>).items).toEqual([])
  })

  it('AR-009: archivedAfter=not-a-date returns 400 INVALID_PARAM', async () => {
    const { status, body } = await get('/archive?archivedAfter=not-a-date')
    expect(status).toBe(400)
    const b = body as Record<string, unknown>
    expect(b.code).toBe('INVALID_PARAM')
    const detail = b.detail as Record<string, unknown>
    expect(detail?.field).toBe('archivedAfter')
  })

  it('AR-010: archivedBefore=2026/01/01 returns 400 INVALID_PARAM', async () => {
    const { status, body } = await get('/archive?archivedBefore=2026/01/01')
    expect(status).toBe(400)
    const b = body as Record<string, unknown>
    expect(b.code).toBe('INVALID_PARAM')
  })

  it('AR-011: limit=501 returns 400 INVALID_PARAM', async () => {
    const { status, body } = await get('/archive?limit=501')
    expect(status).toBe(400)
    expect((body as Record<string, unknown>).code).toBe('INVALID_PARAM')
  })

  it('AR-014: response fields are camelCase', async () => {
    const { body } = await get('/archive?limit=1')
    const items = (body as Record<string, unknown>).items as Record<string, unknown>[]
    if (items.length > 0) {
      assertCamelCase(items[0], 'archivedAt', 'archivedReason', 'supersededBy', 'resolutionState', 'resolutionNote', 'entityType', 'agentId')
    }
  })

  it('AR-015: archivedAt is a non-null ISO 8601 string on all archive items', async () => {
    const { body } = await get('/archive?limit=10')
    const items = (body as Record<string, unknown>).items as Record<string, unknown>[]
    for (const item of items) {
      expect(typeof item.archivedAt).toBe('string')
      expect(item.archivedAt).not.toBeNull()
      // Should parse as a valid date
      expect(isNaN(Date.parse(item.archivedAt as string))).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// GROUP 3a: GET /entities/:entityType/:entityId
// ---------------------------------------------------------------------------

describe('GET /entities/:entityType/:entityId', () => {
  it('EN-001: returns 200 with correct shape for known entity', async () => {
    // This test requires seed data for agent/test_agent_001
    const { status, body } = await get('/entities/agent/test_agent_001')
    // Accept 200 (entity has data) or 404 (seed data not present)
    if (status === 404) {
      console.warn('EN-001: agent/test_agent_001 not found — seed data may not be present')
      return
    }
    expect(status).toBe(200)
    const b = body as Record<string, unknown>
    expect(b).toHaveProperty('entity')
    expect(b).toHaveProperty('currentFacts')
    expect(b).toHaveProperty('archivedFacts')
    expect(b).toHaveProperty('relationships')
    expect(Array.isArray(b.currentFacts)).toBe(true)
    expect(Array.isArray(b.archivedFacts)).toBe(true)
    expect(Array.isArray(b.relationships)).toBe(true)
  })

  it('EN-002: entity field is always null (Phase 1 invariant)', async () => {
    // Test against any entity that exists — fall back to a health check to find one
    const { body: kbBody } = await get('/kb?limit=1')
    const items = (kbBody as Record<string, unknown>).items as Record<string, unknown>[]
    if (items.length === 0) {
      console.warn('EN-002: No KB items found — cannot test entity detail endpoint')
      return
    }
    const { entityType, entityId } = items[0] as { entityType: string; entityId: string }
    const { status, body } = await get(`/entities/${entityType}/${entityId}`)
    expect(status).toBe(200)
    expect((body as Record<string, unknown>).entity).toBeNull()
  })

  it('EN-003: returns 404 for nonexistent entity', async () => {
    const { status, body } = await get('/entities/__fake_type__/__also_fake_id__')
    expect(status).toBe(404)
    expect((body as Record<string, unknown>).code).toBe('NOT_FOUND')
  })

  it('EN-004: includeArchived=false returns empty archivedFacts', async () => {
    const { body: kbBody } = await get('/kb?limit=1')
    const items = (kbBody as Record<string, unknown>).items as Record<string, unknown>[]
    if (items.length === 0) return
    const { entityType, entityId } = items[0] as { entityType: string; entityId: string }
    const { status, body } = await get(`/entities/${entityType}/${entityId}?includeArchived=false`)
    expect(status).toBe(200)
    expect((body as Record<string, unknown>).archivedFacts).toEqual([])
  })

  it('EN-005: includeRelationships=false returns empty relationships', async () => {
    const { body: kbBody } = await get('/kb?limit=1')
    const items = (kbBody as Record<string, unknown>).items as Record<string, unknown>[]
    if (items.length === 0) return
    const { entityType, entityId } = items[0] as { entityType: string; entityId: string }
    const { status, body } = await get(`/entities/${entityType}/${entityId}?includeRelationships=false`)
    expect(status).toBe(200)
    expect((body as Record<string, unknown>).relationships).toEqual([])
  })

  it('EN-006: currentFacts items have camelCase fields', async () => {
    const { body: kbBody } = await get('/kb?limit=1')
    const items = (kbBody as Record<string, unknown>).items as Record<string, unknown>[]
    if (items.length === 0) return
    const { entityType, entityId } = items[0] as { entityType: string; entityId: string }
    const { body } = await get(`/entities/${entityType}/${entityId}`)
    const currentFacts = (body as Record<string, unknown>).currentFacts as Record<string, unknown>[]
    if (currentFacts.length > 0) {
      assertCamelCase(currentFacts[0], 'entityType', 'entityId', 'agentId', 'validFrom', 'createdAt')
    }
  })
})

// ---------------------------------------------------------------------------
// GROUP 3b: GET /entities/:entityType/:entityId/history/:key
// ---------------------------------------------------------------------------

describe('GET /entities/:entityType/:entityId/history/:key', () => {
  it('HI-002: returns 404 for nonexistent entity+key combination', async () => {
    const { status, body } = await get('/entities/__fake__/__fake__/history/__fake_key__')
    expect(status).toBe(404)
    expect((body as Record<string, unknown>).code).toBe('NOT_FOUND')
  })

  it('HI-001: returns correct shape for known entity+key', async () => {
    // Attempt with seed entity — skip gracefully if not present
    const { status, body } = await get('/entities/agent/test_agent_001/history/current_assignment')
    if (status === 404) {
      console.warn('HI-001: agent/test_agent_001/current_assignment not found — seed data may not be present')
      return
    }
    expect(status).toBe(200)
    const b = body as Record<string, unknown>
    expect(b.entityType).toBe('agent')
    expect(b.entityId).toBe('test_agent_001')
    expect(b.key).toBe('current_assignment')
    // CP-T030: response must use current/history/hasHistory shape
    expect(b).toHaveProperty('current')
    expect(Array.isArray(b.history)).toBe(true)
    expect(typeof b.hasHistory).toBe('boolean')
    expect(b.hasHistory).toBe((b.history as unknown[]).length > 0)
  })

  it('HI-004: valueRaw is not truncated on the history endpoint (full value returned)', async () => {
    // Find an entity+key in KB to use for history lookup
    const { body: kbBody } = await get('/kb?limit=5')
    const items = (kbBody as Record<string, unknown>).items as Record<string, unknown>[]
    if (items.length === 0) return

    const { entityType, entityId, key } = items[0] as { entityType: string; entityId: string; key: string }
    const { status, body } = await get(`/entities/${entityType}/${entityId}/history/${key}`)
    if (status !== 200) return

    const b = body as Record<string, unknown>
    // On the history endpoint, valueRawTruncated should NOT be present (full value returned)
    const current = b.current as Record<string, unknown> | null
    if (current) {
      expect(current).not.toHaveProperty('valueRawTruncated')
    }
    const history = b.history as Record<string, unknown>[]
    for (const interval of history) {
      expect(interval).not.toHaveProperty('valueRawTruncated')
    }
  })

  it('HI-006: providerSource field present (not source) on history intervals', async () => {
    const { body: kbBody } = await get('/kb?limit=1')
    const items = (kbBody as Record<string, unknown>).items as Record<string, unknown>[]
    if (items.length === 0) return

    const { entityType, entityId, key } = items[0] as { entityType: string; entityId: string; key: string }
    const { status, body } = await get(`/entities/${entityType}/${entityId}/history/${key}`)
    if (status !== 200) return

    const b = body as Record<string, unknown>
    const current = b.current as Record<string, unknown> | null
    if (current) {
      expect(current).toHaveProperty('providerSource')
    }
    const history = b.history as Record<string, unknown>[]
    if (history.length > 0) {
      expect(history[0]).toHaveProperty('providerSource')
    }
  })

  it('HI-007: archivedReason on history intervals is human-readable (not raw enum code)', async () => {
    // Find an entity with archive rows — try seed entity first
    const { body: kbBody } = await get('/kb?limit=10')
    const items = (kbBody as Record<string, unknown>).items as Record<string, unknown>[]
    if (items.length === 0) return

    for (const item of items) {
      const { entityType, entityId, key } = item as { entityType: string; entityId: string; key: string }
      const { status, body } = await get(`/entities/${entityType}/${entityId}/history/${key}`)
      if (status !== 200) continue
      const history = (body as Record<string, unknown>).history as Record<string, unknown>[]
      for (const interval of history) {
        const reason = interval.archivedReason as string | null
        if (reason !== null) {
          // Must NOT be a bare raw code like 'superseded', 'contradicted', 'expired', 'decayed'
          const rawCodes = ['superseded', 'contradicted', 'expired', 'decayed']
          expect(rawCodes, `archivedReason "${reason}" is a raw enum code — must be human-readable`).not.toContain(reason)
        }
      }
    }
  })

  it('HI-008: hasHistory is false when entity+key has no archived intervals', async () => {
    // Find an entity+key that exists in KB but has no archive rows
    // We scan the first few KB items and check for hasHistory: false
    const { body: kbBody } = await get('/kb?limit=20')
    const items = (kbBody as Record<string, unknown>).items as Record<string, unknown>[]
    let foundNoHistory = false
    for (const item of items) {
      const { entityType, entityId, key } = item as { entityType: string; entityId: string; key: string }
      const { status, body } = await get(`/entities/${entityType}/${entityId}/history/${key}`)
      if (status !== 200) continue
      const b = body as Record<string, unknown>
      if (b.hasHistory === false) {
        expect(b.history).toEqual([])
        foundNoHistory = true
        break
      }
    }
    if (!foundNoHistory) {
      console.warn('HI-008: All sampled KB items have archive history — could not verify hasHistory: false path')
    }
  })
})

// ---------------------------------------------------------------------------
// GROUP 4: GET /relationships
// ---------------------------------------------------------------------------

describe('GET /relationships', () => {
  it('RL-001: returns 200 with pagination envelope', async () => {
    const { status, body } = await get('/relationships')
    expect(status).toBe(200)
    const b = body as Record<string, unknown>
    expect(Array.isArray(b.items)).toBe(true)
    expect(b).toHaveProperty('total')
    expect(b.limit).toBe(50)
    expect(b.offset).toBe(0)
  })

  it('RL-007: limit=501 returns 400 INVALID_PARAM', async () => {
    const { status, body } = await get('/relationships?limit=501')
    expect(status).toBe(400)
    expect((body as Record<string, unknown>).code).toBe('INVALID_PARAM')
  })

  it('RL-009: empty result when no entity found', async () => {
    const { status, body } = await get('/relationships?entityId=__nobody_knows_this_entity__')
    expect(status).toBe(200)
    expect((body as Record<string, unknown>).items).toEqual([])
  })

  it('RL-002: entityId returns bidirectional results', async () => {
    const { body } = await get('/relationships?entityId=test_agent_001')
    const items = (body as Record<string, unknown>).items as Record<string, unknown>[]
    for (const item of items) {
      const isFrom = item.fromEntityId === 'test_agent_001'
      const isTo   = item.toEntityId   === 'test_agent_001'
      expect(isFrom || isTo).toBe(true)
    }
  })

  it('RL-010: response fields are camelCase', async () => {
    const { body } = await get('/relationships?limit=1')
    const items = (body as Record<string, unknown>).items as Record<string, unknown>[]
    if (items.length > 0) {
      assertCamelCase(items[0], 'fromEntityType', 'fromEntityId', 'toEntityType', 'toEntityId', 'relationshipType', 'createdAt')
    }
  })
})

// ---------------------------------------------------------------------------
// GROUP 6: GET /health
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  it('HL-001: always returns HTTP 200', async () => {
    const { status } = await get('/health')
    expect(status).toBe(200)
  })

  it('HL-002: response has correct overall/checks/checkedAt shape', async () => {
    const { body } = await get('/health')
    const b = body as Record<string, unknown>
    expect(['healthy', 'degraded', 'error']).toContain(b.overall)
    expect(Array.isArray(b.checks)).toBe(true)
    expect(typeof b.checkedAt).toBe('string')
    expect(isNaN(Date.parse(b.checkedAt as string))).toBe(false)
  })

  it('HL-003: all 10 required check names are present', async () => {
    const { body } = await get('/health')
    const checks = (body as Record<string, unknown>).checks as Record<string, unknown>[]
    const checkNames = checks.map(c => c.name as string)
    const requiredNames = [
      'db_reachability',
      'db_schema_version',
      'vector_backend',
      'anthropic_key',
      'openai_key',
      'default_provider_configured',
      'mcp_integration',
      'claude_md_integration',
      'runtime_version',
      'staff_events_table',
    ]
    for (const name of requiredNames) {
      expect(checkNames, `Check '${name}' must be present in health response`).toContain(name)
    }
  })

  it('HL-004: each check has name, status, and message fields', async () => {
    const { body } = await get('/health')
    const checks = (body as Record<string, unknown>).checks as Record<string, unknown>[]
    for (const check of checks) {
      expect(typeof check.name).toBe('string')
      expect(['ok', 'warn', 'error']).toContain(check.status)
      expect(typeof check.message).toBe('string')
    }
  })

  it('HL-005: db_reachability check has latencyMs in detail when ok', async () => {
    const { body } = await get('/health')
    const checks = (body as Record<string, unknown>).checks as Record<string, unknown>[]
    const dbCheck = checks.find(c => c.name === 'db_reachability')
    expect(dbCheck).toBeDefined()
    if (dbCheck && dbCheck.status === 'ok') {
      const detail = dbCheck.detail as Record<string, unknown>
      expect(typeof detail?.latencyMs).toBe('number')
    }
  })

  it('HL-024/025/026: overall status logic matches worst-case check status', async () => {
    const { body } = await get('/health')
    const b = body as Record<string, unknown>
    const checks = b.checks as Record<string, unknown>[]
    const hasError  = checks.some(c => c.status === 'error')
    const hasWarn   = checks.some(c => c.status === 'warn')

    if (hasError) {
      expect(b.overall).toBe('error')
    } else if (hasWarn) {
      expect(b.overall).toBe('degraded')
    } else {
      expect(b.overall).toBe('healthy')
    }
  })

  it('HL-027: API key values are not present in health response', async () => {
    const anthropicKey = process.env.ANTHROPIC_API_KEY ?? ''
    const openaiKey    = process.env.OPENAI_API_KEY    ?? ''
    const res = await fetch(`${BASE}/health`)
    const text = await res.text()
    if (anthropicKey.length > 10) {
      expect(text).not.toContain(anthropicKey)
    }
    if (openaiKey.length > 10) {
      expect(text).not.toContain(openaiKey)
    }
  })
})

// ---------------------------------------------------------------------------
// GROUP 7a: GET /events
// ---------------------------------------------------------------------------

describe('GET /events', () => {
  it('EV-001: returns 200 with events array', async () => {
    const { status, body } = await get('/events?limit=10')
    // 503 is acceptable if staff_events table is absent (CP-T001 not applied)
    if (status === 503) {
      const code = (body as Record<string, unknown>).code
      expect(code).toBe('EVENTS_TABLE_MISSING')
      console.warn('EV-001: staff_events table missing — CP-T001 migration not applied')
      return
    }
    expect(status).toBe(200)
    const b = body as Record<string, unknown>
    expect(Array.isArray(b.items)).toBe(true)
    expect(b).toHaveProperty('limit')
    expect(b).toHaveProperty('offset')
  })

  it('EV-004: staffComponent=Janitor returns 400 INVALID_PARAM', async () => {
    const { status, body } = await get('/events?staffComponent=Janitor')
    expect(status).toBe(400)
    const b = body as Record<string, unknown>
    expect(b.code).toBe('INVALID_PARAM')
    const detail = b.detail as Record<string, unknown>
    expect(detail?.field).toBe('staffComponent')
    expect(Array.isArray(detail?.allowedValues)).toBe(true)
  })

  it('EV-011: level=verbose returns 400 INVALID_PARAM', async () => {
    const { status, body } = await get('/events?level=verbose')
    expect(status).toBe(400)
    expect((body as Record<string, unknown>).code).toBe('INVALID_PARAM')
  })

  it('EV-015: since=not-a-date returns 400 INVALID_PARAM', async () => {
    const { status, body } = await get('/events?since=not-a-date')
    expect(status).toBe(400)
    const b = body as Record<string, unknown>
    expect(b.code).toBe('INVALID_PARAM')
    const detail = b.detail as Record<string, unknown>
    expect(detail?.field).toBe('since')
  })

  it('EV-016: until=2026/01/01 returns 400 INVALID_PARAM', async () => {
    const { status, body } = await get('/events?until=2026/01/01')
    expect(status).toBe(400)
    expect((body as Record<string, unknown>).code).toBe('INVALID_PARAM')
  })

  it('EV-018: limit=1001 returns 400 INVALID_PARAM', async () => {
    const { status, body } = await get('/events?limit=1001')
    expect(status).toBe(400)
    expect((body as Record<string, unknown>).code).toBe('INVALID_PARAM')
  })

  it('EV-017: limit=1000 is accepted (maximum allowed)', async () => {
    const { status, body } = await get('/events?limit=1000')
    if (status === 503) return // Table missing — skip
    expect(status).toBe(200)
    expect((body as Record<string, unknown>).limit).toBe(1000)
  })

  it('EV-019: empty result when no matching events', async () => {
    const { status, body } = await get('/events?agentId=__nobody__')
    if (status === 503) return
    expect(status).toBe(200)
    expect((body as Record<string, unknown>).items).toEqual([])
  })

  it('EV-020: response fields are camelCase', async () => {
    const { status, body } = await get('/events?limit=1')
    if (status === 503) return
    const items = (body as Record<string, unknown>).items as Record<string, unknown>[]
    if (items.length > 0) {
      assertCamelCase(items[0], 'eventId', 'staffComponent', 'actionType', 'agentId', 'entityType', 'entityId')
    }
  })

  it('EV-002: staffComponent=Librarian filter returns only Librarian events', async () => {
    const { status, body } = await get('/events?staffComponent=Librarian&limit=20')
    if (status === 503) return
    expect(status).toBe(200)
    const items = (body as Record<string, unknown>).items as Record<string, unknown>[]
    for (const item of items) {
      expect(item.staffComponent).toBe('Librarian')
    }
  })

  it('EV-021: staff_events table absent returns 503 EVENTS_TABLE_MISSING (edge case — skipped if table exists)', async () => {
    // This test is only meaningful when running against a DB without the CP-T001 migration.
    // It verifies the error shape when the table is missing.
    // In a normal test run, the table should exist (200 returned), so we check the shape only if 503.
    const { status, body } = await get('/events')
    if (status === 503) {
      expect((body as Record<string, unknown>).code).toBe('EVENTS_TABLE_MISSING')
    }
    // If 200, test passes (table exists — correct behavior)
  })
})

// ---------------------------------------------------------------------------
// GROUP 5a: GET /instances
// ---------------------------------------------------------------------------

describe('GET /instances', () => {
  it('IN-001: returns 200 with instances array and metadata', async () => {
    const { status, body } = await get('/instances')
    expect(status).toBe(200)
    const b = body as Record<string, unknown>
    expect(Array.isArray(b.instances)).toBe(true)
    expect(typeof b.discoveredAt).toBe('string')
    expect(isNaN(Date.parse(b.discoveredAt as string))).toBe(false)
    expect(['registry', 'scan', 'hybrid']).toContain(b.discoverySource)
  })

  it('IN-002: instanceId is 8 lowercase hex characters', async () => {
    const { body } = await get('/instances')
    const instances = (body as Record<string, unknown>).instances as Record<string, unknown>[]
    for (const instance of instances) {
      expect(instance.instanceId as string).toMatch(/^[0-9a-f]{8}$/)
    }
  })

  it('IN-004: database.urlRedacted does not contain raw credentials', async () => {
    const { body } = await get('/instances')
    const instances = (body as Record<string, unknown>).instances as Record<string, unknown>[]
    for (const instance of instances) {
      const db = instance.database as Record<string, unknown> | null
      if (db?.urlRedacted) {
        const redacted = db.urlRedacted as string
        expect(redacted).toMatch(/^(postgresql|postgres):\/\/\*\*\*@/)
      }
    }
  })

  it('IN-005: raw DATABASE_URL value is not present in response body', async () => {
    const databaseUrl = process.env.DATABASE_URL ?? ''
    if (!databaseUrl) return
    const res = await fetch(`${BASE}/instances`)
    const text = await res.text()
    const credentialPart = databaseUrl.match(/:\/\/([^@]+)@/)
    if (credentialPart) {
      expect(text).not.toContain(credentialPart[1])
    }
  })

  it('IN-006: API key values are not present in response body', async () => {
    const anthropicKey = process.env.ANTHROPIC_API_KEY ?? ''
    const openaiKey    = process.env.OPENAI_API_KEY    ?? ''
    const res = await fetch(`${BASE}/instances`)
    const text = await res.text()
    if (anthropicKey.length > 10) expect(text).not.toContain(anthropicKey)
    if (openaiKey.length > 10)    expect(text).not.toContain(openaiKey)
  })

  it('IN-010: always returns HTTP 200 even when instances array is empty', async () => {
    const { status } = await get('/instances')
    expect(status).toBe(200)
  })

  it('IN-013: projects is empty array in Phase 1', async () => {
    const { body } = await get('/instances')
    const instances = (body as Record<string, unknown>).instances as Record<string, unknown>[]
    for (const instance of instances) {
      expect(instance.projects).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------
// GROUP 5b: GET /instances/:instanceId/projects
// ---------------------------------------------------------------------------

describe('GET /instances/:instanceId/projects', () => {
  it('PR-001: returns 200 with Phase 1 stub shape for any instanceId', async () => {
    const { status, body } = await get('/instances/any-instance-id/projects')
    expect(status).toBe(200)
    const b = body as Record<string, unknown>
    expect(b).toHaveProperty('instanceId')
    expect(b.instanceId).toBe('any-instance-id')
    expect(b.projects).toEqual([])
    expect(b.projectBindingsUnavailable).toBe(true)
  })

  it('PR-002: stub note field is present and non-empty', async () => {
    const { body } = await get('/instances/test-id/projects')
    const b = body as Record<string, unknown>
    expect(typeof b.note).toBe('string')
    expect((b.note as string).length).toBeGreaterThan(0)
  })
})
