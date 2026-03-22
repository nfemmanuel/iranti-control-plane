# AC-11 Automated Assessment — 2026-03-21

**Ticket:** CP-T075 — CP-T048 AC-11 Closure: Clean-Machine Installer Validation
**Prepared by:** qa_engineer
**Date:** 2026-03-21
**Environment:** Windows 11 Home 10.0.26200, Node.js v22.x (developer machine — NOT a clean machine)

---

## Scope

This document records all installer verification steps that can be performed automatically without a clean machine. It covers: bundle build correctness, asset presence, ZIP structure integrity, script analysis for each platform builder, and binary artifact verification.

The clean-machine gate (AC-11 proper) — running the installer on a machine with no Node.js — cannot be executed from this environment. That step is documented separately in `docs/qa/ac11-execution-guide.md`.

---

## Summary Table

| Check | Result | Detail |
|---|---|---|
| Bundle step (`bundle.mjs`) executes cleanly | **PASS** | Output: 1.5 MB CJS bundle |
| Bundle output is valid CJS | **PASS** | Begins with polyfill header + `"use strict"` |
| `dist/sea/iranti-cp.exe` exists (Windows SEA binary) | **PASS** | 91,625,984 bytes, 2026-03-21 |
| `dist/release/iranti-cp.exe` exists (release binary) | **PASS** | 91,625,984 bytes, matches sea/ |
| `dist/release/package.json` exists (version sidecar) | **PASS** | version = 0.4.0 |
| `dist/release/public/control-plane/` exists with assets | **PASS** | index.html + 4 asset files |
| ZIP v0.4.0 exists and has correct structure | **PASS** | 7 entries, all required files |
| ZIP v0.3.0 exists | **PASS** | 5 entries (missing 2 asset files vs v0.4.0 — see below) |
| `.env.iranti` NOT embedded in ZIP | **INFO** | By design — user supplies own credentials |
| `dist/installers/` NSIS `.exe` installer exists | **FAIL** | Directory does not exist — NSIS not installed locally |
| macOS `.dmg` artifact exists | **NOT BUILT** | macOS-only; requires macOS CI runner |
| Linux `.AppImage` / `.deb` artifacts exist | **NOT BUILT** | Linux-only; requires Linux CI runner |
| `src/server/index.ts` SEA path guard correct | **PASS** | `process.isSea()` guard, `IRANTI_CP_ASSETS_DIR` override |
| Windows `build-windows.mjs` script analysis | **PASS** | No hardcoded paths; all derived from ROOT |
| macOS `build-macos.mjs` script analysis | **PASS** | ISSUE-1 resolved; launcher wrapper present |
| Linux `build-linux.mjs` script analysis | **PASS** | ISSUE-5 and ISSUE-7 resolved |
| `build-sea.mjs` script analysis | **PASS** | postject args correct; macOS segment `__MACOS` |
| CI workflow (`package.yml`) macOS inline script | **PASS** | ISSUE-6 resolved; launcher wrapper included |
| CI workflow trigger / ISSUE-2 (dual release) | **RISK** | `release.yml` still exists alongside `package.yml` |

---

## Check 1: Bundle Step

**Command run:** `node scripts/package/bundle.mjs`

**Result: PASS**

Output:
```
[bundle] Running esbuild (CJS format)...
[bundle] Entry: C:\...\src\server\index.ts
[bundle] Output: C:\...\dist\server\bundle.cjs
  dist\server\bundle.cjs  1.5mb
Done in 6315ms
[bundle] Done. CJS bundle written to: ...dist\server\bundle.cjs
```

The bundle completes without errors. Output file is 1,563,726 bytes. File header confirms valid CJS output:
```
const __importmeta_url = require('url').pathToFileURL(__filename).href;
"use strict";
var __create = Object.create;
```

The `import.meta.url` polyfill is injected correctly (required for SEA compatibility). The esbuild Windows path (`src/server/node_modules/@esbuild/win32-x64/esbuild.exe`) is resolved correctly. All `--external` rollup/pg-native entries are present.

