import { describe, expect, it } from 'vitest'
import { buildPgvectorRemediation, classifyPgvectorIssue, parseDatabaseTarget } from '../../lib/doctor-remediation.js'
import type { ResolvedInstanceAuthority } from '../../lib/instance-authority.js'

function createScope(databaseUrl: string | null): ResolvedInstanceAuthority {
  return {
    instanceId: 'demo',
    instanceName: 'demo',
    runtimeRoot: '/tmp/iranti-runtime',
    instanceDir: '/tmp/iranti-runtime/instances/demo',
    instanceEnvPath: '/tmp/iranti-runtime/instances/demo/.env',
    apiBaseUrl: 'http://localhost:3001',
    apiKey: 'test-key',
    env: {},
    databaseUrl,
    boundProjects: [],
    source: 'query',
  }
}

describe('doctor remediation helpers', () => {
  it('parses local database targets correctly', () => {
    expect(parseDatabaseTarget('postgresql://postgres:secret@localhost:5436/iranti')).toEqual({
      host: 'localhost',
      port: 5436,
      name: 'iranti',
      user: 'postgres',
      password: 'secret',
      isLocal: true,
    })
  })

  it('classifies missing extension failures', () => {
    expect(classifyPgvectorIssue('Local PostgreSQL server does not have the pgvector extension installed.')).toBe('missing_extension')
  })

  it('builds a Docker-first remediation path for unreachable local pgvector', () => {
    const remediation = buildPgvectorRemediation(
      createScope('postgresql://postgres:secret@localhost:5436/iranti'),
      'pgvector is unreachable'
    )

    expect(remediation.operatorNote).toContain('macOS, Windows, and Linux')
    expect(remediation.commands[0]?.label).toBe('Start a local pgvector database with Docker')
    expect(remediation.commands[0]?.command).toContain('-p 5436:5432')
    expect(remediation.commands[0]?.command).toContain("POSTGRES_DB='iranti'")
    expect(remediation.commands[1]?.command).toContain('iranti doctor --instance demo')
  })

  it('builds extension guidance for reachable databases without pgvector', () => {
    const remediation = buildPgvectorRemediation(
      createScope('postgresql://postgres:secret@localhost:5432/iranti'),
      'pgvector extension is not installed'
    )

    expect(remediation.commands[0]?.label).toBe('Enable pgvector in this database')
    expect(remediation.commands[0]?.command).toContain('CREATE EXTENSION IF NOT EXISTS vector')
    expect(remediation.commands.some((command) => command.command.startsWith('docker run'))).toBe(false)
  })

  it('avoids Docker-specific remediation for remote databases', () => {
    const remediation = buildPgvectorRemediation(
      createScope('postgresql://postgres:secret@db.example.com:5432/iranti'),
      'pgvector is unreachable'
    )

    expect(remediation.operatorNote).toContain('non-local PostgreSQL host')
    expect(remediation.commands).toHaveLength(1)
    expect(remediation.commands[0]?.command).toContain('iranti doctor --instance demo')
  })
})
