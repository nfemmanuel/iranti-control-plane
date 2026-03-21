# CP-T048 AC-11 — Clean-Machine QA Test Plan

**Ticket:** CP-T048 — Platform Installer Packages (MSI, .dmg, .deb)
**AC scope:** AC-11 (clean-machine validation), AC-12 (port conflict), AC-7 (version display), AC-6 (browser auto-open), AC-1/AC-2 (Windows), AC-3 (macOS), AC-4/AC-5 (Linux)
**Prepared by:** qa_engineer
**Date:** 2026-03-20
**Status:** STATIC ANALYSIS COMPLETE — ISSUE-1, ISSUE-2, ISSUE-3, ISSUE-5, ISSUE-6 RESOLVED — awaiting installer artifacts from CI for manual execution (AC-11)

---

## Static Verification Summary

The following checks were performed by reading source files directly. No running system was required.

| Check | File(s) | Result | Notes |
|---|---|---|---|
| NSIS script includes proper uninstaller (AC-2) | `scripts/package/build-windows.mjs` | PASS | `Section "Uninstall"` deletes binary, `package.json`, `Uninstall.exe`, `public/` dir, Start Menu entries, and registry key. `WriteUninstaller` in install section. Add/Remove Programs registered via `UNINSTALL_KEY`. |
| macOS `.app` bundle includes `Info.plist` | `scripts/package/build-macos.mjs` | PASS | `Info.plist` written with all required keys: `CFBundleName`, `CFBundleIdentifier`, `CFBundleVersion`, `CFBundleExecutable`, `LSMinimumSystemVersion 13.0`. |
| macOS `.app` bundle assembled correctly | `scripts/package/build-macos.mjs` | PASS | `Contents/MacOS/iranti-cp` (binary), `Contents/Resources/public/control-plane/` (assets), `Contents/Info.plist`. Ad-hoc signed with `codesign --sign - --force --deep`. |
| Linux produces both `.AppImage` and `.deb` | `scripts/package/build-linux.mjs` | PASS | Steps 4 and 5 produce both artifacts. AppImage via `appimagetool`, `.deb` via `fpm` with fallback to `dpkg-deb`. Both output to `dist/installers/`. |
| CI workflow uploads all artifacts | `.github/workflows/package.yml` | PASS | Separate `upload-artifact@v4` steps for `windows-installer`, `macos-dmg-universal`, `linux-appimage`, `linux-deb`. All use `retention-days: 7`. |
| CI workflow creates GitHub Release with all artifacts | `.github/workflows/package.yml` | PASS | `release` job uses `softprops/action-gh-release@v2`, downloads all artifacts, attaches `**/*.exe`, `**/*.dmg`, `**/*.AppImage`, `**/*.deb`. |
| SmartScreen bypass instructions in release body | `.github/workflows/package.yml` (release body) | PASS | Release body table row: "SmartScreen will show 'Windows protected your PC' — click **More info → Run anyway**". |
| Gatekeeper bypass instructions in release body | `.github/workflows/package.yml` (release body) | PASS | Release body table row: "Ad-hoc signed. Gatekeeper will block on first launch — **right-click → Open → Open** to proceed." |
| Port conflict auto-increment (AC-12) | `src/server/index.ts` | PASS | `findAvailablePort(BASE_PORT, BASE_PORT + 10)` iterates ports 3000–3010. Clear error message if none available. Port logged to stdout on start. |
| Version display (AC-7) | `src/server/index.ts` | PASS | `VERSION` exported. In SEA context: reads `package.json` from `dirname(process.execPath)`. Logged at startup: `[iranti-cp] v${VERSION} running at http://localhost:${PORT}`. |
| Browser auto-open with `process.isSea()` guard (AC-6) | `src/server/index.ts` | PASS | `import('open')` called inside `server.listen` callback only when `process.isSea?.()` is truthy. Non-fatal on failure. |
| `process.isSea()` guard for SEA path resolution | `src/server/index.ts` | PASS | `_isSea` flag set correctly using `typeof ... === 'function'` check before call. `clientDist` and `__dirname` both branch correctly. |

---

## Static Issues Found

### ISSUE-1 — macOS `.app` bundle: static asset path mismatch ✅ RESOLVED (commit 4664d49)

**Severity:** High — would have caused the macOS packaged binary to fail to serve the frontend UI

