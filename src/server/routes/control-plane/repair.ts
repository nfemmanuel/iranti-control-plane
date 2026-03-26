import { Router, Request, Response, NextFunction } from 'express'
import { access, readFile, writeFile, constants } from 'fs/promises'
import { join, basename } from 'path'
import pg from 'pg'
import { ApiError } from '../../types.js'
import {
  resolveInstanceAuthority,
  resolveBoundProjectPath,
  ResolvedInstanceAuthority,
} from '../../lib/instance-authority.js'
import { runIrantiJson } from '../../lib/iranti-cli.js'
import { inspectProjectIntegration } from '../../lib/project-integration.js'

export const repairRouter = Router()
const { Pool } = pg

interface DoctorCheck {
  id: string
  label: string
  status: 'pass' | 'fail' | 'warn'
  message: string
  repairAction: string | null
}

interface CliDoctorCheck {
  name: string
  status: 'pass' | 'fail' | 'warn'
  detail: string
}

interface CliDoctorResponse {
  status: 'pass' | 'fail' | 'warn'
  checks: CliDoctorCheck[]
  remediations?: string[]
}

async function doctorCheckRuntimeAvailability(scope: ResolvedInstanceAuthority): Promise<DoctorCheck> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2500)

  try {
    const res = await fetch(`${scope.apiBaseUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    })

    if (res.ok) {
      return {
        id: 'runtime_availability',
        label: 'Runtime availability',
        status: 'pass',
        message: `Iranti runtime is running and reachable at ${scope.apiBaseUrl}.`,
        repairAction: null,
      }
    }

    return {
      id: 'runtime_availability',
      label: 'Runtime availability',
      status: res.status >= 500 ? 'fail' : 'warn',
      message: `Iranti runtime responded with HTTP ${res.status}; runtime-only checks may be incomplete.`,
      repairAction: null,
    }
  } catch {
    return {
      id: 'runtime_availability',
      label: 'Runtime availability',
      status: 'warn',
      message: `Iranti runtime is not running or not reachable at ${scope.apiBaseUrl}; runtime-only checks were skipped.`,
      repairAction: null,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function requireConfirm(req: Request, res: Response): boolean {
  if (req.query['confirm'] !== 'true') {
    res.status(400).json({
      error: 'Confirmation required',
      code: 'CONFIRM_REQUIRED',
      hint: 'Add ?confirm=true to confirm this action.',
    })
    return false
  }
  return true
}

async function resolveScopeOr404(instanceRef: string, res: Response): Promise<ResolvedInstanceAuthority | null> {
  const scope = await resolveInstanceAuthority(instanceRef)
  if (!scope) {
    res.status(404).json({
      error: 'Instance not found',
      code: 'INSTANCE_NOT_FOUND',
    })
    return null
  }
  return scope
}

async function resolveProjectOr422(
  scope: ResolvedInstanceAuthority,
  projectId: string,
  res: Response
): Promise<string | null> {
  const projectPath = await resolveBoundProjectPath(
    scope.instanceName,
    scope.runtimeRoot,
    scope.instanceEnvPath,
    projectId
  )

  if (!projectPath) {
    res.status(422).json({
      error: 'Project is not bound to this instance',
      code: 'PROJECT_NOT_BOUND',
      hint: 'Bind the project first, then retry the repair action from the instance details view.',
    })
    return null
  }

  return projectPath
}

async function writeAuditLog(
  scope: ResolvedInstanceAuthority,
  action: string,
  detail: Record<string, unknown>
): Promise<void> {
  if (!scope.databaseUrl) return

  const pool = new Pool({
    connectionString: scope.databaseUrl,
    max: 1,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 3000,
  })

  try {
    await pool.query(
      `INSERT INTO staff_events
         (staff_component, action_type, agent_id, source, reason, level, metadata, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)`,
      [
        'Librarian',
        action,
        'control_plane_repair',
        'control_plane',
        `Repair action: ${action}`,
        'audit',
        JSON.stringify(detail),
        new Date().toISOString(),
      ]
    )
  } catch {
    // best-effort audit only
  } finally {
    await pool.end().catch(() => {})
  }
}

repairRouter.post(
  '/:instanceId/projects/:projectId/repair/mcp-json',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!requireConfirm(req, res)) return

      const scope = await resolveScopeOr404(req.params['instanceId'], res)
      if (!scope) return

      const projectPath = await resolveProjectOr422(scope, req.params['projectId'], res)
      if (!projectPath) return

      await access(projectPath, constants.W_OK)
      const filePath = join(projectPath, '.mcp.json')
      const content = JSON.stringify(
        {
          mcpServers: {
            iranti: {
              command: 'iranti',
              args: ['mcp'],
            },
          },
        },
        null,
        2
      ) + '\n'

      let action: 'created' | 'replaced' = 'created'
      try {
        await access(filePath, constants.F_OK)
        action = 'replaced'
      } catch {
        action = 'created'
      }

      await writeFile(filePath, content, 'utf8')
      await writeAuditLog(scope, 'repair_mcp_json', {
        instanceId: scope.instanceId,
        instanceName: scope.instanceName,
        projectPath,
        filePath,
        action,
      })

      res.json({ filePath, content, action, revertable: false })
    } catch (err) {
      next(err)
    }
  }
)

const IRANTI_BLOCK_START = '<!-- IRANTI:START -->'
const IRANTI_BLOCK_END = '<!-- IRANTI:END -->'
const IRANTI_BLOCK_RE = /<!-- IRANTI:START -->[\s\S]*?<!-- IRANTI:END -->/

function buildIrantiBlock(scope: ResolvedInstanceAuthority): string {
  return `<!-- IRANTI:START -->
## Shared Memory - Iranti

This project is bound to the Iranti instance \`${scope.instanceName}\`.
Iranti is available at \`${scope.apiBaseUrl}\`.
Connection details live in \`.env.iranti\`.

Every agent must:
1. Call \`iranti_handshake\` at session start.
2. Query Iranti before making architectural decisions.
3. Write stable outputs back to Iranti.
<!-- IRANTI:END -->`
}

function buildDiff(before: string | null, after: string): string {
  if (before === null) return `+++ (new file)\n${after}`
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const removed = beforeLines.filter((line) => !afterLines.includes(line)).map((line) => `- ${line}`).join('\n')
  const added = afterLines.filter((line) => !beforeLines.includes(line)).map((line) => `+ ${line}`).join('\n')
  return [removed, added].filter(Boolean).join('\n') || '(no textual diff)'
}

repairRouter.post(
  '/:instanceId/projects/:projectId/repair/claude-md',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!requireConfirm(req, res)) return

      const scope = await resolveScopeOr404(req.params['instanceId'], res)
      if (!scope) return

      const projectPath = await resolveProjectOr422(scope, req.params['projectId'], res)
      if (!projectPath) return

      await access(projectPath, constants.W_OK)
      const filePath = join(projectPath, 'CLAUDE.md')
      const block = buildIrantiBlock(scope)

      let existingContent: string | null = null
      try {
        existingContent = await readFile(filePath, 'utf8')
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }

      let finalContent: string
      let action: 'appended' | 'replaced' | 'created'

      if (existingContent === null) {
        finalContent = block + '\n'
        action = 'created'
      } else {
        const hasStart = existingContent.includes(IRANTI_BLOCK_START)
        const hasEnd = existingContent.includes(IRANTI_BLOCK_END)
        if (hasStart !== hasEnd) {
          res.status(422).json({
            error: 'Malformed Iranti block',
            code: 'MALFORMED_BLOCK',
            suggestion: 'Remove the broken IRANTI:START/END markers from CLAUDE.md and retry.',
          })
          return
        }

        if (hasStart && hasEnd) {
          finalContent = existingContent.replace(IRANTI_BLOCK_RE, block)
          action = 'replaced'
        } else {
          finalContent = existingContent.trimEnd() + '\n\n' + block + '\n'
          action = 'appended'
        }
      }

      const diff = buildDiff(existingContent, finalContent)
      await writeFile(filePath, finalContent, 'utf8')

      await writeAuditLog(scope, 'repair_claude_md', {
        instanceId: scope.instanceId,
        instanceName: scope.instanceName,
        projectPath,
        filePath,
        action,
      })

      res.json({ filePath, action, diff, revertable: false })
    } catch (err) {
      next(err)
    }
  }
)

