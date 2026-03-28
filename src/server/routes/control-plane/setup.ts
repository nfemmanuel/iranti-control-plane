/**
 * Setup status routes
 *
 * GET  /:instanceId/setup-status          — 4-step guided setup check
 * POST /:instanceId/setup-status/refresh  — rerun the checks
 * POST /:instanceId/setup-status/complete — mark first-run wizard complete
 */

import { Router, Request, Response, NextFunction } from 'express'
import { access, writeFile, constants } from 'fs/promises'
import { join } from 'path'
import * as net from 'net'
import pg from 'pg'
import { ApiError, InstanceScopeSummary } from '../../types.js'
import { inspectProjectIntegration } from '../../lib/project-integration.js'
import { resolveInstanceAuthority, ResolvedInstanceAuthority } from '../../lib/instance-authority.js'
import { parseDatabaseTarget } from '../../lib/doctor-remediation.js'
import { classifyRuntimeRoot } from '../../lib/runtime-roots.js'

const { Pool } = pg

export const setupRouter = Router()

interface SetupStep {
  id: string
  label: string
  status: 'complete' | 'incomplete' | 'warning' | 'not_applicable'
  message: string
  actionRequired: string | null
  cliCommand: string | null
  repairAction: string | null
}

type RuntimeRootKind = 'primary' | 'legacy' | 'custom'

function scopeSummary(scope: ResolvedInstanceAuthority): InstanceScopeSummary {
  return {
    instanceId: scope.instanceId,
    instanceName: scope.instanceName,
    source: scope.source,
  }
}

function primaryRuntimeRootHint(scope: ResolvedInstanceAuthority): string {
  if (classifyRuntimeRoot(scope.runtimeRoot) !== 'legacy') return ''
  return ` This instance lives under the legacy runtime root ${scope.runtimeRoot}. Newer Iranti instances usually live under ~/.iranti-runtime, so Control Plane is intentionally showing both roots.`
}

function checkRuntimeRoot(scope: ResolvedInstanceAuthority): SetupStep | null {
  if (classifyRuntimeRoot(scope.runtimeRoot) !== 'legacy') return null

  return {
    id: 'runtime_root',
    label: 'Instance storage',
    status: 'warning',
    message: `This instance is stored under the legacy runtime root ${scope.runtimeRoot}.`,
    actionRequired: 'Migrate this instance to the primary runtime root so new instances, runtime commands, and future repair flows all converge on the same home.',
    cliCommand: null,
    repairAction: 'control-plane:migrate-root',
  }
}

async function resolveScopeOrThrow(instanceRef: string): Promise<ResolvedInstanceAuthority> {
  const scope = await resolveInstanceAuthority(instanceRef)
  if (!scope) {
    const err = new Error('Instance not found') as ApiError
    err.statusCode = 404
    err.code = 'INSTANCE_NOT_FOUND'
    throw err
  }
  return scope
}

async function withScopedPool<T>(
  databaseUrl: string | null,
  fn: (pool: pg.Pool | null) => Promise<T>
): Promise<T> {
  if (!databaseUrl) return fn(null)
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 3000,
  })

  try {
    return await fn(pool)
  } finally {
    await pool.end().catch(() => {})
  }
}

function setupCompleteFlagPath(scope: ResolvedInstanceAuthority): string {
  return join(scope.runtimeRoot, '.iranti-cp-setup-complete')
}

async function readFirstRunDetected(scope: ResolvedInstanceAuthority): Promise<boolean> {
  try {
    await access(setupCompleteFlagPath(scope), constants.F_OK)
    return false
  } catch {
    return true
  }
}

function normalizeProviderId(value: string): string {
  const normalized = value.trim().toLowerCase()
  return normalized === 'anthropic' ? 'claude' : normalized
}