**Description:**

In `src/server/index.ts`, the SEA path resolution is:
```ts
const clientDist = _isSea
  ? resolve(dirname(process.execPath), 'public', 'control-plane')
  : resolve(__dirname, '../../public/control-plane')
```

Inside the `.app` bundle, `process.execPath` is:
```
/Applications/Iranti Control Plane.app/Contents/MacOS/iranti-cp
```

So `dirname(process.execPath)` is `Contents/MacOS/`, and the resolved `clientDist` becomes:
```
/Applications/Iranti Control Plane.app/Contents/MacOS/public/control-plane/
```

However, `build-macos.mjs` places the sidecar assets at:
```
/Applications/Iranti Control Plane.app/Contents/Resources/public/control-plane/
```

The assets are in `Contents/Resources/` but the binary resolves them relative to `Contents/MacOS/`. These are different directories — the UI will 404 on all static asset requests.

**Documentation status:** The `docs/guides/building-installers.md` guide explicitly notes this on line 209–211:
> "The current implementation places assets in `Contents/Resources/public/control-plane/` but resolves relative to `Contents/MacOS/` — a launcher script may be needed to set `IRANTI_CP_ASSETS_DIR` for the `.app` bundle case. Track this as a follow-on refinement."

This is a known issue acknowledged in the guide but not yet resolved in code. It is likely that the actual macOS binary will fail to serve the frontend.

**Test plan impact:** The macOS manual test (see below) must specifically verify that `http://localhost:PORT/control-plane` loads the UI and does not return 404s. If it fails, this is the likely cause.

**Mitigation candidates (for devops_engineer):**
- Add a wrapper shell script (`Contents/MacOS/iranti-control-plane` as a launcher that sets `IRANTI_CP_ASSETS_DIR` or `cd`s to `Contents/Resources/` before exec-ing the binary)
- Move assets to `Contents/MacOS/public/control-plane/` to match what the server resolves
- Add a `IRANTI_CP_ASSETS_DIR` env var override path to the server's asset resolution logic

---

### ISSUE-2 — `release.yml` vs `package.yml` trigger overlap

**Severity:** Low — operational confusion, not a functional defect

**Description:**

Two workflows both trigger on `push: tags: v*`:
- `.github/workflows/release.yml` — older, Node 20, produces a `.tar.gz` source archive only
- `.github/workflows/package.yml` — new, Node 22, produces platform installers

On a tagged release push, both workflows will run. The `release.yml` will create a GitHub Release with a `.tar.gz` source archive. The `package.yml` will also create a GitHub Release for the same tag. This may result in a conflict or duplicate releases depending on `softprops/action-gh-release@v2` behavior.

**Recommendation:** The `release.yml` should be either disabled or updated to not create a release (letting `package.yml` own release creation). At minimum, confirm only one workflow creates the GitHub Release.

---

### ISSUE-3 — `package.yml` macOS arch jobs do not cache npm dependencies ✅ RESOLVED (commit 38abcfd)

**Severity:** Low — CI performance only, not a correctness issue

**Description:**

The `build-macos-arm64` and `build-macos-x86` jobs in `package.yml` use `actions/setup-node@v4` but do not include `cache: 'npm'` or `cache-dependency-path`. The `build-macos-universal`, `build-windows`, and `build-linux` jobs do include caching. This makes the two macOS binary jobs slower than necessary on repeated runs.

**Resolution (commit 38abcfd):** Added `cache: 'npm'` and `cache-dependency-path: package.json\nsrc/server/package.json` to both `build-macos-arm64` and `build-macos-x86` jobs.

---

### ISSUE-4 — `build-sea.mjs` postject macOS segment name

**Severity:** Informational — needs manual verification

**Description:**

`build-sea.mjs` uses `--macho-segment-name __MACOS` for macOS. The Node.js SEA documentation specifies `__MACOS` as the correct segment name for macOS Mach-O binaries. This appears correct, but it should be validated at runtime since the `postject` documentation also mentions `__NODE_SEA` as a possible variant in older versions. If the injected blob is not found at runtime, the binary will silently fall back to non-SEA behavior.

**Test:** Run the binary on macOS and confirm `process.isSea()` returns `true` (visible in server startup behavior — the SEA path is used for static assets).

---

### ISSUE-6 — `package.yml` macOS universal CI job missing shell launcher wrapper ✅ RESOLVED (commit 38abcfd)

