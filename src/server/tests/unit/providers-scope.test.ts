import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'net'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { providersRouter } from '../../routes/control-plane/providers.js'
import { deriveInstanceId } from '../../lib/instance-authority.js'

describe('provider routes scope instance authority explicitly', () => {
  let tempRoot: string
  let runtimeRoot: string
  let appServer: ReturnType<typeof express.application.listen>
  let apiBase: string
  let alphaInstanceId: string
  let betaInstanceId: string
  const realFetch = globalThis.fetch

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'iranti-cp-providers-scope-'))
    runtimeRoot = join(tempRoot, '.iranti-runtime')
    await mkdir(join(runtimeRoot, 'instances', 'alpha'), { recursive: true })
    await mkdir(join(runtimeRoot, 'instances', 'beta'), { recursive: true })

    await writeFile(
      join(runtimeRoot, 'instances', 'alpha', '.env'),
      [
        'IRANTI_INSTANCE_NAME=alpha',
        'IRANTI_PORT=4301',
        'LLM_PROVIDER=anthropic',
        'LLM_PROVIDER_FALLBACK=anthropic,openai',
        'ANTHROPIC_API_KEY=sk-alpha-real',
      ].join('\n') + '\n',
      'utf8'
    )

    await writeFile(
      join(runtimeRoot, 'instances', 'beta', '.env'),
      [
        'IRANTI_INSTANCE_NAME=beta',
        'IRANTI_PORT=4302',
        'LLM_PROVIDER=openai',
        'OPENAI_API_KEY=sk-beta-real',
      ].join('\n') + '\n',
      'utf8'
    )

    alphaInstanceId = deriveInstanceId(join(runtimeRoot, 'instances', 'alpha'))
    betaInstanceId = deriveInstanceId(join(runtimeRoot, 'instances', 'beta'))
    process.env['IRANTI_HOME'] = runtimeRoot

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')) {
        return realFetch(input, init)
      }
      if (url.includes('api.anthropic.com') || url.includes('api.openai.com')) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
    }))

    const app = express()
    app.use(express.json())
    app.use('/', providersRouter)
    appServer = app.listen(0)
    await new Promise<void>((resolve) => appServer.once('listening', resolve))
    apiBase = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    delete process.env['IRANTI_HOME']
    vi.unstubAllGlobals()
    await new Promise<void>((resolve) => appServer.close(() => resolve()))
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('GET /providers reports the requested instance scope and canonical claude provider ID', async () => {
    const res = await fetch(`${apiBase}/providers?instanceId=${alphaInstanceId}`)
    const body = await res.json() as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.scope).toMatchObject({ instanceId: alphaInstanceId, instanceName: 'alpha' })
    expect(body.defaultProvider).toBe('claude')
    expect(body.rawDefaultProvider).toBe('anthropic')
    expect(body.rawFallbackChain).toEqual(['anthropic', 'openai'])

    const providers = body.providers as Array<Record<string, unknown>>
    expect(providers.some((provider) => provider.id === 'claude')).toBe(true)
    expect(providers.some((provider) => provider.id === 'anthropic')).toBe(false)
  })

  it('provider writes only touch the selected instance env and normalize anthropic to claude', async () => {
    const setDefaultRes = await fetch(`${apiBase}/providers/default?instanceId=${alphaInstanceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic' }),
    })
    expect(setDefaultRes.status).toBe(200)

    const setFallbackRes = await fetch(`${apiBase}/providers/fallback?instanceId=${alphaInstanceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain: ['anthropic', 'openai'] }),
    })
    expect(setFallbackRes.status).toBe(200)

    const alphaEnv = await readFile(join(runtimeRoot, 'instances', 'alpha', '.env'), 'utf8')
    const betaEnv = await readFile(join(runtimeRoot, 'instances', 'beta', '.env'), 'utf8')

    expect(alphaEnv).toContain('LLM_PROVIDER=claude')
    expect(alphaEnv).toContain('LLM_PROVIDER_FALLBACK=claude,openai')
    expect(betaEnv).toContain('LLM_PROVIDER=openai')
    expect(betaEnv).not.toContain('LLM_PROVIDER=claude')
    expect(betaInstanceId).not.toBe(alphaInstanceId)
  })
})
