/* Iranti Control Plane — Instances API client */
/* Connects to CP-T011 API endpoint: GET /api/control-plane/instances */

export interface Instance {
  id: string
  name: string
  port: number
  host: string
  status: 'running' | 'stopped' | 'unknown'
  databaseUrl?: string
  projectCount?: number
}

export interface InstancesResponse {
  instances: Instance[]
}

export async function fetchInstances(): Promise<Instance[]> {
  const res = await fetch('/api/control-plane/instances')
  if (!res.ok) {
    throw new Error(`Failed to fetch instances: ${res.status} ${res.statusText}`)
  }
  const data: InstancesResponse = await res.json() as InstancesResponse
  return data.instances
}
