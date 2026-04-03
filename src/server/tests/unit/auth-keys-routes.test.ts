import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { AddressInfo } from 'net'

const {
  queryMock,
  endMock,
  randomBytesMock,
  resolveInstanceAuthorityMock,
} = vi.hoisted(() => {
  const queryMock = vi.fn()
  const endMock = vi.fn()
  const randomBytesMock = vi.fn(() => Buffer.from('0123456789abcdef0123456789abcdef'))
  const resolveInstanceAuthorityMock = vi.fn(async () => ({
    instanceId: 'alpha-id',
    instanceName: 'alpha',
    instanceDir: '/runtime/instances/alpha',
    instanceEnvPath: '/runtime/instances/alpha/.env',
    runtimeRoot: '/runtime',
    apiBaseUrl: 'http://localhost:4301',
    apiKey: 'alpha.legacy',
    databaseUrl: 'postgresql://alpha-db',
    databaseIntent: null,
    env: { IRANTI_API_KEY_PEPPER: 'pepper-secret-123456789012345678901234' },
    boundProjects: [],
    source: 'query',
  }))
  return { queryMock, endMock, randomBytesMock, resolveInstanceAuthorityMock }
})

vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto')
  return {
    ...actual,
    randomBytes: randomBytesMock,
  }
})

vi.mock('../../lib/instance-authority.js', () => ({
  resolveInstanceAuthority: resolveInstanceAuthorityMock,
}))

vi.mock('pg', () => {
  const Pool = vi.fn(function () { return { query: queryMock, end: endMock } })
  return {
    default: { Pool },
    Pool,
  }
})

import pg from 'pg'
import { authKeysRouter } from '../../routes/control-plane/auth-keys.js'

const PoolMock = vi.mocked(pg.Pool)