**Severity:** High — CI-produced macOS DMGs would have failed to load the frontend UI

**Description:**

The `build-macos-universal` inline shell script in `package.yml` was not updated when `build-macos.mjs` received the ISSUE-1 shell launcher fix. Specifically:

- The CI script set `CFBundleExecutable=iranti-cp` (direct SEA binary) instead of `iranti-control-plane` (the launcher wrapper)
- No shell launcher script was written to `Contents/MacOS/iranti-control-plane`
- `package.json` was copied to `Contents/Resources/` instead of `Contents/MacOS/` (wrong location for `dirname(process.execPath)` resolution)
- `IRANTI_CP_ASSETS_DIR` was never set, so the server resolved assets from `Contents/MacOS/public/control-plane/` (which does not exist)

The local `build-macos.mjs` was correctly fixed by ISSUE-1 resolution, but the CI inline script was left diverged, meaning CI-built DMGs would have the same asset path failure even though local builds were correct.

**Resolution (commit 38abcfd):**
- Added `iranti-control-plane` shell launcher script to `Contents/MacOS/` in the CI script
- Updated `CFBundleExecutable` to `iranti-control-plane` in the inline `Info.plist`
- Moved `package.json` copy to `Contents/MacOS/`
- Launcher sets `IRANTI_CP_ASSETS_DIR="$BUNDLE_DIR/Resources/public/control-plane"` before exec-replacing with `iranti-cp`

---

### ISSUE-5 — Linux `.deb` asset path mismatch with server SEA resolution ✅ RESOLVED (commit 4664d49)

**Severity:** Medium — would have caused the Linux `.deb` binary and AppImage to fail to serve the frontend UI

**Resolution (commit 4664d49):**
- `src/server/index.ts` now reads `IRANTI_CP_ASSETS_DIR` env var first, falling back to `process.execPath`-based resolution.
- `.deb` build: The SEA binary is now placed at `/usr/share/iranti-control-plane/bin/iranti-cp`. A shell launcher wrapper at `/usr/local/bin/iranti-control-plane` sets `IRANTI_CP_ASSETS_DIR=/usr/share/iranti-control-plane/public/control-plane` and exec-replaces with the SEA binary.
- AppImage: `AppRun` path corrected from `$HERE/usr/share/iranti-control-plane` to `$HERE/usr/share/iranti-control-plane/public/control-plane` (the correct full path to assets).
- `package.json` for `.deb` version detection now placed alongside the SEA binary at `/usr/share/iranti-control-plane/bin/package.json`.

---

## Prerequisites for Manual Testing

Before executing any manual tests, confirm:
1. CI pipeline has run successfully on a tagged commit (e.g., `v0.3.0-test`)
2. All four artifacts are available on the GitHub Release page: `.exe`, `.dmg`, `.AppImage`, `.deb`
3. Each test machine is a clean install with **no Node.js, no npm, no existing Iranti Control Plane installation**
4. Iranti is pre-installed and running at `http://localhost:3001` on each test machine (the control plane requires Iranti to be available, but basic UI load, port detection, and version display can be verified without it)
5. Document the test environment (OS version, architecture, Node.js absent confirmed via `node --version` returning "not found")

---

## Windows Test Plan

**Target OS:** Windows 10 (22H2+) or Windows 11
**Architecture:** x86_64
**Clean machine requirement:** No Node.js, no npm, no existing Iranti Control Plane install
**Installer file:** `iranti-control-plane-setup-<version>.exe`

### W-1: Download and verify artifact

1. Navigate to the GitHub Releases page for the target tag
2. Download `iranti-control-plane-setup-<version>.exe`
3. Note the file size. Expected: 50–80 MB compressed download
4. Do NOT unblock the file via Properties — let SmartScreen handle it naturally

**Expected:** File downloads without browser warnings blocking the download itself

---

### W-2: SmartScreen warning on launch

1. Double-click the downloaded `.exe`
2. Observe the Windows SmartScreen dialog: "Windows protected your PC"

**Expected:** SmartScreen dialog appears with the message "Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from starting."

3. Click **More info**
4. Confirm the "Run anyway" button appears and shows the app name "Iranti Control Plane" and the publisher as "Unknown Publisher"
5. Click **Run anyway**

