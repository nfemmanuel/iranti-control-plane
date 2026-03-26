import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { killProcessTree, pipeWithPrefix, spawnServerWatcher } from './dev-process-utils.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const child = spawnServerWatcher(projectRoot, {
  CONTROL_PLANE_PORT: '3002',
})

if (child.stdout) pipeWithPrefix(child.stdout, '', process.stdout)
if (child.stderr) pipeWithPrefix(child.stderr, '', process.stderr)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

async function shutdown(signal) {
  await killProcessTree(child)
  process.stderr.write(`[dev:server] received ${signal}, shutting down\n`)
  process.exit(0)
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
