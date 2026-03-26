/**
 * Attendant Debug Tools — CP-T096
 *
 * Routes:
 *   POST /debug/handshake  — proxy iranti_handshake to the live instance
 *   POST /debug/attend     — proxy iranti_attend to the live instance
 *
 * Both routes use native fetch (Node 18+ global) with a 15-second AbortController
 * timeout. Errors are always returned as structured JSON — never 500.
 *
 * Auth: Reads IRANTI_URL and IRANTI_API_KEY from the loaded instance env.
 * These are read at request time so a process restart isn't needed after
 * a .env.iranti change.
 */

import { Router, Request, Response, NextFunction } from 'express'
import { env } from '../../db.js'
import { ApiError } from '../../types.js'

export const attendantDebugRouter = Router()

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 15_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getIrantiUrl(): string | null {
  const raw = env['IRANTI_URL'] ?? process.env['IRANTI_URL'] ?? ''
  return raw.trim() ? raw.trim().replace(/\/$/, '') : null
}

function getIrantiApiKey(): string | null {
  const raw = env['IRANTI_API_KEY'] ?? process.env['IRANTI_API_KEY'] ?? ''
  return raw.trim() ? raw.trim() : null
}

/**
 * Proxy a POST to the Iranti instance with a 15-second timeout.
 * Returns { status: number, body: unknown } on success.
 * Throws a tagged error on network failure or timeout.
 */
async function proxyPost(
  url: string,
  apiKey: string,
  body: unknown
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let res: globalThis.Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Iranti-Key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const tagged = new Error(message) as Error & { isNetworkError: true }
    tagged.isNetworkError = true
    throw tagged
  } finally {
    clearTimeout(timer)
  }

  let parsed: unknown
  try {
    parsed = await res.json()
  } catch {
    // Non-JSON body from Iranti — wrap the raw text
    parsed = { raw: await res.text().catch(() => '') }
  }

  return { status: res.status, body: parsed }
}

/**
 * Check preconditions (URL + key configured) and return them, or write the
 * appropriate 503 response and return null.
 */
function resolveConfig(
  res: Response
): { irantiUrl: string; apiKey: string } | null {
  const irantiUrl = getIrantiUrl()
  if (!irantiUrl) {
    res.status(503).json({
      error: 'No Iranti instance configured.',
      code: 'NO_INSTANCE',
    })
    return null
  }

  const apiKey = getIrantiApiKey()
  if (!apiKey) {
    res.status(503).json({
      error: 'No API key configured for this instance. Create a key with memory:read scope in the Auth Keys manager.',
      code: 'NO_API_KEY',
    })
    return null
  }

  return { irantiUrl, apiKey }
}

// ---------------------------------------------------------------------------
// POST /debug/handshake
// ---------------------------------------------------------------------------

attendantDebugRouter.post(
  '/handshake',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { agentId, task } = req.body as { agentId?: unknown; task?: unknown }

      if (typeof agentId !== 'string' || agentId.trim() === '') {
        res.status(400).json({ error: 'agentId must be a non-empty string.', code: 'INVALID_INPUT' })
        return
      }
      if (typeof task !== 'string' || task.trim() === '') {
        res.status(400).json({ error: 'task must be a non-empty string.', code: 'INVALID_INPUT' })
        return
      }

      const config = resolveConfig(res)
      if (!config) return

      const { irantiUrl, apiKey } = config
      const targetUrl = `${irantiUrl}/memory/handshake`

      let result: { status: number; body: unknown }
      try {
        result = await proxyPost(targetUrl, apiKey, { agent: agentId.trim(), task: task.trim() })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        res.status(502).json({
          error: `Could not reach Iranti instance: ${message}`,
          code: 'UNREACHABLE',
        })
        return
      }

      // Forward the Iranti status code and body as-is
      res.status(result.status).json(result.body)
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// POST /debug/attend
// ---------------------------------------------------------------------------

attendantDebugRouter.post(
  '/attend',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { agentId, query, context } = req.body as {
        agentId?: unknown
        query?: unknown
        context?: unknown
      }

      if (typeof agentId !== 'string' || agentId.trim() === '') {
        res.status(400).json({ error: 'agentId must be a non-empty string.', code: 'INVALID_INPUT' })
        return
      }
      if (typeof query !== 'string' || query.trim() === '') {
        res.status(400).json({ error: 'query must be a non-empty string.', code: 'INVALID_INPUT' })
        return
      }

      const config = resolveConfig(res)
      if (!config) return

      const { irantiUrl, apiKey } = config
      const targetUrl = `${irantiUrl}/memory/attend`

      const proxyBody: Record<string, unknown> = {
        agent: agentId.trim(),
        latestMessage: query.trim(),
      }
      if (typeof context === 'string' && context.trim() !== '') {
        proxyBody.currentContext = context.trim()
      }

      let result: { status: number; body: unknown }
      try {
        result = await proxyPost(targetUrl, apiKey, proxyBody)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        res.status(502).json({
          error: `Could not reach Iranti instance: ${message}`,
          code: 'UNREACHABLE',
        })
        return
      }

      res.status(result.status).json(result.body)
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// Error handler — never let uncaught errors surface as 500 without JSON
// ---------------------------------------------------------------------------

attendantDebugRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const apiErr = err as ApiError
  res.status(apiErr.statusCode ?? 500).json({
    error: apiErr.message ?? 'Internal server error',
    code: apiErr.code ?? 'INTERNAL_ERROR',
  })
})
