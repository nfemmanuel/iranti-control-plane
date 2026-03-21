/**
 * Agent Registry proxy routes — CP-T051
 *
 * Proxies Iranti's agent registry endpoints with X-Iranti-Key forwarding.
 *
 * Routes:
 *   GET /agents              — list all registered agents
 *   GET /agents/:agentId     — single agent record
 *
 * Both endpoints require `agents:read` scope on the forwarded key.
 * On auth failure (401/403): HTTP 503 with AGENTS_UNAVAILABLE.
 * On network failure: HTTP 503 with AGENTS_UNAVAILABLE.
 * On agent not found (404): HTTP 404 with NOT_FOUND.
 */

import { Router, Request, Response, NextFunction } from 'express'
import { env } from '../../db.js'
import { ApiError } from '../../types.js'

export const agentsRouter = Router()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IrantiAgentStats {
  totalWrites: number
  totalRejections: number
  totalEscalations: number
  avgConfidence: number
  lastSeen: string | null
  isActive: boolean
}

export interface IrantiAgent {
  agentId: string
  name: string
  description: string | null
  capabilities: string[]
  model: string | null
  properties: Record<string, unknown>
  stats: IrantiAgentStats
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
  // Forward X-Iranti-Key if present on the incoming request, otherwise use
  // the configured API key from the control plane's own env.
  const incomingKey = req.headers['x-iranti-key']
  const apiKey = (typeof incomingKey === 'string' && incomingKey.trim())
    ? incomingKey
    : getIrantiApiKey()
  if (apiKey) {
    headers['X-Iranti-Key'] = apiKey
  }
  return headers
}

function isAuthError(status: number): boolean {
  return status === 401 || status === 403
}

// ---------------------------------------------------------------------------
// GET /agents
// ---------------------------------------------------------------------------

agentsRouter.get(
  '/agents',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const baseUrl = getIrantiUrl()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)

      let irantiRes: globalThis.Response
      try {
        irantiRes = await fetch(`${baseUrl}/agents`, {
          method: 'GET',
          headers: buildHeaders(req),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }

      if (isAuthError(irantiRes.status)) {
        res.status(503).json({
          error: 'Iranti agents:read scope required',
          code: 'AGENTS_UNAVAILABLE',
        })
        return
      }

      if (!irantiRes.ok) {
        res.status(503).json({
          error: 'Iranti agents endpoint returned an unexpected error',
          code: 'AGENTS_UNAVAILABLE',
        })
        return
      }

      const body = await irantiRes.json() as unknown
      // Iranti may return an array directly or an object with an agents array.
      // Normalise to { agents, total } per AC-1.
      let agents: IrantiAgent[]
      if (Array.isArray(body)) {
        agents = body as IrantiAgent[]
      } else if (
        body !== null &&
        typeof body === 'object' &&
        'agents' in (body as Record<string, unknown>) &&
        Array.isArray((body as Record<string, unknown>).agents)
      ) {
        agents = (body as { agents: IrantiAgent[] }).agents
      } else {
        agents = []
      }

      res.json({ agents, total: agents.length })
    } catch (err: unknown) {
      // Network / abort errors → 503
      const name = (err as Error)?.name
      if (name === 'AbortError' || name === 'TypeError') {
        res.status(503).json({
          error: 'Iranti instance unreachable',
          code: 'AGENTS_UNAVAILABLE',
        })
        return
      }
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// GET /agents/:agentId
// ---------------------------------------------------------------------------

agentsRouter.get(
  '/agents/:agentId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { agentId } = req.params
      const baseUrl = getIrantiUrl()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)

      let irantiRes: globalThis.Response
      try {
        irantiRes = await fetch(`${baseUrl}/agents/${encodeURIComponent(agentId)}`, {
          method: 'GET',
          headers: buildHeaders(req),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }

      if (irantiRes.status === 404) {
        res.status(404).json({ error: 'Agent not found', code: 'NOT_FOUND' })
        return
      }

      if (isAuthError(irantiRes.status)) {
        res.status(503).json({
          error: 'Iranti agents:read scope required',
          code: 'AGENTS_UNAVAILABLE',
        })
        return
      }

      if (!irantiRes.ok) {
        res.status(503).json({
          error: 'Iranti agents endpoint returned an unexpected error',
          code: 'AGENTS_UNAVAILABLE',
        })
        return
      }

      const body = await irantiRes.json() as IrantiAgent
      res.json(body)
    } catch (err: unknown) {
      const name = (err as Error)?.name
      if (name === 'AbortError' || name === 'TypeError') {
        res.status(503).json({
          error: 'Iranti instance unreachable',
          code: 'AGENTS_UNAVAILABLE',
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

agentsRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const apiErr = err as ApiError
  res.status(apiErr.statusCode ?? 500).json({
    error: apiErr.message ?? 'Internal server error',
    code: apiErr.code ?? 'INTERNAL_ERROR',
  })
})
