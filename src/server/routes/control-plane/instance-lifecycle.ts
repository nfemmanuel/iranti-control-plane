import { Router, Request, Response } from 'express'
import { existsSync, readFileSync } from 'fs'
import { rm } from 'fs/promises'
import { join, resolve, dirname } from 'path'
import { homedir } from 'os'
import pg from 'pg'
import { env as controlPlaneEnv } from '../../db.js'
import { runIrantiCommand, runIrantiJson } from '../../lib/iranti-cli.js'
import { resolveInstanceAuthority } from '../../lib/instance-authority.js'
import { runtimeRootCandidates } from '../../lib/runtime-roots.js'

const INSTANCE_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/
const ALLOWED_PROVIDERS = ['openai', 'claude', 'gemini', 'groq', 'mistral', 'ollama', 'mock'] as const

type Provider = typeof ALLOWED_PROVIDERS[number]
const { Pool } = pg

type StatusResponse = {
  instances?: Array<{
    name?: string
    runtime?: {
      running?: boolean
      classification?: string | null
    } | null
  }>
}

function isValidInstanceName(name: string): boolean {
  return INSTANCE_NAME_RE.test(name)
}

function normalizeProviderInput(value: string): Provider | null {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  const canonical = normalized === 'anthropic' ? 'claude' : normalized
  return (ALLOWED_PROVIDERS as readonly string[]).includes(canonical) ? (canonical as Provider) : null
}

function validateDbUrl(dbUrl: string): string | null {
  const trimmed = dbUrl.trim()
  if (!trimmed) return 'dbUrl is required'
  for (const placeholder of ['yourpassword', 'replace_me', '<password>']) {
    if (trimmed.toLowerCase().includes(placeholder.toLowerCase())) {
      return `dbUrl appears to contain a placeholder value ("${placeholder}"). Provide a real connection string.`
    }
  }
  return null
}

function preferredRuntimeRoot(): string {
  const explicit =
    controlPlaneEnv['IRANTI_HOME']?.trim() ??
    process.env['IRANTI_HOME']?.trim() ??
    ''
  if (explicit) return resolve(explicit)

  const configuredInstanceEnv =
    controlPlaneEnv['IRANTI_INSTANCE_ENV']?.trim() ??
    process.env['IRANTI_INSTANCE_ENV']?.trim() ??
    ''
  if (configuredInstanceEnv) {
    return resolve(dirname(configuredInstanceEnv), '..', '..')
  }

  const candidates = runtimeRootCandidates()
  if (candidates.length > 0) return candidates[0]

  return join(homedir(), '.iranti-runtime')
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {}

  const parsed: Record<string, string> = {}
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    if (key) parsed[key] = value
  }
  return parsed
}

function diffEnvKeys(before: Record<string, string>, after: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return Array.from(keys)
    .filter((key) => before[key] !== after[key])
    .sort()
}

function commandFailureMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const stderr = typeof (error as { stderr?: unknown }).stderr === 'string'
      ? (error as { stderr: string }).stderr.trim()
      : ''
    if (stderr) return stderr

    const stdout = typeof (error as { stdout?: unknown }).stdout === 'string'
      ? (error as { stdout: string }).stdout.trim()
      : ''
    if (stdout) return stdout
  }

  return error instanceof Error ? error.message : String(error)
}

function classifyCommandFailure(message: string): { status: number; code: string } {
  const lowered = message.toLowerCase()

  if (lowered.includes('already exists')) {
    return { status: 409, code: 'INSTANCE_EXISTS' }
  }
  if (lowered.includes('already in use') || lowered.includes('port') && lowered.includes('conflict')) {
    return { status: 409, code: 'PORT_CONFLICT' }
  }
  if (lowered.includes('could not be resolved') || lowered.includes('cli not found')) {
    return { status: 400, code: 'CLI_NOT_FOUND' }
  }
  if (lowered.includes('not found')) {
    return { status: 404, code: 'NOT_FOUND' }
  }
  if (lowered.includes('invalid') || lowered.includes('missing')) {
    return { status: 400, code: 'INVALID_PARAM' }
  }

  return { status: 500, code: 'COMMAND_FAILED' }
}