async function doctorCheckDatabase(databaseUrl: string | null): Promise<DoctorCheck> {
  if (!databaseUrl) {
    return {
      id: 'database_reachability',
      label: 'Database connection',
      status: 'fail',
      message: 'DATABASE_URL is not configured for this instance.',
      repairAction: null,
    }
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 2000,
  })

  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ])
    return {
      id: 'database_reachability',
      label: 'Database connection',
      status: 'pass',
      message: 'Database connection is healthy.',
      repairAction: null,
    }
  } catch {
    return {
      id: 'database_reachability',
      label: 'Database connection',
      status: 'fail',
      message: 'Database not reachable for this instance. Check DATABASE_URL and the database service.',
      repairAction: null,
    }
  } finally {
    await pool.end().catch(() => {})
  }
}

function doctorCheckProvider(scope: ResolvedInstanceAuthority): DoctorCheck {
  const anthropicKey = scope.env['ANTHROPIC_API_KEY'] ?? ''
  const openaiKey = scope.env['OPENAI_API_KEY'] ?? ''
  const hasKey = anthropicKey.trim() !== '' || openaiKey.trim() !== ''

  return {
    id: 'provider_config',
    label: 'Provider configuration',
    status: hasKey ? 'pass' : 'warn',
    message: hasKey
      ? 'At least one LLM provider key is configured.'
      : 'No LLM provider key found in this instance env. Configure a provider key, then restart Iranti.',
    repairAction: null,
  }
}

