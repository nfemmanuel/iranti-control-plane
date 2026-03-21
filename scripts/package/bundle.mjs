#!/usr/bin/env node
/**
 * scripts/package/bundle.js
 *
 * Bundles the ESM TypeScript server into a single CJS file suitable for
 * Node.js Single Executable Applications (SEA).
 *
 * Node SEA requires a CommonJS entry point — it does not support ESM input.
 * This script uses esbuild to:
 *   - Transpile TypeScript to JS
 *   - Bundle all dependencies inline (except pg-native — optional native addon)
 *   - Emit CommonJS (format=cjs) targeting Node 22
 *   - Inject an import.meta.url polyfill so that CJS code reconstructed
 *     from __filename behaves correctly
 *
 * Prerequisites:
 *   esbuild must be available. It is a devDependency of src/server.
 *   Run: npm install --prefix src/server
 *
 * Output: dist/server/bundle.cjs
 *
 * Usage:
 *   node scripts/package/bundle.js
 */

import { execSync } from 'child_process'
import { mkdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '../../')
const ENTRY = resolve(ROOT, 'src/server/index.ts')
const OUTFILE = resolve(ROOT, 'dist/server/bundle.cjs')
const ESBUILD = resolve(ROOT, 'src/server/node_modules/.bin/esbuild')

// Ensure esbuild is installed
if (!existsSync(ESBUILD)) {
  console.error('[bundle] esbuild not found at:', ESBUILD)
  console.error('[bundle] Run: npm install --prefix src/server')
  process.exit(1)
}

// Ensure output directory exists
mkdirSync(resolve(ROOT, 'dist/server'), { recursive: true })

// The import.meta.url polyfill injects a CJS-compatible __importmeta_url
// variable so that any import.meta.url references in the transpiled code
// resolve to the correct file:// URL for __filename.
const banner = `
const __importmeta_url = require('url').pathToFileURL(__filename).href;
`.trim()

const cmd = [
  ESBUILD,
  ENTRY,
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=node22',
  '--outfile=' + OUTFILE,
  // import.meta.url polyfill
  `--banner:js=${banner}`,
  '--define:import.meta.url=__importmeta_url',
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
].join(' ')

console.log('[bundle] Running esbuild...')
console.log('[bundle] Entry:', ENTRY)
console.log('[bundle] Output:', OUTFILE)

try {
  execSync(cmd, { stdio: 'inherit', cwd: ROOT })
  console.log('[bundle] Done. CJS bundle written to:', OUTFILE)
} catch (err) {
  console.error('[bundle] esbuild failed:', err.message)
  process.exit(1)
}
