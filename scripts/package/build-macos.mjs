#!/usr/bin/env node
/**
 * scripts/package/build-macos.js
 *
 * Produces the macOS .dmg installer for Iranti Control Plane.
 *
 * This script runs on the current architecture (arm64 or x86_64). For a
 * universal binary, run this on both macos-14 (arm64) and macos-13 (x86_64)
 * CI runners to produce arch-specific SEA binaries, then use `lipo` to merge
 * them. The GitHub Actions workflow handles the merge in a dedicated job
 * (package-macos-universal).
 *
 * Steps:
 *   1. Run bundle.js (esbuild CJS pre-bundle)
 *   2. Run build-sea.js (Node SEA binary for current arch + ad-hoc signing)
 *   3. Assemble the .app bundle:
 *        Iranti Control Plane.app/
 *          Contents/
 *            Info.plist
 *            MacOS/
 *              iranti-cp              (the SEA binary)
 *            Resources/
 *              public/control-plane/  (Vite build output — sidecar assets)
 *   4. Package with create-dmg → dist/installers/iranti-control-plane-<arch>-<version>.dmg
 *
 * Prerequisites (must be installed on the CI runner or build machine):
 *   - create-dmg: npm install -g create-dmg
 *     (https://github.com/sindresorhus/create-dmg)
 *   - Xcode Command Line Tools (for codesign, lipo):
 *     xcode-select --install
 *
 * Universal binary note:
 *   To produce a universal binary, run this script on both arm64 and x86_64
 *   runners, upload the two SEA binaries as CI artifacts, then in a final job:
 *     lipo -create iranti-cp-arm64 iranti-cp-x86_64 -output iranti-cp-universal
 *   This is handled by the GitHub Actions release.yml workflow.
 *
 * Code signing:
 *   Ad-hoc signing (codesign --sign -) is applied in build-sea.js — no Apple
 *   Developer account required. Gatekeeper will still block unsigned apps on
 *   first launch. Users bypass: right-click → Open → Open.
 *   Post-launch upgrade: Apple Developer ID ($99/year) + xcrun notarytool.
 *   See: docs/guides/building-installers.md
 *
 * Usage:
 *   node scripts/package/build-macos.js
 */

import { execSync, execFileSync } from 'child_process'
import { mkdirSync, writeFileSync, cpSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '../../')

// Read version and arch
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
const VERSION = pkg.version ?? '0.0.0'
const ARCH = process.arch === 'arm64' ? 'arm64' : 'x86_64'

const APP_NAME = 'Iranti Control Plane'
const APP_BUNDLE_DIR = resolve(ROOT, `dist/app/${APP_NAME}.app`)
const MACOS_DIR = resolve(APP_BUNDLE_DIR, 'Contents/MacOS')
const RESOURCES_DIR = resolve(APP_BUNDLE_DIR, 'Contents/Resources')
const CLIENT_DIST = resolve(ROOT, 'public/control-plane')
const BINARY_SRC = resolve(ROOT, 'dist/sea/iranti-cp')
const DIST_INSTALLERS = resolve(ROOT, 'dist/installers')
const DMG_OUT = resolve(DIST_INSTALLERS, `iranti-control-plane-${ARCH}-${VERSION}.dmg`)

mkdirSync(DIST_INSTALLERS, { recursive: true })
mkdirSync(MACOS_DIR, { recursive: true })
mkdirSync(resolve(RESOURCES_DIR, 'public/control-plane'), { recursive: true })

// ---- Step 1: Bundle ----
console.log('[build-macos] Step 1: esbuild CJS bundle...')
execFileSync(process.execPath, [resolve(__dirname, 'bundle.mjs')], {
  stdio: 'inherit',
  cwd: ROOT,
})

// ---- Step 2: SEA binary (ad-hoc signed) ----
console.log('[build-macos] Step 2: Node SEA binary...')
execFileSync(process.execPath, [resolve(__dirname, 'build-sea.mjs')], {
  stdio: 'inherit',
  cwd: ROOT,
})

// ---- Step 3: Assemble .app bundle ----
console.log('[build-macos] Step 3: Assembling .app bundle...')

// Copy SEA binary into MacOS/
cpSync(BINARY_SRC, resolve(MACOS_DIR, 'iranti-cp'))
execSync(`chmod +x "${resolve(MACOS_DIR, 'iranti-cp')}"`)

// Copy sidecar assets into Resources/public/control-plane/
cpSync(CLIENT_DIST, resolve(RESOURCES_DIR, 'public/control-plane'), { recursive: true })

// Copy package.json for runtime version detection
writeFileSync(
  resolve(RESOURCES_DIR, 'package.json'),
  readFileSync(resolve(ROOT, 'package.json'), 'utf8')
)

// Write Info.plist
const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>com.iranti.control-plane</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>iranti-cp</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>LSUIElement</key>
  <false/>
</dict>
</plist>`

writeFileSync(resolve(APP_BUNDLE_DIR, 'Contents/Info.plist'), infoPlist, 'utf8')

// Re-sign the entire .app bundle (deep) with ad-hoc signature
console.log('[build-macos] Ad-hoc signing .app bundle...')
execSync(`codesign --sign - --force --deep "${APP_BUNDLE_DIR}"`, { stdio: 'inherit' })

console.log('[build-macos] .app bundle assembled at:', APP_BUNDLE_DIR)

// ---- Step 4: Package with create-dmg ----
console.log('[build-macos] Step 4: Creating .dmg with create-dmg...')
console.log('[build-macos] Output:', DMG_OUT)

// create-dmg prerequisite check
// Install: npm install -g create-dmg
try {
  execSync('create-dmg --version', { stdio: 'pipe' })
} catch {
  console.error('[build-macos] create-dmg not found on PATH.')
  console.error('[build-macos] Install: npm install -g create-dmg')
  console.error('[build-macos] See: docs/guides/building-installers.md')
  process.exit(1)
}

try {
  execSync(
    [
      'create-dmg',
      `"${APP_BUNDLE_DIR}"`,
      `"${DIST_INSTALLERS}"`,
      `--overwrite`,
    ].join(' '),
    { stdio: 'inherit', cwd: ROOT }
  )

  // create-dmg names the output file based on the app name and version.
  // Rename it to our expected output name.
  execSync(
    `mv "${DIST_INSTALLERS}/${APP_NAME} ${VERSION}.dmg" "${DMG_OUT}" 2>/dev/null || true`,
    { stdio: 'inherit' }
  )

  console.log('[build-macos] DMG built successfully:', DMG_OUT)
} catch (err) {
  console.error('[build-macos] create-dmg failed:', err.message)
  process.exit(1)
}
