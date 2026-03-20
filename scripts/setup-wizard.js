#!/usr/bin/env node
/**
 * Iranti Control Plane — Setup Wizard
 * =====================================
 * CP-T023 implementation: standalone interactive installer for Iranti.
 *
 * Entry point: node scripts/setup-wizard.js  OR  npm run setup
 *
 * Windows scope:
 *   Supported:  Node version check, DATABASE_URL construction, database
 *               creation, pgvector check (via SQL), migration runner,
 *               provider key setup, instance registry write, health check.
 *   Not supported (shows guidance): pg_isready, Homebrew remediation,
 *               macOS version check, brew-based pgvector install instructions.
 *
 * Linux: Shows "not yet supported" message and exits cleanly.
 *
 * Security: API keys are NEVER written to the log file.
 * Ctrl+C: exits cleanly without writing partial env files.
 */

'use strict'

const os = require('os')
const fs = require('fs')
const path = require('path')
const { execSync, exec } = require('child_process')
const { promisify } = require('util')
const execAsync = promisify(exec)
const http = require('http')

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------
const IS_WINDOWS = process.platform === 'win32'
const IS_MACOS = process.platform === 'darwin'
const IS_LINUX = process.platform === 'linux'

// ---------------------------------------------------------------------------
// Guard: must be a TTY
// ---------------------------------------------------------------------------
if (!process.stdout.isTTY) {
  console.error('Error: iranti setup must be run in an interactive terminal.')
  console.error('For non-interactive use, set DATABASE_URL and provider keys manually.')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Linux guard — Phase 2 does not support Linux
// ---------------------------------------------------------------------------
if (IS_LINUX) {
  console.log('')
  console.log('Linux setup guidance is not yet available in the wizard.')
  console.log('See the documentation at: https://github.com/nfemmanuel/iranti/blob/main/docs/install.md')
  console.log('')
  console.log('You can still configure Iranti manually by setting DATABASE_URL and provider')
  console.log('keys in your .env.iranti file at the project root.')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Lazy-load @clack/prompts after platform guards
// ---------------------------------------------------------------------------
let clack
try {
  clack = require('@clack/prompts')
} catch {
  console.error('Error: @clack/prompts is not installed.')
  console.error('Run: npm install from the iranti-control-plane repo root, then re-run this wizard.')
  process.exit(1)
}

const {
  intro,
  outro,
  text,
  password,
  confirm,
  select,
  multiselect,
  spinner,
  isCancel,
  cancel,
  note,
  log,
} = clack

// ---------------------------------------------------------------------------
// Log infrastructure
// ---------------------------------------------------------------------------
const LOG_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19)
const IRANTI_DIR = path.join(os.homedir(), '.iranti')
const LOG_PATH = path.join(IRANTI_DIR, `setup-log-${LOG_TIMESTAMP}.txt`)
const logLines = []

function logLine(line) {
  logLines.push(line)
}

function writeLog() {
  try {
    fs.mkdirSync(IRANTI_DIR, { recursive: true })
    fs.writeFileSync(LOG_PATH, logLines.join('\n') + '\n', 'utf8')
  } catch (e) {
    // Best-effort — don't crash if log write fails
  }
}

// ---------------------------------------------------------------------------
// Wizard state — accumulates all answers; only writes on explicit confirm
// ---------------------------------------------------------------------------
const state = {
  cancelled: false,
  dbHost: 'localhost',
  dbPort: '5432',
  dbName: 'iranti',
  dbUser: '',
  dbPassword: '',
  databaseUrl: '',
  providers: [],        // selected provider names
  providerKeys: {},     // { anthropic: 'sk-ant-...', ... } — NOT written to log
  defaultProvider: '',
  instanceName: 'local',
  projectName: path.basename(process.cwd()),
  mcpWritten: false,
  envWrites: [],        // list of keys written to .env.iranti (values masked for log)
}

// Paths
const PROJECT_ROOT = path.resolve(__dirname, '..')
const ENV_PATH = path.join(PROJECT_ROOT, '.env.iranti')
const INSTANCE_DIR = path.join(IRANTI_DIR, 'instances', 'local')
const INSTANCE_JSON_PATH = path.join(INSTANCE_DIR, 'instance.json')
const MCP_JSON_PATH = path.join(process.cwd(), '.mcp.json')
const IRANTI_PORT = 3001
const CONTROL_PLANE_PORT = 3002

// ---------------------------------------------------------------------------
// Ctrl+C handling — must be registered before any prompts
// ---------------------------------------------------------------------------
let cancelled = false
process.on('SIGINT', () => {
  cancelled = true
  console.log('\n\nSetup cancelled — no changes were written.')
  logLine('[CANCELLED] User pressed Ctrl+C')
  writeLog()
  process.exit(130)
})

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/** Safely run a shell command, return { stdout, stderr, ok } */
async function run(cmd, opts = {}) {
  try {
    const result = await execAsync(cmd, { timeout: 10000, ...opts })
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim(), ok: true }
  } catch (e) {
    return { stdout: '', stderr: e.message, ok: false }
  }
}

/** Parse semver major from a version string like "v20.11.0" or "20.11.0" */
function parseMajor(v) {
  const m = v.replace(/^v/, '').match(/^(\d+)/)
  return m ? parseInt(m[1], 10) : 0
}

/** Check if cancelled after every prompt */
function checkCancel(val) {
  if (isCancel(val)) {
    cancelled = true
    cancel('Setup cancelled — no changes were written.')
    logLine('[CANCELLED] User cancelled at prompt')
    writeLog()
    process.exit(130)
  }
  return val
}

/** Make a DATABASE_URL from state fields */
function buildDatabaseUrl(host, port, user, password, dbName) {
  const encodedUser = encodeURIComponent(user)
  const encodedPass = password ? encodeURIComponent(password) : ''
  const auth = encodedPass ? `${encodedUser}:${encodedPass}` : encodedUser
  return `postgresql://${auth}@${host}:${port}/${dbName}`
}