**Assessment:** Bundle step is clean. A clean Windows machine with Node.js and the dependencies installed would produce the same output before packaging.

---

## Check 2: SEA Binary Artifacts

**`dist/sea/iranti-cp.exe`**
- Size: 91,625,984 bytes
- Timestamp: 2026-03-21 13:58
- The blob `dist/sea/iranti-cp.blob` is 1,563,773 bytes — matching the bundle size with overhead, confirming injection occurred.

**`dist/release/iranti-cp.exe`**
- Size: 91,625,984 bytes — identical to `dist/sea/iranti-cp.exe`
- Timestamp: 2026-03-21 13:59 (1 minute later, consistent with a copy step after SEA injection)

**`dist/release/package.json`**
- Present, 1,120 bytes
- Contains `"version": "0.4.0"` — matches root `package.json`

**Assessment:** Binary artifacts are consistent. The SEA blob was injected (blob file size matches bundle), and `package.json` is co-located for runtime version detection.

---

## Check 3: Frontend Assets

**`public/control-plane/`** (source, referenced by build scripts):
- `index.html` (405 bytes)
- `assets/index-Bj7lyyen.js` (491,258 bytes)
- `assets/index-CFrwM0TU.css` (222,714 bytes)
- `assets/index-DA3wfRi3.js` (516,340 bytes)
- `assets/index-yIwzIutm.css` (202,543 bytes)

**`dist/release/public/control-plane/`** (sidecar in release directory):
- Same structure confirmed — index.html + assets/ directory with the same 4 files.

**Assessment:** PASS. Assets exist at both source and sidecar locations. Both Windows ZIPs embed them correctly.

---

## Check 4: ZIP Structure

**`dist/iranti-control-plane-v0.4.0-windows-x64.zip`** (34,319,865 bytes):

| File | Size |
|---|---|
| `public/control-plane/index.html` | 405 B |
| `public/control-plane/assets/index-Bj7lyyen.js` | 491,258 B |
| `public/control-plane/assets/index-CFrwM0TU.css` | 222,714 B |
| `public/control-plane/assets/index-DA3wfRi3.js` | 516,340 B |
| `public/control-plane/assets/index-yIwzIutm.css` | 202,543 B |
| `iranti-cp.exe` | 91,625,984 B |
| `package.json` | 1,120 B |

**Result: PASS**

The ZIP contains all required files for Windows "portable" deployment:
- The SEA binary at root
- `public/control-plane/` sidecar assets (the server resolves these via `dirname(process.execPath)/public/control-plane/`)
- `package.json` at root alongside the binary for version detection

One gap: **no `.env.iranti` template is included in the ZIP.** A user downloading the ZIP and running `iranti-cp.exe` directly will get a DB connection error immediately, with no guidance on what configuration file is needed. The NSIS installer does not appear to include a `.env.iranti` template either (the NSIS script copies only the binary, assets, and `package.json`). This is a usability gap, though not a technical failure of the binary itself.

**`dist/iranti-control-plane-v0.3.0-windows-x64.zip`** (34,143,374 bytes):
- Missing `index-CFrwM0TU.css` and `index-DA3wfRi3.js` (the newer asset hashes from the v0.4.0 build)
- Contains `index-Bj7lyyen.js` and `index-yIwzIutm.css` only (the v0.3.0 frontend)
- This is correct — v0.3.0 uses the older frontend bundle

**Assessment:** ZIP structures are correct for their respective versions.

---

## Check 5: Script Analysis — `build-windows.mjs`

**No hardcoded absolute paths.** All paths are derived from `ROOT = resolve(__dirname, '../../')`. The NSIS script template injects absolute paths only at build time by reading `ROOT`, `BINARY`, and `CLIENT_DIST`.

