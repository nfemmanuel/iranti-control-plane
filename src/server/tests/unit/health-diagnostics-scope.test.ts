import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import express from 'express'
import http from 'http'
import type { AddressInfo } from 'net'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { healthRouter } from '../../routes/control-plane/health.js'
import { diagnosticsRouter } from '../../routes/control-plane/diagnostics.js'
import { deriveInstanceId } from '../../lib/instance-authority.js'

describe('health and diagnostics instance scoping', () => {
  let tempRoot: string
  let runtimeRoot: string
  let apiServer: http.Server
  let irantiServer: http.Server
  let apiBase: string
  let betaInstanceId: string
  const attendBodies: Array<Record<string, unknown>> = []
  let attendResponse: Record<string, unknown>
  let searchResults: Array<Record<string, unknown>>
  const queryValues = new Map<string, unknown>()

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'iranti-cp-health-'))
    runtimeRoot = join(tempRoot, '.iranti-runtime')
    await mkdir(join(runtimeRoot, 'instances', 'alpha'), { recursive: true })
    await mkdir(join(runtimeRoot, 'instances', 'beta'), { recursive: true })
    attendResponse = { ok: true }
    searchResults = [{ entity: '__diagnostics__/__probe__', key: 'semantic_probe', value: 'ok', vectorScore: 1 }]
    queryValues.clear()

    irantiServer = http.createServer(async (req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          status: 'ok',
          version: '9.9.9',
          runtime: {
            instanceName: 'beta',
            pid: 4242,
            port: (irantiServer.address() as AddressInfo).port,
            startedAt: new Date('2026-03-23T10:00:00.000Z').toISOString(),
            lastHeartbeatAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: 'running',
            version: '9.9.9',
            healthUrl: 'http://localhost/health',
          },
        }))
        return
      }

      if (req.url?.startsWith('/kb/search')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          results: searchResults,
        }))
        return
      }

      if (req.url?.startsWith('/kb/query/')) {
        const parts = req.url.split('/')
        const key = decodeURIComponent(parts.at(-1) ?? '')
        const value = queryValues.get(key)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(value === undefined
          ? { found: false }
          : { found: true, value }))
        return
      }

      if (req.url === '/kb/write' || req.url?.startsWith('/kb/delete') || req.url === '/memory/attend') {
        if (req.url === '/memory/attend') {
          let bodyRaw = ''
          for await (const chunk of req) {
            bodyRaw += chunk
          }
          attendBodies.push(JSON.parse(bodyRaw) as Record<string, unknown>)
        } else if (req.url === '/kb/write') {
          let bodyRaw = ''
          for await (const chunk of req) {
            bodyRaw += chunk
          }
          const body = JSON.parse(bodyRaw) as Record<string, unknown>
          queryValues.set(String(body.key), body.value)
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(attendResponse))
        return
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
    })

    await new Promise<void>((resolve) => irantiServer.listen(0, resolve))
    const irantiPort = (irantiServer.address() as AddressInfo).port

    await writeFile(
      join(runtimeRoot, 'instances', 'alpha', '.env'),
      [
        'IRANTI_INSTANCE_NAME=alpha',
        'IRANTI_PORT=4301',
        'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:1/alpha',
        'IRANTI_API_KEY=alpha-key',
      ].join('\n') + '\n',
      'utf8'
    )

    await writeFile(
      join(runtimeRoot, 'instances', 'beta', '.env'),
      [
        'IRANTI_INSTANCE_NAME=beta',
        `IRANTI_PORT=${irantiPort}`,
        'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:1/beta',
        'IRANTI_API_KEY=beta-key',
      ].join('\n') + '\n',
      'utf8'
    )

    betaInstanceId = deriveInstanceId(join(runtimeRoot, 'instances', 'beta'))
    process.env['IRANTI_HOME'] = runtimeRoot

    const app = express()
    app.use(express.json())
    app.use('/health', healthRouter)
    app.use('/diagnostics', diagnosticsRouter)
    apiServer = app.listen(0)
    await new Promise<void>((resolve) => apiServer.once('listening', resolve))
    apiBase = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    attendBodies.length = 0
    delete process.env['IRANTI_HOME']
    await new Promise<void>((resolve) => apiServer.close(() => resolve()))
    await new Promise<void>((resolve) => irantiServer.close(() => resolve()))
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('GET /health scopes checks to the requested instance', async () => {
    const res = await fetch(`${apiBase}/health?instanceId=${betaInstanceId}`)
    const body = await res.json() as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.scope).toMatchObject({
      instanceId: betaInstanceId,
      instanceName: 'beta',
      source: 'query',
    })

    const checks = body.checks as Array<Record<string, unknown>>
    const runtimeVersion = checks.find((check) => check.name === 'runtime_version')
    expect(runtimeVersion?.status).toBe('ok')
    const attendBody = attendBodies.at(0)
    expect(attendBody).toMatchObject({
      agent: 'control_plane_operator',
      latestMessage: 'health check probe',
      currentContext: 'health check probe',
    })
    expect(attendBody).not.toHaveProperty('query')
  })

  it('diagnostics caches results per instance instead of globally', async () => {
    const runRes = await fetch(`${apiBase}/diagnostics/run?instanceId=${betaInstanceId}`, { method: 'POST' })
    const runBody = await runRes.json() as Record<string, unknown>
    expect(runRes.status).toBe(200)
    expect(runBody.scope).toMatchObject({ instanceName: 'beta' })
    const attendBody = attendBodies.at(-1)
    expect(attendBody).toMatchObject({
      agent: 'control_plane_operator',
      latestMessage: 'diagnostic probe',
      currentContext: 'diagnostic probe',
    })
    expect(attendBody).not.toHaveProperty('query')

    const lastBeta = await fetch(`${apiBase}/diagnostics/last?instanceId=${betaInstanceId}`)
    expect(lastBeta.status).toBe(200)

    const alphaInstanceId = deriveInstanceId(join(runtimeRoot, 'instances', 'alpha'))
    const lastAlpha = await fetch(`${apiBase}/diagnostics/last?instanceId=${alphaInstanceId}`)
    expect(lastAlpha.status).toBe(404)
  })

  it('reports classifier parse fallback in operator language instead of internal forceInject advice', async () => {
    attendResponse = {
      shouldInject: false,
      reason: 'memory_not_needed',
      decision: {
        needed: false,
        confidence: 0.5,
        method: 'heuristic',
        explanation: 'classification_parse_failed_default_false',
      },
    }

    const healthRes = await fetch(`${apiBase}/health?instanceId=${betaInstanceId}`)
    const healthBody = await healthRes.json() as Record<string, unknown>
    expect(healthRes.status).toBe(200)
    expect(healthBody.attendant).toMatchObject({
      status: 'warn',
      message: 'Attendant responded, but the diagnostic probe fell back to a conservative no-memory decision.',
    })

    const diagRes = await fetch(`${apiBase}/diagnostics/run?instanceId=${betaInstanceId}`, { method: 'POST' })
    const diagBody = await diagRes.json() as Record<string, unknown>
    expect(diagRes.status).toBe(200)
    const checks = diagBody.checks as Array<Record<string, unknown>>
    const attendCheck = checks.find((check) => check.check === 'attend_check')
    expect(attendCheck).toMatchObject({
      status: 'warn',
      message: 'Attendant returned 200, but the diagnostic probe fell back to a conservative no-memory decision.',
      fixHint: 'This usually means the synthetic probe was ambiguous, not that the Attendant is down. Re-test with a clearer task prompt if real memory injection seems weak.',
    })
  })

  it('treats lexical-only semantic probe matches as a vector-search warning instead of a hard failure', async () => {
    searchResults = [{ entity: '__diagnostics__/__probe__', key: 'semantic_probe', value: 'ok', vectorScore: 0 }]

    const diagRes = await fetch(`${apiBase}/diagnostics/run?instanceId=${betaInstanceId}`, { method: 'POST' })
    const diagBody = await diagRes.json() as Record<string, unknown>
    expect(diagRes.status).toBe(200)

    const checks = diagBody.checks as Array<Record<string, unknown>>
    const vectorCheck = checks.find((check) => check.check === 'vector_search_check')
    expect(vectorCheck).toMatchObject({
      status: 'warn',
      message: 'Semantic probe surfaced, but only through lexical matching (vectorScore=0)',
      fixHint: 'Vector backend is reachable, so this usually means embeddings are stale or the semantic probe is underweighted. Re-run doctor and inspect vector index consistency if real search feels weak.',
    })
  })
})
