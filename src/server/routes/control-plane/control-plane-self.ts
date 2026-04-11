/**
 * control-plane-self.ts — Routes for stopping and uninstalling the Control Plane process.
 *
 * Routes:
 *   GET  /self/shutdown-stream  — SSE channel; broadcasts a 'shutdown' event just before
 *                                 the process exits so the UI can show a clean teardown.
 *   POST /self/stop             — Sends SIGTERM to the current process after a short delay.
 *   POST /self/uninstall        — Schedules a detached `npm uninstall -g` subprocess, then
 *                                 stops the process as above.
 *
 * Security: these routes are intentionally unauthenticated because the control plane
 * runs locally. The UI asks for confirmation before calling either mutating endpoint.
 */

import { spawn } from 'child_process'
import { Router, Request, Response } from 'express'

export const controlPlaneSelfRouter = Router()

// ---------------------------------------------------------------------------
// Shutdown broadcast — SSE registry
// ---------------------------------------------------------------------------

const shutdownListeners = new Set<Response>()

function broadcastShutdown(): void {
  for (const client of shutdownListeners) {
    try {
      client.write('event: shutdown\ndata: {}\n\n')
    } catch {
      // Client already disconnected — ignore
    }
  }
  shutdownListeners.clear()
}

function scheduleSelfStop(delayMs = 250): void {
  setTimeout(() => {
    try {
      process.kill(process.pid, 'SIGTERM')
    } catch {
      process.exit(0)
    }
  }, delayMs)
}

// ---------------------------------------------------------------------------
// GET /self/shutdown-stream — SSE channel for coordinated client teardown
// ---------------------------------------------------------------------------

controlPlaneSelfRouter.get('/self/shutdown-stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  shutdownListeners.add(res)
  req.on('close', () => shutdownListeners.delete(res))
})

function scheduleSelfUninstall(): void {
  if (process.platform === 'win32') {
    const child = spawn('cmd', ['/d', '/s', '/c', 'ping 127.0.0.1 -n 3 >nul && npm.cmd uninstall -g iranti-control-plane'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
    return
  }

  const child = spawn('sh', ['-lc', 'sleep 2 && npm uninstall -g iranti-control-plane'], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

controlPlaneSelfRouter.post('/self/stop', (_req, res) => {
  res.status(202).json({
    ok: true,
    action: 'stop',
    message: 'Control Plane is shutting down.',
  })
  broadcastShutdown()
  scheduleSelfStop()
})

controlPlaneSelfRouter.post('/self/uninstall', (_req, res) => {
  res.status(202).json({
    ok: true,
    action: 'uninstall',
    message: 'Control Plane uninstall has started. The app will shut down before npm removes the package.',
  })
  broadcastShutdown()
  scheduleSelfUninstall()
  scheduleSelfStop()
})