**NSIS installer content assessment:**
- Installs to `$PROGRAMFILES64\Iranti Control Plane\` — correct 64-bit path
- Copies `iranti-cp.exe`, `public/control-plane/` assets, and `package.json`
- Creates Start Menu shortcuts at `$SMPROGRAMS\Iranti Control Plane\`
- Registers uninstaller in `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\IrantiControlPlane`
- `RequestExecutionLevel admin` — will prompt UAC on install
- Uninstall section removes binary, `package.json`, `Uninstall.exe`, `public/` dir, Start Menu entries, and registry key
- `RMDir` without `/r` for the install dir itself — will leave the directory if any unlisted files remain, but all installed files are explicitly deleted first

**Correctness of asset path in NSIS vs server resolution:**
At install time, the binary is at `C:\Program Files\Iranti Control Plane\iranti-cp.exe`. The server resolves assets as `dirname(process.execPath) + "/public/control-plane"` = `C:\Program Files\Iranti Control Plane\public\control-plane\`. The NSIS script copies assets to `${INSTALL_DIR}\public\control-plane`. These match. **PASS.**

**`makensis` prerequisite:** The script checks for `makensis` on PATH and exits with a helpful error if absent. The CI workflow installs it via `choco install nsis -y`. On a local developer machine without NSIS, the script will fail cleanly at step 4. This is the reason `dist/installers/` does not exist on this machine.

**Assessment:** Script is correct. No hardcoded paths. Installer structure aligns with server asset resolution.

---

## Check 6: Script Analysis — `build-sea.mjs`

**postject args:**
- `NODE_SEA_BLOB` — correct sentinel name for Node SEA
- `--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2` — correct
- macOS only: `--macho-segment-name __MACOS` — matches Node.js documentation

**macOS code signing:** `codesign --remove-signature` → inject → `codesign --sign - --force --deep` — correct sequence.

**Platform detection:** `process.platform` correctly branches on `win32`/`darwin`/`linux`.

**npx/postject fallback:** Tries `npx postject` first, falls back to global `postject`. Suitable for CI where global install is not guaranteed.

**Assessment:** PASS. Script is platform-correct and has no hardcoded machine-specific assumptions.

---

## Check 7: Script Analysis — `build-macos.mjs`

**ISSUE-1 fix present:** The launcher script (`iranti-control-plane`) is written to `Contents/MacOS/` and sets `IRANTI_CP_ASSETS_DIR="$BUNDLE_DIR/Resources/public/control-plane"`. `CFBundleExecutable` is set to `iranti-control-plane` (the launcher), not `iranti-cp` (the SEA binary directly).

**`package.json` placement:** Copied to `Contents/MacOS/package.json` alongside the SEA binary — matches `dirname(process.execPath)` resolution in the SEA context. **Correct.**

**Asset placement:** `cpSync(CLIENT_DIST, resolve(RESOURCES_DIR, 'public/control-plane'))` — assets in `Contents/Resources/public/control-plane/`, matched by the launcher's `IRANTI_CP_ASSETS_DIR`.

**Assessment:** PASS. The macOS script is correct after the ISSUE-1 fix.

---

## Check 8: Script Analysis — `build-linux.mjs`

**AppImage structure:**
- Binary at `usr/bin/iranti-control-plane`
- Assets at `usr/share/iranti-control-plane/public/control-plane/`
- `package.json` at both `usr/bin/package.json` (for `dirname(process.execPath)` resolution) and `usr/share/iranti-control-plane/package.json`
- `AppRun` sets `IRANTI_CP_ASSETS_DIR="$HERE/usr/share/iranti-control-plane/public/control-plane"` — correct

**ISSUE-5 fix present:** `IRANTI_CP_ASSETS_DIR` is set in `AppRun` and in the `.deb` launcher script. `src/server/index.ts` reads this env var first, overriding the default `dirname(process.execPath)` resolution.

**ISSUE-7 fix present:** `package.json` is placed in `usr/bin/` (alongside the binary) — correct for `dirname(process.execPath)` in the AppImage context.

**.deb structure:**
- SEA binary at `/usr/share/iranti-control-plane/bin/iranti-cp`
- Shell launcher at `/usr/local/bin/iranti-control-plane` — sets `IRANTI_CP_ASSETS_DIR=/usr/share/iranti-control-plane/public/control-plane`
- `package.json` at `/usr/share/iranti-control-plane/bin/package.json`

**Assessment:** PASS. Both ISSUE-5 and ISSUE-7 fixes are reflected in the script.

---

## Check 9: `src/server/index.ts` — SEA Guards

| Guard | Present | Correct |
|---|---|---|
| `process.isSea()` detection | Yes | Yes — safely checks `typeof` first |
| `IRANTI_CP_ASSETS_DIR` env var override | Yes | Yes — first in clientDist resolution chain |
| `dirname(process.execPath)` fallback | Yes | Yes — used when `IRANTI_CP_ASSETS_DIR` unset |
| `findAvailablePort(3000, 3010)` | Yes | Yes — AC-12 compliant |
| Version from `package.json` co-located with binary | Yes | Yes — `createRequire(pathToFileURL(process.execPath).href)` |
| Browser auto-open guarded by `isSea?.()` | Yes | Yes — non-fatal on failure |
| Startup log line with version and port | Yes | Yes — `[iranti-cp] v${VERSION} running at http://localhost:${PORT}` |

