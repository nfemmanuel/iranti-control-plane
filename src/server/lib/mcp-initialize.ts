import { spawn } from 'child_process'
import { resolveIrantiCli } from './iranti-cli.js'

export interface McpInitializeProbeResult {
  ok: boolean
  initialized: boolean
  toolsListed: boolean
  toolNames: string[]
  missingTools: string[]
  detail: string
  error: string | null
}

const REQUIRED_IRANTI_TOOLS = [
  'iranti_handshake',
  'iranti_attend',
  'iranti_observe',
  'iranti_query',
  'iranti_search',
  'iranti_write',
  'iranti_remember_response',
  'iranti_ingest',
  'iranti_relate',
  'iranti_who_knows',
] as const

function encodeMessage(message: Record<string, unknown>): string {
  const body = JSON.stringify(message)
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`
}

function normalizeProbeError(message: string): string {
  return message.replace(/\s+/g, ' ').trim()
}

function parseToolNames(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const tools = (payload as Record<string, unknown>)['tools']
  if (!Array.isArray(tools)) return []
  return tools
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
      const name = (entry as Record<string, unknown>)['name']
      return typeof name === 'string' && name.trim() ? name.trim() : null
    })
    .filter((name): name is string => Boolean(name))
}

export async function probeIrantiMcpInitialize(input: {
  projectPath: string
  projectEnvPath: string
  timeoutMs?: number
}): Promise<McpInitializeProbeResult> {
  const resolution = await resolveIrantiCli()
  if (!resolution) {
    return {
      ok: false,
      initialized: false,
      toolsListed: false,
      toolNames: [],
      missingTools: [...REQUIRED_IRANTI_TOOLS],
      detail: 'iranti CLI could not be resolved for the MCP initialize probe.',
      error: 'IRANTI_CLI_NOT_FOUND',
    }
  }

  return await new Promise<McpInitializeProbeResult>((resolve) => {
    const timeoutMs = input.timeoutMs ?? 5000
    const child = spawn(
      resolution.command,
      [...resolution.args, 'mcp'],
      {
        cwd: input.projectPath,
        env: {
          ...process.env,
          IRANTI_PROJECT_ENV: input.projectEnvPath,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }
    )

    let settled = false
    let stdoutBuffer = ''
    let stderr = ''
    let initialized = false

    const finish = (result: McpInitializeProbeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      resolve(result)
    }

    const timer = setTimeout(() => {
      finish({
        ok: false,
        initialized,
        toolsListed: false,
        toolNames: [],
        missingTools: [...REQUIRED_IRANTI_TOOLS],
        detail: 'Timed out waiting for Iranti MCP initialize.',
        error: normalizeProbeError(stderr) || 'MCP_INITIALIZE_TIMEOUT',
      })
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('error', (error) => {
      finish({
        ok: false,
        initialized: false,
        toolsListed: false,
        toolNames: [],
        missingTools: [...REQUIRED_IRANTI_TOOLS],
        detail: 'Failed to spawn Iranti MCP.',
        error: normalizeProbeError(error.message),
      })
    })

    child.on('exit', (code) => {
      if (settled) return
      finish({
        ok: false,
        initialized,
        toolsListed: false,
        toolNames: [],
        missingTools: [...REQUIRED_IRANTI_TOOLS],
        detail: initialized
          ? 'Iranti MCP exited before tools/list completed.'
          : 'Iranti MCP exited before initialize completed.',
        error: normalizeProbeError(stderr) || `MCP_EXIT_${code ?? 'unknown'}`,
      })
    })

    const handleMessage = (message: Record<string, unknown>) => {
      if (settled) return

      if (message['id'] === 1) {
        if ('error' in message) {
          finish({
            ok: false,
            initialized: false,
            toolsListed: false,
            toolNames: [],
            missingTools: [...REQUIRED_IRANTI_TOOLS],
            detail: 'Iranti MCP initialize failed.',
            error: normalizeProbeError(JSON.stringify(message['error'])),
          })
          return
        }

        initialized = true
        child.stdin.write(encodeMessage({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {},
        }))
        child.stdin.write(encodeMessage({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }))
        return
      }

      if (message['id'] === 2) {
        if ('error' in message) {
          finish({
            ok: false,
            initialized: true,
            toolsListed: false,
            toolNames: [],
            missingTools: [...REQUIRED_IRANTI_TOOLS],
            detail: 'Iranti MCP initialized, but tools/list failed.',
            error: normalizeProbeError(JSON.stringify(message['error'])),
          })
          return
        }

        const toolNames = parseToolNames(message['result'])
        const missingTools = REQUIRED_IRANTI_TOOLS.filter((tool) => !toolNames.includes(tool))
        finish({
          ok: missingTools.length === 0,
          initialized: true,
          toolsListed: true,
          toolNames,
          missingTools,
          detail: missingTools.length === 0
            ? `Iranti MCP initialized and exposed ${toolNames.length} tools.`
            : `Iranti MCP initialized, but ${missingTools.length} expected tool${missingTools.length === 1 ? '' : 's'} are missing.`,
          error: missingTools.length === 0 ? null : `MISSING_TOOLS: ${missingTools.join(', ')}`,
        })
      }
    }

    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk

      while (true) {
        const headerEnd = stdoutBuffer.indexOf('\r\n\r\n')
        if (headerEnd === -1) break

        const header = stdoutBuffer.slice(0, headerEnd)
        const match = header.match(/Content-Length:\s*(\d+)/i)
        if (!match) {
          finish({
            ok: false,
            initialized,
            toolsListed: false,
            toolNames: [],
            missingTools: [...REQUIRED_IRANTI_TOOLS],
            detail: 'Iranti MCP returned an invalid stdio frame.',
            error: 'MCP_INVALID_FRAME',
          })
          return
        }

        const contentLength = Number(match[1])
        const messageStart = headerEnd + 4
        const messageEnd = messageStart + contentLength
        if (stdoutBuffer.length < messageEnd) break

        const rawMessage = stdoutBuffer.slice(messageStart, messageEnd)
        stdoutBuffer = stdoutBuffer.slice(messageEnd)

        try {
          handleMessage(JSON.parse(rawMessage) as Record<string, unknown>)
        } catch (error) {
          finish({
            ok: false,
            initialized,
            toolsListed: false,
            toolNames: [],
            missingTools: [...REQUIRED_IRANTI_TOOLS],
            detail: 'Iranti MCP returned invalid JSON during initialize probe.',
            error: normalizeProbeError(error instanceof Error ? error.message : String(error)),
          })
          return
        }
      }
    })

    child.stdin.write(encodeMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'iranti-control-plane',
          version: '0.4.3',
        },
      },
    }))
  })
}
