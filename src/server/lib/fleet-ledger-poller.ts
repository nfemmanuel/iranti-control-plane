/**
 * Fleet Ledger Poller
 *
 * Discovers control-plane-known Iranti instances, polls each instance's
 * /memory/ledger endpoint for new audit events, and mirrors them into the
 * control plane's mirrored_staff_events table via fleet-ledger-repo.
 *
 * Design constraints:
 * - Never throws. All errors are caught and logged per-instance.
 * - Instances are polled sequentially to avoid overwhelming them.
 * - Full batches are drained backward until fewer than 250 rows remain.
 * - Watermark writes are null-safe so an empty first successful poll does not fail.
 */

import { resolveInstanceAuthority } from './instance-authority.js'
import {
  type MirroredEventInsert,
  upsertMirroredEvents,
  advanceWatermark,
  recordPollFailure,
  getWatermark,
} from './fleet-ledger-repo.js'
import { discoverAndAggregate } from '../routes/control-plane/instances.js'

const FLEET_LEDGER_POLL_INTERVAL_MS =
  typeof process.env['FLEET_LEDGER_POLL_INTERVAL_MS'] === 'string' &&
  process.env['FLEET_LEDGER_POLL_INTERVAL_MS'].trim() !== ''
    ? parseInt(process.env['FLEET_LEDGER_POLL_INTERVAL_MS'], 10)
    : 60_000

const POLL_BATCH_LIMIT = 250
const FETCH_TIMEOUT_MS = 10_000

interface DiscoveredInstance {
  instanceId: string
  apiBaseUrl: string
  apiKey: string | null
}

async function discoverInstances(): Promise<DiscoveredInstance[]> {
  const discovered = await discoverAndAggregate()
  const instances: DiscoveredInstance[] = []
  const seenIds = new Set<string>()

  for (const candidate of discovered.instances) {
    const authority =
      await resolveInstanceAuthority(candidate.instanceId)
      ?? await resolveInstanceAuthority(candidate.name)

    if (!authority) continue
    if (seenIds.has(authority.instanceId)) continue
    seenIds.add(authority.instanceId)

    instances.push({
      instanceId: authority.instanceId,
      apiBaseUrl: authority.apiBaseUrl,
      apiKey: authority.apiKey,
    })
  }

  return instances
}

interface LedgerItem {
  eventId?: string
  event_id?: string
  id?: string
  timestamp?: string
  staffComponent?: string
  staff_component?: string
  actionType?: string
  action_type?: string
  agentId?: string
  agent_id?: string
  source?: string
  entityType?: string
  entity_type?: string
  entityId?: string
  entity_id?: string
  key?: string
  reason?: string
  level?: string
  metadata?: Record<string, unknown>
}

interface LedgerResponse {
  items: LedgerItem[]
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null
}

function toLedgerResponse(raw: unknown): LedgerResponse | null {
  if (!isRecord(raw)) return null
  const items = raw['items']
  if (!Array.isArray(items)) return null
  return { items: items as LedgerItem[] }
}

function itemTimestamp(item: LedgerItem | undefined): string | null {
  return item?.timestamp ?? null
}

function itemEventId(item: LedgerItem | undefined): string | null {
  return item?.eventId ?? item?.event_id ?? item?.id ?? null
}

function decrementIsoTimestamp(iso: string | null): string | null {
  if (!iso) return null
  const millis = Date.parse(iso)
  if (Number.isNaN(millis)) return null
  return new Date(millis - 1).toISOString()
}

function buildLedgerPollUrl(
  apiBaseUrl: string,
  since: string | null,
  until: string | null
): string {
  const params = new URLSearchParams({
    limit: String(POLL_BATCH_LIMIT),
    level: 'audit',
  })

  if (since) params.set('since', since)
  if (until) params.set('until', until)

  return `${apiBaseUrl}/memory/ledger?${params.toString()}`
}

function mapItem(item: LedgerItem, instanceId: string): MirroredEventInsert | null {
  const remoteEventId = item.eventId ?? item.event_id ?? item.id ?? null
  const timestamp = item.timestamp ?? null

  if (!remoteEventId || !timestamp) return null

  const rawLevel = (item.level ?? 'audit').toLowerCase()
  const level: 'audit' | 'debug' = rawLevel === 'debug' ? 'debug' : 'audit'
  const metadata = isRecord(item.metadata) ? (item.metadata as Record<string, unknown>) : null

  return {
    instanceId,
    remoteEventId,
    timestamp,
    staffComponent: item.staffComponent ?? item.staff_component ?? null,
    actionType: item.actionType ?? item.action_type ?? null,
    agentId: item.agentId ?? item.agent_id ?? null,
    source: item.source ?? null,
    host: typeof metadata?.['host'] === 'string' ? metadata['host'] : null,
    sessionId: typeof metadata?.['sessionId'] === 'string' ? metadata['sessionId'] : null,
    entityType: item.entityType ?? item.entity_type ?? null,
    entityId: item.entityId ?? item.entity_id ?? null,
    key: item.key ?? null,
    reason: item.reason ?? null,
    level,
    metadata,
  }
}

