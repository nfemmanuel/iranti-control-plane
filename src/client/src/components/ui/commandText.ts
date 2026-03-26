export function extractFirstCommand(text: string | null | undefined): string | null {
  if (!text) return null

  const fenced = text.match(/`([^`]+)`/)
  if (fenced?.[1]) return fenced[1].trim()

  const runPrefix = text.match(/Run:\s*(.+)$/i)
  if (runPrefix?.[1]) return runPrefix[1].trim()

  const sqlPrefix = text.match(/Run this in your PostgreSQL database:\s*(.+)$/i)
  if (sqlPrefix?.[1]) return sqlPrefix[1].trim()

  return null
}

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value
}

export function buildIrantiRunCommand(instanceName: string, runtimeRoot?: string | null): string {
  const normalizedRoot = runtimeRoot?.trim() ?? ''
  const rootArg = normalizedRoot ? ` --root ${quoteIfNeeded(normalizedRoot)}` : ''
  return `iranti run --instance ${instanceName}${rootArg}`
}

export function canRunCommand(command: string | null | undefined): boolean {
  if (!command) return false
  const normalized = command.trim().toLowerCase()
  if (normalized.startsWith('iranti ')) return true
  if (normalized === 'npm run migrate') return true
  return false
}
