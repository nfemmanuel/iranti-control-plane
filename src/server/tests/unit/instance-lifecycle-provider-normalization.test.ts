import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'net'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('../../lib/runtime-roots.js', () => ({
  runtimeRootCandidates: vi.fn(),
  classifyRuntimeRoot: (runtimeRoot: string) => {
    const normalized = runtimeRoot.replace(/\\/g, '/').toLowerCase()
    if (normalized.endsWith('/.iranti-runtime')) return 'primary'
    if (normalized.endsWith('/.iranti')) return 'legacy'
    return 'custom'
  },
}))

vi.mock('../../lib/iranti-cli.js', () => ({
  runIrantiCommand: vi.fn(),
  runIrantiJson: vi.fn(),
}))

vi.mock('../../db.js', () => ({
  env: {},
}))

vi.mock('pg', () => {
  const query = vi.fn()
  const end = vi.fn()
  const Pool = vi.fn(() => ({ query, end }))
  return {
    default: { Pool },
    Pool,
  }
})

import { runtimeRootCandidates } from '../../lib/runtime-roots.js'
import { runIrantiCommand, runIrantiJson } from '../../lib/iranti-cli.js'
import { instanceLifecycleRouter } from '../../routes/control-plane/instance-lifecycle.js'
import pg from 'pg'

const runtimeRootCandidatesMock = vi.mocked(runtimeRootCandidates)
const runIrantiCommandMock = vi.mocked(runIrantiCommand)
const runIrantiJsonMock = vi.mocked(runIrantiJson)
const PoolMock = vi.mocked(pg.Pool)

async function writeInstanceFiles(
  runtimeRoot: string,
  name: string,
  envValues: Record<string, string>,
  port: number,
): Promise<void> {
  const instanceDir = join(runtimeRoot, 'instances', name)
  await mkdir(instanceDir, { recursive: true })
  await writeFile(
    join(instanceDir, '.env'),
    Object.entries(envValues)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
    'utf8',
  )
  await writeFile(
    join(instanceDir, 'instance.json'),
    JSON.stringify({ name, port, envFile: join(instanceDir, '.env'), instanceDir }, null, 2) + '\n',
    'utf8',
  )
}

