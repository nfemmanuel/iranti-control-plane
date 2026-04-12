/**
 * local-operator-tools.ts — Sandboxed command runner and native path picker.
 *
 * Provides two capabilities for the Control Plane UI:
 *   1. runLocalCommand — executes a small whitelist of approved shell commands
 *      (iranti CLI commands, npm run migrate, npm install -g iranti@x) on the
 *      operator's machine. All other commands are rejected with a clear error.
 *   2. pickLocalPath — opens the OS-native file/folder picker (PowerShell on
 *      Windows, osascript on macOS, zenity/kdialog on Linux) and returns the
 *      selected path.
 *
 * Security contract: nothing in this module spawns arbitrary user input.
 * parseRunnableCommand() enforces the whitelist before any process is started.
 */

import { spawn } from 'child_process'
import { access, constants, stat } from 'fs/promises'
import { delimiter, join } from 'path'

export type LocalPathKind = 'directory' | 'file'

export interface PickLocalPathOptions {
  kind: LocalPathKind
  title?: string
  startPath?: string | null
}

export interface PickLocalPathResult {
  canceled: boolean
  path: string | null
  method: string
  error?: string
}

export interface RunLocalCommandOptions {
  command: string
  cwd?: string | null
}

export interface RunLocalCommandResult {
  ok: boolean
  command: string
  cwd: string | null
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
}

export interface ParsedCommand {
  executable: string
  args: string[]
}

const RUNNABLE_NPM_SCRIPTS = new Set(['migrate'])
const RUNNABLE_GLOBAL_NPM_PACKAGES = [/^iranti(?:@[\w.-]+)?$/i]

function spawnAndCollect(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const shouldUseCmdWrapper = process.platform === 'win32' && /\.cmd$/i.test(command)
    const child = shouldUseCmdWrapper
      ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command, ...args], {
          cwd: options.cwd,
          shell: false,
          windowsHide: true,
          env: process.env,
        })
      : spawn(command, args, {
          cwd: options.cwd,
          shell: false,
          windowsHide: true,
          env: process.env,
        })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill()
        }, options.timeoutMs)
      : null

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (timeout) clearTimeout(timeout)
      if (timedOut) {
        stderr = `${stderr}${stderr ? '\n' : ''}Timed out after ${options.timeoutMs}ms`
      }
      resolve({ code, stdout, stderr })
    })
  })
}

