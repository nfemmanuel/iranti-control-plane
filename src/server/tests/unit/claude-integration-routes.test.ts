import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'net'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('../../lib/mcp-initialize.js', () => ({
  probeIrantiMcpInitialize: vi.fn(),
}))

import { probeIrantiMcpInitialize } from '../../lib/mcp-initialize.js'
import { claudeIntegrationRouter } from '../../routes/control-plane/claude-integration.js'

const probeIrantiMcpInitializeMock = vi.mocked(probeIrantiMcpInitialize)

describe('claude integration routes', () => {
  let tempRoot: string
  let runtimeRoot: string
  let projectPath: string
  let server: ReturnType<typeof express.application.listen>
  let apiBase: string

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'iranti-cp-claude-int-'))
    runtimeRoot = join(tempRoot, '.iranti-runtime')
    projectPath = join(tempRoot, 'project')

    await mkdir(join(runtimeRoot, 'instances', 'alpha'), { recursive: true })
    await mkdir(join(projectPath, '.vscode'), { recursive: true })
    await mkdir(join(projectPath, '.claude'), { recursive: true })

    await writeFile(join(runtimeRoot, 'instances', 'alpha', '.env'), 'IRANTI_INSTANCE_NAME=alpha\n', 'utf8')
    await writeFile(
      join(runtimeRoot, 'instances', 'alpha', 'projects.json'),
      JSON.stringify({ projects: [{ projectPath, agentId: 'alpha_main', memoryEntity: 'project/alpha', mode: 'isolated', boundAt: new Date().toISOString() }] }, null, 2),
      'utf8'
    )
    await writeFile(join(projectPath, '.env.iranti'), 'IRANTI_INSTANCE=alpha\n', 'utf8')
    await writeFile(
      join(projectPath, '.mcp.json'),
      JSON.stringify({ mcpServers: { iranti: { command: 'iranti', args: ['mcp'] } } }, null, 2),
      'utf8'
    )
    await writeFile(
      join(projectPath, '.vscode', 'mcp.json'),
      JSON.stringify({ mcpServers: { iranti: { command: 'iranti', args: ['mcp'] } } }, null, 2),
      'utf8'
    )
    await writeFile(
      join(projectPath, '.claude', 'settings.local.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ command: 'iranti claude-hook SessionStart' }] }],
          UserPromptSubmit: [{ hooks: [{ command: 'iranti claude-hook UserPromptSubmit' }] }],
          Stop: [{ hooks: [{ command: 'iranti claude-hook Stop' }] }],
        },
      }, null, 2),
      'utf8'
    )

    process.env['IRANTI_HOME'] = runtimeRoot

    const app = express()
    app.use(express.json())
    app.use('/', claudeIntegrationRouter)
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

  it('surfaces live MCP initialize failures even when the files look wired', async () => {
    probeIrantiMcpInitializeMock.mockResolvedValue({
      ok: false,
      initialized: false,
      toolsListed: false,
      toolNames: [],
      missingTools: ['iranti_handshake'],
      detail: 'Iranti MCP initialize failed before the server acknowledged initialize.',
      error: 'MCP_INITIALIZE_TIMEOUT',
    })

    const res = await fetch(`${apiBase}/alpha/projects/${encodeURIComponent(projectPath)}/claude-integration`)
    const body = await res.json() as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.mcpInitialize).toMatchObject({
      ok: false,
      detail: 'Iranti MCP initialize failed before the server acknowledged initialize.',
    })
    expect(body.issues).toContain('Iranti MCP initialize probe failed - Iranti MCP initialize failed before the server acknowledged initialize.')
  })

  it('includes live MCP initialize health in the integration summary', async () => {
    probeIrantiMcpInitializeMock.mockResolvedValue({
      ok: true,
      initialized: true,
      toolsListed: true,
      toolNames: ['iranti_handshake', 'iranti_attend'],
      missingTools: [],
      detail: 'Iranti MCP initialized and exposed 2 tools.',
      error: null,
    })

    const res = await fetch(`${apiBase}/alpha/integration-summary`)
    const body = await res.json() as Record<string, unknown>
    const projects = body.projects as Array<Record<string, unknown>>

    expect(res.status).toBe(200)
    expect(projects[0]).toMatchObject({
      projectPath,
      mcpInitializeOk: true,
      mcpInitializeDetail: 'Iranti MCP initialized and exposed 2 tools.',
    })
  })
})
