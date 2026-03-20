/**
 * Embedded chat endpoint — CP-T020
 *
 * Integration path: Option A (Direct Iranti HTTP API proxy)
 * The control plane acts as a chat orchestrator:
 *   1. Calls Iranti's POST /memory/attend to retrieve relevant memory facts
 *   2. Builds a prompt from memory blocks + user message
 *   3. Calls the configured LLM provider
 *   4. Returns prose response + structured retrieved facts (from attend result)
 *
 * No subprocess. No streaming (Phase 2 scope; full-response only per PM decision).
 *
 * Routes:
 *   POST /chat           — send a message, receive assistant response
 *   DELETE /chat/:sessionId  — abort/cancel a session (clears server-side session state)
 */

import { Router, Request, Response, NextFunction } from 'express'
import { randomUUID } from 'crypto'
import { env } from '../../db.js'
import { ApiError } from '../../types.js'

export const chatRouter = Router()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface FactInjection {
  entityKey: string
  summary: string
  value: unknown
  confidence: number
  source: string
}

interface AttendResult {
  facts: FactInjection[]
  shouldInject: boolean
  reason: string
  entitiesDetected: string[]
  alreadyPresent: number
  totalFound: number
}

interface RetrievedFact {
  entityType: string
  entityId: string
  key: string
  summary: string
  confidence: number
  source: string
}

interface ChatRequestBody {
  agentId?: string
  providerId?: string
  modelId?: string
  message: string
  sessionId?: string
  history?: ChatMessage[]
}

interface ChatResponseBody {
  role: 'assistant'
  content: string
  retrievedFacts: RetrievedFact[]
  sessionId: string
  model: string
  provider: string
}

interface LLMMessage {
  role: 'user' | 'assistant'
  content: string
}

// ---------------------------------------------------------------------------
// In-flight request registry (used for cancel support)
// ---------------------------------------------------------------------------

const inFlightControllers = new Map<string, AbortController>()

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getIrantiUrl(): string {
  return (env['IRANTI_URL'] ?? process.env['IRANTI_URL'] ?? 'http://localhost:3001').replace(/\/$/, '')
}

function getIrantiApiKey(): string {
  return env['IRANTI_API_KEY'] ?? process.env['IRANTI_API_KEY'] ?? ''
}

function getDefaultAgentId(): string {
  return env['IRANTI_AGENT_ID'] ?? process.env['IRANTI_AGENT_ID'] ?? 'operator'
}

// ---------------------------------------------------------------------------
// Iranti HTTP helpers
// ---------------------------------------------------------------------------

async function irantiFetch(
  path: string,
  method: 'GET' | 'POST',
  body: Record<string, unknown> | undefined,
  signal?: AbortSignal
): Promise<unknown> {
  const url = `${getIrantiUrl()}${path}`
  const apiKey = getIrantiApiKey()
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-Iranti-Key': apiKey } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  })
  const text = await res.text()
  const payload = text ? (JSON.parse(text) as unknown) : null
  if (!res.ok) {
    const errMsg =
      typeof (payload as Record<string, unknown>)?.['error'] === 'string'
        ? (payload as Record<string, string>)['error']
        : `Iranti API error ${res.status}`
    throw new Error(errMsg)
  }
  return payload
}

async function irantiFetchAttend(
  agentId: string,
  currentContext: string,
  latestMessage: string,
  signal?: AbortSignal
): Promise<AttendResult> {
  const result = await irantiFetch(
    '/memory/attend',
    'POST',
    { agentId, currentContext, latestMessage },
    signal
  )
  // Defensive: return a safe default if attend doesn't return expected shape
  if (result && typeof result === 'object') {
    const r = result as Partial<AttendResult>
    return {
      facts: Array.isArray(r.facts) ? r.facts : [],
      shouldInject: r.shouldInject ?? false,
      reason: r.reason ?? 'unknown',
      entitiesDetected: Array.isArray(r.entitiesDetected) ? r.entitiesDetected : [],
      alreadyPresent: r.alreadyPresent ?? 0,
      totalFound: r.totalFound ?? 0,
    }
  }
  return { facts: [], shouldInject: false, reason: 'empty_response', entitiesDetected: [], alreadyPresent: 0, totalFound: 0 }
}

// ---------------------------------------------------------------------------
// Provider/LLM helpers
// ---------------------------------------------------------------------------

function getProviderEnv(providerId: string): { key: string; baseUrl?: string } {
  const getEnv = (name: string) => env[name] ?? process.env[name] ?? ''
  switch (providerId) {
    case 'anthropic':
      return { key: getEnv('ANTHROPIC_API_KEY') }
    case 'openai':
      return { key: getEnv('OPENAI_API_KEY') }
    case 'ollama':
      return { key: '', baseUrl: getEnv('OLLAMA_BASE_URL') }
    case 'together':
      return { key: getEnv('TOGETHER_API_KEY') }
    case 'groq':
      return { key: getEnv('GROQ_API_KEY') }
    default:
      return { key: '' }
  }
}