describe('auth-keys routes', () => {
  let server: ReturnType<typeof express.application.listen>
  let baseUrl: string
  let tempRoot: string
  let projectRoot: string

  beforeEach(async () => {
    queryMock.mockReset()
    endMock.mockReset()
    randomBytesMock.mockClear()
    resolveInstanceAuthorityMock.mockClear()
    PoolMock.mockClear()

    tempRoot = await mkdtemp(join(tmpdir(), 'iranti-cp-auth-keys-'))
    projectRoot = join(tempRoot, 'project-a')
    await mkdir(projectRoot, { recursive: true })
    await writeFile(join(projectRoot, '.env.iranti'), 'IRANTI_PORT=4000\nLEGACY=keep-me\n', 'utf8')

    const app = express()
    app.use(express.json())
    app.use('/api/control-plane/auth-keys', authKeysRouter)
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('GET returns registry metadata for the selected instance without exposing raw token material', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        valueRaw: {
          version: 1,
          keys: [{
            keyId: 'agent_1',
            owner: 'Backend',
            secretHash: 'deadbeef',
            scopes: ['kb:read', 'memory:write:project/*'],
            isActive: true,
            createdAt: '2026-04-01T10:00:00.000Z',
            revokedAt: null,
            description: 'primary key',
          }],
        },
      }],
    })

    const res = await fetch(`${baseUrl}/api/control-plane/auth-keys?instanceId=alpha-id`)
    const body = await res.json() as { keys: Array<Record<string, unknown>> }

    expect(res.status).toBe(200)
    expect(resolveInstanceAuthorityMock).toHaveBeenCalledWith('alpha-id')
    expect(PoolMock).toHaveBeenCalledWith(expect.objectContaining({ connectionString: 'postgresql://alpha-db' }))
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('SELECT "valueRaw" FROM knowledge_base'),
      ['system', 'auth', 'api_keys']
    )
    expect(body.keys).toEqual([{
      keyId: 'agent_1',
      owner: 'Backend',
      scopes: ['kb:read', 'memory:write:project/*'],
      description: 'primary key',
      createdAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-01T10:00:00.000Z',
      revoked: false,
      revokedAt: null,
    }])
    expect(body.keys[0]).not.toHaveProperty('secretHash')
    expect(endMock).toHaveBeenCalledOnce()
  })

  it('POST creates a key in the selected instance registry and syncs the token into a project .env.iranti file', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    const res = await fetch(`${baseUrl}/api/control-plane/auth-keys?instanceId=alpha-id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyId: 'Agent Key',
        owner: 'Control Plane',
        scopes: ['kb:read', 'memory:write:project/*'],
        description: '  primary access token  ',
        syncToProject: projectRoot,
      }),
    })
    const body = await res.json() as {
      ok: boolean
      keyId: string
      token: string
      scopes: string[]
      warning?: string
    }

    expect(res.status).toBe(201)
    expect(body.ok).toBe(true)
    expect(body.keyId).toBe('agent_key')
    expect(body.scopes).toEqual(['kb:read', 'memory:write:project/*'])
    expect(body.token).toMatch(/^agent_key\.[A-Za-z0-9_-]+$/)
    expect(resolveInstanceAuthorityMock).toHaveBeenCalledWith('alpha-id')
    expect(PoolMock).toHaveBeenCalledWith(expect.objectContaining({ connectionString: 'postgresql://alpha-db' }))
    expect(randomBytesMock).toHaveBeenCalledOnce()
    expect(queryMock).toHaveBeenCalledTimes(2)

    const persisted = JSON.parse(String(queryMock.mock.calls[1]?.[1]?.[3])) as {
      keys: Array<Record<string, unknown>>
    }
    expect(persisted.keys[0]).toMatchObject({
      keyId: 'agent_key',
      owner: 'Control Plane',
      scopes: ['kb:read', 'memory:write:project/*'],
      isActive: true,
      revokedAt: null,
      description: 'primary access token',
    })

    const envFile = await readFile(join(projectRoot, '.env.iranti'), 'utf8')
    expect(envFile).toContain('IRANTI_PORT=4000')
    expect(envFile).toContain('LEGACY=keep-me')
    expect(envFile).toContain(`IRANTI_API_KEY=${body.token}`)
  })

  it('POST rejects wildcard entity types with specific entity IDs before touching the registry', async () => {
    const res = await fetch(`${baseUrl}/api/control-plane/auth-keys?instanceId=alpha-id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyId: 'bad-scope',
        owner: 'Control Plane',
        scopes: ['kb:read:*/acme'],
      }),
    })
    const body = await res.json() as { error: string }

    expect(res.status).toBe(400)
    expect(body.error).toContain('namespace cannot use wildcard entityType with a specific entityId')
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('DELETE revokes an existing key in the selected instance registry and keeps the row in place', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          valueRaw: {
            version: 1,
            keys: [{
              keyId: 'agent_1',
              owner: 'Backend',
              secretHash: 'deadbeef',
              scopes: ['kb:read'],
              isActive: true,
              createdAt: '2026-04-01T10:00:00.000Z',
              revokedAt: null,
            }],
          },
        }],
      })
      .mockResolvedValueOnce({ rows: [] })

    const res = await fetch(`${baseUrl}/api/control-plane/auth-keys/agent_1?instanceId=alpha-id`, {
      method: 'DELETE',
    })
    const body = await res.json() as { ok: boolean; keyId: string }

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, keyId: 'agent_1' })
    expect(queryMock).toHaveBeenCalledTimes(2)

    const persisted = JSON.parse(String(queryMock.mock.calls[1]?.[1]?.[3])) as {
      keys: Array<Record<string, unknown>>
    }
    expect(persisted.keys[0]).toMatchObject({
      keyId: 'agent_1',
      isActive: false,
    })
    expect(typeof persisted.keys[0]?.revokedAt).toBe('string')
    expect(String(persisted.keys[0]?.revokedAt)).not.toBe('')
  })

  it('returns a scoped database error when the selected instance has no DATABASE_URL', async () => {
    resolveInstanceAuthorityMock.mockResolvedValueOnce({
      instanceId: 'alpha-id',
      instanceName: 'alpha',
      instanceDir: '/runtime/instances/alpha',
      instanceEnvPath: '/runtime/instances/alpha/.env',
      runtimeRoot: '/runtime',
      apiBaseUrl: 'http://localhost:4301',
      apiKey: 'alpha.legacy',
      databaseUrl: null,
      databaseIntent: null,
      env: {},
      boundProjects: [],
      source: 'query',
    })

    const res = await fetch(`${baseUrl}/api/control-plane/auth-keys?instanceId=alpha-id`)
    const body = await res.json() as { error: string; code: string }

    expect(res.status).toBe(503)
    expect(body.code).toBe('NO_DATABASE_URL')
    expect(body.error).toContain('instance alpha')
    expect(queryMock).not.toHaveBeenCalled()
  })
})
