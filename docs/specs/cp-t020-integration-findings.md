# CP-T020 — Iranti Chat Integration Findings

**Investigated by:** backend_developer
**Date:** 2026-03-20
**Status:** Option A feasible via direct Iranti HTTP API proxy — implementation proceeding

---

## Summary

Iranti does NOT expose a programmatic HTTP chat endpoint. There is no `POST /api/chat` or equivalent. The `iranti chat` CLI is an interactive readline-based session — it cannot be wrapped as a subprocess without losing the conversation model.

However, **Option A is still feasible** via a different path: the control plane can act as its own chat orchestrator by calling Iranti's existing HTTP API endpoints (`/memory/attend`, `/memory/handshake`, `/kb/write`, etc.) and calling the LLM directly — exactly replicating what `iranti chat` does internally. This is the chosen integration path.

---

## Option A Investigation: Iranti HTTP API

### Endpoints probed

| Endpoint | Result |
|---|---|
| `GET /` | Connection refused (server not running during investigation) |
| `GET /api` | Connection refused |
| `GET /api/chat` | Connection refused |
| `POST /api/chat` | Connection refused |
| `GET /api/v1/chat` | Connection refused |

The Iranti server (`iranti@0.2.9` at `http://localhost:3001`) was not running during investigation. However, inspection of the installed package source confirms the HTTP server registers these route prefixes only:

```
/agents    — agent registry read/write
/kb        — knowledge base (query, write, search, history, relate)
/memory    — handshake, observe, attend
/health    — public health check
/dev       — admin/dev utilities
/metrics   — observability snapshot
```

**There is no `/chat` route.** The chat surface is 100% CLI.

### Iranti chat module internals (`dist/src/chat/index.js`)

The `startChatSession()` function uses an internal `ApiClient` that calls:
- `POST /memory/handshake` — establish agent working memory brief
- `POST /memory/attend` — retrieve relevant memory facts for the current context
- `POST /memory/observe` — background warm of next-turn memory path (fire-and-forget)
- `GET /kb/query/:type/:id/:key` — query a specific fact
- `POST /kb/write` — write a new fact (via slash commands)
- `POST /agents/relate` — create relationships (via `/relate` slash command)

After calling `/memory/attend`, the CLI passes the returned `facts: FactInjection[]` as structured memory blocks into the LLM prompt alongside the user's message. The LLM returns plain text (`LLMResponse.text`). There is no structured retrieved-fact metadata in the LLM response — the structure comes from the `attend` call.

### AttendResult shape (from `AttendantInstance.d.ts`)

```typescript
interface FactInjection {
  entityKey: string   // e.g. "ticket/cp_t020"
  summary: string
  value: unknown
  confidence: number
  source: string
}

interface AttendResult {
  facts: FactInjection[]   // ← these become RetrievedFact cards in the UI
  shouldInject: boolean
  reason: string
  entitiesDetected: string[]
  alreadyPresent: number
  totalFound: number
  decision: { needed: boolean, confidence: number, method: string, explanation: string }
}
```

The `entityKey` field is in the format `entityType/entityId` (e.g. `ticket/cp_t020`), which maps directly to the Memory Explorer's entity detail routes.

### LLMResponse shape (from `lib/llm.d.ts`)

```typescript
interface LLMResponse {
  text: string      // the assistant's prose response
  model: string
  provider: string
}
```

The LLM does not return structured retrieved facts embedded in its response — those come separately from the `attend` call.

---

## Option B Investigation: subprocess wrapping

`iranti chat` is implemented as a readline-based interactive session (`readline/promises`). It has:
- No `--json` flag
- No non-interactive input mode
- No structured stdout format
- Closes on `SIGINT` or `/exit`/`/quit` commands
- All output goes to `console.log` (human-readable)

**Option B is not viable** without patching the upstream CLI.

---

## Integration Path Chosen: Option A (Direct Iranti HTTP Proxy)

The control plane's `POST /api/control-plane/chat` endpoint will:

1. Read `IRANTI_URL` and `IRANTI_API_KEY` from the loaded env (already available via `db.ts` `env` export).
2. Call `POST {IRANTI_URL}/memory/attend` with the agent ID, session conversation context, and the incoming message.
3. Build a prompt from the attend result's `facts` array (as memory blocks) + the user's message.
4. Call the configured LLM provider (using the same provider resolution as `providers.ts`).
5. Return the LLM text + the structured `facts` from the attend result as `retrievedFacts`.

### Response structure

```typescript
interface RetrievedFact {
  entityType: string   // derived from entityKey.split('/')[0]
  entityId: string     // derived from entityKey.split('/')[1]
  key: string          // entityKey (the full "type/id" string from iranti)
  summary: string
  confidence: number
  source: string
}

interface ChatResponse {
  role: "assistant"
  content: string            // LLM text response
  retrievedFacts: RetrievedFact[]  // from attend result facts[]
  sessionId: string          // opaque session identifier (UUID)
  model: string              // model used
  provider: string           // provider used
}
```

### Streaming

**Not available.** The `completeWithFallback` function returns a single completed `LLMResponse`. The control plane implementation will call the LLM via the provider HTTP APIs directly — streaming could be added per-provider but is out of scope for Phase 2 per PM decision.

### Slash command palette

The chat module implements these slash commands: `/write`, `/query`, `/queryAll`, `/history`, `/search`, `/ingest`, `/relate`, `/related`, `/resolve`, `/confidence`, `/clear`, `/provider`, `/exit`, `/quit`, `/help`. These 13 commands are enumerated statically. PM decision: static list is acceptable for Phase 2.

---

## CP-T022 Provider/Model API Status

The provider routes (`src/server/routes/control-plane/providers.ts`) are implemented and fully operational:
- `GET /api/control-plane/providers` — lists all configured providers with reachability status
- `GET /api/control-plane/providers/:providerId/models` — lists models per provider (live + static fallback)
- `GET /api/control-plane/instances/:instanceId/providers` — instance-scoped provider list

CP-T022 is **complete at the backend level**. The chat panel's provider/model selector can use `GET /api/control-plane/providers` and `GET /api/control-plane/providers/:providerId/models` directly. No fallback to raw env var parsing is needed.

---

## Blockers

None that block implementation. The Iranti server must be running when the chat endpoint is called — this is documented as a runtime dependency, not a build-time one. The endpoint will return a clear 503 if Iranti is unreachable.

---

## Open Questions Resolved

| Question | Decision |
|---|---|
| Slash command source: static or dynamic? | Static list of 13 known commands (PM decision) |
| Streaming? | Not available from Iranti; full-response only. Stretch goal. |
| Structured retrieved facts in LLM response? | No — facts come from `attend` pre-call, not embedded in LLM output |
| RetrievedFact.key field: what value? | The `entityKey` string from `FactInjection` (e.g. `ticket/cp_t020`) |
| Memory Explorer deep link: how to parse entityType/entityId? | Split `entityKey` on first `/` |
