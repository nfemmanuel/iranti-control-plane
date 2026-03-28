/**
 * Project Binding routes — CP-T091
 *
 * POST   /instances/:instanceName/projects          — bind a project directory to an instance
 * PATCH  /instances/:instanceName/projects          — rebind (change instance or mode); projectPath via ?projectPath=
 * GET    /instances/:instanceName/projects          — list bound projects (shadows the Phase-1 stub in instances.ts)
 *
 * Each binding writes a `.env.iranti` file into the project directory so that
 * tools running inside that project (Claude Code, other agents) auto-connect to
 * the chosen Iranti instance.
 *
 * A lightweight JSON registry at:
 *   {runtimeRoot}/instances/{instanceName}/projects.json
 * tracks all bindings for a given instance. Stale entries (where `.env.iranti`
 * has been deleted) are filtered out on every GET.
 *
 * SECURITY INVARIANT: Raw instance env maps are never returned in API responses.
 * Only derived / projected fields (port, names, paths) are exposed.
 */

import { Router, Request, Response } from 'express'
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  statSync,
} from 'fs'
import { join, basename, isAbsolute } from 'path'
import { homedir } from 'os'

export const projectBindingsRouter = Router()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INSTANCE_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/

function getRuntimeRoot(): string {
  return process.env.IRANTI_HOME ?? join(homedir(), '.iranti-runtime')
}

function getInstanceEnvPath(runtimeRoot: string, instanceName: string): string {
  return join(runtimeRoot, 'instances', instanceName, '.env')
}

/**
 * Parse a simple KEY=VALUE env file (no shell quoting beyond outer single/double quotes).
 * Mirrors the parseEnvFile logic in db.ts.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = readFileSync(filePath, 'utf8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    result[key] = val
  }
  return result
}

/**
 * Serialise an ordered set of KEY=VALUE pairs to a .env file string.
 * Each entry occupies exactly one line; file ends with a newline.
 */
