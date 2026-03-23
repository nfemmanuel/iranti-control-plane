import { createHash } from 'crypto'
import { access, readFile } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { join, basename, dirname, resolve } from 'path'
import { homedir } from 'os'
import { env as controlPlaneEnv } from '../db.js'

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

export function deriveInstanceId(instanceDir: string): string {
  const normalized = instanceDir.toLowerCase().replace(/\\/g, '/')
  return createHash('sha256').update(normalized).digest('hex').slice(0, 8)
}

export function parseSimpleEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    if (key) result[key] = value
  }
  return result
}

function configuredBindingInstanceName(): string | null {
  const explicit = controlPlaneEnv['IRANTI_INSTANCE'] ?? process.env['IRANTI_INSTANCE'] ?? ''
  if (explicit.trim()) return explicit.trim()

  const instanceEnvPath = controlPlaneEnv['IRANTI_INSTANCE_ENV'] ?? process.env['IRANTI_INSTANCE_ENV'] ?? ''
  if (!instanceEnvPath.trim()) return null
  return basename(dirname(instanceEnvPath))
}

function runtimeRootCandidates(): string[] {
  const candidates = new Set<string>()
  const irantiHome = process.env['IRANTI_HOME']?.trim()
  if (irantiHome) {
    candidates.add(resolve(irantiHome))
  }

  const configuredInstanceEnv = controlPlaneEnv['IRANTI_INSTANCE_ENV'] ?? process.env['IRANTI_INSTANCE_ENV'] ?? ''
  if (configuredInstanceEnv.trim()) {
    candidates.add(resolve(dirname(configuredInstanceEnv), '..', '..'))
  }

  candidates.add(resolve(homedir(), '.iranti-runtime'))
  return Array.from(candidates)
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

  for (const runtimeRoot of runtimeRootCandidates()) {
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
