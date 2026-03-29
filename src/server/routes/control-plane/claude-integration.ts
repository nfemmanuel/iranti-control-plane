/**
 * Claude Code Integration routes - CP-T092 + CP-T093
 *
 * GET  /instances/:instanceName/projects/:projectId/claude-integration
 *        Read and diagnose .mcp.json, .vscode/mcp.json, and .claude/settings.local.json for a bound project.
 *
 * POST /instances/:instanceName/projects/:projectId/claude-integration/scaffold
 *        Run `iranti claude-setup` for the project using the bound .env.iranti file.
 *
 * GET  /instances/:instanceName/integration-summary
 *        Aggregated per-project integration status for CP-T093.
 */

import { Router, Request, Response } from 'express'
import { existsSync, readFileSync } from 'fs'
import { join, isAbsolute } from 'path'
import { homedir } from 'os'
import { runIrantiCommand } from '../../lib/iranti-cli.js'
import { probeIrantiMcpInitialize, type McpInitializeProbeResult } from '../../lib/mcp-initialize.js'

export const claudeIntegrationRouter = Router()

const INSTANCE_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/

function getRuntimeRoot(): string {
  return process.env.IRANTI_HOME ?? join(homedir(), '.iranti-runtime')
}

function getInstanceEnvPath(runtimeRoot: string, instanceName: string): string {
  return join(runtimeRoot, 'instances', instanceName, '.env')
}

function getRegistryPath(runtimeRoot: string, instanceName: string): string {
  return join(runtimeRoot, 'instances', instanceName, 'projects.json')
}

interface ProjectEntry {
  projectPath: string
  agentId: string
  memoryEntity: string
  mode: 'isolated' | 'shared'
  boundAt: string
}

interface ProjectRegistry {
  projects: ProjectEntry[]
}

function readRegistry(registryPath: string): ProjectRegistry {
  if (!existsSync(registryPath)) return { projects: [] }
  try {
    const raw = readFileSync(registryPath, 'utf8')
    const parsed = JSON.parse(raw) as ProjectRegistry
    if (!Array.isArray(parsed.projects)) return { projects: [] }
    return parsed
  } catch {
    return { projects: [] }
  }
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

interface IrantiMcpEntry {
  command: string
  args: string[]
  env?: Record<string, string>
}

interface IrantiHooks {
  sessionStart: string | null
  userPromptSubmit: string | null
  stop: string | null
}

function extractIrantiMcpEntry(mcpJson: Record<string, unknown>): IrantiMcpEntry | null {
  const servers = mcpJson['mcpServers'] ?? mcpJson['servers']
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return null
  const entry = (servers as Record<string, unknown>)['iranti']
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const e = entry as Record<string, unknown>
  if (typeof e['command'] !== 'string') return null
  const args = Array.isArray(e['args']) ? (e['args'] as string[]) : []
  const result: IrantiMcpEntry = { command: e['command'] as string, args }
  if (e['env'] && typeof e['env'] === 'object' && !Array.isArray(e['env'])) {
    result.env = e['env'] as Record<string, string>
  }
  return result
}

function extractIrantiHooks(hooksJson: Record<string, unknown>): IrantiHooks {
  const result: IrantiHooks = { sessionStart: null, userPromptSubmit: null, stop: null }
  const hooks = hooksJson['hooks']
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return result

  const hooksMap = hooks as Record<string, unknown>

  function findIrantiCommand(entries: unknown): string | null {
    if (!Array.isArray(entries)) return null
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      const e = entry as Record<string, unknown>
      const nested = e['hooks']
      if (Array.isArray(nested)) {
        for (const hook of nested) {
          if (!hook || typeof hook !== 'object' || Array.isArray(hook)) continue
          const h = hook as Record<string, unknown>
          const cmd = typeof h['command'] === 'string' ? (h['command'] as string) : null
          if (cmd && cmd.includes('iranti claude-hook')) return cmd
        }
      }
      const cmd = typeof e['command'] === 'string' ? (e['command'] as string) : null
      if (cmd && cmd.includes('iranti claude-hook')) return cmd
    }
    return null
  }

  result.sessionStart = findIrantiCommand(hooksMap['SessionStart'])
  result.userPromptSubmit = findIrantiCommand(hooksMap['UserPromptSubmit'])
  result.stop = findIrantiCommand(hooksMap['Stop'])
  return result
}

function isAbsolutePathCommand(cmd: string): boolean {
  if (/^[a-zA-Z]:[/\\]/.test(cmd)) return true
  if (cmd.startsWith('/')) return true
  return false
}

interface IntegrationCheckResult {
  projectPath: string
  mcpJson: Record<string, unknown> | null
  mcpJsonPath: string | null
  workspaceMcpJson: Record<string, unknown> | null
  workspaceMcpJsonPath: string | null
  hooksJson: Record<string, unknown> | null
  hooksJsonPath: string | null
  irantiMcpEntry: IrantiMcpEntry | null
  irantiWorkspaceMcpEntry: IrantiMcpEntry | null
  irantiHooks: IrantiHooks
  mcpInitialize: McpInitializeProbeResult | null
  issues: string[]
}

