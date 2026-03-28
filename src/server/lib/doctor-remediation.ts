import type { ResolvedInstanceAuthority } from './instance-authority.js'

export interface DoctorCommand {
  label: string
  command: string
  allowRun?: boolean
  cwd?: string | null
}

export interface DoctorRemediation {
  operatorNote: string | null
  commands: DoctorCommand[]
}

export type PgvectorIssue =
  | 'database_unreachable'
  | 'database_missing'
  | 'missing_extension'
  | 'generic'

interface ParsedDatabaseTarget {
  host: string | null
  port: number | null
  name: string | null
  user: string | null
  password: string | null
  isLocal: boolean
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function quoteCommandArg(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function buildIrantiDoctorCommand(scope: ResolvedInstanceAuthority): string {
  const quotedRoot = quoteCommandArg(scope.runtimeRoot)
  return `iranti doctor --instance ${scope.instanceName} --root ${quotedRoot}`
}

function buildDockerContainerName(scope: ResolvedInstanceAuthority): string {
  const suffix = scope.instanceName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return suffix ? `iranti_pgvector_${suffix}` : 'iranti_pgvector'
}

export function parseDatabaseTarget(databaseUrl: string | null | undefined): ParsedDatabaseTarget | null {
  if (!databaseUrl) return null

  try {
    const parsed = new URL(databaseUrl)
    const host = parsed.hostname || null
    return {
      host,
      port: parsed.port ? Number.parseInt(parsed.port, 10) : 5432,
      name: parsed.pathname.replace(/^\//, '') || null,
      user: parsed.username ? decodeURIComponent(parsed.username) : null,
      password: parsed.password ? decodeURIComponent(parsed.password) : null,
      isLocal: host ? LOCAL_HOSTS.has(host.toLowerCase()) : false,
    }
  } catch {
    return null
  }
}

export function classifyPgvectorIssue(detail: string | null | undefined): PgvectorIssue {
  const normalized = (detail ?? '').trim().toLowerCase()

  if (/does not exist|unknown database|3d000/.test(normalized)) {
    return 'database_missing'
  }

  if (
    /extension "vector" is not available|pgvector extension is not installed|does not have the pgvector extension installed|create extension if not exists vector|no pgvector/.test(
      normalized
    )
  ) {
    return 'missing_extension'
  }

  if (
    /unreachable|database not reachable|econnrefused|connect timeout|timed out|failed to connect|could not connect|connection terminated/.test(
      normalized
    )
  ) {
    return 'database_unreachable'
  }

  return 'generic'
}

function buildCreateDatabaseCommand(target: ParsedDatabaseTarget): DoctorCommand | null {
  if (!target.host || !target.port || !target.user || !target.name) return null
  return {
    label: 'Create the missing database',
    command:
      `createdb -h ${quoteCommandArg(target.host)} -p ${target.port} ` +
      `-U ${quoteCommandArg(target.user)} ${quoteCommandArg(target.name)}`,
    allowRun: false,
  }
}

function buildCreateExtensionCommand(target: ParsedDatabaseTarget): DoctorCommand | null {
  if (!target.host || !target.port || !target.user || !target.name) return null
  return {
    label: 'Enable pgvector in this database',
    command:
      `psql -h ${quoteCommandArg(target.host)} -p ${target.port} ` +
      `-U ${quoteCommandArg(target.user)} -d ${quoteCommandArg(target.name)} ` +
      `-c "CREATE EXTENSION IF NOT EXISTS vector;"`,
    allowRun: false,
  }
}

function buildDockerRunCommand(scope: ResolvedInstanceAuthority, target: ParsedDatabaseTarget): DoctorCommand | null {
  if (!target.isLocal || !target.port || !target.name || !target.user) return null

  const password = target.password && target.password.trim() !== '' ? target.password : 'postgres'

  return {
    label: 'Start a local pgvector database with Docker',
    command:
      `docker run -d --name ${buildDockerContainerName(scope)} ` +
      `-e POSTGRES_USER=${quoteCommandArg(target.user)} ` +
      `-e POSTGRES_PASSWORD=${quoteCommandArg(password)} ` +
      `-e POSTGRES_DB=${quoteCommandArg(target.name)} ` +
      `-p ${target.port}:5432 pgvector/pgvector:pg16`,
    allowRun: false,
  }
}

export function buildPgvectorRemediation(
  scope: ResolvedInstanceAuthority,
  detail: string | null | undefined
): DoctorRemediation {
  const target = parseDatabaseTarget(scope.databaseUrl)
  const issue = classifyPgvectorIssue(detail)
  const commands: DoctorCommand[] = []
  const doctorCommand: DoctorCommand = {
    label: 'Re-run Iranti doctor',
    command: buildIrantiDoctorCommand(scope),
    allowRun: true,
  }

  if (!target) {
    return {
      operatorNote:
        'This instance does not have a usable DATABASE_URL yet. The safest local path on macOS, Windows, and Linux is a pgvector Docker container plus a refreshed instance env.',
      commands: [doctorCommand],
    }
  }

  if (issue === 'database_missing') {
    const createDb = buildCreateDatabaseCommand(target)
    const createExtension = buildCreateExtensionCommand(target)
    if (createDb) commands.push(createDb)
    if (createExtension) commands.push(createExtension)
    commands.push(doctorCommand)

    return {
      operatorNote: target.isLocal
        ? 'The PostgreSQL server is reachable, but the target database does not exist yet. Create the database, enable pgvector, then rerun doctor. If you would rather avoid local PostgreSQL setup, switch this instance to a Docker-backed pgvector database.'
        : 'The configured PostgreSQL server is reachable, but the target database does not exist yet. Create the database, enable pgvector, then rerun doctor.',
      commands,
    }
  }

  if (issue === 'missing_extension') {
    const createExtension = buildCreateExtensionCommand(target)
    if (createExtension) commands.push(createExtension)
    commands.push(doctorCommand)

    return {
      operatorNote: target.isLocal
        ? 'This PostgreSQL server is reachable, but it does not expose pgvector. If you can install extensions here, run the psql command below. Otherwise move this instance to a Docker-backed pgvector database.'
        : 'This instance points at a non-local PostgreSQL server. That server must provide the pgvector extension for the default vector backend.',
      commands,
    }
  }

  if (issue === 'database_unreachable') {
    const dockerCommand = buildDockerRunCommand(scope, target)
    if (dockerCommand) commands.push(dockerCommand)
    commands.push(doctorCommand)

    return {
      operatorNote: target.isLocal
        ? 'Best cross-platform local fix: start a pgvector Docker container on the configured localhost port, then rerun doctor. The Docker command below works on macOS, Windows, and Linux.'
        : 'This instance points at a non-local PostgreSQL host and the pgvector backend is unreachable. Verify that the database server is online, reachable from this machine, and still matches DATABASE_URL.',
      commands,
    }
  }

  const fallbackDockerCommand = buildDockerRunCommand(scope, target)
  if (fallbackDockerCommand) commands.push(fallbackDockerCommand)
  commands.push(doctorCommand)

  return {
    operatorNote: target.isLocal
      ? 'Iranti could not complete the pgvector check cleanly. If the current local PostgreSQL server is unreliable, the Docker pgvector path below is the fastest cross-platform reset on macOS, Windows, and Linux.'
      : 'Iranti could not complete the pgvector check cleanly. Verify the configured PostgreSQL server, then rerun doctor.',
    commands,
  }
}
