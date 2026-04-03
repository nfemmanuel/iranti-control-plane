import { Router, Request, Response } from 'express'
import { randomBytes } from 'crypto'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { rm, rename, mkdir, readFile, writeFile, cp } from 'fs/promises'
import { join, resolve, dirname } from 'path'
import { homedir } from 'os'
import pg from 'pg'
import { env as controlPlaneEnv } from '../../db.js'
import { runIrantiCommand, runIrantiJson } from '../../lib/iranti-cli.js'
import { deriveInstanceId, parseSimpleEnv, resolveInstanceAuthority } from '../../lib/instance-authority.js'
import { classifyRuntimeRoot, runtimeRootCandidates } from '../../lib/runtime-roots.js'
import { provisionDatabase } from '../../lib/db-provision.js'

const INSTANCE_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/
const ALLOWED_PROVIDERS = ['openai', 'claude', 'gemini', 'groq', 'mistral', 'ollama', 'mock'] as const
const ALLOWED_DB_INTENTS = ['dedicated', 'shared', 'external'] as const

type Provider = typeof ALLOWED_PROVIDERS[number]
type DatabaseIntentChoice = typeof ALLOWED_DB_INTENTS[number]
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

function normalizedInstanceCollisionKey(name: string): string {
  return name.trim().toLowerCase().replace(/[-_]+/g, '_')
}

function findSiblingInstanceCollision(runtimeRoot: string, desiredName: string): { name: string; dir: string } | null {
  const instancesDir = join(runtimeRoot, 'instances')
  if (!existsSync(instancesDir)) return null

  const desiredKey = normalizedInstanceCollisionKey(desiredName)
  for (const entry of readdirSync(instancesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name === desiredName) continue
    if (normalizedInstanceCollisionKey(entry.name) !== desiredKey) continue
    return {
      name: entry.name,
      dir: join(instancesDir, entry.name),
    }
  }

  return null
}

function normalizeProviderInput(value: string): Provider | null {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  const canonical = normalized === 'anthropic' ? 'claude' : normalized
  return (ALLOWED_PROVIDERS as readonly string[]).includes(canonical) ? (canonical as Provider) : null
}

function normalizeDbIntentInput(value: unknown): DatabaseIntentChoice | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return (ALLOWED_DB_INTENTS as readonly string[]).includes(normalized)
    ? (normalized as DatabaseIntentChoice)
    : null
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

function sanitizeLegacyApiKeyId(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
}