**Expected:** UAC (User Account Control) prompt appears requesting administrator access (because `RequestExecutionLevel admin` is set in NSIS)

6. Click **Yes** on the UAC prompt

**Expected:** NSIS installer wizard opens

---

### W-3: Installer wizard

1. Proceed through the installer wizard:
   - **Welcome page:** Confirm "Welcome to Iranti Control Plane Setup" text appears
   - **Directory page:** Confirm default install path is `C:\Program Files\Iranti Control Plane\` (or `C:\Program Files (x86)\` on 32-bit — not expected; verify it targets 64-bit Program Files)
   - **Install page:** Confirm installation proceeds without errors
   - **Finish page:** Confirm installer completes successfully

**Expected:** All wizard pages render without errors. Installation completes.

---

### W-4: Start menu entry

1. Open the Start menu
2. Search for "Iranti Control Plane"

**Expected:** "Iranti Control Plane" shortcut appears in Start menu under the "Iranti Control Plane" folder. An "Uninstall" shortcut should also be present.

---

### W-5: Launch from Start menu — server startup and browser auto-open (AC-1, AC-6)

1. Click "Iranti Control Plane" in the Start menu
2. Observe: a terminal window or console window opens (if `Terminal=true` in the binary — Windows SEA binaries are console applications by default)
3. Read the startup output

**Expected console output contains:**
```
[iranti-cp] v<version> running at http://localhost:300x
[iranti-cp] API at http://localhost:300x/api/control-plane/
```

4. Within 2–5 seconds, the default browser should auto-open to `http://localhost:300x`

**Expected:** Default browser opens to the control plane URL automatically (AC-6)

---

### W-6: UI loads and health view is reachable (AC-1)

1. In the browser, confirm the control plane UI loads at `http://localhost:300x`
2. Navigate to the health/status view (typically `/control-plane` or the root redirect)
3. Confirm the `/health` endpoint is reachable: open `http://localhost:300x/api/control-plane/health` in the browser

**Expected:** Control plane React UI loads. Health endpoint returns JSON with server status.

---

### W-7: Version display matches installer version (AC-7)

1. In the control plane UI, navigate to the Health view or About section
2. Note the version string displayed
3. Compare against the installer filename version

**Expected:** Version string in UI matches `<version>` in the installer filename (e.g., `0.3.0`)

Also verify via terminal output: `[iranti-cp] v0.3.0 running at...`

---

### W-8: Port conflict auto-increment (AC-12)

**Setup:** Block port 3000 before launching the installer binary.

1. Open PowerShell as Administrator
2. Run: `netstat -ano | findstr :3000` — if no output, start a placeholder listener:
   ```powershell
   $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 3000)
   $listener.Start()
   ```
3. Launch "Iranti Control Plane" from the Start menu
4. Observe terminal output

**Expected:**
- Server does NOT fail or crash
- Terminal output shows a port other than 3000 selected, e.g.: `[iranti-cp] v0.3.0 running at http://localhost:3001`
- Browser auto-opens to the correct alternate port URL

5. Also block ports 3000–3010 to test the exhaustion case:
   - Start 11 TCP listeners on ports 3000–3010
   - Launch the binary
   - **Expected:** Binary exits with an error message: `No available port in range 3000–3010. Free one of those ports and try again.`
6. Clean up the placeholder listeners

---

### W-9: Uninstall via Add/Remove Programs (AC-2)

1. Open **Settings → Apps → Installed apps** (Windows 11) or **Control Panel → Add/Remove Programs** (Windows 10)
2. Search for "Iranti Control Plane"
3. Confirm it appears in the list with the correct version
4. Click Uninstall
5. Confirm the uninstall confirmation dialog appears
6. Proceed with uninstall

