/**
 * Repair routes — mutation endpoints that fix common misconfigurations.
 *
 * POST /:instanceId/projects/:projectId/repair/mcp-json   — regenerate .mcp.json
 * POST /:instanceId/projects/:projectId/repair/claude-md  — inject/update Iranti block in CLAUDE.md
 * POST /:instanceId/doctor                                — run diagnostic checks
 *
 * All mutation endpoints require ?confirm=true.
 * All repair actions are logged to the audit trail (staff_events) with agentId: control_plane_repair.
 */

import { Router, Request, Response, NextFunction } from 'express'
import { access, readFile, writeFile, constants } from 'fs/promises'
import { join } from 'path'
import { createHash } from 'crypto'
import { query, env } from '../../db.js'
import { ApiError } from '../../types.js'

export const repairRouter = Router()

// ---------------------------------------------------------------------------
// Instance ID derivation
// ---------------------------------------------------------------------------

function deriveInstanceId(runtimeRoot: string): string {
  const normalized = runtimeRoot.toLowerCase().replace(/\\/g, '/')
  return createHash('sha256').update(normalized).digest('hex').slice(0, 8)
}

const THIS_INSTANCE_ID = deriveInstanceId(process.cwd())

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function validateInstance(instanceId: string, res: Response): boolean {
  if (instanceId !== THIS_INSTANCE_ID) {
    res.status(404).json({
      error: 'Instance not found',
      code: 'INSTANCE_NOT_FOUND',
    })
    return false
  }
  return true
}

function getPort(): string {
  return env['PORT'] || process.env['PORT'] || '3001'
}

/**
 * Write an audit log entry to staff_events.
 * Fails silently if the table does not exist — repair actions must not fail because
 * the audit table is missing (staff_events requires CP-T001 migration).
 */
