# CP-T025 — Attendant Injection Point Diffs

**File**: `src/attendant/AttendantInstance.ts`
**Spec reference**: cp-t025-emitter-design.md §3.2 and cp-t025-upstream-pr.md (injection point table)

These are prose-format unified diffs. Attendant is class-based (`AttendantInstance`).
All injection points call `getStaffEventEmitter()` from the registry — the class does not
store the emitter as an instance variable. This avoids changing the constructor signature.

**Key constraint documented in spec**: `AttendantInstance` does not receive the originating
call surface (MCP vs CLI vs API) as a parameter. All Attendant events use `source: 'internal'`
in this PR. Threading `source` through the handshake/attend call chain is a follow-up task.

**New import to add** (at the top of `src/attendant/AttendantInstance.ts`):

```typescript
// BEFORE
import { prisma } from '../db';
// ... other existing imports

// AFTER
import { prisma } from '../db';
import { getStaffEventEmitter } from '../lib/staffEventRegistry'; // CP-T025
// ... other existing imports
```

---

## Injection Point 1 — `handshake_completed`

**Method**: `AttendantInstance.handshake()`
**Trigger**: Session handshake processed; working memory brief built and returned to caller.
**Event level**: `debug`
**Approximate compiled line**: ~183 in `dist/src/attendant/AttendantInstance.js`

```typescript
// BEFORE
async handshake(context: HandshakeContext): Promise<HandshakeBrief> {
  // ... existing logic: build working memory, store session state ...
  const brief = await this.buildWorkingMemory(context);
  this.brief = brief;
  this.sessionStarted = new Date().toISOString();
  return brief;
}

// AFTER
async handshake(context: HandshakeContext): Promise<HandshakeBrief> {
  // ... existing logic: build working memory, store session state ...
  const brief = await this.buildWorkingMemory(context);
  this.brief = brief;
  this.sessionStarted = new Date().toISOString();
  // CP-T025: emit handshake_completed after brief is built
  getStaffEventEmitter().emit({
    staffComponent: 'Attendant',
    actionType: 'handshake_completed',
    agentId: this.agentId,
    source: 'internal', // source not threaded through AttendantInstance — follow-up required
    reason: null,
    level: 'debug',
    metadata: {
      briefSize: brief.workingMemory?.length ?? 0,
      taskSummary: context.task?.slice(0, 120) ?? null,
      sessionId: this.sessionStarted,
    },
  });
  return brief;
}
```

**Ambiguity note**: The compiled output shows `handshake()` accepts a `context` parameter
containing at minimum a `task` string and `recentMessages` array. The field names in the
compiled output are `task` and `recentMessages`. The property `this.brief` and
`this.sessionStarted` are instance variables visible in the compiled class. The
`briefSize` metadata field counts `workingMemory` entries — the exact property path
(`brief.workingMemory`, `brief.facts`, or similar) must match whatever the TypeScript
source calls the working memory array.

---

## Injection Point 2 — `reconvene_completed`

**Method**: `AttendantInstance.reconvene()`
**Trigger**: Mid-session context reset; brief rebuilt after context window pressure. Higher severity than handshake because it indicates context management is active.
**Event level**: `audit`
**Approximate compiled line**: ~216

```typescript
// BEFORE
async reconvene(context: HandshakeContext): Promise<HandshakeBrief> {
  // ... existing logic: rebuild brief, increment contextCallCount ...
  this.contextCallCount += 1;
  const brief = await this.buildWorkingMemory(context);
  this.brief = brief;
  return brief;
}

// AFTER
async reconvene(context: HandshakeContext): Promise<HandshakeBrief> {
  // ... existing logic: rebuild brief, increment contextCallCount ...
  this.contextCallCount += 1;
  const brief = await this.buildWorkingMemory(context);
  this.brief = brief;
  // CP-T025: emit reconvene_completed after brief is rebuilt
  getStaffEventEmitter().emit({
    staffComponent: 'Attendant',
    actionType: 'reconvene_completed',
    agentId: this.agentId,
    source: 'internal',
    reason: null,
    level: 'audit',
    metadata: {
      briefSize: brief.workingMemory?.length ?? 0,
      sessionId: this.sessionStarted,
      contextCallCount: this.contextCallCount,
    },
  });
  return brief;
}
```

---

## Injection Point 3 — `attend_completed`

**Method**: `AttendantInstance.attend()`
**Trigger**: Per-turn attend call processed; injection decision returned to caller.
**Event level**: `debug`
**Approximate compiled line**: ~300