**Expected after uninstall:**
- `C:\Program Files\Iranti Control Plane\` directory is deleted (or empty if NSIS leaves it — check `RMDir` behavior)
- Start menu entry "Iranti Control Plane" is removed
- "Iranti Control Plane" no longer appears in Apps list
- Registry key `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\IrantiControlPlane` is deleted

**Verify with:**
```powershell
Test-Path "C:\Program Files\Iranti Control Plane"   # should return False
Get-ItemProperty "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\IrantiControlPlane" 2>$null  # should return nothing
```

---

### W-10: No Node.js prerequisite (AC-8)

1. Before any of the above tests, confirm Node.js is absent:
   ```cmd
   node --version
   ```
   **Expected:** "node is not recognized as an internal or external command" (or similar)

2. The control plane binary must have launched and served the UI in W-5/W-6 without any Node.js on PATH

**Pass criterion:** If W-5 and W-6 passed and `node --version` returns "not found", AC-8 is confirmed for Windows.

---

## macOS Test Plan

**Target OS:** macOS 13 (Ventura) or macOS 14 (Sonoma)
**Architecture:** Universal binary (arm64 + x86_64 — test on one Apple Silicon Mac and one Intel Mac if available, or Apple Silicon only if resource-constrained)
**Clean machine requirement:** No Node.js, no Homebrew Node, no nvm, no existing Iranti Control Plane
**Installer file:** `iranti-control-plane-universal-<version>.dmg`

### M-1: Download and mount DMG

1. Download `iranti-control-plane-universal-<version>.dmg` from GitHub Releases
2. Note the file size. Expected: 50–80 MB
3. Double-click the `.dmg` to mount it
4. A Finder window should open showing the "Iranti Control Plane.app" and an Applications folder alias (drag-to-Applications pattern)

**Expected:** DMG mounts and opens a Finder window with the app and Applications alias visible

---

### M-2: Drag to Applications

1. Drag "Iranti Control Plane.app" to the Applications folder alias in the DMG window
2. If prompted to replace an existing version, click Replace
3. Eject the DMG (drag to Trash or right-click → Eject)

**Expected:** App copied to `/Applications/Iranti Control Plane.app`

---

### M-3: Gatekeeper warning on first launch (AC-3)

1. Open Finder → Applications
2. Double-click "Iranti Control Plane"
3. **Expected:** Gatekeeper dialog appears: "Apple can't check it for malicious software" or "Iranti Control Plane cannot be opened because it is from an unidentified developer"
4. Click **OK** (or **Cancel** — do not click Open yet)

**Expected:** Gatekeeper blocks the launch. This is correct behavior for ad-hoc signed but not notarized apps.

5. Right-click (or Control+click) "Iranti Control Plane" in Finder
6. Select **Open** from the context menu
7. A dialog appears asking to confirm — click **Open**

**Expected:** App launches after the right-click → Open bypass. On subsequent launches, double-clicking works without the warning.

---

### M-4: Server startup and browser auto-open (AC-3, AC-6)

1. After Gatekeeper bypass, observe that a terminal window or the app begins (may appear in the Dock)
2. Check the macOS Console (`Console.app`) or any terminal output for:
   ```
   [iranti-cp] v<version> running at http://localhost:300x
   ```
3. Within 2–5 seconds, the default browser should auto-open to the control plane URL

**Expected:** Server starts and browser opens automatically to the control plane UI

---

### M-5: UI loads and health view reachable

1. Confirm the control plane React UI loads at `http://localhost:300x`
2. Check `http://localhost:300x/api/control-plane/health` returns JSON

**Expected:** UI loads. Health endpoint returns JSON status.

**IMPORTANT — verify ISSUE-1:** If the UI loads but shows broken/missing styles or `Cannot GET /control-plane`, this confirms ISSUE-1 (asset path mismatch). Document exact error and the URL that fails. Check browser DevTools Network tab for 404 responses on static assets. Report the exact path being requested vs where assets exist in the `.app` bundle.

---

### M-6: Universal binary architecture verification

Run the following from Terminal:

```bash
lipo -archs "/Applications/Iranti Control Plane.app/Contents/MacOS/iranti-cp"
```

**Expected output:** `x86_64 arm64`

Also verify:
```bash
file "/Applications/Iranti Control Plane.app/Contents/MacOS/iranti-cp"
```

**Expected output** (approximately): `Mach-O universal binary with 2 architectures: [x86_64:Mach-O 64-bit executable x86_64] [arm64:Mach-O 64-bit executable arm64]`

---

### M-7: Info.plist validation

```bash
plutil -p "/Applications/Iranti Control Plane.app/Contents/Info.plist"
```

**Expected:** Valid plist output containing:
- `CFBundleIdentifier = "com.iranti.control-plane"`
- `CFBundleVersion = "<version>"`
- `CFBundleExecutable = "iranti-cp"`
- `LSMinimumSystemVersion = "13.0"`

---

### M-8: Version display matches installer version (AC-7)