function escapePowerShellLiteral(value: string): string {
  return value.replace(/'/g, "''")
}

function resolveWindowsCommand(executable: string): string {
  if (process.platform !== 'win32') return executable
  switch (executable.toLowerCase()) {
    case 'npm':
      return 'npm.cmd'
    case 'iranti':
      return 'iranti.cmd'
    default:
      return executable
  }
}

function splitEnvPath(pathValue: string | undefined): string[] {
  return (pathValue ?? '')
    .split(delimiter)
    .map((part) => part.trim())
    .filter(Boolean)
}

async function hasExecutableOnPath(executable: string): Promise<boolean> {
  const resolved = resolveWindowsCommand(executable)
  const candidates = process.platform === 'win32' && !resolved.includes('.')
    ? [resolved, `${resolved}.exe`, `${resolved}.cmd`]
    : [resolved]

  for (const dir of splitEnvPath(process.env['PATH'])) {
    for (const candidate of candidates) {
      try {
        await access(join(dir, candidate), constants.F_OK)
        return true
      } catch {
        // continue
      }
    }
  }

  return false
}

export function tokenizeCommand(command: string): string[] {
  const input = command.trim()
  if (!input) return []

  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!

    if (quote) {
      if (char === quote) {
        quote = null
        continue
      }
      if (char === '\\' && quote === '"' && i + 1 < input.length && input[i + 1] === '"') {
        current += '"'
        i += 1
        continue
      }
      current += char
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }

  if (quote) {
    throw new Error('Command contains an unterminated quote.')
  }
  if (current) tokens.push(current)
  return tokens
}

export function parseRunnableCommand(command: string): ParsedCommand {
  const tokens = tokenizeCommand(command)
  if (tokens.length === 0) {
    throw new Error('Command is empty.')
  }

  const executable = tokens[0]!.toLowerCase()
  const args = tokens.slice(1)

  if (executable === 'iranti') {
    return { executable, args }
  }

  if (executable === 'npm' && args[0] === 'run' && args.length === 2 && RUNNABLE_NPM_SCRIPTS.has(args[1]!)) {
    return { executable, args }
  }

  if (
    executable === 'npm' &&
    args[0] === 'install' &&
    args[1] === '-g' &&
    args.length === 3 &&
    RUNNABLE_GLOBAL_NPM_PACKAGES.some((pattern) => pattern.test(args[2]!))
  ) {
    return { executable, args }
  }

  throw new Error('This command can be copied from the control plane, but it is not approved for in-app execution.')
}

async function validateCwd(cwd: string | null | undefined): Promise<string | undefined> {
  if (!cwd) return undefined
  const pathToUse = cwd.trim()
  if (!pathToUse) return undefined
  const stats = await stat(pathToUse)
  if (!stats.isDirectory()) {
    throw new Error('cwd must be an existing directory.')
  }
  return pathToUse
}

export async function runLocalCommand(options: RunLocalCommandOptions): Promise<RunLocalCommandResult> {
  const parsed = parseRunnableCommand(options.command)
  const cwd = await validateCwd(options.cwd)
  const start = Date.now()
  const executable = resolveWindowsCommand(parsed.executable)
  const isGlobalNpmInstall =
    parsed.executable === 'npm' &&
    parsed.args[0] === 'install' &&
    parsed.args[1] === '-g'
  const result = await spawnAndCollect(executable, parsed.args, {
    cwd,
    timeoutMs: isGlobalNpmInstall ? 300_000 : 30_000,
  })
  return {
    ok: result.code === 0,
    command: options.command,
    cwd: cwd ?? null,
    exitCode: result.code,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    durationMs: Date.now() - start,
  }
}

async function pickWithWindowsDialog(options: PickLocalPathOptions): Promise<PickLocalPathResult> {
  const title = escapePowerShellLiteral(options.title?.trim() || (options.kind === 'directory' ? 'Select folder' : 'Select file'))
  const startPath = options.startPath?.trim() ? escapePowerShellLiteral(options.startPath.trim()) : ''

  const script = options.kind === 'directory'
    ? [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
        `$dialog.Description = '${title}'`,
        '$dialog.UseDescriptionForTitle = $true',
        startPath ? `$dialog.SelectedPath = '${startPath}'` : '',
        'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }',
      ].filter(Boolean).join('; ')
    : [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
        `$dialog.Title = '${title}'`,
        startPath ? `$dialog.InitialDirectory = [System.IO.Path]::GetDirectoryName('${startPath}')` : '',
        'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }',
      ].filter(Boolean).join('; ')

  const result = await spawnAndCollect('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { timeoutMs: 120_000 })
  const selected = result.stdout.trim()
  return {
    canceled: selected === '',
    path: selected || null,
    method: 'powershell',
    ...(result.code !== 0 && !selected ? { error: result.stderr.trim() || 'Native picker failed.' } : {}),
  }
}

async function pickWithMacDialog(options: PickLocalPathOptions): Promise<PickLocalPathResult> {
  const title = options.title?.trim() || (options.kind === 'directory' ? 'Select folder' : 'Select file')
  const script = options.kind === 'directory'
    ? `POSIX path of (choose folder with prompt "${title.replace(/"/g, '\\"')}")`
    : `POSIX path of (choose file with prompt "${title.replace(/"/g, '\\"')}")`
  const result = await spawnAndCollect('osascript', ['-e', script], { timeoutMs: 120_000 })
  const combinedError = `${result.stdout}\n${result.stderr}`.toLowerCase()
  if (combinedError.includes('user canceled') || combinedError.includes('user cancelled')) {
    return { canceled: true, path: null, method: 'osascript' }
  }
  const selected = result.stdout.trim()
  return {
    canceled: selected === '',
    path: selected || null,
    method: 'osascript',
    ...(result.code !== 0 && !selected ? { error: result.stderr.trim() || 'Native picker failed.' } : {}),
  }
}

async function pickWithLinuxDialog(options: PickLocalPathOptions): Promise<PickLocalPathResult> {
  const title = options.title?.trim() || (options.kind === 'directory' ? 'Select folder' : 'Select file')
  const startPath = options.startPath?.trim() || ''

  if (await hasExecutableOnPath('zenity')) {
    const args = options.kind === 'directory'
      ? ['--file-selection', '--directory', '--title', title]
      : ['--file-selection', '--title', title]
    if (startPath) args.push('--filename', startPath)
    const result = await spawnAndCollect('zenity', args, { timeoutMs: 120_000 })
    const selected = result.stdout.trim()
    return {
      canceled: selected === '',
      path: selected || null,
      method: 'zenity',
      ...(result.code !== 0 && !selected ? { error: result.stderr.trim() || 'Native picker failed.' } : {}),
    }
  }

  if (await hasExecutableOnPath('kdialog')) {
    const args = options.kind === 'directory'
      ? ['--getexistingdirectory', startPath || '.', '--title', title]
      : ['--getopenfilename', startPath || '.', '--title', title]
    const result = await spawnAndCollect('kdialog', args, { timeoutMs: 120_000 })
    const selected = result.stdout.trim()
    return {
      canceled: selected === '',
      path: selected || null,
      method: 'kdialog',
      ...(result.code !== 0 && !selected ? { error: result.stderr.trim() || 'Native picker failed.' } : {}),
    }
  }

  return {
    canceled: true,
    path: null,
    method: 'none',
    error: 'No supported native picker is available on this machine.',
  }
}

export async function pickLocalPath(options: PickLocalPathOptions): Promise<PickLocalPathResult> {
  switch (process.platform) {
    case 'win32':
      return pickWithWindowsDialog(options)
    case 'darwin':
      return pickWithMacDialog(options)
    default:
      return pickWithLinuxDialog(options)
  }
}