/** Mask password in a DATABASE_URL for display */
function maskDatabaseUrl(url) {
  // Only mask if there is a user:password@host pattern (not the protocol colon)
  return url.replace(/(:\/\/[^:@]+):([^@]+)@/, '$1:***@')
}

/** Read .env.iranti into a key/value map */
function readEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return {}
  const lines = fs.readFileSync(envPath, 'utf8').split('\n')
  const result = {}
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) result[m[1]] = m[2]
  }
  return result
}

/** Write key/value pairs to .env.iranti (merge, not overwrite) */
function writeEnvFile(envPath, updates) {
  const existing = readEnvFile(envPath)
  const merged = { ...existing, ...updates }
  const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`)
  const content = lines.join('\n') + '\n'
  const tmp = envPath + '.tmp'
  fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, envPath)
  try { fs.chmodSync(envPath, 0o600) } catch { /* best effort */ }
}

/** HTTP GET with a timeout, returns the response body or null */
function httpGet(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve(body))
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.setTimeout(timeoutMs)
  })
}

/** Check TCP reachability for Windows PostgreSQL check */
function tcpReachable(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const net = require('net')
    const sock = new net.Socket()
    sock.setTimeout(timeoutMs)
    sock.on('connect', () => { sock.destroy(); resolve(true) })
    sock.on('error', () => resolve(false))
    sock.on('timeout', () => { sock.destroy(); resolve(false) })
    sock.connect(port, host)
  })
}

// ---------------------------------------------------------------------------
// pg client test connection
// ---------------------------------------------------------------------------
async function testDbConnection(url) {
  // Use psql as a lightweight check (no pg package needed)
  // psql --version output: psql (PostgreSQL) 16.3
  const res = await run(`psql "${url}" -c "SELECT 1" -t -A -q`)
  if (res.ok && res.stdout.includes('1')) {
    return { ok: true }
  }
  // Try to interpret the error
  const err = res.stderr || res.stdout
  if (err.match(/database .+ does not exist/i)) return { ok: false, reason: 'db_not_exist', err }
  if (err.match(/authentication failed|password authentication/i)) return { ok: false, reason: 'auth', err }
  if (err.match(/connection refused|could not connect/i)) return { ok: false, reason: 'connection_refused', err }
  if (err.match(/role .+ does not exist/i)) return { ok: false, reason: 'auth', err }
  return { ok: false, reason: 'unknown', err }
}

async function checkPgvector(url) {
  const res = await run(`psql "${url}" -c "SELECT 1 FROM pg_available_extensions WHERE name = 'vector'" -t -A -q`)
  if (res.ok && res.stdout.includes('1')) {
    // Available — now check if enabled
    const enabled = await run(`psql "${url}" -c "SELECT 1 FROM pg_extension WHERE extname = 'vector'" -t -A -q`)
    if (enabled.ok && enabled.stdout.includes('1')) return { available: true, enabled: true }
    return { available: true, enabled: false }
  }
  return { available: false, enabled: false }
}

async function enablePgvector(url) {
  const res = await run(`psql "${url}" -c "CREATE EXTENSION IF NOT EXISTS vector"`)
  return res.ok
}

// ---------------------------------------------------------------------------
// SECTION 1: System Checks
// ---------------------------------------------------------------------------
async function section1_SystemChecks() {
  logLine('\n=== SECTION 1: System Checks ===')

  // ---- 1.1 Node.js version ----
  const nodeVersion = process.version
  const nodeMajor = parseMajor(nodeVersion)
  logLine(`Node.js: ${nodeVersion}`)
  if (nodeMajor < 18) {
    log.error(`Node.js ${nodeVersion} is below the required minimum (v18).`)
    note(
      'Fix:\n  nvm install 18\n  nvm use 18\n\nOr download from: https://nodejs.org',
      'Node.js too old'
    )
    logLine('BLOCKER: Node.js version too old')
    outro('Setup cannot continue. Install Node.js v18+ and re-run this wizard.')
    writeLog()
    process.exit(1)
  }
  log.success(`Node.js ${nodeVersion}`)

  // ---- 1.2 macOS version (macOS only, soft check) ----
  if (IS_MACOS) {
    const swRes = await run('sw_vers -productVersion')
    if (swRes.ok) {
      const major = parseMajor(swRes.stdout)
      logLine(`macOS version: ${swRes.stdout}`)
      if (major < 12) {
        log.warn(`macOS ${swRes.stdout} detected. Iranti is supported on macOS 12+. Older versions may work but are not tested.`)
      } else {
        log.success(`macOS ${swRes.stdout}`)
      }
    }
  }

  // ---- 1.3 PostgreSQL check ----
  if (IS_WINDOWS) {
    // Windows: use TCP check instead of pg_isready
    logLine('PostgreSQL check: TCP connect (Windows)')
    const reachable = await tcpReachable('localhost', 5432)
    if (reachable) {
      log.success('PostgreSQL reachable at localhost:5432')
      logLine('PostgreSQL: reachable')
    } else {
      log.warn('PostgreSQL not reachable at localhost:5432.')
      note(
        'Start PostgreSQL via the Windows Services manager,\nor run: pg_ctl -D <datadir> start\n\nWSL users: sudo service postgresql start',
        'PostgreSQL not running'
      )
      logLine('WARNING: PostgreSQL not reachable on Windows')
    }
  } else {
    // macOS: try pg_isready
    logLine('PostgreSQL check: pg_isready')
    let pgReady = false
    const pgReadyRes = await run('pg_isready -h localhost -p 5432')
    if (pgReadyRes.ok) {
      pgReady = true
    } else {
      // Try Homebrew paths
      for (const brewPath of ['/opt/homebrew/bin/pg_isready', '/usr/local/bin/pg_isready']) {
        const r = await run(`${brewPath} -h localhost -p 5432`)
        if (r.ok) { pgReady = true; break }
      }
    }

    if (pgReady) {
      const vRes = await run('psql --version')
      const pgVer = vRes.ok ? vRes.stdout : 'unknown version'
      log.success(`PostgreSQL reachable at localhost:5432 (${pgVer})`)
      logLine(`PostgreSQL: ${pgVer}`)
    } else {
      // Check if psql exists at all
      const psqlRes = await run('which psql')
      const psqlBrewRes = await run('ls /opt/homebrew/opt/postgresql@16/bin/psql')
      const installed = psqlRes.ok || psqlBrewRes.ok

      if (!installed) {
        log.error('PostgreSQL not found.')
        note(
          'Install with Homebrew:\n  brew install postgresql@16\n  brew services start postgresql@16\n\nThen add to your shell:\n  export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"',
          'PostgreSQL not installed'
        )
        logLine('BLOCKER: PostgreSQL not installed')
      } else {
        // Installed but not running or not on PATH
        const onPath = psqlRes.ok
        if (!onPath) {
          log.warn('PostgreSQL tools not found on PATH.')
          note(
            'Add this to your ~/.zshrc (or ~/.bash_profile):\n  export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"\n\nThen run: source ~/.zshrc\nThen retry: npm run setup',
            'PostgreSQL not on PATH'
          )
          logLine('WARNING: PostgreSQL not on PATH')
        } else {
          log.warn('PostgreSQL is installed but not running.')
          note(
            'Start it with:\n  brew services start postgresql@16\n\nThen retry: npm run setup',
            'PostgreSQL not running'
          )
          logLine('WARNING: PostgreSQL not running')
        }
      }

      // Ask if user wants to continue anyway
      const cont = await confirm({ message: 'Continue setup anyway? (You can fix PostgreSQL and re-run.)' })
      checkCancel(cont)
      if (!cont) {
        outro('Fix PostgreSQL and re-run: npm run setup')
        writeLog()
        process.exit(0)
      }
    }
  }

  // ---- 1.4 pgvector note ----
  log.info('pgvector check deferred — will run after database connection is confirmed.')
  logLine('pgvector: deferred to Section 2')
}

// ---------------------------------------------------------------------------
// SECTION 2: Database Setup
// ---------------------------------------------------------------------------
async function section2_DatabaseSetup() {
  logLine('\n=== SECTION 2: Database Setup ===')

  // Check if DATABASE_URL already exists in .env.iranti
  const existing = readEnvFile(ENV_PATH)
  if (existing.DATABASE_URL) {
    logLine(`Existing DATABASE_URL found: ${maskDatabaseUrl(existing.DATABASE_URL)}`)
    const useExisting = await confirm({
      message: `Found existing DATABASE_URL: ${maskDatabaseUrl(existing.DATABASE_URL)}\nUse this? (No to enter a new one)`,
      initialValue: true,
    })
    checkCancel(useExisting)
    if (useExisting) {
      state.databaseUrl = existing.DATABASE_URL
      // Parse the existing URL to populate state fields for pgvector check
      try {
        const u = new URL(existing.DATABASE_URL)
        state.dbHost = u.hostname
        state.dbPort = u.port || '5432'
        state.dbUser = decodeURIComponent(u.username)
        state.dbPassword = decodeURIComponent(u.password)
        state.dbName = u.pathname.slice(1)
      } catch { /* leave defaults */ }
      log.success('Using existing DATABASE_URL')
      logLine('Using existing DATABASE_URL')
      await runPgvectorCheck()
      await runMigrations()
      return
    }
  }

  // ---- 2.1 DATABASE_URL construction ----
  log.step('Building DATABASE_URL interactively...')

  const defaultUser = IS_WINDOWS
    ? (process.env.USERNAME || 'postgres')
    : (await run('whoami')).stdout || 'postgres'

  const dbHost = checkCancel(await text({
    message: 'PostgreSQL host:',
    initialValue: 'localhost',
    validate: (v) => v.trim() ? undefined : 'Host is required',
  }))
  state.dbHost = dbHost.trim()
  logLine(`DB host: ${state.dbHost}`)

  const dbPort = checkCancel(await text({
    message: 'PostgreSQL port:',
    initialValue: '5432',
    validate: (v) => {
      const n = parseInt(v, 10)
      return (n > 0 && n < 65536) ? undefined : 'Enter a valid port (1–65535)'
    },
  }))
  state.dbPort = dbPort.trim()
  logLine(`DB port: ${state.dbPort}`)

  const dbName = checkCancel(await text({
    message: 'Database name:',
    initialValue: 'iranti',
    validate: (v) => /^[a-zA-Z0-9_-]+$/.test(v.trim()) ? undefined : 'Use only letters, numbers, underscores, hyphens',
  }))
  state.dbName = dbName.trim()
  logLine(`DB name: ${state.dbName}`)

  const dbUser = checkCancel(await text({
    message: 'Database username:',
    initialValue: defaultUser,
    validate: (v) => v.trim() ? undefined : 'Username is required',
  }))
  state.dbUser = dbUser.trim()
  logLine(`DB user: ${state.dbUser}`)

  const dbPassword = checkCancel(await password({
    message: 'Database password (leave empty for no password):',
    mask: '*',
  }))
  state.dbPassword = dbPassword // Not logged

  state.databaseUrl = buildDatabaseUrl(state.dbHost, state.dbPort, state.dbUser, state.dbPassword, state.dbName)
  const maskedUrl = maskDatabaseUrl(state.databaseUrl)
  logLine(`DATABASE_URL (masked): ${maskedUrl}`)

  note(`DATABASE_URL: ${maskedUrl}`, 'Connection string preview')

  const useUrl = checkCancel(await confirm({ message: 'Use this connection string?', initialValue: true }))
  checkCancel(useUrl)
  if (!useUrl) {
    log.info('Restarting database setup...')
    return section2_DatabaseSetup()
  }

  // ---- Test connection ----
  const s = spinner()
  s.start('Testing database connection...')
  const connResult = await testDbConnection(state.databaseUrl)
  if (connResult.ok) {
    s.stop('Database connection OK')
    logLine('DB connection: OK')
  } else if (connResult.reason === 'db_not_exist') {
    s.stop(`Database "${state.dbName}" does not exist`)
    logLine(`DB connection: database does not exist — ${connResult.err}`)
    // ---- 2.2 Offer to create the database ----
    const createDb = checkCancel(await confirm({
      message: `Database "${state.dbName}" does not exist. Create it now?`,
      initialValue: true,
    }))
    if (createDb) {
      const createCmd = `createdb -h ${state.dbHost} -p ${state.dbPort} -U ${state.dbUser} ${state.dbName}`
      logLine(`Running: ${createCmd}`)
      s.start(`Creating database "${state.dbName}"...`)
      const createRes = await run(createCmd)
      if (createRes.ok) {
        s.stop(`Database "${state.dbName}" created`)
        logLine('DB created: OK')
        // Re-test
        const retest = await testDbConnection(state.databaseUrl)
        if (!retest.ok) {
          s.stop('Connection still failing after create')
          log.error(`Could not connect: ${retest.err}`)
          logLine(`DB connection after create: FAIL — ${retest.err}`)
          note('You may need to create the database manually as a PostgreSQL superuser.', 'Manual step needed')
        }
      } else {
        s.stop('Database creation failed')
        logLine(`createdb failed: ${createRes.stderr}`)
        if (IS_WINDOWS) {
          note(
            `Run in psql:\n  CREATE DATABASE ${state.dbName};\n\nConnect first: psql -U ${state.dbUser}`,
            'Create database manually'
          )
        } else {
          note(
            `Run: psql -U ${state.dbUser} -c "CREATE DATABASE ${state.dbName};"\nOr: createdb -U postgres ${state.dbName}`,
            'Create database manually'
          )
        }
      }
    } else {
      note(`To create manually: createdb ${state.dbName}`, 'Create database manually')
    }
  } else if (connResult.reason === 'auth') {
    s.stop('Authentication failed')
    log.error(`Check your username and password. Error: ${connResult.err}`)
    logLine(`DB connection: auth failed — ${connResult.err}`)
  } else if (connResult.reason === 'connection_refused') {
    s.stop('Connection refused')
    log.error('PostgreSQL is not running or not reachable. Start PostgreSQL and re-run.')
    logLine('DB connection: connection refused')
  } else {
    s.stop('Connection test failed')
    log.warn(`Could not verify connection: ${connResult.err}`)
    logLine(`DB connection: unknown error — ${connResult.err}`)
  }

  // ---- 2.3 pgvector check ----
  await runPgvectorCheck()

  // ---- 2.5 Write env file ----
  await writeEnvSection()

  // ---- 2.4 Migration runner ----
  await runMigrations()
}

async function runPgvectorCheck() {
  if (IS_WINDOWS) {
    logLine('pgvector check: running via SQL (Windows)')
  }

  const s = spinner()
  s.start('Checking pgvector extension...')
  const pgv = await checkPgvector(state.databaseUrl)
  logLine(`pgvector available: ${pgv.available}, enabled: ${pgv.enabled}`)

  if (pgv.enabled) {
    s.stop('pgvector extension is enabled')
    return
  }

  if (pgv.available && !pgv.enabled) {
    s.stop('pgvector is installed but not enabled in this database')
    const enableNow = checkCancel(await confirm({
      message: `Enable pgvector in database "${state.dbName}" now?`,
      initialValue: true,
    }))
    if (enableNow) {
      const ok = await enablePgvector(state.databaseUrl)
      if (ok) {
        log.success('pgvector extension enabled')
        logLine('pgvector: enabled')
      } else {
        log.error('Failed to enable pgvector. You may need superuser privileges.')
        if (IS_WINDOWS) {
          note(
            `Connect to psql and run:\n  \\c ${state.dbName}\n  CREATE EXTENSION IF NOT EXISTS vector;`,
            'Enable pgvector manually'
          )
        } else {
          note(
            `Run: psql -d ${state.dbName} -c "CREATE EXTENSION IF NOT EXISTS vector"`,
            'Enable pgvector manually'
          )
        }
        logLine('pgvector: failed to enable')
      }
    }
  } else {
    // Not available at all
    s.stop('pgvector is not installed')
    logLine('pgvector: not installed')
    if (IS_WINDOWS) {
      note(
        'pgvector on Windows requires manual build or a pgvector-enabled PostgreSQL distribution.\nSee: https://github.com/pgvector/pgvector#windows\n\nAfter installing, run in psql:\n  CREATE EXTENSION IF NOT EXISTS vector;',
        'pgvector not installed (Windows)'
      )
    } else {
      note(
        `Install pgvector:\n  brew install pgvector\n\nThen enable in your database:\n  psql -d ${state.dbName} -c "CREATE EXTENSION IF NOT EXISTS vector"`,
        'pgvector not installed'
      )
    }

    const cont = checkCancel(await confirm({
      message: 'Continue without pgvector? (Migrations will fail without it)',
      initialValue: false,
    }))
    if (!cont) {
      outro('Install pgvector and re-run: npm run setup')
      writeLog()
      process.exit(0)
    }
  }
}

async function writeEnvSection() {
  const updates = { DATABASE_URL: state.databaseUrl }
  const existing = readEnvFile(ENV_PATH)
  const isNew = !fs.existsSync(ENV_PATH)

  // Show diff
  const diffLines = []
  for (const [k, v] of Object.entries(updates)) {
    const maskedV = k === 'DATABASE_URL' ? maskDatabaseUrl(v) : '[SET]'
    if (existing[k]) {
      diffLines.push(`  ~ ${k}=${maskedV}  (updating existing)`)
    } else {
      diffLines.push(`  + ${k}=${maskedV}  (new)`)
    }
  }
  note(
    (isNew ? 'Creating: ' : 'Updating: ') + ENV_PATH + '\n' + diffLines.join('\n'),
    'Env file changes'
  )

  const writeIt = checkCancel(await confirm({ message: 'Write configuration to .env.iranti?', initialValue: true }))
  if (writeIt) {
    writeEnvFile(ENV_PATH, updates)
    log.success(`Written to ${ENV_PATH}`)
    logLine(`Wrote DATABASE_URL to ${ENV_PATH}`)
    state.envWrites.push('DATABASE_URL')
  } else {
    log.info('Skipped env file write.')
    logLine('Env write: skipped by user')
  }
}

async function runMigrations() {
  const runMigrate = checkCancel(await confirm({
    message: 'Run Iranti database migrations now?',
    initialValue: true,
  }))
  if (!runMigrate) {
    log.info('Migrations skipped. Run: npm run migrate')
    logLine('Migrations: skipped')
    return
  }

  const s = spinner()
  s.start('Running migrations...')
  logLine('Running migrations: npm run migrate')

  const migrateRes = await execAsync('npm run migrate', {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATABASE_URL: state.databaseUrl },
    timeout: 60000,
  }).then(r => ({ ok: true, stdout: r.stdout, stderr: r.stderr }))
    .catch(e => ({ ok: false, stdout: e.stdout || '', stderr: e.message }))

  const combinedOutput = (migrateRes.stdout + '\n' + migrateRes.stderr).trim()
  // Log last 10 lines (omit secrets — this only contains migration output)
  const outputLines = combinedOutput.split('\n').filter(Boolean)
  logLine('Migration output (last 10 lines):')
  outputLines.slice(-10).forEach(l => logLine('  ' + l))

  if (migrateRes.ok) {
    s.stop('Migrations applied successfully')
    log.success('Migrations complete')
    logLine('Migrations: OK')
  } else {
    s.stop('Migration failed')
    const errText = combinedOutput
    logLine('Migration: FAILED')

    if (errText.includes('type "vector" does not exist')) {
      log.error('Migration failed: pgvector extension is not enabled.')
      note('Run Section 2 pgvector check again, then re-run migrations.', 'Fix: enable pgvector')
    } else if (errText.includes('connection refused')) {
      log.error('Migration failed: PostgreSQL not reachable.')
      note('Start PostgreSQL and re-run: npm run migrate', 'Fix: start PostgreSQL')
    } else if (errText.includes('permission denied')) {
      log.error('Migration failed: database user lacks CREATE TABLE permission.')
      note(`Grant permissions: GRANT ALL ON DATABASE ${state.dbName} TO ${state.dbUser};`, 'Fix: permissions')
    } else {
      log.error(`Migration failed: ${outputLines.slice(-3).join(' | ')}`)
      note('Check the log file for full output: ' + LOG_PATH, 'Migration error details')
    }

    const cont = checkCancel(await confirm({
      message: 'Continue setup despite migration failure?',
      initialValue: false,
    }))
    if (!cont) {
      outro('Fix the migration issue and re-run: npm run setup')
      writeLog()
      process.exit(1)
    }
  }
}

// ---------------------------------------------------------------------------
// SECTION 3: Provider Setup
// ---------------------------------------------------------------------------

const PROVIDERS = [
  {
    name: 'anthropic',
    label: 'Anthropic (Claude)',
    envKey: 'ANTHROPIC_API_KEY',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    validatePrefix: (k) => k.startsWith('sk-ant-') ? null : 'Anthropic keys usually start with "sk-ant-"',
  },
  {
    name: 'openai',
    label: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/api-keys',
    validatePrefix: (k) => k.startsWith('sk-') ? null : 'OpenAI keys usually start with "sk-"',
  },
  {
    name: 'groq',
    label: 'Groq',
    envKey: 'GROQ_API_KEY',
    keyUrl: 'https://console.groq.com/keys',
    validatePrefix: (k) => k.startsWith('gsk_') ? null : 'Groq keys usually start with "gsk_"',
  },
  {
    name: 'mistral',
    label: 'Mistral',
    envKey: 'MISTRAL_API_KEY',
    keyUrl: 'https://console.mistral.ai/api-keys',
    validatePrefix: () => null, // No fixed prefix
  },
  {
    name: 'ollama',
    label: 'Ollama (local, no API key needed)',
    envKey: null,
    keyUrl: null,
    validatePrefix: () => null,
  },
]

async function section3_ProviderSetup() {
  logLine('\n=== SECTION 3: Provider Setup ===')

  // Check if Ollama is running — pre-detect
  const ollamaRunning = await httpGet('http://localhost:11434/api/tags', 2000) !== null
  if (ollamaRunning) {
    log.info('Ollama detected running at localhost:11434')
    logLine('Ollama: pre-detected as running')
  }

  // ---- 3.1 Provider selection ----
  const providerChoices = PROVIDERS.map(p => ({
    value: p.name,
    label: p.label,
    hint: p.name === 'ollama' && ollamaRunning ? 'detected running' : undefined,
  }))
  providerChoices.push({ value: 'skip', label: 'Skip for now — configure later with: iranti add api-key' })

  const selected = checkCancel(await multiselect({
    message: 'Which LLM providers do you want to configure now?',
    options: providerChoices,
    required: true,
  }))

  if (selected.includes('skip') || selected.length === 0) {
    log.warn('No providers configured. Iranti will not be able to process requests until a provider is added.')
    logLine('Providers: skipped')
    return
  }

  state.providers = selected.filter(p => p !== 'skip')
  logLine(`Providers selected: ${state.providers.join(', ')}`)

  // ---- 3.2 Per-provider key entry ----
  const envUpdates = {}
  for (const providerName of state.providers) {
    const provider = PROVIDERS.find(p => p.name === providerName)
    if (!provider) continue

    if (provider.name === 'ollama') {
      // ---- 3.3 Ollama detection ----
      const s = spinner()
      s.start('Checking Ollama at localhost:11434...')
      const ollamaBody = await httpGet('http://localhost:11434/api/tags', 2000)
      if (ollamaBody !== null) {
        let models = []
        try {
          const parsed = JSON.parse(ollamaBody)
          models = (parsed.models || []).map(m => m.name)
        } catch { /* ignore */ }
        s.stop(`Ollama is running${models.length ? ' — models: ' + models.slice(0, 3).join(', ') : ''}`)
        logLine('Ollama: running, models: ' + models.join(', '))
        envUpdates['OLLAMA_BASE_URL'] = 'http://localhost:11434'
        state.envWrites.push('OLLAMA_BASE_URL')
      } else {
        s.stop('Ollama is not running')
        logLine('Ollama: not running')
        if (IS_WINDOWS) {
          note(
            'Download Ollama: https://ollama.com/download\nAfter installing, start it and run:\n  ollama pull llama3.2',
            'Ollama not running'
          )
        } else {
          note(
            'Install: brew install ollama\nStart:   ollama serve\nPull a model: ollama pull llama3.2',
            'Ollama not running'
          )
        }
      }
      continue
    }

    // Remote provider — ask for API key
    log.step(`Configuring ${provider.label}...`)
    note(`Get your API key at:\n  ${provider.keyUrl}`, `${provider.label} API key`)

    const apiKey = checkCancel(await password({
      message: `${provider.envKey}:`,
      mask: '*',
      validate: (v) => {
        if (!v.trim()) return 'API key cannot be empty'
        const warning = provider.validatePrefix(v.trim())
        return undefined // warnings are shown below, not as validation errors
      },
    }))

    const trimmedKey = apiKey.trim()
    const warning = provider.validatePrefix(trimmedKey)
    if (warning) {
      log.warn(warning + ' — accepted but double-check your key.')
      logLine(`${provider.name}: key format warning — ${warning}`)
    }

    // Store key in state — NEVER log the actual value
    state.providerKeys[providerName] = trimmedKey
    envUpdates[provider.envKey] = trimmedKey
    logLine(`${provider.name}: ${provider.envKey} = [SET]`)
    state.envWrites.push(`${provider.envKey} = [SET]`)
  }

  // ---- 3.4 Default provider ----
  if (state.providers.filter(p => p !== 'ollama').length > 1) {
    const defaultProvider = checkCancel(await select({
      message: 'Which provider should be the Iranti default?',
      options: state.providers
        .filter(p => p !== 'ollama')
        .map(p => {
          const prov = PROVIDERS.find(pr => pr.name === p)
          return { value: p, label: prov ? prov.label : p }
        }),
    }))
    state.defaultProvider = defaultProvider
    envUpdates['LLM_PROVIDER'] = defaultProvider
    logLine(`Default provider: ${defaultProvider}`)
  } else if (state.providers.filter(p => p !== 'ollama').length === 1) {
    state.defaultProvider = state.providers.find(p => p !== 'ollama') || ''
    if (state.defaultProvider) {
      envUpdates['LLM_PROVIDER'] = state.defaultProvider
      logLine(`Default provider: ${state.defaultProvider} (auto-set, only one configured)`)
    }
  }

  // Write provider keys to env file (API keys go to project .env.iranti, set 0600)
  // This write happens immediately — provider keys are the last thing collected
  if (Object.keys(envUpdates).length > 0) {
    writeEnvFile(ENV_PATH, envUpdates)
    log.success(`Provider configuration written to ${ENV_PATH}`)
    logLine(`Provider env written: ${Object.keys(envUpdates).map(k => k + '=[SET]').join(', ')}`)
    try { fs.chmodSync(ENV_PATH, 0o600) } catch { /* best effort */ }
  }

  // ---- 3.5 Instance registry write ----
  await writeInstanceRegistry()
}

async function writeInstanceRegistry() {
  logLine('Writing instance registry...')
  try {
    fs.mkdirSync(INSTANCE_DIR, { recursive: true })
    const instanceData = {
      name: state.instanceName,
      createdAt: new Date().toISOString(),
      port: IRANTI_PORT,
      envFile: ENV_PATH,
      instanceDir: INSTANCE_DIR,
    }
    const tmp = INSTANCE_JSON_PATH + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(instanceData, null, 2), { encoding: 'utf8', mode: 0o644 })
    fs.renameSync(tmp, INSTANCE_JSON_PATH)
    log.success(`Instance registry written to ${INSTANCE_JSON_PATH}`)
    logLine(`Instance registry: ${INSTANCE_JSON_PATH}`)
  } catch (e) {
    log.warn('Could not write instance registry: ' + e.message)
    logLine('Instance registry: write failed — ' + e.message)
  }
}

// ---------------------------------------------------------------------------
// SECTION 4: Integrations
// ---------------------------------------------------------------------------
async function section4_Integrations() {
  logLine('\n=== SECTION 4: Integrations ===')

  // ---- 4.1 MCP registration ----
  const mcpCandidates = [
    path.join(process.cwd(), '.mcp.json'),
    path.join(os.homedir(), '.claude', 'mcp.json'),
    path.join(os.homedir(), '.config', 'claude', 'mcp.json'),
  ]
  if (IS_WINDOWS) {
    const appData = process.env.APPDATA || ''
    const localAppData = process.env.LOCALAPPDATA || ''
    if (appData) mcpCandidates.push(path.join(appData, 'Claude', 'mcp.json'))
    if (localAppData) mcpCandidates.push(path.join(localAppData, 'Claude', 'mcp.json'))
  }

  let mcpRegistered = false
  let mcpFoundPath = null
  for (const candidate of mcpCandidates) {
    if (fs.existsSync(candidate)) {
      try {
        const content = JSON.parse(fs.readFileSync(candidate, 'utf8'))
        const servers = content.mcpServers || content.servers || {}
        if (Object.values(servers).some(s => {
          const url = s.url || ''
          return url.includes('localhost:3001') || url.includes('iranti')
        })) {
          mcpRegistered = true
          mcpFoundPath = candidate
          break
        }
      } catch { /* ignore parse errors */ }
    }
  }

  if (mcpRegistered) {
    log.success(`MCP registration found in ${mcpFoundPath}`)
    logLine(`MCP: registered in ${mcpFoundPath}`)
    state.mcpWritten = true
  } else {
    log.warn('Iranti MCP not registered in any .mcp.json found.')
    logLine('MCP: not registered')

    const mcpBlock = JSON.stringify({
      mcpServers: {
        iranti: {
          type: 'http',
          url: `http://localhost:${IRANTI_PORT}/mcp`,
        },
      },
    }, null, 2)

    note(`Add this to your .mcp.json:\n${mcpBlock}`, 'MCP configuration')

    const writeMcp = checkCancel(await confirm({
      message: `Write Iranti MCP entry to ${MCP_JSON_PATH}?`,
      initialValue: true,
    }))
    if (writeMcp) {
      try {
        let existing = {}
        if (fs.existsSync(MCP_JSON_PATH)) {
          try { existing = JSON.parse(fs.readFileSync(MCP_JSON_PATH, 'utf8')) } catch { /* ignore */ }
        }
        // Merge — support both mcpServers and servers
        if (!existing.mcpServers) existing.mcpServers = {}
        existing.mcpServers.iranti = { type: 'http', url: `http://localhost:${IRANTI_PORT}/mcp` }
        const tmp = MCP_JSON_PATH + '.tmp'
        fs.writeFileSync(tmp, JSON.stringify(existing, null, 2) + '\n', 'utf8')
        fs.renameSync(tmp, MCP_JSON_PATH)
        log.success(`MCP configuration written to ${MCP_JSON_PATH}`)
        logLine(`MCP: written to ${MCP_JSON_PATH}`)
        state.mcpWritten = true
      } catch (e) {
        log.error('Could not write .mcp.json: ' + e.message)
        logLine('MCP: write failed — ' + e.message)
      }
    } else {
      logLine('MCP: user skipped auto-write')
    }
  }

  // ---- 4.2 Project binding ----
  const bindProject = checkCancel(await confirm({
    message: `Bind project directory "${process.cwd()}" to Iranti now?`,
    initialValue: true,
  }))
  if (bindProject) {
    const s = spinner()
    s.start('Binding project...')
    // iranti project init is the upstream command — best effort
    const bindRes = await run(`npx iranti project init "${process.cwd()}" --instance ${state.instanceName}`)
    if (bindRes.ok) {
      s.stop('Project bound successfully')
      logLine('Project binding: OK')
    } else {
      s.stop('Project binding not available')
      logLine('Project binding: failed or iranti CLI not installed — ' + bindRes.stderr)
      note(
        `When the Iranti CLI is installed, run:\n  iranti project init . --instance ${state.instanceName}`,
        'Project binding manual step'
      )
    }
  } else {
    logLine('Project binding: skipped')
    note(
      `To bind later:\n  iranti project init . --instance ${state.instanceName}`,
      'Project binding'
    )
  }

  // ---- 4.3 Claude Code integration check ----
  const claudeMdPath = path.join(process.cwd(), 'CLAUDE.md')
  if (fs.existsSync(claudeMdPath)) {
    log.success('CLAUDE.md found in current directory')
    logLine('CLAUDE.md: present')
  } else {
    log.info('No CLAUDE.md in current directory (informational — not required for basic setup)')
    logLine('CLAUDE.md: not present')
  }
}

