/**
 * Codex Integration routes — CP-T095
 *
 * GET  /api/control-plane/integrations/codex
 *        Detect Codex on PATH, read global MCP config, check for Iranti registration.
 *        Returns: { codexInstalled, irantiRegistered, registeredConfig, issues }
 *
 * POST /api/control-plane/integrations/codex
 *        Run `iranti codex-setup` as a subprocess.
 *        Returns: { ok, output, error? }
 *
 * DELETE /api/control-plane/integrations/codex
 *        Run `iranti uninstall --target codex`, or fall back to removing the
 *        iranti key directly from the Codex config file.
 *        Returns: { ok, output?, error? }
 */

import { Router, Request, Response } from 'express'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execFile } from 'child_process'

export const codexIntegrationRouter = Router()

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUBPROCESS_TIMEOUT_MS = 5_000

// ---------------------------------------------------------------------------
// Codex config file resolution
// ---------------------------------------------------------------------------

/**
 * Returns the candidate paths to check for the Codex global MCP config.
 * Codex stores its config under ~/.codex/ (or %USERPROFILE%\.codex\ on Windows).
 * Two file names are possible: config.json and mcp.json.
 */
function getCodexConfigCandidates(): string[] {
  const base =
    process.platform === 'win32'
      ? (process.env.USERPROFILE ?? homedir())
      : homedir()
  const dir = join(base, '.codex')
  return [join(dir, 'config.json'), join(dir, 'mcp.json')]
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

function readJsonFile(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function writeJsonFile(filePath: string, data: Record<string, unknown>): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

// ---------------------------------------------------------------------------
// Subprocess helpers
// ---------------------------------------------------------------------------

/**
 * Run a command with execFile and return { stdout, stderr, exitCode }.
 * Always resolves — never rejects — so callers can inspect the result directly.
 */
function runCommand(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        const exitCode = err
          ? (err as NodeJS.ErrnoException & { code?: number }).code ?? null
          : 0
        resolve({
          stdout: typeof stdout === 'string' ? stdout.trim() : '',
          stderr: typeof stderr === 'string' ? stderr.trim() : '',
          exitCode: typeof exitCode === 'number' ? exitCode : null,
        })
      }
    )
    // Safety net in case execFile's timeout option doesn't fire
    setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
    }, timeoutMs + 500)
  })
}

// ---------------------------------------------------------------------------
// Codex detection
// ---------------------------------------------------------------------------

async function detectCodex(): Promise<boolean> {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  const result = await runCommand(cmd, ['codex'], SUBPROCESS_TIMEOUT_MS)
  // `which` / `where` exits 0 and prints a path if the binary is found
  return result.exitCode === 0 && result.stdout.length > 0
}

// ---------------------------------------------------------------------------
// Iranti registration check
// ---------------------------------------------------------------------------

interface IrantiRegistrationResult {
  irantiRegistered: boolean
  registeredConfig: Record<string, unknown> | null
  configFilePath: string | null
  parsedConfig: Record<string, unknown> | null
}

function checkIrantiRegistration(): IrantiRegistrationResult {
  const candidates = getCodexConfigCandidates()

  for (const candidate of candidates) {
    const config = readJsonFile(candidate)
    if (!config) continue

    // Codex may use either `mcpServers` or `mcp_servers` as the top-level key
    const servers =
      (config['mcpServers'] ?? config['mcp_servers']) as Record<string, unknown> | undefined

    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
      // The file exists and is valid JSON but has no MCP server block — keep
      // looking in the other candidate file before concluding "not registered"
      continue
    }

    const irantiEntry = servers['iranti']
    if (!irantiEntry) continue

    // Found an iranti entry
    return {
      irantiRegistered: true,
      registeredConfig:
        typeof irantiEntry === 'object' && !Array.isArray(irantiEntry)
          ? (irantiEntry as Record<string, unknown>)
          : { raw: irantiEntry },
      configFilePath: candidate,
      parsedConfig: config,
    }
  }

  // No file had an iranti entry — check if any config file actually exists
  const firstExisting = candidates.find((c) => existsSync(c))
  return {
    irantiRegistered: false,
    registeredConfig: null,
    configFilePath: firstExisting ?? null,
    parsedConfig: firstExisting ? readJsonFile(firstExisting) : null,
  }
}