**Assessment:** PASS across all server-side AC checks.

---

## Check 10: CI Workflow (`package.yml`)

**Windows job:** Uses `choco install nsis -y` — correct, installs `makensis` on PATH. Runs `node scripts/package/build-windows.mjs`. Uploads `dist/installers/iranti-control-plane-setup-*.exe`. **PASS.**

**macOS universal job (ISSUE-6 fix):** The inline shell script in CI now matches `build-macos.mjs`:
- Creates `iranti-control-plane` launcher in `Contents/MacOS/`
- Sets `CFBundleExecutable=iranti-control-plane`
- Copies `package.json` to `Contents/MacOS/`
- Sets `IRANTI_CP_ASSETS_DIR` in the launcher
This matches the local script. **PASS.**

**Linux job:** Uses `appimagetool` downloaded from AppImage GitHub releases and `fpm` via gem. Runs `APPIMAGE_EXTRACT_AND_RUN=1 node scripts/package/build-linux.mjs` — `APPIMAGE_EXTRACT_AND_RUN=1` avoids FUSE requirement on CI. **PASS.**

**ISSUE-2 (dual release) — RISK:** Both `release.yml` (older, creates a `.tar.gz` source release) and `package.yml` (new, creates platform installers) trigger on `push: tags: v*`. Both use `softprops/action-gh-release@v2`. On a tag push, both will attempt to create a GitHub Release for the same tag. Depending on `action-gh-release` behavior, this may fail the second job, produce a duplicate release, or partially succeed. This was noted in the static analysis as ISSUE-2 and has not been resolved.

**Severity:** Low for clean-machine AC-11 testing (does not affect the binary), but is a release process risk for the formal v0.3.0 and v0.4.0 GitHub Release creation.

---

## Check 11: `.env.iranti` / Configuration Template Gap

The ZIPs do not include an `.env.iranti` template. The NSIS script does not copy one either. When a user on a clean machine runs `iranti-cp.exe` without a `DATABASE_URL` configured, the server will start (the binary works) but will fail to connect to the database and show errors in the Health view.

This is expected behavior — the control plane requires Iranti running locally with a PostgreSQL database. However, there is no guidance inside the installed application about what to configure. The `docs/guides/getting-started.md` addresses this, but a user who downloads the ZIP directly has no pointer to that document.

**Classification:** Usability gap, not a binary defect. Does not affect the AC-11 binary pass/fail criteria (which test the installer mechanics, not the Iranti integration).

---

## What Cannot Be Verified Without a Clean Machine