function usesPortableIrantiCommand(command: string): boolean {
  const normalized = command.trim().replace(/\\/g, '/').toLowerCase()
  return /(^|\/)iranti(\.cmd|\.exe)?$/.test(normalized)
}

async function checkProjectIntegration(projectPath: string): Promise<IntegrationCheckResult> {
  const mcpJsonPath = join(projectPath, '.mcp.json')
  const workspaceMcpJsonPath = join(projectPath, '.vscode', 'mcp.json')
  const hooksJsonPath = join(projectPath, '.claude', 'settings.local.json')
  const projectEnvPath = join(projectPath, '.env.iranti')

  const mcpJson = readJsonFile(mcpJsonPath)
  const workspaceMcpJson = readJsonFile(workspaceMcpJsonPath)
  const hooksJson = readJsonFile(hooksJsonPath)

  const irantiMcpEntry = mcpJson ? extractIrantiMcpEntry(mcpJson) : null
  const irantiWorkspaceMcpEntry = workspaceMcpJson ? extractIrantiMcpEntry(workspaceMcpJson) : null
  const irantiHooks = hooksJson ? extractIrantiHooks(hooksJson) : { sessionStart: null, userPromptSubmit: null, stop: null }

  const issues: string[] = []
  const anyMcpPresent = existsSync(mcpJsonPath) || existsSync(workspaceMcpJsonPath)
  const anyMcpHasIranti = irantiMcpEntry !== null || irantiWorkspaceMcpEntry !== null
  const mcpInitialize =
    anyMcpHasIranti && existsSync(projectEnvPath)
      ? await probeIrantiMcpInitialize({
          projectPath,
          projectEnvPath,
        })
      : null

  if (!anyMcpPresent) {
    issues.push('No MCP config found - add .mcp.json or .vscode/mcp.json so Claude Code and VS Code can discover Iranti tools')
  } else if (!anyMcpHasIranti) {
    issues.push('Iranti MCP server not registered in .mcp.json or .vscode/mcp.json')
  } else {
    for (const entry of [irantiMcpEntry, irantiWorkspaceMcpEntry]) {
      if (entry && !usesPortableIrantiCommand(entry.command)) {
        issues.push(`Iranti MCP server uses wrong command - expected 'iranti', found: ${entry.command}`)
        break
      }
    }
  }

  if (!existsSync(hooksJsonPath)) {
    issues.push('.claude/settings.local.json not found - hooks not configured')
  } else if (!irantiHooks.sessionStart && !irantiHooks.userPromptSubmit && !irantiHooks.stop) {
    issues.push('No Iranti hooks registered in settings.local.json')
  } else {
    const allCommands = [irantiHooks.sessionStart, irantiHooks.userPromptSubmit, irantiHooks.stop].filter(Boolean) as string[]
    for (const cmd of allCommands) {
      if (isAbsolutePathCommand(cmd)) {
        issues.push('Hook command uses absolute path - may fail after Iranti reinstall')
        break
      }
    }
    if (!irantiHooks.stop) {
      issues.push('Iranti Stop hook is not registered - Claude response summaries will not auto-persist')
    }
  }

  if (mcpInitialize && !mcpInitialize.ok) {
    issues.push(`Iranti MCP initialize probe failed - ${mcpInitialize.detail}`)
  }

  return {
    projectPath,
    mcpJson,
    mcpJsonPath: existsSync(mcpJsonPath) ? mcpJsonPath : null,
    workspaceMcpJson,
    workspaceMcpJsonPath: existsSync(workspaceMcpJsonPath) ? workspaceMcpJsonPath : null,
    hooksJson,
    hooksJsonPath: existsSync(hooksJsonPath) ? hooksJsonPath : null,
    irantiMcpEntry,
    irantiWorkspaceMcpEntry,
    irantiHooks,
    mcpInitialize,
    issues,
  }
}

interface ScaffoldOptions {
  projectPath: string
  projectEnvPath: string
  force: boolean
}

interface ScaffoldResult {
  ok: boolean
  written: string[]
  output?: string
  error?: string
}

