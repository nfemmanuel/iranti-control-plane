/**
 * Unit tests for the agents response normalizer in CP-T051.
 *
 * The normalization logic is inline inside the GET /agents route handler in
 * src/server/routes/control-plane/agents.ts and is not exported.
 * It is replicated here exactly so these tests serve as spec-level
 * documentation and regression guards for the dual-shape contract (bare
 * array OR { agents: [...] } wrapper → { agents, total }).
 *
 * Update the replication if the source normalization logic changes.
 */

import { describe, it, expect } from 'vitest'

// ===========================================================================
// Inline replication of the agents normalization logic
// (from routes/control-plane/agents.ts — GET /agents handler)
// ===========================================================================

function normalizeAgentsResponse(body: unknown): { agents: unknown[]; total: number } {
  let agents: unknown[]
  if (Array.isArray(body)) {
    agents = body
  } else if (
    body !== null &&
    typeof body === 'object' &&
    'agents' in (body as Record<string, unknown>) &&
    Array.isArray((body as Record<string, unknown>).agents)
  ) {
    agents = (body as { agents: unknown[] }).agents
  } else {
    agents = []
  }
  return { agents, total: agents.length }
}

// ===========================================================================
// Tests: normalizeAgentsResponse
// ===========================================================================

describe('normalizeAgentsResponse', () => {
  describe('bare array input', () => {
    it('returns agents array and correct total for a non-empty bare array', () => {
      const input = [{ agentId: 'a' }, { agentId: 'b' }, { agentId: 'c' }]
      const result = normalizeAgentsResponse(input)
      expect(result.agents).toEqual(input)
      expect(result.total).toBe(3)
    })

    it('returns empty agents array and total=0 for an empty bare array', () => {
      const result = normalizeAgentsResponse([])
      expect(result.agents).toEqual([])
      expect(result.total).toBe(0)
    })

    it('returns total=1 for a single-element bare array', () => {
      const result = normalizeAgentsResponse([{ agentId: 'x' }])
      expect(result.total).toBe(1)
    })
  })

  describe('wrapped { agents: [...] } input', () => {
    it('unwraps agents from wrapper object and returns correct total', () => {
      const input = { agents: [{ agentId: 'p' }, { agentId: 'q' }] }
      const result = normalizeAgentsResponse(input)
      expect(result.agents).toEqual(input.agents)
      expect(result.total).toBe(2)
    })

    it('returns empty agents array and total=0 for { agents: [] }', () => {
      const result = normalizeAgentsResponse({ agents: [] })
      expect(result.agents).toEqual([])
      expect(result.total).toBe(0)
    })

    it('returns total=2 for { agents: [{agentId: "a"}, {agentId: "b"}] }', () => {
      const result = normalizeAgentsResponse({ agents: [{ agentId: 'a' }, { agentId: 'b' }] })
      expect(result.total).toBe(2)
    })
  })

  describe('degenerate / unexpected input', () => {
    it('returns empty agents and total=0 for null input', () => {
      const result = normalizeAgentsResponse(null)
      expect(result.agents).toEqual([])
      expect(result.total).toBe(0)
    })

    it('returns empty agents and total=0 for an empty object (no agents key)', () => {
      const result = normalizeAgentsResponse({})
      expect(result.agents).toEqual([])
      expect(result.total).toBe(0)
    })

    it('returns empty agents and total=0 when agents property exists but is not an array', () => {
      const result = normalizeAgentsResponse({ agents: 'not-an-array' })
      expect(result.agents).toEqual([])
      expect(result.total).toBe(0)
    })

    it('returns empty agents and total=0 for a string input', () => {
      const result = normalizeAgentsResponse('unexpected string')
      expect(result.agents).toEqual([])
      expect(result.total).toBe(0)
    })

    it('returns empty agents and total=0 for a number input', () => {
      const result = normalizeAgentsResponse(42)
      expect(result.agents).toEqual([])
      expect(result.total).toBe(0)
    })

    it('returns empty agents and total=0 for a boolean input', () => {
      const result = normalizeAgentsResponse(true)
      expect(result.agents).toEqual([])
      expect(result.total).toBe(0)
    })

    it('returns empty agents and total=0 when agents property is null', () => {
      const result = normalizeAgentsResponse({ agents: null })
      expect(result.agents).toEqual([])
      expect(result.total).toBe(0)
    })

    it('returns empty agents and total=0 when agents property is an object (not an array)', () => {
      const result = normalizeAgentsResponse({ agents: { nested: true } })
      expect(result.agents).toEqual([])
      expect(result.total).toBe(0)
    })
  })

  describe('total matches agents array length', () => {
    it('total always equals agents.length for bare array', () => {
      const items = [{ agentId: '1' }, { agentId: '2' }, { agentId: '3' }, { agentId: '4' }]
      const result = normalizeAgentsResponse(items)
      expect(result.total).toBe(result.agents.length)
      expect(result.total).toBe(4)
    })

    it('total always equals agents.length for wrapped array', () => {
      const items = [{ agentId: 'a' }, { agentId: 'b' }]
      const result = normalizeAgentsResponse({ agents: items })
      expect(result.total).toBe(result.agents.length)
      expect(result.total).toBe(2)
    })
  })
})
