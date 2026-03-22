/**
 * Claude Code Integration routes — CP-T092 + CP-T093
 *
 * GET  /instances/:instanceName/projects/:projectId/claude-integration
 *        Read and diagnose .mcp.json and .claude/settings.local.json for a bound project.
 *
 * POST /instances/:instanceName/projects/:projectId/claude-integration/scaffold
 *        Write .mcp.json and .claude/settings.local.json (replicates iranti claude-setup logic).
 *
 * GET  /instances/:instanceName/integration-summary
 *        Aggregated per-project integration status for CP-T093.
 *
 * :projectId is encodeURIComponent(projectPath).
 */

import { Router, Request, Response } from 'express'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'fs'
import { join, isAbsolute } from 'path'
import { homedir } from 'os'

export const claudeIntegrationRouter = Router()

// ---------------------------------------------------------------------------
// Helpers shared with project-bindings pattern
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// JSON file reading — all wrapped in try/catch per spec constraint
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// MCP / hooks inspection logic
// ---------------------------------------------------------------------------

interface IrantiMcpEntry {
  command: string
  args: string[]
  env?: Record<string, string>
}

interface IrantiHooks {
  sessionStart: string | null
  userPromptSubmit: string | null
}

/**
 * Extract the `mcpServers.iranti` entry from a parsed .mcp.json object.
 * Returns null if the key is absent or structurally invalid.
 */
function extractIrantiMcpEntry(mcpJson: Record<string, unknown>): IrantiMcpEntry | null {
  const servers = mcpJson['mcpServers']
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

/**
 * Extract Iranti hook commands from a parsed .claude/settings.local.json object.
 * Iranti registers hooks under `hooks.SessionStart` and `hooks.UserPromptSubmit`.
 * Each event is an array of hook entry objects; Iranti's entries have a nested
 * `hooks` array containing `{ type: 'command', command: 'iranti claude-hook ...' }`.
 */
function extractIrantiHooks(hooksJson: Record<string, unknown>): IrantiHooks {
  const result: IrantiHooks = { sessionStart: null, userPromptSubmit: null }
  const hooks = hooksJson['hooks']
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return result

  const hooksMap = hooks as Record<string, unknown>

  function findIrantiCommand(entries: unknown): string | null {
    if (!Array.isArray(entries)) return null
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      const e = entry as Record<string, unknown>
      // New-style: entry has a `hooks` array containing command objects
      const nested = e['hooks']
      if (Array.isArray(nested)) {
        for (const hook of nested) {
          if (!hook || typeof hook !== 'object' || Array.isArray(hook)) continue
          const h = hook as Record<string, unknown>
          const cmd = typeof h['command'] === 'string' ? h['command'] as string : null
          if (cmd && cmd.includes('iranti claude-hook')) return cmd
        }
      }
      // Legacy-style: direct command on entry
      const cmd = typeof e['command'] === 'string' ? e['command'] as string : null
      if (cmd && cmd.includes('iranti claude-hook')) return cmd
    }
    return null
  }

  result.sessionStart = findIrantiCommand(hooksMap['SessionStart'])
  result.userPromptSubmit = findIrantiCommand(hooksMap['UserPromptSubmit'])
  return result
}

/**
 * Determine whether a hook command uses an absolute path (drive letter on Windows
 * or leading / on Unix), which can break after Iranti reinstall.
 */
function isAbsolutePathCommand(cmd: string): boolean {
  // Drive letter: C:\ or C:/
  if (/^[a-zA-Z]:[/\\]/.test(cmd)) return true
  // Unix absolute
  if (cmd.startsWith('/')) return true
  return false
}

// ---------------------------------------------------------------------------
// Core check logic (reused by both single-project and summary endpoints)
// ---------------------------------------------------------------------------

interface IntegrationCheckResult {
  projectPath: string
  mcpJson: Record<string, unknown> | null
  mcpJsonPath: string | null
  hooksJson: Record<string, unknown> | null
  hooksJsonPath: string | null
  irantiMcpEntry: IrantiMcpEntry | null
  irantiHooks: IrantiHooks
  issues: string[]
}

