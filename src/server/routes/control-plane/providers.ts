/**
 * Provider configuration, quota, and model routes
 *
 * Flat routes (no instanceId prefix):
 *   GET /providers                         — list configured providers with reachability
 *   GET /providers/:providerId/models      — available models for a provider
 *
 * Instance-scoped routes:
 *   GET /:instanceId/providers             — list configured providers (instance-scoped)
 *   GET /:instanceId/providers/:providerId/quota — quota info for a provider
 *
 * SECURITY: never return actual API key values — only masked last-4 chars.
 */

import { Router, Request, Response, NextFunction } from 'express'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { homedir } from 'os'
import { env } from '../../db.js'
import { ApiError, InstanceScopeSummary } from '../../types.js'
import { resolveInstanceAuthority, ResolvedInstanceAuthority } from '../../lib/instance-authority.js'

export const providersRouter = Router()

// ---------------------------------------------------------------------------
// Provider → env var mapping (aligned with Iranti CLI spec)
// ---------------------------------------------------------------------------

const PROVIDER_KEY_VARS: Record<string, string> = {
  claude:    'ANTHROPIC_API_KEY',
  openai:    'OPENAI_API_KEY',
  gemini:    'GEMINI_API_KEY',
  groq:      'GROQ_API_KEY',
  mistral:   'MISTRAL_API_KEY',
  together:  'TOGETHER_API_KEY',
  ollama:    'OLLAMA_BASE_URL',
}

/** Providers with no key concept — reject add/update/remove */
const NO_KEY_PROVIDERS = new Set(['mock'])

/** Patterns that indicate a placeholder rather than a real key */
const PLACEHOLDER_PATTERNS = [
  /^sk-xxx/i,
  /^replace[_-]?me$/i,
  /^your[_-]?api[_-]?key/i,
  /^<[^>]+>$/,
  /^test[_-]?key$/i,
  /^dummy/i,
]

export function isPlaceholderKey(val: string): boolean {
  return PLACEHOLDER_PATTERNS.some(p => p.test(val.trim()))
}

function normalizeProviderId(value: string): string {
  const normalized = value.trim().toLowerCase()
  return normalized === 'anthropic' ? 'claude' : normalized
}

function providerLabel(providerId: string): string {
  switch (normalizeProviderId(providerId)) {
    case 'claude': return 'Claude'
    case 'openai': return 'OpenAI'
    case 'gemini': return 'Gemini'
    case 'groq': return 'Groq'
    case 'mistral': return 'Mistral'
    case 'together': return 'Together AI'
    case 'ollama': return 'Ollama'
    case 'mock': return 'Mock'
    default: return providerId
  }
}

function scopeSummary(scope: ResolvedInstanceAuthority): InstanceScopeSummary {
  return {
    instanceId: scope.instanceId,
    instanceName: scope.instanceName,
    source: scope.source,
  }
}

// ---------------------------------------------------------------------------
// Env file write path — mirrors loadEnv() candidate list from db.ts
// ---------------------------------------------------------------------------

