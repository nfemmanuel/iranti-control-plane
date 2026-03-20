import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { pool } from '../db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function run(): Promise<void> {
  const migrations = ['001_create_staff_events.sql']

  for (const file of migrations) {
    const sql = readFileSync(resolve(__dirname, file), 'utf8')
    console.log(`[migrate] Running ${file}`)
    await pool.query(sql)
    console.log(`[migrate] Done: ${file}`)
  }

  await pool.end()
  console.log('[migrate] All migrations complete.')
}
