/**
 * instance-authority.ts — Instance resolution: the single source of truth for
 *                         locating and describing a running Iranti instance.
 *
 * Given an optional instanceRef (name or derived ID), resolves the full
 * ResolvedInstanceAuthority — the instance directory, env file, API base URL,
 * API key, database URL, and list of bound projects.
 *
 * Resolution order:
 *   1. Explicit query match: instanceRef matches an instance name or derived ID.
 *   2. Binding match: IRANTI_INSTANCE / IRANTI_INSTANCE_NAME in the CP env
 *      matches an instance name in the scanned runtime roots.
 *
 * The derived instanceId is a stable 8-hex-char SHA-256 of the lowercased,
 * forward-slash-normalised instance directory path.
 */

import { createHash } from 'crypto'
import { access, readFile } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { join, basename, dirname, resolve } from 'path'
import { env as controlPlaneEnv } from '../db.js'
import { runtimeRootCandidates as discoverRuntimeRootCandidates, parseSimpleEnv } from './runtime-roots.js'

export interface BoundProjectRef {
  projectPath: string
  source: 'registry' | 'cwd-binding'
}

export interface ResolvedInstanceAuthority {
  instanceId: string
  instanceName: string
  instanceDir: string
  instanceEnvPath: string
  runtimeRoot: string
  apiBaseUrl: string
  apiKey: string | null
  databaseUrl: string | null
  databaseIntent: {
    strategy: 'dedicated-local' | 'shared-local' | 'external-existing'
    provisioning: 'local' | 'docker' | 'managed'
    host: string
    port?: number
    database: string
    dockerContainerName?: string
  } | null
  env: Record<string, string>
  boundProjects: BoundProjectRef[]
  source: 'query' | 'binding'
}

interface ProjectRegistryEntry {
  projectPath: string
}

interface ProjectRegistry {
  projects: ProjectRegistryEntry[]
}

type ParsedDatabaseIntent = ResolvedInstanceAuthority['databaseIntent']

export function deriveInstanceId(instanceDir: string): string {
  const normalized = instanceDir.toLowerCase().replace(/\\/g, '/')
  return createHash('sha256').update(normalized).digest('hex').slice(0, 8)
}

/** Re-exported from runtime-roots.ts; kept here for backwards-compatible imports. */
export { parseSimpleEnv }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseDatabaseIntentFromMeta(raw: unknown): ParsedDatabaseIntent {
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
}

async function readInstanceDatabaseIntent(instanceDir: string): Promise<ParsedDatabaseIntent> {
  try {
    const metaPath = join(instanceDir, 'instance.json')
    const parsed = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>
    return parseDatabaseIntentFromMeta(parsed['databaseIntent'])
  } catch {
    return null
  }
}

function configuredBindingInstanceName(): string | null {
  // IRANTI_INSTANCE is the binding-file name; IRANTI_INSTANCE_NAME is written by the Iranti CLI
  // into instance envs. Accept either so that servers started from the instance env (no binding
  // file in cwd) can still resolve their own instance.
  const explicit =
    controlPlaneEnv['IRANTI_INSTANCE'] ??
    controlPlaneEnv['IRANTI_INSTANCE_NAME'] ??
    process.env['IRANTI_INSTANCE'] ??
    process.env['IRANTI_INSTANCE_NAME'] ??
    ''
  if (explicit.trim()) return explicit.trim()

  const instanceEnvPath = controlPlaneEnv['IRANTI_INSTANCE_ENV'] ?? process.env['IRANTI_INSTANCE_ENV'] ?? ''
  if (!instanceEnvPath.trim()) return null
  return basename(dirname(instanceEnvPath))
}

async function listInstanceDirs(runtimeRoot: string): Promise<string[]> {
  const instancesDir = join(runtimeRoot, 'instances')
  try {
    const fs = await import('fs/promises')
    const entries = await fs.readdir(instancesDir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(instancesDir, entry.name))
  } catch {
    return []
  }
}

