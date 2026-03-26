/**
 * Codex Integration routes — CP-T095
 *
 * GET  /api/control-plane/integrations/codex
 *        Detect Codex and inspect live MCP registration state.
 *
 * POST /api/control-plane/integrations/codex
 *        Run `iranti codex-setup` using the shared Iranti CLI resolver.
 *
 * DELETE /api/control-plane/integrations/codex
 *        Remove Iranti from Codex using the official uninstall path first,
 *        then Codex's own `mcp remove` command as the fallback source of truth.
 */

import { Router, Request, Response } from 'express'
import { resolveCodexCli, runCodexCommand } from '../../lib/codex-cli.js'
import { runIrantiCommand } from '../../lib/iranti-cli.js'

export const codexIntegrationRouter = Router()

const SUBPROCESS_TIMEOUT_MS = 5_000

interface IrantiRegistrationResult {
  irantiRegistered: boolean
  registeredConfig: Record<string, unknown> | null
  issue: string | null
}

function collectOutput(...parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join('\n')
}

function looksNotRegistered(message: string): boolean {
  const lowered = message.toLowerCase()
  return (
    lowered.includes('not found') ||
    lowered.includes('not registered') ||
    lowered.includes('no server named') ||
    lowered.includes('unknown mcp server') ||
    lowered.includes('no mcp server')
  )
}

async function checkIrantiRegistration(): Promise<IrantiRegistrationResult> {
  const result = await runCodexCommand(['mcp', 'get', 'iranti', '--json'], {
    timeoutMs: SUBPROCESS_TIMEOUT_MS,
    allowNonZeroExit: true,
  })

  if (result.exitCode === 0 && result.stdout.trim()) {
    try {
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>
      const transport = parsed['transport']
      const registeredConfig =
        transport && typeof transport === 'object' && !Array.isArray(transport)
          ? (transport as Record<string, unknown>)
          : parsed

      return {
        irantiRegistered: true,
        registeredConfig,
        issue: null,
      }
    } catch {
      return {
        irantiRegistered: true,
        registeredConfig: { raw: result.stdout.trim() },
        issue: null,
      }
    }
  }

  const combined = collectOutput(result.stdout, result.stderr)
  if (looksNotRegistered(combined)) {
    return {
      irantiRegistered: false,
      registeredConfig: null,
      issue: 'Iranti MCP server not registered with Codex',
    }
  }

  return {
    irantiRegistered: false,
    registeredConfig: null,
    issue: combined || 'Unable to inspect Codex MCP registration',
  }
}

codexIntegrationRouter.get('/codex', async (_req: Request, res: Response) => {
  try {
    const codexResolution = await resolveCodexCli()
    const issues: string[] = []

    if (!codexResolution) {
      issues.push('Codex not found on PATH — install Codex first')
      res.json({
        codexInstalled: false,
        irantiRegistered: false,
        registeredConfig: null,
        issues,
      })
      return
    }

    const { irantiRegistered, registeredConfig, issue } = await checkIrantiRegistration()
    if (issue) issues.push(issue)

    res.json({
      codexInstalled: true,
      irantiRegistered,
      registeredConfig,
      issues,
    })
  } catch (err) {
    res.status(500).json({
      codexInstalled: false,
      irantiRegistered: false,
      registeredConfig: null,
      issues: [err instanceof Error ? err.message : String(err)],
    })
  }
})

codexIntegrationRouter.post('/codex', async (_req: Request, res: Response) => {
  try {
    const codexResolution = await resolveCodexCli()
    if (!codexResolution) {
      res.json({
        ok: false,
        output: '',
        error: 'Codex not found on PATH — install Codex first',
      })
      return
    }

    const result = await runIrantiCommand(['codex-setup'], { timeoutMs: SUBPROCESS_TIMEOUT_MS })
    const output = collectOutput(result.stdout, result.stderr)
    res.json({ ok: true, output })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.json({ ok: false, output: '', error: message })
  }
})

codexIntegrationRouter.delete('/codex', async (_req: Request, res: Response) => {
  try {
    const codexResolution = await resolveCodexCli()
    if (!codexResolution) {
      res.json({ ok: true, output: 'Codex is not installed — nothing to remove' })
      return
    }

    const outputs: string[] = []

    try {
      const uninstall = await runIrantiCommand(['uninstall', '--target', 'codex'], {
        timeoutMs: SUBPROCESS_TIMEOUT_MS,
        allowNonZeroExit: true,
      })
      const uninstallOutput = collectOutput(uninstall.stdout, uninstall.stderr)
      if (uninstallOutput) outputs.push(uninstallOutput)
    } catch (err) {
      outputs.push(err instanceof Error ? err.message : String(err))
    }

    const registration = await checkIrantiRegistration()
    if (!registration.irantiRegistered) {
      res.json({
        ok: true,
        output: outputs.join('\n') || 'Iranti was not registered with Codex',
      })
      return
    }

    const remove = await runCodexCommand(['mcp', 'remove', 'iranti'], {
      timeoutMs: SUBPROCESS_TIMEOUT_MS,
      allowNonZeroExit: true,
    })
    const removeOutput = collectOutput(remove.stdout, remove.stderr)
    if (removeOutput) outputs.push(removeOutput)

    if (remove.exitCode === 0 || looksNotRegistered(removeOutput)) {
      res.json({
        ok: true,
        output: outputs.join('\n') || 'Removed Iranti registration from Codex',
      })
      return
    }

    res.json({
      ok: false,
      output: outputs.join('\n'),
      error: 'Failed to remove Iranti from Codex.',
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})
