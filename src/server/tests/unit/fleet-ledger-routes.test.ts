import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'net'

vi.mock('../../lib/fleet-ledger-repo.js', () => ({
  queryFleetLedger: vi.fn(),
  getAllWatermarks: vi.fn(),
}))

import { sessionLedgerRouter } from '../../routes/control-plane/session-ledger.js'
import { queryFleetLedger, getAllWatermarks } from '../../lib/fleet-ledger-repo.js'

const mockQueryFleetLedger = queryFleetLedger as ReturnType<typeof vi.fn>
const mockGetAllWatermarks = getAllWatermarks as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    instanceId: 'inst-1',
    remoteEventId: 'evt-001',
    timestamp: '2026-04-02T00:00:00.000Z',
    staffComponent: 'Librarian',
    actionType: 'write_created',
    agentId: 'agent-alpha',
    source: 'mcp',
    host: 'codex',
    sessionId: 'sess-abc',
    entityType: 'ticket',
    entityId: 'ticket-001',
    key: 'status',
    reason: null,
    level: 'audit',
    metadata: null,
    ingestedAt: '2026-04-02T00:00:01.000Z',
    ...overrides,
  }
}

function makeWatermark(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    instanceId: 'inst-1',
    lastEventTimestamp: '2026-04-02T00:00:00.000Z',
    lastRemoteEventId: 'evt-001',
    lastPolledAt: '2026-04-02T00:01:00.000Z',
    lastPollSucceeded: true,
    lastPollError: null,
    consecutiveFailures: 0,
    totalEventsIngested: 10,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-02T00:01:00.000Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('GET /session-ledger', () => {
  let server: ReturnType<typeof express.application.listen>
  let apiBase: string

  beforeEach(async () => {
    vi.resetAllMocks()
    const app = express()
    app.use('/session-ledger', sessionLedgerRouter)
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    vi.resetAllMocks()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('returns empty fleet ledger when no events mirrored yet', async () => {
    mockQueryFleetLedger.mockResolvedValueOnce({ items: [], total: 0 })
    const res = await fetch(`${apiBase}/session-ledger`)
    const body = await res.json() as { items: unknown[]; total: number; fetchedAt: string }
    expect(res.status).toBe(200)
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
    expect(typeof body.fetchedAt).toBe('string')
  })

  it('returns mirrored events with correct camelCase field shapes', async () => {
    const event = makeEvent()
    mockQueryFleetLedger.mockResolvedValueOnce({ items: [event], total: 1 })
    const res = await fetch(`${apiBase}/session-ledger`)
    const body = await res.json() as {
      items: Array<Record<string, unknown>>
      total: number
    }
    expect(res.status).toBe(200)
    expect(body.total).toBe(1)
    const item = body.items[0]!
    // All expected camelCase fields must be present
    expect(item['id']).toBe(1)
    expect(item['instanceId']).toBe('inst-1')
    expect(item['remoteEventId']).toBe('evt-001')
    expect(item['timestamp']).toBe('2026-04-02T00:00:00.000Z')
    expect(item['staffComponent']).toBe('Librarian')
    expect(item['actionType']).toBe('write_created')
    expect(item['agentId']).toBe('agent-alpha')
    expect(item['source']).toBe('mcp')
    expect(item['host']).toBe('codex')
    expect(item['sessionId']).toBe('sess-abc')
    expect(item['ingestedAt']).toBe('2026-04-02T00:00:01.000Z')
    // Snake_case keys must NOT appear
    expect(Object.keys(item)).not.toContain('instance_id')
    expect(Object.keys(item)).not.toContain('remote_event_id')
  })

  it('passes instanceId filter to repo', async () => {
    mockQueryFleetLedger.mockResolvedValueOnce({ items: [], total: 0 })
    await fetch(`${apiBase}/session-ledger?instanceId=inst-abc`)
    const filters = mockQueryFleetLedger.mock.calls[0]?.[0] as Record<string, unknown>
    expect(filters['instanceId']).toBe('inst-abc')
  })

  it('passes actionType filter to repo', async () => {
    mockQueryFleetLedger.mockResolvedValueOnce({ items: [], total: 0 })
    await fetch(`${apiBase}/session-ledger?actionType=write_created`)
    const filters = mockQueryFleetLedger.mock.calls[0]?.[0] as Record<string, unknown>
    expect(filters['actionType']).toBe('write_created')
  })

  it('passes sessionId filter to repo', async () => {
    mockQueryFleetLedger.mockResolvedValueOnce({ items: [], total: 0 })
    await fetch(`${apiBase}/session-ledger?sessionId=sess-xyz`)
    const filters = mockQueryFleetLedger.mock.calls[0]?.[0] as Record<string, unknown>
    expect(filters['sessionId']).toBe('sess-xyz')
  })

  it('rejects invalid limit with 400', async () => {
    const res = await fetch(`${apiBase}/session-ledger?limit=0`)
    const body = await res.json() as { error?: string }
    expect(res.status).toBe(400)
    expect(typeof body['error']).toBe('string')
    expect(mockQueryFleetLedger).not.toHaveBeenCalled()
  })

  it('caps limit at 250 — repo receives limit <= 250 even for large input', async () => {
    mockQueryFleetLedger.mockResolvedValueOnce({ items: [], total: 0 })
    await fetch(`${apiBase}/session-ledger?limit=9999`)
    const filters = mockQueryFleetLedger.mock.calls[0]?.[0] as Record<string, unknown>
    expect(Number(filters['limit'])).toBeLessThanOrEqual(250)
  })

  it('returns non-fatal error envelope when repo throws', async () => {
    mockQueryFleetLedger.mockRejectedValueOnce(new Error('relation "mirrored_staff_events" does not exist'))
    const res = await fetch(`${apiBase}/session-ledger`)
    const body = await res.json() as {
      items: unknown[]
      total: number
      note?: string
    }
    // Non-fatal: must still be 200
    expect(res.status).toBe(200)
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
    expect(body.note).toContain('mirrored_staff_events')
  })
})

// ---------------------------------------------------------------------------

describe('GET /session-ledger/ingestion-health', () => {
  let server: ReturnType<typeof express.application.listen>
  let apiBase: string

  beforeEach(async () => {
    vi.resetAllMocks()
    const app = express()
    app.use('/session-ledger', sessionLedgerRouter)
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    vi.resetAllMocks()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('returns empty instances when no watermarks exist', async () => {
    mockGetAllWatermarks.mockResolvedValueOnce([])
    const res = await fetch(`${apiBase}/session-ledger/ingestion-health`)
    const body = await res.json() as { instances: unknown[]; fetchedAt: string }
    expect(res.status).toBe(200)
    expect(body.instances).toEqual([])
    expect(typeof body.fetchedAt).toBe('string')
  })

  it('maps a healthy watermark (consecutiveFailures=0) to status: healthy', async () => {
    mockGetAllWatermarks.mockResolvedValueOnce([makeWatermark({ consecutiveFailures: 0 })])
    const res = await fetch(`${apiBase}/session-ledger/ingestion-health`)
    const body = await res.json() as {
      instances: Array<Record<string, unknown>>
    }
    expect(res.status).toBe(200)
    const entry = body.instances[0]!
    expect(entry['status']).toBe('healthy')
    expect(entry['instanceId']).toBe('inst-1')
    expect(entry['consecutiveFailures']).toBe(0)
  })

  it('maps a failing watermark (consecutiveFailures >= 3) to status: failing', async () => {
    mockGetAllWatermarks.mockResolvedValueOnce([
      makeWatermark({ consecutiveFailures: 5, lastPollSucceeded: false, lastPollError: 'timeout' }),
    ])
    const res = await fetch(`${apiBase}/session-ledger/ingestion-health`)
    const body = await res.json() as { instances: Array<Record<string, unknown>> }
    expect(res.status).toBe(200)
    const entry = body.instances[0]!
    expect(entry['status']).toBe('failing')
    expect(entry['lastPollError']).toBe('timeout')
  })

  it('maps a never_polled watermark (lastPolledAt=null) to status: never_polled', async () => {
    mockGetAllWatermarks.mockResolvedValueOnce([
      makeWatermark({ lastPolledAt: null, lastEventTimestamp: null, lastRemoteEventId: null }),
    ])
    const res = await fetch(`${apiBase}/session-ledger/ingestion-health`)
    const body = await res.json() as { instances: Array<Record<string, unknown>> }
    expect(res.status).toBe(200)
    const entry = body.instances[0]!
    expect(entry['status']).toBe('never_polled')
  })

  it('returns non-fatal error envelope when repo throws', async () => {
    mockGetAllWatermarks.mockRejectedValueOnce(new Error('relation "instance_ledger_watermarks" does not exist'))
    const res = await fetch(`${apiBase}/session-ledger/ingestion-health`)
    const body = await res.json() as {
      instances: unknown[]
      fetchedAt: string
      note?: string
    }
    // Non-fatal: still 200
    expect(res.status).toBe(200)
    expect(body.instances).toEqual([])
    expect(typeof body.fetchedAt).toBe('string')
  })
})
