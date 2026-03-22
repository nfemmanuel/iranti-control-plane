/**
 * Instance Lifecycle routes — CP-T089 (Instance Create) & CP-T090 (Instance Configure)
 *
 * Manages the filesystem side of Iranti instance provisioning: directory
 * structure, .env scaffolding, and instance.json metadata. Process start/stop
 * is handled by lifecycle.ts (CP-T080); database bootstrap is a separate
 * `iranti setup --bootstrap-db` step that the operator must run after creation.
 *
 * Routes:
 *   POST  /instances            — create a new instance (CP-T089)
 *   PATCH /instances/:name      — update an existing instance's config (CP-T090)
 *
 * Security invariant: `name` is validated against /^[a-zA-Z0-9_-]{1,64}$/
 * before any filesystem operation. No unsanitised input touches the FS.
 */

import { Router, Request, Response } from 'express'
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INSTANCE_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/

const ALLOWED_PROVIDERS = ['openai', 'anthropic', 'gemini', 'groq', 'mistral', 'ollama', 'mock'] as const
type Provider = typeof ALLOWED_PROVIDERS[number]

/** Map a provider to the env var key that holds its API credential. */
const PROVIDER_KEY_VAR: Record<Provider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  ollama: 'OLLAMA_BASE_URL',
  mock: '', // mock needs no key
}

/** Substrings that indicate a placeholder database URL. */
const DB_URL_PLACEHOLDERS = [
  'yourpassword',
  'replace_me',
  '<password>',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidInstanceName(name: string): boolean {
  return INSTANCE_NAME_RE.test(name)
}

function isAllowedProvider(p: string): p is Provider {
  return (ALLOWED_PROVIDERS as readonly string[]).includes(p)
}

/**
 * Resolve the runtime root directory.
 * Respects IRANTI_HOME if set; otherwise uses ~/.iranti-runtime on all
 * platforms (the same convention the Iranti CLI uses during install).
 */
function getRuntimeRoot(): string {
  return process.env['IRANTI_HOME'] ?? join(homedir(), '.iranti-runtime')
}

/**
 * Validate a database URL.
 * Returns an error string if invalid, or null if OK.
 */
function validateDbUrl(dbUrl: string): string | null {
  if (!dbUrl.trim()) {
    return 'dbUrl is required'
  }
  for (const placeholder of DB_URL_PLACEHOLDERS) {
    if (dbUrl.toLowerCase().includes(placeholder.toLowerCase())) {
      return `dbUrl appears to contain a placeholder value ("${placeholder}"). Provide a real connection string.`
    }
  }
  return null
}

/**
 * Parse a .env file into a key-value map.
 * Preserves insertion order. Skips blank lines and comments.
 */
function parseEnvFile(filePath: string): Map<string, string> {
  const map = new Map<string, string>()
  const lines = readFileSync(filePath, 'utf8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    map.set(key, val)
  }
  return map
}

/**
 * Serialise a key-value map back to .env format.
 * Produces a clean file with one KEY=value per line, no trailing blank line.
 */
function serialiseEnvMap(map: Map<string, string>): string {
  const lines: string[] = []
  for (const [key, val] of map) {
    lines.push(`${key}=${val}`)
  }
  return lines.join('\n') + '\n'
}

/**
 * Update specific keys in an existing .env file using line-by-line editing,
 * preserving comments, blank lines, and all other keys.
 * Returns an array of keys that were actually changed.
 */
function patchEnvFile(filePath: string, updates: Map<string, string>): string[] {
  const raw = readFileSync(filePath, 'utf8').split('\n')
  const changed: string[] = []
  const seen = new Set<string>()

  const patched: string[] = []

  for (const line of raw) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('#') && trimmed.indexOf('=') !== -1) {
      const lineKey = trimmed.slice(0, trimmed.indexOf('=')).trim()
      if (updates.has(lineKey)) {
        const newVal = updates.get(lineKey)!
        const oldVal = trimmed.slice(trimmed.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
        if (oldVal !== newVal) {
          changed.push(lineKey)
        }
        patched.push(`${lineKey}=${newVal}`)
        seen.add(lineKey)
        continue
      }
    }
    patched.push(line)
  }

  // Append any keys that weren't already in the file
  for (const [key, val] of updates) {
    if (!seen.has(key)) {
      if (patched.length > 0 && patched[patched.length - 1] !== '') {
        patched.push('')
      }
      patched.push(`${key}=${val}`)
      changed.push(key)
    }
  }

  writeFileSync(filePath, patched.join('\n'), 'utf8')
  return changed
}