function findEnvFilePath(): string | null {
  const isSea =
    typeof (process as NodeJS.Process & { isSea?: () => boolean }).isSea === 'function' &&
    (process as NodeJS.Process & { isSea?: () => boolean }).isSea!()

  const candidates = [
    ...(isSea ? [resolve(dirname(process.execPath), '.env.iranti')] : []),
    resolve(process.cwd(), '.env.iranti'),
    resolve(homedir(), '.iranti-runtime', '.env.iranti'),
    resolve(homedir(), '.iranti-runtime', 'instances', 'local', '.env'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

export function getPreferredEnvFilePath(): string {
  // Prefer the explicitly-pointed instance env — this is where `iranti` CLI writes
  // provider keys. The control plane `.env.iranti` is a project binding file, not
  // the live instance env.
  const instanceEnvPath = env['IRANTI_INSTANCE_ENV']
  if (instanceEnvPath && existsSync(instanceEnvPath)) {
    return instanceEnvPath
  }
  // No pointer: fall back to the discovered file (local dev, custom setups)
  return findEnvFilePath() ?? resolve(process.cwd(), '.env.iranti')
}

/**
 * Write or delete a key in the active .env.iranti file.
 * Preserves comments and unrelated keys.
 * Updates the in-memory env object so subsequent reads reflect the change immediately.
 */
export function writeEnvVar(key: string, value: string | null): void {
  writeEnvVarAtPath(getPreferredEnvFilePath(), key, value, true)
}

function writeEnvVarAtPath(filePath: string, key: string, value: string | null, syncLiveEnv: boolean): void {
  let raw = ''
  if (existsSync(filePath)) {
    raw = readFileSync(filePath, 'utf8')
  }

  // Detect original line ending style so we preserve it on write (CRLF on Windows, LF on Unix).
  const lineEnding = raw.includes('\r\n') ? '\r\n' : '\n'
  const rawLines = raw.split(/\r?\n/)

  let found = false
  const updated: string[] = []

  for (const line of rawLines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('#') && trimmed.indexOf('=') !== -1) {
      const lineKey = trimmed.slice(0, trimmed.indexOf('=')).trim()
      if (lineKey === key) {
        found = true
        if (value !== null) {
          updated.push(`${key}=${value}`)
        }
        // value === null → skip line (delete the key)
        continue
      }
    }
    updated.push(line)
  }

  if (!found && value !== null) {
    // Append: ensure there's a trailing newline separator before the new entry
    const lastLine = updated[updated.length - 1] ?? ''
    if (updated.length > 0 && lastLine.trim() !== '') {
      updated.push('')
    }
    updated.push(`${key}=${value}`)
  }

  writeFileSync(filePath, updated.join(lineEnding), 'utf8')

  if (syncLiveEnv) {
    if (value !== null) {
      env[key] = value
      process.env[key] = value
    } else {
      delete env[key]
      delete process.env[key]
    }
  }
}

// ---------------------------------------------------------------------------
// In-memory quota cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: Record<string, unknown>
  cachedAt: Date
}

const quotaCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000

// ---------------------------------------------------------------------------
// In-memory reachability cache (separate from quota — shorter TTL)
// ---------------------------------------------------------------------------

interface ReachabilityEntry {
  reachable: boolean
  checkedAt: Date
}

const reachabilityCache = new Map<string, ReachabilityEntry>()
const REACHABILITY_TTL_MS = 60 * 1000 // 1 minute

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentBindingEnvPath(): string | null {
  const configured = env['IRANTI_INSTANCE_ENV'] ?? process.env['IRANTI_INSTANCE_ENV'] ?? ''
  return configured.trim() ? resolve(configured) : null
}

async function resolveScopeFromRequest(req: Request): Promise<ResolvedInstanceAuthority> {
  const paramInstance = typeof req.params['instanceId'] === 'string' ? req.params['instanceId'] : ''
  const queryInstance = typeof req.query['instanceId'] === 'string' ? req.query['instanceId'] : ''
  const scope = await resolveInstanceAuthority(paramInstance || queryInstance || undefined)
  if (!scope) {
    const err = new Error('Instance not found') as ApiError
    err.statusCode = 404
    err.code = 'INSTANCE_NOT_FOUND'
    throw err
  }
  return scope
}

function shouldSyncLiveEnv(scope: ResolvedInstanceAuthority): boolean {
  const bindingEnvPath = currentBindingEnvPath()
  return bindingEnvPath !== null && bindingEnvPath === resolve(scope.instanceEnvPath)
}

function writeEnvVarForScope(scope: ResolvedInstanceAuthority, key: string, value: string | null): void {
  writeEnvVarAtPath(scope.instanceEnvPath, key, value, shouldSyncLiveEnv(scope))
}

function maskKey(keyValue: string): string | null {
  const key = keyValue ?? ''
  return key.length > 4 ? 'sk-...' + key.slice(-4) : null
}

function getEnvVar(scopeOrName: ResolvedInstanceAuthority | string, maybeName?: string): string {
  if (typeof scopeOrName === 'string') {
    return env[scopeOrName] || process.env[scopeOrName] || ''
  }
  return scopeOrName.env[maybeName ?? ''] || ''
}

function getClaudeKey(scope: ResolvedInstanceAuthority): string {
  return getEnvVar(scope, 'ANTHROPIC_API_KEY')
}

function getAnthropicKey(): string {
  return getEnvVar('ANTHROPIC_API_KEY')
}

function getOpenaiKey(scope: ResolvedInstanceAuthority): string {
  return getEnvVar(scope, 'OPENAI_API_KEY')
}

function getOllamaBaseUrl(scope: ResolvedInstanceAuthority): string {
  return getEnvVar(scope, 'OLLAMA_BASE_URL')
}

function getTogetherKey(scope: ResolvedInstanceAuthority): string {
  return getEnvVar(scope, 'TOGETHER_API_KEY')
}

function getGroqKey(scope: ResolvedInstanceAuthority): string {
  return getEnvVar(scope, 'GROQ_API_KEY')
}

function getDefaultProvider(): string | null {
  // LLM_PROVIDER is the authoritative Iranti runtime var — set in the instance .env
  // and merged into the CP env by db.ts via IRANTI_INSTANCE_ENV. Project-binding vars
  // IRANTI_DEFAULT_PROVIDER / DEFAULT_PROVIDER have been removed; they had no runtime
  // authority and blurred the distinction between connector config and runtime config.
  const val = getEnvVar('LLM_PROVIDER')
  return val.trim() || null
}

function getFallbackChain(): string[] {
  const val = getEnvVar('LLM_PROVIDER_FALLBACK')
  if (!val.trim()) return []
  return val.split(',').map(s => s.trim()).filter(Boolean)
}

function getScopedDefaultProvider(scope: ResolvedInstanceAuthority): string | null {
  const raw = getEnvVar(scope, 'LLM_PROVIDER').trim().toLowerCase()
  return raw ? normalizeProviderId(raw) : null
}

function getScopedRawDefaultProvider(scope: ResolvedInstanceAuthority): string | null {
  const raw = getEnvVar(scope, 'LLM_PROVIDER').trim().toLowerCase()
  return raw || null
}

function getScopedFallbackChain(scope: ResolvedInstanceAuthority): string[] {
  const raw = getEnvVar(scope, 'LLM_PROVIDER_FALLBACK')
  if (!raw.trim()) return []
  return raw
    .split(',')
    .map((value) => normalizeProviderId(value))
    .filter(Boolean)
}

function getScopedRawFallbackChain(scope: ResolvedInstanceAuthority): string[] {
  const raw = getEnvVar(scope, 'LLM_PROVIDER_FALLBACK')
  if (!raw.trim()) return []
  return raw.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
}

function normalizeProviderChain(values: string[]): string[] {
  return values.map((value) => normalizeProviderId(value)).filter(Boolean)
}

// ---------------------------------------------------------------------------
// Task-model routing — CP-T087
// Aligned with Iranti src/lib/router.ts buildModelProfiles() + modelForTask()
// ---------------------------------------------------------------------------

const TASK_TYPES = [
  'classification',
  'relevance_filtering',
  'conflict_resolution',
  'summarization',
  'task_inference',
  'extraction',
] as const

type RoutingTaskType = typeof TASK_TYPES[number]

const TASK_ROUTING_VARS: Record<RoutingTaskType, string> = {
  classification:      'CLASSIFICATION_MODEL',
  relevance_filtering: 'RELEVANCE_MODEL',
  conflict_resolution: 'CONFLICT_MODEL',
  summarization:       'SUMMARIZATION_MODEL',
  task_inference:      'TASK_INFERENCE_MODEL',
  extraction:          'EXTRACTION_MODEL',
}

/** Default model for a task+provider pair — mirrors router.ts defaultModelForProvider() */
function defaultModelForTask(taskType: RoutingTaskType, provider: string): string {
  switch (provider) {
    case 'openai':
      return taskType === 'conflict_resolution' ? 'gpt-5' : 'gpt-5-mini'
    case 'groq':
      return 'meta-llama/llama-4-scout-17b-16e-instruct'
    case 'mistral':
      return 'mistral-small-latest'
    case 'ollama':
      return 'llama3.2'
    case 'claude':
    case 'anthropic':
      return taskType === 'conflict_resolution' ? 'claude-sonnet-4' : 'claude-3-5-haiku-latest'
    case 'mock':
      return 'mock'
    case 'gemini':
    default:
      return taskType === 'conflict_resolution' ? 'gemini-2.5-pro' : 'gemini-2.5-flash'
  }
}

/** Mirror of router.ts isLikelyCompatible() — warns but does not hard-block */
function isCompatibleWithProvider(provider: string, model: string): boolean {
  const m = model.toLowerCase()
  if (provider === 'mock') return true
  if (provider === 'openai') return !(m.startsWith('gemini') || m.startsWith('claude') || m.startsWith('mistral') || m.startsWith('llama'))
  if (provider === 'gemini') return !m.startsWith('gpt') && !m.startsWith('claude') && !m.startsWith('mistral') && !m.startsWith('llama')
  if (provider === 'claude' || provider === 'anthropic') return m.startsWith('claude')
  if (provider === 'mistral') return m.startsWith('mistral')
  return true
}

/** Current task routing state: the override value from env (null = use provider default) */
function getTaskRouting(): Record<string, string | null> {
  const result: Record<string, string | null> = {}
  for (const task of TASK_TYPES) {
    const val = getEnvVar(TASK_ROUTING_VARS[task])
    result[task] = val.trim() || null
  }
  return result
}

function getScopedTaskRouting(scope: ResolvedInstanceAuthority): Record<string, string | null> {
  const result: Record<string, string | null> = {}
  for (const task of TASK_TYPES) {
    const val = getEnvVar(scope, TASK_ROUTING_VARS[task])
    result[task] = val.trim() || null
  }
  return result
}

// ---------------------------------------------------------------------------
// Reachability checks — lightweight, with per-provider caching
// ---------------------------------------------------------------------------

async function checkReachability(scope: ResolvedInstanceAuthority, providerId: string): Promise<boolean> {
  const normalizedProviderId = normalizeProviderId(providerId)
  const cacheKey = `${scope.instanceId}:${normalizedProviderId}`
  const cached = reachabilityCache.get(cacheKey)
  if (cached && Date.now() - cached.checkedAt.getTime() < REACHABILITY_TTL_MS) {
    return cached.reachable
  }

  let reachable = false

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    try {
      switch (normalizedProviderId) {
        case 'claude': {
          const key = getClaudeKey(scope)
          if (!key.trim()) {
            reachable = false
            break
          }
          const res = await fetch('https://api.anthropic.com/v1/models', {
            method: 'GET',
            headers: {
              'x-api-key': key,
              'anthropic-version': '2023-06-01',
            },
            signal: controller.signal,
          })
          // 200 = reachable with valid key; 401/403 = reachable but auth issue — still reachable
          reachable = res.status < 500
          break
        }

        case 'openai': {
          const key = getOpenaiKey(scope)
          if (!key.trim()) {
            reachable = false
            break
          }
          const res = await fetch('https://api.openai.com/v1/models', {
            method: 'GET',
            headers: { Authorization: `Bearer ${key}` },
            signal: controller.signal,
          })
          reachable = res.status < 500
          break
        }

        case 'ollama': {
          const baseUrl = getOllamaBaseUrl(scope)
          if (!baseUrl.trim()) {
            reachable = false
            break
          }
          const url = baseUrl.replace(/\/$/, '') + '/api/tags'
          const res = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
          })
          reachable = res.ok
          break
        }

        case 'together': {
          try {
            const key = getTogetherKey(scope)
            if (!key.trim()) { reachable = false; break }
            const res = await fetch('https://api.together.xyz/v1/models', {
              method: 'GET',
              headers: { Authorization: `Bearer ${key}` },
              signal: controller.signal,
            })
            reachable = res.status < 500
          } catch {
            reachable = false
          }
          break
        }

        case 'groq': {
          try {
            const key = getGroqKey(scope)
            if (!key.trim()) { reachable = false; break }
            const res = await fetch('https://api.groq.com/openai/v1/models', {
              method: 'GET',
              headers: { Authorization: `Bearer ${key}` },
              signal: controller.signal,
            })
            reachable = res.status < 500
          } catch {
            reachable = false
          }
          break
        }

        default:
          reachable = false
      }
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    reachable = false
  }

  reachabilityCache.set(cacheKey, { reachable, checkedAt: new Date() })
  return reachable
}

