import pg from 'pg'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { homedir } from 'os'

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

function loadEnv(): Record<string, string> {
  const isSea =
    typeof (process as NodeJS.Process & { isSea?: () => boolean }).isSea === 'function' &&
    (process as NodeJS.Process & { isSea?: () => boolean }).isSea!()

  const candidates = [
    // SEA: next to the binary (most reliable when double-clicked)
    ...(isSea ? [resolve(dirname(process.execPath), '.env.iranti')] : []),
    resolve(process.cwd(), '.env.iranti'),
    resolve(homedir(), '.iranti', '.env.iranti'),
    resolve(homedir(), '.iranti', 'instances', 'local', '.env'),
  ]
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
