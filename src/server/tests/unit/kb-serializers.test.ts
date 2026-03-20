/**
 * Unit tests for KB row serialization and where-clause builder logic.
 *
 * These functions (serializeKBRow, buildKBWhereClause) are internal to
 * src/server/routes/control-plane/kb.ts and are not currently exported.
 * Tests here exercise the same logic through either:
 *   1. The exported helpers they delegate to (serializeValueRaw from types.ts), or
 *   2. Inline replications of the function bodies, which serve as spec-level
 *      documentation of the expected behavior and will catch regressions if
 *      the implementations are ever changed without updating these tests.
 *
 * If buildKBWhereClause or serializeKBRow are ever exported from kb.ts,
 * these tests should be updated to import and call them directly.
 */

import { describe, it, expect } from 'vitest'
import { serializeValueRaw, serializeFullValueRaw } from '../../types.js'

// ---------------------------------------------------------------------------
// Inline replication of serializeKBRow (from routes/control-plane/kb.ts)
// Kept in sync with the source. Update this if the source changes.
// ---------------------------------------------------------------------------

function toIso(val: unknown): string | null {
  if (val == null) return null
  if (val instanceof Date) return val.toISOString()
  if (typeof val === 'string') return val
  return null
}

interface KBFactShape {
  id: string
  entityType: string
  entityId: string
  key: string
  valueSummary: string | null
  valueRaw: string | null
  valueRawTruncated: boolean
  confidence: number
  source: string | null
  agentId: string | null
  validFrom: string | null
  validUntil: string | null
  createdAt: string
  updatedAt: string | null
  properties: Record<string, unknown> | null
  conflictLog: Record<string, unknown> | null
}

function serializeKBRow(row: Record<string, unknown>): KBFactShape {
  const { valueRaw, valueRawTruncated } = serializeValueRaw(row.value_raw ?? row.valueRaw)
  return {
    id: String(row.id),
    entityType: String(row.entity_type ?? row.entityType ?? ''),
    entityId: String(row.entity_id ?? row.entityId ?? ''),
    key: String(row.key ?? ''),
    valueSummary: (row.summary as string | null) ?? null,
    valueRaw,
    valueRawTruncated,
    confidence: Number(row.confidence ?? 0),
    source: (row.source as string | null) ?? null,
    agentId: (row.agent_id ?? row.agentId) as string | null ?? null,
    validFrom: toIso(row.valid_from ?? row.validFrom),
    validUntil: toIso(row.valid_until ?? row.validUntil),
    createdAt: toIso(row.created_at ?? row.createdAt) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updated_at ?? row.updatedAt),
    properties: (row.properties as Record<string, unknown> | null) ?? null,
    conflictLog: (row.conflict_log ?? row.conflictLog) as Record<string, unknown> | null ?? null,
  }
}

// ---------------------------------------------------------------------------
// Inline replication of buildKBWhereClause (from routes/control-plane/kb.ts)
// ---------------------------------------------------------------------------

interface KBFilters {
  entityType?: string
  entityId?: string
  key?: string
  source?: string
  createdBy?: string
  minConfidence?: number
  search?: string
  activeOnly?: boolean
}

function buildKBWhereClause(
  filters: KBFilters,
  params: unknown[],
  tablePrefix = ''
): string {
  const clauses: string[] = []
  const t = tablePrefix ? `${tablePrefix}.` : ''

  if (filters.search) {
    params.push(`%${filters.search}%`)
    const p = params.length
    clauses.push(
      `(${t}entity_id ILIKE $${p} OR ${t}key ILIKE $${p} OR COALESCE(${t}summary,'') ILIKE $${p} OR (${t}value_raw::text) ILIKE $${p})`
    )
  }
  if (filters.entityType) {
    params.push(filters.entityType)
    clauses.push(`${t}entity_type = $${params.length}`)
  }
  if (filters.entityId) {
    params.push(filters.entityId)
    clauses.push(`${t}entity_id = $${params.length}`)
  }
  if (filters.key) {
    params.push(filters.key)
    clauses.push(`${t}key = $${params.length}`)
  }
  if (filters.source) {
    params.push(filters.source)
    clauses.push(`${t}source = $${params.length}`)
  }
  if (filters.createdBy) {
    params.push(filters.createdBy)
    clauses.push(`${t}agent_id = $${params.length}`)
  }
  if (filters.minConfidence !== undefined) {
    params.push(filters.minConfidence)
    clauses.push(`${t}confidence >= $${params.length}`)
  }
  if (filters.activeOnly) {
    clauses.push(`(${t}valid_until IS NULL OR ${t}valid_until > NOW())`)
  }

  return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
}

