import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { EventEmitter } from 'node:events'
import type { AddressInfo } from 'net'

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('../../lib/iranti-cli.js', () => ({
  resolveIrantiCli: vi.fn(),
}))

vi.mock('../../lib/instance-authority.js', () => ({
  resolveInstanceAuthority: vi.fn(),
}))

import { spawn } from 'child_process'
import { resolveIrantiCli } from '../../lib/iranti-cli.js'
import { resolveInstanceAuthority } from '../../lib/instance-authority.js'
import { upgradeRouter } from '../../routes/control-plane/upgrade.js'

const spawnMock = vi.mocked(spawn)
const resolveIrantiCliMock = vi.mocked(resolveIrantiCli)
const resolveInstanceAuthorityMock = vi.mocked(resolveInstanceAuthority)

function createSpawnedProcess() {
  const stdout = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void }
  stdout.setEncoding = () => undefined
  const stderr = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void }
  stderr.setEncoding = () => undefined

  const child = new EventEmitter() as EventEmitter & {
    pid: number
    stdout: typeof stdout
    stderr: typeof stderr
  }
  child.pid = 4242
  child.stdout = stdout
  child.stderr = stderr
  return child
}

describe('upgrade routes', () => {
  let server: ReturnType<typeof express.application.listen>
  let apiBase: string

  beforeEach(async () => {
    const app = express()
    app.use(express.json())
    app.use('/', upgradeRouter)
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    vi.resetAllMocks()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('spawns upgrade through the shared Iranti CLI resolver and includes the resolved runtime root', async () => {
    resolveIrantiCliMock.mockResolvedValue({
      command: process.execPath,
      args: ['C:\\Users\\NF\\AppData\\Roaming\\npm\\node_modules\\iranti\\bin\\iranti.js'],
      displayPath: 'C:\\Users\\NF\\AppData\\Roaming\\npm\\iranti.cmd',
      source: 'path',
    })
    resolveInstanceAuthorityMock.mockResolvedValue({
      instanceId: 'deadbeef',
      instanceName: 'iranti_dev',
      instanceDir: 'C:\\Users\\NF\\.iranti-runtime\\instances\\iranti_dev',
      instanceEnvPath: 'C:\\Users\\NF\\.iranti-runtime\\instances\\iranti_dev\\.env',
      runtimeRoot: 'C:\\Users\\NF\\.iranti-runtime',
      apiBaseUrl: 'http://localhost:3500',
      apiKey: 'test-key',
      databaseUrl: 'postgresql://postgres@localhost:5435/iranti_dev_db',
      env: {},
      boundProjects: [],
      source: 'query',
    })
    spawnMock.mockReturnValue(createSpawnedProcess() as never)

    const res = await fetch(`${apiBase}/iranti_dev/upgrade`, { method: 'POST' })
    const body = await res.json() as Record<string, unknown>

    expect(res.status).toBe(202)
    expect(body.status).toBe('started')
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [
        'C:\\Users\\NF\\AppData\\Roaming\\npm\\node_modules\\iranti\\bin\\iranti.js',
        'upgrade',
        '--restart',
        '--instance',
        'iranti_dev',
        '--root',
        'C:\\Users\\NF\\.iranti-runtime',
      ],
      expect.objectContaining({
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    )
  })

  it('returns JSON when the upgrade process cannot be spawned', async () => {
    resolveIrantiCliMock.mockResolvedValue({
      command: process.execPath,
      args: ['C:\\Users\\NF\\AppData\\Roaming\\npm\\node_modules\\iranti\\bin\\iranti.js'],
      displayPath: 'C:\\Users\\NF\\AppData\\Roaming\\npm\\iranti.cmd',
      source: 'path',
    })
    resolveInstanceAuthorityMock.mockResolvedValue(null)
    spawnMock.mockImplementation(() => {
      throw new Error('spawn EINVAL')
    })

    const res = await fetch(`${apiBase}/iranti_dev/upgrade`, { method: 'POST' })
    const body = await res.json() as Record<string, unknown>

    expect(res.status).toBe(500)
    expect(body).toMatchObject({
      code: 'UPGRADE_SPAWN_FAILED',
      error: 'spawn EINVAL',
    })
  })
})