describe('instance lifecycle routes', () => {
  let tempRoot: string
  let runtimeRoot: string
  let server: ReturnType<typeof express.application.listen>
  let apiBase: string

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'iranti-cp-instance-lifecycle-'))
    runtimeRoot = join(tempRoot, '.iranti-runtime')
    await mkdir(join(runtimeRoot, 'instances'), { recursive: true })

    runtimeRootCandidatesMock.mockReturnValue([runtimeRoot])
    PoolMock.mockImplementation(() => ({
      query: vi.fn(),
      end: vi.fn(),
    }) as never)
    delete process.env['IRANTI_HOME']
    delete process.env['IRANTI_INSTANCE_ENV']

    const app = express()
    app.use(express.json())
    app.use('/', instanceLifecycleRouter)
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    vi.resetAllMocks()
    delete process.env['IRANTI_HOME']
    delete process.env['IRANTI_INSTANCE_ENV']
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('normalizes legacy anthropic input to claude and passes the selected runtime root to the CLI', async () => {
    runIrantiCommandMock.mockImplementation(async (args) => {
      expect(args).toEqual([
        'instance',
        'create',
        'alpha',
        '--root',
        runtimeRoot,
        '--port',
        '4301',
        '--db-url',
        'postgresql://postgres:postgres@localhost:5432/alpha',
        '--provider',
        'claude',
        '--provider-key',
        'sk-ant-real',
      ])
      await writeInstanceFiles(runtimeRoot, 'alpha', {
        IRANTI_INSTANCE_NAME: 'alpha',
        IRANTI_PORT: '4301',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/alpha',
        LLM_PROVIDER: 'claude',
        IRANTI_API_KEY: 'replace_me_with_api_key',
        ANTHROPIC_API_KEY: 'sk-ant-real',
      }, 4301)
      return { resolution: null as never, stdout: '', stderr: '' }
    })

    const res = await fetch(`${apiBase}/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'alpha',
        port: 4301,
        dbUrl: 'postgresql://postgres:postgres@localhost:5432/alpha',
        provider: 'anthropic',
        providerKey: 'sk-ant-real',
      }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.provider).toBe('claude')
    expect(String(body.note)).toContain('iranti run --instance alpha')
    const envRaw = await readFile(join(runtimeRoot, 'instances', 'alpha', '.env'), 'utf8')
    expect(envRaw).toContain('LLM_PROVIDER=claude')
    expect(envRaw).toContain('ANTHROPIC_API_KEY=sk-ant-real')
  })

  it('rejects providerKey for ollama to match current Iranti CLI semantics', async () => {
    const res = await fetch(`${apiBase}/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'beta',
        port: 4302,
        dbUrl: 'postgresql://postgres:postgres@localhost:5432/beta',
        provider: 'ollama',
        providerKey: 'http://localhost:11434',
      }),
    })

    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, unknown>
    expect(body.code).toBe('INVALID_PARAM')
    expect(String(body.error)).toContain("does not accept providerKey")
    expect(runIrantiCommandMock).not.toHaveBeenCalled()
  })

  it('repairs a partial instance directory through the upstream configure path', async () => {
    await mkdir(join(runtimeRoot, 'instances', 'repairme'), { recursive: true })

    runIrantiCommandMock.mockImplementation(async (args) => {
      expect(args).toEqual([
        'configure',
        'instance',
        'repairme',
        '--root',
        runtimeRoot,
        '--port',
        '4310',
        '--db-url',
        'postgresql://postgres:postgres@localhost:5432/repairme',
        '--provider',
        'claude',
      ])
      await writeInstanceFiles(runtimeRoot, 'repairme', {
        IRANTI_INSTANCE_NAME: 'repairme',
        IRANTI_PORT: '4310',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/repairme',
        LLM_PROVIDER: 'claude',
        IRANTI_API_KEY: 'replace_me_with_api_key',
      }, 4310)
      return { resolution: null as never, stdout: '', stderr: '' }
    })
    runIrantiJsonMock.mockResolvedValue({
      resolution: null as never,
      stdout: '',
      stderr: '',
      json: {
        instances: [{ name: 'repairme', runtime: { running: true, classification: 'running' } }],
      },
    })

    const res = await fetch(`${apiBase}/instances/repairme`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        port: 4310,
        dbUrl: 'postgresql://postgres:postgres@localhost:5432/repairme',
        provider: 'claude',
      }),
    })

    const body = await res.json() as Record<string, unknown>
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body.restartRequired).toBe(true)
    expect(body.changed).toEqual(['DATABASE_URL', 'IRANTI_API_KEY', 'IRANTI_INSTANCE_NAME', 'IRANTI_PORT', 'LLM_PROVIDER'])
    const metaRaw = await readFile(join(runtimeRoot, 'instances', 'repairme', 'instance.json'), 'utf8')
    expect(metaRaw).toContain('4310')
  })

  it('updates dbUrl and providerKey against the current provider when the instance already exists', async () => {
    await writeInstanceFiles(runtimeRoot, 'gamma', {
      IRANTI_INSTANCE_NAME: 'gamma',
      IRANTI_PORT: '4311',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/old_gamma',
      LLM_PROVIDER: 'claude',
      IRANTI_API_KEY: 'replace_me_with_api_key',
      ANTHROPIC_API_KEY: 'sk-old',
    }, 4311)

    runIrantiCommandMock.mockImplementation(async (args) => {
      expect(args).toEqual([
        'configure',
        'instance',
        'gamma',
        '--root',
        runtimeRoot,
        '--db-url',
        'postgresql://postgres:postgres@localhost:5432/new_gamma',
        '--provider-key',
        'sk-new',
      ])
      await writeInstanceFiles(runtimeRoot, 'gamma', {
        IRANTI_INSTANCE_NAME: 'gamma',
        IRANTI_PORT: '4311',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/new_gamma',
        LLM_PROVIDER: 'claude',
        IRANTI_API_KEY: 'replace_me_with_api_key',
        ANTHROPIC_API_KEY: 'sk-new',
      }, 4311)
      return { resolution: null as never, stdout: '', stderr: '' }
    })
    runIrantiJsonMock.mockResolvedValue({
      resolution: null as never,
      stdout: '',
      stderr: '',
      json: {
        instances: [{ name: 'gamma', runtime: { running: false, classification: 'stale' } }],
      },
    })

    const res = await fetch(`${apiBase}/instances/gamma`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dbUrl: 'postgresql://postgres:postgres@localhost:5432/new_gamma',
        providerKey: 'sk-new',
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.restartRequired).toBe(false)
    expect(body.changed).toEqual(['ANTHROPIC_API_KEY', 'DATABASE_URL'])
  })

  it('requires typed confirmation before deleting an instance', async () => {
    await writeInstanceFiles(runtimeRoot, 'delta', {
      IRANTI_INSTANCE_NAME: 'delta',
      IRANTI_PORT: '4312',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/delta',
      LLM_PROVIDER: 'claude',
      IRANTI_API_KEY: 'replace_me_with_api_key',
    }, 4312)

    const res = await fetch(`${apiBase}/instances/delta`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmName: 'not-delta' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, unknown>
    expect(body.code).toBe('CONFIRMATION_REQUIRED')
    expect(existsSync(join(runtimeRoot, 'instances', 'delta'))).toBe(true)
  })

  it('refuses to delete a running instance', async () => {
    await writeInstanceFiles(runtimeRoot, 'epsilon', {
      IRANTI_INSTANCE_NAME: 'epsilon',
      IRANTI_PORT: '4313',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/epsilon',
      LLM_PROVIDER: 'openai',
      IRANTI_API_KEY: 'replace_me_with_api_key',
      OPENAI_API_KEY: 'sk-openai',
    }, 4313)

    runIrantiJsonMock.mockResolvedValue({
      resolution: null as never,
      stdout: '',
      stderr: '',
      json: {
        instances: [{ name: 'epsilon', runtime: { running: true, classification: 'running' } }],
      },
    })

    const res = await fetch(`${apiBase}/instances/epsilon`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmName: 'epsilon' }),
    })

    expect(res.status).toBe(409)
    const body = await res.json() as Record<string, unknown>
    expect(body.code).toBe('INSTANCE_RUNNING')
    expect(existsSync(join(runtimeRoot, 'instances', 'epsilon'))).toBe(true)
  })

  it('deletes the instance directory, bound project files, and optionally drops the database', async () => {
    const projectPath = join(tempRoot, 'bound-project')
    await mkdir(projectPath, { recursive: true })
    await writeInstanceFiles(runtimeRoot, 'zeta', {
      IRANTI_INSTANCE_NAME: 'zeta',
      IRANTI_PORT: '4314',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/zeta_db',
      LLM_PROVIDER: 'claude',
      IRANTI_API_KEY: 'replace_me_with_api_key',
      ANTHROPIC_API_KEY: 'sk-ant-zeta',
    }, 4314)
    await writeFile(
      join(runtimeRoot, 'instances', 'zeta', 'projects.json'),
      JSON.stringify({ projects: [{ projectPath }] }, null, 2),
      'utf8',
    )
    await writeFile(
      join(projectPath, '.env.iranti'),
      'IRANTI_INSTANCE=zeta\nIRANTI_INSTANCE_ENV=C:\\fake\\.env\n',
      'utf8',
    )

    runIrantiJsonMock.mockResolvedValue({
      resolution: null as never,
      stdout: '',
      stderr: '',
      json: {
        instances: [{ name: 'zeta', runtime: { running: false, classification: 'stale' } }],
      },
    })

    const res = await fetch(`${apiBase}/instances/zeta`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirmName: 'zeta',
        removeProjectBindings: true,
        dropDatabase: true,
      }),
    })

    const body = await res.json() as Record<string, unknown>
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body.deleted).toBe(true)
    expect(body.droppedDatabase).toBe('zeta_db')
    expect(body.removedProjectBindings).toEqual([join(projectPath, '.env.iranti')])
    expect(existsSync(join(runtimeRoot, 'instances', 'zeta'))).toBe(false)
    expect(existsSync(join(projectPath, '.env.iranti'))).toBe(false)

    const poolInstance = PoolMock.mock.results.at(-1)?.value as { query: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
    expect(poolInstance.query).toHaveBeenCalledTimes(2)
    expect(poolInstance.query.mock.calls[0]?.[0]).toContain('pg_terminate_backend')
    expect(poolInstance.query.mock.calls[1]?.[0]).toContain('DROP DATABASE IF EXISTS')
  })

  it('migrates a legacy-root instance to the preferred runtime root and rewrites bound project env files', async () => {
    const legacyRoot = join(tempRoot, '.iranti')
    const primaryRoot = join(tempRoot, '.iranti-runtime-primary')
    const projectPath = join(tempRoot, 'legacy-bound-project')
    await mkdir(projectPath, { recursive: true })
    await mkdir(join(legacyRoot, 'instances'), { recursive: true })
    await mkdir(join(primaryRoot, 'instances'), { recursive: true })

    runtimeRootCandidatesMock.mockReturnValue([legacyRoot, primaryRoot])
    process.env['IRANTI_HOME'] = primaryRoot

    await writeInstanceFiles(legacyRoot, 'legacyalpha', {
      IRANTI_INSTANCE_NAME: 'legacyalpha',
      IRANTI_PORT: '4315',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/legacyalpha',
      LLM_PROVIDER: 'claude',
      IRANTI_API_KEY: 'replace_me_with_api_key',
    }, 4315)

    const oldEnvPath = join(legacyRoot, 'instances', 'legacyalpha', '.env')
    await writeFile(
      join(legacyRoot, 'instances', 'legacyalpha', 'projects.json'),
      JSON.stringify({ projects: [{ projectPath }] }, null, 2),
      'utf8',
    )
    await writeFile(
      join(projectPath, '.env.iranti'),
      [
        'IRANTI_INSTANCE=legacyalpha',
        `IRANTI_INSTANCE_ENV=${oldEnvPath}`,
      ].join('\n') + '\n',
      'utf8',
    )

    runIrantiJsonMock.mockResolvedValue({
      resolution: null as never,
      stdout: '',
      stderr: '',
      json: {
        instances: [{ name: 'legacyalpha', runtime: { running: false, classification: 'stale' } }],
      },
    })

    const res = await fetch(`${apiBase}/instances/legacyalpha/migrate-root`, {
      method: 'POST',
    })

    const body = await res.json() as Record<string, unknown>
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body.migrated).toBe(true)
    expect(body.runtimeRoot).toBe(primaryRoot)
    expect(body.runtimeRootKind).toBe('custom')

    const newEnvPath = join(primaryRoot, 'instances', 'legacyalpha', '.env')
    expect(existsSync(newEnvPath)).toBe(true)
    expect(existsSync(join(legacyRoot, 'instances', 'legacyalpha'))).toBe(false)

    const bindingRaw = await readFile(join(projectPath, '.env.iranti'), 'utf8')
    expect(bindingRaw).toContain(`IRANTI_INSTANCE_ENV=${newEnvPath}`)
  })
})
