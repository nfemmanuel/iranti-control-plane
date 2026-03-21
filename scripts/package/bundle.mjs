#!/usr/bin/env node
/**
 * scripts/package/bundle.mjs
 *
 * Bundles the TypeScript server into a single CJS file suitable for
 * Node.js Single Executable Applications (SEA).
 *
 * Node SEA embeds CommonJS scripts only (ESM import statements are not
 * supported inside the embedding runtime). We therefore output CJS.
 * Top-level await was removed from index.ts and replaced with a main()
 * async function so CJS output works without a wrapper IIFE.
 *
 * Prerequisites:
 *   esbuild must be available. It is a devDependency of src/server.
 *   Run: npm install --prefix src/server
 *
 * Output: dist/server/bundle.cjs
 *
 * Usage:
 *   node scripts/package/bundle.mjs
 */

import { execFileSync } from 'child_process'
import { mkdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '../../')
const ENTRY = resolve(ROOT, 'src/server/index.ts')
const OUTFILE = resolve(ROOT, 'dist/server/bundle.cjs')

// On Windows, .bin/esbuild is a .cmd shim — use the native exe directly
// to avoid shell quoting issues with execFileSync.
const ESBUILD_EXE = resolve(ROOT, 'src/server/node_modules/@esbuild/win32-x64/esbuild.exe')
const ESBUILD_BIN = resolve(ROOT, 'src/server/node_modules/.bin/esbuild')
const ESBUILD = process.platform === 'win32' && existsSync(ESBUILD_EXE)
  ? ESBUILD_EXE
  : ESBUILD_BIN

if (!existsSync(ESBUILD)) {
  console.error('[bundle] esbuild not found. Run: npm install --prefix src/server')
  process.exit(1)
}

mkdirSync(resolve(ROOT, 'dist/server'), { recursive: true })

// import.meta.url polyfill for CJS: any bundled code that references
// import.meta.url gets the CJS-compatible equivalent via __filename.
const banner = `const __importmeta_url = require('url').pathToFileURL(__filename).href;`

const args = [
  ENTRY,
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=node22',
  `--outfile=${OUTFILE}`,
  `--banner:js=${banner}`,
  '--define:import.meta.url=__importmeta_url',
  '--external:pg-native',
  '--external:@rollup/rollup-linux-x64-gnu',
  '--external:@rollup/rollup-linux-x64-musl',
  '--external:@rollup/rollup-win32-x64-gnu',
  '--external:@rollup/rollup-win32-x64-msvc',
  '--external:@rollup/rollup-darwin-x64',
  '--external:@rollup/rollup-darwin-arm64',
  '--log-level=info',
]

console.log('[bundle] Running esbuild (CJS format)...')
console.log('[bundle] Entry:', ENTRY)
console.log('[bundle] Output:', OUTFILE)

try {
  execFileSync(ESBUILD, args, { stdio: 'inherit', cwd: ROOT })
  console.log('[bundle] Done. CJS bundle written to:', OUTFILE)
} catch (err) {
  console.error('[bundle] esbuild failed:', err.message)
  process.exit(1)
}
