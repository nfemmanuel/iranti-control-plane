/**
 * Unit tests for overview.ts and metrics.ts fallback paths.
 *
 * Tests the fetchKBSummary() fallback logic (falls back to knowledge_base when
 * staff_events is absent or returns zero) and fetchKnowledgeBaseSummaryFallback()
 * row parsing behaviour. Uses vi.mock to control the query() singleton.
 *
 * fetchKBSummary() flow:
 *   1. Check if staff_events table exists — if not, call fallbackFromKnowledgeBase(truncated=true)
 *   2. Query staff_events — if totalFacts == 0, call fallbackFromKnowledgeBase(truncated=true)
 *   3. If staff_events query throws, call fallbackFromKnowledgeBase(truncated=true)
 *   4. If knowledge_base query also throws, return zeroed-out result with truncated=true
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock db.js before importing any module that uses it.
vi.mock('../../db.js', () => ({
  env: {},
  pool: { on: () => {} },
  query: vi.fn(),
}))

import { fetchKBSummary } from '../../routes/control-plane/overview.js'
import { fetchKnowledgeBaseSummaryFallback } from '../../routes/control-plane/metrics.js'
import { query } from '../../db.js'

const mockQuery = query as ReturnType<typeof vi.fn>

function makeQueryResult(rows: Record<string, unknown>[]) {
  return { rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] }
}

// ---------------------------------------------------------------------------
// fetchKBSummary — staff_events table absent
// ---------------------------------------------------------------------------

describe('fetchKBSummary — staff_events table absent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to knowledge_base when staff_events does not exist', async () => {
    // First call: table exists check → not found
    mockQuery.mockResolvedValueOnce(makeQueryResult([{ exists: false }]))
    // Second call: knowledge_base fallback
    mockQuery.mockResolvedValueOnce(makeQueryResult([{
      total_facts: '42',
      facts_last_24h: '5',
      active_agents_last_7d: '3',
    }]))

    const result = await fetchKBSummary()
    expect(result.totalFacts).toBe(42)
    expect(result.factsLast24h).toBe(5)
    expect(result.activeAgentsLast7d).toBe(3)
    expect(result.truncated).toBe(true)
  })

  it('sets truncated=true when falling back', async () => {
    mockQuery.mockResolvedValueOnce(makeQueryResult([{ exists: false }]))
    mockQuery.mockResolvedValueOnce(makeQueryResult([{
      total_facts: '10',
      facts_last_24h: '2',
      active_agents_last_7d: '1',
    }]))

    const result = await fetchKBSummary()
    expect(result.truncated).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// fetchKBSummary — staff_events returns zero facts
// ---------------------------------------------------------------------------

describe('fetchKBSummary — staff_events returns zero effective facts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to knowledge_base when writes - archived = 0', async () => {
    // Table exists check → true
    mockQuery.mockResolvedValueOnce(makeQueryResult([{ exists: true }]))
    // staff_events count query → zero net facts
    mockQuery.mockResolvedValueOnce(makeQueryResult([{
      total_writes_all_time: '10',
      total_archived_all_time: '10', // writes == archived → totalFacts = 0
      facts_last_24h: '0',
      active_agents_last_7d: '0',
    }]))
    // knowledge_base fallback
    mockQuery.mockResolvedValueOnce(makeQueryResult([{
      total_facts: '20',
      facts_last_24h: '3',
      active_agents_last_7d: '2',
    }]))

    const result = await fetchKBSummary()
    expect(result.totalFacts).toBe(20)
    expect(result.truncated).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// fetchKBSummary — staff_events query throws
// ---------------------------------------------------------------------------

describe('fetchKBSummary — staff_events query throws', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to knowledge_base when staff_events query throws', async () => {
    // Table exists check → true
    mockQuery.mockResolvedValueOnce(makeQueryResult([{ exists: true }]))
    // staff_events query → throws
    mockQuery.mockRejectedValueOnce(new Error('relation "staff_events" does not exist'))
    // knowledge_base fallback
    mockQuery.mockResolvedValueOnce(makeQueryResult([{
      total_facts: '15',
      facts_last_24h: '1',
      active_agents_last_7d: '0',
    }]))

    const result = await fetchKBSummary()
    expect(result.totalFacts).toBe(15)
    expect(result.truncated).toBe(true)
  })

  it('returns all-zero with truncated=true when knowledge_base also throws', async () => {
    mockQuery.mockResolvedValueOnce(makeQueryResult([{ exists: false }]))
    mockQuery.mockRejectedValueOnce(new Error('knowledge_base missing'))

    const result = await fetchKBSummary()
    expect(result.totalFacts).toBe(0)
    expect(result.factsLast24h).toBe(0)
    expect(result.activeAgentsLast7d).toBe(0)
    expect(result.truncated).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// fetchKBSummary — staff_events has positive facts
// ---------------------------------------------------------------------------

describe('fetchKBSummary — staff_events has real data', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns facts from staff_events when net facts > 0', async () => {
    // Table exists → true
    mockQuery.mockResolvedValueOnce(makeQueryResult([{ exists: true }]))
    // staff_events → 50 writes, 10 archived = 40 net
    mockQuery.mockResolvedValueOnce(makeQueryResult([{
      total_writes_all_time: '50',
      total_archived_all_time: '10',
      facts_last_24h: '8',
      active_agents_last_7d: '4',
    }]))

    const result = await fetchKBSummary()
    expect(result.totalFacts).toBe(40)
    expect(result.factsLast24h).toBe(8)
    expect(result.activeAgentsLast7d).toBe(4)
    expect(result.truncated).toBe(false)
  })

  it('never returns negative totalFacts (archived > writes is clamped to 0)', async () => {
    mockQuery.mockResolvedValueOnce(makeQueryResult([{ exists: true }]))
    // archived > writes (data integrity issue; should not crash)
    mockQuery.mockResolvedValueOnce(makeQueryResult([{
      total_writes_all_time: '5',
      total_archived_all_time: '20', // more archived than written
      facts_last_24h: '0',
      active_agents_last_7d: '0',
    }]))
    // Falls back to knowledge_base (totalFacts = 0)
    mockQuery.mockResolvedValueOnce(makeQueryResult([{
      total_facts: '0',
      facts_last_24h: '0',
      active_agents_last_7d: '0',
    }]))

    const result = await fetchKBSummary()
    expect(result.totalFacts).toBeGreaterThanOrEqual(0)
  })
})

// ---------------------------------------------------------------------------
// fetchKnowledgeBaseSummaryFallback — row parsing
// ---------------------------------------------------------------------------

describe('fetchKnowledgeBaseSummaryFallback — row parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses a normal row correctly', async () => {
    mockQuery.mockResolvedValueOnce(makeQueryResult([{
      total_facts: '100',
      facts_last_24h: '12',
      active_agents_last_7d: '7',
    }]))

    const result = await fetchKnowledgeBaseSummaryFallback()
    expect(result.totalFacts).toBe(100)
    expect(result.factsLast24h).toBe(12)
    expect(result.activeAgentsLast7d).toBe(7)
  })

  it('handles null row values by defaulting to 0', async () => {
    mockQuery.mockResolvedValueOnce(makeQueryResult([{
      total_facts: null,
      facts_last_24h: null,
      active_agents_last_7d: null,
    }]))

    const result = await fetchKnowledgeBaseSummaryFallback()
    expect(result.totalFacts).toBe(0)
    expect(result.factsLast24h).toBe(0)
    expect(result.activeAgentsLast7d).toBe(0)
  })

  it('handles undefined row (empty rows array) by defaulting to 0', async () => {
    mockQuery.mockResolvedValueOnce(makeQueryResult([]))

    const result = await fetchKnowledgeBaseSummaryFallback()
    expect(result.totalFacts).toBe(0)
  })
})
