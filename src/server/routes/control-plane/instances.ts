/**
 * Instance metadata routes
 *
 * GET /instances                        — discover and aggregate all instances
 * GET /instances/:instanceId/projects   — Phase 1 stub (projectBindingsUnavailable: true)
 *
 * Instance discovery: reads ~/.iranti/instances.json first, falls back to candidate scan.
 * Metadata aggregation: env file parse, DATABASE_URL redaction, HTTP health probe.
 *
 * SECURITY INVARIANT: The raw env map is never returned in API responses.
 * Only structured derived fields are returned (boolean key presence, redacted URLs).
 */

import { Router, Request, Response, NextFunction } from 'express'
import { readFile, access, constants, readdir } from 'fs/promises'
import { join, basename, dirname, resolve } from 'path'
import { homedir } from 'os'
import http from 'http'
import { URL } from 'url'
import { env } from '../../db.js'
import { ApiError } from '../../types.js'
import { deriveInstanceId } from '../../lib/instance-authority.js'
import {
  IrantiRuntimeMetadata,
  RuntimeStatus,
  deriveRuntimeStatus,
} from './health.js'

export const instancesRouter = Router()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RegistryEntry {
  instanceId?: string
  runtimeRoot: string
  registeredAt?: string | null
}

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
  host: string | null
  port: number | null
  name: string | null
  urlRedacted: string | null
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
  database: { host: string | null; port: number | null; name: string | null; urlRedacted: string | null } | null
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
    providerKeys: { anthropic: boolean; openai: boolean; otherKeys: string[] }
    providerRoutingOverrides: null
  }
  /** CP-T058 H8 — IRANTI_PROJECT_MODE from the instance's .env.iranti; null if not set */
  projectMode: 'isolated' | 'shared' | null
  projects: []
  discoveredAt: string
  registeredAt: string | null
  notes: string | null   // string | null — buildErrorInstance may set a string message
  /** CP-T072 — Runtime lifecycle metadata from Iranti /health; null if ad-hoc or unreachable */
  runtime: IrantiRuntimeMetadata | null
  /** CP-T072 — Derived staleness status */
  runtimeStatus: RuntimeStatus
}

// ---------------------------------------------------------------------------
// Env file parsing
// ---------------------------------------------------------------------------

const REQUIRED_KEYS = ['DATABASE_URL', 'IRANTI_PORT'] as const
const PROVIDER_KEY_RE = /^(ANTHROPIC|OPENAI)_API_KEY$/

export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
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

