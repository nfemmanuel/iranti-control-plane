import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { AddressInfo } from 'net'

const {
  queryMock,
  randomBytesMock,
  dbEnv,
} = vi.hoisted(() => {
  const queryMock = vi.fn()
  const randomBytesMock = vi.fn(() => Buffer.from('0123456789abcdef0123456789abcdef'))
  const dbEnv = { DATABASE_URL: 'postgresql://test-db' }
  return { queryMock, randomBytesMock, dbEnv }
})

vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto')
  return {
    ...actual,
    randomBytes: randomBytesMock,
  }
})

vi.mock('../../db.js', () => ({
  env: dbEnv,
  query: queryMock,
}))

import { authKeysRouter } from '../../routes/control-plane/auth-keys.js'

describe('auth-keys routes', () => {
  let server: ReturnType<typeof express.application.listen>
  let baseUrl: string
  let tempRoot: string
  let projectRoot: string

  beforeEach(async () => {
    queryMock.mockReset()
    randomBytesMock.mockClear()
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

  it('GET returns registry metadata without exposing raw token material', async () => {
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

    const res = await fetch(`${baseUrl}/api/control-plane/auth-keys`)
    const body = await res.json() as { keys: Array<Record<string, unknown>> }

    expect(res.status).toBe(200)
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
  })

  it('POST creates a key, persists it, and syncs the token into a project .env.iranti file', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    const res = await fetch(`${baseUrl}/api/control-plane/auth-keys`, {
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
    const res = await fetch(`${baseUrl}/api/control-plane/auth-keys`, {
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

  it('DELETE revokes an existing key and keeps the registry row in place', async () => {
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

    const res = await fetch(`${baseUrl}/api/control-plane/auth-keys/agent_1`, {
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
})
