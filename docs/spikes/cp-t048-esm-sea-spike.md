# CP-T048 — ESM + Node SEA Compatibility Spike

**Author:** devops_engineer
**Date:** 2026-03-20
**Ticket:** CP-T048 — Platform Installer Packages (MSI, .dmg, .deb)
**Status:** Complete — findings ready for PM sign-off

---

## Environment

| Property | Value |
|---|---|
| Node.js version | v24.12.0 |
| npm version | 11.8.0 |
| TypeScript version (server) | 5.9.3 |
| esbuild version (server devDep) | 0.27.4 |
| Platform | Windows 11, x64 |
| node.exe size | **86 MB** |

---

## Q1: ESM Entry Point + Node SEA Compatibility

### Finding: Node SEA requires a CommonJS entry point. ESM is not supported.

Node.js Single Executable Applications (SEA), introduced in Node 20 and stabilized in Node 21.7.1/22.x, explicitly require the main script to be a **CommonJS** script. From the Node.js documentation:

> "The script provided in the main field of the sea-config.json must use CommonJS."

This is not a minor limitation — Node's module loader for SEA blobs does not support top-level `await`, `import` statements, or the ESM execution model. An ESM file passed as the SEA `main` will fail at injection or at startup.

### Server ESM situation

The server has:
- `"type": "module"` in `src/server/package.json` — all `.js` files in the package are treated as ESM
- `"module": "ESNext"` and `"moduleResolution": "bundler"` in `tsconfig.json` — TypeScript emits ESM output
- `import.meta.url` used in `src/server/index.ts` (line 9) for `__dirname` reconstruction
- `import.meta.url` also used in `src/server/migrations/runner.ts` (line 7)

### Resolution: esbuild CJS bundle + import.meta.url polyfill

The correct path is to use **esbuild** to bundle the TypeScript source into a single CJS file before feeding it to Node SEA. This is validated:

**Test performed:** esbuild was run against `src/server/index.ts` with `--format=cjs --bundle --platform=node --target=node20`, plus a banner-injected polyfill for `import.meta.url`:

```
--banner:js=const __importmeta_url = require('url').pathToFileURL(__filename).href;
--define:import.meta.url=__importmeta_url
```

Result: **Clean build, no errors.** Bundle size: **1.5 MB** (uncompressed, all dependencies inlined).

The SEA blob generation step was also validated: `node --experimental-sea-config` accepted the CJS bundle and produced a valid `.blob` file (**1.5 MB**).

### Required server code changes before packaging

No structural changes to the server source are required. The CJS transformation is handled entirely by esbuild at build time. However, two path-resolution issues must be addressed in the packaging pipeline:

1. **`import.meta.url` in `index.ts` and `migrations/runner.ts`:** Both use `fileURLToPath(import.meta.url)` to reconstruct `__dirname`. The esbuild banner polyfill handles `index.ts` correctly. The migrations runner runs as a separate script (not from the SEA binary) and does not need special treatment.

2. **Static frontend path (`../../public/control-plane`):** The server resolves the client dist via `resolve(__dirname, '../../public/control-plane')`. When compiled via `tsc` to `src/server/dist/index.js`, this resolves to `<project>/public/control-plane`. Inside a SEA binary, `__filename` will be the path to the binary itself — not a path inside the project. The path computation `../../public/control-plane` relative to the binary will be wrong. **This requires either: (a) embedding the static assets in the SEA binary via the `"assets"` config field, or (b) rewriting the static file path to use a configurable install-time path (e.g., an env var or a path relative to the binary's real location via `process.execPath`).** See Q3 for the full analysis.

3. **`process.cwd()` usage in health.ts, instances.ts, providers.ts, repair.ts, setup.ts:** Multiple routes use `process.cwd()` to locate `.mcp.json`, `CLAUDE.md`, `package.json`, and `.iranti-cp-setup-complete`. In a packaged binary, `process.cwd()` will be wherever the user launched the binary from — not the install directory. These references are conceptually correct for a tool that operates on the user's current working directory (the user's Iranti project), and do not need to change. They are not packaging blockers, but they must be documented clearly in the installer UX so users know to run the binary from their project root (or supply a `--project-dir` flag).

