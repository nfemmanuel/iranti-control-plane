import { execFile, spawn } from 'child_process'
import { access } from 'fs/promises'
import { constants } from 'fs'
import { basename, dirname, extname, join, resolve } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export type IrantiCliSource = 'env' | 'path' | 'repo-local'

export interface IrantiCliResolution {
  command: string
  args: string[]
  displayPath: string
  source: IrantiCliSource
}

function candidateFromEnv(): string | null {
  const raw =
    process.env['IRANTI_CLI_PATH']?.trim() ??
    process.env['IRANTI_CP_IRANTI_CLI']?.trim() ??
    ''
  return raw || null
}

async function firstPathHit(): Promise<string | null> {
  const checker = process.platform === 'win32' ? 'where' : 'which'

  return new Promise((resolveResult) => {
    const child = spawn(checker, ['iranti'], { stdio: ['ignore', 'pipe', 'ignore'] })
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

async function repoLocalBin(): Promise<string | null> {
  const candidates = [
    resolve(process.cwd(), '..', 'iranti', 'bin', 'iranti.js'),
    resolve(process.cwd(), '..', '..', 'iranti', 'bin', 'iranti.js'),
    resolve(process.cwd(), 'node_modules', 'iranti', 'bin', 'iranti.js'),
  ]

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.F_OK)
      return candidate
    } catch {
      // try next
    }
  }

  return null
}

async function normalizeInvocation(candidate: string, source: IrantiCliSource): Promise<IrantiCliResolution | null> {
  const normalized = resolve(candidate)
  const lower = normalized.toLowerCase()
  const extension = extname(lower)

  if (process.platform === 'win32' && !extension) {
    for (const suffix of ['.cmd', '.exe', '.bat', '.ps1']) {
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

  if (process.platform === 'win32' && lower.endsWith('.cmd')) {
    const installDir = dirname(normalized)
    const cliEntry = join(installDir, 'node_modules', 'iranti', 'bin', 'iranti.js')
    try {
      await access(cliEntry, constants.F_OK)
      return {
        command: process.execPath,
        args: [cliEntry],
        displayPath: normalized,
        source,
      }
    } catch {
      return null
    }
  }

  return {
    command: normalized,
    args: [],
    displayPath: normalized,
    source,
  }
}

export async function resolveIrantiCli(): Promise<IrantiCliResolution | null> {
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

  const repoLocal = await repoLocalBin()
  if (repoLocal) {
    const resolved = await normalizeInvocation(repoLocal, 'repo-local')
    if (resolved) return resolved
  }

  return null
}

export async function runIrantiCommand(
  cliArgs: string[],
  options?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; allowNonZeroExit?: boolean }
): Promise<{ resolution: IrantiCliResolution; stdout: string; stderr: string }> {
  const resolution = await resolveIrantiCli()
  if (!resolution) {
    throw new Error('iranti CLI could not be resolved from IRANTI_CLI_PATH, PATH, or repo-local fallback')
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
    }
  } catch (error) {
    if (options?.allowNonZeroExit) {
      const stdout = typeof (error as { stdout?: unknown }).stdout === 'string'
        ? (error as { stdout: string }).stdout
        : ''
      const stderr = typeof (error as { stderr?: unknown }).stderr === 'string'
        ? (error as { stderr: string }).stderr
        : ''
      if (stdout.trim()) {
        return {
          resolution,
          stdout,
          stderr,
        }
      }
    }
    throw error
  }
}

export async function runIrantiJson<T>(
  cliArgs: string[],
  options?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; allowNonZeroExit?: boolean }
): Promise<{ resolution: IrantiCliResolution; stdout: string; stderr: string; json: T }> {
  const result = await runIrantiCommand(cliArgs, options)

  try {
    return {
      ...result,
      json: JSON.parse(result.stdout) as T,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse JSON from ${basename(result.resolution.displayPath)}: ${message}`)
  }
}