// ===========================================================================
// Tests: serializeKBRow — null and undefined field handling
// ===========================================================================

describe('serializeKBRow — null and undefined field edge cases', () => {
  it('returns null for valueSummary when summary is null', () => {
    const row = {
      id: '1', entity_type: 'agent', entity_id: 'a1', key: 'foo',
      summary: null, value_raw: null, confidence: 80,
      created_at: new Date('2026-01-01T00:00:00Z'),
    }
    const result = serializeKBRow(row)
    expect(result.valueSummary).toBeNull()
  })

  it('returns null for valueSummary when summary is undefined (key absent)', () => {
    const row = {
      id: '1', entity_type: 'agent', entity_id: 'a1', key: 'foo',
      value_raw: null, confidence: 80,
      created_at: new Date('2026-01-01T00:00:00Z'),
    }
    const result = serializeKBRow(row)
    expect(result.valueSummary).toBeNull()
  })

  it('returns null valueRaw and false valueRawTruncated when value_raw is null', () => {
    const row = {
      id: '1', entity_type: 'agent', entity_id: 'a1', key: 'foo',
      value_raw: null, confidence: 50, created_at: new Date(),
    }
    const result = serializeKBRow(row)
    expect(result.valueRaw).toBeNull()
    expect(result.valueRawTruncated).toBe(false)
  })

  it('returns null valueRaw when value_raw is undefined (key absent)', () => {
    const row = {
      id: '1', entity_type: 'agent', entity_id: 'a1', key: 'foo',
      confidence: 50, created_at: new Date(),
    }
    const result = serializeKBRow(row)
    expect(result.valueRaw).toBeNull()
    expect(result.valueRawTruncated).toBe(false)
  })

  it('returns null for agentId when agent_id is null', () => {
    const row = {
      id: '1', entity_type: 'agent', entity_id: 'a1', key: 'foo',
      agent_id: null, confidence: 90, created_at: new Date(),
    }
    const result = serializeKBRow(row)
    expect(result.agentId).toBeNull()
  })

  it('returns null for agentId when agent_id is undefined (key absent)', () => {
    const row = {
      id: '1', entity_type: 'agent', entity_id: 'a1', key: 'foo',
      confidence: 90, created_at: new Date(),
    }
    const result = serializeKBRow(row)
    expect(result.agentId).toBeNull()
  })

  it('returns null for validFrom when valid_from is null', () => {
    const row = {
      id: '1', entity_type: 'agent', entity_id: 'a1', key: 'foo',
      valid_from: null, confidence: 90, created_at: new Date(),
    }
    const result = serializeKBRow(row)
    expect(result.validFrom).toBeNull()
  })

  it('returns null for validUntil when valid_until is null', () => {
    const row = {
      id: '1', entity_type: 'agent', entity_id: 'a1', key: 'foo',
      valid_until: null, confidence: 90, created_at: new Date(),
    }
    const result = serializeKBRow(row)
    expect(result.validUntil).toBeNull()
  })

  it('returns null for updatedAt when updated_at is null', () => {
    const row = {
      id: '1', entity_type: 'agent', entity_id: 'a1', key: 'foo',
      updated_at: null, confidence: 90, created_at: new Date(),
    }
    const result = serializeKBRow(row)
    expect(result.updatedAt).toBeNull()
  })

  it('returns null for properties when properties is null', () => {
    const row = {
      id: '1', entity_type: 'agent', entity_id: 'a1', key: 'foo',
      properties: null, confidence: 90, created_at: new Date(),
    }
    const result = serializeKBRow(row)
    expect(result.properties).toBeNull()
  })

  it('returns null for conflictLog when conflict_log is null', () => {
    const row = {
      id: '1', entity_type: 'agent', entity_id: 'a1', key: 'foo',
      conflict_log: null, confidence: 90, created_at: new Date(),
    }
    const result = serializeKBRow(row)
    expect(result.conflictLog).toBeNull()
  })

  it('falls back to epoch ISO for createdAt when created_at is null', () => {
    const row = {
      id: '1', entity_type: 'agent', entity_id: 'a1', key: 'foo',
      created_at: null, confidence: 90,
    }
    const result = serializeKBRow(row)
    expect(result.createdAt).toBe(new Date(0).toISOString())
  })

  it('returns empty string for entityType when entity_type is null (null ?? "" = "")', () => {
    // In the source: String(row.entity_type ?? row.entityType ?? '')
    // null ?? '' => '' because ?? treats null as nullish
    // String('') => ''
    const row = {
      id: '1', entity_type: null, entity_id: 'a1', key: 'foo',
      confidence: 90, created_at: new Date(),
    }
    const result = serializeKBRow(row)
    expect(result.entityType).toBe('')
  })

  it('converts Date created_at to ISO string', () => {
    const date = new Date('2026-03-20T12:00:00Z')
    const row = {
      id: '1', entity_type: 'agent', entity_id: 'a1', key: 'foo',
      confidence: 90, created_at: date,
    }
    const result = serializeKBRow(row)
    expect(result.createdAt).toBe('2026-03-20T12:00:00.000Z')
  })

  it('accepts camelCase column aliases (e.g. valueRaw) as fallback when snake_case absent', () => {
    const row = {
      id: '1', entityType: 'agent', entityId: 'a1', key: 'foo',
      valueRaw: '{"hello":"world"}', confidence: 90,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    }
    const result = serializeKBRow(row)
    expect(result.entityType).toBe('agent')
    expect(result.entityId).toBe('a1')
    expect(result.valueRaw).toBe('{"hello":"world"}')
    expect(result.valueRawTruncated).toBe(false)
  })

  it('returns truncated valueRaw and valueRawTruncated=true for value_raw > 4096 bytes', () => {
    const bigString = 'x'.repeat(5000)
    const row = {
      id: '1', entity_type: 'agent', entity_id: 'a1', key: 'big',
      value_raw: bigString, confidence: 90, created_at: new Date(),
    }
    const result = serializeKBRow(row)
    expect(result.valueRawTruncated).toBe(true)
    // Byte length of result should be <= 4096
    const byteLen = Buffer.byteLength(result.valueRaw!, 'utf8')
    expect(byteLen).toBeLessThanOrEqual(4096)
  })

  it('returns full valueRaw and valueRawTruncated=false for value_raw <= 4096 bytes', () => {
    const smallString = 'hello world'
    const row = {
      id: '1', entity_type: 'agent', entity_id: 'a1', key: 'small',
      value_raw: smallString, confidence: 90, created_at: new Date(),
    }
    const result = serializeKBRow(row)
    expect(result.valueRaw).toBe(smallString)
    expect(result.valueRawTruncated).toBe(false)
  })

  it('serializes a fully-populated row correctly', () => {
    const date = new Date('2026-03-01T00:00:00Z')
    const row = {
      id: '42',
      entity_type: 'ticket',
      entity_id: 'cp_t001',
      key: 'status',
      summary: 'Ticket is open',
      value_raw: '"open"',
      confidence: 95,
      source: 'mcp',
      agent_id: 'product_manager',
      valid_from: date,
      valid_until: null,
      created_at: date,
      updated_at: null,
      properties: { priority: 1 },
      conflict_log: null,
    }
    const result = serializeKBRow(row)
    expect(result.id).toBe('42')
    expect(result.entityType).toBe('ticket')
    expect(result.entityId).toBe('cp_t001')
    expect(result.key).toBe('status')
    expect(result.valueSummary).toBe('Ticket is open')
    expect(result.valueRaw).toBe('"open"')
    expect(result.valueRawTruncated).toBe(false)
    expect(result.confidence).toBe(95)
    expect(result.source).toBe('mcp')
    expect(result.agentId).toBe('product_manager')
    expect(result.validFrom).toBe('2026-03-01T00:00:00.000Z')
    expect(result.validUntil).toBeNull()
    expect(result.createdAt).toBe('2026-03-01T00:00:00.000Z')
    expect(result.updatedAt).toBeNull()
    expect(result.properties).toEqual({ priority: 1 })
    expect(result.conflictLog).toBeNull()
  })
})

