/**
 * Provider configuration and quota routes
 *
 * GET /:instanceId/providers                      — list configured providers
 * GET /:instanceId/providers/:providerId/quota    — quota info for a provider
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

function getAnthropicKey(): string {
  return env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_API_KEY'] || ''
}

function getOpenaiKey(): string {
  return env['OPENAI_API_KEY'] || process.env['OPENAI_API_KEY'] || ''
}

function getDefaultProvider(): string | null {
  const val =
    env['IRANTI_DEFAULT_PROVIDER'] ||
    process.env['IRANTI_DEFAULT_PROVIDER'] ||
    env['DEFAULT_PROVIDER'] ||
    process.env['DEFAULT_PROVIDER'] ||
    ''
  return val.trim() || null
}

// ---------------------------------------------------------------------------
// GET /:instanceId/providers
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
// GET /:instanceId/providers/:providerId/quota
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
            // Cache supported result
            quotaCache.set(providerId, { data: result, cachedAt: new Date() })
          }
          break
        }

        case 'groq':
          result = {
            supported: false,
            providerId: 'groq',
            providerName: 'Groq',
            reason:
              'Groq exposes rate limit headers only — no persistent balance available.',
            cached: false,
            cachedAt: null,
          }
          break

        case 'together':
          result = {
            supported: false,
            providerId: 'together',
            providerName: 'Together AI',
            reason:
              'Together AI quota API integration coming in a future release.',
            cached: false,
            cachedAt: null,
          }
          break

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
