import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { killRepoDevProcesses, findRepoDevProcessIds } from './dev-process-utils.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run')

async function main() {
  const pids = await findRepoDevProcessIds(projectRoot)

  if (pids.length === 0) {
    console.log('[dev:reset] No stale control-plane dev processes found.')
    return
  }

  console.log(`[dev:reset] Found ${pids.length} stale process${pids.length === 1 ? '' : 'es'}: ${pids.join(', ')}`)

  if (dryRun) {
    console.log('[dev:reset] Dry run only. Re-run without --dry-run to stop them.')
    return
  }

  const result = await killRepoDevProcesses(projectRoot)
  if (result.pids.length === 0) {
    console.log('[dev:reset] No processes needed to be stopped.')
    return
  }

  console.log(`[dev:reset] Stopped ${result.pids.length} process${result.pids.length === 1 ? '' : 'es'}.`)
}

main().catch((error) => {
  console.error('[dev:reset] Failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
