#!/usr/bin/env node
/**
 * scripts/package/build-linux.js
 *
 * Produces Linux distribution artifacts for Iranti Control Plane:
 *   - .AppImage (universal, no install required — primary Linux deliverable)
 *   - .deb (Debian/Ubuntu package)
 *
 * Steps:
 *   1. Run bundle.js (esbuild CJS pre-bundle)
 *   2. Run build-sea.js (Node SEA binary for Linux x64)
 *   3. Assemble AppDir for AppImage
 *   4. Run appimagetool to produce the .AppImage
 *   5. Use fpm to produce the .deb
 *
 * Prerequisites (must be installed on the CI runner or build machine):
 *   - appimagetool: Download from https://github.com/AppImage/AppImageKit/releases
 *     Place appimagetool-x86_64.AppImage in PATH as `appimagetool` and chmod +x.
 *     On CI: wget https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage
 *            chmod +x appimagetool-x86_64.AppImage
 *            sudo mv appimagetool-x86_64.AppImage /usr/local/bin/appimagetool
 *   - fpm (for .deb production):
 *     gem install fpm  OR  apt-get install ruby-dev && gem install fpm
 *     Alternatively: dpkg-deb (built-in on Debian/Ubuntu) can be used without fpm.
 *   - FUSE (for running AppImages during build): may require APPIMAGE_EXTRACT_AND_RUN=1
 *     on CI runners that don't have FUSE enabled.
 *
 * Code signing:
 *   Not required for .AppImage or .deb. GPG signing for an apt repository is
 *   best practice if a hosted apt repo is published in future — that is a
 *   separate follow-on effort. No signing step is applied here.
 *
 * Usage:
 *   node scripts/package/build-linux.js
 */

import { execSync, execFileSync } from 'child_process'
import { mkdirSync, writeFileSync, cpSync, readFileSync, chmodSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '../../')

const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
const VERSION = pkg.version ?? '0.0.0'

const BINARY_SRC = resolve(ROOT, 'dist/sea/iranti-cp')
const CLIENT_DIST = resolve(ROOT, 'public/control-plane')
const DIST_INSTALLERS = resolve(ROOT, 'dist/installers')

// AppImage paths
const APPDIR = resolve(ROOT, 'dist/linux/iranti-cp.AppDir')
const APPIMAGE_OUT = resolve(DIST_INSTALLERS, `iranti-control-plane-${VERSION}.AppImage`)

// .deb staging paths
const DEB_STAGING = resolve(ROOT, 'dist/linux/deb-staging')
const DEB_OUT = resolve(DIST_INSTALLERS, `iranti-control-plane_${VERSION}_amd64.deb`)

mkdirSync(DIST_INSTALLERS, { recursive: true })

// ---- Step 1: Bundle ----
console.log('[build-linux] Step 1: esbuild CJS bundle...')
execFileSync(process.execPath, [resolve(__dirname, 'bundle.mjs')], {
  stdio: 'inherit',
  cwd: ROOT,
})

// ---- Step 2: SEA binary ----
console.log('[build-linux] Step 2: Node SEA binary...')
execFileSync(process.execPath, [resolve(__dirname, 'build-sea.mjs')], {
  stdio: 'inherit',
  cwd: ROOT,
})

// ======================================================================
// ---- Step 3: Assemble AppDir ----
// ======================================================================
console.log('[build-linux] Step 3: Assembling AppDir...')

const APP_USR_BIN = resolve(APPDIR, 'usr/bin')
const APP_USR_SHARE = resolve(APPDIR, 'usr/share/iranti-control-plane')

mkdirSync(APP_USR_BIN, { recursive: true })
mkdirSync(resolve(APP_USR_SHARE, 'public/control-plane'), { recursive: true })
mkdirSync(resolve(APPDIR, 'usr/share/applications'), { recursive: true })
mkdirSync(resolve(APPDIR, 'usr/share/icons/hicolor/256x256/apps'), { recursive: true })

// Copy SEA binary
cpSync(BINARY_SRC, resolve(APP_USR_BIN, 'iranti-control-plane'))
chmodSync(resolve(APP_USR_BIN, 'iranti-control-plane'), 0o755)

// Copy sidecar assets
cpSync(CLIENT_DIST, resolve(APP_USR_SHARE, 'public/control-plane'), { recursive: true })

