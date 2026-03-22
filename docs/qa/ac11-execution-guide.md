# AC-11 Clean-Machine Execution Guide

**For ticket:** CP-T075 / CP-T048 AC-11
**Prepared by:** qa_engineer
**Date:** 2026-03-21
**Status:** Ready for human tester

This guide tells you exactly what to do to execute AC-11 (clean-machine installer validation) for Iranti Control Plane. It is written for someone who can follow instructions but does not need to understand the code.

AC-11 is the last gate before v0.3.0 and v0.4.0 can be formally released. It cannot be automated — it requires a real or virtual machine with no Node.js installed.

---

## Overview: What You Are Testing

The Iranti Control Plane ships as a self-contained binary. It does NOT require Node.js, npm, or any JavaScript runtime to be installed on the user's machine. It bundles everything it needs.

Your job is to prove that claim is true by:
1. Getting a machine that definitely has no Node.js
2. Installing the control plane on it
3. Confirming it starts, opens a browser, and shows the UI

---

## Before You Begin

### What You Need

- **A Windows 10 (22H2+) or Windows 11 machine or VM** — fresh install or a known-clean snapshot. Physical machine or virtualized (VMware, VirtualBox, Hyper-V, cloud VM) all work.
- **Internet access on the test machine** (to download the installer from GitHub)
- **The installer file** — see below
- **30–60 minutes** for the full test

### Getting the Installer

The installer is attached to the GitHub Release for the version being tested. Go to:

```
https://github.com/iranti/iranti-control-plane/releases
```

Download the file named `iranti-control-plane-setup-<version>.exe` (e.g., `iranti-control-plane-setup-0.4.0.exe`).

If no GitHub Release exists yet, ask the development team to run the CI pipeline (`package.yml` workflow on a tagged commit) and provide you with the artifact. The Windows installer will be uploaded as a CI artifact named `windows-installer`.

**Write down the version number here:** `______________`

---

## Part 1: Prepare the Test Machine

### 1.1 Confirm Node.js is Absent

Open a Command Prompt (press `Win + R`, type `cmd`, press Enter).

Run:
```cmd
node --version
```

**Required result:** `'node' is not recognized as an internal or external command` (or similar — any error is correct).

**If you see a version number like `v20.0.0`:** Stop. This machine has Node.js installed. Use a different machine or VM, or uninstall Node.js via Settings → Apps before proceeding.

- [ ] `node --version` returns an error (Node.js is absent)

### 1.2 Confirm No Existing Iranti Installation

Run:
```cmd
dir "C:\Program Files\Iranti Control Plane" 2>nul
```

**Required result:** The directory does not exist (you get "The system cannot find the path specified" or no output).

If the directory exists, uninstall the existing version via Settings → Apps → search for "Iranti Control Plane" → Uninstall, then verify the directory is gone.

- [ ] No existing Iranti Control Plane installation

### 1.3 Record the Test Environment

Fill this in before running any tests. Send it to the PM with your results.

| Field | Your answer |
|---|---|
| OS name and version | (e.g., Windows 11 Home 22H2, Build 22621) |
| Machine type | (e.g., physical laptop, VMware VM, VirtualBox, Azure VM) |
| CPU architecture | (x86_64 / amd64 — should be 64-bit) |
| `node --version` before install | (copy the exact output — should be an error) |
| Installer filename | (exact filename including version) |
| Where you downloaded it from | (GitHub Release URL or CI artifact link) |
| Date of test | |
| Your name | |

---

## Part 2: Install

### 2.1 Run the Installer — SmartScreen

1. Double-click `iranti-control-plane-setup-<version>.exe`.

2. A blue screen appears titled **"Windows protected your PC"** with the message "Microsoft Defender SmartScreen prevented an unrecognized app from starting." This is expected — the app does not have a commercial code signing certificate yet.

   - [ ] SmartScreen warning appeared

3. Click **More info** (a small link near the bottom of the blue screen).

4. The screen changes to show an "App:" line (should say "iranti-control-plane-setup-...") and a **"Run anyway"** button.

   - [ ] "Run anyway" button appeared

5. Click **Run anyway**.

6. A Windows **User Account Control** dialog appears asking if you want to allow this app to make changes to your device. The app name should show "iranti-control-plane-setup-..."

   - [ ] UAC prompt appeared

7. Click **Yes**.

### 2.2 Installer Wizard

The NSIS installer wizard opens.

1. **Welcome screen:** Text should mention "Iranti Control Plane". Click **Next**.

   - [ ] Welcome screen appeared

