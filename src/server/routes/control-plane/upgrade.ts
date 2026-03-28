/**
 * Upgrade coordination routes — CP-T073
 *
 * Surfaces `iranti upgrade --yes --restart --instance <name>` as HTTP endpoints so
 * operators can trigger and track upgrades from the control plane UI.
 *
 * Routes:
 *   POST /:name/upgrade             — start an upgrade job (returns 202 immediately)
 *   GET  /:name/upgrade/:jobId      — poll job status
 *
 * The job store is in-memory and not persisted across control plane restarts.
 * A maximum of 50 jobs are retained; the oldest is evicted when the limit is
 * exceeded.
 *
 * Security invariant: `name` is validated against /^[a-zA-Z0-9_-]+$/ before
 * being passed to spawn. No unsanitized user input is ever passed to child_process.
 */

import { Router, Request, Response } from 'express'
import { spawn } from 'child_process'
import { UpgradeJobStarted, UpgradeJobStatus } from '../../types.js'
import { resolveIrantiCli } from '../../lib/iranti-cli.js'
import { resolveInstanceAuthority } from '../../lib/instance-authority.js'

export const upgradeRouter = Router()

// ---------------------------------------------------------------------------
// In-memory job store
// ---------------------------------------------------------------------------

interface UpgradeJob {
  jobId: string
  instanceName: string
  status: 'running' | 'complete' | 'failed'
  output: string[]
  exitCode: number | null
  startedAt: string
  completedAt: string | null
}

const JOB_STORE_MAX = 50
const jobStore = new Map<string, UpgradeJob>()

function addJob(job: UpgradeJob): void {
  if (jobStore.size >= JOB_STORE_MAX) {
    // Evict the oldest entry (Map preserves insertion order)
    const oldestKey = jobStore.keys().next().value
    if (oldestKey !== undefined) {
      jobStore.delete(oldestKey)
    }
  }
  jobStore.set(job.jobId, job)
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const INSTANCE_NAME_RE = /^[a-zA-Z0-9_-]+$/

// ---------------------------------------------------------------------------
// Line buffering helper
// ---------------------------------------------------------------------------

function makeLineBuffer(onLine: (line: string) => void): (chunk: string) => void {
  let partial = ''
  return (chunk: string): void => {
    partial += chunk
    const lines = partial.split('\n')
    // The last element may be an incomplete line — keep it in the buffer
    partial = lines.pop() ?? ''
    for (const line of lines) {
      onLine(line)
    }
  }
}

// ---------------------------------------------------------------------------
// POST /:name/upgrade — start an upgrade job
// ---------------------------------------------------------------------------

upgradeRouter.post('/:name/upgrade', async (req: Request, res: Response): Promise<void> => {
  const { name } = req.params

  // Validate instance name
  if (!INSTANCE_NAME_RE.test(name)) {
    res.status(400).json({
      error: 'Invalid instance name',
      code: 'INVALID_PARAM',
    })
    return
  }

  const launch = await resolveIrantiCli()
  if (!launch) {
    res.status(400).json({
      error: `iranti CLI not found on PATH. Upgrade must be run manually: iranti upgrade --restart --instance ${name}`,
      code: 'CLI_NOT_FOUND',
    })
    return
  }

  const authority = await resolveInstanceAuthority(name)
  const runtimeRoot = authority?.runtimeRoot ?? null

  // Generate job ID and create job entry
  const jobId = crypto.randomUUID()
  const startedAt = new Date().toISOString()

  const job: UpgradeJob = {
    jobId,
    instanceName: name,
    status: 'running',
    output: [],
    exitCode: null,
    startedAt,
    completedAt: null,
  }

  addJob(job)

  const cliArgs = [...launch.args, 'upgrade', '--yes', '--restart', '--instance', name]
  if (runtimeRoot) cliArgs.push('--root', runtimeRoot)

  let child: ReturnType<typeof spawn>
  try {
    child = spawn(launch.command, cliArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  } catch (error) {
    job.status = 'failed'
    job.completedAt = new Date().toISOString()
    job.exitCode = -1
    job.output.push(`[stderr] ${error instanceof Error ? error.message : String(error)}`)
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to start upgrade process.',
      code: 'UPGRADE_SPAWN_FAILED',
    })
    return
  }

  // Audit log
  console.log(`[upgrade] Started upgrade job ${jobId} for instance ${name} (PID: ${child.pid})`)

  // Wire stdout with line buffering
  const stdoutBuffer = makeLineBuffer((line) => {
    job.output.push(line)
  })

  if (child.stdout) {
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer(chunk)
    })
  }

  // Wire stderr with line buffering and prefix
  const stderrBuffer = makeLineBuffer((line) => {
    job.output.push(`[stderr] ${line}`)
  })

  if (child.stderr) {
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderrBuffer(chunk)
    })
  }

  child.on('error', (error) => {
    job.exitCode = -1
    job.status = 'failed'
    job.completedAt = new Date().toISOString()
    job.output.push(`[stderr] ${error.message}`)
  })

  // Handle process exit
  child.on('exit', (code) => {
    const exitCode = code ?? null
    job.exitCode = exitCode
    job.status = exitCode === 0 ? 'complete' : 'failed'
    job.completedAt = new Date().toISOString()
    console.log(`[upgrade] Job ${jobId} for instance ${name} exited with code ${exitCode}`)
  })

  // Return 202 immediately — do not await the child process
  const response: UpgradeJobStarted = {
    jobId,
    instanceName: name,
    status: 'started',
    startedAt,
  }

  res.status(202).json(response)
})

// ---------------------------------------------------------------------------
// GET /:name/upgrade/:jobId — poll job status
// ---------------------------------------------------------------------------

upgradeRouter.get('/:name/upgrade/:jobId', (req: Request, res: Response): void => {
  const { name, jobId } = req.params

  const job = jobStore.get(jobId)

  // Not found or instance name mismatch — both return 404
  if (!job || job.instanceName !== name) {
    res.status(404).json({
      error: 'Job not found',
      code: 'NOT_FOUND',
    })
    return
  }

  const response: UpgradeJobStatus = {
    jobId: job.jobId,
    instanceName: job.instanceName,
    status: job.status,
    output: job.output,
    exitCode: job.exitCode,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  }

  res.status(200).json(response)
})
