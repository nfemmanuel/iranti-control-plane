/**
 * Unit tests — lifecycle routes (CP-T080)
 *
 * Coverage:
 *   isValidInstanceName   — rejects bad chars, over-length; accepts valid
 *   findCliCandidates     — CLI-not-found path
 *   POST /:name/start     — CLI missing, already reachable, successful spawn,
 *                           already tracked alive → 409, stale entry cleanup
 *   POST /:name/stop      — not tracked → 404, tracked → 200 + kill(), kill() throws → still 200
 *   GET  /:name/process-status — not tracked, tracked alive, tracked after exit
 *
 * child_process.spawn and instance-identifiers are mocked so no real OS
 * processes are created. probeIrantiHealth relies on natural ECONNREFUSED for
 * "not reachable" cases; for "already reachable" a targeted fetch stub is used.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'net'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { EventEmitter } from 'events'

// ─── mocks must be declared before any import that loads them ────────────────

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    spawn: vi.fn(),
    execFile: vi.fn(),
  }
})

vi.mock('../../lib/iranti-cli.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/iranti-cli.js')>()
  return {
    ...actual,
    resolveIrantiCli: vi.fn(),
    runIrantiJson: vi.fn(),
  }
})

vi.mock('../../routes/control-plane/instance-identifiers.js', () => ({
  getConfiguredInstanceIdentifiers: vi.fn(),
}))

vi.mock('../../lib/instance-authority.js', () => ({
  resolveInstanceAuthority: vi.fn(),
}))

import { execFile, spawn } from 'child_process'
import { resolveIrantiCli, runIrantiJson } from '../../lib/iranti-cli.js'
import { getConfiguredInstanceIdentifiers } from '../../routes/control-plane/instance-identifiers.js'
import { resolveInstanceAuthority } from '../../lib/instance-authority.js'
import { lifecycleRouter } from '../../routes/control-plane/lifecycle.js'

const spawnMock = vi.mocked(spawn)
const execFileMock = vi.mocked(execFile)
const resolveIrantiCliMock = vi.mocked(resolveIrantiCli)
const runIrantiJsonMock = vi.mocked(runIrantiJson)
const identifiersMock = vi.mocked(getConfiguredInstanceIdentifiers)
const resolveInstanceAuthorityMock = vi.mocked(resolveInstanceAuthority)

// ─── fake ChildProcess helpers ────────────────────────────────────────────────

interface FakeProcess extends EventEmitter {
  stdout: EventEmitter & { setEncoding: (encoding: string) => void }
  kill: ReturnType<typeof vi.fn>
  pid: number | undefined
  exitCode: number | null
  killed: boolean
  unref: ReturnType<typeof vi.fn>
}

const CLI_JS = 'C:\\Users\\NF\\Documents\\Projects\\iranti\\bin\\iranti.js'

/** Fake `where/which iranti` that exits 0 with the given path lines. */
function makeCliFoundProcess(paths: string[]): FakeProcess {
  const proc = new EventEmitter() as FakeProcess
  proc.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  proc.kill = vi.fn()
  proc.pid = undefined
  proc.exitCode = 0
  proc.killed = false
  proc.unref = vi.fn()
  setImmediate(() => {
    for (const p of paths) proc.stdout.emit('data', Buffer.from(p + '\n'))
    proc.emit('exit', 0)
  })
  return proc
}

/** Fake `where/which iranti` that exits 1 (not found). */
function makeCliNotFoundProcess(): FakeProcess {
  const proc = new EventEmitter() as FakeProcess
  proc.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  proc.kill = vi.fn()
  proc.pid = undefined
  proc.exitCode = 1
  proc.killed = false
  proc.unref = vi.fn()
  setImmediate(() => proc.emit('exit', 1))
  return proc
}

