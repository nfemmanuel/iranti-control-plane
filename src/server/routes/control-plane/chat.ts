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
// LLM call via Iranti's /chat/completions (OpenAI-compatible)
// ---------------------------------------------------------------------------
//
// Iranti (v0.2.10) exposes /chat/completions and /v1/chat/completions routes
// that proxy to whatever LLM provider is configured in Iranti's LLM_PROVIDER
// env var. We do NOT call provider APIs directly — Iranti owns provider routing.
//
// IMPORTANT: the API key (X-Iranti-Key) must have the 'proxy:chat' scope.
// Missing scope returns 403. Check your .env.iranti IRANTI_API_KEY scopes.
//
// Provider selection is Iranti-side only. The 'model' field is a hint;
// the 'providerId' from the frontend selector is informational in the UI only.
// Response usage fields are always 0 (Iranti v0.2.10 does not count tokens).
//
// Iranti routes (from src/api/server.ts):
//   /health (no auth), /kb/..., /memory/..., /agents/..., /metrics,
//   /chat/completions, /v1/chat/completions (all require X-Iranti-Key)

interface CompletionResult {
  text: string
  model: string
  provider: string
}

async function callIrantiChatCompletions(
  messages: LLMMessage[],
  model: string,
  signal?: AbortSignal
): Promise<CompletionResult> {
  const result = await irantiFetch(
    '/chat/completions',
    'POST',
    { model, messages, max_tokens: 4096, stream: false },
    signal
  )
  // OpenAI-compatible response shape
  const json = result as {
    choices?: Array<{ message?: { content?: string } }>
    model?: string
    provider?: string
  }
  const text = json.choices?.[0]?.message?.content ?? ''
  return {
    text,
    model: json.model ?? model,
    provider: (json.provider as string | undefined) ?? 'iranti',
  }
}

function resolveDefaultModel(preferredModelId?: string): string {
  if (preferredModelId?.trim()) return preferredModelId.trim()
  // Iranti uses its own configured default; we can pass a hint or let it decide
  return ''
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

    // Iranti owns provider routing — we proxy through /chat/completions.
    // The model hint is passed as a preference; Iranti uses its configured default if omitted.
    const model = resolveDefaultModel(body.modelId)

    // Create abort controller for cancel support
    const controller = new AbortController()
    inFlightControllers.set(sessionId, controller)

    try {
      // Cap history to last 10 messages (5 turns) — PM requirement.
      // Unbounded history bloats the attend context window and degrades retrieval precision.
      const recentHistory = history.slice(-10)
      const conversationContext = recentHistory
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n')

      // Step 1: Call Iranti /memory/attend to retrieve relevant memory facts.
      //
      // Why this call exists alongside /chat/completions:
      //   - attend returns structured RetrievedFact[] surfaced to the operator in the chat panel
      //   - The operator visibility of cited entity/key facts is a product feature, not plumbing
      //   - Iranti's /chat/completions may or may not perform its own internal memory injection;
      //     if it does, mild redundancy is acceptable — the explicit panel cards are load-bearing
      //   - If /chat/completions does NOT inject memory internally, removing this call would
      //     silently break memory retrieval for the operator
      //
      // PM decision (2026-03-20): two-call pattern is approved and must be retained.
      let attendResult: AttendResult = { facts: [], shouldInject: false, reason: 'skipped', entitiesDetected: [], alreadyPresent: 0, totalFound: 0 }
      try {
        attendResult = await irantiFetchAttend(agentId, conversationContext, message, controller.signal)
      } catch (attendErr) {
        // Attend failure is non-fatal: proceed without memory injection.
        // This handles the case where the Iranti server is unreachable.
        console.warn('[chat] Iranti /memory/attend failed — proceeding without memory injection:', attendErr instanceof Error ? attendErr.message : String(attendErr))
      }

      const facts = attendResult.shouldInject ? attendResult.facts : []

      // Step 2: Call Iranti's /chat/completions endpoint (OpenAI-compatible).
      // Iranti routes through whatever LLM provider is configured in its own env.
      // We pass the messages (with memory blocks injected) directly.
      const messages = buildPromptMessages(agentId, recentHistory, facts, message)
      const completion = await callIrantiChatCompletions(messages, model, controller.signal)

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
