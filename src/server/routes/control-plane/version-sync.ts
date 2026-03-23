/**
 * Version Sync route — CP-T078
 *
 * GET /version-sync
 *
 * Compares the locally installed Iranti version against the latest
 * published version on npm. Both sources are fetched concurrently.
 * The endpoint always returns HTTP 200 — partial data (nulls) is
 * returned if either source is unavailable or times out.
 *
 * Sources:
 *   1. installedVersion — Iranti /health response, runtime.version field
 *   2. latestVersion    — npm registry: GET https://registry.npmjs.org/iranti/latest
 */

import { Router, Request, Response } from 'express'
import { resolveInstanceAuthority } from '../../lib/instance-authority.js'

export const versionSyncRouter = Router()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VersionSyncResult {
  installedVersion: string | null
  latestVersion: string | null
  upToDate: boolean | null
  releaseUrl: string
}

const RELEASE_URL = 'https://github.com/nfemmanuel/iranti/releases'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the installed Iranti version from its /health endpoint.
 * Mirrors the same pattern as fetchIrantiRuntime() in health.ts.
 * Returns null if unreachable, missing, or malformed.
 */
async function fetchInstalledVersion(instanceRef?: string): Promise<string | null> {
  const scope = await resolveInstanceAuthority(instanceRef)
  if (!scope) return null

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (scope.apiKey) headers['X-Iranti-Key'] = scope.apiKey

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    const res = await fetch(`${scope.apiBaseUrl}/health`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })

    if (!res.ok) return null

    const body = await res.json() as Record<string, unknown>

    // The runtime field (added in v0.2.16) carries the most reliable version.
    const runtime = body['runtime']
    if (runtime && typeof runtime === 'object') {
      const r = runtime as Record<string, unknown>
      if (typeof r['version'] === 'string' && r['version']) {
        return r['version']
      }
    }

    // Fallback: some versions expose version at the top level of the /health body.
    if (typeof body['version'] === 'string' && body['version']) {
      return body['version']
    }

    return null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Fetch the latest published Iranti version from the npm registry.
 * Returns null on network error, timeout, or unexpected response shape.
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch('https://registry.npmjs.org/iranti/latest', {
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) return null

    const body = await res.json() as Record<string, unknown>

    if (typeof body['version'] === 'string' && body['version']) {
      return body['version']
    }

    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

versionSyncRouter.get('/', async (req: Request, res: Response) => {
  const instanceId = typeof req.query['instanceId'] === 'string' ? req.query['instanceId'] : undefined
  const [installedVersion, latestVersion] = await Promise.all([
    fetchInstalledVersion(instanceId),
    fetchLatestVersion(),
  ])

  const upToDate: boolean | null =
    installedVersion !== null && latestVersion !== null
      ? installedVersion === latestVersion
      : null

  const result: VersionSyncResult = {
    installedVersion,
    latestVersion,
    upToDate,
    releaseUrl: RELEASE_URL,
  }

  res.json(result)
})
