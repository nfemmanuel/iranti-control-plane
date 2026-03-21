/**
 * WhoKnows Contributor Panel proxy route — CP-T057
 *
 * Route:
 *   GET /kb/whoknows/:entityType/:entityId
 *     → proxies GET /memory/whoknows/:entityType/:entityId on Iranti
 *
 * Auth: forwards X-Iranti-Key (requires memory:read scope).
 *
 * Response shape (normalized):
 *   { contributors: [{ agentId, writeCount, lastContributedAt }], total: N }
 *
 * Error handling:
 *   - Iranti 404 or 401/403: HTTP 503 { error, code: "WHOKNOWS_UNAVAILABLE" }
 *   - Iranti returns empty list: { contributors: [], total: 0 } (not an error)
 *   - Network failure / timeout: HTTP 503 WHOKNOWS_UNAVAILABLE
 *
 * NOTE: The upstream Iranti endpoint is at /memory/whoknows/..., not /kb/whoknows/...
 * The control plane exposes it under /kb/whoknows/ to keep the frontend route
 * namespace consistent with other entity-related kb routes. This file mounts on
 * the kbRouter prefix so the final path is /api/control-plane/kb/whoknows/:entityType/:entityId.
 */

import { Router, Request, Response, NextFunction } from 'express'
import { env } from '../../db.js'
import { ApiError } from '../../types.js'

export const whoknowsRouter = Router()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WhoKnowsContributor {
  agentId: string
  writeCount: number
  lastContributedAt: string | null
}

interface WhoKnowsResponse {
  contributors: WhoKnowsContributor[]
  total: number
}

// Iranti's raw response shape — may vary slightly. We normalise to WhoKnowsResponse.
interface IrantiWhoKnowsRaw {
  contributors?: Array<{
    agentId?: string
    agent_id?: string
    writeCount?: number
    write_count?: number
    lastContributedAt?: string | null
    last_contributed_at?: string | null
  }>
  agents?: Array<{
    agentId?: string
    agent_id?: string
    writeCount?: number
    write_count?: number
    lastContributedAt?: string | null
    last_contributed_at?: string | null
  }>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getIrantiUrl(): string {
  return (env['IRANTI_URL'] ?? process.env['IRANTI_URL'] ?? 'http://localhost:3001').replace(/\/$/, '')
}

function getIrantiApiKey(): string {
  return env['IRANTI_API_KEY'] ?? process.env['IRANTI_API_KEY'] ?? ''
}

function buildHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  // Prefer X-Iranti-Key forwarded from the incoming request; fall back to env key.
  const incomingKey = req.headers['x-iranti-key']
  const apiKey = (typeof incomingKey === 'string' && incomingKey.trim())
    ? incomingKey
    : getIrantiApiKey()
  if (apiKey) {
    headers['X-Iranti-Key'] = apiKey
  }
  return headers
}

function normalizeContributors(raw: IrantiWhoKnowsRaw): WhoKnowsContributor[] {
  // Iranti may return `contributors` or `agents` as the array key.
  const sourceArray = Array.isArray(raw.contributors)
    ? raw.contributors
    : Array.isArray(raw.agents)
      ? raw.agents
      : []

  return sourceArray.map((item) => ({
    agentId: String(item.agentId ?? item.agent_id ?? ''),
    writeCount: Number(item.writeCount ?? item.write_count ?? 0),
    lastContributedAt: (item.lastContributedAt ?? item.last_contributed_at) ?? null,
  }))
}

// ---------------------------------------------------------------------------
// GET /kb/whoknows/:entityType/:entityId
// ---------------------------------------------------------------------------

whoknowsRouter.get(
  '/kb/whoknows/:entityType/:entityId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { entityType, entityId } = req.params
      const baseUrl = getIrantiUrl()

      // Build upstream URL: /memory/whoknows/:entityType/:entityId
      // Note: /memory/ path — distinct from /kb/ path
      const upstreamPath = `/memory/whoknows/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`
      const upstreamUrl = `${baseUrl}${upstreamPath}`

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)

      let irantiRes: globalThis.Response
      try {
        irantiRes = await fetch(upstreamUrl, {
          method: 'GET',
          headers: buildHeaders(req),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }

      // Auth failures and entity not found: collapse to 503 WHOKNOWS_UNAVAILABLE
      if (irantiRes.status === 401 || irantiRes.status === 403) {
        res.status(503).json({
          error: 'Iranti memory:read scope required for WhoKnows lookup',
          code: 'WHOKNOWS_UNAVAILABLE',
        })
        return
      }

      if (irantiRes.status === 404) {
        // Entity not found in Iranti — return empty contributors (valid state)
        const response: WhoKnowsResponse = { contributors: [], total: 0 }
        res.json(response)
        return
      }

      if (!irantiRes.ok) {
        res.status(503).json({
          error: `Iranti WhoKnows endpoint returned unexpected status ${irantiRes.status}`,
          code: 'WHOKNOWS_UNAVAILABLE',
        })
        return
      }

      // Parse and normalise the Iranti response
      const body = await irantiRes.json() as unknown

      // If Iranti returns an array directly (some versions), wrap it
      let raw: IrantiWhoKnowsRaw
      if (Array.isArray(body)) {
        raw = { contributors: body as IrantiWhoKnowsRaw['contributors'] }
      } else if (body !== null && typeof body === 'object') {
        raw = body as IrantiWhoKnowsRaw
      } else {
        raw = {}
      }

      const contributors = normalizeContributors(raw)
      const response: WhoKnowsResponse = {
        contributors,
        total: contributors.length,
      }

      res.json(response)
    } catch (err: unknown) {
      // Network / abort errors → 503
      const name = (err as Error)?.name
      if (name === 'AbortError' || name === 'TypeError') {
        res.status(503).json({
          error: 'Iranti instance unreachable for WhoKnows lookup',
          code: 'WHOKNOWS_UNAVAILABLE',
        })
        return
      }
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

whoknowsRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const apiErr = err as ApiError
  res.status(apiErr.statusCode ?? 500).json({
    error: apiErr.message ?? 'Internal server error',
    code: apiErr.code ?? 'INTERNAL_ERROR',
  })
})
