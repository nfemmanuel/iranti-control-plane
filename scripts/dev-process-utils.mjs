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
