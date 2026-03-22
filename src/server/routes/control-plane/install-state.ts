/**
 * Install State route — CP-T079
 *
 * GET /install-state
 *
 * Detects whether the `iranti` CLI is available on the system PATH and,
 * if so, extracts its version. Uses platform-appropriate commands:
 *   - Windows: `where iranti`
 *   - Unix:    `which iranti`
 *
 * Always returns HTTP 200. Returns { installed: false } gracefully when
 * the CLI is not found, times out, or any subprocess call fails.
 */

import { Router, Request, Response } from 'express'
import { spawn } from 'child_process'

export const installStateRouter = Router()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InstallStateResponse {
  installed: boolean
  version: string | null         // semver string e.g. "0.2.16", null if not installed
  executablePath: string | null  // absolute path from `which`/`where`
  checkedAt: string              // ISO timestamp
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a subprocess with a timeout. Returns stdout on exit code 0,
 * null on non-zero exit, error, or timeout.
 */
function runWithTimeout(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false

    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    let stdout = ''

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        child.kill()
        resolve(null)
      }
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })

    child.on('exit', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve(code === 0 ? stdout : null)
      }
    })

    child.on('error', () => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve(null)
      }
    })
  })
}

/**
 * Parse a semver string from iranti --version output.
 * Handles both "iranti/0.2.16" and "0.2.16" formats.
 */
function parseVersion(raw: string): string | null {
  const match = raw.match(/(\d+\.\d+\.\d+)/)
  return match ? match[1] : null
}

/**
 * Detect the iranti CLI on PATH and return the executable path.
 * Returns null if not found.
 */
async function detectIrantiPath(): Promise<string | null> {
  const checker = process.platform === 'win32' ? 'where' : 'which'
  const output = await runWithTimeout(checker, ['iranti'], 3000)
  if (!output) return null
  // `where` may return multiple lines — use the first non-empty one
  const firstLine = output.split('\n').map((l) => l.trim()).find((l) => l.length > 0)
  return firstLine ?? null
}

/**
 * Get the iranti version by running `iranti --version`.
 * Returns null if the call fails or the output is not parseable.
 */
async function detectIrantiVersion(binaryPath: string): Promise<string | null> {
  const output = await runWithTimeout(binaryPath, ['--version'], 3000)
  if (!output) return null
  return parseVersion(output)
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

installStateRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  const checkedAt = new Date().toISOString()

  try {
    const executablePath = await detectIrantiPath()

    if (!executablePath) {
      const result: InstallStateResponse = {
        installed: false,
        version: null,
        executablePath: null,
        checkedAt,
      }
      res.status(200).json(result)
      return
    }

    const version = await detectIrantiVersion(executablePath)

    const result: InstallStateResponse = {
      installed: true,
      version,
      executablePath,
      checkedAt,
    }
    res.status(200).json(result)
  } catch {
    // Never 500 — return not-installed gracefully
    const result: InstallStateResponse = {
      installed: false,
      version: null,
      executablePath: null,
      checkedAt,
    }
    res.status(200).json(result)
  }
})
