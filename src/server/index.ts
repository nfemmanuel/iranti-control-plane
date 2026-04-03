import express from 'express'
import cors from 'cors'
import net from 'net'
import { resolve, dirname } from 'path'
import { existsSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import { createRequire } from 'module'
import { controlPlaneRouter } from './routes/control-plane/index.js'
import { startAdapter, stopAdapter } from './lib/staff-event-adapter.js'
import { startFleetLedgerPoller, stopFleetLedgerPoller } from './lib/fleet-ledger-poller.js'
import { env } from './db.js'
import { buildPortSelectionPlan } from './lib/portSelection.js'

// ---------------------------------------------------------------------------
// SEA-aware path resolution
// ---------------------------------------------------------------------------
// Inside a Node SEA binary, import.meta.url resolves to a blob: URI, making
// fileURLToPath() unreliable for locating sidecar files on disk.
// We detect the SEA context via process.isSea() (available in Node 22+) and
// resolve relative to the binary's own path instead.

const _isSea: boolean =
  typeof (process as NodeJS.Process & { isSea?: () => boolean }).isSea === 'function' &&
  (process as NodeJS.Process & { isSea?: () => boolean }).isSea!()

const __dirname = _isSea
  ? dirname(process.execPath)
  : dirname(fileURLToPath(import.meta.url))

// In SEA context: assets are in <install-dir>/public/control-plane/
// In dev/tsc context: assets are at <project-root>/public/control-plane/
//   (src/server/dist/index.js -> ../../../public/control-plane)
// IRANTI_CP_ASSETS_DIR allows platform-specific launchers (macOS .app wrapper,
// Linux AppRun) to override the asset path when the binary is inside a bundle
// where process.execPath does not sit next to the public/ directory.
const clientDistCandidates = process.env.IRANTI_CP_ASSETS_DIR
  ? [resolve(process.env.IRANTI_CP_ASSETS_DIR)]
  : _isSea
  ? [resolve(dirname(process.execPath), 'public', 'control-plane')]
  : [
      resolve(__dirname, '../../../public/control-plane'),
      resolve(__dirname, '../../public/control-plane'),
      resolve(process.cwd(), '../../public/control-plane'),
      resolve(process.cwd(), '../public/control-plane'),
    ]

const clientDist =
  clientDistCandidates.find(candidate => existsSync(resolve(candidate, 'index.html'))) ??
  clientDistCandidates[0]

// ---------------------------------------------------------------------------
// Version detection
// ---------------------------------------------------------------------------
// Read version from the package.json that is closest to this binary/module.
// In dev: src/server/package.json. In SEA: root package.json placed alongside
// the binary by the installer (or the bundled string injected by esbuild).

let _version = '0.0.0'
try {
  if (_isSea) {
    // In SEA, the installer places package.json next to the binary.
    const pkgPath = resolve(dirname(process.execPath), 'package.json')
    const _require = createRequire(pathToFileURL(process.execPath).href)
    const pkg = _require(pkgPath) as { version?: string }
    _version = pkg.version ?? '0.0.0'
  } else {
    // In dev/tsc, resolve relative to src/server/dist/index.js.
    // In the bundled npm package, resolve relative to dist/server/bundle.cjs.
    const _require = createRequire(import.meta.url)
    const pkgCandidates = [
      '../../../package.json',
      '../../package.json',
      '../package.json',
    ]

    for (const candidate of pkgCandidates) {
      try {
        const pkg = _require(candidate) as { version?: string }
        if (pkg.version) {
          _version = pkg.version
          break
        }
      } catch {
        // Try the next candidate.
      }
    }
  }
} catch {
  // Non-fatal — version stays '0.0.0'
}

export const VERSION: string = _version

// ---------------------------------------------------------------------------
// Port auto-increment (AC-12)
// ---------------------------------------------------------------------------
// Tries ports start..end (inclusive), returns the first available one.
// Throws if no port in the range is available.

function testPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => {
      srv.close(() => resolve(true))
    })
    // Listen without a host so we probe all interfaces (IPv4 + IPv6),
    // matching what app.listen() does. Probing only 127.0.0.1 misses
    // processes bound to :: (e.g. Iranti on :::3001).
    srv.listen(port)
  })
}

