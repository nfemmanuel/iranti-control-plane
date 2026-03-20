/* Iranti Control Plane — Health check remediation strings */
/* Maintained as a separate constants file per CP-T016 design note */
/* Update this file when health check definitions evolve. */

export interface RemediationEntry {
  status: 'warn' | 'error'
  text: string
}

export const REMEDIATION: Record<string, Record<string, string>> = {
  db_reachability: {
    error:
      'Iranti cannot connect to PostgreSQL. Ensure PostgreSQL is running and DATABASE_URL in .env.iranti is correct. ' +
      'Check that the host, port, and credentials in the connection string are reachable from this machine.',
    warn:
      'Database connection is degraded. Verify that PostgreSQL is running and that DATABASE_URL in .env.iranti is set correctly.',
  },
  db_schema_version: {
    warn:
      'The database schema is behind the expected migration version. ' +
      'Run the Iranti database migrations to bring the schema up to date: `iranti migrate`.',
    error:
      'The database schema version could not be determined. ' +
      'The schema may be uninitialized. Run `iranti migrate` to initialize the database.',
  },
  vector_backend: {
    warn:
      'pgvector extension is not installed or not configured. ' +
      'Run this in your PostgreSQL database: CREATE EXTENSION IF NOT EXISTS vector; ' +
      'Then restart Iranti.',
    error:
      'The vector backend is unreachable or misconfigured. ' +
      'Run: CREATE EXTENSION IF NOT EXISTS vector; in your PostgreSQL database, then restart Iranti.',
  },
  anthropic_key: {
    warn:
      'ANTHROPIC_API_KEY is not set in .env.iranti. ' +
      'Add: ANTHROPIC_API_KEY=sk-ant-... to your .env.iranti file and restart Iranti. ' +
      'You need at least one provider key (Anthropic or OpenAI) for Iranti to function.',
  },
  openai_key: {
    warn:
      'OPENAI_API_KEY is not set in .env.iranti. ' +
      'If you intend to use OpenAI as a provider, add: OPENAI_API_KEY=sk-... to your .env.iranti file and restart Iranti.',
  },
  default_provider_configured: {
    warn:
      'DEFAULT_PROVIDER (or IRANTI_DEFAULT_PROVIDER) is not set in .env.iranti. ' +
      'Iranti will use its built-in fallback, which may not match your preferred provider. ' +
      'Add: DEFAULT_PROVIDER=anthropic to your .env.iranti file and restart.',
    error:
      'DEFAULT_PROVIDER is set to an unrecognized value in .env.iranti. ' +
      'Valid values are: anthropic, openai. ' +
      'Update the value and restart Iranti.',
  },
  mcp_integration: {
    warn:
      'No .mcp.json was found in the current project, or the file does not include an Iranti server entry. ' +
      'Add an .mcp.json file to your project root with an Iranti server entry. See the Iranti docs for the correct format.',
  },
  claude_md_integration: {
    warn:
      'CLAUDE.md is absent from the current project, or it does not reference Iranti. ' +
      'Add a CLAUDE.md to your project root and include an Iranti context section so Claude Code has access to Iranti instructions.',
  },
  runtime_version: {
    warn:
      'The running Iranti version could not be determined. ' +
      'This is usually harmless, but if you are troubleshooting, ensure Iranti is running and the version file is accessible.',
  },
  staff_events_table: {
    warn:
      'The staff_events table does not exist in your database. ' +
      'This is expected if you have not yet applied the CP-T001 migration. ' +
      'Run the database migration to enable the Staff Activity Stream: `iranti migrate`.',
    error:
      'The staff_events table is missing and the migration could not be confirmed. ' +
      'Run `iranti migrate` to apply all pending migrations.',
  },
}

/**
 * Returns remediation text for a given check name and status.
 * Returns null if no remediation is defined (e.g. status is "ok").
 */
export function getRemediation(checkName: string, status: 'ok' | 'warn' | 'error'): string | null {
  if (status === 'ok') return null
  const entry = REMEDIATION[checkName]
  if (!entry) return null
  return entry[status] ?? entry['warn'] ?? null
}