// ---------------------------------------------------------------------------
// ProviderStatus shape (flat routes)
// ---------------------------------------------------------------------------

/**
 * CP-T063 — API Key Scope field
 *
 * Investigation finding (2026-03-21, Iranti v0.2.15):
 *
 * Iranti does not expose LLM provider key scopes via any API endpoint.
 * The /health endpoint returns only `{ status, version, provider, runtime }`.
 * There is no /providers, /config, or /admin/keys endpoint.
 *
 * Iranti's internal API key scopes (kb:read, kb:write, etc.) govern what the
 * *control plane's key* can do — they are not per-LLM-provider scope assignments.
 * The Iranti instance .env has no namespace-scope assignments for provider keys
 * (only LLM_PROVIDER, OPENAI_API_KEY, etc.).
 *
 * Conclusion: provider scope info is not available from Iranti API or config files
 * in this version. Both fields are returned as null / "unknown" gracefully.
 * When Iranti adds a provider scope API, populate these fields from it.
 */
type ScopeType = 'namespace' | 'global' | 'unknown'

interface ProviderStatus {
  id: string
  name: string
  keyPresent: boolean
  keyEnvVar: string
  keyMasked: string | null
  reachable: boolean
  lastChecked: string
  isDefault: boolean
  /** LLM provider key namespace scope string, or null if not available/configured */
  scope: string | null
  /** Scope type classification: "namespace", "global", or "unknown" when not available */
  scopeType: ScopeType
}