```typescript
// BEFORE
async attend(message: string, context?: string): Promise<AttendResult> {
  // ... existing logic: check relevance, possibly inject facts ...
  this.contextCallCount += 1;
  const result = await this.computeAttendResult(message, context);
  return result;
}

// AFTER
async attend(message: string, context?: string): Promise<AttendResult> {
  // ... existing logic: check relevance, possibly inject facts ...
  this.contextCallCount += 1;
  const result = await this.computeAttendResult(message, context);
  // CP-T025: emit attend_completed after result is ready, before return
  getStaffEventEmitter().emit({
    staffComponent: 'Attendant',
    actionType: 'attend_completed',
    agentId: this.agentId,
    source: 'internal',
    reason: null,
    level: 'debug',
    metadata: {
      shouldInject: result.shouldInject ?? false,
      factsInjected: result.facts?.length ?? 0,
      contextCallCount: this.contextCallCount,
      sessionId: this.sessionStarted,
    },
  });
  return result;
}
```

**Ambiguity note**: The compiled output for `attend()` increments `contextCallCount` and
returns an object with at minimum `shouldInject: boolean`. The `result.facts` field may be
named differently (`result.injectedFacts`, `result.workingMemory`). The metadata fields are
best-effort and should use `?? null` guards. The `context` parameter may be a string or
an object in the TypeScript source — the compiled output shows it used as a string.

---

## Injection Point 4 — `observe_completed`

**Method**: `AttendantInstance.observe()`
**Trigger**: Observe call processed; observation recorded or filtered.
**Event level**: `debug`
**Approximate compiled line**: ~590

```typescript
// BEFORE
async observe(observation: ObservationInput): Promise<ObserveResult> {
  // ... existing logic: process observation, possibly write to KB ...
  const result = await this.processObservation(observation);
  return result;
}

// AFTER
async observe(observation: ObservationInput): Promise<ObserveResult> {
  // ... existing logic: process observation, possibly write to KB ...
  const result = await this.processObservation(observation);
  // CP-T025: emit observe_completed after observation is processed
  getStaffEventEmitter().emit({
    staffComponent: 'Attendant',
    actionType: 'observe_completed',
    agentId: this.agentId,
    source: 'internal',
    reason: null,
    level: 'debug',
    metadata: {
      recorded: result.recorded ?? false,
      sessionId: this.sessionStarted,
    },
  });
  return result;
}
```

**Ambiguity note**: The `observe()` method and `ObservationInput` type are visible in the
compiled output but the exact property names of `ObserveResult` (the return type) are not
fully clear. The metadata uses `result.recorded` as a plausible field name — adjust to
match the actual TypeScript source.

---

## Injection Point 5 — `session_expired`

**Method**: `AttendantInstance.onContextLow()` or the session eviction path in the Attendant registry
**Trigger**: Session TTL exceeded or explicit eviction triggered. Higher severity — indicates a session was lost without a clean reconvene.
**Event level**: `audit`

The compiled output shows an `onContextLow()` method or a similar lifecycle hook that is
called when the context window budget is exhausted. The session registry
(`dist/src/attendant/registry.js`) also contains an eviction path for TTL-expired sessions.
The emission should occur in whichever path actually terminates the session.

```typescript
// BEFORE (in onContextLow or eviction path)
// ... mark session as expired, remove from registry ...
this.sessionExpiredAt = new Date().toISOString();

// AFTER
// ... mark session as expired, remove from registry ...
this.sessionExpiredAt = new Date().toISOString();
// CP-T025: emit session_expired when session is terminated
getStaffEventEmitter().emit({
  staffComponent: 'Attendant',
  actionType: 'session_expired',
  agentId: this.agentId,
  source: 'internal',
  reason: 'Session TTL exceeded or context window exhausted.',
  level: 'audit',
  metadata: {
    sessionId: this.sessionStarted,
    contextCallCount: this.contextCallCount,
    expiredAt: this.sessionExpiredAt,
  },
});
```

**Ambiguity note (highest for this injection point)**: The compiled output shows session
lifecycle management split between `AttendantInstance` and the registry module. It is not
entirely clear from the compiled output whether `onContextLow()` is a method on
`AttendantInstance` or a callback passed to a lifecycle manager. The implementor must locate
the exact termination path in the TypeScript source. If there are two paths (TTL eviction in
registry + context low in instance), both should emit `session_expired`. The session registry
path (`dist/src/attendant/registry.js`) may need its own `getStaffEventEmitter` import if
the eviction runs outside the `AttendantInstance` class.

---

## Summary of Changes to `src/attendant/AttendantInstance.ts`

| Change | Location |
|---|---|
| Add import for `getStaffEventEmitter` | Top of file |
| Insert `handshake_completed` emit | End of `handshake()`, before `return brief` |
| Insert `reconvene_completed` emit | End of `reconvene()`, before `return brief` |
| Insert `attend_completed` emit | End of `attend()`, before `return result` |
| Insert `observe_completed` emit | End of `observe()`, before `return result` |
| Insert `session_expired` emit | In `onContextLow()` or session eviction path (may also require change in `src/attendant/registry.ts`) |
