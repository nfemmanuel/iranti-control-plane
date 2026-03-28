import { spawn } from 'child_process'
import { Router } from 'express'

export const controlPlaneSelfRouter = Router()

function scheduleSelfStop(delayMs = 250): void {
  setTimeout(() => {
    try {
      process.kill(process.pid, 'SIGTERM')
    } catch {
      process.exit(0)
    }
  }, delayMs)
}

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
  scheduleSelfStop()
})

controlPlaneSelfRouter.post('/self/uninstall', (_req, res) => {
  res.status(202).json({
    ok: true,
    action: 'uninstall',
    message: 'Control Plane uninstall has started. The app will shut down before npm removes the package.',
  })
  scheduleSelfUninstall()
  scheduleSelfStop()
})