async function scaffoldProjectFiles(opts: ScaffoldOptions): Promise<ScaffoldResult> {
  const { projectPath, projectEnvPath, force } = opts
  const args = ['claude-setup', projectPath, '--project-env', projectEnvPath]
  if (force) args.push('--force')

  try {
    const result = await runIrantiCommand(args, {
      cwd: projectPath,
      timeoutMs: 15_000,
    })
    const written = [
      join(projectPath, '.mcp.json'),
      join(projectPath, '.vscode', 'mcp.json'),
      join(projectPath, '.claude', 'settings.local.json'),
    ].filter((filePath) => existsSync(filePath))
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n')
    return { ok: true, written, output }
  } catch (err) {
    return {
      ok: false,
      written: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

claudeIntegrationRouter.get(
  '/:instanceName/projects/:projectId/claude-integration',
  async (req: Request, res: Response) => {
    const { instanceName, projectId } = req.params

    if (!INSTANCE_NAME_RE.test(instanceName)) {
      res.status(400).json({ error: 'instanceName must match /^[a-zA-Z0-9_-]{1,64}$/' })
      return
    }

    let projectPath: string
    try {
      projectPath = decodeURIComponent(projectId)
    } catch {
      res.status(400).json({ error: 'Invalid projectId encoding' })
      return
    }

    if (!isAbsolute(projectPath)) {
      res.status(400).json({ error: 'projectPath must be an absolute path' })
      return
    }

    if (!existsSync(projectPath)) {
      res.status(404).json({ error: `projectPath does not exist: ${projectPath}` })
      return
    }

    const runtimeRoot = getRuntimeRoot()
    const instanceEnvPath = getInstanceEnvPath(runtimeRoot, instanceName)
    if (!existsSync(instanceEnvPath)) {
      res.status(404).json({ error: `Instance '${instanceName}' not found` })
      return
    }

    const result = await checkProjectIntegration(projectPath)
    res.json(result)
  }
)

claudeIntegrationRouter.post(
  '/:instanceName/projects/:projectId/claude-integration/scaffold',
  async (req: Request, res: Response) => {
    const { instanceName, projectId } = req.params

    if (!INSTANCE_NAME_RE.test(instanceName)) {
      res.status(400).json({ error: 'instanceName must match /^[a-zA-Z0-9_-]{1,64}$/' })
      return
    }

    let projectPath: string
    try {
      projectPath = decodeURIComponent(projectId)
    } catch {
      res.status(400).json({ error: 'Invalid projectId encoding' })
      return
    }

    if (!isAbsolute(projectPath)) {
      res.status(400).json({ error: 'projectPath must be an absolute path' })
      return
    }

    if (!existsSync(projectPath)) {
      res.status(404).json({ error: `projectPath does not exist: ${projectPath}` })
      return
    }

    const runtimeRoot = getRuntimeRoot()
    const instanceEnvPath = getInstanceEnvPath(runtimeRoot, instanceName)
    if (!existsSync(instanceEnvPath)) {
      res.status(404).json({ error: `Instance '${instanceName}' not found` })
      return
    }

    const { force = false } = req.body as { force?: boolean }

    const projectEnvPath = join(projectPath, '.env.iranti')
    if (!existsSync(projectEnvPath)) {
      res.status(400).json({
        error: `.env.iranti not found at ${projectEnvPath}. Bind the project first using the Project Bindings panel.`,
        code: 'IRANTI_PROJECT_BINDING_MISSING',
      })
      return
    }

    const result = await scaffoldProjectFiles({ projectPath, projectEnvPath, force })
    const statusCode = result.ok ? 200 : 500
    res.status(statusCode).json(result)
  }
)

claudeIntegrationRouter.get(
  '/:instanceName/integration-summary',
  async (req: Request, res: Response) => {
    const { instanceName } = req.params

    if (!INSTANCE_NAME_RE.test(instanceName)) {
      res.status(400).json({ error: 'instanceName must match /^[a-zA-Z0-9_-]{1,64}$/' })
      return
    }

    const runtimeRoot = getRuntimeRoot()
    const instanceEnvPath = getInstanceEnvPath(runtimeRoot, instanceName)
    if (!existsSync(instanceEnvPath)) {
      res.status(404).json({ error: `Instance '${instanceName}' not found` })
      return
    }

    const registryPath = getRegistryPath(runtimeRoot, instanceName)
    const registry = readRegistry(registryPath)

    const liveProjects = registry.projects.filter((entry) => existsSync(join(entry.projectPath, '.env.iranti')))

    const projects = await Promise.all(liveProjects.map(async (entry) => {
      const check = await checkProjectIntegration(entry.projectPath)
      const irantiHooksCount = [check.irantiHooks.sessionStart, check.irantiHooks.userPromptSubmit, check.irantiHooks.stop]
        .filter(Boolean).length
      return {
        projectPath: entry.projectPath,
        mcpPresent: check.mcpJsonPath !== null,
        workspaceMcpPresent: check.workspaceMcpJsonPath !== null,
        irantiMcpRegistered: check.irantiMcpEntry !== null,
        irantiWorkspaceMcpRegistered: check.irantiWorkspaceMcpEntry !== null,
        mcpInitializeOk: check.mcpInitialize?.ok ?? null,
        mcpInitializeDetail: check.mcpInitialize?.detail ?? null,
        hooksPresent: check.hooksJsonPath !== null,
        irantiHooksCount,
        issues: check.issues,
      }
    }))

    res.json({ instanceName, projects })
  }
)