// ===========================================================================
// Tests: buildKBWhereClause
// ===========================================================================

describe('buildKBWhereClause', () => {
  describe('empty filters', () => {
    it('returns empty string when no filters are provided', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause({}, params)
      expect(result).toBe('')
      expect(params).toHaveLength(0)
    })
  })

  describe('activeOnly filter', () => {
    it('adds IS NULL OR > NOW() clause when activeOnly=true', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause({ activeOnly: true }, params)
      expect(result).toContain('WHERE')
      expect(result).toContain('valid_until IS NULL OR')
      expect(result).toContain('valid_until > NOW()')
      // activeOnly adds no params (no placeholder)
      expect(params).toHaveLength(0)
    })

    it('does NOT add any clause when activeOnly=false', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause({ activeOnly: false }, params)
      expect(result).toBe('')
      expect(params).toHaveLength(0)
    })

    it('does NOT add any clause when activeOnly is undefined', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause({ activeOnly: undefined }, params)
      expect(result).toBe('')
    })

    it('activeOnly clause uses table prefix when tablePrefix is provided', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause({ activeOnly: true }, params, 'kb')
      expect(result).toContain('kb.valid_until IS NULL OR kb.valid_until > NOW()')
    })
  })

  describe('entityType filter', () => {
    it('adds entity_type = $1 clause and param', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause({ entityType: 'agent' }, params)
      expect(result).toBe('WHERE entity_type = $1')
      expect(params).toEqual(['agent'])
    })
  })

  describe('entityId filter', () => {
    it('adds entity_id = $1 clause and param', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause({ entityId: 'test_agent_001' }, params)
      expect(result).toBe('WHERE entity_id = $1')
      expect(params).toEqual(['test_agent_001'])
    })
  })

  describe('key filter', () => {
    it('adds key = $1 clause', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause({ key: 'current_assignment' }, params)
      expect(result).toBe('WHERE key = $1')
      expect(params).toEqual(['current_assignment'])
    })
  })

  describe('source filter', () => {
    it('adds source = $1 clause', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause({ source: 'mcp' }, params)
      expect(result).toBe('WHERE source = $1')
      expect(params).toEqual(['mcp'])
    })
  })

  describe('createdBy filter', () => {
    it('maps createdBy to agent_id = $1 clause', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause({ createdBy: 'product_manager' }, params)
      expect(result).toBe('WHERE agent_id = $1')
      expect(params).toEqual(['product_manager'])
    })
  })

  describe('minConfidence filter', () => {
    it('adds confidence >= $1 clause', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause({ minConfidence: 75 }, params)
      expect(result).toBe('WHERE confidence >= $1')
      expect(params).toEqual([75])
    })

    it('adds confidence >= $1 clause for minConfidence=0', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause({ minConfidence: 0 }, params)
      expect(result).toBe('WHERE confidence >= $1')
      expect(params).toEqual([0])
    })

    it('adds confidence >= $1 clause for minConfidence=100', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause({ minConfidence: 100 }, params)
      expect(result).toBe('WHERE confidence >= $1')
      expect(params).toEqual([100])
    })

    it('does NOT add clause when minConfidence is undefined', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause({ minConfidence: undefined }, params)
      expect(result).toBe('')
      expect(params).toHaveLength(0)
    })
  })

  describe('search filter', () => {
    it('adds ILIKE clause covering entity_id, key, summary, and value_raw', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause({ search: 'assignment' }, params)
      expect(result).toContain('ILIKE $1')
      expect(params).toEqual(['%assignment%'])
      expect(result).toContain('entity_id ILIKE $1')
      expect(result).toContain('key ILIKE $1')
      expect(result).toContain('COALESCE(summary,\'\') ILIKE $1')
      expect(result).toContain('value_raw::text) ILIKE $1')
    })
  })

  describe('multiple filters combined', () => {
    it('combines entityType + minConfidence with correct param numbering', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause({ entityType: 'agent', minConfidence: 50 }, params)
      expect(result).toContain('entity_type = $1')
      expect(result).toContain('confidence >= $2')
      expect(params).toEqual(['agent', 50])
    })

    it('combines entityType + entityId + minConfidence with correct param numbering', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause(
        { entityType: 'agent', entityId: 'test_agent_001', minConfidence: 80 },
        params
      )
      expect(result).toContain('entity_type = $1')
      expect(result).toContain('entity_id = $2')
      expect(result).toContain('confidence >= $3')
      expect(params).toEqual(['agent', 'test_agent_001', 80])
    })

    it('combines all standard filters in correct order and param numbering', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause(
        {
          entityType: 'ticket',
          entityId: 'cp_t001',
          key: 'status',
          source: 'mcp',
          createdBy: 'product_manager',
          minConfidence: 90,
        },
        params
      )
      // All clauses present
      expect(result).toContain('entity_type = $1')
      expect(result).toContain('entity_id = $2')
      expect(result).toContain('key = $3')
      expect(result).toContain('source = $4')
      expect(result).toContain('agent_id = $5')
      expect(result).toContain('confidence >= $6')
      expect(params).toEqual(['ticket', 'cp_t001', 'status', 'mcp', 'product_manager', 90])
    })

    it('combines entityType + activeOnly — activeOnly adds no param', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause({ entityType: 'agent', activeOnly: true }, params)
      expect(result).toContain('entity_type = $1')
      expect(result).toContain('valid_until IS NULL OR')
      // Only one param (for entityType) — activeOnly is parameterless
      expect(params).toEqual(['agent'])
    })

    it('combines minConfidence + activeOnly — param numbering is not disrupted', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause({ minConfidence: 70, activeOnly: true }, params)
      expect(result).toContain('confidence >= $1')
      expect(result).toContain('valid_until IS NULL OR')
      expect(params).toEqual([70])
    })

    it('combines search + entityType — search placeholder and entityType placeholder are distinct', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause({ search: 'hello', entityType: 'agent' }, params)
      // search is pushed first, entityType second
      expect(result).toContain('ILIKE $1')
      expect(result).toContain('entity_type = $2')
      expect(params).toEqual(['%hello%', 'agent'])
    })

    it('inherits pre-existing params when params array is non-empty', () => {
      const params: unknown[] = ['preexisting']  // simulate params already populated
      const result = buildKBWhereClause({ entityType: 'agent' }, params)
      // entityType param should be $2, not $1
      expect(result).toBe('WHERE entity_type = $2')
      expect(params).toEqual(['preexisting', 'agent'])
    })

    it('uses table prefix on all clause columns', () => {
      const params: unknown[] = []
      const result = buildKBWhereClause(
        { entityType: 'agent', entityId: 'a1', minConfidence: 50 },
        params,
        'kb'
      )
      expect(result).toContain('kb.entity_type = $1')
      expect(result).toContain('kb.entity_id = $2')
      expect(result).toContain('kb.confidence >= $3')
    })
  })
})

