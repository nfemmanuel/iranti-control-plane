import { existsSync, readFileSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import { homedir } from 'os'
import { env as controlPlaneEnv } from '../db.js'

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
  let current = resolve(startDir)
  while (true) {
    const candidate = join(current, filename)
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function runtimeRootFromInstanceEnv(envFile: string | null | undefined): string | null {
  if (!envFile) return null
  const trimmed = envFile.trim()
  if (!trimmed) return null
  return resolve(dirname(trimmed), '..', '..')
}

function normalizeRuntimeRootCandidate(candidate: string | null | undefined): string | null {
  if (!candidate?.trim()) return null
  const resolved = resolve(candidate)
  const leaf = basename(resolved).toLowerCase()
  const parentLeaf = basename(dirname(resolved)).toLowerCase()

  if (leaf === 'instances') return dirname(resolved)
  if (parentLeaf === 'instances') return dirname(dirname(resolved))
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
    resolve(process.cwd(), '.env.iranti'),
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
    add(join(ancestor, '.iranti-runtime'))
    add(join(ancestor, '.iranti'))
  }

  add(join(homedir(), '.iranti-runtime'))
  add(join(homedir(), '.iranti'))

  return Array.from(candidates)
}
