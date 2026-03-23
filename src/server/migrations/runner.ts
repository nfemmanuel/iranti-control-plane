import { existsSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { Pool } from 'pg'
import { env } from '../db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function resolveMigrationPath(file: string): string {
  const candidates = [
    resolve(__dirname, file),
    resolve(__dirname, '..', '..', 'migrations', file),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  return candidates[0]
}

export async function run(): Promise<void> {
  // Use a dedicated pool for migrations so we can safely call pool.end()
  // without closing the shared server pool imported from db.ts.
  const migrationPool = new Pool({ connectionString: env.DATABASE_URL })

  const migrations = [
    '001_create_staff_events.sql',
    '002_create_archive_flags.sql',
    '003_staff_events_metrics_index.sql',
  ]

  try {
    for (const file of migrations) {
      const sql = readFileSync(resolveMigrationPath(file), 'utf8')
      console.log(`[migrate] Running ${file}`)
      await migrationPool.query(sql)
      console.log(`[migrate] Done: ${file}`)
    }
    console.log('[migrate] All migrations complete.')
  } finally {
    await migrationPool.end()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error('[migrate] Failed:', err)
    process.exitCode = 1
  })
}