2. **Destination folder screen:** The default install path should be `C:\Program Files\Iranti Control Plane\`. You can leave this as-is. Click **Install**.

   - [ ] Default install path: `______________` (write down what was shown)

3. **Installing:** A progress bar shows the installation. Wait for it to complete.

   - [ ] Installation ran without error

4. **Finish screen:** Click **Finish**.

   - [ ] Finish screen appeared and was clicked

---

## Part 3: Launch and Verify

### 3.1 Find the Start Menu Entry

1. Press the Windows key.
2. Type `Iranti Control Plane`.

   - [ ] "Iranti Control Plane" shortcut appears in Start menu search results

3. Also confirm an "Uninstall" shortcut appears (may be inside an "Iranti Control Plane" folder in the Start menu).

   - [ ] Uninstall shortcut visible in Start menu

### 3.2 Launch the App

1. Click the "Iranti Control Plane" shortcut.

2. A black terminal/console window opens. It should display text within 2–3 seconds:
   ```
   [iranti-cp] v0.x.x running at http://localhost:3000
   [iranti-cp] API at http://localhost:3000/api/control-plane/
   ```

   - [ ] Terminal window opened
   - [ ] Startup text appeared
   - [ ] Port number shown: `_______` (e.g., 3000)
   - [ ] Version shown in startup text: `______________`

3. Within 5 seconds of the terminal showing the startup text, your default browser should automatically open to `http://localhost:3000` (or the port shown).

   - [ ] Browser opened automatically
   - [ ] URL in browser: `http://localhost:______`

   **If the browser does not open automatically:** Open a browser manually and go to `http://localhost:3000` (or the port shown in the terminal). The app is still working — auto-open is a convenience feature.

### 3.3 Verify the UI Loads

1. In the browser, the Iranti Control Plane interface should load. You should see a sidebar with navigation items.

   - [ ] Control plane UI loaded (not a blank page or error)

2. Go to `http://localhost:3000/api/control-plane/health` in the browser. You should see a JSON response (even if some checks show errors — the server must respond).

   - [ ] Health endpoint returns a JSON response

### 3.4 Check Version

1. Note the version shown in the terminal output: `[iranti-cp] v___ running at...`
2. Compare to the version in the installer filename.

   - [ ] Version shown: `______________`
   - [ ] Matches installer version: Yes / No

### 3.5 Confirm Node.js Was Not Used

1. While the app is running, open a new Command Prompt.
2. Run `node --version` again.
3. It should still return an error (Node.js was never installed; the app uses its own bundled runtime).

   - [ ] `node --version` still returns an error after install and launch

---

## Part 4: Port Conflict Test (AC-12)

This test confirms the app auto-increments to the next available port when 3000 is in use.

1. Close the Iranti Control Plane if it is running (close the terminal window or press `Ctrl+C`).

2. Open PowerShell **as Administrator** (right-click PowerShell → Run as administrator).

3. Start a listener on port 3000:
   ```powershell
   $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 3000)
   $listener.Start()
   ```

4. Launch "Iranti Control Plane" from the Start menu.

5. The terminal should show the app started on a different port:
   ```
   [iranti-cp] v0.x.x running at http://localhost:3001
   ```

   - [ ] App started on a port other than 3000 (specify: `_____`)
   - [ ] Browser opened to the correct alternate port URL

6. Clean up: in PowerShell, run `$listener.Stop()`.

---

## Part 5: Uninstall Test (AC-2)

1. Close Iranti Control Plane.

2. Open **Settings → Apps** (Windows 11) or **Control Panel → Programs and Features** (Windows 10).

3. Search for "Iranti Control Plane".

   - [ ] "Iranti Control Plane" appears in the installed apps list

4. Click **Uninstall** and confirm when prompted.

   - [ ] Uninstall completed without error

5. Verify cleanup:

   Open Command Prompt and run:
   ```cmd
   dir "C:\Program Files\Iranti Control Plane" 2>nul
   ```
   Expected: directory does not exist or is empty.

   - [ ] Install directory is removed

   Check the Start menu — "Iranti Control Plane" should no longer appear in search.

   - [ ] Start menu shortcut is gone

---

## Part 6: Pass/Fail Summary

Fill this in after completing all tests. Send it to the PM.

| Test | Pass / Fail / Blocked | Notes |
|---|---|---|
| W-1: Node.js absent before install | | |
| W-2: SmartScreen warning appeared and bypassed | | |
| W-3: UAC prompt appeared and confirmed | | |
| W-4: Installer wizard ran without error | | |
| W-5: Start menu entry appeared | | |
| W-6: Terminal window opened with startup text | | |
| W-7: Browser opened automatically to correct URL | | |
| W-8: UI loaded in browser | | |
| W-9: Health endpoint returned JSON | | |
| W-10: Version matches installer filename | | |
| W-11: `node --version` still fails after install | | |
| W-12: Port conflict — auto-incremented port | | |
| W-13: Uninstall removed app from Apps list | | |
| W-14: Uninstall removed install directory | | |
| W-15: Uninstall removed Start menu entry | | |
| **Overall: AC-11 Windows PASS?** | | |