// ---------------------------------------------------------------------------
// GET /integrations/codex
// ---------------------------------------------------------------------------

codexIntegrationRouter.get('/codex', async (_req: Request, res: Response) => {
  try {
    const codexInstalled = await detectCodex()
    const issues: string[] = []

    if (!codexInstalled) {
      issues.push('Codex not found on PATH — install Codex first')
      res.json({
        codexInstalled: false,
        irantiRegistered: false,
        registeredConfig: null,
        issues,
      })
      return
    }

    // Codex is installed — now check config
    const candidates = getCodexConfigCandidates()
    const anyConfigExists = candidates.some((c) => existsSync(c))

    if (!anyConfigExists) {
      issues.push('Codex config file not found')
      res.json({
        codexInstalled: true,
        irantiRegistered: false,
        registeredConfig: null,
        issues,
      })
      return
    }

    const { irantiRegistered, registeredConfig } = checkIrantiRegistration()

    if (!irantiRegistered) {
      issues.push('Iranti MCP server not registered with Codex')
    } else if (
      registeredConfig &&
      typeof registeredConfig['command'] === 'string' &&
      registeredConfig['command'] !== 'iranti'
    ) {
      issues.push('Iranti MCP server is registered but uses unexpected command')
    }

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
      issues: [`Internal error: ${String(err)}`],
    })
  }
})

// ---------------------------------------------------------------------------
// POST /integrations/codex — run `iranti codex-setup`
// ---------------------------------------------------------------------------

codexIntegrationRouter.post('/codex', async (_req: Request, res: Response) => {
  try {
    const result = await runCommand('iranti', ['codex-setup'], SUBPROCESS_TIMEOUT_MS)
    const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join('\n')
    const ok = result.exitCode === 0

    if (ok) {
      res.json({ ok: true, output: combinedOutput })
    } else {
      res.json({
        ok: false,
        output: combinedOutput,
        error: `iranti codex-setup exited with code ${result.exitCode ?? 'unknown'}`,
      })
    }
  } catch (err) {
    res.status(500).json({ ok: false, output: '', error: String(err) })
  }
})

// ---------------------------------------------------------------------------
// DELETE /integrations/codex — remove Iranti registration from Codex
// ---------------------------------------------------------------------------

codexIntegrationRouter.delete('/codex', async (_req: Request, res: Response) => {
  try {
    // First, try the official uninstall command
    const result = await runCommand(
      'iranti',
      ['uninstall', '--target', 'codex'],
      SUBPROCESS_TIMEOUT_MS
    )
    const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join('\n')

    if (result.exitCode === 0) {
      res.json({ ok: true, output: combinedOutput })
      return
    }

    // Check if the failure is because the subcommand doesn't exist (Iranti
    // version predates `uninstall --target codex`).  The error message will
    // contain "unknown" or the stderr will show usage/help text.
    const looksUnknown =
      combinedOutput.toLowerCase().includes('unknown') ||
      combinedOutput.toLowerCase().includes('unrecognized') ||
      combinedOutput.toLowerCase().includes('not a') ||
      result.exitCode === 1

    if (!looksUnknown) {
      // The command was recognised but failed for a real reason — surface the error
      res.json({
        ok: false,
        output: combinedOutput,
        error: `iranti uninstall exited with code ${result.exitCode ?? 'unknown'}`,
      })
      return
    }

    // Fallback: directly remove the `iranti` key from the Codex config file
    const { irantiRegistered, configFilePath, parsedConfig } = checkIrantiRegistration()

    if (!irantiRegistered || !configFilePath || !parsedConfig) {
      res.json({ ok: true, output: 'Iranti was not registered with Codex — nothing to remove' })
      return
    }

    // Determine which server map key to use
    const serverKey = 'mcpServers' in parsedConfig ? 'mcpServers' : 'mcp_servers'
    const servers = parsedConfig[serverKey] as Record<string, unknown>

    const updated: Record<string, unknown> = { ...servers }
    delete updated['iranti']

    const newConfig: Record<string, unknown> = { ...parsedConfig, [serverKey]: updated }

    try {
      writeJsonFile(configFilePath, newConfig)
      res.json({ ok: true, output: `Removed iranti entry from ${configFilePath}` })
    } catch (writeErr) {
      res.status(500).json({
        ok: false,
        error: `Failed to write updated config: ${String(writeErr)}`,
      })
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})
