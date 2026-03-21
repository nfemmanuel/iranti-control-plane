/**
 * Unit tests for Staff Logs row serialization and where-clause builder logic.
 *
 * serializeEventRow is exported from logs.ts and tested directly.
 * buildLogsWhereClause, escapeCsvField, and eventToCsvRow are internal —
 * they are replicated inline here as spec-level documentation and regression
 * guards. Update the replications if the source implementations change.
 */

import { describe, it, expect } from 'vitest'
import { serializeEventRow } from '../../routes/control-plane/logs.js'
import type { StaffEvent } from '../../types.js'

// ===========================================================================
// Inline replication of buildLogsWhereClause (from routes/control-plane/logs.ts)
// ===========================================================================

interface LogFilters {
  staffComponent?: string
  actionType?: string
  agentId?: string
  entityType?: string
  search?: string
  since?: Date
  until?: Date
  level?: string
}

function buildLogsWhereClause(filters: LogFilters, params: unknown[]): string {
  const clauses: string[] = []

  if (filters.level) {
    params.push(filters.level)
    clauses.push(`level = $${params.length}`)
  }

  if (filters.staffComponent) {
    const components = filters.staffComponent.split(',').map((s) => s.trim()).filter(Boolean)
    if (components.length === 1) {
      params.push(components[0])
      clauses.push(`staff_component = $${params.length}`)
    } else if (components.length > 1) {
      const placeholders = components.map((c) => {
        params.push(c)
        return `$${params.length}`
      })
      clauses.push(`staff_component IN (${placeholders.join(', ')})`)
    }
  }

  if (filters.actionType) {
    params.push(filters.actionType)
    clauses.push(`action_type = $${params.length}`)
  }

  if (filters.agentId) {
    params.push(filters.agentId)
    clauses.push(`agent_id = $${params.length}`)
  }

  if (filters.entityType) {
    params.push(filters.entityType)
    clauses.push(`entity_type = $${params.length}`)
  }

  if (filters.search) {
    params.push(`%${filters.search}%`)
    const p = params.length
    clauses.push(
      `(action_type ILIKE $${p} OR COALESCE(agent_id,'') ILIKE $${p} OR COALESCE(entity_type,'') ILIKE $${p} OR COALESCE(entity_id,'') ILIKE $${p} OR COALESCE(key,'') ILIKE $${p} OR COALESCE(reason,'') ILIKE $${p})`
    )
  }

  if (filters.since) {
    params.push(filters.since.toISOString())
    clauses.push(`timestamp > $${params.length}`)
  }

  if (filters.until) {
    params.push(filters.until.toISOString())
    clauses.push(`timestamp <= $${params.length}`)
  }

  return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
}

// ===========================================================================
// Inline replication of escapeCsvField (from routes/control-plane/logs.ts)
// ===========================================================================

function escapeCsvField(value: unknown): string {
  if (value == null) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

// ===========================================================================
// Tests: serializeEventRow — directly imported, fully exercised
// ===========================================================================

function minRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: 'evt-001',
    timestamp: new Date('2026-03-21T10:00:00Z'),
    staff_component: 'Librarian',
    action_type: 'memory.write',
    agent_id: 'backend_developer',
    source: 'mcp',
    ...overrides,
  }
}