/** Fake instance process that is still running (exitCode === null). */
function makeRunningProcess(pid: number): FakeProcess {
  const proc = new EventEmitter() as FakeProcess
  proc.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  proc.kill = vi.fn()
  proc.pid = pid
  proc.exitCode = null
  proc.killed = false
  proc.unref = vi.fn()
  return proc
}

// ─── test server helper ───────────────────────────────────────────────────────

function buildTestServer() {
  const app = express()
  app.use(express.json())
  app.use('/', lifecycleRouter)
  const server = app.listen(0)
  const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()))
  return { server, base, close }
}

// ─── standard spawn mock: CLI found + running instance process ────────────────

/** `where iranti` succeeds; every other spawn call returns a process with the given pid. */
function cliFoundAndInstance(pid: number) {
  return (cmd: string): FakeProcess => {
    if (cmd === 'where' || cmd === 'which') {
      return makeCliFoundProcess([CLI_JS])
    }
    return makeRunningProcess(pid)
  }
}

function mockRunningStatus(name: string, pid: number) {
  runIrantiJsonMock.mockResolvedValue({
    resolution: null as never,
    stdout: '',
    stderr: '',
    json: {
      instances: [
        {
          name,
          runtime: {
            classification: 'running',
            running: true,
            stale: false,
            detail: `pid=${pid} version=0.2.21`,
            state: { pid },
            health: { checked: true, ok: true, detail: 'health ok' },
          },
        },
      ],
    },
  })
}

function mockStoppedStatus(name: string, detail = 'runtime stopped') {
  runIrantiJsonMock.mockResolvedValue({
    resolution: null as never,
    stdout: '',
    stderr: '',
    json: {
      instances: [
        {
          name,
          runtime: {
            classification: 'stopped',
            running: false,
            stale: false,
            detail,
            state: null,
            health: { checked: false, ok: false, detail },
          },
        },
      ],
    },
  })
}

