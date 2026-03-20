# CP-T025 — Librarian Injection Point Diffs

**File**: `src/librarian/index.ts`
**Spec reference**: cp-t025-emitter-design.md §3.1 and cp-t025-upstream-pr.md (injection point table)

These are prose-format unified diffs. Since the Iranti TypeScript source is not distributed,
the before/after blocks are inferred from the compiled `dist/src/librarian/index.js` and
`dist/src/librarian/index.d.ts` at version 0.2.9, as documented in cp-t025-emitter-design.md §0.2.

**New import to add** (at the top of `src/librarian/index.ts`, alongside existing imports):

```typescript
// BEFORE (no emitter imports)
import { prisma } from '../db';
import { withIdentityLock } from '../lib/lock';
// ... other existing imports

// AFTER
import { prisma } from '../db';
import { withIdentityLock } from '../lib/lock';
import { getStaffEventEmitter } from '../lib/staffEventRegistry'; // CP-T025
// ... other existing imports
```

---

## Injection Point 1 — `write_created`

**Function**: `librarianWrite` (or the `withIdentityLock` transaction callback within it)
**Trigger**: No existing entry found for the `(entityType, entityId, key)` tuple. `createEntry()` succeeds.
**Event level**: `audit`

```typescript
// BEFORE
await createEntry(prismaOrTx, {
  entityType: input.entityType,
  entityId: input.entityId,
  key: input.key,
  value: input.valueRaw,
  confidence: input.confidence,
  createdBy: input.createdBy,
  source: input.source,
  requestId: input.requestId ?? null,
  validUntil: input.validUntil ?? null,
});
return { action: 'created', entry: newEntry };

// AFTER
await createEntry(prismaOrTx, {
  entityType: input.entityType,
  entityId: input.entityId,
  key: input.key,
  value: input.valueRaw,
  confidence: input.confidence,
  createdBy: input.createdBy,
  source: input.source,
  requestId: input.requestId ?? null,
  validUntil: input.validUntil ?? null,
});
// CP-T025: emit write_created event
getStaffEventEmitter().emit({
  staffComponent: 'Librarian',
  actionType: 'write_created',
  agentId: input.createdBy,
  source: input.source,
  entityType: input.entityType,
  entityId: input.entityId,
  key: input.key,
  reason: 'No existing entry found. Created.',
  level: 'audit',
  metadata: {
    confidence: input.confidence,
    valuePreview: JSON.stringify(input.valueRaw).slice(0, 200),
  },
});
return { action: 'created', entry: newEntry };
```

**Ambiguity note**: The compiled output shows `createEntry` is called inside a `withIdentityLock`
callback. The exact variable name for the new entry (`newEntry` above) depends on what
`createEntry` returns in the TypeScript source. It may be named `entry`, `created`, or
obtained via a separate query. The emitter call does not use this value — it reads from
`input` — so the variable name ambiguity does not affect the injected code.

---

## Injection Point 2 — `write_replaced`

**Function**: `resolveConflict` (internal helper called from `withIdentityLock` callback)
**Trigger**: Existing entry is superseded by a higher-confidence incoming write. `replaceEntry()` (or `updateEntry()`) succeeds.
**Event level**: `audit`

```typescript
// BEFORE
await replaceEntry(prismaOrTx, existing.id, {
  value: incoming.valueRaw,
  confidence: incoming.confidence,
  createdBy: incoming.createdBy,
  source: incoming.source,
  requestId: incoming.requestId ?? null,
  validUntil: incoming.validUntil ?? null,
});
return { action: 'updated', entry: replacedEntry, reason: conflictReason };

// AFTER
await replaceEntry(prismaOrTx, existing.id, {
  value: incoming.valueRaw,
  confidence: incoming.confidence,
  createdBy: incoming.createdBy,
  source: incoming.source,
  requestId: incoming.requestId ?? null,
  validUntil: incoming.validUntil ?? null,
});
// CP-T025: emit write_replaced event (note: Librarian's internal action name is 'updated';
// the StaffEvent actionType is 'write_replaced' as specified by CP-T025)
getStaffEventEmitter().emit({
  staffComponent: 'Librarian',
  actionType: 'write_replaced',
  agentId: incoming.createdBy,
  source: incoming.source,
  entityType: incoming.entityType,
  entityId: incoming.entityId,
  key: incoming.key,
  reason: conflictReason,
  level: 'audit',
  metadata: {
    confidence: incoming.confidence,
    priorConfidence: existing.confidence,
    valuePreview: JSON.stringify(incoming.valueRaw).slice(0, 200),
  },
});
return { action: 'updated', entry: replacedEntry, reason: conflictReason };
```

