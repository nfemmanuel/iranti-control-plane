/**
 * portSelection.ts — Port-range planning for the Control Plane HTTP server.
 *
 * Derives a start/end port range from env-var inputs so the server can
 * auto-increment past occupied ports. An explicit port produces a strict
 * single-port range; a fallback base port allows a 10-port search window.
 */

export interface PortSelectionPlan {
  /** First port to try. */
  start: number
  /** Last port to try (inclusive). Equal to start when strict. */
  end: number
  /** True when the caller provided an explicit port — fail hard if unavailable. */
  strict: boolean
}

/** Auto-increment window size used when no explicit port is given. */
const PORT_SEARCH_WINDOW = 10

function parsePort(raw: string | null | undefined): number | null {
  if (!raw) return null
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) ? value : null
}

export function buildPortSelectionPlan(params: {
  explicitPort?: string | null
  fallbackBasePort?: string | null
}): PortSelectionPlan {
  const explicitPort = parsePort(params.explicitPort)
  if (explicitPort !== null) {
    return { start: explicitPort, end: explicitPort, strict: true }
  }

  const basePort = parsePort(params.fallbackBasePort) ?? 3000
  return { start: basePort, end: basePort + PORT_SEARCH_WINDOW, strict: false }
}