async function pollInstance(
  instanceId: string,
  apiBaseUrl: string,
  apiKey: string | null
): Promise<void> {
  const watermark = await getWatermark(instanceId)
  const lowerBoundSince = decrementIsoTimestamp(watermark?.lastEventTimestamp ?? null)
  let upperBoundUntil: string | null = null
  let latestTimestampSeen = watermark?.lastEventTimestamp ?? null
  let latestEventIdSeen = watermark?.lastEventId ?? null
  let capturedLatestFromPoll = false

  while (true) {
    const url = buildLedgerPollUrl(apiBaseUrl, lowerBoundSince, upperBoundUntil)

    const headers: Record<string, string> = {}
    if (apiKey) headers['X-Iranti-Key'] = apiKey

    let response: Response
    try {
      const controller = new AbortController()
      const timeoutHandle = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      try {
        response = await fetch(url, { headers, signal: controller.signal })
      } finally {
        clearTimeout(timeoutHandle)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await recordPollFailure(instanceId, `Network error: ${message}`)
      return
    }

    if (!response.ok) {
      await recordPollFailure(
        instanceId,
        `HTTP ${response.status} ${response.statusText} from ${url}`
      )
      return
    }

    let raw: unknown
    try {
      raw = await response.json()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await recordPollFailure(instanceId, `JSON parse error: ${message}`)
      return
    }

    const ledger = toLedgerResponse(raw)
    if (!ledger) {
      await recordPollFailure(instanceId, 'Unexpected ledger response shape (missing items array)')
      return
    }

    const { items } = ledger
    if (items.length === 0) {
      await advanceWatermark(instanceId, latestTimestampSeen, latestEventIdSeen, 0)
      return
    }

    const events: MirroredEventInsert[] = []
    for (const item of items) {
      const mapped = mapItem(item, instanceId)
      if (mapped) events.push(mapped)
    }

    const insertedCount = events.length > 0
      ? await upsertMirroredEvents(events)
      : 0

    if (!capturedLatestFromPoll) {
      latestTimestampSeen = itemTimestamp(items[0])
      latestEventIdSeen = itemEventId(items[0])
      capturedLatestFromPoll = true
    }

    await advanceWatermark(instanceId, latestTimestampSeen, latestEventIdSeen, insertedCount)

    if (items.length < POLL_BATCH_LIMIT) break

    const oldestTimestamp = itemTimestamp(items[items.length - 1])
    const nextUpperBoundUntil = decrementIsoTimestamp(oldestTimestamp)
    if (!nextUpperBoundUntil) break

    if (lowerBoundSince && Date.parse(nextUpperBoundUntil) <= Date.parse(lowerBoundSince)) {
      break
    }

    upperBoundUntil = nextUpperBoundUntil
  }
}

export async function pollAllInstancesOnce(): Promise<void> {
  let instances: DiscoveredInstance[]
  try {
    instances = await discoverInstances()
  } catch (err) {
    console.warn('[fleet-poller] Failed to discover instances:', err)
    return
  }

  if (instances.length === 0) return

  for (const instance of instances) {
    try {
      await pollInstance(instance.instanceId, instance.apiBaseUrl, instance.apiKey)
    } catch (err) {
      console.warn(
        `[fleet-poller] Error polling instance ${instance.instanceId} (${instance.apiBaseUrl}):`,
        err
      )
    }
  }
}

let _pollInterval: ReturnType<typeof setInterval> | null = null

export function startFleetLedgerPoller(): void {
  if (_pollInterval !== null) {
    console.warn('[fleet-poller] Already running - startFleetLedgerPoller() called twice.')
    return
  }

  console.log(
    `[fleet-poller] Starting. Poll interval: ${FLEET_LEDGER_POLL_INTERVAL_MS}ms.`
  )

  pollAllInstancesOnce().catch((err) => {
    console.warn('[fleet-poller] Initial poll error:', err)
  })

  _pollInterval = setInterval(() => {
    pollAllInstancesOnce().catch((err) => {
      console.warn('[fleet-poller] Poll error:', err)
    })
  }, FLEET_LEDGER_POLL_INTERVAL_MS)
}

export function stopFleetLedgerPoller(): void {
  if (_pollInterval !== null) {
    clearInterval(_pollInterval)
    _pollInterval = null
    console.log('[fleet-poller] Stopped.')
  }
}