function resolveProvider(preferredProviderId?: string): { providerId: string; key: string; baseUrl?: string } | null {
  const getEnv = (name: string) => env[name] ?? process.env[name] ?? ''
  const candidates = preferredProviderId
    ? [preferredProviderId]
    : [
        getEnv('IRANTI_DEFAULT_PROVIDER') || getEnv('DEFAULT_PROVIDER') || '',
        'anthropic',
        'openai',
        'groq',
        'together',
        'ollama',
      ].filter(Boolean)

  for (const id of candidates) {
    const { key, baseUrl } = getProviderEnv(id)
    if (id === 'ollama' && baseUrl?.trim()) return { providerId: id, key: '', baseUrl }
    if (id !== 'ollama' && key.trim()) return { providerId: id, key, baseUrl }
  }
  return null
}

function resolveDefaultModel(providerId: string, preferredModelId?: string): string {
  if (preferredModelId?.trim()) return preferredModelId.trim()
  const defaults: Record<string, string> = {
    anthropic: 'claude-sonnet-4-6',
    openai: 'gpt-4o',
    ollama: 'llama3',
    together: 'meta-llama/Llama-3-8b-chat-hf',
    groq: 'llama3-8b-8192',
  }
  return defaults[providerId] ?? 'unknown'
}

interface CompletionResult {
  text: string
  model: string
  provider: string
}

async function callAnthropicComplete(
  key: string,
  model: string,
  messages: LLMMessage[],
  signal?: AbortSignal
): Promise<CompletionResult> {
  const apiMessages = messages.filter((m) => m.role === 'assistant' || m.role === 'user')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: apiMessages,
    }),
    signal,
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`Anthropic API error ${res.status}: ${errBody}`)
  }
  const json = await res.json() as {
    content?: Array<{ type: string; text?: string }>
    model?: string
    usage?: unknown
  }
  const textBlock = json.content?.find((b) => b.type === 'text')
  const text = textBlock?.text ?? ''
  return { text, model: json.model ?? model, provider: 'anthropic' }
}

async function callOpenAICompat(
  key: string,
  baseUrl: string,
  model: string,
  messages: LLMMessage[],
  signal?: AbortSignal
): Promise<CompletionResult> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: 4096, messages }),
    signal,
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`${baseUrl} API error ${res.status}: ${errBody}`)
  }
  const json = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>
    model?: string
  }
  const text = json.choices?.[0]?.message?.content ?? ''
  return { text, model: json.model ?? model, provider: baseUrl.includes('groq') ? 'groq' : baseUrl.includes('together') ? 'together' : 'openai' }
}

async function callOllama(
  baseUrl: string,
  model: string,
  messages: LLMMessage[],
  signal?: AbortSignal
): Promise<CompletionResult> {
  const url = baseUrl.replace(/\/$/, '') + '/api/chat'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
    signal,
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`Ollama API error ${res.status}: ${errBody}`)
  }
  const json = await res.json() as { message?: { content?: string }; model?: string }
  const text = json.message?.content ?? ''
  return { text, model: json.model ?? model, provider: 'ollama' }
}