async function findInstanceDir(instanceRef?: string): Promise<{
  instanceDir: string
  instanceName: string
  runtimeRoot: string
  source: 'query' | 'binding'
} | null> {
  const requested = instanceRef?.trim() || null
  const bindingName = configuredBindingInstanceName()

  for (const runtimeRoot of discoverRuntimeRootCandidates()) {
    const instanceDirs = await listInstanceDirs(runtimeRoot)
    for (const instanceDir of instanceDirs) {
      const instanceName = basename(instanceDir)
      const instanceId = deriveInstanceId(instanceDir)
      if (requested && (requested === instanceName || requested === instanceId)) {
        return { instanceDir, instanceName, runtimeRoot, source: 'query' }
      }
      if (!requested && bindingName && bindingName === instanceName) {
        return { instanceDir, instanceName, runtimeRoot, source: 'binding' }
      }
    }
  }

  return null
}

function readRegistry(registryPath: string): ProjectRegistry {
  if (!existsSync(registryPath)) return { projects: [] }
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf8')) as ProjectRegistry
    return Array.isArray(parsed.projects) ? parsed : { projects: [] }
  } catch {
    return { projects: [] }
  }
}

function cwdProjectBinding(instanceName: string, instanceEnvPath: string): BoundProjectRef | null {
  const bindingPath = join(process.cwd(), '.env.iranti')
  if (!existsSync(bindingPath)) return null

  try {
    const binding = parseSimpleEnv(readFileSync(bindingPath, 'utf8'))
    const bindingInstance = binding['IRANTI_INSTANCE']?.trim() ?? ''
    const bindingEnvPath = binding['IRANTI_INSTANCE_ENV']?.trim() ?? ''
    const matches =
      bindingInstance === instanceName ||
      (bindingEnvPath && resolve(bindingEnvPath) === resolve(instanceEnvPath))

    if (!matches) return null

    return { projectPath: process.cwd(), source: 'cwd-binding' }
  } catch {
    return null
  }
}

async function resolveBoundProjects(instanceName: string, runtimeRoot: string, instanceEnvPath: string): Promise<BoundProjectRef[]> {
  const registryPath = join(runtimeRoot, 'instances', instanceName, 'projects.json')
  const registry = readRegistry(registryPath)
  const projects: BoundProjectRef[] = []

  for (const entry of registry.projects) {
    const projectEnvPath = join(entry.projectPath, '.env.iranti')
    try {
      await access(projectEnvPath)
      projects.push({ projectPath: entry.projectPath, source: 'registry' })
    } catch {
      // skip stale registry entries
    }
  }

  const cwdBinding = cwdProjectBinding(instanceName, instanceEnvPath)
  if (cwdBinding && !projects.some((project) => resolve(project.projectPath) === resolve(cwdBinding.projectPath))) {
    projects.push(cwdBinding)
  }

  return projects
}

export async function resolveInstanceAuthority(instanceRef?: string): Promise<ResolvedInstanceAuthority | null> {
  const match = await findInstanceDir(instanceRef)
  if (!match) return null

  const instanceEnvPath = join(match.instanceDir, '.env')
  const parsedEnv = parseSimpleEnv(await readFile(instanceEnvPath, 'utf8'))
  const rawPort = parsedEnv['IRANTI_PORT'] ?? parsedEnv['PORT'] ?? ''
  const port = parseInt(rawPort, 10)
  const apiBaseUrl = Number.isNaN(port)
    ? (parsedEnv['IRANTI_URL']?.trim() || 'http://localhost:3001')
    : `http://localhost:${port}`

  return {
    instanceId: deriveInstanceId(match.instanceDir),
    instanceName: match.instanceName,
    instanceDir: match.instanceDir,
    instanceEnvPath,
    runtimeRoot: match.runtimeRoot,
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ''),
    apiKey: parsedEnv['IRANTI_API_KEY']?.trim() || null,
    databaseUrl: parsedEnv['DATABASE_URL']?.trim() || null,
    databaseIntent: await readInstanceDatabaseIntent(match.instanceDir),
    env: parsedEnv,
    boundProjects: await resolveBoundProjects(match.instanceName, match.runtimeRoot, instanceEnvPath),
    source: match.source,
  }
}

export async function resolveBoundProjectPath(
  instanceName: string,
  runtimeRoot: string,
  instanceEnvPath: string,
  projectId: string
): Promise<string | null> {
  let decoded: string
  try {
    decoded = decodeURIComponent(projectId)
  } catch {
    return null
  }

  if (!decoded.trim()) return null

  const projects = await resolveBoundProjects(instanceName, runtimeRoot, instanceEnvPath)
  const match = projects.find((project) => resolve(project.projectPath) === resolve(decoded))
  return match ? resolve(match.projectPath) : null
}
