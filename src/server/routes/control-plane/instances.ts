import { Router, Request, Response, NextFunction } from 'express'
import { access, constants, readFile, readdir } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import { URL } from 'url'
import { env } from '../../db.js'
import { ApiError } from '../../types.js'
import { deriveInstanceId, resolveInstanceAuthority } from '../../lib/instance-authority.js'
import { runIrantiJson } from '../../lib/iranti-cli.js'
import { runtimeRootCandidates as discoverRuntimeRootCandidates } from '../../lib/runtime-roots.js'
import { IrantiRuntimeMetadata, RuntimeStatus } from './health.js'

export const instancesRouter = Router()

interface ParsedEnv {
  present: boolean
  bindingPresent: boolean
  path: string | null
  instanceEnvPath: string | null
  resolvedRuntimeRoot: string
  raw: Record<string, string> | null
  keyCompleteness: EnvKeyCompleteness | null
}

interface EnvKeyCompleteness {
  allRequiredKeysPresent: boolean
  requiredKeys: { key: string; present: boolean }[]
  extraProviderKeys: string[]
}

interface ParsedDbUrl {
  user: string | null
  host: string | null
  port: number | null
  name: string | null
  urlRedacted: string | null
}

interface ParsedDatabaseIntent {
  strategy: 'dedicated-local' | 'shared-local' | 'external-existing'
  provisioning: 'local' | 'docker' | 'managed'
  host: string
  port?: number
  database: string
  dockerContainerName?: string
}

interface ProbeResult {
  runningStatus: 'running' | 'stopped' | 'unreachable'
  irantVersion: string | null
  checkedAt: string
}

interface InstanceMetadata {
  instanceId: string
  name: string
  setupState: 'running' | 'configured' | 'incomplete'
  runtimeRoot: string
  database: { user: string | null; host: string | null; port: number | null; name: string | null; urlRedacted: string | null } | null
  databaseIntent: ParsedDatabaseIntent | null
  configuredPort: number | null
  runningStatus: 'running' | 'stopped' | 'unreachable'
  runningStatusCheckedAt: string
  irantVersion: string | null
  envFile: {
    present: boolean
    bindingPresent: boolean
    path: string | null
    instanceEnvPath: string | null
    keyCompleteness: EnvKeyCompleteness | null
    keysPresent: string[]
    keysMissing: string[]
  }
  integration: {
    defaultProvider: string | null
    defaultModel: string | null
    providerKeys: { claude: boolean; openai: boolean; otherKeys: string[] }
    providerRoutingOverrides: null
  }
  projectMode: 'isolated' | 'shared' | null
  projects: []
  discoveredAt: string
  registeredAt: string | null
  notes: string | null
  runtime: IrantiRuntimeMetadata | null
  runtimeStatus: RuntimeStatus
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function readInstanceDatabaseIntent(instanceDir: string): Promise<ParsedDatabaseIntent | null> {
  try {
    const metaPath = join(instanceDir, 'instance.json')
    const parsed = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>
    const raw = parsed['databaseIntent']
    if (!isRecord(raw)) return null

    const strategy = typeof raw['strategy'] === 'string' ? raw['strategy'] : null
    const provisioning = typeof raw['provisioning'] === 'string' ? raw['provisioning'] : null
    const host = typeof raw['host'] === 'string' ? raw['host'] : null
    const database = typeof raw['database'] === 'string' ? raw['database'] : null
    const port = typeof raw['port'] === 'number' ? raw['port'] : undefined
    const dockerContainerName = typeof raw['dockerContainerName'] === 'string' ? raw['dockerContainerName'] : undefined

    if (
      (strategy !== 'dedicated-local' && strategy !== 'shared-local' && strategy !== 'external-existing')
      || (provisioning !== 'local' && provisioning !== 'docker' && provisioning !== 'managed')
      || !host
      || !database
    ) {
      return null
    }

    return {
      strategy,
      provisioning,
      host,
      port,
      database,
      ...(dockerContainerName ? { dockerContainerName } : {}),
    }
  } catch {
    return null
  }
}

interface CliStatusRuntimeState extends IrantiRuntimeMetadata {
  instanceDir?: string
  envFile?: string
  runtimeFile?: string
  exitCode?: number | null
  requestLogFile?: string | null
  packageRoot?: string | null
}

interface CliStatusRuntimeSummary {
  state: CliStatusRuntimeState | null
  processAlive: boolean
  running: boolean
  stale: boolean
  classification: 'running' | 'unhealthy' | 'stale' | 'stopped' | 'missing' | 'invalid'
  detail: string
  health?: {
    checked: boolean
    ok: boolean
    source: string
    detail: string
  }
}

interface CliStatusConfigSummary {
  classification: 'complete' | 'partial' | 'invalid'
  detail: string
  metaFile?: string | null
  envFile?: string | null
  state?: Record<string, unknown>
}

interface CliStatusInstanceSummary {
  name: string
  port?: string
  envFile?: string | null
  metaFile?: string | null
  config: CliStatusConfigSummary
  runtime: CliStatusRuntimeSummary
  repairHints?: string[]
}

interface CliStatusResponse {
  version?: string
  runtimeRoot: string
  runtimeRootSource?: string
  discovery?: {
    selectionSource?: string
    selectionReason?: string
  }
  recommendedActions?: string[]
  instances: CliStatusInstanceSummary[]
}

const REQUIRED_KEYS = ['DATABASE_URL', 'IRANTI_PORT'] as const
const PROVIDER_KEY_RE = /^(ANTHROPIC|OPENAI)_API_KEY$/
const NON_PROVIDER_API_KEYS = new Set(['IRANTI_API_KEY', 'IRANTI_API_KEY_PEPPER'])

function explicitRuntimeRoot(): string | null {
  const candidate = process.env['IRANTI_HOME']?.trim() || env['IRANTI_HOME']?.trim() || ''
  return candidate ? normalizeRuntimeRootCandidate(candidate) : null
}

function runtimeRootsToCheck(): string[] {
  const explicit = explicitRuntimeRoot()
  if (explicit) return [explicit]
  return discoverRuntimeRootCandidates().map(normalizeRuntimeRootCandidate)
}

function normalizeProviderId(value: string | undefined): string | null {
  const normalized = (value ?? '').trim().toLowerCase()
  if (!normalized) return null
  return normalized === 'anthropic' ? 'claude' : normalized
}

export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (key) result[key] = val
  }
  return result
}

