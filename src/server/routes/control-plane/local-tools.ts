import { Router, Request, Response } from 'express'
import { isAbsolute } from 'path'
import { pickLocalPath, runLocalCommand } from '../../lib/local-operator-tools.js'

export const localToolsRouter = Router()

localToolsRouter.post('/pick-path', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const kind = body['kind']
  const title = typeof body['title'] === 'string' ? body['title'] : undefined
  const startPath = typeof body['startPath'] === 'string' ? body['startPath'] : undefined

  if (kind !== 'directory' && kind !== 'file') {
    res.status(400).json({
      error: 'kind must be "directory" or "file".',
      code: 'INVALID_PARAM',
    })
    return
  }

  if (startPath && !isAbsolute(startPath)) {
    res.status(400).json({
      error: 'startPath must be an absolute path when provided.',
      code: 'INVALID_PARAM',
    })
    return
  }

  try {
    const result = await pickLocalPath({ kind, title, startPath })
    res.json(result)
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
      code: 'PICKER_FAILED',
    })
  }
})

localToolsRouter.post('/run-command', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const command = typeof body['command'] === 'string' ? body['command'] : ''
  const cwd = typeof body['cwd'] === 'string' ? body['cwd'] : undefined

  if (!command.trim()) {
    res.status(400).json({
      error: 'command is required.',
      code: 'INVALID_PARAM',
    })
    return
  }

  if (cwd && !isAbsolute(cwd)) {
    res.status(400).json({
      error: 'cwd must be an absolute path when provided.',
      code: 'INVALID_PARAM',
    })
    return
  }

  try {
    const result = await runLocalCommand({ command, cwd })
    res.json(result)
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : String(error),
      code: 'COMMAND_NOT_RUNNABLE',
    })
  }
})
