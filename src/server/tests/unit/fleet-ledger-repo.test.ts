import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../db.js', () => ({
  query: vi.fn(),
  env: {},
  pool: {},
}))

import { query } from '../../db.js'
import {
  upsertMirroredEvents,
  advanceWatermark,
  recordPollFailure,
  getWatermark,
  getAllWatermarks,
  queryFleetLedger,
} from '../../lib/fleet-ledger-repo.js'
import type { MirroredEventInsert } from '../../lib/fleet-ledger-repo.js'

const mockQuery = query as ReturnType<typeof vi.fn>

function makeEvent(overrides: Partial<MirroredEventInsert> = {}): MirroredEventInsert {
  return {
    instanceId: 'inst-1',
    remoteEventId: 'evt-001',
    timestamp: '2026-04-02T00:00:00.000Z',
    staffComponent: 'Librarian',
    actionType: 'write_created',
    agentId: 'agent-alpha',
    source: 'mcp',
    host: null,
    sessionId: 'sess-abc',
    entityType: 'ticket',
    entityId: 'ticket-001',
    key: 'status',
    reason: null,
    level: 'audit',
    metadata: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// upsertMirroredEvents
// ---------------------------------------------------------------------------

describe('upsertMirroredEvents', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('returns 0 immediately when events array is empty', async () => {
    const result = await upsertMirroredEvents([])
    expect(result).toBe(0)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('inserts single event and returns inserted row count', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] })
    const result = await upsertMirroredEvents([makeEvent()])
    expect(result).toBe(1)
    expect(mockQuery).toHaveBeenCalledOnce()
  })

  it('is idempotent — ON CONFLICT DO NOTHING means duplicate insert returns 0', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] })
    const result = await upsertMirroredEvents([makeEvent()])
    expect(result).toBe(0)
  })

  it('inserts multiple events in single batch and SQL contains ON CONFLICT', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 3, rows: [] })
    const events = [
      makeEvent({ remoteEventId: 'evt-001' }),
      makeEvent({ remoteEventId: 'evt-002' }),
      makeEvent({ remoteEventId: 'evt-003' }),
    ]
    await upsertMirroredEvents(events)
    // Only one query should have been fired — single batch INSERT
    expect(mockQuery).toHaveBeenCalledOnce()
    const sql: string = mockQuery.mock.calls[0]?.[0] ?? ''
    expect(sql).toContain('ON CONFLICT')
    expect(sql).toContain('DO NOTHING')
  })
})

// ---------------------------------------------------------------------------
// advanceWatermark
// ---------------------------------------------------------------------------

describe('advanceWatermark', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('inserts new watermark on first call with correct params', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })
    await advanceWatermark('inst-1', '2026-04-02T00:00:00.000Z', 'evt-001', 5)
    expect(mockQuery).toHaveBeenCalledOnce()
    const params: unknown[] = mockQuery.mock.calls[0]?.[1] ?? []
    expect(params[0]).toBe('inst-1')
    expect(params[1]).toBe('2026-04-02T00:00:00.000Z')
    expect(params[2]).toBe('evt-001')
    expect(params[3]).toBe(5)
  })

  it('allows null watermark values for a successful empty first poll', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })
    await advanceWatermark('inst-1', null, null, 0)
    const params: unknown[] = mockQuery.mock.calls[0]?.[1] ?? []
    expect(params[0]).toBe('inst-1')
    expect(params[1]).toBeNull()
    expect(params[2]).toBeNull()
    expect(params[3]).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// recordPollFailure
// ---------------------------------------------------------------------------

describe('recordPollFailure', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('records failure without changing watermark timestamp fields', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })
    await recordPollFailure('inst-1', 'connection refused')
    expect(mockQuery).toHaveBeenCalledOnce()
    const sql: string = mockQuery.mock.calls[0]?.[0] ?? ''
    expect(sql).toContain('consecutive_failures')
    // Watermark timestamp columns must NOT appear in the update target list
    expect(sql).not.toContain('last_event_timestamp = ')
    expect(sql).not.toContain('last_remote_event_id = ')
    const params: unknown[] = mockQuery.mock.calls[0]?.[1] ?? []
    expect(params[0]).toBe('inst-1')
    expect(params[1]).toBe('connection refused')
  })
})

