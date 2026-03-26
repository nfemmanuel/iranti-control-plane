/**
 * Install State route — CP-T079
 *
 * GET /install-state
 *
 * Detects the Iranti CLI using the same shared resolution path the control
 * plane uses for lifecycle and parity checks:
 *   1. explicit env override
 *   2. PATH
 *   3. repo-local sibling fallback for local development
 *
 * Always returns HTTP 200. Returns { installed: false } gracefully when
 * the CLI is not found or version probing fails.
 */

import { Router, Request, Response } from 'express'
import { resolveIrantiCli, runIrantiCommand } from '../../lib/iranti-cli.js'

export const installStateRouter = Router()

interface InstallStateResponse {
  installed: boolean
  version: string | null
  executablePath: string | null
  checkedAt: string
}

function parseVersion(raw: string): string | null {
  const match = raw.match(/(\d+\.\d+\.\d+)/)
  return match ? match[1] : null
}

installStateRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  const checkedAt = new Date().toISOString()

  try {
    const resolution = await resolveIrantiCli()
    if (!resolution) {
      res.status(200).json({
        installed: false,
        version: null,
        executablePath: null,
        checkedAt,
      } satisfies InstallStateResponse)
      return
    }

    let version: string | null = null
    try {
      const result = await runIrantiCommand(['--version'], { timeoutMs: 3000 })
      version = parseVersion(result.stdout)
    } catch {
      version = null
    }

    res.status(200).json({
      installed: true,
      version,
      executablePath: resolution.displayPath,
      checkedAt,
    } satisfies InstallStateResponse)
  } catch {
    res.status(200).json({
      installed: false,
      version: null,
      executablePath: null,
      checkedAt,
    } satisfies InstallStateResponse)
  }
})
