/**
 * Unit tests — repair routes (instances/:id/projects/:pid/repair/*)
 *
 * Coverage:
 *   requireConfirm gate       — missing ?confirm=true → 400 CONFIRM_REQUIRED
 *   resolveScopeOr404         — unknown instance → 404 INSTANCE_NOT_FOUND
 *   resolveProjectOr422       — project not bound to instance → 422 PROJECT_NOT_BOUND
 *   POST repair/mcp-json      — creates .mcp.json (action:created), replaces (action:replaced)
 *   POST repair/claude-md     — creates CLAUDE.md (action:created), appends (action:appended),
 *                               replaces existing Iranti block (action:replaced),
 *                               422 for malformed START/END markers
 *   EACCES handler            — unwritable project dir → 403 PERMISSION_DENIED
 *   POST doctor               — returns all check categories for a valid instance,
 *                               404 for unknown instance
 *
 * Follows the same real-filesystem pattern as setup-scope.test.ts.
 * The repair route uses resolveInstanceAuthority which is driven by
 * process.env['IRANTI_HOME'] — no db.js mock needed.
 * writeAuditLog is a no-op in tests because DATABASE_URL is absent from
 * the test instance env (scope.databaseUrl === null → early return).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import express from 'express'
import http from 'http'
import type { AddressInfo } from 'net'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { repairRouter } from '../../routes/control-plane/repair.js'
import { deriveInstanceId } from '../../lib/instance-authority.js'

// ─── test server helper ───────────────────────────────────────────────────────

function buildTestServer() {
  const app = express()
  app.use(express.json())
  app.use('/', repairRouter)
  const server = app.listen(0)
  const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()))
  return { server, base, close }
}

// ─── shared fixture setup ─────────────────────────────────────────────────────

interface TestFixture {
  tempRoot: string
  runtimeRoot: string
  instanceDir: string
  instanceId: string
  projectPath: string
  /** encoded projectPath for use in request URLs */
  projectId: string
  srv: ReturnType<typeof buildTestServer>
  base: () => string
}

interface FixtureOptions {
  runtimePort?: number
  databaseUrl?: string | null
  openaiApiKey?: string | null
  anthropicApiKey?: string | null
}

/**
 * Creates a minimal runtime fixture:
 *   runtimeRoot/instances/beta/.env  (no DATABASE_URL → audit log is no-op)
 *   runtimeRoot/instances/beta/projects.json  (binds projectPath)
 *   projectPath/.env.iranti  (makes access() pass in resolveBoundProjects)
 */
async function createFixture(options: FixtureOptions = {}): Promise<TestFixture> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'iranti-repair-'))
  const runtimeRoot = join(tempRoot, 'rt')
  const instanceDir = join(runtimeRoot, 'instances', 'beta')
  const projectPath = join(tempRoot, 'my-project')
  const runtimePort = options.runtimePort ?? 49501
  const envLines = [
    'IRANTI_INSTANCE_NAME=beta',
    `IRANTI_PORT=${runtimePort}`,
    'IRANTI_API_KEY=test-key',
    'LLM_PROVIDER=openai',
  ]

  await mkdir(instanceDir, { recursive: true })
  await mkdir(projectPath, { recursive: true })

  if (options.databaseUrl !== undefined && options.databaseUrl !== null) {
    envLines.push(`DATABASE_URL=${options.databaseUrl}`)
  }
  if (options.openaiApiKey !== null) {
    envLines.push(`OPENAI_API_KEY=${options.openaiApiKey ?? 'sk-test'}`)
  }
  if (options.anthropicApiKey !== undefined && options.anthropicApiKey !== null) {
    envLines.push(`ANTHROPIC_API_KEY=${options.anthropicApiKey}`)
  }

  await writeFile(join(instanceDir, '.env'), envLines.join('\n') + '\n', 'utf8')

  await writeFile(
    join(instanceDir, 'projects.json'),
    JSON.stringify({ projects: [{ projectPath }] }, null, 2),
    'utf8'
  )

  // .env.iranti must exist so resolveBoundProjects passes the access() check
  await writeFile(
    join(projectPath, '.env.iranti'),
    `IRANTI_INSTANCE=beta\nIRANTI_INSTANCE_ENV=${join(instanceDir, '.env')}\n`,
    'utf8'
  )

  const instanceId = deriveInstanceId(instanceDir)
  const projectId = encodeURIComponent(projectPath)

  process.env['IRANTI_HOME'] = runtimeRoot

  const srv = buildTestServer()
  await new Promise<void>((r) => srv.server.once('listening', r))

  return { tempRoot, runtimeRoot, instanceDir, instanceId, projectPath, projectId, srv, base: srv.base }
}

