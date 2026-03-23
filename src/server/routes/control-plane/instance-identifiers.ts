import { basename, dirname, join, resolve } from 'path'
import { env } from '../../db.js'
import { deriveInstanceId } from '../../lib/instance-authority.js'

function configuredInstanceEnvPath(): string | null {
  const raw = env['IRANTI_INSTANCE_ENV'] ?? process.env['IRANTI_INSTANCE_ENV'] ?? ''
  return raw.trim() || null
}

function configuredRuntimeRoot(): string {
  const instanceEnvPath = configuredInstanceEnvPath()
  if (!instanceEnvPath) return process.cwd()
  return resolve(dirname(instanceEnvPath), '..', '..')
}

function configuredInstanceName(): string | null {
  const explicit = env['IRANTI_INSTANCE'] ?? process.env['IRANTI_INSTANCE'] ?? ''
  if (explicit.trim()) return explicit.trim()

  const instanceEnvPath = configuredInstanceEnvPath()
  if (!instanceEnvPath) return null
  return basename(dirname(instanceEnvPath))
}

export function getConfiguredInstanceIdentifiers(): {
  runtimeRoot: string
  instanceDir: string
  instanceName: string | null
  instanceId: string
  matches: (candidate: string) => boolean
} {
  const runtimeRoot = configuredRuntimeRoot()
  const instanceName = configuredInstanceName()
  const instanceDir = instanceName
    ? join(runtimeRoot, 'instances', instanceName)
    : runtimeRoot
  const instanceId = deriveInstanceId(instanceDir)

  const valid = new Set<string>([instanceId])
  if (instanceName) valid.add(instanceName)

  return {
    runtimeRoot,
    instanceDir,
    instanceName,
    instanceId,
    matches: (candidate: string) => valid.has(candidate),
  }
}
