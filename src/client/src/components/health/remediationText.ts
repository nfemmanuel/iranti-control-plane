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
      'Iranti cannot connect to PostgreSQL. Ensure PostgreSQL is running and DATABASE_URL in your instance .env file is correct. ' +
      'Check that the host, port, and credentials in the connection string are reachable from this machine. ' +
      'Run `iranti instance show local` to inspect the current database config.',
    warn:
      'Database connection is degraded. Verify that PostgreSQL is running and that DATABASE_URL in your instance .env file is set correctly. ' +
      'Run `iranti doctor --instance local` for a full environment check.',
  },
  db_schema_version: {
    warn:
      'The Iranti database schema may need migrations applied. ' +
      'Run `iranti doctor --instance local` to check schema state and follow any prompts.',
    error:
      'The Iranti database schema version could not be determined — the schema may be uninitialized. ' +
      'Run `iranti doctor --instance local` to diagnose and apply any pending migrations.',
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
      'ANTHROPIC_API_KEY is not set but Claude is your active provider. ' +
      'Add the key via the Provider Manager, or run: `iranti add api-key claude --instance local` ' +
      'to store it in your instance config.',
  },
  openai_key: {
    warn:
      'OPENAI_API_KEY is not set but OpenAI is your active provider. ' +
      'Add the key via the Provider Manager, or run: `iranti add api-key openai --instance local` ' +
      'to store it in your instance config.',
  },
  default_provider_configured: {
    warn:
      'LLM_PROVIDER is not set in the instance .env file. ' +
      'Iranti will use its built-in fallback, which may not match your preferred provider. ' +
      'Set LLM_PROVIDER=openai (or claude) in the instance .env file ' +
      '(e.g. ~/.iranti-runtime/instances/local/.env) and restart Iranti.',
    error:
      'LLM_PROVIDER is set to an unrecognized value in the instance .env file. ' +
      'Valid values are: claude, openai, ollama, groq, mistral, together, gemini. ' +
      'Update LLM_PROVIDER in the instance .env file and restart Iranti.',
  },
  mcp_integration: {
    warn:
      'No bound project for this instance has a valid .mcp.json with an Iranti entry. ' +
      'Bind the project first if needed, then add or repair .mcp.json in the bound project directory.',
  },
  claude_md_integration: {
    warn:
      'No bound project for this instance has a CLAUDE.md that references Iranti. ' +
      'Bind the project first if needed, then add or repair CLAUDE.md in the bound project directory.',
  },
  runtime_version: {
    warn:
      'The running Iranti version could not be determined. ' +
      'This is usually harmless, but if you are troubleshooting, ensure Iranti is running and the version file is accessible.',
  },
  staff_events_table: {
    warn:
      'The staff_events table does not exist in your database. ' +
      'Run the control plane migrations to enable the Staff Activity Stream: ' +
      '`npm run migrate` from your iranti-control-plane directory.',
    error:
      'The staff_events table is missing. ' +
      'Run `npm run migrate` from your iranti-control-plane directory to apply pending migrations.',
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