Same procedure as W-7 but on macOS. Verify version in UI matches DMG filename version.

---

### M-9: Port conflict auto-increment (AC-12)

1. Open Terminal
2. Start a placeholder listener on port 3000:
   ```bash
   nc -l 3000 &
   NC_PID=$!
   ```
3. Launch the app (double-click from Applications)
4. Check terminal/console output

**Expected:** Server starts on port 3001 (or next available). Browser opens to the correct alternate port.

5. Kill the placeholder: `kill $NC_PID`

---

### M-10: No Node.js prerequisite (AC-8)

1. Before testing, confirm Node.js is absent:
   ```bash
   node --version
   which node
   ```
   **Expected:** "command not found" or no output

**Pass criterion:** M-4 and M-5 passed and Node.js was not on PATH.

---

### M-11: Relaunch after quit

1. Quit the app (Cmd+Q or close the terminal window)
2. Double-click "Iranti Control Plane" from Applications again (no Gatekeeper prompt this time)

**Expected:** App relaunches cleanly without repeating the Gatekeeper bypass step. This confirms the ad-hoc signing is persistent after the first bypass.

---

## Linux Test Plan

**Target OS:** Ubuntu 22.04 LTS (fresh install or clean VM)
**Architecture:** x86_64 (amd64)
**Clean machine requirement:** No Node.js (confirm `node --version` returns "not found"), no existing Iranti Control Plane
**Installer files:** `iranti-control-plane-<version>.AppImage` and `iranti-control-plane_<version>_amd64.deb`

### L-1: AppImage — download and mark executable

1. Download `iranti-control-plane-<version>.AppImage`
2. Note file size. Expected: 50–80 MB
3. Mark executable:
   ```bash
   chmod +x iranti-control-plane-<version>.AppImage
   ```
4. Confirm no Node.js present:
   ```bash
   node --version   # expected: "command not found"
   which node       # expected: no output
   ```

---

### L-2: AppImage — launch and verify server startup

```bash
./iranti-control-plane-<version>.AppImage
```

**Expected terminal output:**
```
[iranti-cp] v<version> running at http://localhost:300x
[iranti-cp] API at http://localhost:300x/api/control-plane/
```

On a desktop Linux environment, the default browser should open automatically (AC-6). On a headless server, the URL should be printed and the server should listen for connections.

**IMPORTANT — verify ISSUE-5 (AppImage):** The `AppRun` script sets `IRANTI_CP_ASSETS_DIR` but `src/server/index.ts` does not read this variable. The server uses `process.execPath`-based resolution instead. If the UI loads correctly, confirm how assets were found (the AppImage may embed them relative to the extracted binary path — verify). If the UI fails to load, this confirms ISSUE-5. Document exact error.

---

### L-3: AppImage — UI loads and health endpoint reachable

1. Open browser to `http://localhost:300x` (use the port from L-2 output)
2. Confirm control plane UI loads
3. Check `http://localhost:300x/api/control-plane/health`

**Expected:** UI loads. Health endpoint returns JSON.

---

### L-4: AppImage — port conflict (AC-12)

1. Start a listener on port 3000:
   ```bash
   nc -l 3000 &
   NC_PID=$!
   ```
2. Launch the AppImage
3. Observe output — expected: next available port used

4. Kill listener: `kill $NC_PID`

---

### L-5: AppImage — version display (AC-7)

Verify version in UI matches AppImage filename version.

---

### L-6: .deb — install

```bash
sudo dpkg -i iranti-control-plane_<version>_amd64.deb
```

**Expected output:** No errors. Package installs cleanly. Check:

```bash
dpkg -l iranti-control-plane          # should show 'ii' (installed)
which iranti-control-plane             # should return /usr/local/bin/iranti-control-plane
ls /usr/share/iranti-control-plane/   # should show package.json and public/ directory
ls /usr/share/applications/iranti-control-plane.desktop   # should exist
```

---

### L-7: .deb — launch from terminal

```bash
iranti-control-plane
```

**Expected terminal output:**
```
[iranti-cp] v<version> running at http://localhost:300x
```

On a desktop environment, browser should auto-open.

**IMPORTANT — verify ISSUE-5 (.deb):** `process.execPath` is `/usr/local/bin/iranti-control-plane`. The server resolves assets at `/usr/local/bin/public/control-plane/` which does not exist. Assets are at `/usr/share/iranti-control-plane/public/control-plane/`. If the UI fails to load with 404s, this confirms ISSUE-5. Document exact error.