/**
 * Scan all existing instance .env files and collect their IRANTI_PORT values.
 * Returns a map of port number → instance name.
 */
function getUsedPorts(runtimeRoot: string, excludeInstance?: string): Map<number, string> {
  const usedPorts = new Map<number, string>()
  const instancesDir = join(runtimeRoot, 'instances')

  if (!existsSync(instancesDir)) {
    return usedPorts
  }

  let entries: string[]
  try {
    entries = readdirSync(instancesDir)
  } catch {
    return usedPorts
  }

  for (const entry of entries) {
    if (excludeInstance && entry === excludeInstance) continue
    const envFile = join(instancesDir, entry, '.env')
    if (!existsSync(envFile)) continue
    try {
      const vars = parseEnvFile(envFile)
      const portStr = vars.get('IRANTI_PORT')
      if (portStr) {
        const port = parseInt(portStr, 10)
        if (!isNaN(port)) {
          usedPorts.set(port, entry)
        }
      }
    } catch {
      // Skip unreadable .env files
    }
  }

  return usedPorts
}

/**
 * Check whether runtime.json exists and indicates a running process.
 */
function isInstanceRunning(instanceDir: string): boolean {
  const runtimeJson = join(instanceDir, 'runtime.json')
  if (!existsSync(runtimeJson)) return false
  try {
    const data = JSON.parse(readFileSync(runtimeJson, 'utf8')) as Record<string, unknown>
    return data['status'] === 'running'
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const instanceLifecycleRouter = Router()

// ---------------------------------------------------------------------------
// POST /instances — create a new Iranti instance  (CP-T089)
// ---------------------------------------------------------------------------

instanceLifecycleRouter.post('/instances', (req: Request, res: Response): void => {
  const body = req.body as Record<string, unknown>

  // ---- Input validation --------------------------------------------------

  const name = typeof body['name'] === 'string' ? body['name'] : ''
  if (!isValidInstanceName(name)) {
    res.status(400).json({
      error: 'Invalid instance name. Use only alphanumeric characters, hyphens, and underscores (1–64 chars).',
      code: 'INVALID_PARAM',
    })
    return
  }

  const port = typeof body['port'] === 'number' ? body['port'] : NaN
  if (isNaN(port) || !Number.isInteger(port) || port < 1024 || port > 65535) {
    res.status(400).json({
      error: 'Invalid port. Must be an integer between 1024 and 65535.',
      code: 'INVALID_PARAM',
    })
    return
  }

  const dbUrl = typeof body['dbUrl'] === 'string' ? body['dbUrl'] : ''
  const dbUrlError = validateDbUrl(dbUrl)
  if (dbUrlError) {
    res.status(400).json({
      error: dbUrlError,
      code: 'INVALID_PARAM',
    })
    return
  }

  const provider = typeof body['provider'] === 'string' ? body['provider'] : ''
  if (!isAllowedProvider(provider)) {
    res.status(400).json({
      error: `Invalid provider "${provider}". Allowed values: ${ALLOWED_PROVIDERS.join(', ')}.`,
      code: 'INVALID_PARAM',
    })
    return
  }

  const providerKey = typeof body['providerKey'] === 'string' ? body['providerKey'] : undefined

  // ---- Path resolution ---------------------------------------------------

  const runtimeRoot = getRuntimeRoot()
  const instanceDir = join(runtimeRoot, 'instances', name)
  const envFile = join(instanceDir, '.env')
  const instanceJsonPath = join(instanceDir, 'instance.json')

  // ---- Existence check ---------------------------------------------------

  if (existsSync(envFile)) {
    res.status(409).json({
      error: 'Instance already exists.',
      code: 'INSTANCE_EXISTS',
    })
    return
  }

  // ---- Port conflict check -----------------------------------------------

  const usedPorts = getUsedPorts(runtimeRoot)
  if (usedPorts.has(port)) {
    const conflictInstance = usedPorts.get(port)!
    res.status(409).json({
      error: `Port ${port} is already in use by instance "${conflictInstance}".`,
      code: 'PORT_CONFLICT',
      conflictInstance,
    })
    return
  }

  // ---- Directory creation ------------------------------------------------

  try {
    mkdirSync(instanceDir, { recursive: true })
    mkdirSync(join(instanceDir, 'logs'), { recursive: true })
    mkdirSync(join(instanceDir, 'escalation', 'active'), { recursive: true })
    mkdirSync(join(instanceDir, 'escalation', 'resolved'), { recursive: true })
    mkdirSync(join(instanceDir, 'escalation', 'archived'), { recursive: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({
      error: `Failed to create instance directories: ${message}`,
      code: 'FS_ERROR',
    })
    return
  }

  // ---- Build .env content ------------------------------------------------

  const envMap = new Map<string, string>()

  envMap.set('IRANTI_INSTANCE_NAME', name)
  envMap.set('IRANTI_PORT', String(port))
  envMap.set('DATABASE_URL', dbUrl)
  envMap.set('LLM_PROVIDER', provider)
  envMap.set('IRANTI_ESCALATION_DIR', join(instanceDir, 'escalation'))
  envMap.set('IRANTI_REQUEST_LOG_FILE', join(instanceDir, 'logs', 'api-requests.log'))
  envMap.set('IRANTI_ARCHIVIST_WATCH', 'true')
  envMap.set('IRANTI_ARCHIVIST_DEBOUNCE_MS', '60000')
  envMap.set('IRANTI_ARCHIVIST_INTERVAL_MS', '0')
  envMap.set('IRANTI_API_KEY', 'replace_me_with_api_key')

  // Provider API key (optional)
  if (providerKey && provider !== 'mock' && provider !== 'ollama') {
    const providerKeyVar = PROVIDER_KEY_VAR[provider]
    if (providerKeyVar) {
      envMap.set(providerKeyVar, providerKey)
    }
  } else if (providerKey && provider === 'ollama') {
    // Ollama uses OLLAMA_BASE_URL rather than an API key
    envMap.set('OLLAMA_BASE_URL', providerKey)
  }

  // ---- Write .env --------------------------------------------------------

  try {
    writeFileSync(envFile, serialiseEnvMap(envMap), 'utf8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({
      error: `Failed to write .env file: ${message}`,
      code: 'FS_ERROR',
    })
    return
  }

  // ---- Write instance.json -----------------------------------------------

  const instanceMeta = {
    name,
    createdAt: new Date().toISOString(),
    port,
    envFile,
    instanceDir,
  }

  try {
    writeFileSync(instanceJsonPath, JSON.stringify(instanceMeta, null, 2) + '\n', 'utf8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({
      error: `Failed to write instance.json: ${message}`,
      code: 'FS_ERROR',
    })
    return
  }

  // ---- Success -----------------------------------------------------------

  res.status(201).json({
    ok: true,
    name,
    instanceDir,
    envFile,
    port,
    provider,
    note: 'Instance created. Database setup required before starting — run iranti setup --bootstrap-db --instance <name> or configure your database via the Instance Manager.',
  })
})

// ---------------------------------------------------------------------------
// PATCH /instances/:name — update an existing instance's config  (CP-T090)
// ---------------------------------------------------------------------------

instanceLifecycleRouter.patch('/instances/:name', (req: Request, res: Response): void => {
  const { name } = req.params

  // ---- Validate name -----------------------------------------------------

  if (!isValidInstanceName(name)) {
    res.status(400).json({
      error: 'Invalid instance name. Use only alphanumeric characters, hyphens, and underscores (1–64 chars).',
      code: 'INVALID_PARAM',
    })
    return
  }

  // ---- Resolve paths -----------------------------------------------------

  const runtimeRoot = getRuntimeRoot()
  const instanceDir = join(runtimeRoot, 'instances', name)
  const envFile = join(instanceDir, '.env')

  // ---- Existence check ---------------------------------------------------

  if (!existsSync(envFile)) {
    res.status(404).json({
      error: `Instance "${name}" not found.`,
      code: 'NOT_FOUND',
    })
    return
  }

  // ---- Parse body --------------------------------------------------------

  const body = req.body as Record<string, unknown>
  const updates = new Map<string, string>()
  const validationErrors: string[] = []

  // port
  if (body['port'] !== undefined) {
    const port = body['port']
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1024 || port > 65535) {
      validationErrors.push('Invalid port. Must be an integer between 1024 and 65535.')
    } else {
      // Port conflict check — exclude this instance itself
      const usedPorts = getUsedPorts(runtimeRoot, name)
      if (usedPorts.has(port)) {
        const conflictInstance = usedPorts.get(port)!
        res.status(409).json({
          error: `Port ${port} is already in use by instance "${conflictInstance}".`,
          code: 'PORT_CONFLICT',
          conflictInstance,
        })
        return
      }
      updates.set('IRANTI_PORT', String(port))
    }
  }

  // dbUrl
  if (body['dbUrl'] !== undefined) {
    const dbUrl = body['dbUrl']
    if (typeof dbUrl !== 'string') {
      validationErrors.push('dbUrl must be a string.')
    } else {
      const dbUrlError = validateDbUrl(dbUrl)
      if (dbUrlError) {
        validationErrors.push(dbUrlError)
      } else {
        updates.set('DATABASE_URL', dbUrl)
      }
    }
  }

  // provider
  if (body['provider'] !== undefined) {
    const provider = body['provider']
    if (typeof provider !== 'string' || !isAllowedProvider(provider)) {
      validationErrors.push(`Invalid provider. Allowed values: ${ALLOWED_PROVIDERS.join(', ')}.`)
    } else {
      updates.set('LLM_PROVIDER', provider)
    }
  }

  // providerKey
  if (body['providerKey'] !== undefined) {
    const providerKey = body['providerKey']
    if (typeof providerKey !== 'string') {
      validationErrors.push('providerKey must be a string.')
    } else {
      // Determine which provider to use: updated provider (from this request) or
      // current provider from the existing .env
      let targetProvider: string | undefined
      if (body['provider'] !== undefined && isAllowedProvider(body['provider'] as string)) {
        targetProvider = body['provider'] as string
      } else {
        // Read current provider from .env
        const currentVars = parseEnvFile(envFile)
        targetProvider = currentVars.get('LLM_PROVIDER')
      }

      if (targetProvider && isAllowedProvider(targetProvider) && targetProvider !== 'mock') {
        const keyVar = PROVIDER_KEY_VAR[targetProvider]
        if (keyVar) {
          updates.set(keyVar, providerKey)
        }
      }
    }
  }

  // ---- Return validation errors ------------------------------------------

  if (validationErrors.length > 0) {
    res.status(400).json({
      error: validationErrors.join(' '),
      code: 'INVALID_PARAM',
    })
    return
  }

  // Nothing to update
  if (updates.size === 0) {
    res.status(200).json({
      ok: true,
      name,
      restartRequired: false,
      changed: [],
    })
    return
  }

  // ---- Patch .env --------------------------------------------------------

  let changed: string[]
  try {
    changed = patchEnvFile(envFile, updates)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({
      error: `Failed to update .env file: ${message}`,
      code: 'FS_ERROR',
    })
    return
  }

  // ---- Determine restart requirement -------------------------------------

  const wasRunning = isInstanceRunning(instanceDir)

  // ---- Success -----------------------------------------------------------

  res.status(200).json({
    ok: true,
    name,
    restartRequired: wasRunning,
    changed,
  })
})
