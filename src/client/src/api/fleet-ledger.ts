/**
 * fleet-ledger.ts — Fleet Ledger API client.
 *
 * Covers the /api/control-plane/session-ledger surface: list/export mirrored
 * fleet events, manage ingestion status, and poll ledger stats.
 */

import { apiFetch } from './client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FleetLedgerEvent {
  id: number
  instanceId: string
  remoteEventId: string
  timestamp: string
  staffComponent: string
  actionType: string
  agentId: string | null
  source: string | null
  host: string | null
  sessionId: string | null
  entityType: string | null
  entityId: string | null
  key: string | null
  reason: string | null
  level: 'audit' | 'debug'
  metadata: Record<string, unknown> | null
  ingestedAt: string
}

export interface FleetLedgerResponse {
  items: FleetLedgerEvent[]
  total: number
  fetchedAt: string
  note?: string
}

export interface IngestionHealthEntry {
  instanceId: string
  lastEventTimestamp: string | null
  lastRemoteEventId: string | null
  lastPolledAt: string | null
  lastPollSucceeded: boolean
  lastPollError: string | null
  consecutiveFailures: number
  totalEventsIngested: number
  status: 'healthy' | 'degraded' | 'failing' | 'never_polled'
}

export interface IngestionHealthResponse {
  instances: IngestionHealthEntry[]
  fetchedAt: string
}

export interface FleetLedgerFilters {
  instanceId?: string
  source?: string
  host?: string
  agentId?: string
  sessionId?: string
  actionType?: string
  since?: string
  until?: string
  level?: 'audit' | 'debug'
  limit?: number
}

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

/**
 * Fetch fleet-wide ledger events across all ingested instances.
 * Supports filtering by instanceId, source, host, agentId, sessionId,
 * actionType, time range, level, and limit.
 */
export function fetchFleetLedger(filters?: FleetLedgerFilters): Promise<FleetLedgerResponse> {
  return apiFetch<FleetLedgerResponse>('/session-ledger', filters as Record<string, string | number | boolean | undefined>)
}

/**
 * Fetch ingestion health status for all polled instances.
 * Shows poll recency, failure counts, and cumulative event totals.
 */
export function fetchIngestionHealth(): Promise<IngestionHealthResponse> {
  return apiFetch<IngestionHealthResponse>('/session-ledger/ingestion-health')
}
