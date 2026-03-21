# CP-T048 AC-11 — Clean-Machine Validation Checklist

**Ticket:** CP-T048 — Platform Installer Packages (MSI, .dmg, .deb)
**AC scope:** AC-11 (clean-machine validation)
**Prepared by:** qa_engineer
**Date:** 2026-03-21
**Status:** Ready for human tester

---

## What This Checklist Is For

AC-11 requires proof that Iranti Control Plane installs and runs on a machine with no Node.js, no npm, and no prior Iranti Control Plane installation. This cannot be verified in CI — it requires a physical computer or a virtual machine that has been freshly provisioned.

This checklist is designed to be followed by a non-developer. You do not need to understand the code. You do need a computer (or VM) that meets the requirements below, and the ability to download a file and click through a setup wizard.

---

## Part 1: What You Need Before Starting

### 1.1 Get the Installer Files

The installer files are attached to the GitHub Release for this version. You need to download the correct file for your operating system:

| Platform | File to download |
|---|---|
| Windows | `iranti-control-plane-setup-<version>.exe` |
| macOS | `iranti-control-plane-universal-<version>.dmg` |
| Linux (no package manager) | `iranti-control-plane-<version>.AppImage` |
| Linux (Debian/Ubuntu) | `iranti-control-plane_<version>_amd64.deb` |

Replace `<version>` with the actual version number shown on the Release page (e.g., `0.3.0`). Write it down:

**Version being tested:** `_______________`

**Release URL where you downloaded the files:** `_______________`

---

### 1.2 What Is a "Clean Machine"?

A clean machine means:

- **No Node.js installed.** Node.js is a JavaScript runtime. You can check: open a Terminal (or Command Prompt on Windows) and type `node --version`. If you get an error like "command not found" or "not recognized," Node.js is absent. If you see a version number (like `v20.0.0`), the machine is NOT clean for this test.
- **No npm installed.** npm is Node's package manager. Check: type `npm --version`. Same rule — "not found" means it is absent.
- **No prior Iranti Control Plane installation.** If you previously installed it, uninstall it first using the system's standard uninstall method (Windows: Settings → Apps; macOS: drag app to Trash; Linux: `sudo dpkg -r iranti-control-plane`).

You can use a virtual machine (VM) with a fresh OS install, or a dedicated test machine. A cloud VM with a fresh OS image also works.

---

### 1.3 Record Your Test Environment

Fill this in before starting any tests. The PM needs this information to accept the results.

| Field | Your answer |
|---|---|
| OS name | (e.g., Windows 11 Home, macOS 14.4 Sonoma, Ubuntu 22.04 LTS) |
| OS version / build | (e.g., Build 22631, 23.4.0, 22.04.3 LTS) |
| Machine type | (e.g., physical laptop, VMware VM, VirtualBox VM, cloud instance) |
| CPU architecture | (e.g., x86_64 / amd64, Apple Silicon arm64, Intel x86_64) |
| `node --version` before install | (should say "not found" or similar) |
| `npm --version` before install | (should say "not found" or similar) |
| Installer file downloaded | (exact filename including version) |
| Date of test | |
| Your name | |

---

## Part 2: Windows Checklist

Use this section if you are testing on **Windows 10 (22H2 or later) or Windows 11**.

### Step W-1: Confirm Node.js is absent

1. Press `Win + R`, type `cmd`, press Enter.
2. Type `node --version` and press Enter.
3. **Required:** The output should say "node is not recognized as an internal or external command" or similar. If it prints a version number, stop — the machine is not clean.

- [ ] Node.js is absent on this machine

### Step W-2: Download the installer

1. Go to the GitHub Releases page.
2. Download `iranti-control-plane-setup-<version>.exe`.
3. Save it somewhere easy to find (Desktop is fine).

- [ ] Installer file downloaded

### Step W-3: Launch the installer — SmartScreen bypass

Because this app is not from a well-known publisher, Windows shows a security warning. This is expected.

1. Double-click the `.exe` file you downloaded.
2. A blue screen appears saying **"Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from starting."**
   - [ ] SmartScreen warning appeared (this is expected behavior)