// Copy package.json for version detection.
// In AppImage context: dirname(process.execPath) = <mount>/usr/bin/
// so package.json must be in usr/bin/ alongside the binary.
// Also copy to usr/share/ for consistency with the .deb bin layout.
const pkgJson = readFileSync(resolve(ROOT, 'package.json'), 'utf8')
writeFileSync(resolve(APP_USR_BIN, 'package.json'), pkgJson)
writeFileSync(resolve(APP_USR_SHARE, 'package.json'), pkgJson)

// Write .desktop file
const desktopEntry = `[Desktop Entry]
Name=Iranti Control Plane
Comment=Operator surface for Iranti — inspect memory, view Staff behavior, manage instances
Exec=iranti-control-plane
Icon=iranti-control-plane
Terminal=true
Type=Application
Categories=Development;Utility;
StartupNotify=false
`
writeFileSync(resolve(APPDIR, 'usr/share/applications/iranti-control-plane.desktop'), desktopEntry)
// AppImage also expects .desktop at AppDir root
writeFileSync(resolve(APPDIR, 'iranti-control-plane.desktop'), desktopEntry)

// AppRun script — appimagetool requires this as the entry point
const appRunScript = `#!/bin/bash
# AppRun — entry point for the Iranti Control Plane AppImage
HERE="$(dirname "$(readlink -f "${0}")")"
export IRANTI_CP_ASSETS_DIR="$HERE/usr/share/iranti-control-plane/public/control-plane"
exec "$HERE/usr/bin/iranti-control-plane" "$@"
`
writeFileSync(resolve(APPDIR, 'AppRun'), appRunScript)
chmodSync(resolve(APPDIR, 'AppRun'), 0o755)

// Placeholder icon (appimagetool requires one — replace with a real icon in production)
// Writing a minimal 1x1 transparent PNG (89 bytes)
const PLACEHOLDER_ICON = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)
writeFileSync(
  resolve(APPDIR, 'usr/share/icons/hicolor/256x256/apps/iranti-control-plane.png'),
  PLACEHOLDER_ICON
)
writeFileSync(resolve(APPDIR, 'iranti-control-plane.png'), PLACEHOLDER_ICON)

console.log('[build-linux] AppDir assembled at:', APPDIR)

// ======================================================================
// ---- Step 4: Build .AppImage ----
// ======================================================================
console.log('[build-linux] Step 4: Building .AppImage...')

// appimagetool prerequisite check
// Install: see Prerequisites comment at top of this file
try {
  execSync('appimagetool --version', { stdio: 'pipe' })
} catch {
  console.error('[build-linux] appimagetool not found on PATH.')
  console.error('[build-linux] Install instructions: see Prerequisites in this file.')
  console.error('[build-linux] See: docs/guides/building-installers.md')
  process.exit(1)
}

try {
  // APPIMAGE_EXTRACT_AND_RUN=1 avoids FUSE requirement on CI runners
  execSync(`APPIMAGE_EXTRACT_AND_RUN=1 appimagetool "${APPDIR}" "${APPIMAGE_OUT}"`, {
    stdio: 'inherit',
    cwd: ROOT,
    env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1' },
  })
  chmodSync(APPIMAGE_OUT, 0o755)
  console.log('[build-linux] AppImage built:', APPIMAGE_OUT)
} catch (err) {
  console.error('[build-linux] appimagetool failed:', err.message)
  process.exit(1)
}

// ======================================================================
// ---- Step 5: Build .deb ----
// ======================================================================
console.log('[build-linux] Step 5: Building .deb...')

mkdirSync(resolve(DEB_STAGING, 'DEBIAN'), { recursive: true })
mkdirSync(resolve(DEB_STAGING, 'usr/local/bin'), { recursive: true })
mkdirSync(resolve(DEB_STAGING, 'usr/share/iranti-control-plane/bin'), { recursive: true })
mkdirSync(resolve(DEB_STAGING, 'usr/share/iranti-control-plane/public/control-plane'), { recursive: true })
mkdirSync(resolve(DEB_STAGING, 'usr/share/applications'), { recursive: true })

