import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'net'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { constants } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setupRouter } from '../../routes/control-plane/setup.js'
import { deriveInstanceId } from '../../lib/instance-authority.js'

describe('setup status is selected-instance scoped', () => {
  let tempRoot: string
  let runtimeRoot: string
  let appServer: ReturnType<typeof express.application.listen>
  let apiBase: string
  let alphaInstanceId: string
  let projectPath: string

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'iranti-cp-setup-scope-'))
    runtimeRoot = join(tempRoot, '.iranti-runtime')
    projectPath = join(tempRoot, 'bound-project')

    await mkdir(join(runtimeRoot, 'instances', 'alpha'), { recursive: true })
    await mkdir(projectPath, { recursive: true })

    await writeFile(
      join(runtimeRoot, 'instances', 'alpha', '.env'),
      [
        'IRANTI_INSTANCE_NAME=alpha',
        'IRANTI_PORT=4301',
        'LLM_PROVIDER=anthropic',
        'ANTHROPIC_API_KEY=sk-alpha-real',
      ].join('\n') + '\n',
      'utf8'
    )

    await writeFile(
      join(runtimeRoot, 'instances', 'alpha', 'projects.json'),
      JSON.stringify({ projects: [{ projectPath }] }, null, 2),
      'utf8'
    )

    await writeFile(
      join(projectPath, '.env.iranti'),
      [
        'IRANTI_INSTANCE=alpha',
        `IRANTI_INSTANCE_ENV=${join(runtimeRoot, 'instances', 'alpha', '.env')}`,
      ].join('\n') + '\n',
      'utf8'
    )

    alphaInstanceId = deriveInstanceId(join(runtimeRoot, 'instances', 'alpha'))
    process.env['IRANTI_HOME'] = runtimeRoot

    const app = express()
    app.use(express.json())
    app.use('/', setupRouter)
    appServer = app.listen(0)
    await new Promise<void>((resolve) => appServer.once('listening', resolve))
    apiBase = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    delete process.env['IRANTI_HOME']
    await new Promise<void>((resolve) => appServer.close(() => resolve()))
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('returns scope-aware steps, flags anthropic provider drift, and targets the runtime root setup flag', async () => {
    const statusRes = await fetch(`${apiBase}/${alphaInstanceId}/setup-status`)
    const statusBody = await statusRes.json() as Record<string, unknown>

    expect(statusRes.status).toBe(200)
    expect(statusBody.scope).toMatchObject({ instanceId: alphaInstanceId, instanceName: 'alpha' })
    expect(statusBody.runtimeRoot).toBe(runtimeRoot)
    expect(statusBody.runtimeRootKind).toBe('primary')
    expect(statusBody.firstRunDetected).toBe(true)

    const steps = statusBody.steps as Array<Record<string, unknown>>
    const providerStep = steps.find((step) => step.id === 'provider')
    const integrationStep = steps.find((step) => step.id === 'claude_integration')

    expect(providerStep?.status).toBe('warning')
    expect(String(providerStep?.message)).toContain('anthropic')
    expect(String(providerStep?.cliCommand)).toContain('iranti add api-key claude --instance alpha --set-default')

    expect(integrationStep?.status).toBe('warning')
    expect(String(integrationStep?.cliCommand)).toContain('iranti claude-setup')
    expect(integrationStep?.repairAction).toBeNull()

    const completeRes = await fetch(`${apiBase}/${alphaInstanceId}/setup-status/complete`, { method: 'POST' })
    expect(completeRes.status).toBe(200)

    await access(join(runtimeRoot, '.iranti-cp-setup-complete'), constants.F_OK)
    const flagRaw = await readFile(join(runtimeRoot, '.iranti-cp-setup-complete'), 'utf8')
    expect(flagRaw).toContain(alphaInstanceId)

    const refreshedRes = await fetch(`${apiBase}/${alphaInstanceId}/setup-status/refresh`, { method: 'POST' })
    const refreshedBody = await refreshedRes.json() as Record<string, unknown>
    expect(refreshedBody.firstRunDetected).toBe(false)
  })

  it('explains when a local DATABASE_URL points at a dead port under a legacy runtime root', async () => {
    const legacyRoot = join(tempRoot, '.iranti')
    await mkdir(join(legacyRoot, 'instances', 'legacyalpha'), { recursive: true })
    await writeFile(
      join(legacyRoot, 'instances', 'legacyalpha', '.env'),
      [
        'IRANTI_INSTANCE_NAME=legacyalpha',
        'IRANTI_PORT=4399',
        'DATABASE_URL=postgresql://postgres:postgres@localhost:59999/legacyalpha',
      ].join('\n') + '\n',
      'utf8'
    )

    const legacyInstanceId = deriveInstanceId(join(legacyRoot, 'instances', 'legacyalpha'))
    process.env['IRANTI_HOME'] = legacyRoot

    const statusRes = await fetch(`${apiBase}/${legacyInstanceId}/setup-status`)
    const statusBody = await statusRes.json() as Record<string, unknown>

    expect(statusRes.status).toBe(200)
    expect(statusBody.runtimeRoot).toBe(legacyRoot)
    expect(statusBody.runtimeRootKind).toBe('legacy')

    const steps = statusBody.steps as Array<Record<string, unknown>>
    const databaseStep = steps.find((step) => step.id === 'database')
    expect(String(databaseStep?.message)).toContain('localhost:59999')
    expect(String(databaseStep?.actionRequired)).toContain('legacy runtime root')
    expect(String(databaseStep?.actionRequired)).toContain(legacyRoot)
  })

  it('warns when IRANTI_API_KEY_PEPPER is absent and surfaces a repairAction pointing to generate-pepper', async () => {
    // The alpha instance .env in beforeEach does not set IRANTI_API_KEY_PEPPER
    const statusRes = await fetch(`${apiBase}/${alphaInstanceId}/setup-status`)
    const statusBody = await statusRes.json() as Record<string, unknown>

    expect(statusRes.status).toBe(200)
    const steps = statusBody.steps as Array<Record<string, unknown>>
    const pepperStep = steps.find((step) => step.id === 'api_key_pepper')

    expect(pepperStep).toBeDefined()
    expect(pepperStep?.status).toBe('warning')
    expect(String(pepperStep?.message)).toContain('IRANTI_API_KEY_PEPPER')
    expect(typeof pepperStep?.repairAction).toBe('string')
    expect(String(pepperStep?.repairAction)).toContain('/setup-status/generate-pepper')
  })

  it('generate-pepper writes IRANTI_API_KEY_PEPPER to instance env and marks step complete on recheck', async () => {
    const envPath = join(runtimeRoot, 'instances', 'alpha', '.env')

    // Pepper absent before
    const beforeContent = await readFile(envPath, 'utf8')
    expect(beforeContent).not.toContain('IRANTI_API_KEY_PEPPER')

    const repairRes = await fetch(`${apiBase}/${alphaInstanceId}/setup-status/generate-pepper`, { method: 'POST' })
    const repairBody = await repairRes.json() as Record<string, unknown>

    expect(repairRes.status).toBe(200)
    expect(repairBody.success).toBe(true)

    // Pepper now written
    const afterContent = await readFile(envPath, 'utf8')
    const pepperMatch = afterContent.match(/^IRANTI_API_KEY_PEPPER=([0-9a-f]+)$/m)
    expect(pepperMatch).not.toBeNull()
    expect(pepperMatch![1]!.length).toBe(64)

    // A second call replaces the pepper rather than appending a duplicate line
    const repairRes2 = await fetch(`${apiBase}/${alphaInstanceId}/setup-status/generate-pepper`, { method: 'POST' })
    expect(repairRes2.status).toBe(200)
    const afterContent2 = await readFile(envPath, 'utf8')
    const pepperLines = afterContent2.split('\n').filter((l) => l.startsWith('IRANTI_API_KEY_PEPPER='))
    expect(pepperLines.length).toBe(1)
  })
})
