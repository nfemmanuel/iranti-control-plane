export interface PortSelectionPlan {
  start: number
  end: number
  strict: boolean
}

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
  return { start: basePort, end: basePort + 10, strict: false }
}