function buildEnvFileContent(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Project registry helpers
// ---------------------------------------------------------------------------

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

function getRegistryPath(runtimeRoot: string, instanceName: string): string {
  return join(runtimeRoot, 'instances', instanceName, 'projects.json')
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

function writeRegistry(registryPath: string, registry: ProjectRegistry): void {
  // Ensure parent directory exists (instance dir is already created by iranti itself,
  // but be defensive).
  const dir = registryPath.replace(/[/\\][^/\\]+$/, '')
  mkdirSync(dir, { recursive: true })
  writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8')
}

function removeProjectFromRegistry(registryPath: string, projectPath: string): boolean {
  const registry = readRegistry(registryPath)
  const nextProjects = registry.projects.filter((entry) => entry.projectPath !== projectPath)
  if (nextProjects.length === registry.projects.length) return false
  writeRegistry(registryPath, { projects: nextProjects })
  return true
}

function removeIrantiMcpServerFromValue(value: Record<string, unknown>): Record<string, unknown> | null {
  let next: Record<string, unknown> = { ...value }
  let changed = false

  const stripServerMap = (field: 'mcpServers' | 'servers'): void => {
    const current = next[field]
    if (!current || typeof current !== 'object' || Array.isArray(current)) return
    const nextServers = { ...(current as Record<string, unknown>) }
    if (!Object.prototype.hasOwnProperty.call(nextServers, 'iranti')) return
    delete nextServers.iranti
    changed = true
    if (Object.keys(nextServers).length === 0) {
      delete next[field]
    } else {
      next[field] = nextServers
    }
  }

  stripServerMap('mcpServers')
  stripServerMap('servers')

  if (!changed) return value
  return Object.keys(next).length === 0 ? null : next
}

function removeIrantiClaudeHooksFromValue(value: Record<string, unknown>): Record<string, unknown> | null {
  const hooks = value['hooks']
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return value

  const nextHooks: Record<string, unknown> = { ...(hooks as Record<string, unknown>) }

  for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop'] as const) {
    const entries = nextHooks[event]
    if (!Array.isArray(entries)) continue

    const filtered = entries.filter((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true
      const record = entry as Record<string, unknown>
      const command = typeof record['command'] === 'string' ? record['command'] : ''
      if (command.includes('iranti claude-hook')) return false

      const nestedHooks = Array.isArray(record['hooks']) ? record['hooks'] : []
      if (nestedHooks.length === 0) return true

      const remainingNested = nestedHooks.filter((hook) => {
        if (!hook || typeof hook !== 'object' || Array.isArray(hook)) return true
        const hookCommand = typeof (hook as Record<string, unknown>)['command'] === 'string'
          ? String((hook as Record<string, unknown>)['command'])
          : ''
        return !hookCommand.includes('iranti claude-hook')
      })

      if (remainingNested.length === 0) return false
      if (remainingNested.length !== nestedHooks.length) {
        record['hooks'] = remainingNested
      }
      return true
    })

    if (filtered.length === 0) {
      delete nextHooks[event]
    } else {
      nextHooks[event] = filtered
    }
  }

  const next = { ...value }
  if (Object.keys(nextHooks).length === 0) {
    delete next.hooks
  } else {
    next.hooks = nextHooks
  }
  return Object.keys(next).length === 0 ? null : next
}

type IntegrationCleanupResult = {
  removed: string[]
  updated: string[]
  warnings: string[]
}

function cleanupProjectIntegrations(projectPath: string): IntegrationCleanupResult {
  const result: IntegrationCleanupResult = { removed: [], updated: [], warnings: [] }
  const candidates = [
    join(projectPath, '.mcp.json'),
    join(projectPath, '.vscode', 'mcp.json'),
  ]

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as Record<string, unknown>
      const next = removeIrantiMcpServerFromValue(parsed)
      if (next === parsed) continue
      if (!next) {
        rmSync(candidate, { force: true })
        result.removed.push(candidate)
      } else {
        writeFileSync(candidate, JSON.stringify(next, null, 2) + '\n', 'utf8')
        result.updated.push(candidate)
      }
    } catch {
      result.warnings.push(`Skipped unreadable MCP file ${candidate}`)
    }
  }

  const claudeSettingsFile = join(projectPath, '.claude', 'settings.local.json')
  if (existsSync(claudeSettingsFile)) {
    try {
      const parsed = JSON.parse(readFileSync(claudeSettingsFile, 'utf8')) as Record<string, unknown>
      const next = removeIrantiClaudeHooksFromValue(parsed)
      if (next !== parsed) {
        if (!next) {
          rmSync(claudeSettingsFile, { force: true })
          result.removed.push(claudeSettingsFile)
        } else {
          writeFileSync(claudeSettingsFile, JSON.stringify(next, null, 2) + '\n', 'utf8')
          result.updated.push(claudeSettingsFile)
        }
      }
    } catch {
      result.warnings.push(`Skipped unreadable Claude settings file ${claudeSettingsFile}`)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// gitignore helper
// ---------------------------------------------------------------------------

function ensureGitignoreEntry(projectPath: string, entry: string): void {
  const gitignorePath = join(projectPath, '.gitignore')
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf8')
    const lines = content.split('\n').map((l) => l.trim())
    if (lines.includes(entry)) return
    // Append, preserving trailing newline behaviour
    const updated = content.endsWith('\n')
      ? content + entry + '\n'
      : content + '\n' + entry + '\n'
    writeFileSync(gitignorePath, updated, 'utf8')
  } else {
    writeFileSync(gitignorePath, entry + '\n', 'utf8')
  }
}

// ---------------------------------------------------------------------------
// POST /instances/:instanceName/projects — Bind a project
// ---------------------------------------------------------------------------

projectBindingsRouter.post(
  '/:instanceName/projects',
  (req: Request, res: Response) => {
    const { instanceName } = req.params

    // 1. Validate instanceName
    if (!INSTANCE_NAME_RE.test(instanceName)) {
      res.status(400).json({ error: 'instanceName must match /^[a-zA-Z0-9_-]{1,64}$/' })
      return
    }

    // 2. Validate projectPath
    const {
      projectPath,
      mode = 'isolated',
      agentId,
      memoryEntity,
      personalMemoryEntity,
      autoRemember,
      addToGitignore,
    } = req.body as {
      projectPath?: string
      mode?: 'isolated' | 'shared'
      agentId?: string
      memoryEntity?: string
      personalMemoryEntity?: string
      autoRemember?: boolean
      addToGitignore?: boolean
    }

    if (!projectPath || typeof projectPath !== 'string') {
      res.status(400).json({ error: 'projectPath is required' })
      return
    }
    if (!isAbsolute(projectPath)) {
      res.status(400).json({ error: 'projectPath must be an absolute path' })
      return
    }
    if (!existsSync(projectPath)) {
      res.status(400).json({ error: 'projectPath does not exist' })
      return
    }
    // Confirm it's a directory
    try {
      const stat = statSync(projectPath)
      if (!stat.isDirectory()) {
        res.status(400).json({ error: 'projectPath must be a directory' })
        return
      }
    } catch {
      res.status(400).json({ error: 'Cannot stat projectPath' })
      return
    }

    // 3 & 4. Resolve runtime root and locate instance .env
    const runtimeRoot = getRuntimeRoot()
    const instanceEnvPath = getInstanceEnvPath(runtimeRoot, instanceName)
    if (!existsSync(instanceEnvPath)) {
      res.status(404).json({
        error: `Instance '${instanceName}' not found`,
        instanceEnvPath,
      })
      return
    }

    // 5. Read instance .env for IRANTI_PORT and IRANTI_API_KEY
    let instanceVars: Record<string, string>
    try {
      instanceVars = parseEnvFile(instanceEnvPath)
    } catch (err) {
      res.status(500).json({ error: 'Failed to read instance .env', detail: String(err) })
      return
    }

    const irantiPort = instanceVars['IRANTI_PORT']
    const irantiApiKey = instanceVars['IRANTI_API_KEY']

    if (!irantiPort) {
      res.status(500).json({ error: `IRANTI_PORT not found in instance .env for '${instanceName}'` })
      return
    }
    if (!irantiApiKey) {
      res.status(500).json({ error: `IRANTI_API_KEY not found in instance .env for '${instanceName}'` })
      return
    }

    // 6. Build .env.iranti content
    const resolvedAgentId = agentId ?? 'main_agent'
    const resolvedMemoryEntity = memoryEntity ?? `project/${basename(projectPath)}`
    const resolvedPersonalMemoryEntity = personalMemoryEntity ?? 'user/main'
    const resolvedMode = (mode === 'isolated' || mode === 'shared') ? mode : 'isolated'
    const resolvedAutoRemember = autoRemember === true ? 'true' : 'false'

    const envIrantiContent = buildEnvFileContent({
      IRANTI_URL: `http://localhost:${irantiPort}`,
      IRANTI_API_KEY: irantiApiKey,
      IRANTI_AGENT_ID: resolvedAgentId,
      IRANTI_MEMORY_ENTITY: resolvedMemoryEntity,
      IRANTI_PERSONAL_MEMORY_ENTITY: resolvedPersonalMemoryEntity,
      IRANTI_PROJECT_MODE: resolvedMode,
      IRANTI_INSTANCE: instanceName,
      IRANTI_INSTANCE_ENV: instanceEnvPath,
      IRANTI_AUTO_REMEMBER: resolvedAutoRemember,
    })

    // 7. Write .env.iranti
    const envIrantiPath = join(projectPath, '.env.iranti')
    try {
      writeFileSync(envIrantiPath, envIrantiContent, 'utf8')
    } catch (err) {
      res.status(500).json({ error: 'Failed to write .env.iranti', detail: String(err) })
      return
    }

    // 8. gitignore handling (default: true)
    const shouldGitignore = addToGitignore !== false
    if (shouldGitignore) {
      try {
        ensureGitignoreEntry(projectPath, '.env.iranti')
      } catch (err) {
        // Non-fatal: log and continue
        console.warn('[project-bindings] Failed to update .gitignore:', err)
      }
    }

    // 9. Update registry
    const registryPath = getRegistryPath(runtimeRoot, instanceName)
    const registry = readRegistry(registryPath)
    const now = new Date().toISOString()

    // Replace existing entry for this projectPath if present
    const existing = registry.projects.findIndex((p) => p.projectPath === projectPath)
    const entry: ProjectEntry = {
      projectPath,
      agentId: resolvedAgentId,
      memoryEntity: resolvedMemoryEntity,
      mode: resolvedMode,
      boundAt: now,
    }
    if (existing !== -1) {
      registry.projects[existing] = entry
    } else {
      registry.projects.push(entry)
    }

    try {
      writeRegistry(registryPath, registry)
    } catch (err) {
      // Non-fatal: the .env.iranti is already written; registry is best-effort
      console.warn('[project-bindings] Failed to update projects.json registry:', err)
    }

    res.status(201).json({
      ok: true,
      projectPath,
      envIrantiPath,
      instanceName,
      agentId: resolvedAgentId,
      memoryEntity: resolvedMemoryEntity,
      personalMemoryEntity: resolvedPersonalMemoryEntity,
      mode: resolvedMode,
      autoRemember: resolvedAutoRemember === 'true',
    })
  }
)

// ---------------------------------------------------------------------------
// PATCH /instances/:instanceName/projects?projectPath=<encoded> — Rebind
// ---------------------------------------------------------------------------

projectBindingsRouter.patch(
  '/:instanceName/projects',
  (req: Request, res: Response) => {
    const { instanceName } = req.params

    // 1. Validate instanceName
    if (!INSTANCE_NAME_RE.test(instanceName)) {
      res.status(400).json({ error: 'instanceName must match /^[a-zA-Z0-9_-]{1,64}$/' })
      return
    }

    const projectPath = req.query['projectPath'] as string | undefined
    if (!projectPath || typeof projectPath !== 'string') {
      res.status(400).json({ error: 'projectPath query param is required' })
      return
    }
    if (!isAbsolute(projectPath)) {
      res.status(400).json({ error: 'projectPath must be an absolute path' })
      return
    }

    const runtimeRoot = getRuntimeRoot()

    // Validate current instance exists
    const currentInstanceEnvPath = getInstanceEnvPath(runtimeRoot, instanceName)
    if (!existsSync(currentInstanceEnvPath)) {
      res.status(404).json({ error: `Instance '${instanceName}' not found` })
      return
    }

    // 2. Read existing .env.iranti at projectPath
    const envIrantiPath = join(projectPath, '.env.iranti')
    if (!existsSync(envIrantiPath)) {
      res.status(404).json({
        error: '.env.iranti not found at projectPath — bind the project first',
        envIrantiPath,
      })
      return
    }

    let existing: Record<string, string>
    try {
      existing = parseEnvFile(envIrantiPath)
    } catch (err) {
      res.status(500).json({ error: 'Failed to read existing .env.iranti', detail: String(err) })
      return
    }

    const { targetInstanceName, mode } = req.body as {
      targetInstanceName?: string
      mode?: 'isolated' | 'shared'
    }

    const changed: string[] = []
    const updated = { ...existing }

    // 3. If targetInstanceName provided: switch instance
    if (targetInstanceName) {
      if (!INSTANCE_NAME_RE.test(targetInstanceName)) {
        res.status(400).json({ error: 'targetInstanceName must match /^[a-zA-Z0-9_-]{1,64}$/' })
        return
      }

      const targetEnvPath = getInstanceEnvPath(runtimeRoot, targetInstanceName)
      if (!existsSync(targetEnvPath)) {
        res.status(404).json({ error: `Target instance '${targetInstanceName}' not found` })
        return
      }

      let targetVars: Record<string, string>
      try {
        targetVars = parseEnvFile(targetEnvPath)
      } catch (err) {
        res.status(500).json({ error: 'Failed to read target instance .env', detail: String(err) })
        return
      }

      const irantiPort = targetVars['IRANTI_PORT']
      const irantiApiKey = targetVars['IRANTI_API_KEY']

      if (!irantiPort) {
        res.status(500).json({ error: `IRANTI_PORT not found in target instance .env for '${targetInstanceName}'` })
        return
      }
      if (!irantiApiKey) {
        res.status(500).json({ error: `IRANTI_API_KEY not found in target instance .env for '${targetInstanceName}'` })
        return
      }

      const newUrl = `http://localhost:${irantiPort}`
      if (updated['IRANTI_URL'] !== newUrl) { updated['IRANTI_URL'] = newUrl; changed.push('IRANTI_URL') }
      if (updated['IRANTI_API_KEY'] !== irantiApiKey) { updated['IRANTI_API_KEY'] = irantiApiKey; changed.push('IRANTI_API_KEY') }
      if (updated['IRANTI_INSTANCE'] !== targetInstanceName) { updated['IRANTI_INSTANCE'] = targetInstanceName; changed.push('IRANTI_INSTANCE') }
      if (updated['IRANTI_INSTANCE_ENV'] !== targetEnvPath) { updated['IRANTI_INSTANCE_ENV'] = targetEnvPath; changed.push('IRANTI_INSTANCE_ENV') }
    }

    // 4. If mode provided: update IRANTI_PROJECT_MODE
    if (mode !== undefined) {
      if (mode !== 'isolated' && mode !== 'shared') {
        res.status(400).json({ error: "mode must be 'isolated' or 'shared'" })
        return
      }
      if (updated['IRANTI_PROJECT_MODE'] !== mode) {
        updated['IRANTI_PROJECT_MODE'] = mode
        changed.push('IRANTI_PROJECT_MODE')
      }
    }

    if (changed.length === 0) {
      res.json({ ok: true, projectPath, changed: [] })
      return
    }

    // 5. Write updated .env.iranti
    // Preserve the canonical key order; any unrecognised keys from the existing
    // file are carried over at the end.
    const canonicalKeys = [
      'IRANTI_URL',
      'IRANTI_API_KEY',
      'IRANTI_AGENT_ID',
      'IRANTI_MEMORY_ENTITY',
      'IRANTI_PERSONAL_MEMORY_ENTITY',
      'IRANTI_PROJECT_MODE',
      'IRANTI_INSTANCE',
      'IRANTI_INSTANCE_ENV',
      'IRANTI_AUTO_REMEMBER',
    ]
    const reordered: Record<string, string> = {}
    for (const k of canonicalKeys) {
      if (updated[k] !== undefined) reordered[k] = updated[k]
    }
    // Append any extra keys not in canonical list
    for (const [k, v] of Object.entries(updated)) {
      if (!canonicalKeys.includes(k)) reordered[k] = v
    }

    try {
      writeFileSync(envIrantiPath, buildEnvFileContent(reordered), 'utf8')
    } catch (err) {
      res.status(500).json({ error: 'Failed to write updated .env.iranti', detail: String(err) })
      return
    }

    // Update registry: if targetInstanceName, move entry between registries
    const effectiveInstanceName = targetInstanceName ?? instanceName
    try {
      if (targetInstanceName && targetInstanceName !== instanceName) {
        // Remove from old instance registry
        const oldRegistryPath = getRegistryPath(runtimeRoot, instanceName)
        const oldRegistry = readRegistry(oldRegistryPath)
        const oldIdx = oldRegistry.projects.findIndex((p) => p.projectPath === projectPath)
        let movedEntry: ProjectEntry | undefined
        if (oldIdx !== -1) {
          movedEntry = oldRegistry.projects.splice(oldIdx, 1)[0]
          writeRegistry(oldRegistryPath, oldRegistry)
        }

        // Add to new instance registry
        const newRegistryPath = getRegistryPath(runtimeRoot, targetInstanceName)
        const newRegistry = readRegistry(newRegistryPath)
        const existingNewIdx = newRegistry.projects.findIndex((p) => p.projectPath === projectPath)
        const updatedEntry: ProjectEntry = {
          projectPath,
          agentId: movedEntry?.agentId ?? updated['IRANTI_AGENT_ID'] ?? 'main_agent',
          memoryEntity: movedEntry?.memoryEntity ?? updated['IRANTI_MEMORY_ENTITY'] ?? `project/${basename(projectPath)}`,
          mode: (mode ?? movedEntry?.mode ?? 'isolated') as 'isolated' | 'shared',
          boundAt: movedEntry?.boundAt ?? new Date().toISOString(),
        }
        if (existingNewIdx !== -1) {
          newRegistry.projects[existingNewIdx] = updatedEntry
        } else {
          newRegistry.projects.push(updatedEntry)
        }
        writeRegistry(newRegistryPath, newRegistry)
      } else {
        // Update in-place in current instance registry
        const registryPath = getRegistryPath(runtimeRoot, instanceName)
        const registry = readRegistry(registryPath)
        const idx = registry.projects.findIndex((p) => p.projectPath === projectPath)
        if (idx !== -1) {
          if (mode) registry.projects[idx].mode = mode
        }
        writeRegistry(registryPath, registry)
      }
    } catch (err) {
      console.warn('[project-bindings] Failed to update projects.json registry during rebind:', err)
    }

    res.json({ ok: true, projectPath, changed })
    return
  }
)

// ---------------------------------------------------------------------------
// DELETE /instances/:instanceName/projects?projectPath=<encoded> — Unbind
// ---------------------------------------------------------------------------

projectBindingsRouter.delete(
  '/:instanceName/projects',
  (req: Request, res: Response) => {
    const { instanceName } = req.params

    if (!INSTANCE_NAME_RE.test(instanceName)) {
      res.status(400).json({ error: 'instanceName must match /^[a-zA-Z0-9_-]{1,64}$/' })
      return
    }

    const projectPath = req.query['projectPath'] as string | undefined
    if (!projectPath || typeof projectPath !== 'string') {
      res.status(400).json({ error: 'projectPath query param is required' })
      return
    }
    if (!isAbsolute(projectPath)) {
      res.status(400).json({ error: 'projectPath must be an absolute path' })
      return
    }

    const runtimeRoot = getRuntimeRoot()
    const instanceEnvPath = getInstanceEnvPath(runtimeRoot, instanceName)
    if (!existsSync(instanceEnvPath)) {
      res.status(404).json({ error: `Instance '${instanceName}' not found` })
      return
    }

    const envIrantiPath = join(projectPath, '.env.iranti')
    if (!existsSync(envIrantiPath)) {
      res.status(404).json({
        error: '.env.iranti not found at projectPath — bind the project first',
        envIrantiPath,
      })
      return
    }

    const keepIntegrations = String(req.query['keepIntegrations'] ?? '').toLowerCase() === 'true'
    const registryPath = getRegistryPath(runtimeRoot, instanceName)
    const registryRemoved = removeProjectFromRegistry(registryPath, projectPath)

    try {
      rmSync(envIrantiPath, { force: true })
    } catch (err) {
      res.status(500).json({ error: 'Failed to remove .env.iranti', detail: String(err) })
      return
    }

    const integrationCleanup = keepIntegrations
      ? { removed: [] as string[], updated: [] as string[], warnings: [] as string[] }
      : cleanupProjectIntegrations(projectPath)

    res.json({
      ok: true,
      instanceName,
      projectPath,
      envIrantiPath,
      removedBinding: true,
      registryRemoved,
      keepIntegrations,
      integrationCleanup,
    })
  }
)

// ---------------------------------------------------------------------------
// GET /instances/:instanceName/projects — List bound projects
// (Shadows the Phase-1 stub in instances.ts when mounted first)
// ---------------------------------------------------------------------------

projectBindingsRouter.get(
  '/:instanceName/projects',
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

    // Filter out stale entries (projectPath no longer has .env.iranti)
    const live = registry.projects.filter((entry) =>
      existsSync(join(entry.projectPath, '.env.iranti'))
    )

    const cwdBindingPath = join(process.cwd(), '.env.iranti')
    if (existsSync(cwdBindingPath)) {
      try {
        const binding = parseEnvFile(cwdBindingPath)
        const bindingInstance = binding['IRANTI_INSTANCE']?.trim() ?? ''
        const bindingEnvPath = binding['IRANTI_INSTANCE_ENV']?.trim() ?? ''
        const matchesCurrentInstance =
          bindingInstance === instanceName ||
          (bindingEnvPath && bindingEnvPath === instanceEnvPath)

        if (matchesCurrentInstance && !live.some((entry) => entry.projectPath === process.cwd())) {
          live.push({
            projectPath: process.cwd(),
            agentId: binding['IRANTI_AGENT_ID']?.trim() || 'main_agent',
            memoryEntity: binding['IRANTI_MEMORY_ENTITY']?.trim() || `project/${basename(process.cwd())}`,
            mode: binding['IRANTI_PROJECT_MODE']?.trim() === 'shared' ? 'shared' : 'isolated',
            boundAt: new Date(statSync(cwdBindingPath).mtimeMs).toISOString(),
          })
        }
      } catch {
        // ignore malformed cwd binding and fall back to registry-only entries
      }
    }

    // If we filtered any stale entries, persist the cleaned registry
    if (live.length !== registry.projects.length) {
      try {
        writeRegistry(registryPath, { projects: live })
      } catch {
        // Best-effort
      }
    }

    res.json({
      instanceName,
      projects: live,
    })
  }
)