async function isInstanceRunning(runtimeRoot: string, name: string): Promise<boolean> {
  try {
    const result = await runIrantiJson<StatusResponse>(['status', '--root', runtimeRoot, '--json'], {
      timeoutMs: 15000,
      allowNonZeroExit: true,
    })

    const match = result.json.instances?.find((instance) => instance.name === name)
    if (!match?.runtime) return false
    if (match.runtime.running === true) return true
    return match.runtime.classification === 'running'
  } catch {
    return false
  }
}

function instancePaths(runtimeRoot: string, name: string) {
  const instanceDir = join(runtimeRoot, 'instances', name)
  return {
    instanceDir,
    envFile: join(instanceDir, '.env'),
  }
}

function escapePgIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function parseDatabaseTarget(dbUrl: string): { adminUrl: string; databaseName: string } {
  const parsed = new URL(dbUrl)
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '').trim())
  if (!databaseName) {
    throw new Error('DATABASE_URL does not include a database name.')
  }
  if (databaseName.toLowerCase() === 'postgres') {
    throw new Error('Refusing to drop the maintenance database "postgres".')
  }
  parsed.pathname = '/postgres'
  return {
    adminUrl: parsed.toString(),
    databaseName,
  }
}

async function dropDatabase(dbUrl: string): Promise<string> {
  const { adminUrl, databaseName } = parseDatabaseTarget(dbUrl)
  const pool = new Pool({ connectionString: adminUrl })
  try {
    await pool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [databaseName],
    )
    await pool.query(`DROP DATABASE IF EXISTS ${escapePgIdentifier(databaseName)}`)
  } finally {
    await pool.end()
  }
  return databaseName
}

async function deleteBoundProjectFiles(projectPaths: string[]): Promise<string[]> {
  const removed: string[] = []
  for (const projectPath of projectPaths) {
    const bindingPath = join(projectPath, '.env.iranti')
    await rm(bindingPath, { force: true })
    removed.push(bindingPath)
  }
  return removed
}

export const instanceLifecycleRouter = Router()

instanceLifecycleRouter.post('/instances', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown>

  const name = typeof body['name'] === 'string' ? body['name'] : ''
  if (!isValidInstanceName(name)) {
    res.status(400).json({
      error: 'Invalid instance name. Use only alphanumeric characters, hyphens, and underscores (1-64 chars).',
      code: 'INVALID_PARAM',
    })
    return
  }

  const port = typeof body['port'] === 'number' ? body['port'] : NaN
  if (Number.isNaN(port) || !Number.isInteger(port) || port < 1024 || port > 65535) {
    res.status(400).json({
      error: 'Invalid port. Must be an integer between 1024 and 65535.',
      code: 'INVALID_PARAM',
    })
    return
  }

  const dbUrl = typeof body['dbUrl'] === 'string' ? body['dbUrl'] : ''
  const dbUrlError = validateDbUrl(dbUrl)
  if (dbUrlError) {
    res.status(400).json({ error: dbUrlError, code: 'INVALID_PARAM' })
    return
  }

  const providerInput = typeof body['provider'] === 'string' ? body['provider'] : ''
  const provider = normalizeProviderInput(providerInput)
  if (!provider) {
    res.status(400).json({
      error: `Invalid provider "${providerInput}". Allowed values: ${ALLOWED_PROVIDERS.join(', ')}.`,
      code: 'INVALID_PARAM',
    })
    return
  }

  const providerKey = typeof body['providerKey'] === 'string' ? body['providerKey'].trim() : ''
  if (providerKey && (provider === 'mock' || provider === 'ollama')) {
    res.status(400).json({
      error: `Provider '${provider}' does not accept providerKey during instance creation.`,
      code: 'INVALID_PARAM',
    })
    return
  }

  const runtimeRoot = preferredRuntimeRoot()
  const { instanceDir, envFile } = instancePaths(runtimeRoot, name)
  if (existsSync(instanceDir)) {
    res.status(409).json({
      error: 'Instance already exists.',
      code: 'INSTANCE_EXISTS',
    })
    return
  }

  const cliArgs = [
    'instance',
    'create',
    name,
    '--root',
    runtimeRoot,
    '--port',
    String(port),
    '--db-url',
    dbUrl.trim(),
    '--provider',
    provider,
  ]
  if (providerKey) {
    cliArgs.push('--provider-key', providerKey)
  }

  try {
    await runIrantiCommand(cliArgs, { timeoutMs: 30000 })
  } catch (error) {
    const message = commandFailureMessage(error)
    const failure = classifyCommandFailure(message)
    res.status(failure.status).json({ error: message, code: failure.code })
    return
  }

  const instanceEnv = parseEnvFile(envFile)

  res.status(201).json({
    ok: true,
    name,
    instanceDir,
    envFile,
    port,
    provider: instanceEnv['LLM_PROVIDER'] ?? provider,
    note: `Instance created. Review it with \`iranti instance show ${name}\` or start it with \`iranti run --instance ${name}\`.`,
  })
})