function checkProjectIntegration(projectPath: string): IntegrationCheckResult {
  const mcpJsonPath = join(projectPath, '.mcp.json')
  const hooksJsonPath = join(projectPath, '.claude', 'settings.local.json')

  const mcpJson = readJsonFile(mcpJsonPath)
  const hooksJson = readJsonFile(hooksJsonPath)

  const irantiMcpEntry = mcpJson ? extractIrantiMcpEntry(mcpJson) : null
  const irantiHooks = hooksJson ? extractIrantiHooks(hooksJson) : { sessionStart: null, userPromptSubmit: null }

  const issues: string[] = []

  // MCP issues
  if (!existsSync(mcpJsonPath)) {
    issues.push('.mcp.json not found — Claude Code cannot discover Iranti tools')
  } else if (!irantiMcpEntry) {
    issues.push('Iranti MCP server not registered in .mcp.json')
  } else if (irantiMcpEntry.command !== 'iranti') {
    issues.push(`Iranti MCP server uses wrong command — expected 'iranti', found: ${irantiMcpEntry.command}`)
  }

  // Hooks issues
  if (!existsSync(hooksJsonPath)) {
    issues.push('.claude/settings.local.json not found — hooks not configured')
  } else if (!irantiHooks.sessionStart && !irantiHooks.userPromptSubmit) {
    issues.push('No Iranti hooks registered in settings.local.json')
  } else {
    // Check for absolute-path hook commands
    const allCommands = [irantiHooks.sessionStart, irantiHooks.userPromptSubmit].filter(Boolean) as string[]
    for (const cmd of allCommands) {
      if (isAbsolutePathCommand(cmd)) {
        issues.push('Hook command uses absolute path — may fail after Iranti reinstall')
        break
      }
    }
  }

  return {
    projectPath,
    mcpJson,
    mcpJsonPath: existsSync(mcpJsonPath) ? mcpJsonPath : null,
    hooksJson,
    hooksJsonPath: existsSync(hooksJsonPath) ? hooksJsonPath : null,
    irantiMcpEntry,
    irantiHooks,
    issues,
  }
}

// ---------------------------------------------------------------------------
// Scaffold logic — replicates iranti claude-setup file-writing
// Discovered from iranti-cli.js:
//   .mcp.json = { mcpServers: { iranti: { command: 'iranti', args: ['mcp'] } } }
//   .claude/settings.local.json = { hooks: {
//     SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'iranti claude-hook --event SessionStart --project-env "<envPath>"' }] }],
//     UserPromptSubmit: [...similar...]
//   }}
// ---------------------------------------------------------------------------

function quoteHookArg(value: string): string {
  if (!value.includes(' ') && !value.includes('"') && !value.includes('\\')) return value
  return `"${value.replace(/(["\\])/g, '\\$1')}"`
}

function makeIrantiMcpServerConfig(): { command: string; args: string[] } {
  return { command: 'iranti', args: ['mcp'] }
}

function makeClaudeHookCommand(event: string, projectEnvPath: string): string {
  const parts = ['iranti', 'claude-hook', '--event', event, '--project-env', quoteHookArg(projectEnvPath)]
  return parts.join(' ')
}

function makeClaudeHookEntry(event: string, projectEnvPath: string): Record<string, unknown> {
  return {
    matcher: '',
    hooks: [
      {
        type: 'command',
        command: makeClaudeHookCommand(event, projectEnvPath),
      },
    ],
  }
}