async function parseEnvFile(runtimeRoot: string): Promise<ParsedEnv> {
  const bindingPath = join(runtimeRoot, '.env.iranti')
  let bindingRaw: Record<string, string> | null = null

  try {
    const content = await readFile(bindingPath, 'utf8')
    bindingRaw = parseEnvContent(content)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        present: false,
        bindingPresent: false,
        path: bindingPath,
        instanceEnvPath: null,
        resolvedRuntimeRoot: runtimeRoot,
        raw: null,
        keyCompleteness: null,
      }
    }
    // Unexpected read error — surface as not-present with a null parse
    console.warn(`[instances] Failed to read env file at ${bindingPath}:`, err)
    return {
      present: false,
      bindingPresent: false,
      path: bindingPath,
      instanceEnvPath: null,
      resolvedRuntimeRoot: runtimeRoot,
      raw: null,
      keyCompleteness: null,
    }
  }

  const instanceEnvPath = bindingRaw?.['IRANTI_INSTANCE_ENV']?.trim() || null
  let instanceRaw: Record<string, string> = {}
  if (instanceEnvPath) {
    try {
      const content = await readFile(instanceEnvPath, 'utf8')
      instanceRaw = parseEnvContent(content)
    } catch (err: unknown) {
      console.warn(`[instances] Failed to read instance env file at ${instanceEnvPath}:`, err)
    }
  }

  const raw = { ...(bindingRaw ?? {}), ...instanceRaw }
  const resolvedRuntimeRoot = instanceEnvPath
    ? resolve(dirname(instanceEnvPath), '..', '..')
    : runtimeRoot

  const requiredKeyResults = REQUIRED_KEYS.map((key) => {
    const aliases = key === 'IRANTI_PORT' ? ['IRANTI_PORT', 'PORT'] : [key]
    return {
      key,
      present: aliases.some((alias) => (raw[alias] ?? '').trim() !== ''),
    }
  })

  const extraProviderKeys = Object.keys(raw).filter(
    (k) => k.endsWith('_API_KEY') && !PROVIDER_KEY_RE.test(k)
  )

  return {
    present: true,
    bindingPresent: true,
    path: bindingPath,
    instanceEnvPath,
    resolvedRuntimeRoot,
    raw,
    keyCompleteness: {
      allRequiredKeysPresent: requiredKeyResults.every((r) => r.present),
      requiredKeys: requiredKeyResults,
      extraProviderKeys,
    },
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
      (k) => k.endsWith('_API_KEY') && !PROVIDER_KEY_RE.test(k)
    )

    return {
      present: true,
      bindingPresent: false,
      path: null,
      instanceEnvPath,
      resolvedRuntimeRoot: runtimeRoot,
      raw,
      keyCompleteness: {
        allRequiredKeysPresent: requiredKeyResults.every((r) => r.present),
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

// ---------------------------------------------------------------------------
// DATABASE_URL redaction
// ---------------------------------------------------------------------------

export function parseAndRedactDbUrl(rawUrl: string | undefined): ParsedDbUrl {
  if (!rawUrl) return { host: null, port: null, name: null, urlRedacted: null }
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname || null
    const port = parsed.port ? parseInt(parsed.port, 10) : 5432
    const name = parsed.pathname.replace(/^\//, '') || null
    const redacted = `${parsed.protocol}//***@${parsed.host}${parsed.pathname}`
    return { host, port, name, urlRedacted: redacted }
  } catch {
    console.warn('[instances] Failed to parse DATABASE_URL (value redacted from log)')
    return { host: null, port: null, name: null, urlRedacted: null }
  }
}

// ---------------------------------------------------------------------------
// HTTP health probe
// ---------------------------------------------------------------------------

function probeInstance(port: number): Promise<ProbeResult> {
  const checkedAt = new Date().toISOString()
  const TIMEOUT_MS = 500

  return new Promise((resolve) => {
    const req = http.get(
      { hostname: 'localhost', port, path: '/health', timeout: TIMEOUT_MS },
      (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            resolve({ runningStatus: 'unreachable', irantVersion: null, checkedAt })
            return
          }

          try {
            const parsed = JSON.parse(body) as Record<string, unknown>
            const status = parsed['status']
            const runtime = parsed['runtime']
            const looksLikeIranti =
              status === 'ok' ||
              (runtime !== null && typeof runtime === 'object')

            if (!looksLikeIranti) {
              resolve({ runningStatus: 'unreachable', irantVersion: null, checkedAt })
              return
            }

            const version = typeof parsed.version === 'string' ? parsed.version : null
            resolve({ runningStatus: 'running', irantVersion: version, checkedAt })
          } catch {
            resolve({ runningStatus: 'unreachable', irantVersion: null, checkedAt })
          }
        })
      }
    )

    req.on('timeout', () => {
      req.destroy()
      resolve({ runningStatus: 'unreachable', irantVersion: null, checkedAt })
    })

    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') {
        resolve({ runningStatus: 'stopped', irantVersion: null, checkedAt })
      } else {
        resolve({ runningStatus: 'unreachable', irantVersion: null, checkedAt })
      }
    })
  })
}

// ---------------------------------------------------------------------------
// CP-T072: Per-instance runtime metadata fetch
// ---------------------------------------------------------------------------