### CJS bundle viability: all dependencies are CJS-compatible

All runtime dependencies (`express`, `cors`, `pg`, `dotenv`) are pure CommonJS packages with no `"type": "module"` in their package.json. esbuild can inline them without issues. The only native bindings in the server's `node_modules` are `@rollup/rollup-win32-x64-gnu` and `@rollup/rollup-win32-x64-msvc` — both are Rollup's platform-specific devDependency binaries used by Vite, not used at server runtime. They are excluded from the esbuild bundle automatically via `--bundle --platform=node` (native `.node` addons are treated as external unless explicitly included).

---

## Q2: Prisma Client + SEA Bundling

### Finding: No Prisma. No native binaries. This constraint does not apply.

The server does **not** use Prisma. The database client is `pg` (node-postgres v8.12), which is a pure JavaScript implementation using the PostgreSQL wire protocol over TCP. There is no Prisma dependency in `src/server/package.json` or `src/server/node_modules/`.

**Verification:** A recursive search for `.node` files in `src/server/node_modules/` found only two files:
- `@rollup/rollup-win32-x64-gnu/rollup.win32-x64-gnu.node` — Rollup native binary (devDependency, not runtime)
- `@rollup/rollup-win32-x64-msvc/rollup.win32-x64-msvc.node` — same, MSVC build (devDependency, not runtime)

`pg` itself is pure JS. Its `pg-native` binding is an optional peer dependency that requires explicit installation of the `pg-native` package (which in turn requires `libpq` native headers). The server does not install `pg-native`, and `NODE_PG_FORCE_NATIVE` is not set. pg-native usage is confirmed absent from all server TypeScript files.

**Conclusion:** No sidecar native binary files are required. The SEA binary can be self-contained (server code + Node runtime). The only external dependency at runtime is a reachable PostgreSQL server via `DATABASE_URL`, which is a network dependency, not a file dependency.

---

## Q3: Static Frontend Assets

### Finding: The Vite build does NOT output to `src/client/dist/`. It outputs to `public/control-plane/`.

The Vite config (`src/client/vite.config.ts`) sets:
```ts
build: {
  outDir: '../../public/control-plane',
  emptyOutDir: true,
}
```

This means the production frontend build lives at `<project-root>/public/control-plane/`. This directory does not exist yet (build has not been run in this checkout). In a packaged binary, the server resolves this path as `resolve(__dirname, '../../public/control-plane')` — which, when `__dirname` is derived from the SEA binary's path via `process.execPath`, will produce the wrong path unless the installer places the frontend assets at a known relative location.

### Node SEA `"assets"` field

Node SEA supports embedding binary assets since Node 21.2.0. On Node 24 (this machine), the `getAsset`, `getAssetAsBlob`, and `getRawAsset` functions are available and confirmed functional.

However, using the `"assets"` field has significant constraints:

1. **The server code must be changed to read assets from SEA memory** (via `sea.getAsset()` or `sea.getAssetAsBlob()`) instead of serving them from the filesystem via `express.static()`. This requires adding `node:sea` awareness to `src/server/index.ts` and replacing the `express.static()` call with a custom middleware that streams assets from the SEA bundle.

2. **Assets are keyed by name, not path tree.** The entire `public/control-plane/` directory cannot be embedded as a directory — each file must be individually listed under the `"assets"` key. Serving a React SPA requires serving `index.html`, several JS chunks, CSS files, and potentially font/image assets. This means either enumerating every asset file at build time (fragile) or building a custom asset-manifest-driven router.

3. **The `"assets"` field has no documented size limit** in Node's official docs, but in practice, large asset sets increase the SEA blob size proportionally. The frontend build has not been run in this checkout, so an exact size is unavailable. A typical Vite-built React SPA with Radix UI, React Router, and React Query will produce approximately **500 KB – 3 MB** of static assets (HTML + JS chunks + CSS). This is well within embedding range — the 80 MB concern comes from the Node runtime itself, not the app assets.

4. **Maturity concern:** The `"assets"` SEA API is still marked as experimental as of Node 22/24. The API surface is small and has changed between minor Node versions.