async function writeAuditLog(
  action: string,
  detail: Record<string, unknown>
): Promise<void> {
  try {
    await query(
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
    // staff_events table may not exist — log to console only
    console.warn(`[repair] audit log skipped (staff_events unavailable): ${action}`, detail)
  }
}

// ---------------------------------------------------------------------------
// POST /:instanceId/projects/:projectId/repair/mcp-json
// ---------------------------------------------------------------------------

repairRouter.post(
  '/:instanceId/projects/:projectId/repair/mcp-json',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { instanceId, projectId } = req.params
      if (!validateInstance(instanceId, res)) return
      if (!requireConfirm(req, res)) return

      // Resolve write target: use process.cwd() as Phase 1 proxy for the project root.
      // Phase 2 will resolve projectId to an actual project root from the binding registry.
      const writeDir = process.cwd()

      // Check write access
      try {
        await access(writeDir, constants.W_OK)
      } catch {
        res.status(403).json({
          error: 'Directory not writable',
          code: 'PERMISSION_DENIED',
          suggestion:
            'Check file system permissions for the Iranti working directory, or run Iranti with appropriate privileges.',
        })
        return
      }

      const PORT = getPort()
      const content = {
        mcpServers: {
          iranti: {
            url: `http://localhost:${PORT}/mcp`,
            type: 'http',
          },
        },
      }
      const jsonString = JSON.stringify(content, null, 2)
      const filePath = join(writeDir, '.mcp.json')

      // Determine if this is a create or replace
      let action: 'created' | 'replaced' = 'created'
      try {
        await access(filePath, constants.F_OK)
        action = 'replaced'
      } catch { /* file does not exist — will be created */ }

      await writeFile(filePath, jsonString, 'utf8')
      console.log('[repair] mcp-json written', filePath)

      await writeAuditLog('repair_mcp_json', {
        instanceId,
        projectId,
        filePath,
        action,
      })

      res.json({
        filePath,
        content: jsonString,
        action,
        revertable: false,
      })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// POST /:instanceId/projects/:projectId/repair/claude-md
// ---------------------------------------------------------------------------

const IRANTI_BLOCK_START = '<!-- IRANTI:START -->'
const IRANTI_BLOCK_END = '<!-- IRANTI:END -->'
const IRANTI_BLOCK_RE = /<!-- IRANTI:START -->[\s\S]*?<!-- IRANTI:END -->/

function buildIrantiBlock(port: string): string {
  return `<!-- IRANTI:START -->
## Shared Memory - Iranti

This project uses Iranti as the shared memory layer.
Iranti is running at \`http://localhost:${port}\`.
Credentials are in \`.env.iranti\`.

Every agent must:
1. Call \`iranti_handshake\` with their \`agent_id\` at session start.
2. Query Iranti before making architectural decisions.
3. Write stable outputs back to Iranti.
<!-- IRANTI:END -->`
}

function buildDiff(before: string | null, after: string): string {
  if (before === null) return `+++ (new file)\n${after}`
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const removed = beforeLines.filter(l => !afterLines.includes(l)).map(l => `- ${l}`).join('\n')
  const added = afterLines.filter(l => !beforeLines.includes(l)).map(l => `+ ${l}`).join('\n')
  return [removed, added].filter(Boolean).join('\n') || '(no textual diff)'
}

repairRouter.post(
  '/:instanceId/projects/:projectId/repair/claude-md',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { instanceId, projectId } = req.params
      if (!validateInstance(instanceId, res)) return
      if (!requireConfirm(req, res)) return

      const writeDir = process.cwd()
      const filePath = join(writeDir, 'CLAUDE.md')
      const PORT = getPort()
      const block = buildIrantiBlock(PORT)

      let existingContent: string | null = null
      try {
        existingContent = await readFile(filePath, 'utf8')
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err
        }
        // File doesn't exist — will be created with just the block
      }

      let finalContent: string
      let action: 'appended' | 'replaced' | 'created'

      if (existingContent === null) {
        // Create new file with just the block
        finalContent = block + '\n'
        action = 'created'
      } else {
        const hasStart = existingContent.includes(IRANTI_BLOCK_START)
        const hasEnd = existingContent.includes(IRANTI_BLOCK_END)

        if (hasStart !== hasEnd) {
          // XOR: one marker present but not the other — unsafe to proceed
          res.status(422).json({
            error: 'Malformed Iranti block',
            code: 'MALFORMED_BLOCK',
            suggestion:
              'Manually remove the IRANTI:START/END comment markers from CLAUDE.md and try again.',
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

      await writeAuditLog('repair_claude_md', {
        instanceId,
        projectId,
        filePath,
        action,
      })

      res.json({
        filePath,
        action,
        diff,
        revertable: false,
      })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// POST /:instanceId/doctor
// ---------------------------------------------------------------------------

interface DoctorCheck {
  id: string
  label: string
  status: 'pass' | 'fail' | 'warn'
  message: string
  repairAction: string | null
}

async function doctorCheckDatabase(): Promise<DoctorCheck> {
  try {
    await Promise.race([
      query('SELECT 1'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 2000)
      ),
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
      message: 'Database not reachable. Check your `.env.iranti` DATABASE_URL or run `iranti setup --repair-db`.',
      repairAction: null,
    }
  }
}

function doctorCheckProvider(): DoctorCheck {
  const anthropicKey = env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_API_KEY'] || ''
  const openaiKey = env['OPENAI_API_KEY'] || process.env['OPENAI_API_KEY'] || ''
  const hasKey = anthropicKey.trim() !== '' || openaiKey.trim() !== ''

  return {
    id: 'provider_config',
    label: 'Provider configuration',
    status: hasKey ? 'pass' : 'warn',
    message: hasKey
      ? 'At least one LLM provider key is configured.'
      : 'No LLM provider key found. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to `.env.iranti`, then restart Iranti.',
    repairAction: null,
  }
}

async function doctorCheckMcpIntegration(): Promise<DoctorCheck> {
  try {
    await access(join(process.cwd(), '.mcp.json'), constants.F_OK)
    return {
      id: 'mcp_integration',
      label: 'Claude MCP integration (.mcp.json)',
      status: 'pass',
      message: '.mcp.json found.',
      repairAction: null,
    }
  } catch {
    return {
      id: 'mcp_integration',
      label: 'Claude MCP integration (.mcp.json)',
      status: 'warn',
      message: '.mcp.json not found. Claude will not have access to Iranti memory tools.',
      repairAction: `/api/control-plane/instances/${THIS_INSTANCE_ID}/projects/default/repair/mcp-json`,
    }
  }
}

async function doctorCheckClaudeMd(): Promise<DoctorCheck> {
  try {
    const content = await readFile(join(process.cwd(), 'CLAUDE.md'), 'utf8')
    const hasIranti =
      content.includes('iranti') ||
      content.includes('Iranti') ||
      content.includes('IRANTI')

    return {
      id: 'claude_md_integration',
      label: 'CLAUDE.md integration block',
      status: hasIranti ? 'pass' : 'warn',
      message: hasIranti
        ? 'CLAUDE.md references Iranti.'
        : 'CLAUDE.md present but no Iranti reference found. Add an Iranti memory block or use the repair endpoint.',
      repairAction: hasIranti
        ? null
        : `/api/control-plane/instances/${THIS_INSTANCE_ID}/projects/default/repair/claude-md`,
    }
  } catch {
    return {
      id: 'claude_md_integration',
      label: 'CLAUDE.md integration block',
      status: 'warn',
      message: 'CLAUDE.md not found. Create a CLAUDE.md with Iranti instructions or use the repair endpoint.',
      repairAction: `/api/control-plane/instances/${THIS_INSTANCE_ID}/projects/default/repair/claude-md`,
    }
  }
}

repairRouter.post(
  '/:instanceId/doctor',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { instanceId } = req.params
      if (!validateInstance(instanceId, res)) return

      const [dbCheck, mcpCheck, claudeMdCheck] = await Promise.all([
        doctorCheckDatabase(),
        doctorCheckMcpIntegration(),
        doctorCheckClaudeMd(),
      ])

      const providerCheck = doctorCheckProvider()

      const checks: DoctorCheck[] = [dbCheck, providerCheck, mcpCheck, claudeMdCheck]

      res.json({
        instanceId,
        checks,
        checkedAt: new Date().toISOString(),
      })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

repairRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const apiErr = err as ApiError
  res.status(apiErr.statusCode ?? 500).json({
    error: apiErr.message ?? 'Internal server error',
    code: apiErr.code ?? 'INTERNAL_ERROR',
  })
})
