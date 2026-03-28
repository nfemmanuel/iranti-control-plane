import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'net'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { projectBindingsRouter } from '../../routes/control-plane/project-bindings.js'

describe('project bindings routes', () => {
  let tempRoot: string
  let runtimeRoot: string
  let projectPath: string
  let server: ReturnType<typeof express.application.listen>
  let baseUrl: string

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'iranti-cp-project-bindings-'))
    runtimeRoot = join(tempRoot, '.iranti-runtime')
    projectPath = join(tempRoot, 'repo')

    await mkdir(join(runtimeRoot, 'instances', 'alpha'), { recursive: true })
    await mkdir(projectPath, { recursive: true })

    await writeFile(
      join(runtimeRoot, 'instances', 'alpha', '.env'),
      [
        'IRANTI_PORT=3501',
        'IRANTI_API_KEY=test_key',
      ].join('\n') + '\n',
      'utf8',
    )

    process.env['IRANTI_HOME'] = runtimeRoot

    const app = express()
    app.use(express.json())
    app.use('/', projectBindingsRouter)
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    delete process.env['IRANTI_HOME']
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('unbinds a project, removes the registry entry, and cleans Iranti-only local integrations', async () => {
    await writeFile(
      join(projectPath, '.env.iranti'),
      [
        'IRANTI_URL=http://localhost:3501',
        'IRANTI_API_KEY=test_key',
        'IRANTI_INSTANCE=alpha',
        `IRANTI_INSTANCE_ENV=${join(runtimeRoot, 'instances', 'alpha', '.env')}`,
      ].join('\n') + '\n',
      'utf8',
    )
    await writeFile(
      join(runtimeRoot, 'instances', 'alpha', 'projects.json'),
      JSON.stringify({ projects: [{ projectPath, agentId: 'main_agent', memoryEntity: 'project/repo', mode: 'isolated', boundAt: new Date().toISOString() }] }, null, 2) + '\n',
      'utf8',
    )
    await writeFile(
      join(projectPath, '.mcp.json'),
      JSON.stringify({ mcpServers: { iranti: { command: 'iranti', args: ['mcp'] } } }, null, 2) + '\n',
      'utf8',
    )
    await mkdir(join(projectPath, '.vscode'), { recursive: true })
    await writeFile(
      join(projectPath, '.vscode', 'mcp.json'),
      JSON.stringify({ servers: { iranti: { command: 'iranti' }, other: { command: 'other' } } }, null, 2) + '\n',
      'utf8',
    )
    await mkdir(join(projectPath, '.claude'), { recursive: true })
    await writeFile(
      join(projectPath, '.claude', 'settings.local.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                { type: 'command', command: 'iranti claude-hook session-start' },
                { type: 'command', command: 'echo keep-me' },
              ],
            },
          ],
        },
      }, null, 2) + '\n',
      'utf8',
    )

    const res = await fetch(`${baseUrl}/alpha/projects?projectPath=${encodeURIComponent(projectPath)}`, {
      method: 'DELETE',
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      instanceName: 'alpha',
      projectPath,
      removedBinding: true,
      registryRemoved: true,
      keepIntegrations: false,
    })
    expect(existsSync(join(projectPath, '.env.iranti'))).toBe(false)
    expect(existsSync(join(projectPath, '.mcp.json'))).toBe(false)

    const vscodeConfig = JSON.parse(await readFile(join(projectPath, '.vscode', 'mcp.json'), 'utf8')) as {
      servers?: Record<string, { command?: string }>
    }
    expect(vscodeConfig.servers?.iranti).toBeUndefined()
    expect(vscodeConfig.servers?.other?.command).toBe('other')

    const claudeSettings = JSON.parse(await readFile(join(projectPath, '.claude', 'settings.local.json'), 'utf8')) as {
      hooks?: {
        SessionStart?: Array<{ hooks?: Array<{ command?: string }> }>
      }
    }
    expect(claudeSettings.hooks?.SessionStart?.[0]?.hooks?.map((entry) => entry.command)).toEqual(['echo keep-me'])

    const registry = JSON.parse(await readFile(join(runtimeRoot, 'instances', 'alpha', 'projects.json'), 'utf8')) as {
      projects: Array<{ projectPath: string }>
    }
    expect(registry.projects).toEqual([])
  })

  it('supports keepIntegrations=true when only the binding file should be removed', async () => {
    await writeFile(
      join(projectPath, '.env.iranti'),
      [
        'IRANTI_URL=http://localhost:3501',
        'IRANTI_API_KEY=test_key',
        'IRANTI_INSTANCE=alpha',
        `IRANTI_INSTANCE_ENV=${join(runtimeRoot, 'instances', 'alpha', '.env')}`,
      ].join('\n') + '\n',
      'utf8',
    )
    await writeFile(
      join(projectPath, '.mcp.json'),
      JSON.stringify({ mcpServers: { iranti: { command: 'iranti', args: ['mcp'] } } }, null, 2) + '\n',
      'utf8',
    )

    const res = await fetch(`${baseUrl}/alpha/projects?projectPath=${encodeURIComponent(projectPath)}&keepIntegrations=true`, {
      method: 'DELETE',
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { keepIntegrations: boolean; integrationCleanup: { removed: string[]; updated: string[] } }
    expect(body.keepIntegrations).toBe(true)
    expect(body.integrationCleanup.removed).toEqual([])
    expect(body.integrationCleanup.updated).toEqual([])
    expect(existsSync(join(projectPath, '.env.iranti'))).toBe(false)
    expect(existsSync(join(projectPath, '.mcp.json'))).toBe(true)
  })
})
