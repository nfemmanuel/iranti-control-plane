import { existsSync, readFileSync } from 'fs'
import { dirname } from 'path'
import { homedir } from 'os'
import { env as controlPlaneEnv } from '../db.js'
import { basenamePortable, dirnamePortable, joinPortable, resolvePortable } from './path-utils.js'

export type RuntimeRootKind = 'primary' | 'legacy' | 'custom'

function parseSimpleEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    if (key) result[key] = value
  }
  return result
}

function findClosestAncestorFile(startDir: string, filename: string): string | null {
  let current = resolvePortable(startDir)
  while (true) {
    const candidate = joinPortable(current, filename)
    if (existsSync(candidate)) return candidate
    const parent = dirnamePortable(current)
    if (parent === current) return null
    current = parent
  }
}

function runtimeRootFromInstanceEnv(envFile: string | null | undefined): string | null {
  if (!envFile) return null
  const trimmed = envFile.trim()
  if (!trimmed) return null
  return resolvePortable(dirnamePortable(trimmed), '..', '..')
}

function normalizeRuntimeRootCandidate(candidate: string | null | undefined): string | null {
  if (!candidate?.trim()) return null
  const resolved = resolvePortable(candidate)
  const leaf = basenamePortable(resolved).toLowerCase()
  const parentLeaf = basenamePortable(dirnamePortable(resolved)).toLowerCase()

  if (leaf === 'instances') return dirnamePortable(resolved)
  if (parentLeaf === 'instances') return dirnamePortable(dirnamePortable(resolved))
  return resolved
}

export function runtimeRootCandidates(): string[] {
  const candidates = new Set<string>()

  const add = (candidate: string | null | undefined) => {
    const normalized = normalizeRuntimeRootCandidate(candidate)
    if (!normalized) return
    if (existsSync(normalized)) {
      candidates.add(normalized)
    }
  }

  add(process.env['IRANTI_HOME'])
  add(controlPlaneEnv['IRANTI_HOME'])
  add(runtimeRootFromInstanceEnv(controlPlaneEnv['IRANTI_INSTANCE_ENV'] ?? process.env['IRANTI_INSTANCE_ENV']))

  const bindingCandidates = [
    findClosestAncestorFile(process.cwd(), '.env.iranti'),
    resolvePortable(process.cwd(), '.env.iranti'),
  ]

  for (const bindingPath of bindingCandidates) {
    if (!bindingPath || !existsSync(bindingPath)) continue
    try {
      const binding = parseSimpleEnv(readFileSync(bindingPath, 'utf8'))
      add(runtimeRootFromInstanceEnv(binding['IRANTI_INSTANCE_ENV']))
    } catch {
      // ignore malformed binding and continue scanning fallback roots
    }
  }

  const ancestorRoots = [process.cwd(), dirname(process.cwd())]
  for (const ancestor of ancestorRoots) {
    add(joinPortable(ancestor, '.iranti-runtime'))
    add(joinPortable(ancestor, '.iranti'))
  }

  add(joinPortable(homedir(), '.iranti-runtime'))
  add(joinPortable(homedir(), '.iranti'))

  return Array.from(candidates)
}

export function classifyRuntimeRoot(runtimeRoot: string): RuntimeRootKind {
  const leaf = basenamePortable(resolvePortable(runtimeRoot)).toLowerCase()
  if (leaf === '.iranti-runtime') return 'primary'
  if (leaf === '.iranti') return 'legacy'
  return 'custom'
}