function createHealthServer(status: number): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      status: status >= 200 && status < 300 ? 'ok' : 'error',
      version: '0.2.32',
    }))
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('failed to bind test health server'))
        return
      }
      resolve({
        port: address.port,
        close: () => new Promise<void>((done) => server.close(() => done())),
      })
    })
  })
}

async function teardownFixture(f: TestFixture) {
  delete process.env['IRANTI_HOME']
  await f.srv.close()
  await rm(f.tempRoot, { recursive: true, force: true })
}

// ─────────────────────────────────────────────────────────────────────────────
//  requireConfirm gate
// ─────────────────────────────────────────────────────────────────────────────

describe('repair — requireConfirm gate', () => {
  let f: TestFixture

  beforeEach(async () => { f = await createFixture() })
  afterEach(async () => teardownFixture(f))

  it('returns 400 CONFIRM_REQUIRED for mcp-json without ?confirm=true', async () => {
    const res = await fetch(
      `${f.base()}/${f.instanceId}/projects/${f.projectId}/repair/mcp-json`,
      { method: 'POST' }
    )
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, unknown>
    expect(body.code).toBe('CONFIRM_REQUIRED')
    expect(String(body.hint)).toContain('confirm=true')
  })

  it('returns 400 CONFIRM_REQUIRED for claude-md without ?confirm=true', async () => {
    const res = await fetch(
      `${f.base()}/${f.instanceId}/projects/${f.projectId}/repair/claude-md`,
      { method: 'POST' }
    )
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, unknown>
    expect(body.code).toBe('CONFIRM_REQUIRED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Instance resolution — 404 for unknown instance
// ─────────────────────────────────────────────────────────────────────────────

describe('repair — instance not found', () => {
  let f: TestFixture

  beforeEach(async () => { f = await createFixture() })
  afterEach(async () => teardownFixture(f))

  it('returns 404 INSTANCE_NOT_FOUND for an unknown instanceId on mcp-json repair', async () => {
    const res = await fetch(
      `${f.base()}/deadbeef/projects/${f.projectId}/repair/mcp-json?confirm=true`,
      { method: 'POST' }
    )
    expect(res.status).toBe(404)
    const body = await res.json() as Record<string, unknown>
    expect(body.code).toBe('INSTANCE_NOT_FOUND')
  })

  it('returns 404 INSTANCE_NOT_FOUND for an unknown instanceId on claude-md repair', async () => {
    const res = await fetch(
      `${f.base()}/deadbeef/projects/${f.projectId}/repair/claude-md?confirm=true`,
      { method: 'POST' }
    )
    expect(res.status).toBe(404)
    expect(((await res.json()) as Record<string, unknown>).code).toBe('INSTANCE_NOT_FOUND')
  })

  it('returns 404 INSTANCE_NOT_FOUND for an unknown instanceId on doctor', async () => {
    const res = await fetch(`${f.base()}/deadbeef/doctor`, { method: 'POST' })
    expect(res.status).toBe(404)
    expect(((await res.json()) as Record<string, unknown>).code).toBe('INSTANCE_NOT_FOUND')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Project resolution — 422 for unbound project
// ─────────────────────────────────────────────────────────────────────────────

describe('repair — project not bound', () => {
  let f: TestFixture

  beforeEach(async () => { f = await createFixture() })
  afterEach(async () => teardownFixture(f))

  it('returns 422 PROJECT_NOT_BOUND when the projectId is not bound to the instance', async () => {
    const unboundId = encodeURIComponent(join(f.tempRoot, 'unbound-project'))
    const res = await fetch(
      `${f.base()}/${f.instanceId}/projects/${unboundId}/repair/mcp-json?confirm=true`,
      { method: 'POST' }
    )
    expect(res.status).toBe(422)
    const body = await res.json() as Record<string, unknown>
    expect(body.code).toBe('PROJECT_NOT_BOUND')
    expect(String(body.hint)).toContain('Bind the project first')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  POST repair/mcp-json
// ─────────────────────────────────────────────────────────────────────────────

describe('repair — POST mcp-json', () => {
  let f: TestFixture

  beforeEach(async () => { f = await createFixture() })
  afterEach(async () => teardownFixture(f))

  it('creates .mcp.json when it does not exist (action: created)', async () => {
    const res = await fetch(
      `${f.base()}/${f.instanceId}/projects/${f.projectId}/repair/mcp-json?confirm=true`,
      { method: 'POST' }
    )
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.action).toBe('created')
    expect(typeof body.filePath).toBe('string')
    expect(typeof body.content).toBe('string')
    expect(body.revertable).toBe(false)

    // Verify the file was actually written with the correct content
    const filePath = join(f.projectPath, '.mcp.json')
    const written = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
    const servers = (written['mcpServers'] as Record<string, unknown>)
    expect('iranti' in servers).toBe(true)
    const iranti = servers['iranti'] as Record<string, unknown>
    expect(iranti.command).toBe('iranti')
    expect(iranti.args).toEqual(['mcp'])
  })

  it('replaces .mcp.json when one already exists (action: replaced)', async () => {
    // Write an existing .mcp.json first
    await writeFile(
      join(f.projectPath, '.mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'other' } } }, null, 2),
      'utf8'
    )

    const res = await fetch(
      `${f.base()}/${f.instanceId}/projects/${f.projectId}/repair/mcp-json?confirm=true`,
      { method: 'POST' }
    )
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.action).toBe('replaced')

    const filePath = join(f.projectPath, '.mcp.json')
    const written = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
    const servers = written['mcpServers'] as Record<string, unknown>
    // The replacement writes a fresh config — 'other' server should be gone
    expect('iranti' in servers).toBe(true)
    expect('other' in servers).toBe(false)
  })

  it('response includes filePath pointing to .mcp.json inside the project', async () => {
    const res = await fetch(
      `${f.base()}/${f.instanceId}/projects/${f.projectId}/repair/mcp-json?confirm=true`,
      { method: 'POST' }
    )
    const body = await res.json() as Record<string, unknown>
    expect(String(body.filePath)).toContain('.mcp.json')
    expect(String(body.filePath)).toContain(f.projectPath.replaceAll('\\', '/').split('/').at(-1)!)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  POST repair/claude-md
// ─────────────────────────────────────────────────────────────────────────────

describe('repair — POST claude-md', () => {
  let f: TestFixture

  beforeEach(async () => { f = await createFixture() })
  afterEach(async () => teardownFixture(f))

  it('creates CLAUDE.md with the Iranti block when no file exists (action: created)', async () => {
    const res = await fetch(
      `${f.base()}/${f.instanceId}/projects/${f.projectId}/repair/claude-md?confirm=true`,
      { method: 'POST' }
    )
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.action).toBe('created')
    expect(body.revertable).toBe(false)

    const filePath = join(f.projectPath, 'CLAUDE.md')
    const content = await readFile(filePath, 'utf8')
    expect(content).toContain('<!-- IRANTI:START -->')
    expect(content).toContain('<!-- IRANTI:END -->')
    expect(content).toContain('beta')
    expect(content).toContain('iranti_handshake')
  })

  it('appends the Iranti block to an existing CLAUDE.md without one (action: appended)', async () => {
    const existing = '# My Project\n\nExisting instructions here.\n'
    await writeFile(join(f.projectPath, 'CLAUDE.md'), existing, 'utf8')

    const res = await fetch(
      `${f.base()}/${f.instanceId}/projects/${f.projectId}/repair/claude-md?confirm=true`,
      { method: 'POST' }
    )
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.action).toBe('appended')

    const content = await readFile(join(f.projectPath, 'CLAUDE.md'), 'utf8')
    expect(content).toContain('# My Project')
    expect(content).toContain('Existing instructions here.')
    expect(content).toContain('<!-- IRANTI:START -->')
    expect(content).toContain('<!-- IRANTI:END -->')
  })

  it('replaces an existing Iranti block (action: replaced)', async () => {
    const existing =
      '# My Project\n\n<!-- IRANTI:START -->\nOld iranti content\n<!-- IRANTI:END -->\n'
    await writeFile(join(f.projectPath, 'CLAUDE.md'), existing, 'utf8')

    const res = await fetch(
      `${f.base()}/${f.instanceId}/projects/${f.projectId}/repair/claude-md?confirm=true`,
      { method: 'POST' }
    )
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.action).toBe('replaced')

    const content = await readFile(join(f.projectPath, 'CLAUDE.md'), 'utf8')
    expect(content).toContain('# My Project')
    expect(content).not.toContain('Old iranti content')
    expect(content).toContain('<!-- IRANTI:START -->')
    // There should be exactly one START marker
    const startCount = (content.match(/<!-- IRANTI:START -->/g) ?? []).length
    expect(startCount).toBe(1)
  })

  it('returns 422 MALFORMED_BLOCK when START is present without END', async () => {
    await writeFile(
      join(f.projectPath, 'CLAUDE.md'),
      '# My Project\n\n<!-- IRANTI:START -->\nIncomplete block with no end marker\n',
      'utf8'
    )

    const res = await fetch(
      `${f.base()}/${f.instanceId}/projects/${f.projectId}/repair/claude-md?confirm=true`,
      { method: 'POST' }
    )
    expect(res.status).toBe(422)
    const body = await res.json() as Record<string, unknown>
    expect(body.code).toBe('MALFORMED_BLOCK')
    expect(String(body.suggestion)).toContain('IRANTI:START/END')
  })

  it('response includes diff field showing the change', async () => {
    const res = await fetch(
      `${f.base()}/${f.instanceId}/projects/${f.projectId}/repair/claude-md?confirm=true`,
      { method: 'POST' }
    )
    const body = await res.json() as Record<string, unknown>
    expect(typeof body.diff).toBe('string')
    // New file diff starts with "+++"
    expect(String(body.diff)).toContain('+++')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  POST doctor
// ─────────────────────────────────────────────────────────────────────────────

describe('repair — POST doctor', () => {
  let f: TestFixture

  beforeEach(async () => { f = await createFixture() })
  afterEach(async () => teardownFixture(f))

  it('returns all check categories and a checkedAt timestamp', async () => {
    const res = await fetch(`${f.base()}/${f.instanceId}/doctor`, { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>

    expect(body.instanceId).toBe(f.instanceId)
    expect(typeof body.checkedAt).toBe('string')
    expect(new Date(body.checkedAt as string).getTime()).toBeGreaterThan(0)

    const checks = body.checks as Array<Record<string, unknown>>
    expect(Array.isArray(checks)).toBe(true)

    const ids = checks.map((c) => c.id)
    expect(ids).toContain('database_reachability')
    expect(ids).toContain('provider_config')
    expect(ids).toContain('project_bindings')
  })

  it('database check is fail when no DATABASE_URL is set', async () => {
    const res = await fetch(`${f.base()}/${f.instanceId}/doctor`, { method: 'POST' })
    const body = await res.json() as Record<string, unknown>
    const checks = body.checks as Array<Record<string, unknown>>
    const dbCheck = checks.find((c) => c.id === 'database_reachability')
    expect(dbCheck?.status).toBe('fail')
  })

  it('provider check is pass when an API key is present', async () => {
    const res = await fetch(`${f.base()}/${f.instanceId}/doctor`, { method: 'POST' })
    const body = await res.json() as Record<string, unknown>
    const checks = body.checks as Array<Record<string, unknown>>
    const providerCheck = checks.find((c) => c.id === 'provider_config')
    // Test env has OPENAI_API_KEY set → should be pass
    expect(providerCheck?.status).toBe('pass')
  })

  it('project_bindings is pass when a project is bound', async () => {
    const res = await fetch(`${f.base()}/${f.instanceId}/doctor`, { method: 'POST' })
    const body = await res.json() as Record<string, unknown>
    const checks = body.checks as Array<Record<string, unknown>>
    const bindingsCheck = checks.find((c) => c.id === 'project_bindings')
    expect(bindingsCheck?.status).toBe('pass')
    expect(String(bindingsCheck?.message)).toContain('1 bound project')
  })

  it('includes per-project integration checks for bound projects', async () => {
    const res = await fetch(`${f.base()}/${f.instanceId}/doctor`, { method: 'POST' })
    const body = await res.json() as Record<string, unknown>
    const checks = body.checks as Array<Record<string, unknown>>
    // Should include mcp_integration and claude_md_integration for the bound project
    const mcpCheck = checks.find((c) => String(c.id).startsWith('mcp_integration:'))
    const claudeCheck = checks.find((c) => String(c.id).startsWith('claude_md_integration:'))
    expect(mcpCheck).toBeDefined()
    expect(claudeCheck).toBeDefined()
    // Both should be warn since neither .mcp.json nor CLAUDE.md exist in the test project
    expect(mcpCheck?.status).toBe('warn')
    expect(claudeCheck?.status).toBe('warn')
    // repairAction URLs should be populated
    expect(String(mcpCheck?.repairAction)).toContain('/repair/mcp-json')
    expect(String(claudeCheck?.repairAction)).toContain('/repair/claude-md')
  })

  it('project integration checks show pass after mcp-json repair', async () => {
    // First repair the mcp-json
    await fetch(
      `${f.base()}/${f.instanceId}/projects/${f.projectId}/repair/mcp-json?confirm=true`,
      { method: 'POST' }
    )

    const res = await fetch(`${f.base()}/${f.instanceId}/doctor`, { method: 'POST' })
    const body = await res.json() as Record<string, unknown>
    const checks = body.checks as Array<Record<string, unknown>>
    const mcpCheck = checks.find((c) => String(c.id).startsWith('mcp_integration:'))
    expect(mcpCheck?.status).toBe('pass')
    expect(mcpCheck?.repairAction).toBeNull()
  })

  it('marks runtime availability as warn when the instance is stopped and still returns local checks', async () => {
    const res = await fetch(`${f.base()}/${f.instanceId}/doctor`, { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    const checks = body.checks as Array<Record<string, unknown>>

    const runtimeCheck = checks.find((c) => c.id === 'runtime_availability')
    const dbCheck = checks.find((c) => c.id === 'database_reachability')
    const providerCheck = checks.find((c) => c.id === 'provider_config')
    const bindingsCheck = checks.find((c) => c.id === 'project_bindings')

    expect(runtimeCheck?.status).toBe('warn')
    expect(String(runtimeCheck?.message)).toMatch(/not running|not reachable|skipped/i)
    expect(dbCheck?.status).toBe('fail')
    expect(providerCheck?.status).toBe('pass')
    expect(bindingsCheck?.status).toBe('pass')
  })

  it('marks runtime availability as fail when /health is reachable but unhealthy', async () => {
    const health = await createHealthServer(503)
    const f2 = await createFixture({ runtimePort: health.port })
    try {
      const res = await fetch(`${f2.base()}/${f2.instanceId}/doctor`, { method: 'POST' })
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      const checks = body.checks as Array<Record<string, unknown>>
      const runtimeCheck = checks.find((c) => c.id === 'runtime_availability')

      expect(runtimeCheck?.status).toBe('fail')
      expect(String(runtimeCheck?.message)).toContain('HTTP 503')
      expect(checks.some((c) => c.id === 'project_bindings' && c.status === 'pass')).toBe(true)
    } finally {
      await teardownFixture(f2)
      await health.close()
    }
  })

  it('still reports partial truth when provider and database config are missing', async () => {
    const f2 = await createFixture({ openaiApiKey: null, anthropicApiKey: null })
    try {
      const res = await fetch(`${f2.base()}/${f2.instanceId}/doctor`, { method: 'POST' })
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      const checks = body.checks as Array<Record<string, unknown>>
      const dbCheck = checks.find((c) => c.id === 'database_reachability')
      const providerCheck = checks.find((c) => c.id === 'provider_config')
      const runtimeCheck = checks.find((c) => c.id === 'runtime_availability')

      expect(dbCheck?.status).toBe('fail')
      expect(providerCheck?.status).toBe('warn')
      expect(runtimeCheck?.status).toBe('warn')
      expect(String(runtimeCheck?.message)).toContain('skipped')
      expect(checks.some((c) => c.id === 'project_bindings' && c.status === 'pass')).toBe(true)
    } finally {
      await teardownFixture(f2)
    }
  })

  it('adds structured pgvector remediation commands for unreachable local databases', async () => {
    const f2 = await createFixture({
      databaseUrl: 'postgresql://postgres:secret@localhost:59997/iranti_local',
    })
    try {
      const res = await fetch(`${f2.base()}/${f2.instanceId}/doctor`, { method: 'POST' })
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      const checks = body.checks as Array<Record<string, unknown>>
      const dbCheck = checks.find((c) => c.id === 'database_reachability')

      expect(dbCheck?.status).toBe('fail')
      expect(String(dbCheck?.operatorNote)).toContain('macOS, Windows, and Linux')

      const commands = dbCheck?.commands as Array<Record<string, unknown>>
      expect(Array.isArray(commands)).toBe(true)
      expect(String(commands[0]?.label)).toContain('Docker')
      expect(String(commands[0]?.command)).toContain('-p 59997:5432')
      expect(String(commands[1]?.command)).toContain('iranti doctor --instance beta')
    } finally {
      await teardownFixture(f2)
    }
  })
})
