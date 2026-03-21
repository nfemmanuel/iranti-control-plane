# Building Iranti Control Plane Installers

This guide covers how to build platform-specific installer packages for Iranti Control Plane locally and via CI.

---

## Overview

The installer pipeline uses **Node.js Single Executable Applications (SEA)** to bundle the Express server and the Node 22 runtime into a single binary per platform. The Vite-built React frontend is shipped as a sidecar directory alongside the binary.

**Build scripts live in `scripts/package/`.**

---

## Prerequisites

### All platforms

- **Node.js 22 LTS** — the packaged binary bundles Node 22. Use `nvm use 22` or install from [nodejs.org](https://nodejs.org/en/download).
- **postject** — injects the SEA blob into the Node binary:
  ```bash
  npm install -g postject
  ```
- **esbuild** — installed as a devDependency of `src/server`. Run `npm install --prefix src/server` before running any packaging script.

### Windows

- **NSIS (Nullsoft Scriptable Install System) >= 3.x** — required to build the `.exe` installer:
  ```powershell
  # Option A — winget
  winget install NSIS.NSIS
  # Option B — Chocolatey
  choco install nsis
  ```
  After installation, ensure `makensis` is on your PATH. Verify: `makensis /VERSION`.

### macOS

- **Xcode Command Line Tools** — provides `codesign` and `lipo`:
  ```bash
  xcode-select --install
  ```
- **create-dmg** — packages the `.app` bundle into a drag-to-Applications DMG:
  ```bash
  npm install -g create-dmg
  ```
  Source: [github.com/sindresorhus/create-dmg](https://github.com/sindresorhus/create-dmg)

### Linux

- **appimagetool** — produces the `.AppImage` artifact. Download from [AppImageKit releases](https://github.com/AppImage/AppImageKit/releases):
  ```bash
  wget https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage \
    -O /tmp/appimagetool
  chmod +x /tmp/appimagetool
  sudo mv /tmp/appimagetool /usr/local/bin/appimagetool
  ```
  On CI runners without FUSE support, set `APPIMAGE_EXTRACT_AND_RUN=1` before running appimagetool.

- **fpm (Effing Package Management)** — produces the `.deb` (and optionally `.rpm`) package:
  ```bash
  sudo apt-get install ruby-dev build-essential
  sudo gem install fpm --no-document
  ```
  Source: [fpm.readthedocs.io](https://fpm.readthedocs.io/)

  If fpm is not available, `build-linux.mjs` will fall back to `dpkg-deb` if it is installed.

---

## Build Steps

### 1. Build the frontend

The Vite build must run first to produce `public/control-plane/` (the static asset sidecar).

```bash
npm run build:client
```

### 2. Run the installer build for your platform

```bash
# Windows (requires NSIS installed)
npm run package:windows

# macOS (requires create-dmg installed)
npm run package:macos

# Linux (requires appimagetool and fpm installed)
npm run package:linux

# All platforms (only works on a multi-platform build matrix in CI)
npm run package:all
```

Each script internally runs:
1. `scripts/package/bundle.mjs` — esbuild CJS pre-bundle
2. `scripts/package/build-sea.mjs` — Node SEA blob generation + binary injection
3. Platform-specific packaging (NSIS / create-dmg / appimagetool + fpm)

### 3. Outputs

Artifacts are written to `dist/installers/`:

| Platform | File |
|---|---|
| Windows | `iranti-control-plane-setup-<version>.exe` |
| macOS (current arch) | `iranti-control-plane-<arch>-<version>.dmg` |
| macOS (universal, CI only) | `iranti-control-plane-universal-<version>.dmg` |
| Linux AppImage | `iranti-control-plane-<version>.AppImage` |
| Linux deb | `iranti-control-plane_<version>_amd64.deb` |

---

## CI Pipeline

The GitHub Actions workflow at `.github/workflows/package.yml` handles multi-platform builds automatically.

**Trigger:** Push a semver tag (`v*.*.*`) or use `workflow_dispatch`.

```bash
# Tag and push to trigger the release pipeline
git tag v0.3.0
git push origin v0.3.0
```

**Jobs:**

| Job | Runner | Output |
|---|---|---|
| `build-windows` | `windows-latest` | `.exe` NSIS installer |
| `build-macos-arm64` | `macos-14` (Apple Silicon) | arm64 SEA binary artifact |
| `build-macos-x86` | `macos-13` (Intel) | x86_64 SEA binary artifact |
| `build-macos-universal` | `macos-14` | Universal DMG (lipo merge of both arches) |
| `build-linux` | `ubuntu-latest` | `.AppImage` + `.deb` |
| `release` | `ubuntu-latest` | GitHub Release with all artifacts |

The universal macOS binary is produced by `lipo -create arm64-binary x86_64-binary -output universal-binary` in the `build-macos-universal` job, which downloads both arch artifacts from the earlier jobs.

---

## Code Signing

### Current status (Phase 3 initial release)

| Platform | Signing status | User impact |
|---|---|---|
| Windows | **Unsigned** | SmartScreen: "Windows protected your PC" → click **More info → Run anyway** |
| macOS | **Ad-hoc signed** (`codesign --sign -`) | Gatekeeper blocks first launch → right-click → **Open → Open** |
| Linux | Not required | No signing friction |

### Post-launch upgrade path

**macOS full notarization:**
- Join the Apple Developer Program ($99/year): [developer.apple.com/programs](https://developer.apple.com/programs/)
- Create an Apple Developer ID Application certificate in Xcode or developer.apple.com
- Add `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD` as GitHub Actions secrets
- Replace the `codesign --sign -` step in the CI workflow with:
  ```bash
  codesign --sign "Developer ID Application: Your Name (TEAMID)" --deep --options runtime "${APP_BUNDLE}"
  xcrun notarytool submit "${DMG_OUT}" --apple-id "$APPLE_ID" --password "$APPLE_APP_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
  xcrun stapler staple "${DMG_OUT}"
  ```
- Notarization adds approximately 10 minutes to the macOS CI build.

**Windows OV/EV code signing:**
- Purchase an OV (Organization Validated) certificate from DigiCert, Sectigo, or another CA: ~$200–$400/year
- EV (Extended Validation) certificates (~$400–$700/year) eliminate SmartScreen warnings immediately. OV certificates eliminate them after the binary establishes reputation.
- Lead time: OV: 1–5 business days. EV: 1–4 weeks.
- Add the certificate as a GitHub Actions secret (`WINDOWS_CERT_PFX`, `WINDOWS_CERT_PASSWORD`).
- Add a `signtool` step to the Windows CI job after the NSIS build.

---

## Installer Layout

### Windows install directory

```
%ProgramFiles%\Iranti Control Plane\
  iranti-cp.exe               ← Node SEA binary
  package.json                ← version metadata for runtime detection
  public\
    control-plane\
      index.html
      assets\
        ...
  Uninstall.exe               ← registered in Add/Remove Programs
```

### macOS .app bundle

```
Iranti Control Plane.app/
  Contents/
    Info.plist
    MacOS/
      iranti-cp               ← Node SEA binary (universal arm64 + x86_64)
    Resources/
      package.json
      public/
        control-plane/
          index.html
          assets/
            ...
```

The server detects the SEA context via `process.isSea()` and resolves static assets relative to `path.dirname(process.execPath)` inside the `.app/Contents/MacOS/` directory. The installer places `public/control-plane/` relative to the binary inside `Resources/`.

Note: Inside the `.app` bundle, `process.execPath` points to `Contents/MacOS/iranti-cp`. The static path resolution in `src/server/index.ts` resolves to `dirname(process.execPath)/public/control-plane`, which for the bundled case should be overridden via an environment variable set in a launcher wrapper if the Resources layout differs from the MacOS layout. The current implementation places assets in `Contents/Resources/public/control-plane/` but resolves relative to `Contents/MacOS/` — a launcher script may be needed to set `IRANTI_CP_ASSETS_DIR` for the `.app` bundle case. Track this as a follow-on refinement.

### Linux install layout (deb)

```
/usr/local/bin/iranti-control-plane       ← Node SEA binary
/usr/share/iranti-control-plane/
  package.json
  public/
    control-plane/
      index.html
      assets/
        ...
/usr/share/applications/iranti-control-plane.desktop
```

---

## Troubleshooting

**`postject: command not found`**
Run `npm install -g postject`.

**`makensis: command not found` (Windows)**
Install NSIS: `winget install NSIS.NSIS` or `choco install nsis`.

**`create-dmg: command not found` (macOS)**
Run `npm install -g create-dmg`.

**`appimagetool: command not found` (Linux)**
Download and install from [AppImageKit releases](https://github.com/AppImage/AppImageKit/releases).

**`fpm: command not found` (Linux)**
Run `sudo gem install fpm`. Requires Ruby: `sudo apt-get install ruby-dev`.

**`Error: SEA blob generation failed`**
Ensure the CJS bundle was built first: `node scripts/package/bundle.mjs`. Verify that `dist/server/bundle.cjs` exists.

**macOS Gatekeeper blocks the app**
Right-click the app in Finder → Open → Open. The app will be whitelisted for subsequent launches. For wide distribution, full Apple Developer ID notarization removes this friction.

**Windows SmartScreen warning**
Click "More info" → "Run anyway". This is expected for unsigned binaries. OV/EV signing removes this warning.
