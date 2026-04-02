/**
 * Unit tests for sessions.ts parser functions.
 *
 * Tests the pure data-transformation functions that convert raw database rows
 * into SessionRecord objects. No network, no postgres — pure unit tests.
 */

import { describe, it, expect } from 'vitest'
import {
  buildSessionsFromAttendantStateRows,
  buildSessionFromLegacyKBRows,
  type AttendantStateRow,
  type LegacyKBSessionRow,
} from '../../routes/control-plane/sessions.js'

// ---------------------------------------------------------------------------
// buildSessionsFromAttendantStateRows
// ---------------------------------------------------------------------------

describe('buildSessionsFromAttendantStateRows', () => {
  it('returns empty array when given no rows', () => {
    expect(buildSessionsFromAttendantStateRows([])).toEqual([])
  })

  it('skips rows where valueRaw is null', () => {
    const rows: AttendantStateRow[] = [
      { entityId: 'agent/alpha', valueRaw: null, createdAt: new Date(), updatedAt: null },
    ]
    expect(buildSessionsFromAttendantStateRows(rows)).toEqual([])
  })

  it('skips rows where valueRaw is not an object', () => {
    const rows: AttendantStateRow[] = [
      { entityId: 'agent/alpha', valueRaw: 'string-value', createdAt: new Date(), updatedAt: null },
      { entityId: 'agent/beta', valueRaw: 42, createdAt: new Date(), updatedAt: null },
    ]
    expect(buildSessionsFromAttendantStateRows(rows)).toEqual([])
  })

  it('skips rows where sessionCheckpoint is absent', () => {
    const rows: AttendantStateRow[] = [
      {
        entityId: 'agent/alpha',
        valueRaw: { someOtherKey: 'value' },
        createdAt: new Date(),
        updatedAt: null,
      },
    ]
    expect(buildSessionsFromAttendantStateRows(rows)).toEqual([])
  })

  it('skips rows where sessionCheckpoint is not an object', () => {
    const rows: AttendantStateRow[] = [
      {
        entityId: 'agent/alpha',
        valueRaw: { sessionCheckpoint: 'not-an-object' },
        createdAt: new Date(),
        updatedAt: null,
      },
    ]
    expect(buildSessionsFromAttendantStateRows(rows)).toEqual([])
  })

  it('builds a session record from a valid attendant state row', () => {
    const rows: AttendantStateRow[] = [
      {
        entityId: 'agent/alpha',
        valueRaw: {
          compliance: {
            status: 'degraded',
            summary: 'Lifecycle is degraded: persistence breadcrumbs are lagging.',
            issues: [
              {
                code: 'missing_durable_persistence',
                severity: 'warn',
                count: 3,
                message: 'There have been 3 attend calls since the last iranti_write or iranti_checkpoint.',
                requiredAction: 'Persist durable findings.',
              },
            ],
            lastUpdated: '2026-03-22T10:29:00Z',
            counters: {
              attendsWithoutPersist: 3,
              consecutivePreResponseWithoutPost: 0,
              pendingPostResponse: false,
              lastAttendPhase: 'mid-turn',
            },
          },
          sessionCheckpoint: {
            sessionId: 'sess-001',
            status: 'checkpointed',
            task: 'Analyze data pipeline',
            startedAt: '2026-03-22T10:00:00Z',
            updatedAt: '2026-03-22T10:30:00Z',
          },
        },
        createdAt: new Date('2026-03-22T10:00:00Z'),
        updatedAt: null,
      },
    ]

    const result = buildSessionsFromAttendantStateRows(rows)
    expect(result).toHaveLength(1)
    const session = result[0]
    expect(session.sessionId).toBe('sess-001')
    expect(session.agentId).toBe('agent/alpha')
    expect(session.state).toBe('checkpointed')
    expect(session.task).toBe('Analyze data pipeline')
    expect(session.startedAt).toBe('2026-03-22T10:00:00Z')
    expect(session.compliance?.status).toBe('degraded')
    expect(session.compliance?.counters.attendsWithoutPersist).toBe(3)
  })

  it('maps status "active" to state "checkpointed"', () => {
    const rows: AttendantStateRow[] = [
      {
        entityId: 'agent/beta',
        valueRaw: {
          sessionCheckpoint: { sessionId: 'sess-002', status: 'active' },
        },
        createdAt: new Date(),
        updatedAt: null,
      },
    ]
    const [session] = buildSessionsFromAttendantStateRows(rows)
    expect(session.state).toBe('checkpointed')
  })

  it('maps status "completed" to state "complete"', () => {
    const rows: AttendantStateRow[] = [
      {
        entityId: 'agent/gamma',
        valueRaw: {
          sessionCheckpoint: { sessionId: 'sess-003', status: 'completed' },
        },
        createdAt: new Date(),
        updatedAt: null,
      },
    ]
    const [session] = buildSessionsFromAttendantStateRows(rows)
    expect(session.state).toBe('complete')
  })

  it('maps status "interrupted" to state "interrupted"', () => {
    const rows: AttendantStateRow[] = [
      {
        entityId: 'agent/delta',
        valueRaw: {
          sessionCheckpoint: { sessionId: 'sess-004', status: 'interrupted' },
        },
        createdAt: new Date(),
        updatedAt: null,
      },
    ]
    const [session] = buildSessionsFromAttendantStateRows(rows)
    expect(session.state).toBe('interrupted')
  })

  it('maps unknown status to state "unknown"', () => {
    const rows: AttendantStateRow[] = [
      {
        entityId: 'agent/epsilon',
        valueRaw: {
          sessionCheckpoint: { sessionId: 'sess-005', status: 'some-future-state' },
        },
        createdAt: new Date(),
        updatedAt: null,
      },
    ]
    const [session] = buildSessionsFromAttendantStateRows(rows)
    expect(session.state).toBe('unknown')
  })

  it('falls back to entityId as sessionId when sessionCheckpoint.sessionId is absent', () => {
    const rows: AttendantStateRow[] = [
      {
        entityId: 'agent/zeta',
        valueRaw: {
          sessionCheckpoint: { status: 'checkpointed' },
        },
        createdAt: new Date(),
        updatedAt: null,
      },
    ]
    const [session] = buildSessionsFromAttendantStateRows(rows)
    expect(session.sessionId).toBe('agent/zeta')
  })

  it('uses entityId as agentId', () => {
    const rows: AttendantStateRow[] = [
      {
        entityId: 'agent/eta',
        valueRaw: {
          sessionCheckpoint: { sessionId: 'sess-006', status: 'complete' },
        },
        createdAt: new Date(),
        updatedAt: null,
      },
    ]
    const [session] = buildSessionsFromAttendantStateRows(rows)
    expect(session.agentId).toBe('agent/eta')
  })

  it('processes multiple rows independently', () => {
    const rows: AttendantStateRow[] = [
      {
        entityId: 'agent/one',
        valueRaw: { sessionCheckpoint: { sessionId: 'sess-a', status: 'checkpointed' } },
        createdAt: new Date(),
        updatedAt: null,
      },
      {
        entityId: 'agent/two',
        valueRaw: { sessionCheckpoint: { sessionId: 'sess-b', status: 'complete' } },
        createdAt: new Date(),
        updatedAt: null,
      },
      // This row has no sessionCheckpoint — should be skipped
      {
        entityId: 'agent/three',
        valueRaw: { noCheckpoint: true },
        createdAt: new Date(),
        updatedAt: null,
      },
    ]
    const result = buildSessionsFromAttendantStateRows(rows)
    expect(result).toHaveLength(2)
    expect(result[0].sessionId).toBe('sess-a')
    expect(result[1].sessionId).toBe('sess-b')
  })

  it('uses lastHeartbeatAt for lastCheckpointAt when updatedAt is absent', () => {
    const rows: AttendantStateRow[] = [
      {
        entityId: 'agent/theta',
        valueRaw: {
          sessionCheckpoint: {
            sessionId: 'sess-007',
            status: 'checkpointed',
            lastHeartbeatAt: '2026-03-22T11:00:00Z',
          },
        },
        createdAt: new Date(),
        updatedAt: null,
      },
    ]
    const [session] = buildSessionsFromAttendantStateRows(rows)
    expect(session.lastCheckpointAt).toBe('2026-03-22T11:00:00Z')
  })
})