function doctorCheckProjectBindings(scope: ResolvedInstanceAuthority): DoctorCheck {
  return {
    id: 'project_bindings',
    label: 'Project bindings',
    status: scope.boundProjects.length > 0 ? 'pass' : 'warn',
    message: scope.boundProjects.length > 0
      ? `${scope.boundProjects.length} bound project${scope.boundProjects.length === 1 ? '' : 's'} discovered for this instance.`
      : 'No bound projects found for this instance. Project integration checks cannot be run until a project is bound.',
    repairAction: null,
  }
}

function projectRepairUrl(scope: ResolvedInstanceAuthority, projectPath: string, kind: 'mcp-json' | 'claude-md'): string {
  const encoded = encodeURIComponent(projectPath)
  return `/api/control-plane/instances/${encodeURIComponent(scope.instanceId)}/projects/${encoded}/repair/${kind}`
}

function doctorProjectChecks(scope: ResolvedInstanceAuthority): DoctorCheck[] {
  return scope.boundProjects.flatMap((project) => {
    const integration = inspectProjectIntegration(project.projectPath)
    const projectName = basename(project.projectPath)

    const mcpCheck: DoctorCheck = {
      id: `mcp_integration:${project.projectPath}`,
      label: `MCP integration (${projectName})`,
      status: integration.mcpJsonPresent && integration.mcpJsonHasIranti ? 'pass' : 'warn',
      message: integration.mcpJsonPresent && integration.mcpJsonHasIranti
        ? `.mcp.json is present and configured for ${project.projectPath}.`
        : `.mcp.json is missing or does not include an Iranti entry for ${project.projectPath}.`,
      repairAction: integration.mcpJsonPresent && integration.mcpJsonHasIranti
        ? null
        : projectRepairUrl(scope, project.projectPath, 'mcp-json'),
    }

    const claudeCheck: DoctorCheck = {
      id: `claude_md_integration:${project.projectPath}`,
      label: `CLAUDE.md integration (${projectName})`,
      status: integration.claudeMdPresent && integration.claudeMdHasIranti ? 'pass' : 'warn',
      message: integration.claudeMdPresent && integration.claudeMdHasIranti
        ? `CLAUDE.md references Iranti for ${project.projectPath}.`
        : `CLAUDE.md is missing or does not reference Iranti for ${project.projectPath}.`,
      repairAction: integration.claudeMdPresent && integration.claudeMdHasIranti
        ? null
        : projectRepairUrl(scope, project.projectPath, 'claude-md'),
    }

    return [mcpCheck, claudeCheck]
  })
}

function slugifyDoctorCheckId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function mapCliDoctorChecks(payload: CliDoctorResponse): DoctorCheck[] {
  const checks = payload.checks.map((check) => ({
    id: `iranti_doctor:${slugifyDoctorCheckId(check.name)}`,
    label: check.name,
    status: check.status,
    message: check.detail,
    repairAction: null,
  }))

  const remediations = (payload.remediations ?? []).map((detail, index) => ({
    id: `iranti_doctor:remediation_${index + 1}`,
    label: `Recommended remediation ${index + 1}`,
    status: payload.status === 'fail' ? 'fail' as const : 'warn' as const,
    message: detail,
    repairAction: null,
  }))

  return [...checks, ...remediations]
}

repairRouter.post('/:instanceId/doctor', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await resolveScopeOr404(req.params['instanceId'], res)
    if (!scope) return

    const [dbCheck, runtimeCheck] = await Promise.all([
      doctorCheckDatabase(scope.databaseUrl),
      doctorCheckRuntimeAvailability(scope),
    ])

    let checks: DoctorCheck[]

    try {
      const doctor = await runIrantiJson<CliDoctorResponse>([
        'doctor',
        '--instance',
        scope.instanceName,
        '--root',
        scope.runtimeRoot,
        '--json',
      ], { allowNonZeroExit: true })
      checks = mapCliDoctorChecks(doctor.json)
    } catch (error) {
      checks = [
        {
          id: 'iranti_doctor_unavailable',
          label: 'Iranti doctor',
          status: 'warn',
          message: error instanceof Error
            ? error.message
            : String(error),
          repairAction: null,
        },
        runtimeCheck,
        dbCheck,
        doctorCheckProvider(scope),
      ]
    }

    checks.push(
      runtimeCheck,
      dbCheck,
      doctorCheckProvider(scope),
      doctorCheckProjectBindings(scope),
      ...doctorProjectChecks(scope),
    )

    checks = Array.from(
      new Map(checks.map((check) => [check.id, check])).values()
    )

    res.json({
      instanceId: scope.instanceId,
      checks,
      checkedAt: new Date().toISOString(),
    })
  } catch (err) {
    next(err)
  }
})

repairRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const apiErr = err as ApiError
  if ((err as NodeJS.ErrnoException)?.code === 'EACCES') {
    res.status(403).json({
      error: 'Directory not writable',
      code: 'PERMISSION_DENIED',
      suggestion: 'Check filesystem permissions for the target project directory.',
    })
    return
  }

  res.status(apiErr.statusCode ?? 500).json({
    error: apiErr.message ?? 'Internal server error',
    code: apiErr.code ?? 'INTERNAL_ERROR',
  })
})
