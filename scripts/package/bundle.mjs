#!/usr/bin/env node
/**
 * scripts/package/bundle.mjs
 *
 * Bundles the TypeScript server into a single ESM file suitable for
 * Node.js Single Executable Applications (SEA).
 *
 * Node SEA supports ESM as of Node 21.7.1+. We target Node 22+ and use
 * ESM format to preserve top-level await (which is not supported in CJS).
 *
 * This script uses esbuild to:
 *   - Transpile TypeScript to JS
 *   - Bundle all dependencies inline (except pg-native — optional native addon)
 *   - Emit ESM (format=esm) targeting Node 22
 *
 * Prerequisites:
 *   esbuild must be available. It is a devDependency of src/server.
 *   Run: npm install --prefix src/server
 *
 * Output: dist/server/bundle.mjs
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
const OUTFILE = resolve(ROOT, 'dist/server/bundle.mjs')

// On Windows, .bin/esbuild is a .cmd shim — use the native exe directly
// to avoid shell quoting issues with execFileSync.
const ESBUILD_CMD = resolve(ROOT, 'src/server/node_modules/.bin/esbuild.cmd')
const ESBUILD_EXE = resolve(ROOT, 'src/server/node_modules/@esbuild/win32-x64/esbuild.exe')
const ESBUILD = process.platform === 'win32'
  ? (existsSync(ESBUILD_EXE) ? ESBUILD_EXE : ESBUILD_CMD)
  : resolve(ROOT, 'src/server/node_modules/.bin/esbuild')

// Ensure esbuild is installed
if (!existsSync(ESBUILD)) {
  console.error('[bundle] esbuild not found at:', ESBUILD)
  console.error('[bundle] Run: npm install --prefix src/server')
  process.exit(1)
}

// Ensure output directory exists
mkdirSync(resolve(ROOT, 'dist/server'), { recursive: true })

// Use execFileSync with an args array to avoid Windows shell quoting issues.
const args = [
  ENTRY,
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--target=node22',
  `--outfile=${OUTFILE}`,
  // pg-native is an optional peer dependency that requires libpq native
  // headers. It is not installed in this project. Mark as external so
  // esbuild skips it cleanly rather than erroring.
  '--external:pg-native',
  // Rollup native addons are devDependencies (used by Vite, not the server).
  // Mark them external to avoid bundling errors.
  '--external:@rollup/rollup-linux-x64-gnu',
  '--external:@rollup/rollup-linux-x64-musl',
  '--external:@rollup/rollup-win32-x64-gnu',
  '--external:@rollup/rollup-win32-x64-msvc',
  '--external:@rollup/rollup-darwin-x64',
  '--external:@rollup/rollup-darwin-arm64',
  '--log-level=info',
]

console.log('[bundle] Running esbuild (ESM format)...')
console.log('[bundle] Entry:', ENTRY)
console.log('[bundle] Output:', OUTFILE)

try {
  execFileSync(ESBUILD, args, { stdio: 'inherit', cwd: ROOT })
  console.log('[bundle] Done. ESM bundle written to:', OUTFILE)
} catch (err) {
  console.error('[bundle] esbuild failed:', err.message)
  process.exit(1)
}
