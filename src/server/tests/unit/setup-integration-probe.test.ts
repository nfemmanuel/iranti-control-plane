import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'net'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('../../lib/project-integration.js', () => ({
  inspectProjectIntegration: vi.fn(),
}))

import { inspectProjectIntegration } from '../../lib/project-integration.js'
import { setupRouter } from '../../routes/control-plane/setup.js'
import { deriveInstanceId } from '../../lib/instance-authority.js'

const inspectProjectIntegrationMock = vi.mocked(inspectProjectIntegration)

describe('setup status integration probe', () => {
  let tempRoot: string
  let runtimeRoot: string
  let projectPath: string
  let instanceId: string
  let server: ReturnType<typeof express.application.listen>
  let apiBase: string

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'iranti-cp-setup-int-'))
    runtimeRoot = join(tempRoot, '.iranti-runtime')
    projectPath = join(tempRoot, 'bound-project')

    await mkdir(join(runtimeRoot, 'instances', 'alpha'), { recursive: true })
    await mkdir(projectPath, { recursive: true })

    await writeFile(
      join(runtimeRoot, 'instances', 'alpha', '.env'),
      [
        'IRANTI_INSTANCE_NAME=alpha',
        'IRANTI_PORT=4301',
        'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/alpha',
        'LLM_PROVIDER=mock',
      ].join('\n') + '\n',
      'utf8'
    )

    await writeFile(
      join(runtimeRoot, 'instances', 'alpha', 'projects.json'),
      JSON.stringify({
        projects: [{ projectPath, agentId: 'alpha_main', memoryEntity: 'project/alpha', mode: 'isolated', boundAt: new Date().toISOString() }],
      }, null, 2),
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

    instanceId = deriveInstanceId(join(runtimeRoot, 'instances', 'alpha'))
    process.env['IRANTI_HOME'] = runtimeRoot

    inspectProjectIntegrationMock.mockResolvedValue({
      projectPath,
      mcpJsonPresent: true,
      mcpJsonHasIranti: true,
      workspaceMcpPresent: true,
      workspaceMcpHasIranti: true,
      anyMcpPresent: true,
      anyMcpHasIranti: true,
      claudeMdPresent: true,
      claudeMdHasIranti: true,
      mcpInitialize: {
        ok: false,
        initialized: false,
        toolsListed: false,
        toolNames: [],
        missingTools: ['iranti_handshake'],
        detail: 'Iranti MCP initialize is failing for this project.',
        error: 'MCP_INITIALIZE_TIMEOUT',
      },
    })

    const app = express()
    app.use(express.json())
    app.use('/', setupRouter)
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    delete process.env['IRANTI_HOME']
    vi.resetAllMocks()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('warns when integration files exist but live MCP initialize fails', async () => {
    const res = await fetch(`${apiBase}/${instanceId}/setup-status`)
    const body = await res.json() as Record<string, unknown>
    const steps = body.steps as Array<Record<string, unknown>>
    const integrationStep = steps.find((step) => step.id === 'claude_integration')

    expect(res.status).toBe(200)
    expect(integrationStep?.status).toBe('warning')
    expect(String(integrationStep?.message)).toContain('live MCP initialize is failing')
    expect(String(integrationStep?.actionRequired)).toContain('File wiring exists')
  })
})