// ---------------------------------------------------------------------------
// buildSessionFromLegacyKBRows
// ---------------------------------------------------------------------------

describe('buildSessionFromLegacyKBRows', () => {
  it('returns empty array for empty input', () => {
    expect(buildSessionFromLegacyKBRows([])).toEqual([])
  })

  it('builds one session from a single key row', () => {
    const rows: LegacyKBSessionRow[] = [
      {
        entityId: 'session-001',
        key: 'state',
        valueSummary: 'checkpointed',
        valueRaw: null,
        createdBy: 'agent/alpha',
        createdAt: new Date('2026-03-22T10:00:00Z'),
        updatedAt: null,
        properties: null,
      },
    ]
    const result = buildSessionFromLegacyKBRows(rows)
    expect(result).toHaveLength(1)
    const session = result[0]
    expect(session.sessionId).toBe('session-001')
    expect(session.state).toBe('checkpointed')
  })

  it('groups multiple keys belonging to the same sessionId', () => {
    const rows: LegacyKBSessionRow[] = [
      {
        entityId: 'session-abc',
        key: 'state',
        valueSummary: 'interrupted',
        valueRaw: null,
        createdBy: 'agent/beta',
        createdAt: new Date('2026-03-22T09:00:00Z'),
        updatedAt: null,
        properties: null,
      },
      {
        entityId: 'session-abc',
        key: 'task',
        valueSummary: 'Process invoices',
        valueRaw: null,
        createdBy: 'agent/beta',
        createdAt: new Date('2026-03-22T09:00:00Z'),
        updatedAt: null,
        properties: null,
      },
    ]
    const result = buildSessionFromLegacyKBRows(rows)
    expect(result).toHaveLength(1)
    expect(result[0].task).toBe('Process invoices')
    expect(result[0].state).toBe('interrupted')
  })

  it('creates separate sessions for different entityIds', () => {
    const rows: LegacyKBSessionRow[] = [
      {
        entityId: 'session-1',
        key: 'state',
        valueSummary: 'complete',
        valueRaw: null,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: null,
        properties: null,
      },
      {
        entityId: 'session-2',
        key: 'state',
        valueSummary: 'interrupted',
        valueRaw: null,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: null,
        properties: null,
      },
    ]
    const result = buildSessionFromLegacyKBRows(rows)
    expect(result).toHaveLength(2)
  })

  it('uses createdBy column as agentId when no explicit agentId key', () => {
    const rows: LegacyKBSessionRow[] = [
      {
        entityId: 'session-xyz',
        key: 'state',
        valueSummary: 'complete',
        valueRaw: null,
        createdBy: 'agent/gamma',
        createdAt: new Date(),
        updatedAt: null,
        properties: null,
      },
    ]
    const [session] = buildSessionFromLegacyKBRows(rows)
    expect(session.agentId).toBe('agent/gamma')
  })

  it('handles null createdBy gracefully (agentId becomes empty string)', () => {
    const rows: LegacyKBSessionRow[] = [
      {
        entityId: 'session-noagent',
        key: 'state',
        valueSummary: 'unknown',
        valueRaw: null,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: null,
        properties: null,
      },
    ]
    const [session] = buildSessionFromLegacyKBRows(rows)
    expect(session.agentId).toBe('')
  })

  it('handles null valueRaw and null valueSummary gracefully', () => {
    const rows: LegacyKBSessionRow[] = [
      {
        entityId: 'session-nulls',
        key: 'task',
        valueSummary: null,
        valueRaw: null,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: null,
        properties: null,
      },
    ]
    const [session] = buildSessionFromLegacyKBRows(rows)
    expect(session.task).toBeNull()
    expect(session.state).toBe('unknown')
  })

  it('falls back to valueRaw string when valueSummary is null', () => {
    const rows: LegacyKBSessionRow[] = [
      {
        entityId: 'session-raw',
        key: 'state',
        valueSummary: null,
        valueRaw: 'checkpointed',
        createdBy: null,
        createdAt: new Date(),
        updatedAt: null,
        properties: null,
      },
    ]
    const [session] = buildSessionFromLegacyKBRows(rows)
    expect(session.state).toBe('checkpointed')
  })

  it('state defaults to "unknown" when no state key present', () => {
    const rows: LegacyKBSessionRow[] = [
      {
        entityId: 'session-nostate',
        key: 'task',
        valueSummary: 'Some task',
        valueRaw: null,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: null,
        properties: null,
      },
    ]
    const [session] = buildSessionFromLegacyKBRows(rows)
    expect(session.state).toBe('unknown')
  })
})
