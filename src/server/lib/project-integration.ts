import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { probeIrantiMcpInitialize, type McpInitializeProbeResult } from './mcp-initialize.js'

export interface ProjectIntegrationStatus {
  projectPath: string
  mcpJsonPresent: boolean
  mcpJsonHasIranti: boolean
  workspaceMcpPresent: boolean
  workspaceMcpHasIranti: boolean
  anyMcpPresent: boolean
  anyMcpHasIranti: boolean
  claudeMdPresent: boolean
  claudeMdHasIranti: boolean
  mcpInitialize: McpInitializeProbeResult | null
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export async function inspectProjectIntegration(projectPath: string): Promise<ProjectIntegrationStatus> {
  const mcpJsonPath = join(projectPath, '.mcp.json')
  const workspaceMcpJsonPath = join(projectPath, '.vscode', 'mcp.json')
  const claudeMdPath = join(projectPath, 'CLAUDE.md')
  const projectEnvPath = join(projectPath, '.env.iranti')
  const mcpJson = readJsonFile(mcpJsonPath)
  const workspaceMcpJson = readJsonFile(workspaceMcpJsonPath)

  const hasIrantiServer = (payload: Record<string, unknown> | null): boolean => {
    if (!payload) return false
    const servers = (payload['mcpServers'] ?? payload['servers']) as Record<string, unknown> | undefined
    if (servers && typeof servers === 'object') {
      return (
        'iranti' in servers ||
        Object.values(servers).some((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
          const url = (entry as Record<string, unknown>)['url']
          return typeof url === 'string' && url.includes('iranti')
        })
      )
    }
    return false
  }

  const mcpJsonHasIranti = hasIrantiServer(mcpJson)
  const workspaceMcpHasIranti = hasIrantiServer(workspaceMcpJson)
  const anyMcpHasIranti = mcpJsonHasIranti || workspaceMcpHasIranti
  const anyMcpPresent = existsSync(mcpJsonPath) || existsSync(workspaceMcpJsonPath)

  let claudeMdHasIranti = false
  if (existsSync(claudeMdPath)) {
    try {
      const content = readFileSync(claudeMdPath, 'utf8')
      claudeMdHasIranti = ['iranti', 'mcp__iranti'].some((pattern) =>
        content.toLowerCase().includes(pattern.toLowerCase())
      )
    } catch {
      claudeMdHasIranti = false
    }
  }

  const mcpInitialize =
    anyMcpHasIranti && existsSync(projectEnvPath)
      ? await probeIrantiMcpInitialize({
          projectPath,
          projectEnvPath,
        })
      : null

  return {
    projectPath,
    mcpJsonPresent: existsSync(mcpJsonPath),
    mcpJsonHasIranti,
    workspaceMcpPresent: existsSync(workspaceMcpJsonPath),
    workspaceMcpHasIranti,
    anyMcpPresent,
    anyMcpHasIranti,
    claudeMdPresent: existsSync(claudeMdPath),
    claudeMdHasIranti,
    mcpInitialize,
  }
}
