/**
 * Setup status routes
 *
 * GET  /:instanceId/setup-status          — 4-step guided setup check
 * POST /:instanceId/setup-status/complete — mark first-run wizard complete
 */

import { Router, Request, Response, NextFunction } from 'express'
import { access, writeFile, constants } from 'fs/promises'
import { join } from 'path'
import { createHash } from 'crypto'
import { query, env } from '../../db.js'
import { ApiError } from '../../types.js'

export const setupRouter = Router()

// ---------------------------------------------------------------------------
// Instance ID derivation (mirrors instances.ts)
// ---------------------------------------------------------------------------

function deriveInstanceId(runtimeRoot: string): string {
  const normalized = runtimeRoot.toLowerCase().replace(/\\/g, '/')
  return createHash('sha256').update(normalized).digest('hex').slice(0, 8)
}

const THIS_INSTANCE_ID = deriveInstanceId(process.cwd())

// ---------------------------------------------------------------------------
// Step result type
// ---------------------------------------------------------------------------

interface SetupStep {
  id: string
  label: string
  status: 'complete' | 'incomplete' | 'warning' | 'not_applicable'
  message: string
  actionRequired: string | null
  repairAction: string | null
}

// ---------------------------------------------------------------------------
// Individual step checks
// ---------------------------------------------------------------------------

