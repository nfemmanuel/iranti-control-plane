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
import { createHash } from 'crypto'
import { env } from '../../db.js'
import { ApiError } from '../../types.js'

export const providersRouter = Router()

// ---------------------------------------------------------------------------
// Instance ID derivation
// ---------------------------------------------------------------------------

function deriveInstanceId(runtimeRoot: string): string {
  const normalized = runtimeRoot.toLowerCase().replace(/\\/g, '/')
  return createHash('sha256').update(normalized).digest('hex').slice(0, 8)
}

const THIS_INSTANCE_ID = deriveInstanceId(process.cwd())

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

function validateInstance(instanceId: string, res: Response): boolean {
  if (instanceId !== THIS_INSTANCE_ID) {
    res.status(404).json({
      error: 'Instance not found',
      code: 'INSTANCE_NOT_FOUND',
    })
    return false
  }
  return true
}

function maskKey(keyValue: string): string | null {
  const key = keyValue ?? ''
  return key.length > 4 ? 'sk-...' + key.slice(-4) : null
}

function getEnvVar(name: string): string {
  return env[name] || process.env[name] || ''
}

function getAnthropicKey(): string {
  return getEnvVar('ANTHROPIC_API_KEY')
}

function getOpenaiKey(): string {
  return getEnvVar('OPENAI_API_KEY')
}

function getOllamaBaseUrl(): string {
  return getEnvVar('OLLAMA_BASE_URL')
}

function getTogetherKey(): string {
  return getEnvVar('TOGETHER_API_KEY')
}

function getGroqKey(): string {
  return getEnvVar('GROQ_API_KEY')
}

function getDefaultProvider(): string | null {
  const val =
    getEnvVar('IRANTI_DEFAULT_PROVIDER') ||
    getEnvVar('DEFAULT_PROVIDER') ||
    ''
  return val.trim() || null
}

// ---------------------------------------------------------------------------
// Reachability checks — lightweight, with per-provider caching
// ---------------------------------------------------------------------------

async function checkReachability(providerId: string): Promise<boolean> {
  const cached = reachabilityCache.get(providerId)
  if (cached && Date.now() - cached.checkedAt.getTime() < REACHABILITY_TTL_MS) {
    return cached.reachable
  }

  let reachable = false

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    try {
      switch (providerId) {
        case 'anthropic': {
          const key = getAnthropicKey()
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
          const key = getOpenaiKey()
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
          const baseUrl = getOllamaBaseUrl()
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
            const key = getTogetherKey()
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
            const key = getGroqKey()
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

  reachabilityCache.set(providerId, { reachable, checkedAt: new Date() })
  return reachable
}

// ---------------------------------------------------------------------------
// ProviderStatus shape (flat routes)
// ---------------------------------------------------------------------------

interface ProviderStatus {
  id: string
  name: string
  keyPresent: boolean
  keyEnvVar: string
  keyMasked: string | null
  reachable: boolean
  lastChecked: string
  isDefault: boolean
}

// ---------------------------------------------------------------------------
// GET /providers   (flat — no instanceId prefix)
// ---------------------------------------------------------------------------

providersRouter.get(
  '/providers',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const anthropicKey = getAnthropicKey()
      const openaiKey = getOpenaiKey()
      const ollamaBaseUrl = getOllamaBaseUrl()
      const togetherKey = getTogetherKey()
      const groqKey = getGroqKey()
      const defaultProvider = getDefaultProvider()
      const checkedAt = new Date().toISOString()

      const detections: Array<{ id: string; name: string; envVar: string; key: string }> = []

      if (anthropicKey.trim()) {
        detections.push({ id: 'anthropic', name: 'Anthropic', envVar: 'ANTHROPIC_API_KEY', key: anthropicKey })
      } else {
        detections.push({ id: 'anthropic', name: 'Anthropic', envVar: 'ANTHROPIC_API_KEY', key: '' })
      }

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
          const reachable = keyPresent ? await checkReachability(p.id) : false
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
        if (anthropicKey.trim()) computedDefault = 'anthropic'
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
      }))

      res.json({ providers, checkedAt })
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
      const { providerId } = req.params
      const fetchedAt = new Date().toISOString()

      let response: ModelsResponse

      switch (providerId) {
        case 'anthropic': {
          response = {
            providerId: 'anthropic',
            models: ANTHROPIC_MODELS,
            source: 'static',
            fetchedAt,
          }
          break
        }

        case 'openai': {
          const key = getOpenaiKey()
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
          const baseUrl = getOllamaBaseUrl()
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
          const key = getTogetherKey()
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
          const key = getGroqKey()
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
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const { instanceId } = req.params
      if (!validateInstance(instanceId, res)) return

      const anthropicKey = getAnthropicKey()
      const openaiKey = getOpenaiKey()
      const defaultProvider = getDefaultProvider()

      const providers: ProviderEntry[] = [
        {
          id: 'anthropic',
          name: 'Anthropic',
          keyPresent: anthropicKey.trim() !== '',
          keyMasked: maskKey(anthropicKey),
          isDefault:
            defaultProvider === 'anthropic' ||
            (!defaultProvider && anthropicKey.trim() !== '' && openaiKey.trim() === ''),
        },
        {
          id: 'openai',
          name: 'OpenAI',
          keyPresent: openaiKey.trim() !== '',
          keyMasked: maskKey(openaiKey),
          isDefault:
            defaultProvider === 'openai' ||
            (!defaultProvider && openaiKey.trim() !== '' && anthropicKey.trim() === ''),
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
      const { instanceId, providerId } = req.params
      if (!validateInstance(instanceId, res)) return

      // Check cache
      const cached = quotaCache.get(providerId)
      if (cached && Date.now() - cached.cachedAt.getTime() < CACHE_TTL_MS) {
        res.json({ ...cached.data, cached: true })
        return
      }

      let result: Record<string, unknown>

      switch (providerId) {
        case 'anthropic':
          result = {
            supported: false,
            providerId: 'anthropic',
            providerName: 'Anthropic',
            reason:
              'Anthropic does not expose credits via public API. Check your Anthropic Console for usage.',
            cached: false,
            cachedAt: null,
          }
          break

        case 'openai': {
          const openaiKey = getOpenaiKey()
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
            quotaCache.set(providerId, { data: result, cachedAt: new Date() })
          }
          break
        }

        case 'groq': {
          const groqKey = getGroqKey()
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
              quotaCache.set(providerId, { data: result, cachedAt: new Date() })
            }
          }
          break
        }

        case 'together': {
          const togetherKey = getTogetherKey()
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
              quotaCache.set(providerId, { data: result, cachedAt: new Date() })
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
// Error handler
// ---------------------------------------------------------------------------

providersRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const apiErr = err as ApiError
  res.status(apiErr.statusCode ?? 500).json({
    error: apiErr.message ?? 'Internal server error',
    code: apiErr.code ?? 'INTERNAL_ERROR',
  })
})
