import express from 'express'
import cors from 'cors'
import net from 'net'
import { resolve, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { createRequire } from 'module'
import { controlPlaneRouter } from './routes/control-plane/index.js'
import { startAdapter, stopAdapter } from './lib/staff-event-adapter.js'
import { env } from './db.js'

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
//   (src/server/dist/index.js -> ../../public/control-plane)
// IRANTI_CP_ASSETS_DIR allows platform-specific launchers (macOS .app wrapper,
// Linux AppRun) to override the asset path when the binary is inside a bundle
// where process.execPath does not sit next to the public/ directory.
const clientDist = process.env.IRANTI_CP_ASSETS_DIR
  ? resolve(process.env.IRANTI_CP_ASSETS_DIR)
  : _isSea
  ? resolve(dirname(process.execPath), 'public', 'control-plane')
  : resolve(__dirname, '../../public/control-plane')

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
    // In dev/tsc, resolve relative to this file.
    const _require = createRequire(import.meta.url)
    const pkg = _require('../../package.json') as { version?: string }
    _version = pkg.version ?? '0.0.0'
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
    srv.listen(port, '127.0.0.1')
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
  const BASE_PORT = parseInt(env.CONTROL_PLANE_PORT ?? process.env.CONTROL_PLANE_PORT ?? '3000', 10)
  const PORT = await findAvailablePort(BASE_PORT, BASE_PORT + 10)

  const server = app.listen(PORT, () => {
    console.log(`[iranti-cp] v${VERSION} running at http://localhost:${PORT}`)
    console.log(`[iranti-cp] API at http://localhost:${PORT}/api/control-plane/`)

    // Start the staff-events adapter after the server is listening
    startAdapter().catch((err: unknown) => {
      console.warn('[adapter] Failed to start:', (err as Error).message)
    })

    // AC-6: auto-open browser when running as a packaged SEA binary
    if ((process as NodeJS.Process & { isSea?: () => boolean }).isSea?.()) {
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