| Item | Why It Needs a Clean Machine |
|---|---|
| Node.js absence confirmed | This machine has Node.js installed |
| SmartScreen warning appears (W-2) | Requires a machine that has never seen the binary |
| UAC elevation works (W-3) | Requires admin flow testing |
| NSIS wizard installs cleanly | `makensis` not installed; `dist/installers/` does not exist |
| Start Menu entry appears (W-4) | Requires actual installation |
| Binary launches without Node.js (W-5) | Core AC-11 test |
| Browser auto-open fires (W-5, AC-6) | Requires running binary |
| UI loads from installed binary (W-6) | Requires running binary |
| Version in UI matches installer (W-7) | Requires running binary |
| Uninstall removes all files (W-9, AC-2) | Requires actual installation and uninstall |
| Port conflict auto-increment (W-8, AC-12) | Requires running binary |
| All macOS tests (M-1 through M-11) | Requires macOS machine |
| All Linux tests (L-1 through L-13) | Requires Linux machine |

---

## Overall Assessment

### What PASSED in automated checks

- Bundle step executes cleanly and produces valid 1.5 MB CJS output
- SEA binary exists at 91.6 MB, consistent with Node 22 binary + injected blob
- `dist/release/` has the correct sidecar layout (binary + `package.json` + `public/control-plane/`)
- ZIP structures (v0.3.0 and v0.4.0) are correct — all required files present, at correct paths
- `src/server/index.ts` has all required AC guards (port increment, version detection, SEA guards, browser auto-open)
- All platform build scripts are path-correct and have no hardcoded machine assumptions
- ISSUE-1 (macOS asset path) resolved in both `build-macos.mjs` and the CI inline script
- ISSUE-5 (Linux asset path) resolved in `build-linux.mjs` (IRANTI_CP_ASSETS_DIR)
- ISSUE-6 (CI macOS script divergence) resolved in `package.yml`
- ISSUE-7 (AppImage version shows 0.0.0) resolved in `build-linux.mjs`

### What FAILED or showed RISK

1. **NSIS `.exe` installer not built locally** — `makensis` is not installed on this machine. The `dist/installers/` directory does not exist. **This is expected on a developer machine.** The CI Windows runner installs NSIS via Chocolatey. The installer can only be built in CI or on a machine with NSIS installed.

2. **ISSUE-2: dual-release workflow risk** — `release.yml` and `package.yml` both trigger on `v*` tags and both attempt to create a GitHub Release. This is an operational risk for release publishing, not for binary correctness.

3. **No `.env.iranti` template in ZIP or NSIS** — A user downloading the ZIP has no guidance on configuration. Not a binary defect, but a usability gap.

### Likelihood of passing AC-11 on a clean Windows machine

**Assessment: LIKELY TO PASS** given the following:

- The SEA binary is correctly built (91.6 MB, blob injected)
- Asset sidecar paths are correct for the Windows install layout
- `package.json` is co-located for version detection
- The NSIS script correctly places all files and registers the uninstaller
- Server-side logic (port increment, browser auto-open, version display) is verified via code analysis

The primary unknown is whether the NSIS `.exe` installer produced by CI will install and launch correctly on a machine that has never had Node.js. The binary self-contains the Node.js runtime and the embedded server code — there is no Node.js dependency at runtime.

**Remaining risk factors:**
- SmartScreen may behave differently than documented on some configurations
- The binary has been built locally but not tested end-to-end from the installer
- macOS and Linux artifacts have never been built locally — those require CI

### Recommendation

The automated checks provide reasonable confidence that the Windows portable binary (ZIP) and the build scripts are correct. **A clean-machine test on Windows is required to formally close AC-11.**

macOS and Linux clean-machine tests are blocked on running the CI pipeline to produce `.dmg` and `.AppImage`/`.deb` artifacts. Those tests cannot be executed until at least one CI run on a tagged commit succeeds.

---

## Next Steps

1. Run the CI pipeline on a tagged commit (e.g., `v0.4.0-test`) to produce all four platform installers.
2. Execute the Windows clean-machine test using `docs/qa/ac11-execution-guide.md` — this is the fastest path to a partial AC-11 pass.
3. Resolve ISSUE-2 (disable or update `release.yml`) before tagging the formal release.
4. Consider adding a `.env.iranti.template` to the ZIP and NSIS installer for user guidance.
5. After Windows passes: schedule macOS and Linux clean-machine tests for full AC-11 coverage.