// ---------------------------------------------------------------------------
// GET /providers   (flat — no instanceId prefix)
// ---------------------------------------------------------------------------

providersRouter.get(
  '/providers',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = await resolveScopeFromRequest(req)
      const claudeKey = getClaudeKey(scope)
      const openaiKey = getOpenaiKey(scope)
      const ollamaBaseUrl = getOllamaBaseUrl(scope)
      const togetherKey = getTogetherKey(scope)
      const groqKey = getGroqKey(scope)
      const defaultProvider = getScopedDefaultProvider(scope)
      const rawDefaultProvider = getScopedRawDefaultProvider(scope)
      const checkedAt = new Date().toISOString()

      const detections: Array<{ id: string; name: string; envVar: string; key: string }> = []

      detections.push({ id: 'claude', name: 'Claude', envVar: 'ANTHROPIC_API_KEY', key: claudeKey })

      if (openaiKey.trim()) {
        detections.push({ id: 'openai', name: 'OpenAI', envVar: 'OPENAI_API_KEY', key: openaiKey })
      } else {
        detections.push({ id: 'openai', name: 'OpenAI', envVar: 'OPENAI_API_KEY', key: '' })
      }

      if (ollamaBaseUrl.trim()) {
        detections.push({ id: 'ollama', name: 'Ollama', envVar: 'OLLAMA_BASE_URL', key: ollamaBaseUrl })
      }

      // Together AI — only shown when TOGETHER_API_KEY is set (per AC)
      if (togetherKey.trim()) {
        detections.push({ id: 'together', name: 'Together AI', envVar: 'TOGETHER_API_KEY', key: togetherKey })
      }

      // Groq — only shown when GROQ_API_KEY is set (per AC)
      if (groqKey.trim()) {
        detections.push({ id: 'groq', name: 'Groq', envVar: 'GROQ_API_KEY', key: groqKey })
      }

      // Run reachability checks in parallel — only for providers with a key/URL present
      const reachabilityResults = await Promise.allSettled(
        detections.map(async (p) => {
          const keyPresent = p.key.trim() !== ''
          const reachable = keyPresent ? await checkReachability(scope, p.id) : false
          return { id: p.id, reachable }
        })
      )

      const reachabilityMap = new Map<string, boolean>()
      for (const result of reachabilityResults) {
        if (result.status === 'fulfilled') {
          reachabilityMap.set(result.value.id, result.value.reachable)
        }
      }

      // Compute default: explicit env var wins; fallback to first present key
      let computedDefault: string | null = defaultProvider
      if (!computedDefault) {
        if (claudeKey.trim()) computedDefault = 'claude'
        else if (openaiKey.trim()) computedDefault = 'openai'
        else if (ollamaBaseUrl.trim()) computedDefault = 'ollama'
      }

      const providers: ProviderStatus[] = detections.map((p) => ({
        id: p.id,
        name: p.name,
        keyPresent: p.key.trim() !== '',
        keyEnvVar: p.envVar,
        keyMasked: p.id === 'ollama'
          ? (p.key.trim() ? p.key : null)  // Ollama base URL is not secret — show it
          : maskKey(p.key),
        reachable: reachabilityMap.get(p.id) ?? false,
        lastChecked: checkedAt,
        isDefault: computedDefault === p.id,
        // CP-T063: Iranti v0.2.15 does not expose LLM provider key scopes via API or config.
        // Returned as null/"unknown" until Iranti adds a provider scope endpoint.
        scope: null,
        scopeType: 'unknown' as ScopeType,
      }))

      res.json({
        providers,
        checkedAt,
        scope: scopeSummary(scope),
        defaultProvider: computedDefault,
        rawDefaultProvider,
        fallbackChain: getScopedFallbackChain(scope),
        rawFallbackChain: getScopedRawFallbackChain(scope),
        taskRouting: getScopedTaskRouting(scope),
      })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// GET /providers/:providerId/models   (flat — no instanceId prefix)
// ---------------------------------------------------------------------------

const ANTHROPIC_MODELS = [
  { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', family: 'claude-4', context: 200000 },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', family: 'claude-4', context: 200000 },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', family: 'claude-4', context: 200000 },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', family: 'claude-4', context: 200000 },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', family: 'claude-4', context: 200000 },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5 (2025-10-01)', family: 'claude-4', context: 200000 },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (Oct 2024)', family: 'claude-3', context: 200000 },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Oct 2024)', family: 'claude-3', context: 200000 },
  { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', family: 'claude-3', context: 200000 },
]

const OPENAI_FALLBACK_MODELS = [
  { id: 'gpt-4o', name: 'GPT-4o', family: 'gpt-4', context: 128000 },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', family: 'gpt-4', context: 128000 },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', family: 'gpt-4', context: 128000 },
  { id: 'gpt-4', name: 'GPT-4', family: 'gpt-4', context: 8192 },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', family: 'gpt-3.5', context: 16385 },
  { id: 'o1', name: 'o1', family: 'o1', context: 200000 },
  { id: 'o1-mini', name: 'o1 Mini', family: 'o1', context: 128000 },
  { id: 'o3-mini', name: 'o3 Mini', family: 'o3', context: 200000 },
]