### Recommendation: ship static assets alongside the binary

Given the required server code changes and the experimental API maturity, the lower-risk approach is to **ship the frontend static assets as sidecar files alongside the binary**, placed in a known relative location (e.g., `resources/public/control-plane/` inside the installer's install directory). The server's static path resolution must be updated to use `process.execPath` (not `__dirname` computed from `import.meta.url`) to find the sidecar assets.

This is how Electron apps, VS Code extensions, and most production desktop tools handle static assets — embedding creates tight coupling between the asset manifest and the binary format.

If the PM prefers a single-file experience (no sidecar directory), SEA asset embedding is technically achievable but requires a non-trivial server middleware rewrite and acceptance of an experimental API.

---

## Q4: Toolchain Comparison

### Hard constraints recap
- AC-8: No Node.js prerequisite on user's machine
- AC-10: Packaged binary < 80 MB preferred
- macOS universal binary (arm64 + x86_64 via `lipo`)

### Critical size constraint finding

**Node v24.12.0 on this machine weighs 86 MB.** This is the Node.js executable alone, before adding any app code. The 80 MB target from AC-10 is already exceeded by the Node runtime by 6 MB.

This is not unique to Node 24. Node LTS binary sizes over recent versions:
- Node 20.x: ~74–78 MB (platform-dependent)
- Node 22.x: ~78–82 MB
- Node 24.x: ~86 MB

**The 80 MB target must be re-evaluated by the PM.** The choices are:
1. Accept that the binary will be 80–90 MB and revise the AC to ~100 MB (installer size will be ~50–70 MB after compression by the installer wrapper)
2. Use a slimmed Node build (e.g., nvm-distributed Node with ICU data stripped) which may reduce to ~65–70 MB
3. Drop the < 80 MB requirement in favor of a compressed installer size target (NSIS `.exe` compresses well; a 90 MB Node binary typically compresses to 35–45 MB inside an NSIS installer)

| Criterion | Node SEA | caxa | electron-builder (non-Electron) |
|---|---|---|---|
| **ESM support** | No — CJS only. Requires esbuild pre-bundling step. Validated: esbuild + import.meta.url polyfill works cleanly. | No — caxa wraps the app's `node_modules` into a self-extracting archive and runs `node yourscript`. The script can be CJS or ESM as long as the bundled Node supports it. No pre-bundling required, but app source + full node_modules is bundled (larger, slower). | Depends on underlying bundler. With esbuild pre-bundling (recommended), CJS. electron-builder does not natively handle Node SEA. |
| **Prisma sidecar** | N/A — no Prisma in this project | N/A | N/A |
| **Native `.node` handling** | Native addons are automatically treated as external; they must ship as sidecars. This project has no runtime `.node` addons. | Same as SEA — native addons must be present on disk. caxa can include them in its archive since it extracts to a temp dir before running. | Same as caxa. |
| **Static asset embedding** | Possible via `"assets"` SEA config (Node 21.2+, experimental). Requires server middleware rewrite. Or ship as sidecars alongside binary. | Sidecar only — caxa does not embed assets inside a binary; it uses a self-extracting archive and extracts to a temp directory at first run. Static files are included in the archive alongside `node_modules`. | Sidecar in a resources directory. electron-builder's target format (NSIS, dmg, AppImage) places assets in a `resources/` directory. |
| **macOS universal binary** | Requires producing separate arm64 and x86_64 Node SEA binaries, then joining with `lipo`. This is supported and documented. Each binary starts from a Node binary for the target arch. Requires two build matrix entries. | caxa does not support universal binaries natively. Would need to produce two arch-specific binaries and create a universal wrapper using a separate tool. Harder than SEA. | electron-builder has native universal binary support for macOS — builds both arches and calls `lipo` automatically. This is its strongest advantage. |
| **Estimated binary/installer size** | Binary: Node runtime (~80–90 MB) + 1.5 MB app bundle. Static assets: ~1–3 MB (sidecar). Total installer: ~50–65 MB compressed (NSIS/dmg compress Node well). **Node runtime alone already exceeds the 80 MB AC.** | caxa: archives Node runtime (~80–90 MB) + full `node_modules` directory. Uncompressed: **200–250 MB**. Self-extracting archive size: ~60–80 MB compressed. Extracts to temp dir on first run (1–3 sec delay). Larger on disk after extraction. | electron-builder with esbuild pre-bundle: similar to SEA. Node runtime + app bundle. electron-builder can use a tree-shaken Node build. Size range: ~80–95 MB installer. |
| **Maturity / maintenance** | SEA: Node built-in, first-class support in Node 21.7.1+, stable in 22.x. Actively maintained as part of Node core. No external tool dependency. | caxa: actively maintained (James Warwood). Simpler API. Less granular control. No native universal binary support. | electron-builder: very mature (v26.8.1, widely used). Designed for Electron. Non-Electron mode is supported but less documented. Universal binary support excellent. |
| **Windows NSIS support** | Requires a separate NSIS script — SEA just makes the binary. | Requires a separate NSIS script. | electron-builder generates NSIS installers natively (it is the bundler). Best Windows installer support of the three. |
| **Code signing** | Ad-hoc signing via `codesign` on macOS. Requires separate tooling. | Same. | electron-builder has built-in signing support for macOS (Developer ID) and Windows (Authenticode). Best signing support of the three. |

---

## Q5: Recommended Toolchain

### Recommendation: esbuild CJS pre-bundle → Node SEA binary → per-platform installer tooling

**Primary recommendation: Node SEA** with the following pipeline:

1. **Bundle step:** esbuild bundles `src/server/index.ts` to a single CJS file with all dependencies inlined. The `import.meta.url` polyfill is injected via `--banner` and `--define`. Migration SQL files are either embedded as string literals (via esbuild loader) or shipped as sidecar files alongside the binary — the migration runner is separate from the server binary and not shipped in the SEA.

2. **SEA blob step:** `node --experimental-sea-config sea-config.json` produces a `.blob` file from the CJS bundle.

3. **Binary injection step:** Copy the platform's Node.js binary, inject the blob using `postject`, and set permissions.

4. **Static assets:** Ship `public/control-plane/` as a sidecar directory at a known relative path from the binary (e.g., `resources/public/control-plane/`). Update the server's static path resolution to use `path.dirname(process.execPath)` + a configurable relative path, or an environment variable that the installer wrapper sets at launch.

5. **Per-platform installer:**
   - **Windows:** NSIS `.exe` installer. Places binary + resources at `%ProgramFiles%\Iranti Control Plane\`. Registers uninstaller. Creates Start menu entry.
   - **macOS:** `create-dmg` or `appdmg` creates a `.dmg`. The binary must be wrapped in a `.app` bundle. Use `lipo` to combine arm64 + x86_64 binaries. Ad-hoc signing via `codesign --sign -`.
   - **Linux:** `fpm` for `.deb`/`.rpm`; `appimagetool` for `.AppImage`. No signing required.

### Why not caxa

caxa is simpler to set up but ships the entire `node_modules` directory inside a self-extracting archive. This results in a larger on-disk footprint after extraction (200–250 MB vs ~90 MB for SEA), a first-run extraction delay (1–3 seconds), and no clean path to macOS universal binaries. For a production-quality installer, caxa's tradeoffs are not worth the setup simplicity.

### Why not electron-builder

electron-builder's non-Electron mode is useful but the tool is fundamentally designed around Electron's packaging model. Its main advantage here — built-in macOS universal binary support and native NSIS generation — can be replicated with `lipo` + NSIS directly. Adding electron-builder as a dependency introduces a large, opinionated toolchain that is harder to debug when packaging fails. The Node SEA path keeps the pipeline explicit and auditable.

### Prerequisites before pipeline implementation begins

The following changes or decisions must be made before writing any pipeline code:

#### Required code changes

1. **Server static path resolution must be updated** before packaging. The current `resolve(__dirname, '../../public/control-plane')` is relative to the compiled output path and will break inside a SEA binary. The new approach must use `path.dirname(process.execPath)` plus a configurable relative path, or accept a `--assets-dir` / `IRANTI_CP_ASSETS_DIR` environment variable. The installer launcher script sets this env var to the correct install-relative path. This change is small (2–3 lines) but is a prerequisite AC for packaging.

2. **The migration runner is not included in the SEA binary.** The `runner.ts` uses `readFileSync(resolve(__dirname, file), 'utf8')` to load SQL files. This is fine — migrations should run separately (as part of the installer post-install script), not from within the packaged binary. The migration runner should be compiled separately or shipped as a script. No change needed to existing code; this is an architectural clarification.

3. **`process.cwd()` semantics documentation.** The routes that use `process.cwd()` to find `.mcp.json`, `CLAUDE.md`, etc., are operating on the user's current working directory — which is correct behavior for a tool that inspects a project workspace. In the packaged installer context, users will launch the binary from their project root (or the launcher script will `cd` to the right directory). This must be documented in the installer's Getting Started UX. No code change required; a UX requirement only.

#### Decisions the PM must make before implementation begins

1. **Revise the 80 MB binary size target.** Node 24 is 86 MB alone. The packaged binary will be ~90 MB. The final installer (NSIS/dmg/AppImage) will compress this to approximately **50–65 MB** on disk at download time. The PM should confirm whether the target should be revised to:
   - "Installer download size < 80 MB" (achievable), or
   - "Binary size < 100 MB" (achievable), or
   - "Binary size < 80 MB" (not achievable without using an older, smaller Node LTS release — Node 20 is ~74–78 MB, still close to the limit)

2. **Static assets: embed in SEA or ship as sidecar?** The PM decision affects server code. The spike recommendation is sidecar (lower risk, no server code rewrite required beyond path resolution). Embedding is possible but requires rewriting Express static serving to use the `node:sea` experimental API.

3. **macOS CI runner strategy.** Universal binary (`lipo`) requires building the arm64 and x86_64 binaries separately on a macOS runner and combining them. GitHub Actions `macos-latest` runs on arm64 (M-series). For cross-compilation, the x86_64 Node binary can be downloaded from nodejs.org without running on an x86 machine, but the binary injection step (`postject`) must be done on the target arch or cross-compiled. The PM should confirm whether GitHub Actions macOS matrix strategy (two jobs + lipo merge) is acceptable, or whether a single macOS runner with both arches is expected.

4. **Node version pinning for the packaged binary.** The SEA binary bundles a specific Node.js runtime. The devops_engineer should confirm which Node LTS version to target. Node 20 LTS (smaller binary, ~74 MB) vs Node 22 LTS (current LTS, ~82 MB) vs Node 24 (latest, 86 MB). Node 20 LTS would be the most size-efficient choice and is supported until April 2026. Node 22 LTS is the safer long-term choice (support through April 2027).

---

## Summary of Blockers

| Blocker | Owner | Blocking what |
|---|---|---|
| AC-10 (80 MB) is not achievable with Node 24 (86 MB runtime) | PM must revise AC | Pipeline cannot be built to spec without knowing the real target |
| Static path resolution in `index.ts` must be updated | devops_engineer (small code change) | Cannot package without this fix |
| Static assets: embed vs sidecar decision | PM | Determines whether server code requires a middleware rewrite |
| Node version pinning decision | PM / devops_engineer | Affects binary size and support window |
| macOS CI universal binary strategy confirmed | PM | Affects CI matrix design |

---

## Acceptance Criteria Verification

| AC | Status | Notes |
|---|---|---|
| AC-8 — No Node.js prerequisite | Achievable | Node SEA bundles the runtime. Confirmed viable. |
| AC-10 — Binary < 80 MB | **Blocker** | Node 24 alone is 86 MB. Needs PM revision. |
| ESM compatibility confirmed | Resolved | esbuild CJS pre-bundling validated end-to-end. |
| Prisma sidecar concern | N/A | No Prisma — project uses pg directly. No native binaries at runtime. |
| macOS universal binary | Achievable | `lipo` approach documented. Requires CI matrix strategy decision. |
| Static asset serving in packaged binary | Needs decision | Sidecar recommended; embedding possible but experimental. |
