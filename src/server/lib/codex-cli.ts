import { execFile, spawn } from 'child_process'
import { access } from 'fs/promises'
import { constants } from 'fs'
import { extname } from 'path'
import { promisify } from 'util'
import { dirnamePortable, joinPortable, resolvePortable } from './path-utils.js'

const execFileAsync = promisify(execFile)

export type CodexCliSource = 'env' | 'path'

export interface CodexCliResolution {
  command: string
  args: string[]
  displayPath: string
  source: CodexCliSource
}

function candidateFromEnv(): string | null {
  const raw =
    process.env['CODEX_CLI_PATH']?.trim() ??
    process.env['IRANTI_CP_CODEX_CLI']?.trim() ??
    ''
  return raw || null
}

async function firstPathHit(): Promise<string | null> {
  const checker = process.platform === 'win32' ? 'where' : 'which'

  return new Promise((resolveResult) => {
    const child = spawn(checker, ['codex'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let stdout = ''
    let settled = false

    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      resolveResult(value)
    }

    const timer = setTimeout(() => {
      child.kill()
      finish(null)
    }, 3000)

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })

    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        finish(null)
        return
      }
      const first = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)
      finish(first ?? null)
    })

    child.on('error', () => {
      clearTimeout(timer)
      finish(null)
    })
  })
}

async function normalizeInvocation(candidate: string, source: CodexCliSource): Promise<CodexCliResolution | null> {
  const normalized = resolvePortable(candidate)
  const lower = normalized.toLowerCase()
  const extension = extname(lower)

  if (process.platform === 'win32' && !extension) {
    for (const suffix of ['.exe', '.cmd', '.bat', '.ps1']) {
      const sibling = `${normalized}${suffix}`
      try {
        await access(sibling, constants.F_OK)
        return normalizeInvocation(sibling, source)
      } catch {
        // try next sibling
      }
    }
  }

  if (lower.endsWith('.js') || lower.endsWith('.cjs') || lower.endsWith('.mjs')) {
    return {
      command: process.execPath,
      args: [normalized],
      displayPath: normalized,
      source,
    }
  }

  if (process.platform === 'win32' && (lower.endsWith('.cmd') || lower.endsWith('.bat'))) {
    const installDir = dirnamePortable(normalized)
    const cliEntry = joinPortable(installDir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    try {
      await access(cliEntry, constants.F_OK)
      return {
        command: process.execPath,
        args: [cliEntry],
        displayPath: normalized,
        source,
      }
    } catch {
      const exeSibling = normalized.replace(/\.(cmd|bat)$/i, '.exe')
      try {
        await access(exeSibling, constants.F_OK)
        return {
          command: exeSibling,
          args: [],
          displayPath: exeSibling,
          source,
        }
      } catch {
        return null
      }
    }
  }

  return {
    command: normalized,
    args: [],
    displayPath: normalized,
    source,
  }
}

export async function resolveCodexCli(): Promise<CodexCliResolution | null> {
  const explicit = candidateFromEnv()
  if (explicit) {
    const resolved = await normalizeInvocation(explicit, 'env')
    if (resolved) return resolved
  }

  const onPath = await firstPathHit()
  if (onPath) {
    const resolved = await normalizeInvocation(onPath, 'path')
    if (resolved) return resolved
  }

  return null
}

export async function runCodexCommand(
  cliArgs: string[],
  options?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; allowNonZeroExit?: boolean }
): Promise<{ resolution: CodexCliResolution; stdout: string; stderr: string; exitCode: number }> {
  const resolution = await resolveCodexCli()
  if (!resolution) {
    throw new Error('codex CLI could not be resolved from CODEX_CLI_PATH, PATH, or bundled install')
  }

  try {
    const result = await execFileAsync(
      resolution.command,
      [...resolution.args, ...cliArgs],
      {
        cwd: options?.cwd,
        timeout: options?.timeoutMs ?? 10000,
        env: options?.env,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 4,
      }
    )

    return {
      resolution,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: 0,
    }
  } catch (error) {
    const stdout = typeof (error as { stdout?: unknown }).stdout === 'string'
      ? (error as { stdout: string }).stdout
      : ''
    const stderr = typeof (error as { stderr?: unknown }).stderr === 'string'
      ? (error as { stderr: string }).stderr
      : ''
    const exitCodeValue = (error as { code?: unknown }).code
    const exitCode = typeof exitCodeValue === 'number' ? exitCodeValue : 1

    if (options?.allowNonZeroExit) {
      return {
        resolution,
        stdout,
        stderr,
        exitCode,
      }
    }

    throw error
  }
}