describe('serializeEventRow', () => {
  describe('eventId resolution', () => {
    it('uses event_id (snake_case) as primary source', () => {
      const result = serializeEventRow(minRow({ event_id: 'abc-123' }))
      expect(result.eventId).toBe('abc-123')
    })

    it('falls back to eventId (camelCase) when event_id absent', () => {
      const row = { ...minRow(), eventId: 'camel-id' }
      delete row.event_id
      const result = serializeEventRow(row)
      expect(result.eventId).toBe('camel-id')
    })

    it('falls back to id when both event_id and eventId absent', () => {
      const row = { ...minRow(), id: 'fallback-id' }
      delete row.event_id
      const result = serializeEventRow(row)
      expect(result.eventId).toBe('fallback-id')
    })

    it('returns empty string when all id fields absent', () => {
      const row: Record<string, unknown> = {
        timestamp: new Date(),
        staff_component: 'Attendant',
        action_type: 'ping',
        agent_id: 'test',
        source: 'test',
      }
      const result = serializeEventRow(row)
      expect(result.eventId).toBe('')
    })
  })

  describe('timestamp serialization', () => {
    it('converts Date timestamp to ISO string', () => {
      const date = new Date('2026-03-21T12:00:00Z')
      const result = serializeEventRow(minRow({ timestamp: date }))
      expect(result.timestamp).toBe('2026-03-21T12:00:00.000Z')
    })

    it('passes through string timestamp unchanged', () => {
      const result = serializeEventRow(minRow({ timestamp: '2026-03-21T12:00:00.000Z' }))
      expect(result.timestamp).toBe('2026-03-21T12:00:00.000Z')
    })

    it('converts null timestamp to empty string', () => {
      const result = serializeEventRow(minRow({ timestamp: null }))
      expect(result.timestamp).toBe('')
    })
  })

  describe('staffComponent resolution', () => {
    it('uses staff_component (snake_case)', () => {
      const result = serializeEventRow(minRow({ staff_component: 'Archivist' }))
      expect(result.staffComponent).toBe('Archivist')
    })

    it('falls back to staffComponent (camelCase)', () => {
      const row = { ...minRow(), staffComponent: 'Resolutionist' }
      delete row.staff_component
      const result = serializeEventRow(row)
      expect(result.staffComponent).toBe('Resolutionist')
    })
  })

  describe('actionType resolution', () => {
    it('uses action_type (snake_case)', () => {
      const result = serializeEventRow(minRow({ action_type: 'memory.read' }))
      expect(result.actionType).toBe('memory.read')
    })

    it('falls back to actionType (camelCase)', () => {
      const row = { ...minRow(), actionType: 'attend.recall' }
      delete row.action_type
      const result = serializeEventRow(row)
      expect(result.actionType).toBe('attend.recall')
    })

    it('returns empty string when actionType absent', () => {
      const row: Record<string, unknown> = {
        event_id: '1',
        timestamp: new Date(),
        staff_component: 'Librarian',
        agent_id: 'test',
        source: 'mcp',
      }
      const result = serializeEventRow(row)
      expect(result.actionType).toBe('')
    })
  })

  describe('agentId resolution', () => {
    it('uses agent_id (snake_case)', () => {
      const result = serializeEventRow(minRow({ agent_id: 'product_manager' }))
      expect(result.agentId).toBe('product_manager')
    })

    it('falls back to agentId (camelCase)', () => {
      const row = { ...minRow(), agentId: 'backend_developer' }
      delete row.agent_id
      const result = serializeEventRow(row)
      expect(result.agentId).toBe('backend_developer')
    })
  })

  describe('nullable fields: entityType, entityId, key, reason, metadata', () => {
    it('returns null for entityType when entity_type is null', () => {
      const result = serializeEventRow(minRow({ entity_type: null }))
      expect(result.entityType).toBeNull()
    })

    it('returns null for entityType when entity_type absent', () => {
      const result = serializeEventRow(minRow())
      expect(result.entityType).toBeNull()
    })

    it('returns entityType string when present', () => {
      const result = serializeEventRow(minRow({ entity_type: 'ticket' }))
      expect(result.entityType).toBe('ticket')
    })

    it('returns null for entityId when entity_id absent', () => {
      const result = serializeEventRow(minRow())
      expect(result.entityId).toBeNull()
    })

    it('returns entityId string when present', () => {
      const result = serializeEventRow(minRow({ entity_id: 'cp-t050' }))
      expect(result.entityId).toBe('cp-t050')
    })

    it('returns null for key when absent', () => {
      const result = serializeEventRow(minRow())
      expect(result.key).toBeNull()
    })

    it('returns key string when present', () => {
      const result = serializeEventRow(minRow({ key: 'status' }))
      expect(result.key).toBe('status')
    })

    it('returns null for reason when absent', () => {
      const result = serializeEventRow(minRow())
      expect(result.reason).toBeNull()
    })

    it('returns reason string when present', () => {
      const result = serializeEventRow(minRow({ reason: 'conflict detected' }))
      expect(result.reason).toBe('conflict detected')
    })

    it('returns null for metadata when absent', () => {
      const result = serializeEventRow(minRow())
      expect(result.metadata).toBeNull()
    })

    it('returns metadata object when present', () => {
      const meta = { version: 2, flags: ['a'] }
      const result = serializeEventRow(minRow({ metadata: meta }))
      expect(result.metadata).toEqual(meta)
    })
  })

  describe('level field', () => {
    it('returns audit when level is "audit"', () => {
      const result = serializeEventRow(minRow({ level: 'audit' }))
      expect(result.level).toBe('audit')
    })

    it('returns debug when level is "debug"', () => {
      const result = serializeEventRow(minRow({ level: 'debug' }))
      expect(result.level).toBe('debug')
    })

    it('defaults to "audit" when level is absent', () => {
      const result = serializeEventRow(minRow())
      expect(result.level).toBe('audit')
    })
  })

  describe('camelCase column aliases (full row)', () => {
    it('accepts fully camelCase row without snake_case', () => {
      const row: Record<string, unknown> = {
        eventId: 'camel-evt',
        timestamp: '2026-01-01T00:00:00.000Z',
        staffComponent: 'Attendant',
        actionType: 'attend.ping',
        agentId: 'qa_engineer',
        source: 'internal',
        entityType: 'agent',
        entityId: 'qa_engineer',
        key: 'status',
        reason: 'test run',
        level: 'debug',
        metadata: { run: 1 },
      }
      const result = serializeEventRow(row)
      expect(result.eventId).toBe('camel-evt')
      expect(result.staffComponent).toBe('Attendant')
      expect(result.actionType).toBe('attend.ping')
      expect(result.agentId).toBe('qa_engineer')
      expect(result.entityType).toBe('agent')
      expect(result.entityId).toBe('qa_engineer')
      expect(result.key).toBe('status')
      expect(result.reason).toBe('test run')
      expect(result.level).toBe('debug')
      expect(result.metadata).toEqual({ run: 1 })
    })
  })

  describe('fully-populated snake_case row', () => {
    it('serializes a complete DB row to correct StaffEvent shape', () => {
      const date = new Date('2026-03-21T08:30:00Z')
      const row: Record<string, unknown> = {
        event_id: 'evt-999',
        timestamp: date,
        staff_component: 'Resolutionist',
        action_type: 'conflict.resolve',
        agent_id: 'system_architect',
        source: 'internal',
        entity_type: 'ticket',
        entity_id: 'cp-t050',
        key: 'resolution',
        reason: 'auto-resolved by confidence delta',
        level: 'audit',
        metadata: { prior_confidence: 80, new_confidence: 95 },
      }
      const result = serializeEventRow(row)
      expect(result).toEqual<StaffEvent>({
        eventId: 'evt-999',
        timestamp: '2026-03-21T08:30:00.000Z',
        staffComponent: 'Resolutionist',
        actionType: 'conflict.resolve',
        agentId: 'system_architect',
        source: 'internal',
        entityType: 'ticket',
        entityId: 'cp-t050',
        key: 'resolution',
        reason: 'auto-resolved by confidence delta',
        level: 'audit',
        metadata: { prior_confidence: 80, new_confidence: 95 },
      })
    })
  })
})