interface ModelEntry {
  id: string
  name: string
  family: string
  context: number
}

interface ModelsResponse {
  providerId: string
  models: ModelEntry[]
  source: 'static' | 'live' | 'fallback'
  fetchedAt: string
}

async function fetchOpenAIModels(key: string): Promise<ModelEntry[] | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
      })
      if (!res.ok) return null
      const json = await res.json() as { data?: Array<{ id: string }> }
      if (!Array.isArray(json.data)) return null

      // Filter to chat/completion models — exclude embeddings, fine-tuning models, etc.
      const chatModelPrefixes = ['gpt-4', 'gpt-3.5', 'o1', 'o3', 'chatgpt']
      return json.data
        .filter((m) => chatModelPrefixes.some((p) => m.id.startsWith(p)))
        .map((m) => ({
          id: m.id,
          name: m.id,
          family: m.id.split('-')[0] ?? m.id,
          context: 0, // OpenAI API does not return context window in list endpoint
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return null
  }
}

async function fetchOllamaModels(baseUrl: string): Promise<ModelEntry[] | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const url = baseUrl.replace(/\/$/, '') + '/api/tags'
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) return null
      const json = await res.json() as { models?: Array<{ name: string; details?: { family?: string; parameter_size?: string } }> }
      if (!Array.isArray(json.models)) return null
      return json.models.map((m) => ({
        id: m.name,
        name: m.name,
        family: m.details?.family ?? m.name.split(':')[0] ?? m.name,
        context: 0,
      }))
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return null
  }
}

