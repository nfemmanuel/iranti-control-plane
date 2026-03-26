import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'net'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { instancesRouter } from '../../routes/control-plane/instances.js'

describe('instances route provider contract', () => {
  let tempRoot: string
  let runtimeRoot: string
  let appServer: ReturnType<typeof express.application.listen>
  let apiBase: string

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'iranti-cp-instances-provider-'))
    runtimeRoot = join(tempRoot, '.iranti-runtime')
    await mkdir(join(runtimeRoot, 'instances', 'alpha'), { recursive: true })

    await writeFile(
      join(runtimeRoot, 'instances', 'alpha', '.env'),
      [
        'IRANTI_INSTANCE_NAME=alpha',
        'IRANTI_PORT=4301',
        'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:1/alpha',
        'LLM_PROVIDER=anthropic',
        'ANTHROPIC_API_KEY=sk-alpha-real',
        'OPENAI_API_KEY=sk-openai-real',
        'GROQ_API_KEY=sk-groq-real',
      ].join('\n') + '\n',
      'utf8'
    )

    process.env['IRANTI_HOME'] = runtimeRoot

    const app = express()
    app.use(express.json())
    app.use('/', instancesRouter)
    appServer = app.listen(0)
    await new Promise<void>((resolve) => appServer.once('listening', resolve))
    apiBase = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    delete process.env['IRANTI_HOME']
    await new Promise<void>((resolve) => appServer.close(() => resolve()))
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('normalizes legacy anthropic provider values to claude in the instance contract', async () => {
    const res = await fetch(`${apiBase}/`)
    const body = await res.json() as { instances?: Array<Record<string, unknown>> }

    expect(res.status).toBe(200)
    expect(Array.isArray(body.instances)).toBe(true)

    const alpha = body.instances?.find((instance) => instance['name'] === 'alpha')
    expect(alpha).toBeDefined()

    const integration = alpha?.integration as Record<string, unknown>
    const providerKeys = integration['providerKeys'] as Record<string, unknown>

    expect(integration['defaultProvider']).toBe('claude')
    expect(providerKeys['claude']).toBe(true)
    expect(providerKeys['openai']).toBe(true)
    expect(providerKeys['otherKeys']).toEqual(['GROQ_API_KEY'])
    expect('anthropic' in providerKeys).toBe(false)
  })
})
