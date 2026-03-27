import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import http from 'node:http'
import type { AddressInfo } from 'net'

vi.mock('../../lib/instance-authority.js', () => ({
  resolveInstanceAuthority: vi.fn(),
}))

import { resolveInstanceAuthority } from '../../lib/instance-authority.js'
import { versionSyncRouter } from '../../routes/control-plane/version-sync.js'

const resolveInstanceAuthorityMock = vi.mocked(resolveInstanceAuthority)

async function requestJson(url: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return await new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          body: JSON.parse(data) as Record<string, unknown>,
        })
      })
    })
    req.on('error', reject)
  })
}

describe('version sync routes', () => {
  let server: ReturnType<typeof express.application.listen>
  let apiBase: string
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(async () => {
    vi.stubGlobal('fetch', fetchMock)

    const app = express()
    app.use(express.json())
    app.use('/', versionSyncRouter)
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    resolveInstanceAuthorityMock.mockResolvedValue({
      apiBaseUrl: 'http://127.0.0.1:3500',
      apiKey: 'test-key',
      source: 'binding',
      instanceId: 'iranti_dev',
      instanceName: 'iranti_dev',
      envPath: 'C:\\runtime\\.env',
    })
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.resetAllMocks()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('reports ahead when the installed version is newer than npm latest', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ runtime: { version: '0.2.42' } }), { status: 200 })
      }
      if (url === 'https://registry.npmjs.org/iranti/latest') {
        return new Response(JSON.stringify({ version: '0.2.41' }), { status: 200 })
      }
      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    const { status, body } = await requestJson(`${apiBase}/`)

    expect(status).toBe(200)
    expect(body).toMatchObject({
      installedVersion: '0.2.42',
      latestVersion: '0.2.41',
      upToDate: true,
      status: 'ahead',
    })
  })

  it('reports behind when the installed version is older than npm latest', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ runtime: { version: '0.2.41' } }), { status: 200 })
      }
      if (url === 'https://registry.npmjs.org/iranti/latest') {
        return new Response(JSON.stringify({ version: '0.2.42' }), { status: 200 })
      }
      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    const { status, body } = await requestJson(`${apiBase}/`)

    expect(status).toBe(200)
    expect(body).toMatchObject({
      installedVersion: '0.2.41',
      latestVersion: '0.2.42',
      upToDate: false,
      status: 'behind',
    })
  })
})