instanceLifecycleRouter.patch('/instances/:name', async (req: Request, res: Response): Promise<void> => {
  const { name } = req.params

  if (!isValidInstanceName(name)) {
    res.status(400).json({
      error: 'Invalid instance name. Use only alphanumeric characters, hyphens, and underscores (1-64 chars).',
      code: 'INVALID_PARAM',
    })
    return
  }

  const runtimeRoot = preferredRuntimeRoot()
  const { instanceDir, envFile } = instancePaths(runtimeRoot, name)
  if (!existsSync(instanceDir)) {
    res.status(404).json({
      error: `Instance "${name}" not found.`,
      code: 'NOT_FOUND',
    })
    return
  }

  const body = req.body as Record<string, unknown>
  const currentEnv = parseEnvFile(envFile)
  const currentProvider = normalizeProviderInput(currentEnv['LLM_PROVIDER'] ?? '')
  const cliArgs = ['configure', 'instance', name, '--root', runtimeRoot]

  let targetProvider = currentProvider

  if (body['port'] !== undefined) {
    const port = body['port']
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1024 || port > 65535) {
      res.status(400).json({
        error: 'Invalid port. Must be an integer between 1024 and 65535.',
        code: 'INVALID_PARAM',
      })
      return
    }
    cliArgs.push('--port', String(port))
  }

  if (body['dbUrl'] !== undefined) {
    if (typeof body['dbUrl'] !== 'string') {
      res.status(400).json({ error: 'dbUrl must be a string.', code: 'INVALID_PARAM' })
      return
    }
    const dbUrlError = validateDbUrl(body['dbUrl'])
    if (dbUrlError) {
      res.status(400).json({ error: dbUrlError, code: 'INVALID_PARAM' })
      return
    }
    cliArgs.push('--db-url', body['dbUrl'].trim())
  }

  if (body['provider'] !== undefined) {
    if (typeof body['provider'] !== 'string') {
      res.status(400).json({ error: 'provider must be a string.', code: 'INVALID_PARAM' })
      return
    }
    const normalizedProvider = normalizeProviderInput(body['provider'])
    if (!normalizedProvider) {
      res.status(400).json({
        error: `Invalid provider. Allowed values: ${ALLOWED_PROVIDERS.join(', ')}.`,
        code: 'INVALID_PARAM',
      })
      return
    }
    targetProvider = normalizedProvider
    cliArgs.push('--provider', normalizedProvider)
  }

  if (body['providerKey'] !== undefined) {
    if (typeof body['providerKey'] !== 'string') {
      res.status(400).json({ error: 'providerKey must be a string.', code: 'INVALID_PARAM' })
      return
    }
    const providerKey = body['providerKey'].trim()
    if (providerKey) {
      if (!targetProvider) {
        res.status(400).json({
          error: 'providerKey requires a known target provider. Set provider first or repair the instance env.',
          code: 'INVALID_PARAM',
        })
        return
      }
      if (targetProvider === 'mock' || targetProvider === 'ollama') {
        res.status(400).json({
          error: `Provider '${targetProvider}' does not accept providerKey in instance configuration.`,
          code: 'INVALID_PARAM',
        })
        return
      }
      cliArgs.push('--provider-key', providerKey)
    }
  }

  if (cliArgs.length === 4) {
    res.status(200).json({ ok: true, name, restartRequired: false, changed: [] })
    return
  }

  try {
    await runIrantiCommand(cliArgs, { timeoutMs: 30000 })
  } catch (error) {
    const message = commandFailureMessage(error)
    const failure = classifyCommandFailure(message)
    res.status(failure.status).json({ error: message, code: failure.code })
    return
  }

  const nextEnv = parseEnvFile(envFile)
  const changed = diffEnvKeys(currentEnv, nextEnv)

  res.status(200).json({
    ok: true,
    name,
    restartRequired: await isInstanceRunning(runtimeRoot, name),
    changed,
  })
})

