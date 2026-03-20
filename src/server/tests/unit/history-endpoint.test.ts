/**
 * Unit tests for temporal history endpoint helpers — CP-T030
 *
 * These tests exercise the archivedReason label mapping and the hasHistory
 * response flag logic in isolation, without requiring a database connection.
 */

import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Mirror of the labelArchivedReason helper from kb.ts.
// If the helper is ever exported, replace this with a direct import.
// ---------------------------------------------------------------------------

const ARCHIVED_REASON_LABELS: Record<string, string> = {
  superseded: 'Superseded by newer write',
  contradicted: 'Contradicted by conflicting source',
  expired: 'Expired (validUntil passed)',
  decayed: 'Decayed by Archivist',
}

function labelArchivedReason(raw: string | null): string | null {
  if (raw == null) return null
  return ARCHIVED_REASON_LABELS[raw] ?? `${raw} (unknown reason)`
}

// ---------------------------------------------------------------------------
// Tests: archivedReason label mapping
// ---------------------------------------------------------------------------

describe('labelArchivedReason', () => {
  it('maps "superseded" to the human-readable label', () => {
    expect(labelArchivedReason('superseded')).toBe('Superseded by newer write')
  })

  it('maps "contradicted" to the human-readable label', () => {
    expect(labelArchivedReason('contradicted')).toBe('Contradicted by conflicting source')
  })

  it('maps "expired" to the human-readable label', () => {
    expect(labelArchivedReason('expired')).toBe('Expired (validUntil passed)')
  })

  it('maps "decayed" to the human-readable label', () => {
    expect(labelArchivedReason('decayed')).toBe('Decayed by Archivist')
  })

  it('returns null for null input (no archived reason)', () => {
    expect(labelArchivedReason(null)).toBeNull()
  })

  it('falls back to raw code with "(unknown reason)" suffix for unrecognised codes', () => {
    expect(labelArchivedReason('pruned')).toBe('pruned (unknown reason)')
  })

  it('falls back gracefully for an empty string', () => {
    expect(labelArchivedReason('')).toBe(' (unknown reason)')
  })

  it('does not return a bare raw enum code for any known code', () => {
    const rawCodes = ['superseded', 'contradicted', 'expired', 'decayed']
    for (const code of rawCodes) {
      const result = labelArchivedReason(code)
      expect(result).not.toBe(code)
      expect(result).not.toBeNull()
      // Label must be a full sentence, not a one-word raw code
      expect((result as string).split(' ').length).toBeGreaterThan(1)
    }
  })
})

// ---------------------------------------------------------------------------
// Tests: hasHistory response flag logic
// ---------------------------------------------------------------------------

describe('hasHistory flag', () => {
  /**
   * Simulate the response construction logic from the history endpoint.
   * history.length > 0 must equal hasHistory.
   */
  function buildHistoryResponse(archiveRowCount: number) {
    const history = Array.from({ length: archiveRowCount }, (_, i) => ({ id: String(i) }))
    return {
      history,
      hasHistory: history.length > 0,
    }
  }

  it('hasHistory is false when archive returns 0 rows', () => {
    const resp = buildHistoryResponse(0)
    expect(resp.hasHistory).toBe(false)
    expect(resp.history).toEqual([])
  })

  it('hasHistory is true when archive returns 1 row', () => {
    const resp = buildHistoryResponse(1)
    expect(resp.hasHistory).toBe(true)
    expect(resp.history).toHaveLength(1)
  })

  it('hasHistory is true when archive returns multiple rows', () => {
    const resp = buildHistoryResponse(5)
    expect(resp.hasHistory).toBe(true)
    expect(resp.history).toHaveLength(5)
  })

  it('hasHistory is always consistent with history array length', () => {
    for (const n of [0, 1, 2, 10, 50]) {
      const resp = buildHistoryResponse(n)
      expect(resp.hasHistory).toBe(resp.history.length > 0)
    }
  })
})

// ---------------------------------------------------------------------------
// Tests: archive JOIN result shape
// ---------------------------------------------------------------------------

describe('archive interval serialization shape', () => {
  /**
   * Simulate what the history endpoint serializes from an archive DB row.
   * Verifies all required CP-T030 fields are present in the output.
   */
  function serializeArchiveInterval(row: Record<string, unknown>) {
    return {
      id: String(row.id),
      source: 'archive' as const,
      valueSummary: (row.valueSummary as string | null) ?? null,
      valueRaw: row.valueRaw != null ? String(row.valueRaw) : null,
      confidence: Number(row.confidence ?? 0),
      agentId: (row.agentId as string | null) ?? null,
      providerSource: (row.providerSource as string | null) ?? null,
      validFrom: row.validFrom != null ? String(row.validFrom) : null,
      validUntil: row.validUntil != null ? String(row.validUntil) : null,
      archivedAt: row.archivedAt != null ? String(row.archivedAt) : null,
      archivedReason: labelArchivedReason((row.archivedReason as string | null) ?? null),
      supersededBy: (row.supersededBy as string | null) ?? null,
      resolutionState: (row.resolutionState as string | null) ?? null,
      conflictLog: (row.conflictLog as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt != null ? String(row.createdAt) : new Date(0).toISOString(),
    }
  }

  const sampleRow = {
    id: 'abc-123',
    valueSummary: 'old value',
    valueRaw: '"version 1"',
    confidence: 80,
    agentId: 'product_manager',
    providerSource: 'iranti-write',
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2026-03-01T00:00:00.000Z',
    archivedAt: '2026-03-01T00:00:00.000Z',
    archivedReason: 'superseded',
    supersededBy: 'def-456',
    resolutionState: null,
    conflictLog: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  }

  it('serializes all required CP-T030 fields from an archive row', () => {
    const result = serializeArchiveInterval(sampleRow)
    expect(result).toHaveProperty('validFrom')
    expect(result).toHaveProperty('validUntil')
    expect(result).toHaveProperty('archivedReason')
    expect(result).toHaveProperty('supersededBy')
    expect(result).toHaveProperty('conflictLog')
  })

  it('archivedReason is human-readable, not a raw code', () => {
    const result = serializeArchiveInterval(sampleRow)
    expect(result.archivedReason).toBe('Superseded by newer write')
    expect(result.archivedReason).not.toBe('superseded')
  })

  it('supersededBy is the UUID string from the archive row', () => {
    const result = serializeArchiveInterval(sampleRow)
    expect(result.supersededBy).toBe('def-456')
  })

  it('validFrom and validUntil are present and correct', () => {
    const result = serializeArchiveInterval(sampleRow)
    expect(result.validFrom).toBe('2026-01-01T00:00:00.000Z')
    expect(result.validUntil).toBe('2026-03-01T00:00:00.000Z')
  })

  it('handles null supersededBy gracefully', () => {
    const result = serializeArchiveInterval({ ...sampleRow, supersededBy: null })
    expect(result.supersededBy).toBeNull()
  })

  it('handles null archivedReason gracefully', () => {
    const result = serializeArchiveInterval({ ...sampleRow, archivedReason: null })
    expect(result.archivedReason).toBeNull()
  })

  it('source discriminator is always "archive"', () => {
    const result = serializeArchiveInterval(sampleRow)
    expect(result.source).toBe('archive')
  })
})
