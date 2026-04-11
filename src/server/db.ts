/**
 * db.ts — Database connection pool and env-file loader for the Control Plane.
 *
 * Owns two concerns:
 *   1. Locating and parsing the .env.iranti binding file (and the instance env
 *      it may point to) so DATABASE_URL and other runtime vars are available
 *      before any route handler runs.
 *   2. Exporting a shared pg.Pool (`pool`) and a typed `query` helper that all
 *      server-side code uses for the control-plane's own database.
 *
 * The pool is constructed with a placeholder connection string when
 * DATABASE_URL is absent so the server starts cleanly; individual routes
 * will return graceful errors until the user configures credentials.
 */

import pg from 'pg'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import { dirnamePortable, resolvePortable } from './lib/path-utils.js'

const { Pool } = pg

// Load .env.iranti from the exe directory (SEA), cwd, or home directory.
// When double-clicking a Windows exe, process.cwd() is not reliably the
// exe's own directory — so we check process.execPath first in SEA context.

function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = readFileSync(filePath, 'utf8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    result[key] = val
  }
  return result
}

export function ancestorBindingCandidates(startDir: string): string[] {
  const candidates: string[] = []
  let current = resolvePortable(startDir)
  let previous = ''

  while (current !== previous) {
    candidates.push(resolvePortable(current, '.env.iranti'))
    previous = current
    current = dirnamePortable(current)
  }

  return candidates
}

function discoverInstanceEnvCandidates(homeDir: string): string[] {
  // Check IRANTI_INSTANCE or IRANTI_INSTANCE_NAME from env for a specific instance.
  const explicitName = (
    process.env['IRANTI_INSTANCE'] ??
    process.env['IRANTI_INSTANCE_NAME'] ??
    ''
  ).trim()

  const instancesDir = resolvePortable(homeDir, '.iranti-runtime', 'instances')

  if (explicitName) {
    return [resolvePortable(instancesDir, explicitName, '.env')]
  }

  // No explicit instance — scan all instance directories so the CP can find
  // whichever instance exists, rather than assuming it's named "local".
  try {
    return readdirSync(instancesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolvePortable(instancesDir, entry.name, '.env'))
  } catch {
    // instances dir doesn't exist yet
    return [resolvePortable(instancesDir, 'local', '.env')]
  }
}

export function envFileCandidates(startDir: string, homeDir = homedir(), isSea = false, execPath = process.execPath): string[] {
  return [
    ...(isSea ? [resolvePortable(dirnamePortable(execPath), '.env.iranti')] : []),
    ...ancestorBindingCandidates(startDir),
    resolvePortable(homeDir, '.iranti-runtime', '.env.iranti'),
    ...discoverInstanceEnvCandidates(homeDir),
  ]
}

function loadEnv(): Record<string, string> {
  const isSea =
    typeof (process as NodeJS.Process & { isSea?: () => boolean }).isSea === 'function' &&
    (process as NodeJS.Process & { isSea?: () => boolean }).isSea!()

  const candidates = envFileCandidates(process.cwd(), homedir(), isSea, process.execPath)
  for (const p of candidates) {
    if (existsSync(p)) {
      const binding = parseEnvFile(p)

      // If the binding file contains an IRANTI_INSTANCE_ENV pointer, merge the
      // instance env on top. The instance env is the authoritative source for
      // DATABASE_URL, LLM_PROVIDER, provider API keys, and all runtime config.
      // The binding file only provides the CP's own connector vars (IRANTI_URL,
      // IRANTI_API_KEY, etc.) — it is not the live instance env.
      const instanceEnvPath = binding['IRANTI_INSTANCE_ENV']
      if (instanceEnvPath && existsSync(instanceEnvPath)) {
        const instanceVars = parseEnvFile(instanceEnvPath)
        return { ...binding, ...instanceVars }
      }

      return binding
    }
  }
  return {}
}

export const env = loadEnv()
const databaseUrl = env.DATABASE_URL ?? process.env.DATABASE_URL

if (!databaseUrl) {
  console.warn('[db] No DATABASE_URL found in .env.iranti or environment — DB queries will fail until configured')
}

// Pass a placeholder when databaseUrl is absent so pg.Pool doesn't throw
// synchronously during startup (the server still launches; DB-dependent
// routes return errors gracefully until the user configures credentials).
export const pool = new Pool({
  connectionString: databaseUrl ?? 'postgresql://localhost/iranti',
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

pool.on('error', (err) => {
  console.error('[db] Pool error:', err.message)
})

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params)
}
