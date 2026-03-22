/**
 * Open File route — CP-T084
 *
 * POST /open-file
 *
 * Opens a whitelisted local config file in the user's default system editor.
 * This is a local-first tool — the endpoint intentionally shell-opens files
 * on the machine running the control plane server.
 *
 * Security:
 *   - Only paths on the ALLOWED_PATHS whitelist are accepted.
 *   - Any path containing ".." (directory traversal) is rejected with HTTP 400.
 *   - Absolute paths are rejected with HTTP 400.
 *   - exec() is only called with fully-resolved paths from process.cwd().
 *
 * Response shape: always HTTP 200.
 *   { opened: true, path: resolvedPath }
 *   { opened: false, reason: string, path: resolvedPath }
 *
 * A 200 with opened:false means the file was not found or the open command
 * failed — the frontend renders a helpful inline message rather than an error.
 */

import { Router, Request, Response } from 'express'
import { exec } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import * as fs from 'fs/promises'

const execAsync = promisify(exec)

export const openFileRouter = Router()

// ---------------------------------------------------------------------------
// Whitelist of safe relative paths
// ---------------------------------------------------------------------------

/**
 * Only these filenames are allowed. They must be simple relative names with no
 * directory components. The path must not contain ".." and must not be absolute.
 */
const ALLOWED_PATHS = new Set([
  '.env.iranti',
  '.env',
  'iranti.config.json',
  'iranti.config.js',
])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OpenFileResult {
  opened: boolean
  path: string
  reason?: string
}

interface OpenFileRequestBody {
  path?: unknown
}

// ---------------------------------------------------------------------------
// OS-appropriate open command
// ---------------------------------------------------------------------------

function buildOpenCommand(resolvedPath: string): string {
  // Escape the path for use inside shell quotes. On all three platforms we
  // wrap the resolved path in double-quotes, so we only need to escape any
  // embedded double-quotes in the path itself (edge case, but defensive).
  const escaped = resolvedPath.replace(/"/g, '\\"')

  switch (process.platform) {
    case 'win32':
      // `start "" "<path>"` — the empty string is the window title, which is
      // required when the first argument to start would otherwise be interpreted
      // as the title rather than the filename.
      return `start "" "${escaped}"`
    case 'darwin':
      return `open "${escaped}"`
    default:
      // Linux + other POSIX
      return `xdg-open "${escaped}"`
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

openFileRouter.post('/', async (req: Request, res: Response) => {
  const body = req.body as OpenFileRequestBody
  const rawPath = body.path

  // --- Input validation ---

  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    res.status(400).json({ error: 'Path not allowed' })
    return
  }

  const trimmed = rawPath.trim()

  // Reject absolute paths
  if (path.isAbsolute(trimmed)) {
    res.status(400).json({ error: 'Path not allowed' })
    return
  }

  // Reject traversal attempts
  if (trimmed.includes('..')) {
    res.status(400).json({ error: 'Path not allowed' })
    return
  }

  // Reject anything not in the whitelist. We normalise both the input and
  // the whitelist entries to their basenames so that e.g. "./iranti.config.json"
  // is rejected the same as "subdir/iranti.config.json" — only bare filenames pass.
  const basename = path.basename(trimmed)
  if (basename !== trimmed || !ALLOWED_PATHS.has(trimmed)) {
    res.status(400).json({ error: 'Path not allowed' })
    return
  }

  // --- Resolution ---

  const resolvedPath = path.resolve(process.cwd(), trimmed)

  // --- Existence check ---

  try {
    await fs.access(resolvedPath)
  } catch {
    const result: OpenFileResult = {
      opened: false,
      reason: 'file not found',
      path: resolvedPath,
    }
    res.json(result)
    return
  }

  // --- Open ---

  try {
    const cmd = buildOpenCommand(resolvedPath)
    await execAsync(cmd, { timeout: 3000 })
    const result: OpenFileResult = { opened: true, path: resolvedPath }
    res.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const result: OpenFileResult = { opened: false, reason: message, path: resolvedPath }
    res.json(result)
  }
})
