import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { Pool } from 'pg'
import { env } from '../db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function run(): Promise<void> {
  // Use a dedicated pool for migrations so we can safely call pool.end()
  // without closing the shared server pool imported from db.ts.
  const migrationPool = new Pool({ connectionString: env.DATABASE_URL })

  const migrations = ['001_create_staff_events.sql']

  try {
    for (const file of migrations) {
      const sql = readFileSync(resolve(__dirname, file), 'utf8')
      console.log(`[migrate] Running ${file}`)
      await migrationPool.query(sql)
      console.log(`[migrate] Done: ${file}`)
    }
    console.log('[migrate] All migrations complete.')
  } finally {
    await migrationPool.end()
  }
}
