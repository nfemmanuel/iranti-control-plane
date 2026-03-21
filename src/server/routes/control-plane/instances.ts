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
import { readFile, access, constants } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { createHash } from 'crypto'
import http from 'http'
import { URL } from 'url'
import { env } from '../../db.js'
import { ApiError } from '../../types.js'

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
  path: string
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
  runtimeRoot: string
  database: { host: string | null; port: number | null; name: string | null; urlRedacted: string | null } | null
  configuredPort: number | null
  runningStatus: 'running' | 'stopped' | 'unreachable'
  runningStatusCheckedAt: string
  irantVersion: string | null
  envFile: { present: boolean; path: string; keyCompleteness: EnvKeyCompleteness | null }
  integration: {
    defaultProvider: string | null
    defaultModel: string | null
    providerKeys: { anthropic: boolean; openai: boolean; otherKeys: string[] }
    providerRoutingOverrides: null
  }
  /** CP-T058 H8 — IRANTI_PROJECT_MODE from the instance's .env.iranti; null if not set */
  projectMode: 'isolated' | 'shared' | null
  projects: []
  registeredAt: string | null
  notes: string | null   // string | null — buildErrorInstance may set a string message
}

// ---------------------------------------------------------------------------
// Instance ID derivation
// ---------------------------------------------------------------------------

function deriveInstanceId(runtimeRoot: string): string {
  // Normalize to lowercase + forward slashes before hashing for cross-platform stability
  const normalized = runtimeRoot.toLowerCase().replace(/\\/g, '/')
  return createHash('sha256').update(normalized).digest('hex').slice(0, 8)
}

// ---------------------------------------------------------------------------
// Env file parsing
// ---------------------------------------------------------------------------

const REQUIRED_KEYS = ['DATABASE_URL', 'PORT']
const PROVIDER_KEY_RE = /^(ANTHROPIC|OPENAI)_API_KEY$/

function parseEnvContent(content: string): Record<string, string> {
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

async function parseEnvFile(runtimeRoot: string): Promise<ParsedEnv> {
  const envPath = join(runtimeRoot, '.env.iranti')
  let raw: Record<string, string> | null = null

  try {
    const content = await readFile(envPath, 'utf8')
    raw = parseEnvContent(content)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { present: false, path: envPath, raw: null, keyCompleteness: null }
    }
    // Unexpected read error — surface as not-present with a null parse
    console.warn(`[instances] Failed to read env file at ${envPath}:`, err)
    return { present: false, path: envPath, raw: null, keyCompleteness: null }
  }

  const requiredKeyResults = REQUIRED_KEYS.map((k) => ({
    key: k,
    present: k in raw! && (raw![k] ?? '').trim() !== '',
  }))

  const extraProviderKeys = Object.keys(raw).filter(
    (k) => k.endsWith('_API_KEY') && !PROVIDER_KEY_RE.test(k)
  )

  return {
    present: true,
    path: envPath,
    raw,
    keyCompleteness: {
      allRequiredKeysPresent: requiredKeyResults.every((r) => r.present),
      requiredKeys: requiredKeyResults,
      extraProviderKeys,
    },
  }
}

// ---------------------------------------------------------------------------
// DATABASE_URL redaction
// ---------------------------------------------------------------------------

function parseAndRedactDbUrl(rawUrl: string | undefined): ParsedDbUrl {
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
          let version: string | null = null
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(body) as Record<string, unknown>
              version = typeof parsed.version === 'string' ? parsed.version : null
            } catch { /* non-JSON health endpoint */ }
          }
          resolve({ runningStatus: 'running', irantVersion: version, checkedAt })
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

async function aggregateInstance(
  runtimeRoot: string,
  registeredAt: string | null
): Promise<InstanceMetadata> {
  const instanceId = deriveInstanceId(runtimeRoot)
  const envResult = await parseEnvFile(runtimeRoot)

  const rawPort = envResult.raw?.['PORT']
  const port =
    rawPort && !isNaN(parseInt(rawPort, 10)) ? parseInt(rawPort, 10) : 3001

  const dbParsed = parseAndRedactDbUrl(envResult.raw?.['DATABASE_URL'])

  const [probe, versionFallback] = await Promise.all([
    probeInstance(port),
    envResult.present ? readVersionFromPackageJson(runtimeRoot) : Promise.resolve(null),
  ])

  const irantVersion = probe.irantVersion ?? versionFallback

  return {
    instanceId,
    runtimeRoot,
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
      keyCompleteness: envResult.keyCompleteness,
    },
    integration: {
      // SECURITY: only boolean presence and non-secret derived values returned
      defaultProvider: envResult.raw?.['IRANTI_DEFAULT_PROVIDER'] ?? null,
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
    registeredAt: registeredAt ?? null,
    notes: null,
  }
}

function buildErrorInstance(
  runtimeRoot: string,
  registeredAt: string | null,
  errorMsg: string
): InstanceMetadata {
  return {
    instanceId: deriveInstanceId(runtimeRoot),
    runtimeRoot,
    database: null,
    configuredPort: null,
    runningStatus: 'unreachable',
    runningStatusCheckedAt: new Date().toISOString(),
    irantVersion: null,
    envFile: { present: false, path: join(runtimeRoot, '.env.iranti'), keyCompleteness: null },
    integration: {
      defaultProvider: null,
      defaultModel: null,
      providerKeys: { anthropic: false, openai: false, otherKeys: [] },
      providerRoutingOverrides: null,
    },
    projectMode: null,
    projects: [],
    registeredAt,
    notes: `Aggregation error: ${errorMsg}`,
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
    join(home, 'iranti'),
    cwd,
  ]

  const found: string[] = []
  for (const dir of candidates) {
    const envPath = join(dir, '.env.iranti')
    try {
      await access(envPath, constants.F_OK)
      found.push(dir)
    } catch { /* not found — skip */ }
  }
  return found
}

async function discoverInstances(): Promise<{
  roots: { runtimeRoot: string; registeredAt: string | null }[]
  source: 'registry' | 'scan' | 'hybrid'
}> {
  const registryEntries = await readRegistry()

  if (registryEntries && registryEntries.length > 0) {
    return {
      roots: registryEntries.map((e) => ({
        runtimeRoot: e.runtimeRoot,
        registeredAt: e.registeredAt ?? null,
      })),
      source: 'registry',
    }
  }

  const scannedRoots = await scanCandidatePaths()
  return {
    roots: scannedRoots.map((r) => ({ runtimeRoot: r, registeredAt: null })),
    source: 'scan',
  }
}

async function discoverAndAggregate(): Promise<{
  instances: InstanceMetadata[]
  discoverySource: string
  discoveredAt: string
}> {
  const { roots, source } = await discoverInstances()

  const instances = await Promise.all(
    roots.map(({ runtimeRoot, registeredAt }) =>
      aggregateInstance(runtimeRoot, registeredAt).catch((err: unknown) => {
        console.error(`[instances] Failed to aggregate ${runtimeRoot}:`, err)
        return buildErrorInstance(runtimeRoot, registeredAt, String(err))
      })
    )
  )

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