async function findAvailablePort(start: number, end: number): Promise<number> {
  for (let p = start; p <= end; p++) {
    if (await testPort(p)) return p
  }
  throw new Error(
    `[iranti-cp] No available port in range ${start}–${end}. ` +
      `Free one of those ports and try again.`
  )
}

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = express()

app.use(cors({ origin: `http://localhost:5173` }))
app.use(express.json())

// ---------------------------------------------------------------------------
// Lightweight process probe
// ---------------------------------------------------------------------------

app.get('/api/control-plane/ping', (_req, res) => {
  res.json({
    ok: true,
    package: 'iranti-control-plane',
    version: VERSION,
  })
})

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

app.use('/api/control-plane', controlPlaneRouter)

// ---------------------------------------------------------------------------
// Serve built frontend (production)
// ---------------------------------------------------------------------------

app.use('/control-plane', express.static(clientDist))
app.get('/control-plane/*', (_req, res) => {
  res.sendFile(resolve(clientDist, 'index.html'))
})

// Root redirect
app.get('/', (_req, res) => res.redirect('/control-plane'))

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    const e = err as { statusCode?: number; code?: string; message?: string; detail?: object }
    const status = e.statusCode ?? 500
    res.status(status).json({
      error: e.message ?? 'Internal server error',
      code: e.code ?? 'INTERNAL_ERROR',
      ...(e.detail ? { detail: e.detail } : {}),
    })
  }
)

// ---------------------------------------------------------------------------
// Start — wrapped in async main() for CJS SEA compatibility.
// Node SEA embeds CJS only; top-level await is not supported in CJS, so
// the async startup logic lives here and is invoked via main().catch().
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const plan = buildPortSelectionPlan({
    explicitPort: process.env.CONTROL_PLANE_PORT ?? null,
    fallbackBasePort: env.CONTROL_PLANE_PORT ?? null,
  })
  const PORT = await findAvailablePort(plan.start, plan.end)

  // Auto-run migrations on startup
  try {
    const { run: runMigrations } = await import('./migrations/runner.js')
    await runMigrations()
    console.log('[iranti-cp] Migrations up to date.')
  } catch (err: unknown) {
    console.warn('[iranti-cp] Migration warning:', (err as Error).message)
    console.warn('[iranti-cp] Continuing startup — run migrations manually if needed.')
  }

  const server = app.listen(PORT, () => {
    console.log(`[iranti-cp] v${VERSION} running at http://localhost:${PORT}`)
    console.log(`[iranti-cp] API at http://localhost:${PORT}/api/control-plane/`)

    // Start the staff-events adapter after the server is listening
    startAdapter().catch((err: unknown) => {
      console.warn('[adapter] Failed to start:', (err as Error).message)
    })
    startFleetLedgerPoller()

    // Auto-open browser unless suppressed via IRANTI_CP_NO_OPEN=1
    if (!process.env['IRANTI_CP_NO_OPEN']) {
      import('open').then(({ default: open }) => {
        void open(`http://localhost:${PORT}`)
      }).catch(() => {
        // Non-fatal — browser open failure should not crash the server
      })
    }
  })

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------

  function shutdown(signal: string): void {
    console.log(`[iranti-cp] Received ${signal} — shutting down gracefully.`)
    stopAdapter()
    stopFleetLedgerPoller()
    server.close(() => {
      console.log('[iranti-cp] Server closed.')
      process.exit(0)
    })
    // Force-exit if server takes too long to close
    setTimeout(() => process.exit(1), 10_000)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err: unknown) => {
  console.error('[iranti-cp] Fatal startup error:', (err as Error).message ?? err)
  process.exit(1)
})