async function fetchInstanceRuntime(port: number): Promise<IrantiRuntimeMetadata | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)

  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      method: 'GET',
      signal: controller.signal,
    })

    if (!res.ok) return null

    const body = await res.json() as Record<string, unknown>
    const runtime = body['runtime']

    if (!runtime || typeof runtime !== 'object') return null

    const r = runtime as Record<string, unknown>

    if (
      typeof r['instanceName'] !== 'string' ||
      typeof r['pid'] !== 'number' ||
      typeof r['port'] !== 'number' ||
      typeof r['startedAt'] !== 'string' ||
      typeof r['lastHeartbeatAt'] !== 'string' ||
      typeof r['status'] !== 'string'
    ) {
      return null
    }

    return {
      instanceName: r['instanceName'],
      pid: r['pid'],
      port: r['port'],
      startedAt: r['startedAt'],
      lastHeartbeatAt: r['lastHeartbeatAt'],
      updatedAt: typeof r['updatedAt'] === 'string' ? r['updatedAt'] : r['lastHeartbeatAt'],
      status: r['status'] as IrantiRuntimeMetadata['status'],
      version: typeof r['version'] === 'string' ? r['version'] : undefined,
      healthUrl: typeof r['healthUrl'] === 'string' ? r['healthUrl'] : null,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// Version from package.json fallback
// ---------------------------------------------------------------------------

async function readVersionFromPackageJson(runtimeRoot: string): Promise<string | null> {
  const candidates = [
    join(runtimeRoot, 'package.json'),
    join(runtimeRoot, 'node_modules', 'iranti', 'package.json'),
  ]

  for (const pkgPath of candidates) {
    try {
      const raw = await readFile(pkgPath, 'utf8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (typeof parsed.version === 'string') return parsed.version
    } catch { /* try next */ }
  }
  return null
}

// ---------------------------------------------------------------------------
// CP-T058 H8 — Resolve IRANTI_PROJECT_MODE to a typed value
// ---------------------------------------------------------------------------

function resolveProjectMode(raw: string | undefined): 'isolated' | 'shared' | null {
  if (!raw) return null
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'isolated') return 'isolated'
  if (normalized === 'shared') return 'shared'
  return null  // unrecognized value treated as not set
}

// ---------------------------------------------------------------------------
// Per-instance aggregation
// ---------------------------------------------------------------------------

function looksPlaceholder(value: string | undefined): boolean {
  const normalized = (value ?? '').trim().toLowerCase()
  if (!normalized) return true
  return normalized.includes('replace_me') || normalized.includes('placeholder')
}

function deriveSetupState(
  envResult: ParsedEnv,
  runningStatus: ProbeResult['runningStatus'],
): 'running' | 'configured' | 'incomplete' {
  if (runningStatus === 'running') return 'running'
  const hasRequiredKeys = envResult.keyCompleteness?.allRequiredKeysPresent ?? false
  if (!envResult.present || !hasRequiredKeys || looksPlaceholder(envResult.raw?.['IRANTI_API_KEY'])) {
    return 'incomplete'
  }
  return 'configured'
}

async function aggregateInstance(
  runtimeRoot: string,
  instanceDir: string,
  registeredAt: string | null
): Promise<InstanceMetadata> {
  const envResult = await parseInstanceEnvFile(instanceDir, runtimeRoot)
  const effectiveRuntimeRoot = envResult.resolvedRuntimeRoot
  // Iranti writes IRANTI_INSTANCE_NAME; the binding file uses IRANTI_INSTANCE. Check both.
  const instanceId = envResult.raw?.['IRANTI_INSTANCE']?.trim() || deriveInstanceId(instanceDir)

  const rawPort = envResult.raw?.['IRANTI_PORT'] ?? envResult.raw?.['PORT']
  const port =
    rawPort && !isNaN(parseInt(rawPort, 10)) ? parseInt(rawPort, 10) : 3001

  const dbParsed = parseAndRedactDbUrl(envResult.raw?.['DATABASE_URL'])

  const [probe, versionFallback, runtime] = await Promise.all([
    probeInstance(port),
    envResult.present ? readVersionFromPackageJson(effectiveRuntimeRoot) : Promise.resolve(null),
    fetchInstanceRuntime(port),
  ])

  const irantVersion = probe.irantVersion ?? versionFallback
  const { keysPresent, keysMissing } = summarizeEnvKeys(envResult.raw, envResult.keyCompleteness)
  const name = envResult.raw?.['IRANTI_INSTANCE']?.trim() || envResult.raw?.['IRANTI_INSTANCE_NAME']?.trim() || basename(instanceDir)
  const setupState = deriveSetupState(envResult, probe.runningStatus)

  return {
    instanceId,
    name,
    setupState,
    runtimeRoot: effectiveRuntimeRoot,
    database: envResult.raw?.['DATABASE_URL']
      ? { host: dbParsed.host, port: dbParsed.port, name: dbParsed.name, urlRedacted: dbParsed.urlRedacted }
      : null,
    configuredPort: port,
    runningStatus: probe.runningStatus,
    runningStatusCheckedAt: probe.checkedAt,
    irantVersion,
    envFile: {
      present: envResult.present,
      path: envResult.path,
      instanceEnvPath: envResult.instanceEnvPath,
      bindingPresent: envResult.bindingPresent,
      keyCompleteness: envResult.keyCompleteness,
      keysPresent,
      keysMissing,
    },
    integration: {
      // SECURITY: only boolean presence and non-secret derived values returned
      // LLM_PROVIDER is the authoritative instance runtime var; IRANTI_DEFAULT_PROVIDER
      // was a project-binding var that had no runtime authority and has been removed.
      defaultProvider: envResult.raw?.['LLM_PROVIDER'] ?? null,
      defaultModel: envResult.raw?.['IRANTI_DEFAULT_MODEL'] ?? null,
      providerKeys: {
        anthropic: !!(envResult.raw?.['ANTHROPIC_API_KEY']?.trim()),
        openai: !!(envResult.raw?.['OPENAI_API_KEY']?.trim()),
        otherKeys: envResult.keyCompleteness?.extraProviderKeys ?? [],
      },
      providerRoutingOverrides: null,
    },
    // CP-T058 H8 — IRANTI_PROJECT_MODE: safe to surface (non-secret operational config)
    projectMode: resolveProjectMode(envResult.raw?.['IRANTI_PROJECT_MODE']),
    // Phase 1: project bindings are stubbed — CP-T006 spike required for binding source
    projects: [],
    discoveredAt: registeredAt ?? probe.checkedAt,
    registeredAt: registeredAt ?? null,
    notes: null,
    // CP-T072: runtime lifecycle metadata — null for ad-hoc instances or when unreachable
    runtime,
    runtimeStatus: deriveRuntimeStatus(runtime),
  }
}

export function buildErrorInstance(
  runtimeRoot: string,
  instanceDir: string,
  registeredAt: string | null,
  errorMsg: string
): InstanceMetadata {
  return {
    instanceId: deriveInstanceId(instanceDir),
    name: basename(instanceDir),
    setupState: 'incomplete',
    runtimeRoot,
    database: null,
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
      providerKeys: { anthropic: false, openai: false, otherKeys: [] },
      providerRoutingOverrides: null,
    },
    projectMode: null,
    projects: [],
    discoveredAt: registeredAt ?? new Date().toISOString(),
    registeredAt,
    notes: `Aggregation error: ${errorMsg}`,
    // CP-T072: runtime unavailable for error instances
    runtime: null,
    runtimeStatus: 'unknown',
  }
}