providersRouter.get(
  '/providers/:providerId/models',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = await resolveScopeFromRequest(req)
      const providerId = normalizeProviderId(req.params['providerId'] ?? '')
      const fetchedAt = new Date().toISOString()

      let response: ModelsResponse

      switch (providerId) {
        case 'claude': {
          response = {
            providerId: 'claude',
            models: ANTHROPIC_MODELS,
            source: 'static',
            fetchedAt,
          }
          break
        }

        case 'openai': {
          const key = getOpenaiKey(scope)
          if (!key.trim()) {
            response = {
              providerId: 'openai',
              models: OPENAI_FALLBACK_MODELS,
              source: 'fallback',
              fetchedAt,
            }
          } else {
            const live = await fetchOpenAIModels(key)
            if (live) {
              response = {
                providerId: 'openai',
                models: live,
                source: 'live',
                fetchedAt,
              }
            } else {
              response = {
                providerId: 'openai',
                models: OPENAI_FALLBACK_MODELS,
                source: 'fallback',
                fetchedAt,
              }
            }
          }
          break
        }

        case 'ollama': {
          const baseUrl = getOllamaBaseUrl(scope)
          if (!baseUrl.trim()) {
            response = {
              providerId: 'ollama',
              models: [],
              source: 'static',
              fetchedAt,
            }
          } else {
            const live = await fetchOllamaModels(baseUrl)
            if (live) {
              response = {
                providerId: 'ollama',
                models: live,
                source: 'live',
                fetchedAt,
              }
            } else {
              response = {
                providerId: 'ollama',
                models: [],
                source: 'fallback',
                fetchedAt,
              }
            }
          }
          break
        }

        case 'together': {
          const key = getTogetherKey(scope)
          if (!key.trim()) {
            response = { providerId: 'together', models: [], source: 'fallback', fetchedAt }
          } else {
            try {
              const controller = new AbortController()
              const timeout = setTimeout(() => controller.abort(), 8000)
              let live: ModelEntry[] | null = null
              try {
                const res = await fetch('https://api.together.xyz/v1/models', {
                  headers: { Authorization: `Bearer ${key}` },
                  signal: controller.signal,
                })
                if (res.ok) {
                  const json = await res.json() as Array<{ id?: string; name?: string; type?: string }>
                  if (Array.isArray(json)) {
                    live = json
                      .filter(m => m.id)
                      .map(m => ({
                        id: m.id ?? '',
                        name: m.name ?? m.id ?? '',
                        family: (m.id ?? '').split('/')[0] ?? '',
                        context: 0,
                      }))
                  }
                }
              } finally {
                clearTimeout(timeout)
              }
              response = {
                providerId: 'together',
                models: live ?? [],
                source: live ? 'live' : 'fallback',
                fetchedAt,
              }
            } catch {
              response = { providerId: 'together', models: [], source: 'fallback', fetchedAt }
            }
          }
          break
        }

        case 'groq': {
          const key = getGroqKey(scope)
          if (!key.trim()) {
            response = { providerId: 'groq', models: [], source: 'fallback', fetchedAt }
          } else {
            try {
              const controller = new AbortController()
              const timeout = setTimeout(() => controller.abort(), 8000)
              let live: ModelEntry[] | null = null
              try {
                const res = await fetch('https://api.groq.com/openai/v1/models', {
                  headers: { Authorization: `Bearer ${key}` },
                  signal: controller.signal,
                })
                if (res.ok) {
                  const json = await res.json() as { data?: Array<{ id: string }> }
                  if (Array.isArray(json.data)) {
                    live = json.data.map(m => ({
                      id: m.id,
                      name: m.id,
                      family: m.id.split('-')[0] ?? m.id,
                      context: 0,
                    }))
                  }
                }
              } finally {
                clearTimeout(timeout)
              }
              response = {
                providerId: 'groq',
                models: live ?? [],
                source: live ? 'live' : 'fallback',
                fetchedAt,
              }
            } catch {
              response = { providerId: 'groq', models: [], source: 'fallback', fetchedAt }
            }
          }
          break
        }

        default:
          res.status(404).json({
            error: `Unknown provider: ${providerId}`,
            code: 'PROVIDER_NOT_FOUND',
          })
          return
      }

      res.json(response)
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// GET /:instanceId/providers   (instance-scoped)
// ---------------------------------------------------------------------------

interface ProviderEntry {
  id: string
  name: string
  keyPresent: boolean
  keyMasked: string | null
  isDefault: boolean
}

providersRouter.get(
  '/:instanceId/providers',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = await resolveScopeFromRequest(req)
      const claudeKey = getClaudeKey(scope)
      const openaiKey = getOpenaiKey(scope)
      const defaultProvider = getScopedDefaultProvider(scope)

      const providers: ProviderEntry[] = [
        {
          id: 'claude',
          name: 'Claude',
          keyPresent: claudeKey.trim() !== '',
          keyMasked: maskKey(claudeKey),
          isDefault:
            defaultProvider === 'claude' ||
            (!defaultProvider && claudeKey.trim() !== '' && openaiKey.trim() === ''),
        },
        {
          id: 'openai',
          name: 'OpenAI',
          keyPresent: openaiKey.trim() !== '',
          keyMasked: maskKey(openaiKey),
          isDefault:
            defaultProvider === 'openai' ||
            (!defaultProvider && openaiKey.trim() !== '' && claudeKey.trim() === ''),
        },
      ]

      res.json(providers)
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// GET /:instanceId/providers/:providerId/quota   (instance-scoped)
// ---------------------------------------------------------------------------

providersRouter.get(
  '/:instanceId/providers/:providerId/quota',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = await resolveScopeFromRequest(req)
      const providerId = normalizeProviderId(req.params['providerId'] ?? '')
      const cacheKey = `${scope.instanceId}:${providerId}`

      // Check cache
      const cached = quotaCache.get(cacheKey)
      if (cached && Date.now() - cached.cachedAt.getTime() < CACHE_TTL_MS) {
        res.json({ ...cached.data, cached: true })
        return
      }

      let result: Record<string, unknown>

      switch (providerId) {
        case 'anthropic':
        case 'claude':
          result = {
            supported: false,
            providerId: 'claude',
            providerName: 'Claude',
            reason:
              'Claude does not expose credits via public API. Check your Anthropic Console for usage.',
            cached: false,
            cachedAt: null,
          }
          break

        case 'openai': {
          const openaiKey = getOpenaiKey(scope)
          if (!openaiKey.trim()) {
            result = {
              supported: false,
              providerId: 'openai',
              providerName: 'OpenAI',
              reason: 'OpenAI API key not configured.',
              cached: false,
              cachedAt: null,
            }
          } else {
            const cachedAt = new Date().toISOString()
            result = {
              supported: true,
              providerId: 'openai',
              providerName: 'OpenAI',
              balance: null,
              rateLimits: null,
              warningThreshold: { triggered: false, message: null },
              cached: false,
              cachedAt,
              message:
                'Key presence confirmed. Live balance requires org:read scope — check OpenAI Usage dashboard directly.',
            }
            quotaCache.set(cacheKey, { data: result, cachedAt: new Date() })
          }
          break
        }

        case 'groq': {
          const groqKey = getGroqKey(scope)
          if (!groqKey.trim()) {
            result = {
              supported: false,
              providerId: 'groq',
              providerName: 'Groq',
              reason: 'Groq API key not configured.',
              cached: false,
              cachedAt: null,
            }
          } else {
            // Attempt to capture rate limit headers from the models endpoint.
            // Groq returns x-ratelimit-* headers on authenticated requests.
            let rateLimits: Record<string, unknown> | null = null
            try {
              const controller = new AbortController()
              const timeout = setTimeout(() => controller.abort(), 6000)
              try {
                const groqRes = await fetch('https://api.groq.com/openai/v1/models', {
                  method: 'GET',
                  headers: { Authorization: `Bearer ${groqKey}` },
                  signal: controller.signal,
                })
                const limitRequests = groqRes.headers.get('x-ratelimit-limit-requests')
                const remainingRequests = groqRes.headers.get('x-ratelimit-remaining-requests')
                const resetRequests = groqRes.headers.get('x-ratelimit-reset-requests')
                if (remainingRequests !== null) {
                  rateLimits = {
                    requestsPerMinute: limitRequests !== null ? Number(limitRequests) : null,
                    requestsRemaining: Number(remainingRequests),
                    requestsResetAt: resetRequests ?? null,
                  }
                }
              } finally {
                clearTimeout(timeout)
              }
            } catch {
              // headers absent or request failed — fall through with null rateLimits
            }
            const cachedAt = new Date().toISOString()
            result = {
              supported: rateLimits !== null,
              providerId: 'groq',
              providerName: 'Groq',
              balance: null,
              rateLimits,
              warningThreshold: { triggered: false, message: null },
              cached: false,
              cachedAt,
              reason: rateLimits === null
                ? 'Groq rate limit headers were not returned by the models endpoint. No persistent balance available.'
                : undefined,
            }
            if (rateLimits !== null) {
              quotaCache.set(cacheKey, { data: result, cachedAt: new Date() })
            }
          }
          break
        }

        case 'together': {
          const togetherKey = getTogetherKey(scope)
          if (!togetherKey.trim()) {
            result = {
              supported: false,
              providerId: 'together',
              providerName: 'Together AI',
              reason: 'Together AI API key not configured.',
              cached: false,
              cachedAt: null,
            }
          } else {
            // Attempt the Together AI billing endpoint defensively.
            // Any parse or network failure returns supported:false — never a 500.
            let balance: { remaining: number; currency: string } | null = null
            let togetherReason: string | undefined
            try {
              const controller = new AbortController()
              const timeout = setTimeout(() => controller.abort(), 8000)
              try {
                const togetherRes = await fetch('https://api.together.xyz/v1/billing/credit', {
                  method: 'GET',
                  headers: {
                    Authorization: `Bearer ${togetherKey}`,
                    'Content-Type': 'application/json',
                  },
                  signal: controller.signal,
                })
                if (togetherRes.ok) {
                  const json = await togetherRes.json() as Record<string, unknown>
                  // Together AI billing shape: { balance: number, ... } or similar
                  const raw = json['balance'] ?? json['credit'] ?? json['remaining_balance']
                  if (typeof raw === 'number') {
                    balance = { remaining: raw, currency: 'USD' }
                  } else {
                    togetherReason = 'Together AI balance API response format unexpected — check Together AI Console.'
                  }
                } else {
                  togetherReason = `Together AI balance API returned ${togetherRes.status} — check Together AI Console.`
                }
              } finally {
                clearTimeout(timeout)
              }
            } catch {
              togetherReason = 'Together AI balance API response format unexpected — check Together AI Console.'
            }
            const cachedAt = new Date().toISOString()
            result = {
              supported: balance !== null,
              providerId: 'together',
              providerName: 'Together AI',
              balance,
              rateLimits: null,
              warningThreshold: { triggered: false, message: null },
              cached: false,
              cachedAt,
              reason: togetherReason,
            }
            if (balance !== null) {
              quotaCache.set(cacheKey, { data: result, cachedAt: new Date() })
            }
          }
          break
        }

        case 'replicate':
          result = {
            supported: false,
            providerId: 'replicate',
            providerName: 'Replicate',
            reason: 'Replicate billing is only available via dashboard.',
            cached: false,
            cachedAt: null,
          }
          break

        default:
          result = {
            supported: false,
            providerId,
            providerName: providerId,
            reason: 'Provider does not expose credit or quota via API.',
            cached: false,
            cachedAt: null,
          }
          break
      }

      res.json(result)
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// PUT /providers/:providerId/key  — set or update a provider API key
// Body: { key: string }
// ---------------------------------------------------------------------------

providersRouter.put(
  '/providers/:providerId/key',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = await resolveScopeFromRequest(req)
      const providerId = normalizeProviderId(req.params['providerId'] ?? '')

      if (NO_KEY_PROVIDERS.has(providerId)) {
        return res.status(400).json({
          error: `Provider '${providerId}' does not support API key management`,
          code: 'PROVIDER_NO_KEY',
        })
      }

      const envVar = PROVIDER_KEY_VARS[providerId]
      if (!envVar) {
        return res.status(404).json({ error: `Unknown provider: ${providerId}`, code: 'PROVIDER_NOT_FOUND' })
      }

      const body = req.body as { key?: unknown }
      const key = typeof body.key === 'string' ? body.key.trim() : ''
      if (!key) {
        return res.status(400).json({ error: 'key is required and must be a non-empty string', code: 'VALIDATION_ERROR' })
      }
      if (isPlaceholderKey(key)) {
        return res.status(400).json({ error: 'Key value looks like a placeholder. Provide the real API key.', code: 'PLACEHOLDER_KEY' })
      }

      writeEnvVarForScope(scope, envVar, key)
      reachabilityCache.delete(`${scope.instanceId}:${providerId}`)

      return res.json({
        ok: true,
        provider: providerId,
        envVar,
        keyMasked: providerId === 'ollama' ? key : maskKey(key),
        restartRequired: true,
        scope: scopeSummary(scope),
      })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// DELETE /providers/:providerId/key  — remove a provider API key
// ---------------------------------------------------------------------------

providersRouter.delete(
  '/providers/:providerId/key',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = await resolveScopeFromRequest(req)
      const providerId = normalizeProviderId(req.params['providerId'] ?? '')

      if (NO_KEY_PROVIDERS.has(providerId)) {
        return res.status(400).json({
          error: `Provider '${providerId}' does not support API key management`,
          code: 'PROVIDER_NO_KEY',
        })
      }

      const envVar = PROVIDER_KEY_VARS[providerId]
      if (!envVar) {
        return res.status(404).json({ error: `Unknown provider: ${providerId}`, code: 'PROVIDER_NOT_FOUND' })
      }

      writeEnvVarForScope(scope, envVar, null)
      reachabilityCache.delete(`${scope.instanceId}:${providerId}`)

      return res.json({
        ok: true,
        provider: providerId,
        envVar,
        keyMasked: null,
        restartRequired: true,
        scope: scopeSummary(scope),
      })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// PUT /providers/default  — set the default provider
// Body: { provider: string }
// NOTE: must be declared before PUT /providers/:providerId/key — different segment count so no conflict
// ---------------------------------------------------------------------------

providersRouter.put(
  '/providers/default',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = await resolveScopeFromRequest(req)
      const body = req.body as { provider?: unknown }
      const provider = typeof body.provider === 'string' ? normalizeProviderId(body.provider) : ''
      if (!provider) {
        return res.status(400).json({ error: 'provider is required', code: 'VALIDATION_ERROR' })
      }

      const allKnownProviders = new Set([...Object.keys(PROVIDER_KEY_VARS), ...NO_KEY_PROVIDERS])
      if (!allKnownProviders.has(provider)) {
        return res.status(400).json({ error: `Unknown provider: ${provider}`, code: 'PROVIDER_NOT_FOUND' })
      }

      writeEnvVarForScope(scope, 'LLM_PROVIDER', provider)

      return res.json({ ok: true, provider, restartRequired: true, scope: scopeSummary(scope) })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// DELETE /providers/default  — clear the default provider
// ---------------------------------------------------------------------------

providersRouter.delete(
  '/providers/default',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = await resolveScopeFromRequest(req)
      writeEnvVarForScope(scope, 'LLM_PROVIDER', null)
      return res.json({ ok: true, provider: null, restartRequired: true, scope: scopeSummary(scope) })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// PUT /providers/fallback  — set the provider fallback chain
// Body: { chain: string[] }
// ---------------------------------------------------------------------------

providersRouter.put(
  '/providers/fallback',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = await resolveScopeFromRequest(req)
      const body = req.body as { chain?: unknown }
      if (!Array.isArray(body.chain)) {
        return res.status(400).json({ error: 'chain must be an array of provider IDs', code: 'VALIDATION_ERROR' })
      }

      const allKnownProviders = new Set([...Object.keys(PROVIDER_KEY_VARS), ...NO_KEY_PROVIDERS])
      for (const p of body.chain) {
        const normalized = typeof p === 'string' ? normalizeProviderId(p) : ''
        if (!normalized || !allKnownProviders.has(normalized)) {
          return res.status(400).json({
            error: `Invalid provider in chain: ${String(p)}`,
            code: 'VALIDATION_ERROR',
          })
        }
      }

      const chain = normalizeProviderChain(body.chain as string[])
      if (chain.length === 0) {
        writeEnvVarForScope(scope, 'LLM_PROVIDER_FALLBACK', null)
      } else {
        writeEnvVarForScope(scope, 'LLM_PROVIDER_FALLBACK', chain.join(','))
      }

      return res.json({ ok: true, chain, restartRequired: true, scope: scopeSummary(scope) })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// DELETE /providers/fallback  — clear the fallback chain
// ---------------------------------------------------------------------------

providersRouter.delete(
  '/providers/fallback',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = await resolveScopeFromRequest(req)
      writeEnvVarForScope(scope, 'LLM_PROVIDER_FALLBACK', null)
      return res.json({ ok: true, chain: [], restartRequired: true, scope: scopeSummary(scope) })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// PUT /providers/task-routing  — set task-model overrides (CP-T087)
// Body: { overrides: Record<string, string | null> }
//   null value = clear the override for that task (revert to provider default)
// Mirrors Iranti router.ts semantics: incompatible model warns but is not blocked.
// All vars are read at Iranti startup — operator must restart Iranti for changes to take effect.
// ---------------------------------------------------------------------------

providersRouter.put(
  '/providers/task-routing',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = await resolveScopeFromRequest(req)
      const body = req.body as { overrides?: unknown }
      if (typeof body.overrides !== 'object' || body.overrides === null || Array.isArray(body.overrides)) {
        return res.status(400).json({ error: 'overrides must be an object mapping task types to model strings or null', code: 'VALIDATION_ERROR' })
      }

      const overrides = body.overrides as Record<string, unknown>
      const activeProvider = getScopedDefaultProvider(scope) ?? 'mock'
      const written: Record<string, string | null> = {}
      const warnings: string[] = []

      for (const [task, model] of Object.entries(overrides)) {
        if (!(TASK_TYPES as readonly string[]).includes(task)) {
          return res.status(400).json({ error: `Unknown task type: ${task}`, code: 'VALIDATION_ERROR' })
        }

        const envVar = TASK_ROUTING_VARS[task as RoutingTaskType]

        if (model === null) {
          writeEnvVarForScope(scope, envVar, null)
          written[task] = null
          continue
        }

        if (typeof model !== 'string' || !model.trim()) {
          return res.status(400).json({ error: `Model for task '${task}' must be a non-empty string or null`, code: 'VALIDATION_ERROR' })
        }

        const modelTrimmed = model.trim()

        // Warn (not block) if the model looks incompatible with the active provider —
        // mirrors router.ts isLikelyCompatible() behavior exactly.
        if (!isCompatibleWithProvider(activeProvider, modelTrimmed)) {
          warnings.push(`Model '${modelTrimmed}' may be incompatible with provider '${activeProvider}' for task '${task}'. Iranti will warn at runtime and use the provider default instead.`)
        }

        writeEnvVarForScope(scope, envVar, modelTrimmed)
        written[task] = modelTrimmed
      }

      return res.json({
        ok: true,
        written,
        warnings,
        restartRequired: true,
        taskRouting: getScopedTaskRouting(scope),
        scope: scopeSummary(scope),
      })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// DELETE /providers/task-routing  — reset all task-model overrides (CP-T087)
// Clears all 6 task-model env vars; Iranti will use provider defaults for all tasks.
// ---------------------------------------------------------------------------

providersRouter.delete(
  '/providers/task-routing',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = await resolveScopeFromRequest(req)
      for (const task of TASK_TYPES) {
        writeEnvVarForScope(scope, TASK_ROUTING_VARS[task], null)
      }
      return res.json({
        ok: true,
        taskRouting: getScopedTaskRouting(scope),
        restartRequired: true,
        scope: scopeSummary(scope),
      })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// GET /providers/routing-defaults  — resolved defaults for the active provider (CP-T087)
// Returns the model each task would use by default if no override is set.
// ---------------------------------------------------------------------------

providersRouter.get(
  '/providers/routing-defaults',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = await resolveScopeFromRequest(req)
      const provider = normalizeProviderId(
        (req.query['provider'] as string | undefined) ?? getScopedDefaultProvider(scope) ?? 'mock'
      )
      const defaults: Record<string, string> = {}
      for (const task of TASK_TYPES) {
        defaults[task] = defaultModelForTask(task, provider)
      }
      return res.json({ provider, defaults })
    } catch (err) {
      next(err)
    }
  }
)

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

providersRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const apiErr = err as ApiError
  res.status(apiErr.statusCode ?? 500).json({
    error: apiErr.message ?? 'Internal server error',
    code: apiErr.code ?? 'INTERNAL_ERROR',
  })
})