// ---------------------------------------------------------------------------
// getAllWatermarks
// ---------------------------------------------------------------------------

describe('getAllWatermarks', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('returns empty array when no watermarks exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const result = await getAllWatermarks()
    expect(result).toEqual([])
  })

  it('maps DB snake_case rows to camelCase WatermarkRow', async () => {
    const fakeRow = {
      instance_id: 'inst-2',
      last_event_timestamp: '2026-04-02T10:00:00.000Z',
      last_remote_event_id: 'evt-099',
      last_polled_at: '2026-04-02T10:01:00.000Z',
      last_poll_succeeded: true,
      last_poll_error: null,
      consecutive_failures: 0,
      total_events_ingested: 42,
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-02T10:01:00.000Z',
    }
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow], rowCount: 1 })
    const result = await getAllWatermarks()
    expect(result).toHaveLength(1)
    const row = result[0]!
    expect(row.instanceId).toBe('inst-2')
    expect(row.lastEventTimestamp).toBe('2026-04-02T10:00:00.000Z')
    expect(row.lastRemoteEventId).toBe('evt-099')
    expect(row.lastPolledAt).toBe('2026-04-02T10:01:00.000Z')
    expect(row.lastPollSucceeded).toBe(true)
    expect(row.lastPollError).toBeNull()
    expect(row.consecutiveFailures).toBe(0)
    expect(row.totalEventsIngested).toBe(42)
    expect(row.createdAt).toBe('2026-04-01T00:00:00.000Z')
    expect(row.updatedAt).toBe('2026-04-02T10:01:00.000Z')
    // Verify no snake_case keys leaked through
    expect(Object.keys(row)).not.toContain('instance_id')
    expect(Object.keys(row)).not.toContain('last_event_timestamp')
  })
})

// ---------------------------------------------------------------------------
// queryFleetLedger
// ---------------------------------------------------------------------------

describe('queryFleetLedger', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('returns empty result when no events exist', async () => {
    // First call is the COUNT query, second is the data query
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const result = await queryFleetLedger({})
    expect(result).toEqual({ items: [], total: 0 })
  })

  it('applies instanceId filter — SQL must reference instance_id column', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    await queryFleetLedger({ instanceId: 'inst-abc' })
    // Both COUNT and data query use the same WHERE clause
    const countSql: string = mockQuery.mock.calls[0]?.[0] ?? ''
    expect(countSql).toContain('instance_id')
    const countParams: unknown[] = mockQuery.mock.calls[0]?.[1] ?? []
    expect(countParams).toContain('inst-abc')
  })

  it('caps limit at 250 regardless of caller input', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    await queryFleetLedger({ limit: 9999 })
    // The data query receives limit as the last param before execution
    const dataParams: unknown[] = mockQuery.mock.calls[1]?.[1] ?? []
    const lastParam = dataParams[dataParams.length - 1]
    expect(Number(lastParam)).toBeLessThanOrEqual(250)
  })

  it('ORDER BY includes both timestamp and remote_event_id for stable same-timestamp ordering', async () => {
    const fakeRow = {
      id: 1,
      instance_id: 'inst-1',
      remote_event_id: 'evt-001',
      timestamp: '2026-04-02T00:00:00.000Z',
      staff_component: 'Librarian',
      action_type: 'write_created',
      agent_id: 'agent-alpha',
      source: 'mcp',
      host: null,
      session_id: null,
      entity_type: null,
      entity_id: null,
      key: null,
      reason: null,
      level: 'audit',
      metadata: null,
      ingested_at: '2026-04-02T00:00:01.000Z',
    }
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '2' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [fakeRow, { ...fakeRow, id: 2, remote_event_id: 'evt-002' }], rowCount: 2 })
    await queryFleetLedger({})
    const dataSql: string = mockQuery.mock.calls[1]?.[0] ?? ''
    expect(dataSql).toContain('ORDER BY')
    expect(dataSql).toContain('timestamp')
    expect(dataSql).toContain('remote_event_id')
  })
})