**Ambiguity note**: The compiled output uses `action: 'updated'` as the WriteAction discriminant.
The `StaffEvent.actionType` must be `'write_replaced'` per the CP-T025 spec — this mapping is
applied at the injection point, not in the consumer. The local variable `conflictReason` is
inferred from the compiled output; the exact name may differ. The `reason` for supersession
(e.g. `'incoming confidence higher'`) must be derived from whichever local variable the
TypeScript source uses to describe the resolution outcome.

---

## Injection Point 3 — `write_escalated`

**Function**: `escalateConflict` (internal helper called from `resolveConflict` when confidence delta is insufficient to auto-resolve)
**Trigger**: Conflict cannot be auto-resolved; escalation file is written to `~/.iranti/escalations/`.
**Event level**: `audit`

```typescript
// BEFORE
const filename = `${escalationId}.md`;
const filePath = path.join(escalationsDir, filename);
await writeFile(filePath, escalationMarkdown);
return { action: 'escalated', escalationId, filePath };

// AFTER
const filename = `${escalationId}.md`;
const filePath = path.join(escalationsDir, filename);
await writeFile(filePath, escalationMarkdown);
// CP-T025: emit write_escalated event after file write succeeds
getStaffEventEmitter().emit({
  staffComponent: 'Librarian',
  actionType: 'write_escalated',
  agentId: incoming.createdBy,
  source: incoming.source,
  entityType: incoming.entityType,
  entityId: incoming.entityId,
  key: incoming.key,
  reason: `Conflict escalated to ${filePath}.`,
  level: 'audit',
  metadata: {
    escalationId: filename,
    conflictReason: 'confidence_conflict',
  },
});
return { action: 'escalated', escalationId, filePath };
```

**Ambiguity note**: The compiled output shows `escalateConflict` receives both the `existing`
and `incoming` entry objects. The `agentId` is taken from `incoming.createdBy` (the challenger
agent). The escalation file naming convention (`${escalationId}.md`) is inferred from the
compiled output — the exact format of `escalationId` (UUID, timestamp-based, etc.) is not
visible in the compiled output. The `metadata.escalationId` stores the filename string so
the control plane can correlate escalation events with resolution events.

---

## Injection Point 4 — `write_rejected`

**Function**: `librarianWrite` and `resolveConflict` (multiple return sites)
**Trigger**: Write is blocked for one of 5+ reasons (see sub-cases below).
**Event level**: `audit`

The Librarian has multiple distinct rejection reasons. Each is a separate return site
returning `{ action: 'rejected', reason: '...' }`. All use the same emitter call shape;
only the `reason` field and `metadata.rejectionReason` differ.

**Pattern** (applied identically at every rejection `return` site):

```typescript
// BEFORE (at any rejection return site)
return { action: 'rejected', reason: rejectionReason };

// AFTER
// CP-T025: emit write_rejected event before rejection return
getStaffEventEmitter().emit({
  staffComponent: 'Librarian',
  actionType: 'write_rejected',
  agentId: input.createdBy,
  source: input.source,
  entityType: input.entityType,
  entityId: input.entityId,
  key: input.key,
  reason: rejectionReason,
  level: 'audit',
  metadata: { rejectionReason },
});
return { action: 'rejected', reason: rejectionReason };
```

**Known rejection reason variants** (inferred from compiled output — 5 distinct sites):

| Rejection reason (approximate) | Location |
|---|---|
| Permission denied — agent lacks write permission for this entity | `librarianWrite`, early guard |
| Entry is write-protected — `isProtected: true` in existing entry | `resolveConflict`, protection check |
| Incoming confidence too low to challenge existing entry | `resolveConflict`, confidence guard |
| Contextual conflict — write contradicts a protected invariant | `resolveConflict`, invariant check |
| Schema validation failure — input fields fail validation | `librarianWrite`, validation guard |

