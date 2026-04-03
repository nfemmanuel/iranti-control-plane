import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'net'
import { sessionsRouter } from '../../routes/control-plane/sessions.js'

describe('sessions ledger route', () => {
  let server: ReturnType<typeof express.application.listen>
  let apiBase: string
  let fetchMock: ReturnType<typeof vi.fn>
  const realFetch = globalThis.fetch

  beforeEach(async () => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock as typeof fetch)

    const app = express()
    app.use('/sessions', sessionsRouter)
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.resetAllMocks()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('proxies the Iranti session ledger and preserves event metadata', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            eventId: 'evt-001',
            timestamp: '2026-04-02T18:00:00.000Z',
            staffComponent: 'Attendant',
            actionType: 'memory_injected',
            agentId: 'agent-alpha',
            source: 'mcp',
            level: 'audit',
            metadata: {
              sessionId: 'sess-123',
              injectionId: 'inj-001',
              injectedKeys: ['project/iranti/checkpoint_next_step'],
              injectedEntryIds: [17],
              host: 'codex',
            },
          },
        ],
        total: 1,
      }),
    })

    const res = await realFetch(`${apiBase}/sessions/sess-123/ledger?agentId=agent-alpha&limit=25&actionType=memory_injected`)
    const body = await res.json() as {
      items: Array<{ actionType: string; metadata?: Record<string, unknown> | null }>
      total: number
      note?: string
    }

    expect(res.status).toBe(200)
    expect(body.total).toBe(1)
    expect(body.items[0]?.actionType).toBe('memory_injected')
    expect(body.items[0]?.metadata?.['injectionId']).toBe('inj-001')
    expect(body.note).toContain('/memory/ledger')

    const upstreamUrl = String(fetchMock.mock.calls[0]?.[0] ?? '')
    expect(upstreamUrl).toContain('/memory/ledger')
    expect(upstreamUrl).toContain('sessionId=sess-123')
    expect(upstreamUrl).toContain('agentId=agent-alpha')
    expect(upstreamUrl).toContain('actionType=memory_injected')
    expect(upstreamUrl).toContain('limit=25')
  })

  it('returns a non-fatal error envelope when Iranti ledger fetch fails upstream', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        error: 'staff_events table is missing',
      }),
    })

    const res = await realFetch(`${apiBase}/sessions/sess-123/ledger`)
    const body = await res.json() as { items: unknown[]; total: number; error?: string }

    expect(res.status).toBe(200)
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
    expect(body.error).toContain('HTTP 503')
    expect(body.error).toContain('staff_events table is missing')
  })

  it('rejects invalid limit values before proxying upstream', async () => {
    const res = await realFetch(`${apiBase}/sessions/sess-123/ledger?limit=0`)
    const body = await res.json() as { error?: string }

    expect(res.status).toBe(400)
    expect(body.error).toContain('limit must be an integer >= 1')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
