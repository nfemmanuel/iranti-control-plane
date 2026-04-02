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
    await mkdir(join(runtimeRoot, 'instances', 'beta'), { recursive: true })
    await mkdir(projectPath, { recursive: true })

    await writeFile(
      join(runtimeRoot, 'instances', 'alpha', '.env'),
      [
        'IRANTI_PORT=3501',
        'IRANTI_API_KEY=test_key',
      ].join('\n') + '\n',
      'utf8',
    )
    await writeFile(
      join(runtimeRoot, 'instances', 'beta', '.env'),
      [
        'IRANTI_PORT=3601',
        'IRANTI_API_KEY=beta_key',
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

  it('binds a project by writing .env.iranti, updating .gitignore, and recording the registry entry', async () => {
    const res = await fetch(`${baseUrl}/alpha/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath,
        mode: 'shared',
        agentId: 'alpha_main',
        memoryEntity: 'project/repo',
        personalMemoryEntity: 'user/tester',
        autoRemember: true,
      }),
    })

    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      ok: true,
      instanceName: 'alpha',
      projectPath,
      agentId: 'alpha_main',
      memoryEntity: 'project/repo',
      personalMemoryEntity: 'user/tester',
      mode: 'shared',
      autoRemember: true,
    })

    const binding = await readFile(join(projectPath, '.env.iranti'), 'utf8')
    expect(binding).toContain('IRANTI_URL=http://localhost:3501')
    expect(binding).toContain('IRANTI_API_KEY=test_key')
    expect(binding).toContain('IRANTI_INSTANCE=alpha')
    expect(binding).toContain('IRANTI_PROJECT_MODE=shared')
    expect(binding).toContain('IRANTI_AUTO_REMEMBER=true')

    const gitignore = await readFile(join(projectPath, '.gitignore'), 'utf8')
    expect(gitignore.split('\n')).toContain('.env.iranti')

    const registry = JSON.parse(await readFile(join(runtimeRoot, 'instances', 'alpha', 'projects.json'), 'utf8')) as {
      projects: Array<{ projectPath: string; agentId: string; memoryEntity: string; mode: string; boundAt: string }>
    }
    expect(registry.projects).toHaveLength(1)
    expect(registry.projects[0]).toMatchObject({
      projectPath,
      agentId: 'alpha_main',
      memoryEntity: 'project/repo',
      mode: 'shared',
    })
    expect(new Date(registry.projects[0].boundAt).getTime()).toBeGreaterThan(0)
  })

  it('rebinds a project to another instance and updates both registries plus the binding file', async () => {
    await writeFile(
      join(projectPath, '.env.iranti'),
      [
        'IRANTI_URL=http://localhost:3501',
        'IRANTI_API_KEY=test_key',
        'IRANTI_AGENT_ID=alpha_main',
        'IRANTI_MEMORY_ENTITY=project/repo',
        'IRANTI_PERSONAL_MEMORY_ENTITY=user/main',
        'IRANTI_PROJECT_MODE=isolated',
        'IRANTI_INSTANCE=alpha',
        `IRANTI_INSTANCE_ENV=${join(runtimeRoot, 'instances', 'alpha', '.env')}`,
        'IRANTI_AUTO_REMEMBER=false',
      ].join('\n') + '\n',
      'utf8',
    )
    await writeFile(
      join(runtimeRoot, 'instances', 'alpha', 'projects.json'),
      JSON.stringify({
        projects: [{
          projectPath,
          agentId: 'alpha_main',
          memoryEntity: 'project/repo',
          mode: 'isolated',
          boundAt: '2026-04-02T00:00:00.000Z',
        }],
      }, null, 2) + '\n',
      'utf8',
    )

    const res = await fetch(`${baseUrl}/alpha/projects?projectPath=${encodeURIComponent(projectPath)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetInstanceName: 'beta',
        mode: 'shared',
      }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      projectPath,
      changed: ['IRANTI_URL', 'IRANTI_API_KEY', 'IRANTI_INSTANCE', 'IRANTI_INSTANCE_ENV', 'IRANTI_PROJECT_MODE'],
    })

    const binding = await readFile(join(projectPath, '.env.iranti'), 'utf8')
    expect(binding).toContain('IRANTI_URL=http://localhost:3601')
    expect(binding).toContain('IRANTI_API_KEY=beta_key')
    expect(binding).toContain('IRANTI_INSTANCE=beta')
    expect(binding).toContain(`IRANTI_INSTANCE_ENV=${join(runtimeRoot, 'instances', 'beta', '.env')}`)
    expect(binding).toContain('IRANTI_PROJECT_MODE=shared')
    expect(binding.indexOf('IRANTI_INSTANCE=beta')).toBeGreaterThan(binding.indexOf('IRANTI_PROJECT_MODE=shared'))

    const alphaRegistry = JSON.parse(await readFile(join(runtimeRoot, 'instances', 'alpha', 'projects.json'), 'utf8')) as {
      projects: Array<{ projectPath: string }>
    }
    expect(alphaRegistry.projects).toEqual([])

    const betaRegistry = JSON.parse(await readFile(join(runtimeRoot, 'instances', 'beta', 'projects.json'), 'utf8')) as {
      projects: Array<{ projectPath: string; agentId: string; memoryEntity: string; mode: string; boundAt: string }>
    }
    expect(betaRegistry.projects).toEqual([
      {
        projectPath,
        agentId: 'alpha_main',
        memoryEntity: 'project/repo',
        mode: 'shared',
        boundAt: '2026-04-02T00:00:00.000Z',
      },
    ])
  })
})