function mockCliResolution() {
  resolveIrantiCliMock.mockResolvedValue({
    command: CLI_JS,
    args: [],
    displayPath: CLI_JS,
    source: 'repo-local',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
//  Input validation
// ─────────────────────────────────────────────────────────────────────────────

describe('lifecycle — input validation', () => {
  let srv: ReturnType<typeof buildTestServer>

  beforeEach(async () => {
    srv = buildTestServer()
    await new Promise<void>((r) => srv.server.once('listening', r))
  })

  afterEach(async () => srv.close())

  const INVALID: Array<[string, string]> = [
    ['shell injection (semicolon)', 'foo;bar'],
    ['spaces', 'my instance'],
    ['path traversal', '../escape'],
    ['too long (65 chars)', 'a'.repeat(65)],
    ['forward slash', 'foo/bar'],
    ['ampersand', 'foo&bar'],
    ['exclamation mark', 'foo!bar'],
  ]

  it.each(INVALID)('POST /start rejects %s → 400 INVALID_PARAM', async (_lbl, name) => {
    const res = await fetch(`${srv.base()}/${encodeURIComponent(name)}/start`, { method: 'POST' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>).code).toBe('INVALID_PARAM')
  })

  it.each(INVALID)('POST /stop rejects %s → 400 INVALID_PARAM', async (_lbl, name) => {
    const res = await fetch(`${srv.base()}/${encodeURIComponent(name)}/stop`, { method: 'POST' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>).code).toBe('INVALID_PARAM')
  })

  it.each(INVALID)('GET /process-status rejects %s → 400 INVALID_PARAM', async (_lbl, name) => {
    const res = await fetch(`${srv.base()}/${encodeURIComponent(name)}/process-status`)
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>).code).toBe('INVALID_PARAM')
  })

  it('accepts a 64-character valid name (does not reject as INVALID_PARAM)', async () => {
    spawnMock.mockImplementation(() => makeCliNotFoundProcess())
    const name64 = 'a'.repeat(64)
    const res = await fetch(`${srv.base()}/${name64}/start`, { method: 'POST' })
    // Whatever error occurs, it must not be INVALID_PARAM
    const body = await res.json() as Record<string, unknown>
    expect(body.code).not.toBe('INVALID_PARAM')
  })

  it('accepts names with hyphens and underscores', async () => {
    spawnMock.mockImplementation(() => makeCliNotFoundProcess())
    const res = await fetch(`${srv.base()}/my-instance_01/start`, { method: 'POST' })
    const body = await res.json() as Record<string, unknown>
    expect(body.code).not.toBe('INVALID_PARAM')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  POST /:name/start
// ─────────────────────────────────────────────────────────────────────────────

describe('lifecycle — POST /:name/start', () => {
  let tempRoot: string
  let runtimeRoot: string
  let srv: ReturnType<typeof buildTestServer>

  // Use distinct ports far from common services to get fast ECONNREFUSED.
  const PORT_A = 38901   // tgtinst
  const PORT_B = 38902   // staleinst
  const PORT_TRACK = 38903  // trackinst — used by "already tracked alive" test
  const PORT_REACH = 38904  // reachinst — used by "already reachable" test (health-stubbed)

  /** Write a minimal instance .env in the test runtimeRoot. */
  async function addInstance(name: string, port: number) {
    await mkdir(join(runtimeRoot, 'instances', name), { recursive: true })
    await writeFile(
      join(runtimeRoot, 'instances', name, '.env'),
      `IRANTI_INSTANCE_NAME=${name}\nIRANTI_PORT=${port}\n`,
      'utf8'
    )
  }

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'iranti-lc-start-'))
    runtimeRoot = join(tempRoot, 'rt')
    process.env['IRANTI_CP_START_CONFIRM_TIMEOUT_MS'] = '250'
    process.env['IRANTI_CP_START_CONFIRM_POLL_MS'] = '5'

    await addInstance('tgtinst', PORT_A)
    await addInstance('staleinst', PORT_B)
    // trackinst: dedicated name for "already tracked" test so tgtinst state doesn't bleed
    await addInstance('trackinst', PORT_TRACK)
    // reachinst: dedicated name for "already reachable" test
    await addInstance('reachinst', PORT_REACH)
    await addInstance('durableinst', PORT_A + 3)
    mockCliResolution()

    identifiersMock.mockReturnValue({
      runtimeRoot,
      instanceDir: join(runtimeRoot, 'instances', 'tgtinst'),
      instanceName: 'tgtinst',
      instanceId: 'test-start-id',
      matches: (c: string) => c === 'tgtinst',
    })
    resolveInstanceAuthorityMock.mockResolvedValue(null)

    srv = buildTestServer()
    await new Promise<void>((r) => srv.server.once('listening', r))
  })

  afterEach(async () => {
    vi.resetAllMocks()
    vi.unstubAllGlobals()
    delete process.env['IRANTI_CP_START_CONFIRM_TIMEOUT_MS']
    delete process.env['IRANTI_CP_START_CONFIRM_POLL_MS']
    await srv.close()
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('returns 400 CLI_NOT_FOUND when iranti is not on PATH', async () => {
    resolveIrantiCliMock.mockResolvedValue(null)
    const res = await fetch(`${srv.base()}/tgtinst/start`, { method: 'POST' })
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, unknown>
    expect(body.code).toBe('CLI_NOT_FOUND')
    expect(String(body.error)).toContain('iranti CLI')
  })

  it('returns 409 ALREADY_RUNNING when the instance port is already reachable', async () => {
    spawnMock.mockImplementation(cliFoundAndInstance(11111))
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes(`:${PORT_REACH}/health`)) {
        return Promise.resolve(new Response(null, { status: 200 }))
      }
      return realFetch(url as Parameters<typeof fetch>[0], init)
    })
    const res = await fetch(`${srv.base()}/reachinst/start`, { method: 'POST' })
    expect(res.status).toBe(409)
    const body = await res.json() as Record<string, unknown>
    expect(body.code).toBe('ALREADY_RUNNING')
    expect(String(body.error)).toContain('already reachable')
  })

  it('returns 200 with pid and status:started only after runtime confirmation', async () => {
    spawnMock.mockImplementation(cliFoundAndInstance(55000))
    mockStoppedStatus('tgtinst')
    runIrantiJsonMock.mockResolvedValueOnce({
      resolution: null as never,
      stdout: '',
      stderr: '',
      json: {
        instances: [
          {
            name: 'tgtinst',
            runtime: {
              classification: 'stopped',
              running: false,
              stale: false,
              detail: 'runtime stopped',
              state: null,
              health: { checked: false, ok: false, detail: 'runtime stopped' },
            },
          },
        ],
      },
    })
    runIrantiJsonMock.mockResolvedValueOnce({
      resolution: null as never,
      stdout: '',
      stderr: '',
      json: {
        instances: [
          {
            name: 'tgtinst',
            runtime: {
              classification: 'running',
              running: true,
              stale: false,
              detail: 'pid=55000 version=0.2.21',
              state: { pid: 55000 },
              health: { checked: true, ok: true, detail: 'health ok' },
            },
          },
        ],
      },
    })
    const res = await fetch(`${srv.base()}/tgtinst/start`, { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.instanceName).toBe('tgtinst')
    expect(body.pid).toBe(55000)
    expect(body.status).toBe('started')
    expect(typeof body.startedAt).toBe('string')
    // startedAt should be a valid ISO 8601 date
    expect(new Date(body.startedAt as string).getTime()).toBeGreaterThan(0)
    expect(runIrantiJsonMock).toHaveBeenCalled()
  })

  it('starts against the resolved instance runtime root when it differs from the bound root', async () => {
    const alternateRoot = join(tempRoot, 'legacy-root')
    await mkdir(join(alternateRoot, 'instances', 'legacyinst'), { recursive: true })
    await writeFile(
      join(alternateRoot, 'instances', 'legacyinst', '.env'),
      `IRANTI_INSTANCE_NAME=legacyinst\nIRANTI_PORT=${PORT_A + 10}\n`,
      'utf8'
    )
    resolveInstanceAuthorityMock.mockResolvedValue({
      instanceId: 'legacy-id',
      instanceName: 'legacyinst',
      instanceDir: join(alternateRoot, 'instances', 'legacyinst'),
      instanceEnvPath: join(alternateRoot, 'instances', 'legacyinst', '.env'),
      runtimeRoot: alternateRoot,
      apiBaseUrl: `http://localhost:${PORT_A + 10}`,
      apiKey: null,
      databaseUrl: null,
      env: { IRANTI_PORT: String(PORT_A + 10) },
      boundProjects: [],
      source: 'query',
    })
    spawnMock.mockImplementation(cliFoundAndInstance(55100))
    mockRunningStatus('legacyinst', 55100)

    const res = await fetch(`${srv.base()}/legacyinst/start`, { method: 'POST' })

    expect(res.status).toBe(200)
    const args = spawnMock.mock.calls[0]?.slice(0, 2) as [string, string[]]
    expect(args[0]).toBe(CLI_JS)
    expect(args[1]).toEqual(['run', '--instance', 'legacyinst', '--root', alternateRoot])
  })

  it('returns 409 ALREADY_RUNNING when the same name is started twice while tracked', async () => {
    // Use a dedicated name so tgtinst state from the "success" test doesn't interfere.
    spawnMock.mockImplementation(cliFoundAndInstance(55011))
    mockRunningStatus('trackinst', 55011)
    const first = await fetch(`${srv.base()}/trackinst/start`, { method: 'POST' })
    expect(first.status).toBe(200)

    // Second start — the in-memory entry is alive (exitCode === null)
    const second = await fetch(`${srv.base()}/trackinst/start`, { method: 'POST' })
    expect(second.status).toBe(409)
    const body = await second.json() as Record<string, unknown>
    expect(body.code).toBe('ALREADY_RUNNING')
    expect(body.pid).toBe(55011)
  })

  it('clears a stale entry and spawns fresh when the tracked process has exited', async () => {
    const staleProc = makeRunningProcess(55002)
    spawnMock.mockImplementation((cmd: string): FakeProcess => {
      if (cmd === 'where' || cmd === 'which') return makeCliFoundProcess([CLI_JS])
      return staleProc
    })
    mockRunningStatus('staleinst', 55002)
    const first = await fetch(`${srv.base()}/staleinst/start`, { method: 'POST' })
    expect(first.status).toBe(200)

    // Simulate the process exiting — exitCode becomes non-null
    staleProc.exitCode = 1

    // Re-mock spawn to return a fresh process on next spawn call
    const freshProc = makeRunningProcess(55003)
    spawnMock.mockImplementation((cmd: string): FakeProcess => {
      if (cmd === 'where' || cmd === 'which') return makeCliFoundProcess([CLI_JS])
      return freshProc
    })
    mockRunningStatus('staleinst', 55003)

    const second = await fetch(`${srv.base()}/staleinst/start`, { method: 'POST' })
    expect(second.status).toBe(200)
    const body = await second.json() as Record<string, unknown>
    expect(body.pid).toBe(55003)
  })

  it('returns 500 when the runtime does not become durable after spawn', async () => {
    spawnMock.mockImplementation(cliFoundAndInstance(55004))
    mockStoppedStatus('durableinst')
    const res = await fetch(`${srv.base()}/durableinst/start`, { method: 'POST' })
    expect(res.status).toBe(500)
    const body = await res.json() as Record<string, unknown>
    expect(body.code).toBe('START_CONFIRMATION_TIMEOUT')
    expect(String(body.error)).toContain('did not become running')
    expect(String(body.error)).not.toContain('Spawn succeeded')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  POST /:name/stop
// ─────────────────────────────────────────────────────────────────────────────

describe('lifecycle — POST /:name/stop', () => {
  let tempRoot: string
  let runtimeRoot: string
  let srv: ReturnType<typeof buildTestServer>

  const STOP_PORT = 38921

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'iranti-lc-stop-'))
    runtimeRoot = join(tempRoot, 'rt')

    await mkdir(join(runtimeRoot, 'instances', 'stopinst'), { recursive: true })
    await writeFile(
      join(runtimeRoot, 'instances', 'stopinst', '.env'),
      `IRANTI_INSTANCE_NAME=stopinst\nIRANTI_PORT=${STOP_PORT}\n`,
      'utf8'
    )

    identifiersMock.mockReturnValue({
      runtimeRoot,
      instanceDir: join(runtimeRoot, 'instances', 'stopinst'),
      instanceName: 'stopinst',
      instanceId: 'test-stop-id',
      matches: (c: string) => c === 'stopinst',
    })
    mockCliResolution()

    srv = buildTestServer()
    await new Promise<void>((r) => srv.server.once('listening', r))
  })

  afterEach(async () => {
    vi.resetAllMocks()
    await srv.close()
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('returns 404 NOT_TRACKED for an instance that was never started', async () => {
    const res = await fetch(`${srv.base()}/untracked-stop-inst/stop`, { method: 'POST' })
    expect(res.status).toBe(404)
    const body = await res.json() as Record<string, unknown>
    expect(body.code).toBe('NOT_TRACKED')
    expect(body.pid).toBeNull()
  })

  it('returns 200, calls kill(), and includes pid + stoppedAt for a tracked process', async () => {
    const proc = makeRunningProcess(77700)
    spawnMock.mockImplementation((cmd: string): FakeProcess => {
      if (cmd === 'where' || cmd === 'which') return makeCliFoundProcess([CLI_JS])
      return proc
    })
    mockRunningStatus('stopinst', 77700)
    const startRes = await fetch(`${srv.base()}/stopinst/start`, { method: 'POST' })
    expect(startRes.status).toBe(200)

    const stopRes = await fetch(`${srv.base()}/stopinst/stop`, { method: 'POST' })
    expect(stopRes.status).toBe(200)
    const body = await stopRes.json() as Record<string, unknown>
    expect(body.instanceName).toBe('stopinst')
    expect(body.pid).toBe(77700)
    expect(body.status).toBe('stopped')
    expect(typeof body.stoppedAt).toBe('string')
    expect(proc.kill).toHaveBeenCalledOnce()
  })

  it('returns 200 even when kill() throws (process already exited race condition)', async () => {
    const proc = makeRunningProcess(77701)
    proc.kill = vi.fn().mockImplementation(() => { throw new Error('ESRCH — no such process') })
    spawnMock.mockImplementation((cmd: string): FakeProcess => {
      if (cmd === 'where' || cmd === 'which') return makeCliFoundProcess([CLI_JS])
      return proc
    })
    mockRunningStatus('stopinst', 77701)
    await fetch(`${srv.base()}/stopinst/start`, { method: 'POST' })
    const stopRes = await fetch(`${srv.base()}/stopinst/stop`, { method: 'POST' })
    expect(stopRes.status).toBe(200)
  })

  it('removes the map entry so a subsequent stop returns 404 NOT_TRACKED', async () => {
    const proc = makeRunningProcess(77702)
    spawnMock.mockImplementation((cmd: string): FakeProcess => {
      if (cmd === 'where' || cmd === 'which') return makeCliFoundProcess([CLI_JS])
      return proc
    })
    mockRunningStatus('stopinst', 77702)
    await fetch(`${srv.base()}/stopinst/start`, { method: 'POST' })
    const first = await fetch(`${srv.base()}/stopinst/stop`, { method: 'POST' })
    expect(first.status).toBe(200)

    const second = await fetch(`${srv.base()}/stopinst/stop`, { method: 'POST' })
    expect(second.status).toBe(404)
    expect(((await second.json()) as Record<string, unknown>).code).toBe('NOT_TRACKED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  GET /:name/process-status
// ─────────────────────────────────────────────────────────────────────────────

describe('lifecycle - GET /:name/process-status', () => {
  let tempRoot: string
  let runtimeRoot: string
  let srv: ReturnType<typeof buildTestServer>

  const STATUS_PORT = 38941

  /** Write a minimal instance .env in the test runtimeRoot. */
  async function addInstance(name: string, port: number) {
    await mkdir(join(runtimeRoot, 'instances', name), { recursive: true })
    await writeFile(
      join(runtimeRoot, 'instances', name, '.env'),
      `IRANTI_INSTANCE_NAME=${name}\nIRANTI_PORT=${port}\n`,
      'utf8'
    )
  }

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'iranti-lc-status-'))
    runtimeRoot = join(tempRoot, 'rt')

    // Each test uses a unique instance name to avoid shared managedProcesses state.
    await addInstance('statusinst', STATUS_PORT)
    await addInstance('exitinst', STATUS_PORT + 1)
    await addInstance('killinst', STATUS_PORT + 2)

    identifiersMock.mockReturnValue({
      runtimeRoot,
      instanceDir: join(runtimeRoot, 'instances', 'statusinst'),
      instanceName: 'statusinst',
      instanceId: 'test-status-id',
      matches: (c: string) => c === 'statusinst',
    })
    mockCliResolution()

    srv = buildTestServer()
    await new Promise<void>((r) => srv.server.once('listening', r))
  })

  afterEach(async () => {
    vi.resetAllMocks()
    await srv.close()
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('returns {managed:false, pid:null, alive:null} for an instance not in the process map', async () => {
    const res = await fetch(`${srv.base()}/untracked-status-inst/process-status`)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.managed).toBe(false)
    expect(body.pid).toBeNull()
    expect(body.alive).toBeNull()
  })

  it('returns {managed:true, pid:N, alive:true} for a tracked running process', async () => {
    spawnMock.mockImplementation(cliFoundAndInstance(88800))
    mockRunningStatus('statusinst', 88800)
    await fetch(`${srv.base()}/statusinst/start`, { method: 'POST' })

    const res = await fetch(`${srv.base()}/statusinst/process-status`)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.managed).toBe(true)
    expect(body.pid).toBe(88800)
    expect(body.alive).toBe(true)
  })

  it('returns alive:false when the tracked process has exited (exitCode becomes non-null)', async () => {
    // Use a dedicated name so statusinst (pid 88800) state doesn't interfere.
    const proc = makeRunningProcess(88801)
    spawnMock.mockImplementation((cmd: string): FakeProcess => {
      if (cmd === 'where' || cmd === 'which') return makeCliFoundProcess([CLI_JS])
      return proc
    })
    mockRunningStatus('exitinst', 88801)
    await fetch(`${srv.base()}/exitinst/start`, { method: 'POST' })

    // Simulate natural process exit
    proc.exitCode = 0

    const res = await fetch(`${srv.base()}/exitinst/process-status`)
    const body = await res.json() as Record<string, unknown>
    expect(body.managed).toBe(true)
    expect(body.alive).toBe(false)
  })

  it('returns alive:false when the tracked process was killed', async () => {
    // Use a dedicated name so exitinst / statusinst state doesn't interfere.
    const proc = makeRunningProcess(88802)
    spawnMock.mockImplementation((cmd: string): FakeProcess => {
      if (cmd === 'where' || cmd === 'which') return makeCliFoundProcess([CLI_JS])
      return proc
    })
    mockRunningStatus('killinst', 88802)
    await fetch(`${srv.base()}/killinst/start`, { method: 'POST' })

    // Simulate kill
    proc.killed = true

    const res = await fetch(`${srv.base()}/killinst/process-status`)
    const body = await res.json() as Record<string, unknown>
    expect(body.alive).toBe(false)
  })
})

describe('lifecycle - POST /:name/restart', () => {
  let srv: ReturnType<typeof buildTestServer>

  beforeEach(async () => {
    identifiersMock.mockReturnValue({
      runtimeRoot: 'C:\\runtime-root',
      instanceDir: 'C:\\runtime-root\\instances\\alpha',
      instanceName: 'alpha',
      instanceId: 'restart-id',
      matches: (candidate: string) => candidate === 'alpha',
    })
    resolveInstanceAuthorityMock.mockResolvedValue({
      instanceId: 'restart-id',
      instanceName: 'alpha',
      instanceDir: 'C:\\runtime-root\\instances\\alpha',
      instanceEnvPath: 'C:\\runtime-root\\instances\\alpha\\.env',
      runtimeRoot: 'C:\\runtime-root',
      apiBaseUrl: 'http://localhost:4311',
      apiKey: null,
      databaseUrl: null,
      env: {},
      boundProjects: [],
      source: 'query',
    })
    mockCliResolution()

    srv = buildTestServer()
    await new Promise<void>((r) => srv.server.once('listening', r))
  })

  afterEach(async () => {
    vi.resetAllMocks()
    await srv.close()
  })

  it('returns 202 after delegating restart to the iranti CLI', async () => {
    spawnMock.mockImplementation(() => makeCliFoundProcess([CLI_JS]))
    execFileMock.mockImplementation(((
      _file: string,
      _args: readonly string[],
      _options: unknown,
      callback?: ((error: Error | null, stdout: string, stderr: string) => void) | undefined,
    ) => {
      callback?.(null, '', '')
      return {} as never
    }) as typeof execFile)

    const res = await fetch(`${srv.base()}/alpha/restart`, { method: 'POST' })

    expect(res.status).toBe(202)
    expect(execFileMock).toHaveBeenCalled()
    const args = execFileMock.mock.calls[0]?.[1] as string[]
    expect(args).toEqual([
      CLI_JS,
      'instance',
      'restart',
      'alpha',
      '--root',
      'C:\\runtime-root',
    ])
  })
})
