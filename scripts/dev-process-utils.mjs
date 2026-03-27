import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

function npmBinRoot(projectRoot) {
  return resolve(projectRoot, 'node_modules')
}

export function spawnServerWatcher(projectRoot, envOverrides = {}) {
  const tsxCli = resolve(
    npmBinRoot(resolve(projectRoot, 'src/server')),
    'tsx',
    'dist',
    'cli.mjs'
  )
  return spawn(process.execPath, [tsxCli, 'watch', 'index.ts'], {
    cwd: resolve(projectRoot, 'src/server'),
    env: {
      ...process.env,
      IRANTI_CP_ASSETS_DIR: resolve(projectRoot, 'public', 'control-plane'),
      ...envOverrides,
    },
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

export function spawnClientDevServer(projectRoot, envOverrides = {}) {
  const viteCli = resolve(
    npmBinRoot(resolve(projectRoot, 'src/client')),
    'vite',
    'bin',
    'vite.js'
  )
  return spawn(process.execPath, [viteCli], {
    cwd: resolve(projectRoot, 'src/client'),
    env: {
      ...process.env,
      ...envOverrides,
    },
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

export function pipeWithPrefix(stream, prefix, target) {
  let buffered = ''
  stream.on('data', chunk => {
    buffered += String(chunk)
    const lines = buffered.split(/\r?\n/)
    buffered = lines.pop() ?? ''
    for (const line of lines) {
      target.write(`${prefix}${line}\n`)
    }
  })
  stream.on('end', () => {
    if (buffered) {
      target.write(`${prefix}${buffered}\n`)
    }
  })
}

export async function killProcessTree(child) {
  if (!child || child.killed) return

  const pid = child.pid
  if (!pid) return

  if (process.platform === 'win32') {
    await new Promise(resolvePromise => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.on('exit', () => resolvePromise())
      killer.on('error', () => resolvePromise())
    })
    return
  }

  try {
    child.kill('SIGTERM')
  } catch {
    return
  }
}

function escapeForPowerShellSingleQuotedString(value) {
  return value.replace(/'/g, "''")
}

async function runPowerShell(command) {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', rejectResult)
    child.on('exit', (code) => {
      if (code === 0) {
        resolveResult({ stdout, stderr })
        return
      }
      rejectResult(new Error(stderr.trim() || `PowerShell exited with code ${code ?? 1}`))
    })
  })
}

async function runPosix(command, args) {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', rejectResult)
    child.on('exit', (code) => {
      if (code === 0) {
        resolveResult({ stdout, stderr })
        return
      }
      rejectResult(new Error(stderr.trim() || `${command} exited with code ${code ?? 1}`))
    })
  })
}

export async function findRepoDevProcessIds(projectRoot) {
  const normalizedRoot = resolve(projectRoot)

  if (process.platform === 'win32') {
    const escapedRoot = escapeForPowerShellSingleQuotedString(normalizedRoot)
    const script = [
      `$root = '${escapedRoot}'`,
      '$processes = Get-CimInstance Win32_Process | Where-Object {',
      '  $_.CommandLine -and',
      '  $_.CommandLine -like "*$root*" -and',
      '  (($_.CommandLine -match "dev\\.mjs") -or ($_.CommandLine -match "dev-server\\.mjs") -or ($_.CommandLine -match "concurrently") -or ($_.CommandLine -match "tsx") -or ($_.CommandLine -match "vite"))',
      '}',
      '$processes | ForEach-Object { $_.ProcessId }',
    ].join('\n')
    const { stdout } = await runPowerShell(script)
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => Number.parseInt(line, 10))
      .filter((pid) => Number.isFinite(pid))
  }

  const patterns = ['dev.mjs', 'dev-server.mjs', 'concurrently', 'tsx watch', 'vite']
  const { stdout } = await runPosix('ps', ['-eo', 'pid=,command='])
  const matches = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const spaceIndex = trimmed.indexOf(' ')
    if (spaceIndex === -1) continue
    const pid = Number.parseInt(trimmed.slice(0, spaceIndex), 10)
    const command = trimmed.slice(spaceIndex + 1)
    if (!Number.isFinite(pid)) continue
    if (!command.includes(normalizedRoot)) continue
    if (patterns.some((pattern) => command.includes(pattern))) {
      matches.push(pid)
    }
  }
  return matches
}

export async function killRepoDevProcesses(projectRoot) {
  const pids = await findRepoDevProcessIds(projectRoot)
  if (pids.length === 0) {
    return { pids: [] }
  }

  if (process.platform === 'win32') {
    const commands = pids.map((pid) => `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`)
    await runPowerShell(commands.join('; '))
    return { pids }
  }

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // ignore
    }
  }
  return { pids }
}