instanceLifecycleRouter.delete('/instances/:name', async (req: Request, res: Response): Promise<void> => {
  const { name } = req.params

  if (!isValidInstanceName(name)) {
    res.status(400).json({
      error: 'Invalid instance name. Use only alphanumeric characters, hyphens, and underscores (1-64 chars).',
      code: 'INVALID_PARAM',
    })
    return
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const confirmName = typeof body['confirmName'] === 'string' ? body['confirmName'].trim() : ''
  if (confirmName !== name) {
    res.status(400).json({
      error: `Type "${name}" exactly to confirm deletion.`,
      code: 'CONFIRMATION_REQUIRED',
    })
    return
  }

  const removeProjectBindings = body['removeProjectBindings'] !== false
  const dropDatabaseRequested = body['dropDatabase'] === true

  const resolvedAuthority = await resolveInstanceAuthority(name)
  const runtimeRoot = resolvedAuthority?.runtimeRoot ?? preferredRuntimeRoot()
  const { instanceDir, envFile } = resolvedAuthority
    ? { instanceDir: resolvedAuthority.instanceDir, envFile: resolvedAuthority.instanceEnvPath }
    : instancePaths(runtimeRoot, name)

  if (!existsSync(instanceDir)) {
    res.status(404).json({
      error: `Instance "${name}" not found.`,
      code: 'NOT_FOUND',
    })
    return
  }

  if (await isInstanceRunning(runtimeRoot, name)) {
    res.status(409).json({
      error: `Instance "${name}" is still running. Stop or restart it cleanly before deleting it.`,
      code: 'INSTANCE_RUNNING',
    })
    return
  }

  const currentEnv = parseEnvFile(envFile)
  const boundProjectPaths = removeProjectBindings
    ? Array.from(new Set((resolvedAuthority?.boundProjects ?? []).map((project) => project.projectPath)))
    : []
  const databaseUrl = currentEnv['DATABASE_URL']?.trim() ?? ''

  if (dropDatabaseRequested && !databaseUrl) {
    res.status(400).json({
      error: 'Cannot drop the database because DATABASE_URL is missing from the instance env.',
      code: 'NO_DATABASE_URL',
    })
    return
  }

  let removedBindingFiles: string[] = []
  let droppedDatabaseName: string | null = null

  try {
    if (boundProjectPaths.length > 0) {
      removedBindingFiles = await deleteBoundProjectFiles(boundProjectPaths)
    }

    if (dropDatabaseRequested) {
      droppedDatabaseName = await dropDatabase(databaseUrl)
    }

    await rm(instanceDir, { recursive: true, force: true })
  } catch (error) {
    res.status(500).json({
      error: commandFailureMessage(error),
      code: 'DELETE_FAILED',
    })
    return
  }

  res.status(200).json({
    ok: true,
    name,
    deleted: true,
    instanceDir,
    runtimeRoot,
    removedProjectBindings: removedBindingFiles,
    droppedDatabase: droppedDatabaseName,
  })
})