async function checkDatabase(): Promise<SetupStep> {
  const step: SetupStep = {
    id: 'database',
    label: 'Database connection',
    status: 'incomplete',
    message: '',
    actionRequired: null,
    repairAction: null,
  }

  try {
    await Promise.race([
      query('SELECT 1'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DB query timeout after 2s')), 2000)
      ),
    ])

    // Connected — try to count KB facts
    let count = '0'
    try {
      const countResult = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM knowledge_base`
      )
      count = countResult.rows[0]?.count ?? '0'
    } catch {
      // Default to 0 if count fails
    }

    step.status = 'complete'
    step.message = `Connected to PostgreSQL. ${count} facts in knowledge base.`
  } catch {
    step.status = 'incomplete'
    step.message = `Database not reachable. Iranti cannot store or retrieve memory without a database connection.`
    step.actionRequired =
      'Check your `.env.iranti` DATABASE_URL or run `iranti setup --repair-db` from your terminal.'
  }

  return step
}

async function checkProvider(): Promise<SetupStep> {
  const step: SetupStep = {
    id: 'provider',
    label: 'Provider configuration',
    status: 'incomplete',
    message: '',
    actionRequired: null,
    repairAction: null,
  }

  const anthropicKey = env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_API_KEY'] || ''
  const openaiKey = env['OPENAI_API_KEY'] || process.env['OPENAI_API_KEY'] || ''
  const explicitProvider =
    env['IRANTI_DEFAULT_PROVIDER'] ||
    process.env['IRANTI_DEFAULT_PROVIDER'] ||
    env['DEFAULT_PROVIDER'] ||
    process.env['DEFAULT_PROVIDER'] ||
    ''

  const hasAnthropicKey = anthropicKey.trim() !== ''
  const hasOpenaiKey = openaiKey.trim() !== ''

  let name: string | null = null
  if (explicitProvider.trim()) {
    name = explicitProvider.trim()
  } else if (hasAnthropicKey) {
    name = 'anthropic'
  } else if (hasOpenaiKey) {
    name = 'openai'
  }

  if (name) {
    step.status = 'complete'
    step.message = `Provider ${name} configured.`
  } else {
    step.status = 'incomplete'
    step.message = `No LLM provider configured. Iranti cannot process writes without a provider key.`
    step.actionRequired =
      'Add your API key to `.env.iranti` as `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, then restart Iranti.'
  }

  return step
}

async function checkProjectBinding(): Promise<SetupStep> {
  const step: SetupStep = {
    id: 'project_binding',
    label: 'Project binding',
    status: 'incomplete',
    message: '',
    actionRequired: null,
    repairAction: null,
  }

  try {
    const result = await query<{ count: string }>(
      `SELECT COUNT(DISTINCT entity_id)::text AS count FROM knowledge_base WHERE entity_type = 'project'`
    )
    const count = parseInt(result.rows[0]?.count ?? '0', 10)

    if (count > 0) {
      step.status = 'complete'
      step.message = `${count} project${count !== 1 ? 's' : ''} bound.`
    } else {
      step.status = 'incomplete'
      step.message = `No projects bound to this Iranti instance.`
      step.actionRequired = 'Run `iranti bind [path/to/project]` from your terminal.'
    }
  } catch {
    step.status = 'incomplete'
    step.message = `Could not check project bindings — database unavailable.`
    step.actionRequired = 'Run `iranti bind [path/to/project]` from your terminal.'
  }

  return step
}

async function checkClaudeIntegration(projectStep: SetupStep): Promise<SetupStep> {
  const step: SetupStep = {
    id: 'claude_integration',
    label: 'Claude / Codex integration',
    status: 'incomplete',
    message: '',
    actionRequired: null,
    repairAction: null,
  }

  if (projectStep.status === 'incomplete') {
    step.status = 'not_applicable'
    step.message = 'Complete Step 3 (project binding) first.'
    return step
  }

  try {
    await access(join(process.cwd(), '.mcp.json'), constants.F_OK)
    step.status = 'complete'
    step.message = `.mcp.json present for this instance.`
  } catch {
    step.status = 'incomplete'
    step.message = `.mcp.json not found. Claude will not have access to Iranti memory tools.`
    step.actionRequired =
      'Run `iranti setup --mcp [path/to/project]` or use the Regenerate button.'
    step.repairAction = `/api/control-plane/instances/${THIS_INSTANCE_ID}/repair/mcp-json`
  }

  return step
}

// ---------------------------------------------------------------------------
// GET /:instanceId/setup-status
// ---------------------------------------------------------------------------

setupRouter.get(
  '/:instanceId/setup-status',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { instanceId } = req.params
      if (instanceId !== THIS_INSTANCE_ID) {
        res.status(404).json({
          error: 'Instance not found',
          code: 'INSTANCE_NOT_FOUND',
        })
        return
      }

      // Determine first-run flag
      const completeFlagPath = join(process.cwd(), '.iranti-cp-setup-complete')
      let firstRunDetected = true
      try {
        await access(completeFlagPath, constants.F_OK)
        firstRunDetected = false
      } catch {
        firstRunDetected = true
      }

      // Run steps 1–3 in parallel
      const [dbSettled, providerSettled, projectSettled] = await Promise.allSettled([
        checkDatabase(),
        checkProvider(),
        checkProjectBinding(),
      ])

      const dbStep: SetupStep =
        dbSettled.status === 'fulfilled'
          ? dbSettled.value
          : {
              id: 'database',
              label: 'Database connection',
              status: 'incomplete',
              message: 'Database check failed unexpectedly.',
              actionRequired: 'Check your `.env.iranti` DATABASE_URL.',
              repairAction: null,
            }

      const providerStep: SetupStep =
        providerSettled.status === 'fulfilled'
          ? providerSettled.value
          : {
              id: 'provider',
              label: 'Provider configuration',
              status: 'incomplete',
              message: 'Provider check failed unexpectedly.',
              actionRequired: null,
              repairAction: null,
            }

      const projectStep: SetupStep =
        projectSettled.status === 'fulfilled'
          ? projectSettled.value
          : {
              id: 'project_binding',
              label: 'Project binding',
              status: 'incomplete',
              message: 'Project binding check failed unexpectedly.',
              actionRequired: 'Run `iranti bind [path/to/project]` from your terminal.',
              repairAction: null,
            }

      // Step 4 depends on step 3 result
      const claudeStep = await checkClaudeIntegration(projectStep)

      const steps: SetupStep[] = [dbStep, providerStep, projectStep, claudeStep]

      const isFullyConfigured = steps.every(
        (s) => s.status === 'complete' || s.status === 'not_applicable'
      )

      res.json({
        instanceId,
        steps,
        isFullyConfigured,
        firstRunDetected,
      })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// POST /:instanceId/setup-status/complete
// ---------------------------------------------------------------------------

setupRouter.post(
  '/:instanceId/setup-status/complete',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { instanceId } = req.params
      if (instanceId !== THIS_INSTANCE_ID) {
        res.status(404).json({
          error: 'Instance not found',
          code: 'INSTANCE_NOT_FOUND',
        })
        return
      }

      const completedAt = new Date().toISOString()
      const completeFlagPath = join(process.cwd(), '.iranti-cp-setup-complete')
      await writeFile(completeFlagPath, JSON.stringify({ completedAt }), 'utf8')

      res.json({ success: true, completedAt })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

setupRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const apiErr = err as ApiError
  res.status(apiErr.statusCode ?? 500).json({
    error: apiErr.message ?? 'Internal server error',
    code: apiErr.code ?? 'INTERNAL_ERROR',
  })
})