---

## Part 7: macOS Test (if macOS available)

**Requirements:** macOS 13 (Ventura) or macOS 14 (Sonoma), no Node.js. Installer file: `iranti-control-plane-universal-<version>.dmg`.

| Step | Description | Result |
|---|---|---|
| M-1 | `node --version` returns "command not found" | |
| M-2 | DMG mounts; Finder window opens | |
| M-3 | Drag app to Applications folder | |
| M-4 | Gatekeeper warning appears on first launch | |
| M-5 | Right-click → Open bypasses Gatekeeper | |
| M-6 | Browser opens to control plane URL | |
| M-7 | UI loads in browser | |
| M-8 | Version matches DMG filename | |
| M-9 | Second launch (double-click) works without Gatekeeper prompt | |
| **Overall: AC-11 macOS PASS?** | | |

**Full macOS procedure:** Follow steps M-1 through M-11 in `docs/qa/cp-t048-clean-machine-test-plan.md`.

---

## Part 8: Linux Test (if Linux VM available)

**Requirements:** Ubuntu 22.04 LTS (fresh install or clean VM), no Node.js. Installer files: `.AppImage` and/or `_amd64.deb`.

| Step | Description | Result |
|---|---|---|
| L-1 | `node --version` returns "command not found" | |
| L-2 | `chmod +x` AppImage; runs without error | |
| L-3 | Terminal output shows `[iranti-cp] v... running at...` | |
| L-4 | Browser opens / UI loads | |
| L-5 | `.deb` installs via `sudo dpkg -i` | |
| L-6 | `iranti-control-plane` command works from terminal | |
| L-7 | Version matches filename | |
| **Overall: AC-11 Linux PASS?** | | |

**Full Linux procedure:** Follow steps L-1 through L-13 in `docs/qa/cp-t048-clean-machine-test-plan.md`.

---

## Part 9: What to Send to the PM

After completing the tests, send the following:

1. **Part 6 pass/fail summary** (and Part 7/8 if tested).
2. **The environment table** from Part 1 Section 1.3.
3. **For any FAIL:** Which step failed, what was shown on screen, what you expected. A screenshot if possible.
4. **The version string** shown in the terminal output.
5. **Your overall conclusion** — one of:
   - **A. Full pass:** All three platforms pass AC-11. Recommend formal release.
   - **B. Partial pass:** Windows passes; macOS/Linux not yet tested. PM decides whether to ship.
   - **C. Fail with known defect:** Describe exactly which step failed and what the error was.
   - **D. Fail with new defect:** New unexpected failure; file a bug ticket.

---

## Troubleshooting

**SmartScreen won't show "Run anyway":** Make sure you clicked "More info" — the button only appears after that link is clicked.

**Gatekeeper keeps blocking (macOS):** Go to System Settings → Privacy & Security. Look for a "Security" section with a note about Iranti Control Plane being blocked. Click "Open Anyway."

**Terminal window opens but shows a database error:** The app started correctly (the binary works). The database error means the control plane cannot reach Iranti's PostgreSQL database — this is expected on a machine without Iranti installed. The binary itself is working. If the question is only "does it start without Node.js?", the answer is yes.

**Browser does not open automatically:** Open a browser manually and go to `http://localhost:3000`. The auto-open is a convenience feature and does not affect the pass/fail status of AC-11 (it is AC-6 coverage).

**UI shows but looks broken (missing styles):** Open browser Developer Tools (`F12`) → Network tab. Look for any requests with red status (4xx/5xx). Note the exact URL being requested. Take a screenshot. This would indicate an asset path issue — send all details to the PM.

**"Port already in use" on first launch:** Another application is using port 3000. The control plane should automatically try 3001, 3002, etc., and show the correct port in the terminal. If it crashes instead of auto-incrementing, that is a defect — document the terminal output and send it.

---

## Appendix: Expected Artifact Sizes

| File | Expected size range |
|---|---|
| `iranti-control-plane-setup-<version>.exe` (NSIS installer) | 30–80 MB |
| `iranti-control-plane-universal-<version>.dmg` | 50–90 MB |
| `iranti-control-plane-<version>.AppImage` | 80–120 MB |
| `iranti-control-plane_<version>_amd64.deb` | 80–120 MB |

If the file is dramatically smaller (e.g., under 1 MB), it is likely corrupted or incomplete — download again.
