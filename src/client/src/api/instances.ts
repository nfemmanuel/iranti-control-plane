/* Iranti Control Plane — Instances API client */
/* Connects to CP-T011 API endpoint: GET /api/control-plane/instances */

import type { InstanceListResponse, InstanceMetadata } from './types'
import { apiFetch } from './client'
import { basename } from '../lib/path'

export interface Instance {
  id: string
  name: string
  port: number
  host: string
  status: 'running' | 'stopped' | 'unreachable'
  databaseUrl?: string
  projectCount?: number
}

/**
 * Normalize the server's InstanceMetadata into the Instance shape the UI uses.
 * The server uses instanceId/configuredPort/runningStatus; the UI uses id/port/status.
 */
function normalizeInstance(m: InstanceMetadata): Instance {
  return {
    id: m.instanceId,
    name: m.name ?? basename(m.runtimeRoot) ?? m.instanceId,
    port: m.configuredPort ?? 3001,
    host: m.database?.host ?? 'localhost',
    status: m.runningStatus === 'unknown' ? 'unreachable' : m.runningStatus,
    databaseUrl: m.database?.urlRedacted ?? undefined,
    projectCount: m.projects?.length ?? 0,
  }
}

export async function fetchInstances(): Promise<Instance[]> {
  const data = await apiFetch<InstanceListResponse>('/instances')
  return (data.instances ?? []).map(normalizeInstance)
}