**Ambiguity note**: The exact variable name for the rejection reason string at each site
may differ (e.g. `reason`, `rejectionReason`, `error`, or a string literal). The injection
pattern shown above uses `rejectionReason` as a placeholder — implementors must use the
actual local variable or string literal at each site. There may be more than 5 rejection sites;
the compiled output shows at least 5 distinct `action: 'rejected'` return paths. The emitter
call must be inserted before each one.

---

## Injection Point 5 — `write_deduplicated`

**Function**: `librarianWrite` (idempotent replay path)
**Trigger**: `input.requestId` is provided and a receipt for this `requestId` already exists in the idempotency store. The write is skipped and the original result is returned.
**Event level**: `debug`

```typescript
// BEFORE
const existingReceipt = await findReceipt(prismaOrTx, input.requestId);
if (existingReceipt) {
  return { action: 'deduplicated', entry: existingReceipt.entry };
}

// AFTER
const existingReceipt = await findReceipt(prismaOrTx, input.requestId);
if (existingReceipt) {
  // CP-T025: emit write_deduplicated on idempotent replay
  getStaffEventEmitter().emit({
    staffComponent: 'Librarian',
    actionType: 'write_deduplicated',
    agentId: input.createdBy,
    source: input.source,
    entityType: input.entityType,
    entityId: input.entityId,
    key: input.key,
    reason: 'Idempotent replay — requestId already processed.',
    level: 'debug',
    metadata: { requestId: input.requestId },
  });
  return { action: 'deduplicated', entry: existingReceipt.entry };
}
```

**Ambiguity note**: The compiled output shows an idempotency check near the start of the
`withIdentityLock` callback. The function name (`findReceipt`, `lookupReceipt`, or similar)
and the returned structure (`existingReceipt.entry`, `receipt.result`, etc.) are inferred
from the compiled output and may differ in the TypeScript source. The emitter call does not
depend on the receipt structure — it reads only from `input`.

---

## Injection Point 6 — `conflict_detected`

**Function**: `librarianWrite` (before `resolveConflict` is called)
**Trigger**: An existing entry is found for `(entityType, entityId, key)` and conflict resolution begins.
**Event level**: `debug`
**Note**: This event is listed in cp-t025-emitter-design.md §3.1 injection table but is not
listed in cp-t025-upstream-pr.md's injection point table. Include it as it provides useful
debug-level visibility into conflict volume without adding audit noise.

```typescript
// BEFORE
const existing = await findEntry(prismaOrTx, input.entityType, input.entityId, input.key);
if (existing) {
  return await resolveConflict(existing, input, prismaOrTx);
}

// AFTER
const existing = await findEntry(prismaOrTx, input.entityType, input.entityId, input.key);
if (existing) {
  // CP-T025: emit conflict_detected before resolution begins
  getStaffEventEmitter().emit({
    staffComponent: 'Librarian',
    actionType: 'conflict_detected',
    agentId: input.createdBy,
    source: input.source,
    entityType: input.entityType,
    entityId: input.entityId,
    key: input.key,
    reason: 'Existing entry found. Conflict resolution initiated.',
    level: 'debug',
    metadata: {
      existingConfidence: existing.confidence,
      incomingConfidence: input.confidence,
    },
  });
  return await resolveConflict(existing, input, prismaOrTx);
}
```

---

## Summary of Changes to `src/librarian/index.ts`

| Change | Lines affected (approx, from compiled) |
|---|---|
| Add import for `getStaffEventEmitter` | Top of file (~line 5) |
| Insert `write_created` emit | After `createEntry()` call (~line 210) |
| Insert `conflict_detected` emit | Before `resolveConflict()` call (~line 190) |
| Insert `write_replaced` emit | Before `return { action: 'updated' }` in `resolveConflict` (~line 280) |
| Insert `write_escalated` emit | After `writeFile()` in `escalateConflict` (~line 320) |
| Insert `write_rejected` emits | Before each `return { action: 'rejected' }` (5+ sites, ~lines 155, 240, 260, 270, 295) |
| Insert `write_deduplicated` emit | Inside idempotent receipt check (~line 140) |