// ---------------------------------------------------------------------------
// Instance discovery
// ---------------------------------------------------------------------------

async function readRegistry(): Promise<RegistryEntry[] | null> {
  const registryPath = join(homedir(), '.iranti', 'instances.json')
  try {
    const raw = await readFile(registryPath, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!Array.isArray(parsed?.instances)) return null
    return parsed.instances as RegistryEntry[]
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[instances] Registry file parse error — falling back to scan:', err)
    }
    return null
  }
}

async function scanCandidatePaths(): Promise<string[]> {
  const home = homedir()
  const cwd = process.cwd()

  const candidates = [
    join(home, '.iranti'),
    join(home, '.iranti-runtime'),
    join(home, 'iranti'),
    cwd,
  ]

  const found = new Set<string>()
  for (const dir of candidates) {
    try {
      await access(join(dir, 'instances'), constants.F_OK)
      found.add(dir)
      continue
    } catch { /* not a runtime root */ }

    const envPath = join(dir, '.env.iranti')
    try {
      await access(envPath, constants.F_OK)
      const parsed = parseEnvContent(await readFile(envPath, 'utf8'))
      const instanceEnvPath = parsed.IRANTI_INSTANCE_ENV?.trim()
      if (instanceEnvPath) {
        found.add(resolve(dirname(instanceEnvPath), '..', '..'))
      }
    } catch { /* not found — skip */ }
  }
  return Array.from(found)
}

