import express from 'express'
import cors from 'cors'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { controlPlaneRouter } from './routes/control-plane/index.js'
import { startAdapter, stopAdapter } from './lib/staff-event-adapter.js'
import { env } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = parseInt(env.CONTROL_PLANE_PORT ?? process.env.CONTROL_PLANE_PORT ?? '3002', 10)

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(cors({ origin: `http://localhost:5173` }))
app.use(express.json())

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

app.use('/api/control-plane', controlPlaneRouter)

// ---------------------------------------------------------------------------
// Serve built frontend (production)
// ---------------------------------------------------------------------------

const clientDist = resolve(__dirname, '../../public/control-plane')
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
// Start
// ---------------------------------------------------------------------------

const server = app.listen(PORT, () => {
  console.log(`[iranti-cp] Control plane running at http://localhost:${PORT}`)
  console.log(`[iranti-cp] API at http://localhost:${PORT}/api/control-plane/`)

  // Start the staff-events adapter after the server is listening
  startAdapter().catch((err: unknown) => {
    console.warn('[adapter] Failed to start:', (err as Error).message)
  })
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
