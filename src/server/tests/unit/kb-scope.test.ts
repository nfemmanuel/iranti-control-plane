import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'net'

const {
  globalQueryMock,
  resolveInstanceAuthorityMock,
  poolQueryMock,
  poolEndMock,
  poolCtorMock,
} = vi.hoisted(() => {
  const globalQueryMock = vi.fn()
  const resolveInstanceAuthorityMock = vi.fn()
  const poolQueryMock = vi.fn()
  const poolEndMock = vi.fn()
  const poolCtorMock = vi.fn(function () { return { query: poolQueryMock, end: poolEndMock } })
  return {
    globalQueryMock,
    resolveInstanceAuthorityMock,
    poolQueryMock,
    poolEndMock,
    poolCtorMock,
  }
})

vi.mock('../../db.js', () => ({
  query: globalQueryMock,
  env: {},
}))

vi.mock('../../lib/instance-authority.js', () => ({
  resolveInstanceAuthority: resolveInstanceAuthorityMock,
}))

vi.mock('pg', () => ({
  default: { Pool: poolCtorMock },
  Pool: poolCtorMock,
}))

import { kbRouter } from '../../routes/control-plane/kb.js'

describe('kb routes respect selected instance scope', () => {
  let server: ReturnType<typeof express.application.listen>
  let baseUrl: string
  const realFetch = globalThis.fetch

  beforeEach(async () => {
    globalQueryMock.mockReset()
    resolveInstanceAuthorityMock.mockReset()
    poolQueryMock.mockReset()
    poolEndMock.mockReset()
    poolCtorMock.mockClear()

    const app = express()
    app.use(express.json())
    app.use('/', kbRouter)
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('GET /kb uses the selected instance database instead of the global control-plane pool', async () => {
    resolveInstanceAuthorityMock.mockResolvedValue({
      instanceId: 'beta-id',
      instanceName: 'beta',
      instanceDir: 'C:\\runtime\\beta',
      instanceEnvPath: 'C:\\runtime\\beta\\.env',
      runtimeRoot: 'C:\\runtime',
      apiBaseUrl: 'http://beta.local:3502',
      apiKey: 'beta-key',
      databaseUrl: 'postgresql://beta-db',
      env: {},
      boundProjects: [],
      source: 'query',
    })

    poolQueryMock
      .mockResolvedValueOnce({
        rows: [{
          id: '17',
          entityType: 'user',
          entityId: 'main',
          key: 'favorite_book',
          valueSummary: 'beta only',
          valueRaw: { title: 'Left Hand of Darkness' },
          confidence: 96,
          source: 'manual_probe',
          createdAt: new Date('2026-03-26T00:00:00Z'),
          updatedAt: new Date('2026-03-26T00:00:00Z'),
        }],
      })
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
    poolEndMock.mockResolvedValue(undefined)

    const res = await fetch(`${baseUrl}/kb?instanceId=beta-id&entityType=user`)
    const body = await res.json() as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(resolveInstanceAuthorityMock).toHaveBeenCalledWith('beta-id')
    expect(poolCtorMock).toHaveBeenCalledWith(expect.objectContaining({ connectionString: 'postgresql://beta-db' }))
    expect(globalQueryMock).not.toHaveBeenCalled()
    expect(poolQueryMock).toHaveBeenCalledTimes(2)
    expect(body.total).toBe(1)
    expect((body.items as Array<Record<string, unknown>>)[0]?.valueSummary).toBe('beta only')
  })

  it('GET /kb/search proxies to the selected instance api base and key', async () => {
    resolveInstanceAuthorityMock.mockResolvedValue({
      instanceId: 'beta-id',
      instanceName: 'beta',
      instanceDir: 'C:\\runtime\\beta',
      instanceEnvPath: 'C:\\runtime\\beta\\.env',
      runtimeRoot: 'C:\\runtime',
      apiBaseUrl: 'http://instance.test:3502',
      apiKey: 'beta-key',
      databaseUrl: 'postgresql://beta-db',
      env: {},
      boundProjects: [],
      source: 'query',
    })

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('http://127.0.0.1:')) {
        return realFetch(input, init)
      }
      if (url === 'http://instance.test:3502/kb/search?query=snack&limit=20') {
        expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json', 'X-Iranti-Key': 'beta-key' })
        return new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
    }))

    const res = await fetch(`${baseUrl}/kb/search?instanceId=beta-id&query=snack&limit=20`)
    const body = await res.json() as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body).toEqual({ results: [] })
    expect(resolveInstanceAuthorityMock).toHaveBeenCalledWith('beta-id')
  })
})