function summarizeEnvKeys(raw: Record<string, string> | null, keyCompleteness: EnvKeyCompleteness | null): {
  keysPresent: string[]
  keysMissing: string[]
} {
  if (!raw) return { keysPresent: [], keysMissing: [] }

  const importantKeys = new Set<string>([
    ...REQUIRED_KEYS,
    'IRANTI_INSTANCE',
    'IRANTI_INSTANCE_NAME',
    'IRANTI_INSTANCE_ENV',
    'IRANTI_PROJECT_MODE',
    'LLM_PROVIDER',
    'LLM_PROVIDER_FALLBACK',
  ])

  for (const key of Object.keys(raw)) {
    if (key.endsWith('_API_KEY') || key.endsWith('_MODEL')) {
      importantKeys.add(key)
    }
  }

  return {
    keysPresent: Array.from(importantKeys)
      .filter((key) => (raw[key] ?? '').trim() !== '')
      .sort(),
    keysMissing: (keyCompleteness?.requiredKeys ?? [])
      .filter((entry) => !entry.present)
      .map((entry) => entry.key),
  }
}

async function parseInstanceEnvFile(instanceDir: string, runtimeRoot: string): Promise<ParsedEnv> {
  const instanceEnvPath = join(instanceDir, '.env')

  try {
    const content = await readFile(instanceEnvPath, 'utf8')
    const raw = parseEnvContent(content)

    const requiredKeyResults = REQUIRED_KEYS.map((key) => {
      const aliases = key === 'IRANTI_PORT' ? ['IRANTI_PORT', 'PORT'] : [key]
      return {
        key,
        present: aliases.some((alias) => (raw[alias] ?? '').trim() !== ''),
      }
    })

    const extraProviderKeys = Object.keys(raw).filter(
      (key) => key.endsWith('_API_KEY') && !PROVIDER_KEY_RE.test(key) && !NON_PROVIDER_API_KEYS.has(key)
    )

    return {
      present: true,
      bindingPresent: false,
      path: null,
      instanceEnvPath,
      resolvedRuntimeRoot: runtimeRoot,
      raw,
      keyCompleteness: {
        allRequiredKeysPresent: requiredKeyResults.every((entry) => entry.present),
        requiredKeys: requiredKeyResults,
        extraProviderKeys,
      },
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[instances] Failed to read instance env file at ${instanceEnvPath}:`, err)
    }
    return {
      present: false,
      bindingPresent: false,
      path: null,
      instanceEnvPath: null,
      resolvedRuntimeRoot: runtimeRoot,
      raw: null,
      keyCompleteness: null,
    }
  }
}

export function parseAndRedactDbUrl(rawUrl: string | undefined): ParsedDbUrl {
  if (!rawUrl) return { user: null, host: null, port: null, name: null, urlRedacted: null }
  try {
    const parsed = new URL(rawUrl)
    const user = parsed.username ? decodeURIComponent(parsed.username) : null
    const host = parsed.hostname || null
    const port = parsed.port ? parseInt(parsed.port, 10) : 5432
    const name = parsed.pathname.replace(/^\//, '') || null
    const urlRedacted = `${parsed.protocol}//***@${parsed.host}${parsed.pathname}`
    return { user, host, port, name, urlRedacted }
  } catch {
    console.warn('[instances] Failed to parse DATABASE_URL (value redacted from log)')
    return { user: null, host: null, port: null, name: null, urlRedacted: null }
  }
}

export function normalizeRuntimeRootCandidate(candidate: string): string {
  const resolvedCandidate = resolve(candidate)
  const leaf = basename(resolvedCandidate).toLowerCase()
  const parentLeaf = basename(dirname(resolvedCandidate)).toLowerCase()

  if (leaf === 'instances') return dirname(resolvedCandidate)
  if (parentLeaf === 'instances') return dirname(dirname(resolvedCandidate))
  return resolvedCandidate
}

function resolveProjectMode(raw: string | undefined): 'isolated' | 'shared' | null {
  const normalized = (raw ?? '').trim().toLowerCase()
  if (normalized === 'isolated') return 'isolated'
  if (normalized === 'shared') return 'shared'
  return null
}

function looksPlaceholder(value: string | undefined): boolean {
  const normalized = (value ?? '').trim().toLowerCase()
  if (!normalized) return true
  return normalized.includes('replace_me') || normalized.includes('placeholder')
}

function cliRuntimeStatus(classification: CliStatusRuntimeSummary['classification']): RuntimeStatus {
  switch (classification) {
    case 'running':
      return 'running'
    case 'unhealthy':
      return 'unhealthy'
    case 'stale':
      return 'stale'
    case 'stopped':
      return 'stopped'
    case 'missing':
      return 'missing'
    case 'invalid':
      return 'invalid'
    default:
      return 'unknown'
  }
}

function legacyRunningStatus(classification: CliStatusRuntimeSummary['classification']): ProbeResult['runningStatus'] {
  switch (classification) {
    case 'running':
      return 'running'
    case 'stopped':
    case 'stale':
    case 'missing':
      return 'stopped'
    case 'unhealthy':
    case 'invalid':
    default:
      return 'unreachable'
  }
}

function deriveSetupState(
  envResult: ParsedEnv,
  configClassification: CliStatusConfigSummary['classification'],
  runtimeClassification: CliStatusRuntimeSummary['classification'],
): 'running' | 'configured' | 'incomplete' {
  if (runtimeClassification === 'running' || runtimeClassification === 'unhealthy') return 'running'
  const hasRequiredKeys = envResult.keyCompleteness?.allRequiredKeysPresent ?? false
  if (
    configClassification !== 'complete'
    || !envResult.present
    || !hasRequiredKeys
    || looksPlaceholder(envResult.raw?.['IRANTI_API_KEY'])
  ) {
    return 'incomplete'
  }
  return 'configured'
}

function runtimeStateOrNull(state: CliStatusRuntimeState | null): IrantiRuntimeMetadata | null {
  if (!state) return null
  if (
    typeof state.instanceName !== 'string'
    || typeof state.pid !== 'number'
    || typeof state.port !== 'number'
    || typeof state.startedAt !== 'string'
    || typeof state.lastHeartbeatAt !== 'string'
    || typeof state.updatedAt !== 'string'
    || typeof state.status !== 'string'
  ) {
    return null
  }

  return {
    instanceName: state.instanceName,
    pid: state.pid,
    port: state.port,
    startedAt: state.startedAt,
    lastHeartbeatAt: state.lastHeartbeatAt,
    updatedAt: state.updatedAt,
    status: state.status as IrantiRuntimeMetadata['status'],
    version: typeof state.version === 'string' ? state.version : undefined,
    healthUrl: typeof state.healthUrl === 'string' ? state.healthUrl : null,
  }
}

async function aggregateInstance(
  runtimeRoot: string,
  summary: CliStatusInstanceSummary,
  registeredAt: string | null,
): Promise<InstanceMetadata> {
  const instanceDir = summary.envFile ? dirname(summary.envFile) : join(runtimeRoot, 'instances', summary.name)
  const envResult = await parseInstanceEnvFile(instanceDir, runtimeRoot)
  const effectiveRuntimeRoot = envResult.resolvedRuntimeRoot
  const instanceId = deriveInstanceId(instanceDir)
  const rawPort = envResult.raw?.['IRANTI_PORT'] ?? envResult.raw?.['PORT'] ?? summary.port
  const configuredPort = rawPort && !Number.isNaN(Number.parseInt(rawPort, 10))
    ? Number.parseInt(rawPort, 10)
    : null
  const dbParsed = parseAndRedactDbUrl(envResult.raw?.['DATABASE_URL'])
  const databaseIntent = await readInstanceDatabaseIntent(instanceDir)
  const runtime = runtimeStateOrNull(summary.runtime.state)
  const runtimeStatus = cliRuntimeStatus(summary.runtime.classification)
  const runningStatus = legacyRunningStatus(summary.runtime.classification)
  const checkedAt = runtime?.updatedAt ?? runtime?.lastHeartbeatAt ?? new Date().toISOString()
  const irantVersion = runtime?.version ?? null
  const { keysPresent, keysMissing } = summarizeEnvKeys(envResult.raw, envResult.keyCompleteness)
  const name = envResult.raw?.['IRANTI_INSTANCE']?.trim()
    || envResult.raw?.['IRANTI_INSTANCE_NAME']?.trim()
    || summary.name
  const setupState = deriveSetupState(envResult, summary.config.classification, summary.runtime.classification)
  const notes = [summary.runtime.detail, summary.config.detail, ...(summary.repairHints ?? [])]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(' | ') || null

  return {
    instanceId,
    name,
    setupState,
    runtimeRoot: effectiveRuntimeRoot,
    database: envResult.raw?.['DATABASE_URL']
      ? { user: dbParsed.user, host: dbParsed.host, port: dbParsed.port, name: dbParsed.name, urlRedacted: dbParsed.urlRedacted }
      : null,
    databaseIntent,
    configuredPort,
    runningStatus,
    runningStatusCheckedAt: checkedAt,
    irantVersion,
    envFile: {
      present: envResult.present,
      bindingPresent: envResult.bindingPresent,
      path: envResult.path,
      instanceEnvPath: envResult.instanceEnvPath,
      keyCompleteness: envResult.keyCompleteness,
      keysPresent,
      keysMissing,
    },
    integration: {
      defaultProvider: normalizeProviderId(envResult.raw?.['LLM_PROVIDER']),
      defaultModel: envResult.raw?.['IRANTI_DEFAULT_MODEL'] ?? null,
      providerKeys: {
        claude: Boolean(envResult.raw?.['ANTHROPIC_API_KEY']?.trim()),
        openai: Boolean(envResult.raw?.['OPENAI_API_KEY']?.trim()),
        otherKeys: envResult.keyCompleteness?.extraProviderKeys ?? [],
      },
      providerRoutingOverrides: null,
    },
    projectMode: resolveProjectMode(envResult.raw?.['IRANTI_PROJECT_MODE']),
    projects: [],
    discoveredAt: registeredAt ?? checkedAt,
    registeredAt,
    notes,
    runtime,
    runtimeStatus,
  }
}

export function buildErrorInstance(
  runtimeRoot: string,
  instanceDir: string,
  registeredAt: string | null,
  errorMsg: string,
): InstanceMetadata {
  return {
    instanceId: deriveInstanceId(instanceDir),
    name: basename(instanceDir),
    setupState: 'incomplete',
    runtimeRoot,
    database: null,
    databaseIntent: null,
    configuredPort: null,
    runningStatus: 'unreachable',
    runningStatusCheckedAt: new Date().toISOString(),
    irantVersion: null,
    envFile: {
      present: false,
      bindingPresent: false,
      path: null,
      instanceEnvPath: null,
      keyCompleteness: null,
      keysPresent: [],
      keysMissing: [],
    },
    integration: {
      defaultProvider: null,
      defaultModel: null,
      providerKeys: { claude: false, openai: false, otherKeys: [] },
      providerRoutingOverrides: null,
    },
    projectMode: null,
    projects: [],
    discoveredAt: registeredAt ?? new Date().toISOString(),
    registeredAt,
    notes: `Aggregation error: ${errorMsg}`,
    runtime: null,
    runtimeStatus: 'unknown',
  }
}

async function listInstanceDirs(runtimeRoot: string): Promise<string[]> {
  const normalizedRoot = normalizeRuntimeRootCandidate(runtimeRoot)
  const instancesDir = join(normalizedRoot, 'instances')

  try {
    await access(instancesDir, constants.F_OK)
  } catch {
    return []
  }

  const entries = await readdir(instancesDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(instancesDir, entry.name))
}

async function aggregateFilesystemInstance(
  runtimeRoot: string,
  instanceDir: string,
  errorMsg: string,
): Promise<InstanceMetadata> {
  const envResult = await parseInstanceEnvFile(instanceDir, runtimeRoot)
  const dbParsed = parseAndRedactDbUrl(envResult.raw?.['DATABASE_URL'])
  const databaseIntent = await readInstanceDatabaseIntent(instanceDir)
  const { keysPresent, keysMissing } = summarizeEnvKeys(envResult.raw, envResult.keyCompleteness)
  const hasRequiredKeys = envResult.keyCompleteness?.allRequiredKeysPresent ?? false
  const setupState: InstanceMetadata['setupState'] = envResult.present && hasRequiredKeys && !looksPlaceholder(envResult.raw?.['IRANTI_API_KEY'])
    ? 'configured'
    : 'incomplete'
  const rawPort = envResult.raw?.['IRANTI_PORT'] ?? envResult.raw?.['PORT']
  const configuredPort = rawPort && !Number.isNaN(Number.parseInt(rawPort, 10))
    ? Number.parseInt(rawPort, 10)
    : null

  return {
    instanceId: deriveInstanceId(instanceDir),
    name: envResult.raw?.['IRANTI_INSTANCE']?.trim()
      || envResult.raw?.['IRANTI_INSTANCE_NAME']?.trim()
      || basename(instanceDir),
    setupState,
    runtimeRoot: envResult.resolvedRuntimeRoot,
    database: envResult.raw?.['DATABASE_URL']
      ? { user: dbParsed.user, host: dbParsed.host, port: dbParsed.port, name: dbParsed.name, urlRedacted: dbParsed.urlRedacted }
      : null,
    databaseIntent,
    configuredPort,
    runningStatus: 'unreachable',
    runningStatusCheckedAt: new Date().toISOString(),
    irantVersion: null,
    envFile: {
      present: envResult.present,
      bindingPresent: envResult.bindingPresent,
      path: envResult.path,
      instanceEnvPath: envResult.instanceEnvPath,
      keyCompleteness: envResult.keyCompleteness,
      keysPresent,
      keysMissing,
    },
    integration: {
      defaultProvider: normalizeProviderId(envResult.raw?.['LLM_PROVIDER']),
      defaultModel: envResult.raw?.['IRANTI_DEFAULT_MODEL'] ?? null,
      providerKeys: {
        claude: Boolean(envResult.raw?.['ANTHROPIC_API_KEY']?.trim()),
        openai: Boolean(envResult.raw?.['OPENAI_API_KEY']?.trim()),
        otherKeys: envResult.keyCompleteness?.extraProviderKeys ?? [],
      },
      providerRoutingOverrides: null,
    },
    projectMode: resolveProjectMode(envResult.raw?.['IRANTI_PROJECT_MODE']),
    projects: [],
    discoveredAt: new Date().toISOString(),
    registeredAt: null,
    notes: `CLI status unavailable: ${errorMsg}`,
    runtime: null,
    runtimeStatus: 'unknown',
  }
}

async function fallbackInstancesForRoot(runtimeRoot: string, errorMsg: string): Promise<InstanceMetadata[]> {
  const instanceDirs = await listInstanceDirs(runtimeRoot)
  return Promise.all(instanceDirs.map((instanceDir) => aggregateFilesystemInstance(runtimeRoot, instanceDir, errorMsg)))
}

async function discoverAndAggregate(): Promise<{
  instances: InstanceMetadata[]
  discoverySource: 'registry' | 'scan' | 'hybrid'
  discoveredAt: string
}> {
  const runtimeRoots = runtimeRootsToCheck()
  const discoveredAt = new Date().toISOString()
  if (runtimeRoots.length === 0) {
    return {
      instances: [],
      discoverySource: 'scan',
      discoveredAt,
    }
  }

  const settled = await Promise.all(runtimeRoots.map(async (runtimeRoot) => {
    try {
      const status = await runIrantiJson<CliStatusResponse>(['status', '--root', runtimeRoot, '--json'])
      return { runtimeRoot, status: status.json, usedFallback: false, error: null as string | null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const fallback = await fallbackInstancesForRoot(runtimeRoot, `iranti status failed: ${message}`)
      return { runtimeRoot, status: null, usedFallback: true, fallback, error: message }
    }
  }))

  const aggregatedNested = await Promise.all(settled.map(async (entry) => {
    if (entry.status) {
      return Promise.all(
        entry.status.instances.map((summary) => aggregateInstance(entry.runtimeRoot, summary, null))
      )
    }
    return entry.fallback
  }))

  const aggregated = aggregatedNested.flat()
  const setupPriority: Record<InstanceMetadata['setupState'], number> = {
    running: 0,
    configured: 1,
    incomplete: 2,
  }
  const runtimePriority: Record<RuntimeStatus, number> = {
    running: 0,
    unhealthy: 1,
    stale: 2,
    stopped: 3,
    missing: 4,
    invalid: 5,
    unknown: 6,
  }

  const byName = new Map<string, InstanceMetadata>()
  for (const instance of aggregated) {
    const existing = byName.get(instance.name)
    if (!existing) {
      byName.set(instance.name, instance)
      continue
    }

    const nextScore = [setupPriority[instance.setupState], runtimePriority[instance.runtimeStatus]]
    const existingScore = [setupPriority[existing.setupState], runtimePriority[existing.runtimeStatus]]
    if (
      nextScore[0] < existingScore[0]
      || (nextScore[0] === existingScore[0] && nextScore[1] < existingScore[1])
    ) {
      byName.set(instance.name, instance)
    }
  }

  const usedFallback = settled.some((entry) => entry.usedFallback)
  const usedCli = settled.some((entry) => entry.status !== null)

  return {
    instances: Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name)),
    discoverySource: usedCli && usedFallback ? 'hybrid' : usedCli ? 'registry' : 'scan',
    discoveredAt,
  }
}

instancesRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await discoverAndAggregate()
    res.json(result)
  } catch (err) {
    next(err)
  }
})

instancesRouter.get('/:instanceId/projects', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await resolveInstanceAuthority(req.params['instanceId'])
    if (!scope) {
      res.status(404).json({
        error: 'Instance not found',
        code: 'INSTANCE_NOT_FOUND',
      })
      return
    }

    res.json({
      instanceName: scope.instanceName,
      projects: scope.boundProjects.map((project) => ({
        projectPath: project.projectPath,
        agentId: 'main_agent',
        memoryEntity: `project/${basename(project.projectPath)}`,
        mode: 'isolated',
        boundAt: null,
      })),
    })
  } catch (err) {
    next(err)
  }
})

interface EnvDefaultsResponse {
  agentId: string | null
}

instancesRouter.get('/:instanceId/env-defaults', (_req: Request, res: Response) => {
  const rawAgentId = env['IRANTI_AGENT_ID'] ?? process.env['IRANTI_AGENT_ID'] ?? ''
  const agentId = rawAgentId.trim() !== '' ? rawAgentId.trim() : null
  const body: EnvDefaultsResponse = { agentId }
  res.json(body)
})

instancesRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const apiErr = err as ApiError
  const statusCode = apiErr.statusCode ?? 500
  res.status(statusCode).json({
    error: apiErr.message ?? 'Internal server error',
    code: apiErr.code ?? 'INTERNAL_ERROR',
    ...(apiErr.detail ? { detail: apiErr.detail } : {}),
  })
})
