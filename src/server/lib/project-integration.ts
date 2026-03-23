import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export interface ProjectIntegrationStatus {
  projectPath: string
  mcpJsonPresent: boolean
  mcpJsonHasIranti: boolean
  claudeMdPresent: boolean
  claudeMdHasIranti: boolean
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

export function inspectProjectIntegration(projectPath: string): ProjectIntegrationStatus {
  const mcpJsonPath = join(projectPath, '.mcp.json')
  const claudeMdPath = join(projectPath, 'CLAUDE.md')
  const mcpJson = readJsonFile(mcpJsonPath)

  let mcpJsonHasIranti = false
  if (mcpJson) {
    const servers = (mcpJson['mcpServers'] ?? mcpJson['servers']) as Record<string, unknown> | undefined
    if (servers && typeof servers === 'object') {
      mcpJsonHasIranti =
        'iranti' in servers ||
        Object.values(servers).some((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
          const url = (entry as Record<string, unknown>)['url']
          return typeof url === 'string' && url.includes('iranti')
        })
    }
  }

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

  return {
    projectPath,
    mcpJsonPresent: existsSync(mcpJsonPath),
    mcpJsonHasIranti,
    claudeMdPresent: existsSync(claudeMdPath),
    claudeMdHasIranti,
  }
}