function generateInstanceApiKey(name: string): string {
  const keyId = sanitizeLegacyApiKeyId(name + '_control_plane') || 'iranti'
  return keyId + '.' + randomBytes(32).toString('base64url')
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

function buildSimpleEnvFile(entries: Record<string, string>): string {
  return Object.entries(entries)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n'
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

  if (lowered.includes('too close to existing instance')) {
    return { status: 409, code: 'INSTANCE_NAME_COLLISION' }
  }
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

async function moveDirectory(fromPath: string, toPath: string): Promise<void> {
  try {
    await rename(fromPath, toPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EXDEV') throw error
    await cp(fromPath, toPath, { recursive: true, force: true })
    await rm(fromPath, { recursive: true, force: true })
  }
}

async function rewriteProjectBindingInstanceEnv(projectPath: string, oldEnvPath: string, newEnvPath: string): Promise<void> {
  const bindingPath = join(projectPath, '.env.iranti')
  if (!existsSync(bindingPath)) return

  const parsed = parseSimpleEnv(await readFile(bindingPath, 'utf8'))
  const current = parsed['IRANTI_INSTANCE_ENV']?.trim() ?? ''
  if (!current) return
  if (resolve(current) !== resolve(oldEnvPath)) return

  parsed['IRANTI_INSTANCE_ENV'] = newEnvPath
  await writeFile(bindingPath, buildSimpleEnvFile(parsed), 'utf8')
}

async function rewriteMovedInstanceEnv(instanceDir: string, previousInstanceDir: string): Promise<void> {
  const envPath = join(instanceDir, '.env')
  if (!existsSync(envPath)) return

  const parsed = parseSimpleEnv(await readFile(envPath, 'utf8'))
  const oldBase = resolve(previousInstanceDir)
  const nextEscalation = join(instanceDir, 'escalation')
  const nextRequestLog = join(instanceDir, 'logs', 'api-requests.log')

  const currentEscalation = parsed['IRANTI_ESCALATION_DIR']?.trim() ?? ''
  const currentRequestLog = parsed['IRANTI_REQUEST_LOG_FILE']?.trim() ?? ''
  if (!currentEscalation || resolve(currentEscalation).startsWith(oldBase)) {
    parsed['IRANTI_ESCALATION_DIR'] = nextEscalation
  }
  if (!currentRequestLog || resolve(dirname(currentRequestLog)).startsWith(resolve(join(previousInstanceDir, 'logs')))) {
    parsed['IRANTI_REQUEST_LOG_FILE'] = nextRequestLog
  }

  await writeFile(envPath, buildSimpleEnvFile(parsed), 'utf8')
}

async function rewriteMovedInstanceMeta(instanceDir: string, name: string): Promise<void> {
  const metaPath = join(instanceDir, 'instance.json')
  if (!existsSync(metaPath)) return

  const parsed = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>
  parsed['name'] = name
  parsed['instanceDir'] = instanceDir
  parsed['envFile'] = join(instanceDir, '.env')

  await writeFile(metaPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
}

async function clearMovedRuntimeMetadata(instanceDir: string): Promise<void> {
  const runtimePath = join(instanceDir, 'runtime.json')
  if (!existsSync(runtimePath)) return
  await rm(runtimePath, { force: true })
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
  const dbIntent = normalizeDbIntentInput(body['dbIntent'])
  if (body['dbIntent'] !== undefined && !dbIntent) {
    res.status(400).json({
      error: `Invalid dbIntent. Allowed values: ${ALLOWED_DB_INTENTS.join(', ')}.`,
      code: 'INVALID_PARAM',
    })
    return
  }

  const runtimeRoot = preferredRuntimeRoot()
  const generatedApiKey = generateInstanceApiKey(name)
  const { instanceDir, envFile } = instancePaths(runtimeRoot, name)
  if (existsSync(instanceDir)) {
    res.status(409).json({
      error: 'Instance already exists.',
      code: 'INSTANCE_EXISTS',
    })
    return
  }
  const siblingCollision = findSiblingInstanceCollision(runtimeRoot, name)
  if (siblingCollision) {
    res.status(409).json({
      error: `Instance "${name}" is too close to existing instance "${siblingCollision.name}". For safety, Control Plane treats hyphens and underscores as the same identity when creating instances. Choose a more distinct name.`,
      code: 'INSTANCE_NAME_COLLISION',
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
    '--api-key',
    generatedApiKey,
    '--provider',
    provider,
  ]
  if (dbIntent) {
    cliArgs.push('--db-intent', dbIntent)
  }
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

  // Generate and write IRANTI_API_KEY_PEPPER if the CLI did not already include one.
  // Required for HMAC-hardened API key storage — without it the server falls back to an
  // insecure default. Pattern mirrors the generate-pepper repair action: randomBytes(32)
  // produces a 64-char hex secret that is appended to the instance .env file.
  try {
    let envContent: string
    try {
      envContent = await readFile(envFile, 'utf8')
    } catch {
      envContent = ''
    }
    if (!/^IRANTI_API_KEY_PEPPER\s*=/m.test(envContent)) {
      const pepper = randomBytes(32).toString('hex')
      const pepperLine = `IRANTI_API_KEY_PEPPER=${pepper}`
      envContent = envContent.endsWith('\n') ? envContent + pepperLine + '\n' : envContent + '\n' + pepperLine + '\n'
      await writeFile(envFile, envContent, 'utf8')
    }
  } catch {
    // Non-fatal: if writing fails the user can generate it via the setup-status panel.
    console.warn(`[instance-lifecycle] Failed to write IRANTI_API_KEY_PEPPER to ${envFile}`)
  }

  const instanceEnv = parseEnvFile(envFile)

  // Auto-provision the database on create. Best effort only: the instance itself
  // should still be usable even if the migration step needs a manual repair pass.
  let note = 'Instance created. Open it in Control Plane to start the runtime, finish provider setup, and bind projects.'
  try {
    const prov = await provisionDatabase(dbUrl.trim(), instanceDir)
    if (prov.migrated) {
      note = prov.created
        ? `Instance and database "${prov.databaseName}" created — ready to start.`
        : `Instance created. Database "${prov.databaseName}" already existed — migrations applied.`
    } else if (prov.created) {
      note = `Instance and database "${prov.databaseName}" created. ${prov.migrationNote} Use the setup or repair flow if migrations are still needed.`
    }
  } catch {
    // Non-fatal: instance files are created even if provisioning still needs repair.
  }

  res.status(201).json({
    ok: true,
    name,
    instanceDir,
    envFile,
    port,
    provider: instanceEnv['LLM_PROVIDER'] ?? provider,
    note,
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

  if (body['dbIntent'] !== undefined) {
    const dbIntent = normalizeDbIntentInput(body['dbIntent'])
    if (!dbIntent) {
      res.status(400).json({
        error: `Invalid dbIntent. Allowed values: ${ALLOWED_DB_INTENTS.join(', ')}.`,
        code: 'INVALID_PARAM',
      })
      return
    }
    cliArgs.push('--db-intent', dbIntent)
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

instanceLifecycleRouter.post('/instances/:name/migrate-root', async (req: Request, res: Response): Promise<void> => {
  const { name } = req.params

  if (!isValidInstanceName(name)) {
    res.status(400).json({
      error: 'Invalid instance name. Use only alphanumeric characters, hyphens, and underscores (1-64 chars).',
      code: 'INVALID_PARAM',
    })
    return
  }

  const resolvedAuthority = await resolveInstanceAuthority(name)
  if (!resolvedAuthority) {
    res.status(404).json({
      error: `Instance "${name}" not found.`,
      code: 'NOT_FOUND',
    })
    return
  }

  const currentRoot = resolvedAuthority.runtimeRoot
  const targetRoot = preferredRuntimeRoot()

  if (resolve(currentRoot) === resolve(targetRoot)) {
    res.status(200).json({
      ok: true,
      name,
      migrated: false,
      runtimeRoot: currentRoot,
      runtimeRootKind: classifyRuntimeRoot(currentRoot),
      instanceId: resolvedAuthority.instanceId,
      note: 'Instance is already stored in the preferred runtime root.',
      updatedBindings: 0,
    })
    return
  }

  if (await isInstanceRunning(currentRoot, name)) {
    res.status(409).json({
      error: `Instance "${name}" is still running. Stop or recover it before migrating the runtime root.`,
      code: 'INSTANCE_RUNNING',
    })
    return
  }

  const targetInstanceDir = join(targetRoot, 'instances', name)
  if (existsSync(targetInstanceDir)) {
    res.status(409).json({
      error: `Target runtime root already contains an instance named "${name}".`,
      code: 'TARGET_EXISTS',
    })
    return
  }

  const oldEnvPath = resolvedAuthority.instanceEnvPath
  const newEnvPath = join(targetInstanceDir, '.env')

  try {
    await mkdir(join(targetRoot, 'instances'), { recursive: true })
    await moveDirectory(resolvedAuthority.instanceDir, targetInstanceDir)
    await rewriteMovedInstanceEnv(targetInstanceDir, resolvedAuthority.instanceDir)
    await rewriteMovedInstanceMeta(targetInstanceDir, name)
    await clearMovedRuntimeMetadata(targetInstanceDir)

    let updatedBindings = 0
    for (const project of resolvedAuthority.boundProjects) {
      await rewriteProjectBindingInstanceEnv(project.projectPath, oldEnvPath, newEnvPath)
      updatedBindings += 1
    }

    res.status(200).json({
      ok: true,
      name,
      migrated: true,
      runtimeRoot: targetRoot,
      runtimeRootKind: classifyRuntimeRoot(targetRoot),
      instanceId: deriveInstanceId(targetInstanceDir),
      note: 'Instance moved to the preferred runtime root and bound project env files were updated.',
      updatedBindings,
    })
  } catch (error) {
    res.status(500).json({
      error: commandFailureMessage(error),
      code: 'MIGRATE_FAILED',
    })
  }
})
