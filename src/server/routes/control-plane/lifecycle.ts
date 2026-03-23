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
import { dirname, join } from 'path'
import { readFile } from 'fs/promises'
import { getConfiguredInstanceIdentifiers } from './instance-identifiers.js'

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

async function resolveInstancePort(name: string): Promise<number> {
  const configured = getConfiguredInstanceIdentifiers()
  const envPath = join(configured.runtimeRoot, 'instances', name, '.env')
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
// CLI availability check (mirrors upgrade.ts pattern)
// ---------------------------------------------------------------------------

function findCliCandidates(): Promise<string[]> {
  return new Promise((resolve) => {
    const checker = process.platform === 'win32' ? 'where' : 'which'
    const child = spawn(checker, ['iranti'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let stdout = ''

    const timer = setTimeout(() => {
      child.kill()
      resolve([])
    }, 3000)

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })

    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        resolve([])
        return
      }
      resolve(
        stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      )
    })

    child.on('error', () => {
      clearTimeout(timer)
      resolve([])
    })
  })
}

async function checkCliAvailable(): Promise<boolean> {
  const candidates = await findCliCandidates()
  return candidates.length > 0
}

function resolveCliLaunch(candidates: string[]): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    const cmdShim =
      candidates.find((candidate) => candidate.toLowerCase().endsWith('\\iranti.cmd')) ??
      candidates[0]

    const installDir = dirname(cmdShim)
    const cliEntry = join(installDir, 'node_modules', 'iranti', 'bin', 'iranti.js')
    return {
      command: process.execPath,
      args: [cliEntry],
    }
  }

  return {
    command: candidates[0] ?? 'iranti',
    args: [],
  }
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
  const cliCandidates = await findCliCandidates()
  if (cliCandidates.length === 0) {
    res.status(400).json({
      error: 'iranti CLI not found on PATH. Install iranti to start instances from the control plane.',
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
    const startedAt = new Date().toISOString()
    const launch = resolveCliLaunch(cliCandidates)
    const configured = getConfiguredInstanceIdentifiers()
    const instancePort = await resolveInstancePort(name)

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
      [...launch.args, 'run', '--instance', name, '--root', configured.runtimeRoot],
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

    managedProcesses.set(name, { child, pid, startedAt })

    auditLog('START', name, { pid, startedAt })

    const response: StartResponse = {
      instanceName: name,
      pid,
      status: 'started',
      startedAt,
    }

    res.status(202).json(response)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    auditLog('START_FAILED', name, { error: message })
    res.status(500).json({
      error: `Failed to spawn iranti process: ${message}`,
      code: 'SPAWN_FAILED',
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
