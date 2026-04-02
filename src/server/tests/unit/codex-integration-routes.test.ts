import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'net'

vi.mock('../../lib/codex-cli.js', () => ({
  resolveCodexCli: vi.fn(),
  runCodexCommand: vi.fn(),
}))

vi.mock('../../lib/iranti-cli.js', () => ({
  runIrantiCommand: vi.fn(),
}))

import { resolveCodexCli, runCodexCommand } from '../../lib/codex-cli.js'
import { runIrantiCommand } from '../../lib/iranti-cli.js'
import { codexIntegrationRouter } from '../../routes/control-plane/codex-integration.js'

const resolveCodexCliMock = vi.mocked(resolveCodexCli)
const runCodexCommandMock = vi.mocked(runCodexCommand)
const runIrantiCommandMock = vi.mocked(runIrantiCommand)

describe('codex integration routes', () => {
  let server: ReturnType<typeof express.application.listen>
  let apiBase: string

  beforeEach(async () => {
    const app = express()
    app.use(express.json())
    app.use('/', codexIntegrationRouter)
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    vi.resetAllMocks()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('reads Codex registration from live MCP state instead of stale config-file guesses', async () => {
    resolveCodexCliMock.mockResolvedValue({
      command: process.execPath,
      args: ['codex.js'],
      displayPath: 'C:\\Users\\NF\\AppData\\Roaming\\npm\\codex.cmd',
      source: 'path',
    })
    runCodexCommandMock.mockResolvedValue({
      resolution: {
        command: process.execPath,
        args: ['codex.js'],
        displayPath: 'C:\\Users\\NF\\AppData\\Roaming\\npm\\codex.cmd',
        source: 'path',
      },
      stdout: JSON.stringify({
        name: 'iranti',
        enabled: true,
        transport: {
          type: 'stdio',
          command: 'node',
          args: ['C:\\Users\\NF\\AppData\\Roaming\\npm\\node_modules\\iranti\\dist\\scripts\\iranti-mcp.js'],
        },
      }),
      stderr: '',
      exitCode: 0,
    })

    const res = await fetch(`${apiBase}/codex`)
    const body = await res.json() as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.codexInstalled).toBe(true)
    expect(body.irantiRegistered).toBe(true)
    expect(body.issues).toEqual([])
    expect(body.registeredConfig).toMatchObject({
      type: 'stdio',
      command: 'node',
    })
  })

  it('reports not-registered from codex mcp output instead of config file absence', async () => {
    resolveCodexCliMock.mockResolvedValue({
      command: process.execPath,
      args: ['codex.js'],
      displayPath: 'C:\\Users\\NF\\AppData\\Roaming\\npm\\codex.cmd',
      source: 'path',
    })
    runCodexCommandMock.mockResolvedValue({
      resolution: {
        command: process.execPath,
        args: ['codex.js'],
        displayPath: 'C:\\Users\\NF\\AppData\\Roaming\\npm\\codex.cmd',
        source: 'path',
      },
      stdout: '',
      stderr: 'No server named "iranti" is registered.',
      exitCode: 1,
    })

    const res = await fetch(`${apiBase}/codex`)
    const body = await res.json() as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.codexInstalled).toBe(true)
    expect(body.irantiRegistered).toBe(false)
    expect(body.issues).toEqual(['Iranti MCP server not registered with Codex'])
  })

  it('runs codex setup through the shared Iranti CLI resolver on Windows', async () => {
    resolveCodexCliMock.mockResolvedValue({
      command: process.execPath,
      args: ['codex.js'],
      displayPath: 'C:\\Users\\NF\\AppData\\Roaming\\npm\\codex.cmd',
      source: 'path',
    })
    runIrantiCommandMock.mockResolvedValue({
      resolution: {
        command: process.execPath,
        args: ['C:\\Users\\NF\\AppData\\Roaming\\npm\\node_modules\\iranti\\bin\\iranti.js'],
        displayPath: 'C:\\Users\\NF\\AppData\\Roaming\\npm\\iranti.cmd',
        source: 'path',
      },
      stdout: 'Codex is now configured to use Iranti through MCP.',
      stderr: '',
    })

    const res = await fetch(`${apiBase}/codex`, { method: 'POST' })
    const body = await res.json() as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(runIrantiCommandMock).toHaveBeenCalledWith(['codex-setup'], { timeoutMs: 5000 })
    expect(body.ok).toBe(true)
    expect(body.output).toBe('Codex is now configured to use Iranti through MCP.')
  })

  it('returns a clean no-op when Codex is not installed during remove', async () => {
    resolveCodexCliMock.mockResolvedValue(null)

    const res = await fetch(`${apiBase}/codex`, { method: 'DELETE' })
    const body = await res.json() as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      output: 'Codex is not installed — nothing to remove',
    })
    expect(runIrantiCommandMock).not.toHaveBeenCalled()
    expect(runCodexCommandMock).not.toHaveBeenCalled()
  })

  it('removes Iranti from Codex after uninstall if live MCP state still shows it registered', async () => {
    resolveCodexCliMock.mockResolvedValue({
      command: process.execPath,
      args: ['codex.js'],
      displayPath: 'C:\\Users\\NF\\AppData\\Roaming\\npm\\codex.cmd',
      source: 'path',
    })
    runIrantiCommandMock.mockResolvedValue({
      resolution: null as never,
      stdout: 'Attempted Codex uninstall cleanup.',
      stderr: '',
    })
    runCodexCommandMock
      .mockResolvedValueOnce({
        resolution: null as never,
        stdout: JSON.stringify({
          name: 'iranti',
          transport: { type: 'stdio', command: 'iranti', args: ['mcp'] },
        }),
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        resolution: null as never,
        stdout: 'Removed MCP server "iranti".',
        stderr: '',
        exitCode: 0,
      })

    const res = await fetch(`${apiBase}/codex`, { method: 'DELETE' })
    const body = await res.json() as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(runIrantiCommandMock).toHaveBeenCalledWith(
      ['uninstall', '--target', 'codex'],
      { timeoutMs: 5000, allowNonZeroExit: true },
    )
    expect(runCodexCommandMock).toHaveBeenNthCalledWith(
      2,
      ['mcp', 'remove', 'iranti'],
      { timeoutMs: 5000, allowNonZeroExit: true },
    )
    expect(body).toMatchObject({
      ok: true,
    })
    expect(String(body.output)).toContain('Attempted Codex uninstall cleanup.')
    expect(String(body.output)).toContain('Removed MCP server "iranti".')
  })
})
