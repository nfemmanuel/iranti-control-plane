/**
 * Unit tests for instances.ts pure functions.
 *
 * Tests the logic that does not touch the network or a live database:
 *   - parseEnvContent: line parsing (CRLF, comments, quoting)
 *   - parseAndRedactDbUrl: DATABASE_URL extraction and redaction
 *   - normalizeRuntimeRootCandidate: path normalization to runtime root
 *   - buildErrorInstance: safe fallback shape when aggregation fails
 *
 * probeInstance and discoverInstances require live HTTP/filesystem; they
 * are covered by integration tests against a running server.
 */

import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  parseEnvContent,
  parseAndRedactDbUrl,
  normalizeRuntimeRootCandidate,
  buildErrorInstance,
} from '../../routes/control-plane/instances.js'

// ---------------------------------------------------------------------------
// parseEnvContent
// ---------------------------------------------------------------------------

describe('parseEnvContent', () => {
  it('parses a simple KEY=VALUE line', () => {
    const result = parseEnvContent('IRANTI_PORT=3001\n')
    expect(result['IRANTI_PORT']).toBe('3001')
  })

  it('skips blank lines', () => {
    const result = parseEnvContent('\n\n\nIRANTI_PORT=3001\n\n')
    expect(Object.keys(result)).toHaveLength(1)
  })

  it('skips comment lines', () => {
    const result = parseEnvContent('# comment\nIRANTI_PORT=3001\n# another')
    expect(result).not.toHaveProperty('#')
    expect(result['IRANTI_PORT']).toBe('3001')
  })

  it('handles CRLF line endings', () => {
    const result = parseEnvContent('IRANTI_PORT=3001\r\nDATABASE_URL=postgres://localhost/db\r\n')
    expect(result['IRANTI_PORT']).toBe('3001')
    expect(result['DATABASE_URL']).toBe('postgres://localhost/db')
  })

  it('strips surrounding double quotes from values', () => {
    const result = parseEnvContent('IRANTI_API_KEY="my-key-value"\n')
    expect(result['IRANTI_API_KEY']).toBe('my-key-value')
  })

  it('strips surrounding single quotes from values', () => {
    const result = parseEnvContent("IRANTI_API_KEY='my-key-value'\n")
    expect(result['IRANTI_API_KEY']).toBe('my-key-value')
  })

  it('handles values with = in them', () => {
    // The value after the first = is taken verbatim
    const result = parseEnvContent('DATABASE_URL=postgres://user:p@host/db?sslmode=require\n')
    expect(result['DATABASE_URL']).toBe('postgres://user:p@host/db?sslmode=require')
  })

  it('returns empty object for empty input', () => {
    expect(parseEnvContent('')).toEqual({})
  })

  it('handles Windows-style paths as values', () => {
    const result = parseEnvContent('IRANTI_INSTANCE_ENV=C:\\Users\\NF\\.iranti-runtime\\instances\\local\\.env\n')
    expect(result['IRANTI_INSTANCE_ENV']).toBe('C:\\Users\\NF\\.iranti-runtime\\instances\\local\\.env')
  })

  it('parses multiple keys from a realistic instance env', () => {
    const content = [
      '# Iranti instance env',
      'IRANTI_INSTANCE_NAME=local',
      'IRANTI_PORT=3001',
      'DATABASE_URL=postgresql://postgres:secret@localhost:5435/iranti_local',
      'LLM_PROVIDER=openai',
      'OPENAI_API_KEY=sk-real-key',
    ].join('\n')

    const result = parseEnvContent(content)
    expect(result['IRANTI_INSTANCE_NAME']).toBe('local')
    expect(result['IRANTI_PORT']).toBe('3001')
    expect(result['LLM_PROVIDER']).toBe('openai')
    expect(result['OPENAI_API_KEY']).toBe('sk-real-key')
  })
})

// ---------------------------------------------------------------------------
// parseAndRedactDbUrl
// ---------------------------------------------------------------------------