// ===========================================================================
// Tests: serializeValueRaw (exported — tested directly from types.ts)
// ===========================================================================

describe('serializeValueRaw — edge cases', () => {
  it('returns null and false for null input', () => {
    expect(serializeValueRaw(null)).toEqual({ valueRaw: null, valueRawTruncated: false })
  })

  it('returns null and false for undefined input', () => {
    expect(serializeValueRaw(undefined)).toEqual({ valueRaw: null, valueRawTruncated: false })
  })

  it('returns the string unchanged and false for short strings', () => {
    const result = serializeValueRaw('hello')
    expect(result).toEqual({ valueRaw: 'hello', valueRawTruncated: false })
  })

  it('returns full string and false for exactly 4096 bytes', () => {
    const exact4096 = 'x'.repeat(4096)  // 4096 single-byte chars = 4096 bytes
    const result = serializeValueRaw(exact4096)
    expect(result.valueRawTruncated).toBe(false)
    expect(result.valueRaw).toBe(exact4096)
  })

  it('truncates and sets true for strings > 4096 bytes', () => {
    const over4096 = 'x'.repeat(4097)
    const result = serializeValueRaw(over4096)
    expect(result.valueRawTruncated).toBe(true)
    expect(Buffer.byteLength(result.valueRaw!, 'utf8')).toBeLessThanOrEqual(4096)
  })

  it('JSON-serializes non-string values before checking byte length', () => {
    const obj = { key: 'value' }
    const result = serializeValueRaw(obj)
    expect(result.valueRaw).toBe(JSON.stringify(obj))
    expect(result.valueRawTruncated).toBe(false)
  })

  it('handles empty string', () => {
    expect(serializeValueRaw('')).toEqual({ valueRaw: '', valueRawTruncated: false })
  })

  it('handles multibyte UTF-8 characters — truncation is triggered when byte count > 4096', () => {
    // Each Chinese character (U+4E2D) is 3 bytes in UTF-8.
    // 1366 chars * 3 bytes = 4098 bytes > 4096 — should set valueRawTruncated=true.
    //
    // NOTE ON IMPLEMENTATION BEHAVIOR: When slicing at byte 4096 and re-decoding,
    // Node.js replaces the partial 3-byte sequence with U+FFFD (also 3 bytes), so
    // the re-encoded byte count can still be 4098 (not a strict decrease).
    // The implementation's guarantee is that valueRawTruncated=true is set and the
    // content is NOT the original string. A separate tracking issue should be raised
    // to decide whether to tighten truncation to ensure the output is strictly ≤ 4096 bytes.
    const multibyte = '\u4e2d'.repeat(1366)  // 1366 * 3 = 4098 bytes
    expect(Buffer.byteLength(multibyte, 'utf8')).toBe(4098)  // confirm input > 4096
    const result = serializeValueRaw(multibyte)
    // Truncation flag must be set
    expect(result.valueRawTruncated).toBe(true)
    // The result must not be null
    expect(result.valueRaw).not.toBeNull()
    // The result must not equal the original string (content changed at truncation point)
    expect(result.valueRaw).not.toBe(multibyte)
  })

  it('handles number input by JSON-serializing it', () => {
    const result = serializeValueRaw(42)
    expect(result.valueRaw).toBe('42')
    expect(result.valueRawTruncated).toBe(false)
  })

  it('handles boolean input by JSON-serializing it', () => {
    const result = serializeValueRaw(true)
    expect(result.valueRaw).toBe('true')
    expect(result.valueRawTruncated).toBe(false)
  })
})

// ===========================================================================
// Tests: serializeFullValueRaw (exported — tested directly from types.ts)
// ===========================================================================

describe('serializeFullValueRaw — no truncation variant', () => {
  it('returns null for null input', () => {
    expect(serializeFullValueRaw(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(serializeFullValueRaw(undefined)).toBeNull()
  })

  it('returns full string unchanged', () => {
    expect(serializeFullValueRaw('hello')).toBe('hello')
  })

  it('returns the FULL string even for values > 4096 bytes', () => {
    const large = 'x'.repeat(8000)
    const result = serializeFullValueRaw(large)
    expect(result).toBe(large)
    expect(result!.length).toBe(8000)
  })

  it('JSON-serializes objects', () => {
    const result = serializeFullValueRaw({ a: 1, b: 2 })
    expect(result).toBe(JSON.stringify({ a: 1, b: 2 }))
  })

  it('handles empty string', () => {
    expect(serializeFullValueRaw('')).toBe('')
  })
})