async function isTcpPortReachable(host: string, port: number, timeoutMs = 1200): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (reachable: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(reachable)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

function providerLabel(providerId: string): string {
  switch (normalizeProviderId(providerId)) {
    case 'claude': return 'Claude'
    case 'openai': return 'OpenAI'
    case 'gemini': return 'Gemini'
    case 'groq': return 'Groq'
    case 'mistral': return 'Mistral'
    case 'together': return 'Together AI'
    case 'ollama': return 'Ollama'
    case 'mock': return 'Mock'
    default: return providerId
  }
}

async function checkDatabase(scope: ResolvedInstanceAuthority, pool: pg.Pool | null): Promise<SetupStep> {
  const cliCommand = `iranti doctor --instance ${scope.instanceName} --debug`
  const target = parseDatabaseTarget(scope.databaseUrl)
  const legacyRootNote = primaryRuntimeRootHint(scope)

  if (!pool) {
    return {
      id: 'database',
      label: 'Database connection',
      status: 'incomplete',
      message: 'DATABASE_URL is not configured for this instance.',
      actionRequired: `Add DATABASE_URL to ${scope.instanceEnvPath}, then restart the instance.${legacyRootNote}`,
      cliCommand,
      repairAction: 'control-plane:open-configure-db',
    }
  }

  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB query timeout after 2s')), 2000)),
    ])

    let count = '0'
    try {
      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM knowledge_base`
      )
      count = countResult.rows[0]?.count ?? '0'
    } catch {
      // Keep the connectivity pass even if the fact count query fails.
    }

    return {
      id: 'database',
      label: 'Database connection',
      status: 'complete',
      message: `Connected to PostgreSQL for ${scope.instanceName}. ${count} facts in knowledge base.`,
      actionRequired: null,
      cliCommand,
      repairAction: null,
    }
  } catch {
    if (target?.isLocal && target.host && target.port) {
      const reachable = await isTcpPortReachable(target.host, target.port)
      if (!reachable) {
        const dbLabel = target.name ? `${target.host}:${target.port}/${target.name}` : `${target.host}:${target.port}`
      return {
          id: 'database',
          label: 'Database connection',
          status: 'incomplete',
          message: `Database not reachable for this instance. ${target.host}:${target.port} is not accepting connections.`,
          actionRequired: `DATABASE_URL in ${scope.instanceEnvPath} currently points to ${dbLabel}, but nothing is listening there right now. Start the database on that port or update DATABASE_URL to the actual database target, then rerun doctor.${legacyRootNote}`,
          cliCommand,
          repairAction: 'control-plane:open-configure-db',
        }
      }
    }

    return {
      id: 'database',
      label: 'Database connection',
      status: 'incomplete',
      message: 'Database not reachable for this instance.',
      actionRequired: `Verify DATABASE_URL in ${scope.instanceEnvPath}, then rerun doctor.${legacyRootNote}`,
      cliCommand,
      repairAction: 'control-plane:open-configure-db',
    }
  }
}

function checkProvider(scope: ResolvedInstanceAuthority): SetupStep {
  const rawProvider = (scope.env['LLM_PROVIDER'] ?? '').trim()
  const normalizedProvider = rawProvider ? normalizeProviderId(rawProvider) : ''
  const cliCommand = `iranti add api-key openai --instance ${scope.instanceName} --set-default`

  const providerKeys = {
    claude: (scope.env['ANTHROPIC_API_KEY'] ?? '').trim() !== '',
    openai: (scope.env['OPENAI_API_KEY'] ?? '').trim() !== '',
    gemini: (scope.env['GEMINI_API_KEY'] ?? '').trim() !== '',
    groq: (scope.env['GROQ_API_KEY'] ?? '').trim() !== '',
    mistral: (scope.env['MISTRAL_API_KEY'] ?? '').trim() !== '',
    together: (scope.env['TOGETHER_API_KEY'] ?? '').trim() !== '',
    ollama: (scope.env['OLLAMA_BASE_URL'] ?? '').trim() !== '',
  }

  if (rawProvider === 'anthropic') {
    return {
      id: 'provider',
      label: 'Provider configuration',
      status: 'warning',
      message: 'LLM_PROVIDER is set to anthropic. Iranti expects claude as the provider ID.',
      actionRequired: 'Update the default provider to Claude and restart the instance so routing matches the runtime.',
      cliCommand: `iranti add api-key claude --instance ${scope.instanceName} --set-default`,
      repairAction: null,
    }
  }

  if (normalizedProvider) {
    const hasRequiredKey = providerKeys[normalizedProvider as keyof typeof providerKeys] ?? false
    if (normalizedProvider === 'mock' || hasRequiredKey) {
      return {
        id: 'provider',
        label: 'Provider configuration',
        status: 'complete',
        message: `Provider ${providerLabel(normalizedProvider)} configured in the instance env.`,
        actionRequired: null,
        cliCommand: `iranti doctor --instance ${scope.instanceName}`,
        repairAction: null,
      }
    }

    return {
      id: 'provider',
      label: 'Provider configuration',
      status: 'warning',
      message: `Provider ${providerLabel(normalizedProvider)} is selected but its credential is missing from the instance env.`,
      actionRequired: `Store the ${providerLabel(normalizedProvider)} credential in ${scope.instanceEnvPath}, then restart the instance.`,
      cliCommand: `iranti add api-key ${normalizedProvider} --instance ${scope.instanceName} --set-default`,
      repairAction: null,
    }
  }

  const anyProviderKey = Object.values(providerKeys).some(Boolean)
  if (anyProviderKey) {
    return {
      id: 'provider',
      label: 'Provider configuration',
      status: 'warning',
      message: 'Provider credentials exist, but LLM_PROVIDER is not set in the instance env.',
      actionRequired: 'Choose a default provider for this instance and restart it so runtime routing is deterministic.',
      cliCommand,
      repairAction: null,
    }
  }

  return {
    id: 'provider',
    label: 'Provider configuration',
    status: 'incomplete',
    message: 'No LLM provider configured for this instance.',
    actionRequired: 'Store a provider key in the instance env and set the default provider before expecting writes or task routing to work.',
    cliCommand,
    repairAction: null,
  }
}

function checkProjectBinding(scope: ResolvedInstanceAuthority): SetupStep {
  if (scope.boundProjects.length > 0) {
    return {
      id: 'project_binding',
      label: 'Project binding',
      status: 'complete',
      message: `${scope.boundProjects.length} project${scope.boundProjects.length === 1 ? '' : 's'} bound to ${scope.instanceName}.`,
      actionRequired: null,
      cliCommand: `iranti doctor --instance ${scope.instanceName}`,
      repairAction: null,
    }
  }

  return {
    id: 'project_binding',
    label: 'Project binding',
    status: 'warning',
    message: `No projects are bound to ${scope.instanceName}.`,
    actionRequired: 'Bind a project before expecting MCP or Claude integration files to be discoverable.',
    cliCommand: `iranti project init . --instance ${scope.instanceName}`,
    repairAction: null,
  }
}

function buildRepairAction(scope: ResolvedInstanceAuthority, projectPath: string, kind: 'mcp-json' | 'claude-md'): string {
  return `/api/control-plane/instances/${encodeURIComponent(scope.instanceId)}/projects/${encodeURIComponent(projectPath)}/repair/${kind}`
}

function checkProjectIntegration(scope: ResolvedInstanceAuthority, projectStep: SetupStep): SetupStep {
  if (projectStep.status === 'incomplete' || (projectStep.status === 'warning' && scope.boundProjects.length === 0)) {
    return {
      id: 'claude_integration',
      label: 'Project integration',
      status: 'not_applicable',
      message: 'Bind a project first.',
      actionRequired: null,
      cliCommand: null,
      repairAction: null,
    }
  }

  const statuses = scope.boundProjects.map((project) => ({
    projectPath: project.projectPath,
    integration: inspectProjectIntegration(project.projectPath),
  }))

  const missing = statuses.filter(({ integration }) => !(integration.anyMcpPresent && integration.anyMcpHasIranti && integration.claudeMdPresent && integration.claudeMdHasIranti))
  if (missing.length === 0) {
    return {
      id: 'claude_integration',
      label: 'Project integration',
      status: 'complete',
      message: `Claude integration files are present for all ${statuses.length} bound project${statuses.length === 1 ? '' : 's'}.`,
      actionRequired: null,
      cliCommand: statuses.length === 1 ? `iranti claude-setup "${statuses[0]!.projectPath}"` : `iranti doctor --instance ${scope.instanceName}`,
      repairAction: null,
    }
  }

  const [firstMissing] = missing
  const missingMcp = firstMissing ? !(firstMissing.integration.anyMcpPresent && firstMissing.integration.anyMcpHasIranti) : false
  const missingClaudeMd = firstMissing ? !(firstMissing.integration.claudeMdPresent && firstMissing.integration.claudeMdHasIranti) : false

  return {
    id: 'claude_integration',
    label: 'Project integration',
    status: 'warning',
    message: `${missing.length}/${statuses.length} bound project${statuses.length === 1 ? '' : 's'} are missing Iranti Claude or workspace MCP integration files.`,
    actionRequired: firstMissing
      ? `Run Claude setup for ${firstMissing.projectPath}, or repair the missing files from the Instance Manager.`
      : null,
    cliCommand: firstMissing ? `iranti claude-setup "${firstMissing.projectPath}"` : null,
    repairAction:
      firstMissing && missingMcp && !missingClaudeMd
        ? buildRepairAction(scope, firstMissing.projectPath, 'mcp-json')
        : firstMissing && missingClaudeMd && !missingMcp
        ? buildRepairAction(scope, firstMissing.projectPath, 'claude-md')
        : null,
  }
}

async function buildSetupStatus(scope: ResolvedInstanceAuthority) {
  const firstRunDetected = await readFirstRunDetected(scope)
  const runtimeRootKind: RuntimeRootKind = classifyRuntimeRoot(scope.runtimeRoot)

  return withScopedPool(scope.databaseUrl, async (pool) => {
    const runtimeRootStep = checkRuntimeRoot(scope)
    const databaseStep = await checkDatabase(scope, pool)
    const providerStep = checkProvider(scope)
    const projectStep = checkProjectBinding(scope)
    const integrationStep = checkProjectIntegration(scope, projectStep)

    const steps: SetupStep[] = [
      ...(runtimeRootStep ? [runtimeRootStep] : []),
      databaseStep,
      providerStep,
      projectStep,
      integrationStep,
    ]
    const isFullyConfigured = steps.every((step) => step.status === 'complete' || step.status === 'not_applicable' || step.status === 'warning')

    return {
      instanceId: scope.instanceId,
      scope: scopeSummary(scope),
      runtimeRoot: scope.runtimeRoot,
      runtimeRootKind,
      steps,
      isFullyConfigured,
      firstRunDetected,
    }
  })
}

setupRouter.get(
  '/:instanceId/setup-status',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = await resolveScopeOrThrow(req.params['instanceId'] ?? '')
      res.json(await buildSetupStatus(scope))
    } catch (err) {
      next(err)
    }
  }
)

setupRouter.post(
  '/:instanceId/setup-status/refresh',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = await resolveScopeOrThrow(req.params['instanceId'] ?? '')
      res.json(await buildSetupStatus(scope))
    } catch (err) {
      next(err)
    }
  }
)

setupRouter.post(
  '/:instanceId/setup-status/complete',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = await resolveScopeOrThrow(req.params['instanceId'] ?? '')
      const completedAt = new Date().toISOString()
      await writeFile(setupCompleteFlagPath(scope), JSON.stringify({ completedAt, instanceId: scope.instanceId }), 'utf8')
      res.json({ success: true, completedAt, scope: scopeSummary(scope) })
    } catch (err) {
      next(err)
    }
  }
)

setupRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const apiErr = err as ApiError
  res.status(apiErr.statusCode ?? 500).json({
    error: apiErr.message ?? 'Internal server error',
    code: apiErr.code ?? 'INTERNAL_ERROR',
  })
})
