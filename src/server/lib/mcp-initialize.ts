/**
 * mcp-initialize.ts — MCP initialize probe for project integration checks.
 *
 * Spawns `iranti mcp` as a stdio MCP server, connects a lightweight MCP
 * client, and verifies that the server exposes all required Iranti tools.
 * Used by project-integration.ts and setup.ts health checks.
 *
 * The probe is fire-and-forget: it always closes the client in a finally
 * block and never throws — callers receive a structured result object.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
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

function normalizeProbeError(message: string): string {
  return message.replace(/\s+/g, ' ').trim()
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

  const stderrChunks: string[] = []
  const transport = new StdioClientTransport({
    command: resolution.command,
    args: [...resolution.args, 'mcp'],
    cwd: input.projectPath,
    env: {
      ...process.env,
      IRANTI_PROJECT_ENV: input.projectEnvPath,
    } as Record<string, string>,
    stderr: 'pipe',
  })

  if (transport.stderr) {
    transport.stderr.on('data', (chunk: unknown) => {
      const text = String(chunk ?? '')
      if (text.trim()) stderrChunks.push(text.trim())
    })
  }

  // The version string here is the MCP client identity sent during handshake.
  // It does not need to match the iranti-control-plane package version; the
  // server ignores it for compatibility purposes.
  const client = new Client({
    name: 'iranti-control-plane',
    version: '1.0.0',
  })

  const timeoutMs = input.timeoutMs ?? 5000
  let initialized = false

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('MCP_INITIALIZE_TIMEOUT')), timeoutMs)
  })

  try {
    await Promise.race([client.connect(transport), timeout])
    initialized = true
    const page = await Promise.race([client.listTools(), timeout])
    const toolNames = page.tools.map((tool) => tool.name)
    const missingTools = REQUIRED_IRANTI_TOOLS.filter((tool) => !toolNames.includes(tool))

    return {
      ok: missingTools.length === 0,
      initialized: true,
      toolsListed: true,
      toolNames,
      missingTools,
      detail: missingTools.length === 0
        ? `Iranti MCP initialized and exposed ${toolNames.length} tools.`
        : `Iranti MCP initialized, but ${missingTools.length} expected tool${missingTools.length === 1 ? '' : 's'} are missing.`,
      error: missingTools.length === 0 ? null : `MISSING_TOOLS: ${missingTools.join(', ')}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const normalized = normalizeProbeError(message)
    const stderrText = normalizeProbeError(stderrChunks.join(' '))
    const detail =
      normalized === 'MCP_INITIALIZE_TIMEOUT'
        ? 'Timed out waiting for Iranti MCP initialize.'
        : initialized
          ? 'Iranti MCP initialized, but tool listing failed.'
          : 'Iranti MCP initialize failed.'

    return {
      ok: false,
      initialized,
      toolsListed: false,
      toolNames: [],
      missingTools: [...REQUIRED_IRANTI_TOOLS],
      detail,
      error: stderrText || normalized,
    }
  } finally {
    try {
      await client.close()
    } catch {
      // ignore close errors during health probing
    }
  }
}
