import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  killProcessTree,
  pipeWithPrefix,
  spawnClientDevServer,
  spawnServerWatcher,
} from './dev-process-utils.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const children = new Set()
let shuttingDown = false

function startChild(label, child) {
  children.add(child)

  if (child.stdout) pipeWithPrefix(child.stdout, `[${label}] `, process.stdout)
  if (child.stderr) pipeWithPrefix(child.stderr, `[${label}] `, process.stderr)

  child.on('exit', (code, signal) => {
    children.delete(child)
    if (shuttingDown) return

    shuttingDown = true
    void Promise.all(Array.from(children, other => killProcessTree(other)))

    if (signal) {
      process.stderr.write(`[dev] ${label} exited via ${signal}\n`)
      process.exit(1)
      return
    }

    process.stderr.write(`[dev] ${label} exited with code ${code ?? 0}\n`)
    process.exit(code ?? 0)
  })

  return child
}

const server = startChild(
  'server',
  spawnServerWatcher(projectRoot, {
    CONTROL_PLANE_PORT: '3002',
  })
)

const client = startChild('client', spawnClientDevServer(projectRoot))

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  process.stderr.write(`[dev] received ${signal}, shutting down children\n`)
  await Promise.all([killProcessTree(server), killProcessTree(client)])
  process.exit(0)
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})
process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
