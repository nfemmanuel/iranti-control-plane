#!/usr/bin/env node
/**
 * scripts/package/build-sea.js
 *
 * Produces the platform-specific SEA binary from the CJS bundle.
 * Steps:
 *   1. Generate the SEA blob from dist/server/bundle.cjs using sea-config.json
 *   2. Copy the platform Node.js binary to dist/sea/iranti-cp[.exe]
 *   3. Remove the existing code signature from the copied binary (macOS only)
 *   4. Inject the SEA blob into the binary using postject
 *   5. Ad-hoc code sign the result (macOS only — codesign --sign -)
 *
 * Prerequisites:
 *   - postject: npm install -g postject  OR  npx postject
 *     (postject injects the blob into the binary's NOTES section on Linux/Windows
 *      and into __MACOS,__IRANTI on macOS via --macho-segment-name)
 *
 * Platform notes:
 *   - Windows: No signing step. SmartScreen will show "Windows protected your PC"
 *     on first run — users bypass via "More info" → "Run anyway". Document in
 *     release notes and Getting Started screen.
 *   - macOS: Ad-hoc signing (codesign --sign -) is applied. This reduces
 *     Gatekeeper quarantine friction on subsequent launches after the initial
 *     right-click → Open bypass. Full Developer ID signing ($99/year) is the
 *     post-launch upgrade path.
 *   - Linux: No signing required.
 *
 * Usage:
 *   node scripts/package/build-sea.js
 */

import { execSync, execFileSync } from 'child_process'
import { copyFileSync, mkdirSync, chmodSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '../../')

const PLATFORM = process.platform // 'win32' | 'darwin' | 'linux'
const BINARY_EXT = PLATFORM === 'win32' ? '.exe' : ''
const NODE_BIN = process.execPath
const SEA_CONFIG = resolve(__dirname, 'sea-config.json')
const BLOB_OUT = resolve(ROOT, 'dist/sea/iranti-cp.blob')
const BINARY_OUT = resolve(ROOT, `dist/sea/iranti-cp${BINARY_EXT}`)

mkdirSync(resolve(ROOT, 'dist/sea'), { recursive: true })

// ---- Step 1: Generate SEA blob ----
console.log('[build-sea] Generating SEA blob...')
execFileSync(NODE_BIN, ['--experimental-sea-config', SEA_CONFIG], {
  stdio: 'inherit',
  cwd: ROOT,
})
console.log('[build-sea] Blob written to:', BLOB_OUT)

// ---- Step 2: Copy Node binary ----
console.log('[build-sea] Copying Node binary:', NODE_BIN, '->', BINARY_OUT)
copyFileSync(NODE_BIN, BINARY_OUT)
if (PLATFORM !== 'win32') {
  chmodSync(BINARY_OUT, 0o755)
}

// ---- Step 3: Remove existing code signature (macOS only) ----
if (PLATFORM === 'darwin') {
  console.log('[build-sea] Removing existing code signature (macOS)...')
  try {
    execSync(`codesign --remove-signature "${BINARY_OUT}"`, { stdio: 'inherit' })
  } catch {
    // Non-fatal — unsigned binaries will not have a signature to remove.
    console.warn('[build-sea] codesign --remove-signature returned non-zero (binary may be unsigned — continuing)')
  }
}

// ---- Step 4: Inject SEA blob with postject ----
// postject is used to inject the SEA blob into the binary.
// Install: npm install -g postject  OR  npx postject
// The --sentinel-fuse flag is required by Node SEA to locate the blob boundary.

console.log('[build-sea] Injecting SEA blob with postject...')

const postjectArgs = [
  BINARY_OUT,
  'NODE_SEA_BLOB',
  BLOB_OUT,
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
]

if (PLATFORM === 'darwin') {
  // macOS Mach-O binaries use a segment/section model.
  // Node SEA on macOS expects the blob in __MACOS,__IRANTI.
  postjectArgs.push('--macho-segment-name', '__MACOS')
}

try {
  // Try npx postject first (no global install required in CI)
  execFileSync('npx', ['postject', ...postjectArgs], {
    stdio: 'inherit',
    cwd: ROOT,
    shell: PLATFORM === 'win32',
  })
} catch {
  // Fallback: try global postject
  try {
    execFileSync('postject', postjectArgs, {
      stdio: 'inherit',
      cwd: ROOT,
      shell: PLATFORM === 'win32',
    })
  } catch (err) {
    console.error('[build-sea] postject failed. Install it with: npm install -g postject')
    console.error(err.message)
    process.exit(1)
  }
}

console.log('[build-sea] SEA blob injected successfully.')

// ---- Step 5: Ad-hoc code sign (macOS only) ----
if (PLATFORM === 'darwin') {
  console.log('[build-sea] Ad-hoc signing (macOS)...')
  try {
    execSync(`codesign --sign - --force --deep "${BINARY_OUT}"`, { stdio: 'inherit' })
    console.log('[build-sea] Ad-hoc signature applied.')
  } catch (err) {
    console.error('[build-sea] codesign failed:', err.message)
    process.exit(1)
  }
}

console.log('[build-sea] SEA binary ready at:', BINARY_OUT)