export function normalizeRuntimeRootCandidate(candidate: string): string {
  const resolved = resolve(candidate)
  const leaf = basename(resolved).toLowerCase()
  const parentLeaf = basename(dirname(resolved)).toLowerCase()

  // Accept either the runtime root itself, the instances directory, or a
  // concrete instance directory and normalize all of them back to the runtime root.
  if (leaf === 'instances') return dirname(resolved)
  if (parentLeaf === 'instances') return dirname(dirname(resolved))
  return resolved
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

async function discoverInstances(): Promise<{
  roots: { runtimeRoot: string; registeredAt: string | null }[]
  source: 'registry' | 'scan' | 'hybrid'
}> {
  const registryEntries = await readRegistry()

  if (registryEntries && registryEntries.length > 0) {
    const deduped = new Map<string, string | null>()
    for (const entry of registryEntries) {
      const runtimeRoot = normalizeRuntimeRootCandidate(entry.runtimeRoot)
      if (!deduped.has(runtimeRoot)) {
        deduped.set(runtimeRoot, entry.registeredAt ?? null)
      }
    }
    return {
      roots: Array.from(deduped.entries()).map(([runtimeRoot, registeredAt]) => ({
        runtimeRoot,
        registeredAt,
      })),
      source: 'registry',
    }
  }

  const scannedRoots = await scanCandidatePaths()
  const normalizedRoots = Array.from(
    new Set(scannedRoots.map((root) => normalizeRuntimeRootCandidate(root)))
  )
  return {
    roots: normalizedRoots.map((r) => ({ runtimeRoot: r, registeredAt: null })),
    source: 'scan',
  }
}

async function discoverAndAggregate(): Promise<{
  instances: InstanceMetadata[]
  discoverySource: string
  discoveredAt: string
}> {
  const { roots, source } = await discoverInstances()
  const instanceRefs = (
    await Promise.all(
      roots.map(async ({ runtimeRoot, registeredAt }) => {
        const instanceDirs = await listInstanceDirs(runtimeRoot)
        return instanceDirs.map((instanceDir) => ({ runtimeRoot, registeredAt, instanceDir }))
      })
    )
  ).flat()

  const aggregated = await Promise.all(
    instanceRefs.map(({ runtimeRoot, registeredAt, instanceDir }) =>
      aggregateInstance(runtimeRoot, instanceDir, registeredAt).catch((err: unknown) => {
        console.error(`[instances] Failed to aggregate ${instanceDir}:`, err)
        return buildErrorInstance(runtimeRoot, instanceDir, registeredAt, String(err))
      })
    )
  )

  // De-duplicate by instance name. When the same name appears in multiple runtime roots
  // (e.g. ~/.iranti and ~/.iranti-runtime), prefer: running > configured > incomplete.
  const setupPriority = { running: 0, configured: 1, incomplete: 2 }
  const byName = new Map<string, InstanceMetadata>()
  for (const inst of aggregated) {
    const existing = byName.get(inst.name)
    if (!existing) {
      byName.set(inst.name, inst)
      continue
    }
    const existingPri = setupPriority[existing.setupState] ?? 3
    const newPri = setupPriority[inst.setupState] ?? 3
    if (newPri < existingPri) byName.set(inst.name, inst)
  }
  const instances = Array.from(byName.values())

  return { instances, discoverySource: source, discoveredAt: new Date().toISOString() }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

instancesRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await discoverAndAggregate()
    res.json({
      instances: result.instances,
      discoveredAt: result.discoveredAt,
      discoverySource: result.discoverySource,
    })
  } catch (err) {
    next(err)
  }
})

instancesRouter.get('/:instanceId/projects', (req: Request, res: Response) => {
  const { instanceId } = req.params
  // Phase 1 stub — project binding discovery pending CP-T006 spike
  // CP-T003 §7.2 proposes an upstream project binding registry that does not yet exist.
  res.json({
    instanceId,
    projects: [],
    projectBindingsUnavailable: true,
    note: 'Project binding discovery is pending CP-T006. No binding registry source has been confirmed.',
  })
})

// ---------------------------------------------------------------------------
// GET /:instanceId/env-defaults
// ---------------------------------------------------------------------------
//
// Returns env-derived defaults for the chat panel (and any other UI consumer).
// Currently this control plane manages a single local Iranti instance, so
// :instanceId is accepted but ignored — we always read from the loaded env
// singleton. When multi-instance support is added this route should re-parse
// the target instance's env file using parseEnvFile(runtimeRoot) instead.

interface EnvDefaultsResponse {
  agentId: string | null
}

instancesRouter.get('/:instanceId/env-defaults', (_req: Request, res: Response) => {
  const rawAgentId = env['IRANTI_AGENT_ID'] ?? process.env['IRANTI_AGENT_ID'] ?? ''
  const agentId = rawAgentId.trim() !== '' ? rawAgentId.trim() : null
  const body: EnvDefaultsResponse = { agentId }
  res.json(body)
})

// Error handler
instancesRouter.use(
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const apiErr = err as ApiError
    const statusCode = apiErr.statusCode ?? 500
    res.status(statusCode).json({
      error: apiErr.message ?? 'Internal server error',
      code: apiErr.code ?? 'INTERNAL_ERROR',
      ...(apiErr.detail ? { detail: apiErr.detail } : {}),
    })
  }
)



