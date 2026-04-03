/* Iranti Control Plane — Database provisioning helper
 *
 * Creates a PostgreSQL database and runs the bundled Iranti setup
 * script (prisma migrate deploy + seed) against it.
 *
 * Used by:
 *   - instance-lifecycle.ts: auto-provision on instance creation
 *   - repair.ts: POST /:instanceId/repair/provision-database
 */

import { execFile } from 'child_process'
import { access, mkdir } from 'fs/promises'
import { constants } from 'fs'
import { dirname, join } from 'path'
import pg from 'pg'
import { resolveIrantiCli } from './iranti-cli.js'

const { Pool } = pg

function escapePgIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export interface CreateDatabaseResult {
  databaseName: string
  alreadyExisted: boolean
}

/**
 * Creates the target database if it does not already exist.
 * Connects to the admin `postgres` database to issue CREATE DATABASE.
 */
export async function createDatabaseIfMissing(dbUrl: string): Promise<CreateDatabaseResult> {
  const parsed = new URL(dbUrl)
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '').trim())
  if (!databaseName) {
    throw new Error('DATABASE_URL does not include a database name.')
  }
  if (databaseName.toLowerCase() === 'postgres') {
    throw new Error('Refusing to operate on the maintenance database "postgres".')
  }

  parsed.pathname = '/postgres'
  const adminUrl = parsed.toString()

  const pool = new Pool({
    connectionString: adminUrl,
    max: 1,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 4000,
  })

  try {
    const existing = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName])
    if (existing.rows.length > 0) {
      return { databaseName, alreadyExisted: true }
    }
    await pool.query(`CREATE DATABASE ${escapePgIdentifier(databaseName)}`)
    return { databaseName, alreadyExisted: false }
  } finally {
    await pool.end().catch(() => {})
  }
}

export interface RunMigrationsResult {
  ran: boolean
  note: string
}

/**
 * Runs the bundled Iranti setup script (prisma migrate deploy + seed)
 * against the given DATABASE_URL.
 *
 * Locates the script by deriving the iranti package root from the
 * resolved CLI path:
 *   .../node_modules/iranti/bin/iranti.js
 *   → .../node_modules/iranti/dist/scripts/setup.js
 */
export async function runInstanceMigrations(
  dbUrl: string,
  instanceDir: string,
): Promise<RunMigrationsResult> {
  const resolution = await resolveIrantiCli()
  if (!resolution) {
    return { ran: false, note: 'iranti CLI not found — run migrations manually.' }
  }

  const cliEntry = resolution.args[0]
  if (!cliEntry || !cliEntry.toLowerCase().endsWith('.js')) {
    return { ran: false, note: 'Could not locate bundled setup script — run migrations manually.' }
  }

  // .../node_modules/iranti/bin/iranti.js → .../node_modules/iranti
  const packageRoot = dirname(dirname(cliEntry))
  const setupScript = join(packageRoot, 'dist', 'scripts', 'setup.js')

  try {
    await access(setupScript, constants.F_OK)
  } catch {
    return { ran: false, note: 'Bundled setup script not found — run migrations manually.' }
  }

  const escalationDir = join(instanceDir, 'escalation')
  await mkdir(escalationDir, { recursive: true }).catch(() => {})

  await new Promise<void>((resolve, reject) => {
    execFile(
      process.execPath,
      [setupScript],
      {
        env: {
          ...process.env,
          DATABASE_URL: dbUrl,
          IRANTI_ESCALATION_DIR: escalationDir,
        },
        timeout: 60_000,
      },
      (err) => {
        if (err) reject(err)
        else resolve()
      },
    )
  })

  return { ran: true, note: 'Migrations applied.' }
}

export interface ProvisionResult {
  databaseName: string
  created: boolean
  migrated: boolean
  migrationNote: string
}

/**
 * Creates the database (if missing) and runs migrations.
 * Migration failure is non-fatal: returns `migrated: false` with
 * a human-readable note instead of throwing.
 */
export async function provisionDatabase(
  dbUrl: string,
  instanceDir: string,
): Promise<ProvisionResult> {
  const { databaseName, alreadyExisted } = await createDatabaseIfMissing(dbUrl)

  let migrated = false
  let migrationNote = ''

  try {
    const result = await runInstanceMigrations(dbUrl, instanceDir)
    migrated = result.ran
    migrationNote = result.note
  } catch (err) {
    migrationNote = `Migrations failed: ${err instanceof Error ? err.message : String(err)}`
  }

  return { databaseName, created: !alreadyExisted, migrated, migrationNote }
}