// Copy the SEA binary to /usr/share/.../bin/ (not /usr/local/bin/) so the
// wrapper launcher can set IRANTI_CP_ASSETS_DIR before exec-replacing itself.
// If we placed the SEA binary directly at /usr/local/bin/, dirname(process.execPath)
// would be /usr/local/bin/ — not the share directory where assets live.
cpSync(BINARY_SRC, resolve(DEB_STAGING, 'usr/share/iranti-control-plane/bin/iranti-cp'))
chmodSync(resolve(DEB_STAGING, 'usr/share/iranti-control-plane/bin/iranti-cp'), 0o755)

// Shell launcher at /usr/local/bin/ — sets IRANTI_CP_ASSETS_DIR and exec-replaces
const debLauncherScript = `#!/bin/bash
export IRANTI_CP_ASSETS_DIR="/usr/share/iranti-control-plane/public/control-plane"
exec /usr/share/iranti-control-plane/bin/iranti-cp "$@"
`
writeFileSync(
  resolve(DEB_STAGING, 'usr/local/bin/iranti-control-plane'),
  debLauncherScript,
  'utf8'
)
chmodSync(resolve(DEB_STAGING, 'usr/local/bin/iranti-control-plane'), 0o755)

// Copy sidecar assets
cpSync(CLIENT_DIST, resolve(DEB_STAGING, 'usr/share/iranti-control-plane/public/control-plane'), {
  recursive: true,
})

// Copy package.json alongside the SEA binary for runtime version detection.
// In SEA context: dirname(process.execPath) = /usr/share/iranti-control-plane/bin/
writeFileSync(
  resolve(DEB_STAGING, 'usr/share/iranti-control-plane/bin/package.json'),
  readFileSync(resolve(ROOT, 'package.json'), 'utf8')
)

// Write .desktop file
writeFileSync(
  resolve(DEB_STAGING, 'usr/share/applications/iranti-control-plane.desktop'),
  desktopEntry
)

// Write Debian control file
const debControl = `Package: iranti-control-plane
Version: ${VERSION}
Architecture: amd64
Maintainer: Iranti <noreply@iranti.dev>
Description: Iranti Control Plane
 Operator surface for Iranti — inspect memory, view Staff behavior,
 manage instances and project bindings, configure providers/models.
 No Node.js installation required.
Homepage: https://github.com/iranti/iranti-control-plane
Section: utils
Priority: optional
`
writeFileSync(resolve(DEB_STAGING, 'DEBIAN/control'), debControl)

// Try fpm first, fall back to dpkg-deb
let debBuilt = false

try {
  execSync('fpm --version', { stdio: 'pipe' })
  console.log('[build-linux] Building .deb with fpm...')
  execSync(
    [
      'fpm',
      '-s dir',
      '-t deb',
      `-n iranti-control-plane`,
      `-v ${VERSION}`,
      `--architecture amd64`,
      `--maintainer "Iranti <noreply@iranti.dev>"`,
      `--description "Iranti Control Plane — operator surface for Iranti"`,
      `--url "https://github.com/iranti/iranti-control-plane"`,
      `--package "${DEB_OUT}"`,
      `-C "${DEB_STAGING}"`,
      'usr',
    ].join(' '),
    { stdio: 'inherit', cwd: ROOT }
  )
  debBuilt = true
} catch {
  // fpm not available — try dpkg-deb
}

if (!debBuilt) {
  try {
    execSync('dpkg-deb --version', { stdio: 'pipe' })
    console.log('[build-linux] Building .deb with dpkg-deb...')
    execSync(`dpkg-deb --build "${DEB_STAGING}" "${DEB_OUT}"`, {
      stdio: 'inherit',
      cwd: ROOT,
    })
    debBuilt = true
  } catch {
    console.error('[build-linux] Neither fpm nor dpkg-deb found on PATH.')
    console.error('[build-linux] Install fpm: gem install fpm')
    console.error('[build-linux] Or install dpkg-deb: apt-get install dpkg')
    console.error('[build-linux] See: docs/guides/building-installers.md')
    process.exit(1)
  }
}

if (debBuilt) {
  console.log('[build-linux] .deb built:', DEB_OUT)
}

console.log('[build-linux] All Linux artifacts complete.')
console.log('[build-linux]  AppImage:', APPIMAGE_OUT)
console.log('[build-linux]  .deb:    ', DEB_OUT)