3. Click **More info** (a link near the bottom of the blue box).
4. A second button labeled **"Run anyway"** appears. The app name should say "Iranti Control Plane" and publisher should say "Unknown Publisher."
   - [ ] "Run anyway" button appeared
5. Click **Run anyway**.
6. A Windows User Account Control dialog appears asking for administrator permission.
   - [ ] UAC prompt appeared
7. Click **Yes**.

### Step W-4: Run through the installer wizard

1. An installer wizard opens.
2. Proceed through each screen:
   - Welcome screen appears: confirm text mentions "Iranti Control Plane"
   - Installation directory screen: note the default path (expected: `C:\Program Files\Iranti Control Plane\`)
   - Install progress bar runs to completion
   - Finish screen appears
3. Click **Finish**.

- [ ] Installer wizard completed without errors
- [ ] Default install path: `_______________ ` (write in what was shown)

### Step W-5: Launch from Start Menu

1. Open the Start menu (Windows key or click the Windows logo).
2. Type "Iranti Control Plane" in the search box.
3. Click the "Iranti Control Plane" shortcut.

- [ ] "Iranti Control Plane" shortcut found in Start menu

4. A black terminal/console window opens and shows text like:
   ```
   [iranti-cp] v0.x.x running at http://localhost:3000
   [iranti-cp] API at http://localhost:3000/api/control-plane/
   ```
   - [ ] Terminal window opened with startup text
   - [ ] Port number shown: `_______` (e.g., 3000 or 3001)

5. Within 5 seconds, your default web browser should automatically open to `http://localhost:3000` (or whatever port was shown).
   - [ ] Browser opened automatically
   - [ ] URL in browser matches port shown in terminal

### Step W-6: Confirm the UI loads

1. In the browser, the Iranti Control Plane interface should appear.
2. Navigate to the Health page (look for "Health" in the left sidebar).

- [ ] Control plane UI loaded in browser
- [ ] Health page is reachable

### Step W-7: Confirm version number matches installer

1. In the control plane UI, find the version number. It may appear in:
   - The Health view (look for "runtime_version" check or a version badge)
   - The startup text in the terminal window (e.g., `[iranti-cp] v0.3.0 running at...`)
2. Note the version: `_______________`
3. Compare to the version in the installer filename (e.g., if file was `iranti-control-plane-setup-0.3.0.exe`, expected version is `0.3.0`).

- [ ] Version shown in UI: `_______________ `
- [ ] Version matches installer filename: Yes / No

### Step W-8: Uninstall

1. Open **Settings** → **Apps** (Windows 11) or **Control Panel** → **Add/Remove Programs** (Windows 10).
2. Search for "Iranti Control Plane."
3. Click Uninstall.
4. Confirm the uninstall dialog.
5. Wait for uninstall to complete.

- [ ] "Iranti Control Plane" appeared in Apps list
- [ ] Uninstall completed without errors
- [ ] Start menu shortcut is gone after uninstall

---

## Part 3: macOS Checklist

Use this section if you are testing on **macOS 13 (Ventura) or macOS 14 (Sonoma) or later**.

### Step M-1: Confirm Node.js is absent

1. Open Terminal (Applications → Utilities → Terminal, or press `Cmd+Space` and search "Terminal").
2. Type `node --version` and press Enter.
3. **Required:** The output should say "command not found." If it prints a version number, stop — the machine is not clean.

- [ ] Node.js is absent on this machine

### Step M-2: Download and mount the DMG

1. Go to the GitHub Releases page.
2. Download `iranti-control-plane-universal-<version>.dmg`.
3. Double-click the `.dmg` file to open it.
4. A Finder window opens showing the app icon and an Applications folder arrow.

- [ ] DMG mounted and Finder window opened

### Step M-3: Drag the app to Applications

1. In the Finder window that opened, drag the "Iranti Control Plane" app icon to the Applications folder icon in the same window.
2. If a dialog asks to replace an existing version, click **Replace**.
3. Eject the DMG (drag the disk icon on your Desktop to the Trash, or right-click the disk in Finder's sidebar and click Eject).

- [ ] App copied to /Applications
- [ ] DMG ejected

### Step M-4: Launch — Gatekeeper bypass

Because this app is ad-hoc signed but not Apple-notarized, macOS will block the first launch. This is expected.

1. Open Finder → Applications (or press `Cmd+Shift+A`).
2. Double-click "Iranti Control Plane."
3. A dialog appears saying **"Apple can't check it for malicious software"** or **"cannot be opened because it is from an unidentified developer."**
   - [ ] Gatekeeper warning appeared (this is expected behavior)
4. Click **OK** or **Cancel** on this first dialog (do NOT click Open yet).
5. Now, **right-click** (or Control+click) the "Iranti Control Plane" icon in Applications.
6. From the context menu, select **Open**.
7. A new dialog appears asking you to confirm. Click **Open**.

- [ ] App launched after right-click → Open bypass
- [ ] Note: On subsequent launches, double-clicking works normally without this bypass

### Step M-5: Confirm app is running

1. After launching, the app may appear as a new icon in your Dock.
2. Check the Console app for log output (optional — the app may not open a visible terminal window on macOS):
   - Open Console.app (Applications → Utilities → Console)
   - Filter for "iranti-cp"
3. Within 5 seconds, your default web browser should open to `http://localhost:3000` (or another port).
   - [ ] Browser opened automatically
   - [ ] URL in browser: `http://localhost:______`

### Step M-6: Confirm the UI loads

1. In the browser, the Iranti Control Plane interface should appear.

- [ ] Control plane UI loaded in browser

### Step M-7: Confirm version number matches installer

1. Find the version number in the UI (Health view or startup console output).
2. Note the version: `_______________`
3. Compare to the version in the DMG filename.

- [ ] Version shown: `_______________ `
- [ ] Matches DMG filename version: Yes / No

### Step M-8: Quit and relaunch

1. Quit the app: `Cmd+Q` or right-click the Dock icon → Quit. Close the browser window.
2. Double-click the app from Applications (normal launch — no right-click needed this time).
3. The app should relaunch without the Gatekeeper warning.

- [ ] App relaunched cleanly without Gatekeeper warning on second launch
- [ ] Browser opened again on second launch

---

## Part 4: Linux AppImage Checklist

Use this section if you are testing the **AppImage** on **Ubuntu 22.04 LTS** or similar Debian-based desktop Linux.

### Step L-1: Confirm Node.js is absent

1. Open a Terminal.
2. Run `node --version`. Expected: "command not found."
3. Run `npm --version`. Expected: "command not found."

- [ ] Node.js is absent
- [ ] npm is absent

### Step L-2: Download and prepare the AppImage

1. Go to the GitHub Releases page.
2. Download `iranti-control-plane-<version>.AppImage`.
3. In Terminal, navigate to where you saved it (e.g., `cd ~/Downloads`).
4. Make it executable:
   ```bash
   chmod +x iranti-control-plane-<version>.AppImage
   ```
   (Replace `<version>` with the actual version number.)

- [ ] AppImage downloaded
- [ ] Marked as executable with `chmod +x`

### Step L-3: Run the AppImage

```bash
./iranti-control-plane-<version>.AppImage
```

Expected output in the terminal:
```
[iranti-cp] v<version> running at http://localhost:3000
[iranti-cp] API at http://localhost:3000/api/control-plane/
```

- [ ] AppImage ran without error
- [ ] Port number shown: `_______`
- [ ] On a desktop environment: browser opened automatically. (On a headless server: skip browser check, just confirm the URL printed.)

### Step L-4: Confirm UI loads

1. Open a browser to `http://localhost:3000` (use the port from the output above).

- [ ] UI loaded in browser

### Step L-5: Confirm version number

1. Note the version from the terminal output or the UI.
2. Compare to the version in the AppImage filename.

- [ ] Version shown: `_______________ `
- [ ] Matches AppImage filename version: Yes / No

### Step L-6: Stop the AppImage

Press `Ctrl+C` in the terminal where it is running.

- [ ] AppImage stopped cleanly

---

## Part 5: Linux .deb Checklist

Use this section if you are testing the **.deb package** on **Ubuntu 22.04 LTS** or similar Debian/Ubuntu system.

### Step D-1: Confirm Node.js is absent

Same as L-1 above.

- [ ] Node.js absent
- [ ] npm absent

### Step D-2: Download and install the .deb

1. Download `iranti-control-plane_<version>_amd64.deb` from the GitHub Releases page.
2. In Terminal, navigate to the download directory and run:
   ```bash
   sudo dpkg -i iranti-control-plane_<version>_amd64.deb
   ```
   Enter your password when prompted.

Expected: Installation output with no errors. Lines like "Unpacking iranti-control-plane" and "Setting up iranti-control-plane" should appear.

- [ ] `.deb` installed without errors

### Step D-3: Verify installation

Run:
```bash
which iranti-control-plane
```
Expected: `/usr/local/bin/iranti-control-plane`

- [ ] Binary found at `/usr/local/bin/iranti-control-plane`

### Step D-4: Launch from Terminal

```bash
iranti-control-plane
```

Expected output:
```
[iranti-cp] v<version> running at http://localhost:3000
```

- [ ] Command ran without error
- [ ] Port shown: `_______`
- [ ] Browser opened (on desktop environment)

### Step D-5: Confirm UI loads

1. Open `http://localhost:3000` in a browser.

- [ ] UI loaded

### Step D-6: Confirm version number

- [ ] Version shown: `_______________ `
- [ ] Matches .deb filename version: Yes / No

### Step D-7: Uninstall

```bash
sudo dpkg -r iranti-control-plane
```

Verify:
```bash
which iranti-control-plane   # should produce no output
```

- [ ] Uninstall completed without errors
- [ ] `which iranti-control-plane` returns no output

---

## Part 6: Pass/Fail Table

Fill this in after completing the tests. Mark each cell: **Pass**, **Fail**, **Blocked** (explain in Notes), or **N/A** (not applicable to this platform).

| Check | Windows | macOS | Linux AppImage | Linux .deb |
|---|---|---|---|---|
| Node.js absent before install (AC-11) | | | | |
| Installer downloaded successfully | | | | |
| Security bypass worked (SmartScreen / Gatekeeper / chmod +x) | | | | |
| App launched without error | | | | |
| Browser opened automatically to correct URL (AC-6) | | | | |
| UI loaded in browser (AC-1 / AC-3 / AC-4 / AC-5) | | | | |
| Version in UI matches installer version (AC-7) | | | | |
| Uninstall removed app cleanly (AC-2 / AC-5 for .deb) | | | | |
| **Overall: clean-machine test PASS?** | | | | |

---

## Part 7: What to Record and Send Back

After completing the tests, send the following to the PM:

1. **This checklist** with all boxes checked and all blanks filled in.

2. **The environment table** from Part 1 Section 1.3 (OS version, architecture, installer filename, etc.).

3. **The pass/fail table** from Part 6 with each cell filled in.

4. **For any FAIL:** A brief description of what happened:
   - Which step failed?
   - What was shown on the screen? (A screenshot if possible.)
   - What did you expect to happen?
   - Did the app crash, show an error, or simply not behave as described?

5. **The version string** shown in the UI for each platform tested.

6. **Any unexpected behavior** not covered by the steps above.

---

## Part 8: Common Problems

**"SmartScreen won't go away" (Windows):** Make sure you clicked "More info" first. The "Run anyway" button only appears after clicking "More info."

**"Gatekeeper keeps blocking even after right-click → Open" (macOS):** Go to System Settings → Privacy & Security. Scroll to the "Security" section. There may be a note about Iranti Control Plane being blocked. Click "Open Anyway."

**"The browser does not open automatically" (any platform):** The app is still working — just open a browser manually and go to `http://localhost:3000`. The automatic open is a convenience feature and may be suppressed by browser settings on some machines.

**"The UI shows but looks broken / all grey / no styles":** Take a screenshot and send it. Note the URL that was open. Open browser Developer Tools (F12) → Network tab, look for requests with red (failing) status, and note the URL of the failing request. This helps the development team diagnose asset path issues.

**"I don't know what version to look for":** The version should be visible in the startup terminal output line `[iranti-cp] vX.X.X running at...`. The same version appears in the installer filename and in the GitHub Release title.
