/**
 * Repair routes — mutation endpoints that fix common misconfigurations.
 *
 * POST /:instanceId/repair/mcp-json   — regenerate .mcp.json
 * POST /:instanceId/repair/claude-md  — inject/update Iranti block in CLAUDE.md
 * POST /:instanceId/doctor            — run diagnostic checks
 *
 * All mutation endpoints require ?confirm=true.
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

// ---------------------------------------------------------------------------
// POST /:instanceId/repair/mcp-json
// ---------------------------------------------------------------------------

repairRouter.post(
  '/:instanceId/repair/mcp-json',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { instanceId } = req.params
      if (!validateInstance(instanceId, res)) return
      if (!requireConfirm(req, res)) return

      // Check write access to cwd
      try {
        await access(process.cwd(), constants.W_OK)
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
      const filePath = join(process.cwd(), '.mcp.json')

      await writeFile(filePath, jsonString, 'utf8')
      console.log('[repair] mcp-json written', filePath)

      res.json({
        success: true,
        action: 'regenerate_mcp_json',
        path: filePath,
        content: jsonString,
        revertable: false,
      })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// POST /:instanceId/repair/claude-md
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

repairRouter.post(
  '/:instanceId/repair/claude-md',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { instanceId } = req.params
      if (!validateInstance(instanceId, res)) return
      if (!requireConfirm(req, res)) return

      const filePath = join(process.cwd(), 'CLAUDE.md')
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

      if (existingContent === null) {
        // Create new file with just the block
        finalContent = block + '\n'
      } else {
        const hasStart = existingContent.includes(IRANTI_BLOCK_START)
        const hasEnd = existingContent.includes(IRANTI_BLOCK_END)

        if (hasStart !== hasEnd) {
          // XOR: one marker present but not the other
          res.status(422).json({
            error: 'Malformed Iranti block',
            code: 'MALFORMED_BLOCK',
            suggestion:
              'Manually remove the IRANTI:START/END markers and try again.',
          })
          return
        }

        if (hasStart && hasEnd) {
          // Replace existing block
          finalContent = existingContent.replace(IRANTI_BLOCK_RE, block)
        } else {
          // Append to end
          finalContent =
            existingContent.trimEnd() + '\n\n' + block + '\n'
        }
      }

      await writeFile(filePath, finalContent, 'utf8')

      res.json({
        success: true,
        action: 'update_claude_md',
        path: filePath,
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
  name: string
  status: 'pass' | 'fail' | 'warn'
  message: string
  suggestedFix: string | null
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
      name: 'database_reachability',
      status: 'pass',
      message: 'Database connection is healthy.',
      suggestedFix: null,
      repairAction: null,
    }
  } catch {
    return {
      name: 'database_reachability',
      status: 'fail',
      message: 'Database not reachable.',
      suggestedFix:
        'Check your `.env.iranti` DATABASE_URL or run `iranti setup --repair-db`.',
      repairAction: null,
    }
  }
}

function doctorCheckProvider(): DoctorCheck {
  const anthropicKey = env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_API_KEY'] || ''
  const openaiKey = env['OPENAI_API_KEY'] || process.env['OPENAI_API_KEY'] || ''
  const hasKey =
    anthropicKey.trim() !== '' || openaiKey.trim() !== ''

  return {
    name: 'provider_config',
    status: hasKey ? 'pass' : 'warn',
    message: hasKey
      ? 'At least one LLM provider key is configured.'
      : 'No LLM provider key found.',
    suggestedFix: hasKey
      ? null
      : 'Add ANTHROPIC_API_KEY or OPENAI_API_KEY to `.env.iranti`, then restart Iranti.',
    repairAction: null,
  }
}

async function doctorCheckMcpIntegration(): Promise<DoctorCheck> {
  try {
    await access(join(process.cwd(), '.mcp.json'), constants.F_OK)
    return {
      name: 'mcp_integration',
      status: 'pass',
      message: '.mcp.json found.',
      suggestedFix: null,
      repairAction: null,
    }
  } catch {
    return {
      name: 'mcp_integration',
      status: 'warn',
      message: '.mcp.json not found. Claude will not have access to Iranti memory tools.',
      suggestedFix:
        'Use the Regenerate button or run `iranti setup --mcp [path/to/project]`.',
      repairAction: `/api/control-plane/instances/${THIS_INSTANCE_ID}/repair/mcp-json`,
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
      name: 'claude_md_integration',
      status: hasIranti ? 'pass' : 'warn',
      message: hasIranti
        ? 'CLAUDE.md references Iranti.'
        : 'CLAUDE.md present but no Iranti reference found.',
      suggestedFix: hasIranti
        ? null
        : 'Add an Iranti memory block to CLAUDE.md or use the repair endpoint.',
      repairAction: hasIranti
        ? null
        : `/api/control-plane/instances/${THIS_INSTANCE_ID}/repair/claude-md`,
    }
  } catch {
    return {
      name: 'claude_md_integration',
      status: 'warn',
      message: 'CLAUDE.md not found.',
      suggestedFix:
        'Create a CLAUDE.md with Iranti instructions or use the repair endpoint.',
      repairAction: `/api/control-plane/instances/${THIS_INSTANCE_ID}/repair/claude-md`,
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