function makeClaudeHookSettings(projectEnvPath: string, existing?: Record<string, unknown>): Record<string, unknown> {
  const existingHooks = existing && existing['hooks'] && typeof existing['hooks'] === 'object' && !Array.isArray(existing['hooks'])
    ? existing['hooks'] as Record<string, unknown>
    : {}
  return {
    ...(existing ?? {}),
    hooks: {
      ...existingHooks,
      SessionStart: [makeClaudeHookEntry('SessionStart', projectEnvPath)],
      UserPromptSubmit: [makeClaudeHookEntry('UserPromptSubmit', projectEnvPath)],
    },
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

function scaffoldProjectFiles(opts: ScaffoldOptions): ScaffoldResult {
  const { projectPath, projectEnvPath, force } = opts
  const written: string[] = []
  const outputLines: string[] = []

  // --- .mcp.json ---
  const mcpFile = join(projectPath, '.mcp.json')
  const irantiServer = makeIrantiMcpServerConfig()

  try {
    if (!existsSync(mcpFile)) {
      const content = JSON.stringify({ mcpServers: { iranti: irantiServer } }, null, 2) + '\n'
      writeFileSync(mcpFile, content, 'utf8')
      written.push(mcpFile)
      outputLines.push(`created: ${mcpFile}`)
    } else {
      const existing = readJsonFile(mcpFile)
      if (!existing) {
        if (!force) {
          return {
            ok: false,
            written,
            error: `Existing .mcp.json is not valid JSON. Re-run with force: true to overwrite it: ${mcpFile}`,
          }
        }
        const content = JSON.stringify({ mcpServers: { iranti: irantiServer } }, null, 2) + '\n'
        writeFileSync(mcpFile, content, 'utf8')
        written.push(mcpFile)
        outputLines.push(`replaced (force): ${mcpFile}`)
      } else {
        const existingServers = (existing['mcpServers'] && typeof existing['mcpServers'] === 'object' && !Array.isArray(existing['mcpServers']))
          ? existing['mcpServers'] as Record<string, unknown>
          : {}
        const hasIranti = 'iranti' in existingServers
        if (!hasIranti || force) {
          const content = JSON.stringify(
            { ...existing, mcpServers: { ...existingServers, iranti: irantiServer } },
            null, 2
          ) + '\n'
          writeFileSync(mcpFile, content, 'utf8')
          written.push(mcpFile)
          outputLines.push(`${hasIranti ? 'updated' : 'merged'}: ${mcpFile}`)
        } else {
          outputLines.push(`unchanged (iranti already present): ${mcpFile}`)
        }
      }
    }
  } catch (err) {
    return { ok: false, written, error: `Failed to write .mcp.json: ${String(err)}` }
  }

  // --- .claude/settings.local.json ---
  const claudeDir = join(projectPath, '.claude')
  const settingsFile = join(claudeDir, 'settings.local.json')

  try {
    mkdirSync(claudeDir, { recursive: true })

    if (!existsSync(settingsFile)) {
      const content = JSON.stringify(makeClaudeHookSettings(projectEnvPath), null, 2) + '\n'
      writeFileSync(settingsFile, content, 'utf8')
      written.push(settingsFile)
      outputLines.push(`created: ${settingsFile}`)
    } else {
      const existingSettings = readJsonFile(settingsFile)
      if (existingSettings) {
        // Check if upgrade needed (Iranti hooks absent or force)
        const currentHooks = extractIrantiHooks(existingSettings)
        const hasHooks = Boolean(currentHooks.sessionStart || currentHooks.userPromptSubmit)
        if (force || !hasHooks) {
          const content = JSON.stringify(makeClaudeHookSettings(projectEnvPath, existingSettings), null, 2) + '\n'
          writeFileSync(settingsFile, content, 'utf8')
          written.push(settingsFile)
          outputLines.push(`${hasHooks ? 'updated (force)' : 'updated (missing hooks)'}: ${settingsFile}`)
        } else {
          outputLines.push(`unchanged (hooks present): ${settingsFile}`)
        }
      } else if (force) {
        const content = JSON.stringify(makeClaudeHookSettings(projectEnvPath), null, 2) + '\n'
        writeFileSync(settingsFile, content, 'utf8')
        written.push(settingsFile)
        outputLines.push(`replaced (force, invalid JSON): ${settingsFile}`)
      } else {
        outputLines.push(`unchanged (existing file has invalid JSON, use force to overwrite): ${settingsFile}`)
      }
    }
  } catch (err) {
    return { ok: false, written, error: `Failed to write .claude/settings.local.json: ${String(err)}` }
  }

  return { ok: true, written, output: outputLines.join('\n') }
}

// ---------------------------------------------------------------------------
// GET /instances/:instanceName/projects/:projectId/claude-integration
// ---------------------------------------------------------------------------

claudeIntegrationRouter.get(
  '/:instanceName/projects/:projectId/claude-integration',
  (req: Request, res: Response) => {
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

    const result = checkProjectIntegration(projectPath)
    res.json(result)
  }
)

// ---------------------------------------------------------------------------
// POST /instances/:instanceName/projects/:projectId/claude-integration/scaffold
// ---------------------------------------------------------------------------

claudeIntegrationRouter.post(
  '/:instanceName/projects/:projectId/claude-integration/scaffold',
  (req: Request, res: Response) => {
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

    // projectEnvPath — .env.iranti in the project directory
    const projectEnvPath = join(projectPath, '.env.iranti')
    if (!existsSync(projectEnvPath)) {
      res.status(400).json({
        error: `.env.iranti not found at ${projectEnvPath}. Bind the project first using the Project Bindings panel.`,
        code: 'IRANTI_PROJECT_BINDING_MISSING',
      })
      return
    }

    const result = scaffoldProjectFiles({ projectPath, projectEnvPath, force })
    const statusCode = result.ok ? 200 : 500
    res.status(statusCode).json(result)
  }
)

// ---------------------------------------------------------------------------
// GET /instances/:instanceName/integration-summary — CP-T093
// ---------------------------------------------------------------------------

claudeIntegrationRouter.get(
  '/:instanceName/integration-summary',
  (req: Request, res: Response) => {
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

    // Only include live projects (same liveness check as project-bindings GET)
    const liveProjects = registry.projects.filter((entry) =>
      existsSync(join(entry.projectPath, '.env.iranti'))
    )

    const projects = liveProjects.map((entry) => {
      const check = checkProjectIntegration(entry.projectPath)
      const irantiHooksCount = [check.irantiHooks.sessionStart, check.irantiHooks.userPromptSubmit]
        .filter(Boolean).length
      return {
        projectPath: entry.projectPath,
        mcpPresent: check.mcpJsonPath !== null,
        irantiMcpRegistered: check.irantiMcpEntry !== null,
        hooksPresent: check.hooksJsonPath !== null,
        irantiHooksCount,
        issues: check.issues,
      }
    })

    res.json({ instanceName, projects })
  }
)