---

### L-8: .deb — UI loads and health endpoint reachable

Same as L-3 but against the `.deb` install.

---

### L-9: .deb — desktop entry

On a GNOME/KDE desktop environment:
1. Open the application menu / Activities
2. Search for "Iranti Control Plane"

**Expected:** The app appears in the application menu (from the `.desktop` file at `/usr/share/applications/iranti-control-plane.desktop`)

---

### L-10: .deb — port conflict (AC-12)

Same procedure as L-4 but with the `.deb` installed binary.

---

### L-11: .deb — version display (AC-7)

Same as L-5 but for the `.deb` install.

---

### L-12: .deb — uninstall

```bash
sudo dpkg -r iranti-control-plane
```

**Expected:**
- Command succeeds with no errors
- `which iranti-control-plane` returns nothing
- `/usr/local/bin/iranti-control-plane` is removed
- `dpkg -l iranti-control-plane` shows `rc` (removed, config remains) or `un` (fully removed)

Purge config files if desired:
```bash
sudo dpkg --purge iranti-control-plane
```

---

### L-13: No Node.js prerequisite (AC-8)

Confirm before all Linux tests:
```bash
node --version   # expected: "command not found"
npm --version    # expected: "command not found"
```

**Pass criterion:** L-2 or L-7 passed (server started) while Node.js was absent from PATH.

---

## Cross-Platform: Version Display (AC-7) Summary Table

After testing each platform, fill in:

| Platform | Installer version | Version in UI | Match? |
|---|---|---|---|
| Windows | | | |
| macOS | | | |
| Linux AppImage | | | |
| Linux .deb | | | |

---

## Cross-Platform: Port Conflict (AC-12) Summary Table

| Platform | Port 3000 blocked | Resolved port shown | Browser opened to correct port | Pass? |
|---|---|---|---|---|
| Windows | | | | |
| macOS | | | | |
| Linux AppImage | | | | |
| Linux .deb | | | | |

---

## Test Result Report Template

The QA engineer should complete the following table after manual testing and submit it to the PM:

### Per-Platform Pass/Fail Table

| AC | Description | Windows | macOS | Linux AppImage | Linux .deb |
|---|---|---|---|---|---|
| AC-1 | Installer completes, Start menu/Applications entry created | | | N/A | N/A |
| AC-2 | Uninstaller removes all files cleanly | | N/A | N/A | L-12 |
| AC-3 | macOS DMG: drag-to-Applications, Gatekeeper bypass | N/A | | N/A | N/A |
| AC-4 | AppImage: `chmod +x` and run, no dependencies | N/A | N/A | | N/A |
| AC-5 | .deb: `dpkg -i`, launch from terminal | N/A | N/A | N/A | |
| AC-6 | Browser auto-opens to correct URL | | | | |
| AC-7 | Version in UI matches installer version | | | | |
| AC-8 | No Node.js required (clean machine confirmed) | | | | |
| AC-11 | Clean-machine test (no Node.js, no existing install) | | | | |
| AC-12 | Port conflict: auto-increments to next available port | | | | |
| ISSUE-1 | macOS: assets load from `.app/Contents/Resources/` | N/A | | N/A | N/A |
| ISSUE-5 | Linux: assets load from `/usr/share/iranti-control-plane/` | N/A | N/A | | |

---

## Known Issues to Document in Report

The following items were found during static analysis. Manual testing should confirm or refute them:

1. **ISSUE-1 (macOS asset path):** Expected FAIL. The server's `process.execPath`-relative path resolution points to `Contents/MacOS/public/control-plane/` but assets are in `Contents/Resources/public/control-plane/`. Manual test M-5 will confirm.

2. **ISSUE-5 (Linux asset path):** Expected FAIL for both `.deb` and `.AppImage`. The server resolves assets relative to `process.execPath` (`/usr/local/bin/` for .deb), but assets are installed to `/usr/share/iranti-control-plane/`. Manual tests L-3 and L-8 will confirm.

3. **ISSUE-2 (release.yml conflict):** Not testable manually in the same way — verify in the GitHub Actions run log that only one GitHub Release is created for the tag.

These issues should be reported to the devops_engineer and PM before the release is published to users.