async function completeLLM(
  resolved: { providerId: string; key: string; baseUrl?: string },
  model: string,
  messages: LLMMessage[],
  signal?: AbortSignal
): Promise<CompletionResult> {
  switch (resolved.providerId) {
    case 'anthropic':
      return callAnthropicComplete(resolved.key, model, messages, signal)
    case 'openai':
      return callOpenAICompat(resolved.key, 'https://api.openai.com', model, messages, signal)
    case 'groq':
      return callOpenAICompat(resolved.key, 'https://api.groq.com/openai', model, messages, signal)
    case 'together':
      return callOpenAICompat(resolved.key, 'https://api.together.xyz', model, messages, signal)
    case 'ollama':
      return callOllama(resolved.baseUrl ?? 'http://localhost:11434', model, messages, signal)
    default:
      throw new Error(`Unsupported provider: ${resolved.providerId}`)
  }
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

const SYSTEM_PREAMBLE = `You are Iranti Chat, an intelligent assistant embedded in the Iranti Control Plane operator workspace.
You help operators inspect memory facts, understand Staff behavior (Librarian, Attendant, Archivist, Resolutionist), manage instances, and query the Iranti knowledge base.
When the operator asks about a specific entity or fact, you have access to retrieved memory blocks injected below.
Be concise and precise. When referencing a memory fact, cite the entity and key.`

function buildMemoryBlock(fact: FactInjection): string {
  return `[MEMORY: ${fact.entityKey}]\nSummary: ${fact.summary}\nValue: ${JSON.stringify(fact.value)}\nConfidence: ${fact.confidence} | Source: ${fact.source}`
}

function buildPromptMessages(
  agentId: string,
  history: ChatMessage[],
  facts: FactInjection[],
  userMessage: string
): LLMMessage[] {
  const memoryBlocks = facts.map(buildMemoryBlock)
  const userContent = [
    memoryBlocks.length > 0 ? memoryBlocks.join('\n\n') : '',
    userMessage,
  ]
    .filter(Boolean)
    .join('\n\n')

  return [
    { role: 'user', content: `${SYSTEM_PREAMBLE}\n\nYou are acting as agent: ${agentId}` },
    ...history.map((m): LLMMessage => ({ role: m.role, content: m.content })),
    { role: 'user', content: userContent },
  ]
}

// ---------------------------------------------------------------------------
// Retrieved fact mapping
// ---------------------------------------------------------------------------

function mapFactToRetrievedFact(fact: FactInjection): RetrievedFact {
  const slashIdx = fact.entityKey.indexOf('/')
  const entityType = slashIdx >= 0 ? fact.entityKey.slice(0, slashIdx) : fact.entityKey
  const entityId = slashIdx >= 0 ? fact.entityKey.slice(slashIdx + 1) : ''
  return {
    entityType,
    entityId,
    key: fact.entityKey,
    summary: fact.summary,
    confidence: fact.confidence,
    source: fact.source,
  }
}

// ---------------------------------------------------------------------------
// POST /chat
// ---------------------------------------------------------------------------

chatRouter.post('/chat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as Partial<ChatRequestBody>

    if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
      res.status(400).json({ error: 'message is required and must be a non-empty string', code: 'INVALID_MESSAGE' })
      return
    }

    const message = body.message.trim()
    const agentId = (typeof body.agentId === 'string' && body.agentId.trim()) ? body.agentId.trim() : getDefaultAgentId()
    const sessionId = (typeof body.sessionId === 'string' && body.sessionId.trim()) ? body.sessionId.trim() : randomUUID()
    const history: ChatMessage[] = Array.isArray(body.history) ? body.history : []

    // Resolve provider
    const resolved = resolveProvider(body.providerId)
    if (!resolved) {
      res.status(503).json({
        error: 'No LLM provider is configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or another provider key.',
        code: 'NO_PROVIDER_CONFIGURED',
      })
      return
    }
    const model = resolveDefaultModel(resolved.providerId, body.modelId)

    // Create abort controller for cancel support
    const controller = new AbortController()
    inFlightControllers.set(sessionId, controller)

    try {
      // Step 1: Call Iranti /memory/attend to retrieve relevant memory facts
      const conversationContext = history
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n')

      let attendResult: AttendResult = { facts: [], shouldInject: false, reason: 'skipped', entitiesDetected: [], alreadyPresent: 0, totalFound: 0 }
      try {
        attendResult = await irantiFetchAttend(agentId, conversationContext, message, controller.signal)
      } catch (attendErr) {
        // Attend failure is non-fatal: proceed without memory injection.
        // This handles the case where the Iranti server is unreachable.
        console.warn('[chat] Iranti /memory/attend failed — proceeding without memory injection:', attendErr instanceof Error ? attendErr.message : String(attendErr))
      }

      const facts = attendResult.shouldInject ? attendResult.facts : []

      // Step 2: Build prompt and call LLM
      const messages = buildPromptMessages(agentId, history, facts, message)
      const completion = await completeLLM(resolved, model, messages, controller.signal)

      const retrievedFacts: RetrievedFact[] = facts.map(mapFactToRetrievedFact)

      const response: ChatResponseBody = {
        role: 'assistant',
        content: completion.text,
        retrievedFacts,
        sessionId,
        model: completion.model,
        provider: completion.provider,
      }

      res.json(response)
    } finally {
      inFlightControllers.delete(sessionId)
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      res.status(499).json({ error: 'Request cancelled', code: 'REQUEST_CANCELLED' })
      return
    }
    next(err)
  }
})

// ---------------------------------------------------------------------------
// DELETE /chat/:sessionId   — cancel/abort an in-flight session
// ---------------------------------------------------------------------------

chatRouter.delete('/chat/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params
  const controller = inFlightControllers.get(sessionId)
  if (controller) {
    controller.abort()
    inFlightControllers.delete(sessionId)
    res.json({ cancelled: true, sessionId })
  } else {
    // Session not in-flight — may have already completed or never existed
    res.json({ cancelled: false, sessionId, reason: 'not_in_flight' })
  }
})

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

chatRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const apiErr = err as ApiError
  res.status(apiErr.statusCode ?? 500).json({
    error: apiErr.message ?? 'Internal server error',
    code: apiErr.code ?? 'INTERNAL_ERROR',
  })
})
