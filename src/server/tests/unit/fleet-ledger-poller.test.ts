import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/instance-authority.js', () => ({
  resolveInstanceAuthority: vi.fn(),
}))

vi.mock('../../lib/fleet-ledger-repo.js', () => ({
  upsertMirroredEvents: vi.fn(),
  advanceWatermark: vi.fn(),
  recordPollFailure: vi.fn(),
  getWatermark: vi.fn(),
}))

vi.mock('../../routes/control-plane/instances.js', () => ({
  discoverAndAggregate: vi.fn(),
}))

import { resolveInstanceAuthority } from '../../lib/instance-authority.js'
import {
  advanceWatermark,
  getWatermark,
  recordPollFailure,
  upsertMirroredEvents,
} from '../../lib/fleet-ledger-repo.js'
import { discoverAndAggregate } from '../../routes/control-plane/instances.js'
import { pollAllInstancesOnce } from '../../lib/fleet-ledger-poller.js'

const mockResolveInstanceAuthority = resolveInstanceAuthority as ReturnType<typeof vi.fn>
const mockAdvanceWatermark = advanceWatermark as ReturnType<typeof vi.fn>
const mockGetWatermark = getWatermark as ReturnType<typeof vi.fn>
const mockRecordPollFailure = recordPollFailure as ReturnType<typeof vi.fn>
const mockUpsertMirroredEvents = upsertMirroredEvents as ReturnType<typeof vi.fn>
const mockDiscoverAndAggregate = discoverAndAggregate as ReturnType<typeof vi.fn>
const mockFetch = vi.fn()

function makeResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as Response
}

function makeLedgerItems(count: number, startIso: string): Array<Record<string, unknown>> {
  const start = Date.parse(startIso)
  return Array.from({ length: count }, (_, index) => {
    const timestamp = new Date(start - index * 60_000).toISOString()
    return {
      eventId: `evt-${String(index + 1).padStart(3, '0')}`,
      timestamp,
      staffComponent: 'Attendant',
      actionType: 'checkpoint_written',
      agentId: 'agent-alpha',
      source: 'mcp',
      metadata: { host: 'codex_vscode', sessionId: 'sess-1' },
    }
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  mockDiscoverAndAggregate.mockResolvedValue({
    instances: [
      { instanceId: 'inst-a', name: 'iranti-dev' },
    ],
    discoverySource: 'registry',
    discoveredAt: '2026-04-02T00:00:00.000Z',
  })
  mockResolveInstanceAuthority.mockResolvedValue({
    instanceId: 'inst-a',
    instanceName: 'iranti-dev',
    instanceDir: 'C:/iranti-runtime/instances/iranti-dev',
    instanceEnvPath: 'C:/iranti-runtime/instances/iranti-dev/.env',
    runtimeRoot: 'C:/iranti-runtime',
    apiBaseUrl: 'http://localhost:3131',
    apiKey: 'secret-key',
    databaseUrl: null,
    databaseIntent: null,
    env: {},
    boundProjects: [],
    source: 'query',
  })
  mockAdvanceWatermark.mockResolvedValue(undefined)
  mockRecordPollFailure.mockResolvedValue(undefined)
  mockUpsertMirroredEvents.mockResolvedValue(0)
  mockGetWatermark.mockResolvedValue(null)
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('pollAllInstancesOnce', () => {
  it('treats a first successful empty poll as a no-op watermark advance', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ items: [] }))

    await pollAllInstancesOnce()

    expect(mockResolveInstanceAuthority).toHaveBeenCalledWith('inst-a')
    expect(mockAdvanceWatermark).toHaveBeenCalledWith('inst-a', null, null, 0)
    expect(mockRecordPollFailure).not.toHaveBeenCalled()
  })

  it('drains backward across full batches and preserves the lower-bound overlap', async () => {
    mockGetWatermark.mockResolvedValue({
      instanceId: 'inst-a',
      lastEventTimestamp: '2026-04-02T00:00:00.000Z',
      lastEventId: 'evt-000',
      lastRemoteEventId: 'evt-000',
      lastPolledAt: '2026-04-02T00:01:00.000Z',
      lastPollSucceeded: true,
      lastPollError: null,
      consecutiveFailures: 0,
      totalEventsIngested: 12,
      createdAt: '2026-04-02T00:00:00.000Z',
      updatedAt: '2026-04-02T00:01:00.000Z',
    })

    const batchOne = makeLedgerItems(250, '2026-04-02T10:00:00.000Z')
    const batchTwo = makeLedgerItems(2, '2026-04-02T05:50:00.000Z')

    mockFetch
      .mockResolvedValueOnce(makeResponse({ items: batchOne }))
      .mockResolvedValueOnce(makeResponse({ items: batchTwo }))

    mockUpsertMirroredEvents
      .mockResolvedValueOnce(250)
      .mockResolvedValueOnce(2)

    await pollAllInstancesOnce()

    expect(mockFetch).toHaveBeenCalledTimes(2)

    const firstUrl = new URL(mockFetch.mock.calls[0]![0] as string)
    const secondUrl = new URL(mockFetch.mock.calls[1]![0] as string)

    expect(firstUrl.searchParams.get('since')).toBe('2026-04-01T23:59:59.999Z')
    expect(secondUrl.searchParams.get('since')).toBe('2026-04-01T23:59:59.999Z')
    expect(secondUrl.searchParams.get('until')).toBe('2026-04-02T05:50:59.999Z')

    expect(mockAdvanceWatermark).toHaveBeenNthCalledWith(
      1,
      'inst-a',
      '2026-04-02T10:00:00.000Z',
      'evt-001',
      250
    )
    expect(mockAdvanceWatermark).toHaveBeenNthCalledWith(
      2,
      'inst-a',
      '2026-04-02T10:00:00.000Z',
      'evt-001',
      2
    )
  })
})
