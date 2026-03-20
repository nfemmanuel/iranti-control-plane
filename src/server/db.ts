import pg from 'pg'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'

const { Pool } = pg

// Load .env.iranti from project root or home directory
function loadEnv(): Record<string, string> {
  const candidates = [
    resolve(process.cwd(), '.env.iranti'),
    resolve(homedir(), '.iranti', '.env.iranti'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      const lines = readFileSync(p, 'utf8').split('\n')
      const env: Record<string, string> = {}
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const idx = trimmed.indexOf('=')
        if (idx === -1) continue
        const key = trimmed.slice(0, idx).trim()
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
        env[key] = val
      }
      return env
    }
  }
  return {}
}

export const env = loadEnv()
const databaseUrl = env.DATABASE_URL ?? process.env.DATABASE_URL

if (!databaseUrl) {
  console.error('[db] No DATABASE_URL found in .env.iranti or environment')
}

export const pool = new Pool({
  connectionString: databaseUrl,
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
