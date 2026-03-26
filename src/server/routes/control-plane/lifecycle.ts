/**
 * Process Lifecycle routes — CP-T080
 *
 * Surfaces `iranti run --instance <name>` start/stop controls as HTTP
 * endpoints so operators can manage Iranti instance processes from the
 * control plane UI.
 *
 * Routes:
 *   POST /:name/start           — spawn `iranti run --instance <name>`
 *   POST /:name/stop            — send SIGTERM to the tracked process
 *   GET  /:name/process-status  — check in-memory tracking state
 *
 * PID tracking is in-memory only. Restarting the control plane server
 * clears the PID map — this is a documented limitation for v0.6.0.
 *
 * Security invariant: `name` is validated against /^[a-zA-Z0-9_-]{1,64}$/
 * before being passed to spawn. No unsanitized user input is ever passed
 * to child_process.
 */

import { Router, Request, Response } from 'express'
import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { getConfiguredInstanceIdentifiers } from './instance-identifiers.js'
import { resolveIrantiCli, runIrantiCommand, runIrantiJson } from '../../lib/iranti-cli.js'
import { resolveInstanceAuthority } from '../../lib/instance-authority.js'

function parseEnvContent(content: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    parsed[key] = value
  }
  return parsed
}

async function resolveInstancePort(runtimeRoot: string, name: string): Promise<number> {
  const envPath = join(runtimeRoot, 'instances', name, '.env')
  const content = await readFile(envPath, 'utf8')
  const parsed = parseEnvContent(content)
  const rawPort = parsed['IRANTI_PORT'] ?? parsed['PORT'] ?? '3001'
  const port = Number.parseInt(rawPort, 10)

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid IRANTI_PORT for instance ${name}: ${rawPort}`)
  }

  return port
}

async function probeIrantiHealth(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(1500),
    })
    return res.ok
  } catch {
    return false
  }
}

export const lifecycleRouter = Router()

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const INSTANCE_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/

function isValidInstanceName(name: string): boolean {
  return INSTANCE_NAME_RE.test(name)
}

// ---------------------------------------------------------------------------
// In-memory PID map
// instanceName -> ChildProcess object
// ---------------------------------------------------------------------------

interface ManagedProcess {
  child: ChildProcess
  pid: number
  startedAt: string
}

interface StatusInstanceSummary {
  name: string
  runtime: {
    classification: 'running' | 'unhealthy' | 'stale' | 'stopped' | 'missing' | 'invalid' | 'unknown'
    running: boolean
    stale: boolean
    detail: string
    state?: {
      pid?: number | null
      port?: number | null
      healthUrl?: string | null
    } | null
    health?: {
      checked?: boolean
      ok?: boolean
      detail?: string
    } | null
  }
}

interface StatusCommandResult {
  instances: StatusInstanceSummary[]
}

interface LifecycleError extends Error {
  code: string
  detail?: Record<string, unknown>
}

const managedProcesses = new Map<string, ManagedProcess>()

function isAlive(entry: ManagedProcess): boolean {
  return entry.child.exitCode === null && entry.child.killed === false
}

// ---------------------------------------------------------------------------
// Audit log helper
// ---------------------------------------------------------------------------

function auditLog(event: string, instanceName: string, detail: Record<string, unknown>): void {
  console.log(`[lifecycle] ${event} | instance=${instanceName}`, detail)
}

function toPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function createLifecycleError(code: string, message: string, detail?: Record<string, unknown>): LifecycleError {
  const error = new Error(message) as LifecycleError
  error.code = code
  if (detail) {
    error.detail = detail
  }
  return error
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForConfirmedStart(name: string, runtimeRoot: string, pid: number, child: ChildProcess): Promise<StatusInstanceSummary> {
  const timeoutMs = toPositiveInteger(process.env['IRANTI_CP_START_CONFIRM_TIMEOUT_MS'], 15000)
  const intervalMs = toPositiveInteger(process.env['IRANTI_CP_START_CONFIRM_POLL_MS'], 500)
  const statusTimeoutMs = Math.min(timeoutMs, 5000)
  const deadline = Date.now() + timeoutMs
  let lastObserved = 'no runtime status observed'
  let lastClassification = 'missing'

  while (Date.now() <= deadline) {
    if (child.exitCode !== null) {
      throw createLifecycleError(
        'START_PROCESS_EXITED',
        `Iranti process exited before runtime confirmation completed for '${name}'.`,
        { pid, exitCode: child.exitCode, lastObserved, runtimeRoot }
      )
    }

    try {
      const status = await runIrantiJson<StatusCommandResult>(['status', '--root', runtimeRoot, '--json'], {
        timeoutMs: statusTimeoutMs,
      })
      const instance = status.json.instances.find((entry) => entry.name === name)
      if (!instance) {
        lastObserved = `instance '${name}' not reported by iranti status`
        lastClassification = 'missing'
      } else {
        lastObserved = instance.runtime.detail
        lastClassification = instance.runtime.classification

        if (
          instance.runtime.classification === 'running' &&
          instance.runtime.running &&
          instance.runtime.state?.pid === pid
        ) {
          return instance
        }

        if (instance.runtime.classification === 'invalid') {
          throw createLifecycleError(
            'START_RUNTIME_INVALID',
            `Iranti reported invalid runtime state for '${name}' after spawn: ${instance.runtime.detail}`,
            { pid, runtimeRoot, classification: instance.runtime.classification, detail: instance.runtime.detail }
          )
        }
      }
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && typeof (error as LifecycleError).code === 'string') {
        throw error
      }
      lastObserved = error instanceof Error ? error.message : String(error)
      lastClassification = 'unknown'
    }

    await sleep(intervalMs)
  }

  throw createLifecycleError(
    'START_CONFIRMATION_TIMEOUT',
    `Iranti instance '${name}' did not become running within ${Math.ceil(timeoutMs / 1000)}s after spawn.`,
    { pid, runtimeRoot, classification: lastClassification, detail: lastObserved }
  )
}

// ---------------------------------------------------------------------------
// POST /:name/start — spawn iranti run --instance <name>
// ---------------------------------------------------------------------------

lifecycleRouter.post('/:name/start', async (req: Request, res: Response): Promise<void> => {
  const { name } = req.params

  // Validate instance name — no shell-injectable characters
  if (!isValidInstanceName(name)) {
    res.status(400).json({
      error: 'Invalid instance name. Use only alphanumeric characters, hyphens, and underscores (max 64 chars).',
      code: 'INVALID_PARAM',
    })
    return
  }

  // Check iranti CLI is available
  const launch = await resolveIrantiCli()
  if (!launch) {
    res.status(400).json({
      error: 'iranti CLI not found via env override, PATH, or repo-local fallback. Install iranti or set IRANTI_CLI_PATH.',
      code: 'CLI_NOT_FOUND',
    })
    return
  }

  // Check if already tracked and alive
  const existing = managedProcesses.get(name)
  if (existing && isAlive(existing)) {
    res.status(409).json({
      error: `Instance appears to already be running (PID: ${existing.pid})`,
      code: 'ALREADY_RUNNING',
      instanceName: name,
      pid: existing.pid,
    })
    return
  }

  // Clean up stale entry if process has exited
  if (existing) {
    managedProcesses.delete(name)
  }

  try {
    const resolved = await resolveInstanceAuthority(name)
    const runtimeRoot = resolved?.runtimeRoot ?? getConfiguredInstanceIdentifiers().runtimeRoot
    const instancePort = await resolveInstancePort(runtimeRoot, name)

    const alreadyReachable = await probeIrantiHealth(instancePort)
    if (alreadyReachable) {
      res.status(409).json({
        error: `Instance ${name} is already reachable on port ${instancePort}. No new process was started.`,
        code: 'ALREADY_RUNNING',
        instanceName: name,
      })
      return
    }

    // Spawn as detached + unref'd so the control plane process does not hold
    // a reference to it. The spawned Iranti process survives CP restarts.
    const child = spawn(
      launch.command,
      [...launch.args, 'run', '--instance', name, '--root', runtimeRoot],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }
    )

    // Let the event loop exit without waiting for this child
    child.unref()

    const pid = child.pid

    if (pid === undefined) {
      res.status(500).json({
        error: 'Spawn succeeded but no PID was assigned. The process may not have started.',
        code: 'SPAWN_NO_PID',
      })
      return
    }

    const startedAt = new Date().toISOString()
    const confirmed = await waitForConfirmedStart(name, runtimeRoot, pid, child)

    managedProcesses.set(name, { child, pid, startedAt })

    auditLog('START', name, {
      pid,
      startedAt,
      runtimeRoot,
      runtimeClassification: confirmed.runtime.classification,
      runtimeDetail: confirmed.runtime.detail,
    })

    const response: StartResponse = {
      instanceName: name,
      pid,
      status: 'started',
      startedAt,
    }

    res.status(200).json(response)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const code = typeof err === 'object' && err && 'code' in err && typeof (err as { code?: unknown }).code === 'string'
      ? String((err as { code?: unknown }).code)
      : 'SPAWN_FAILED'
    auditLog('START_FAILED', name, { error: message, code })
    res.status(500).json({
      error: message.startsWith('Iranti ') ? message : `Failed to start iranti instance: ${message}`,
      code,
    })
  }
})

// ---------------------------------------------------------------------------
// POST /:name/stop — send SIGTERM to the tracked process
// ---------------------------------------------------------------------------

lifecycleRouter.post('/:name/stop', async (req: Request, res: Response): Promise<void> => {
  const { name } = req.params

  if (!isValidInstanceName(name)) {
    res.status(400).json({
      error: 'Invalid instance name.',
      code: 'INVALID_PARAM',
    })
    return
  }

  const entry = managedProcesses.get(name)

  if (!entry) {
    res.status(404).json({
      error: 'No tracked process for this instance. Stop it manually using your OS process manager.',
      code: 'NOT_TRACKED',
      instanceName: name,
      pid: null,
    })
    return
  }

  const pid = entry.pid
  const stoppedAt = new Date().toISOString()

  try {
    // On Windows: child.kill() sends a terminate signal.
    // On Unix: send SIGTERM for graceful shutdown.
    if (process.platform === 'win32') {
      entry.child.kill()
    } else {
      entry.child.kill('SIGTERM')
    }
  } catch (err) {
    // If the process already exited between the check and the kill call,
    // proceed — we still remove it from the map and return stopped.
    const message = err instanceof Error ? err.message : String(err)
    auditLog('STOP_KILL_ERROR', name, { pid, error: message })
  }

  managedProcesses.delete(name)

  auditLog('STOP', name, { pid, stoppedAt })

  const response: StopResponse = {
    instanceName: name,
    pid,
    status: 'stopped',
    stoppedAt,
  }

  res.status(200).json(response)
})

// ---------------------------------------------------------------------------
// POST /:name/restart - delegate to `iranti instance restart <name>`
// ---------------------------------------------------------------------------

lifecycleRouter.post('/:name/restart', async (req: Request, res: Response): Promise<void> => {
  const { name } = req.params

  if (!isValidInstanceName(name)) {
    res.status(400).json({
      error: 'Invalid instance name.',
      code: 'INVALID_PARAM',
    })
    return
  }

  const launch = await resolveIrantiCli()
  if (!launch) {
    res.status(400).json({
      error: 'iranti CLI not found via env override, PATH, or repo-local fallback. Install iranti or set IRANTI_CLI_PATH.',
      code: 'CLI_NOT_FOUND',
    })
    return
  }

  const resolved = await resolveInstanceAuthority(name)
  const runtimeRoot = resolved?.runtimeRoot ?? getConfiguredInstanceIdentifiers().runtimeRoot

  try {
    await runIrantiCommand(['instance', 'restart', name, '--root', runtimeRoot], {
      timeoutMs: 60000,
    })

    managedProcesses.delete(name)

    const restartedAt = new Date().toISOString()
    auditLog('RESTART', name, { restartedAt, runtimeRoot })
    res.status(202).json({
      instanceName: name,
      status: 'restarted',
      restartedAt,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    auditLog('RESTART_FAILED', name, { error: message, runtimeRoot })
    res.status(500).json({
      error: `Failed to restart iranti instance: ${message}`,
      code: 'RESTART_FAILED',
    })
  }
})

// ---------------------------------------------------------------------------
// GET /:name/process-status — query in-memory tracking state
// ---------------------------------------------------------------------------

lifecycleRouter.get('/:name/process-status', (req: Request, res: Response): void => {
  const { name } = req.params

  if (!isValidInstanceName(name)) {
    res.status(400).json({
      error: 'Invalid instance name.',
      code: 'INVALID_PARAM',
    })
    return
  }

  const entry = managedProcesses.get(name)

  if (!entry) {
    const result: ProcessStatusResult = {
      managed: false,
      pid: null,
      alive: null,
    }
    res.status(200).json(result)
    return
  }

  const alive = isAlive(entry)

  const result: ProcessStatusResult = {
    managed: true,
    pid: entry.pid,
    alive,
  }

  res.status(200).json(result)
})

// ---------------------------------------------------------------------------
// Response types (also exported for use in tests if needed)
// ---------------------------------------------------------------------------

interface StartResponse {
  instanceName: string
  pid: number
  status: 'started'
  startedAt: string
}

interface StopResponse {
  instanceName: string
  pid: number
  status: 'stopped'
  stoppedAt: string
}

interface ProcessStatusResult {
  managed: boolean
  pid: number | null
  alive: boolean | null
}