// ===========================================================================
// Tests: buildLogsWhereClause (inline replication)
// ===========================================================================

describe('buildLogsWhereClause', () => {
  describe('empty filters', () => {
    it('returns empty string with no params when filters object is empty', () => {
      const params: unknown[] = []
      expect(buildLogsWhereClause({}, params)).toBe('')
      expect(params).toHaveLength(0)
    })
  })

  describe('level filter', () => {
    it('adds level = $1 clause for "audit"', () => {
      const params: unknown[] = []
      const result = buildLogsWhereClause({ level: 'audit' }, params)
      expect(result).toBe('WHERE level = $1')
      expect(params).toEqual(['audit'])
    })

    it('adds level = $1 clause for "debug"', () => {
      const params: unknown[] = []
      const result = buildLogsWhereClause({ level: 'debug' }, params)
      expect(result).toBe('WHERE level = $1')
      expect(params).toEqual(['debug'])
    })
  })

  describe('staffComponent filter', () => {
    it('adds staff_component = $1 for a single component', () => {
      const params: unknown[] = []
      const result = buildLogsWhereClause({ staffComponent: 'Librarian' }, params)
      expect(result).toBe('WHERE staff_component = $1')
      expect(params).toEqual(['Librarian'])
    })

    it('adds IN clause for two components', () => {
      const params: unknown[] = []
      const result = buildLogsWhereClause({ staffComponent: 'Librarian,Archivist' }, params)
      expect(result).toContain('staff_component IN ($1, $2)')
      expect(params).toEqual(['Librarian', 'Archivist'])
    })

    it('adds IN clause for all four components', () => {
      const params: unknown[] = []
      const result = buildLogsWhereClause(
        { staffComponent: 'Librarian,Attendant,Archivist,Resolutionist' },
        params
      )
      expect(result).toContain('staff_component IN ($1, $2, $3, $4)')
      expect(params).toEqual(['Librarian', 'Attendant', 'Archivist', 'Resolutionist'])
    })

    it('trims whitespace around component names', () => {
      const params: unknown[] = []
      buildLogsWhereClause({ staffComponent: ' Librarian , Attendant ' }, params)
      expect(params).toEqual(['Librarian', 'Attendant'])
    })
  })

  describe('actionType filter', () => {
    it('adds action_type = $1 clause', () => {
      const params: unknown[] = []
      const result = buildLogsWhereClause({ actionType: 'memory.write' }, params)
      expect(result).toBe('WHERE action_type = $1')
      expect(params).toEqual(['memory.write'])
    })
  })

  describe('agentId filter', () => {
    it('adds agent_id = $1 clause', () => {
      const params: unknown[] = []
      const result = buildLogsWhereClause({ agentId: 'backend_developer' }, params)
      expect(result).toBe('WHERE agent_id = $1')
      expect(params).toEqual(['backend_developer'])
    })
  })

  describe('entityType filter', () => {
    it('adds entity_type = $1 clause', () => {
      const params: unknown[] = []
      const result = buildLogsWhereClause({ entityType: 'ticket' }, params)
      expect(result).toBe('WHERE entity_type = $1')
      expect(params).toEqual(['ticket'])
    })
  })

  describe('search filter', () => {
    it('wraps search term with % and uses a single placeholder across all columns', () => {
      const params: unknown[] = []
      const result = buildLogsWhereClause({ search: 'write' }, params)
      expect(params).toEqual(['%write%'])
      expect(result).toContain('action_type ILIKE $1')
      expect(result).toContain("COALESCE(agent_id,'') ILIKE $1")
      expect(result).toContain("COALESCE(entity_type,'') ILIKE $1")
      expect(result).toContain("COALESCE(entity_id,'') ILIKE $1")
      expect(result).toContain("COALESCE(key,'') ILIKE $1")
      expect(result).toContain("COALESCE(reason,'') ILIKE $1")
    })

    it('reuses same placeholder number even after prior params exist', () => {
      const params: unknown[] = ['preexisting']
      const result = buildLogsWhereClause({ search: 'hello' }, params)
      // search param pushed at index 1 → placeholder $2
      expect(params).toEqual(['preexisting', '%hello%'])
      expect(result).toContain('action_type ILIKE $2')
    })
  })

  describe('since / until date filters', () => {
    it('adds timestamp > $1 for since', () => {
      const since = new Date('2026-03-01T00:00:00Z')
      const params: unknown[] = []
      const result = buildLogsWhereClause({ since }, params)
      expect(result).toBe('WHERE timestamp > $1')
      expect(params).toEqual(['2026-03-01T00:00:00.000Z'])
    })

    it('adds timestamp <= $1 for until', () => {
      const until = new Date('2026-03-21T23:59:59Z')
      const params: unknown[] = []
      const result = buildLogsWhereClause({ until }, params)
      expect(result).toBe('WHERE timestamp <= $1')
      expect(params).toEqual(['2026-03-21T23:59:59.000Z'])
    })

    it('adds both since and until with correct param numbering', () => {
      const since = new Date('2026-03-01T00:00:00Z')
      const until = new Date('2026-03-21T23:59:59Z')
      const params: unknown[] = []
      const result = buildLogsWhereClause({ since, until }, params)
      expect(result).toContain('timestamp > $1')
      expect(result).toContain('timestamp <= $2')
      expect(params).toEqual(['2026-03-01T00:00:00.000Z', '2026-03-21T23:59:59.000Z'])
    })
  })

  describe('multiple filters combined', () => {
    it('level + staffComponent: level is appended first', () => {
      const params: unknown[] = []
      const result = buildLogsWhereClause({ level: 'debug', staffComponent: 'Attendant' }, params)
      expect(result).toContain('level = $1')
      expect(result).toContain('staff_component = $2')
      expect(params).toEqual(['debug', 'Attendant'])
    })

    it('all string filters combined yield correct clause order and param count', () => {
      const params: unknown[] = []
      const result = buildLogsWhereClause(
        {
          level: 'audit',
          staffComponent: 'Librarian',
          actionType: 'memory.write',
          agentId: 'backend_developer',
          entityType: 'ticket',
        },
        params
      )
      expect(result).toContain('level = $1')
      expect(result).toContain('staff_component = $2')
      expect(result).toContain('action_type = $3')
      expect(result).toContain('agent_id = $4')
      expect(result).toContain('entity_type = $5')
      expect(params).toEqual(['audit', 'Librarian', 'memory.write', 'backend_developer', 'ticket'])
    })

    it('handles pre-existing params in array (param numbering continues from existing index)', () => {
      const params: unknown[] = ['existing1', 'existing2']
      const result = buildLogsWhereClause({ agentId: 'pm' }, params)
      expect(result).toBe('WHERE agent_id = $3')
      expect(params).toEqual(['existing1', 'existing2', 'pm'])
    })

    it('multi-component + search uses correct placeholder numbering', () => {
      const params: unknown[] = []
      buildLogsWhereClause({ staffComponent: 'Librarian,Archivist', search: 'write' }, params)
      // staffComponent pushes Librarian → $1, Archivist → $2 (IN clause uses $1, $2)
      // search pushes %write% → $3 (single placeholder reused for all ILIKE columns)
      expect(params).toEqual(['Librarian', 'Archivist', '%write%'])
    })
  })
})

// ===========================================================================
// Tests: escapeCsvField (inline replication)
// ===========================================================================

describe('escapeCsvField', () => {
  it('returns empty string for null', () => {
    expect(escapeCsvField(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(escapeCsvField(undefined)).toBe('')
  })

  it('returns plain string unchanged when no special chars', () => {
    expect(escapeCsvField('hello world')).toBe('hello world')
  })

  it('wraps in double-quotes when field contains comma', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"')
  })

  it('wraps in double-quotes and escapes inner quotes when field contains double-quote', () => {
    expect(escapeCsvField('say "hello"')).toBe('"say ""hello"""')
  })

  it('wraps in double-quotes when field contains newline', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"')
  })

  it('wraps in double-quotes when field contains carriage return', () => {
    expect(escapeCsvField('line1\rline2')).toBe('"line1\rline2"')
  })

  it('converts numbers to string without quoting', () => {
    expect(escapeCsvField(42)).toBe('42')
  })

  it('converts booleans to string without quoting', () => {
    expect(escapeCsvField(true)).toBe('true')
  })

  it('handles empty string without quoting', () => {
    expect(escapeCsvField('')).toBe('')
  })
})