describe('parseAndRedactDbUrl', () => {
  it('returns all-null for undefined input', () => {
    const result = parseAndRedactDbUrl(undefined)
    expect(result.host).toBeNull()
    expect(result.port).toBeNull()
    expect(result.name).toBeNull()
    expect(result.urlRedacted).toBeNull()
  })

  it('parses a standard postgres URL', () => {
    const result = parseAndRedactDbUrl('postgresql://postgres:secret@localhost:5435/iranti_local')
    expect(result.host).toBe('localhost')
    expect(result.port).toBe(5435)
    expect(result.name).toBe('iranti_local')
  })

  it('redacts credentials from the URL', () => {
    const result = parseAndRedactDbUrl('postgresql://user:very-secret-password@db.internal:5432/mydb')
    expect(result.urlRedacted).toBeTruthy()
    expect(result.urlRedacted).not.toContain('very-secret-password')
    expect(result.urlRedacted).toContain('***')
  })

  it('defaults port to 5432 when not in URL', () => {
    const result = parseAndRedactDbUrl('postgresql://user:pass@db.internal/mydb')
    expect(result.port).toBe(5432)
  })

  it('returns all-null for an unparsable URL', () => {
    const result = parseAndRedactDbUrl('not-a-url')
    expect(result.host).toBeNull()
    expect(result.urlRedacted).toBeNull()
  })

  it('extracts database name from path', () => {
    const result = parseAndRedactDbUrl('postgres://localhost:5432/my_database')
    expect(result.name).toBe('my_database')
  })
})

// ---------------------------------------------------------------------------
// normalizeRuntimeRootCandidate
// ---------------------------------------------------------------------------

describe('normalizeRuntimeRootCandidate', () => {
  const BASE = join(tmpdir(), 'iranti-test-normalize')

  it('returns the path as-is when it is already the runtime root', () => {
    const runtimeRoot = join(BASE, '.iranti-runtime')
    const result = normalizeRuntimeRootCandidate(runtimeRoot)
    // resolve() is applied; the leaf is '.iranti-runtime' (not 'instances')
    expect(result).toBe(runtimeRoot)
  })

  it('strips the trailing /instances segment', () => {
    const instancesDir = join(BASE, '.iranti-runtime', 'instances')
    const result = normalizeRuntimeRootCandidate(instancesDir)
    expect(result).toBe(join(BASE, '.iranti-runtime'))
  })

  it('strips two segments when given a concrete instance directory', () => {
    const instanceDir = join(BASE, '.iranti-runtime', 'instances', 'local')
    const result = normalizeRuntimeRootCandidate(instanceDir)
    expect(result).toBe(join(BASE, '.iranti-runtime'))
  })

  it('is case-insensitive for the instances segment', () => {
    // Windows paths can have mixed case for directory names
    const instancesDir = join(BASE, '.iranti-runtime', 'Instances')
    const result = normalizeRuntimeRootCandidate(instancesDir)
    expect(result).toBe(join(BASE, '.iranti-runtime'))
  })
})

// ---------------------------------------------------------------------------
// buildErrorInstance
// ---------------------------------------------------------------------------

describe('buildErrorInstance', () => {
  const runtimeRoot = join(tmpdir(), 'iranti-test-error', '.iranti-runtime')
  const instanceDir = join(runtimeRoot, 'instances', 'local')

  it('returns a valid InstanceMetadata shape', () => {
    const result = buildErrorInstance(runtimeRoot, instanceDir, null, 'some error')
    expect(result.instanceId).toBeTruthy()
    expect(result.name).toBe('local')
    expect(result.setupState).toBe('incomplete')
    expect(result.runtimeRoot).toBe(runtimeRoot)
    expect(result.runningStatus).toBe('unreachable')
    expect(result.runtimeStatus).toBe('unknown')
    expect(result.runtime).toBeNull()
  })

  it('encodes the error message in notes', () => {
    const result = buildErrorInstance(runtimeRoot, instanceDir, null, 'disk read failed')
    expect(result.notes).toContain('disk read failed')
  })

  it('preserves registeredAt when provided', () => {
    const registeredAt = '2026-03-22T10:00:00Z'
    const result = buildErrorInstance(runtimeRoot, instanceDir, registeredAt, 'err')
    expect(result.registeredAt).toBe(registeredAt)
    expect(result.discoveredAt).toBe(registeredAt)
  })

  it('returns empty keysPresent and keysMissing', () => {
    const result = buildErrorInstance(runtimeRoot, instanceDir, null, 'err')
    expect(result.envFile.keysPresent).toEqual([])
    expect(result.envFile.keysMissing).toEqual([])
  })

  it('returns false for all provider key presence', () => {
    const result = buildErrorInstance(runtimeRoot, instanceDir, null, 'err')
    expect(result.integration.providerKeys.anthropic).toBe(false)
    expect(result.integration.providerKeys.openai).toBe(false)
  })
})