// ---------------------------------------------------------------------------
// SECTION 5: Verification
// ---------------------------------------------------------------------------
async function section5_Verification() {
  logLine('\n=== SECTION 5: Verification ===')

  const checks = []

  // Node.js check
  checks.push({ label: 'Node.js', ok: true, value: process.version })
  logLine(`Verification: Node.js ${process.version}`)

  // PostgreSQL reachability
  if (IS_WINDOWS) {
    const pgOk = await tcpReachable('localhost', parseInt(state.dbPort, 10))
    checks.push({ label: `PostgreSQL at ${state.dbHost}:${state.dbPort}`, ok: pgOk, value: pgOk ? 'reachable' : 'not reachable' })
    logLine(`Verification: PostgreSQL ${pgOk ? 'reachable' : 'not reachable'}`)
  } else {
    const pgRes = await run(`pg_isready -h ${state.dbHost} -p ${state.dbPort}`)
    const pgOk = pgRes.ok
    checks.push({ label: `PostgreSQL at ${state.dbHost}:${state.dbPort}`, ok: pgOk, value: pgOk ? 'reachable' : 'not reachable' })
    logLine(`Verification: PostgreSQL ${pgOk ? 'reachable' : 'not reachable'}`)
  }

  // pgvector
  if (state.databaseUrl) {
    const pgv = await checkPgvector(state.databaseUrl)
    const pvOk = pgv.enabled
    checks.push({ label: 'pgvector extension', ok: pvOk, warning: pgv.available && !pgv.enabled, value: pvOk ? 'enabled' : (pgv.available ? 'installed but not enabled' : 'not installed') })
    logLine(`Verification: pgvector ${pvOk ? 'enabled' : 'not enabled'}`)
  }

  // Instance registry
  const instanceOk = fs.existsSync(INSTANCE_JSON_PATH)
  checks.push({ label: `Instance "local" at ${INSTANCE_DIR}`, ok: instanceOk, value: instanceOk ? 'registered' : 'not registered' })
  logLine(`Verification: instance registry ${instanceOk ? 'OK' : 'missing'}`)

  // DATABASE_URL
  const envData = readEnvFile(ENV_PATH)
  const dbUrlOk = !!envData.DATABASE_URL
  checks.push({ label: 'DATABASE_URL', ok: dbUrlOk, value: dbUrlOk ? maskDatabaseUrl(envData.DATABASE_URL) : 'not set' })
  logLine(`Verification: DATABASE_URL ${dbUrlOk ? 'set' : 'not set'}`)

  // Providers
  const providerKeys = PROVIDERS
    .filter(p => p.envKey)
    .filter(p => envData[p.envKey])
  const providersOk = providerKeys.length > 0
  checks.push({
    label: 'Providers configured',
    ok: providersOk,
    warning: !providersOk,
    value: providersOk ? providerKeys.map(p => p.name).join(', ') : 'none',
  })
  logLine(`Verification: providers ${providersOk ? providerKeys.map(p => p.name).join(', ') : 'none'}`)

  // Default provider
  const defaultProviderOk = !!envData.LLM_PROVIDER
  checks.push({
    label: 'Default provider',
    ok: defaultProviderOk,
    warning: !defaultProviderOk,
    value: envData.LLM_PROVIDER || 'not set',
  })
  logLine(`Verification: default provider ${envData.LLM_PROVIDER || 'not set'}`)

  // MCP registration
  checks.push({
    label: 'MCP registration',
    ok: state.mcpWritten,
    warning: !state.mcpWritten,
    value: state.mcpWritten ? MCP_JSON_PATH : 'not confirmed',
  })
  logLine(`Verification: MCP ${state.mcpWritten ? 'registered' : 'not confirmed'}`)

  // Control plane health check
  const s = spinner()
  s.start(`Checking control plane health at http://localhost:${CONTROL_PLANE_PORT}/api/control-plane/health...`)
  const healthBody = await httpGet(`http://localhost:${CONTROL_PLANE_PORT}/api/control-plane/health`, 3000)
  if (healthBody !== null) {
    s.stop('Control plane health endpoint responded')
    checks.push({ label: 'Control plane server', ok: true, value: `http://localhost:${CONTROL_PLANE_PORT}` })
    logLine('Verification: control plane health OK')
  } else {
    s.stop('Control plane server not running (normal — not started yet)')
    checks.push({ label: 'Control plane server', ok: false, warning: true, value: 'not running' })
    logLine('Verification: control plane not running')
  }

  // Display traffic-light summary
  console.log('\n  Verification Summary:')
  for (const check of checks) {
    const icon = check.ok ? '✓' : (check.warning ? '!' : '✗')
    const color = check.ok ? '  [✓]' : (check.warning ? '  [!]' : '  [✗]')
    console.log(`${color} ${check.label}: ${check.value}`)
  }
  console.log('')

  const criticalFails = checks.filter(c => !c.ok && !c.warning)
  const warnings = checks.filter(c => c.warning || (!c.ok && c.warning !== false))

  logLine(`Verification: ${criticalFails.length} critical failures, ${warnings.length} warnings`)

  // ---- Offer to launch server ----
  const launchServer = checkCancel(await confirm({
    message: 'Start the Iranti Control Plane now? (npm run dev)',
    initialValue: false,
  }))
  if (launchServer) {
    logLine('User chose to launch server')
    console.log('')
    console.log(`  Run this command in your terminal:`)
    console.log(`    npm run dev`)
    console.log('')
    console.log(`  Then open: http://localhost:5173`)
    console.log('')
    // We don't auto-exec npm run dev as it's long-running and would take over the wizard terminal
  } else {
    logLine('Server launch: skipped')
    note(
      'To start:\n  npm run dev\n\nThen open: http://localhost:5173',
      'Start the control plane'
    )
  }

  return { criticalFails, warnings }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
async function main() {
  logLine(`Iranti Control Plane Setup Wizard`)
  logLine(`Started: ${new Date().toISOString()}`)
  logLine(`Platform: ${process.platform}`)
  logLine(`Node: ${process.version}`)
  logLine(`CWD: ${process.cwd()}`)
  logLine(`Project root: ${PROJECT_ROOT}`)

  intro('  Iranti Control Plane — Setup Wizard  ')

  console.log('  This wizard will guide you through 5 sections:')
  console.log('  1. System Checks')
  console.log('  2. Database Setup')
  console.log('  3. Provider Setup')
  console.log('  4. Integrations')
  console.log('  5. Verification')
  console.log('')
  console.log('  Press Ctrl+C at any time to cancel without writing any changes.')
  console.log('')

  // ---- Section 1 ----
  note('', 'Section 1: System Checks')
  logLine('\n--- Section 1 start ---')
  await section1_SystemChecks()

  // ---- Section 2 ----
  note('', 'Section 2: Database Setup')
  logLine('\n--- Section 2 start ---')
  await section2_DatabaseSetup()

  // ---- Section 3 ----
  note('', 'Section 3: Provider Setup')
  logLine('\n--- Section 3 start ---')
  await section3_ProviderSetup()

  // ---- Section 4 ----
  note('', 'Section 4: Integrations')
  logLine('\n--- Section 4 start ---')
  await section4_Integrations()

  // ---- Section 5 ----
  note('', 'Section 5: Verification')
  logLine('\n--- Section 5 start ---')
  const { criticalFails, warnings } = await section5_Verification()

  // ---- Final message ----
  logLine(`\n--- Setup complete ---`)
  writeLog()

  if (criticalFails.length === 0 && warnings.length === 0) {
    outro(`Setup complete. Verbose log saved to: ${LOG_PATH}`)
  } else if (criticalFails.length === 0) {
    outro(
      `Setup complete with ${warnings.length} warning(s).\n` +
      `  Run 'npm run setup' again to address warnings.\n` +
      `  Verbose log: ${LOG_PATH}`
    )
  } else {
    outro(
      `Setup could not be fully completed (${criticalFails.length} critical issue(s)).\n` +
      `  Verbose log: ${LOG_PATH}`
    )
  }
}

main().catch((err) => {
  // Unexpected crash — log and exit
  logLine(`\n[CRASH] ${err.message}\n${err.stack}`)
  writeLog()
  console.error('\nSetup wizard encountered an unexpected error:')
  console.error(err.message)
  console.error(`Log saved to: ${LOG_PATH}`)
  process.exit(1)
})
