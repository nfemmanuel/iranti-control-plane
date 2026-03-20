import { describe, it, expect } from 'vitest'
import { snakeToCamel } from '../../types.js'

describe('snakeToCamel', () => {
  it('converts simple snake_case keys', () => {
    expect(snakeToCamel({ entity_type: 'agent', entity_id: '1' }))
      .toEqual({ entityType: 'agent', entityId: '1' })
  })

  it('converts Date values to ISO strings', () => {
    const d = new Date('2024-01-01T00:00:00Z')
    expect(snakeToCamel({ created_at: d })).toEqual({ createdAt: '2024-01-01T00:00:00.000Z' })
  })

  it('preserves non-snake keys unchanged', () => {
    expect(snakeToCamel({ id: '1', key: 'foo' })).toEqual({ id: '1', key: 'foo' })
  })

  it('handles null values', () => {
    expect(snakeToCamel({ valid_from: null })).toEqual({ validFrom: null })
  })

  it('handles undefined values', () => {
    expect(snakeToCamel({ valid_until: undefined })).toEqual({ validUntil: undefined })
  })

  it('converts multi-segment snake_case keys', () => {
    expect(snakeToCamel({ value_raw_truncated: true })).toEqual({ valueRawTruncated: true })
  })

  it('converts agent_id to agentId', () => {
    expect(snakeToCamel({ agent_id: 'product_manager' })).toEqual({ agentId: 'product_manager' })
  })

  it('does not double-convert already-camelCase keys', () => {
    // A key that has no underscores passes through unchanged
    expect(snakeToCamel({ entityType: 'ticket' })).toEqual({ entityType: 'ticket' })
  })

  it('handles empty object', () => {
    expect(snakeToCamel({})).toEqual({})
  })

  it('handles numeric values', () => {
    expect(snakeToCamel({ confidence: 95 })).toEqual({ confidence: 95 })
  })

  it('handles object values (does not recurse)', () => {
    const nested = { a: 1 }
    const result = snakeToCamel({ conflict_log: nested })
    expect(result.conflictLog).toBe(nested)
  })

  it('converts archived_at Date to ISO string', () => {
    const d = new Date('2026-01-15T12:00:00Z')
    const result = snakeToCamel({ archived_at: d })
    expect(result.archivedAt).toBe('2026-01-15T12:00:00.000Z')
  })

  it('handles multiple fields in one object', () => {
    const input = {
      entity_type: 'ticket',
      entity_id: 'cp_t001',
      agent_id: 'product_manager',
      created_at: new Date('2026-03-20T00:00:00Z'),
      valid_from: null,
      confidence: 90,
    }
    const result = snakeToCamel(input)
    expect(result).toEqual({
      entityType: 'ticket',
      entityId: 'cp_t001',
      agentId: 'product_manager',
      createdAt: '2026-03-20T00:00:00.000Z',
      validFrom: null,
      confidence: 90,
    })
  })
})
