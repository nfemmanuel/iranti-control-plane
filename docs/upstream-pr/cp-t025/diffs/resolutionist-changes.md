# CP-T025 — Resolutionist Injection Point Diffs

**File**: `src/resolutionist/index.ts`
**Spec reference**: cp-t025-emitter-design.md §3.4 and cp-t025-upstream-pr.md (injection point table)

These are prose-format unified diffs. The Resolutionist is an interactive CLI-driven function
(`resolveInteractive`). It reads escalation files, prompts the operator via readline, and
writes resolution decisions back to those files.

**Key constraint documented in spec**: The `resolveInteractive` function does not have an
`agentId` or `source` parameter representing the operator. The `agentId` is hardcoded to
`'operator'` and `source` to `'cli'` for all Resolutionist events. This is acceptable
because the Resolutionist is exclusively CLI-driven.

**New import to add** (at the top of `src/resolutionist/index.ts`):

```typescript
// BEFORE
import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';
// ... other existing imports

// AFTER
import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';
import { getStaffEventEmitter } from '../lib/staffEventRegistry'; // CP-T025
// ... other existing imports
```

---

## Injection Point 1 — `resolution_filed`

**Function**: `resolveInteractive()` (top-level export)
**Trigger**: The operator has selected a resolution (kept existing, kept challenger, or custom value) and the escalation file has been successfully overwritten with the `RESOLVED` marker and the authoritative value.
**Event level**: `audit`
**Approximate compiled line**: ~244

```typescript
// BEFORE
const resolvedContent = buildResolvedContent(escalation, chosenValue, summary);
await fs.writeFile(filePath, resolvedContent, 'utf-8');
console.log(`Resolution filed for ${path.basename(filePath)}.`);
resolved += 1;

// AFTER
const resolvedContent = buildResolvedContent(escalation, chosenValue, summary);
await fs.writeFile(filePath, resolvedContent, 'utf-8');
// CP-T025: emit resolution_filed after the file write succeeds
// Note: this must be AFTER fs.writeFile() — if the write fails, no event is emitted.
getStaffEventEmitter().emit({
  staffComponent: 'Resolutionist',
  actionType: 'resolution_filed',
  agentId: 'operator',
  source: 'cli',
  entityType: escalation.entityType ?? null,
  entityId: escalation.entityId ?? null,
  key: escalation.key ?? null,
  reason: `Resolution filed: ${summary}`,
  level: 'audit',
  metadata: {
    escalationId: path.basename(filePath),
    winnerSource: originalRetained ? 'existing' : 'challenger',
    resolutionNote: summary,
  },
});
console.log(`Resolution filed for ${path.basename(filePath)}.`);
resolved += 1;
```

**Ambiguity notes**:

1. **`buildResolvedContent` signature**: The function name `buildResolvedContent` is inferred
   from the compiled output. The actual name may differ (`formatResolution`, `writeResolution`,
   `markResolved`). The injection point is immediately after the `fs.writeFile()` call — this
   is unambiguous regardless of helper naming.

2. **`escalation` object shape**: The compiled output shows an escalation object with fields
   including `entityType`, `entityId`, `key`, and the two competing values. The exact field
   names must be confirmed against the TypeScript source — `escalation.entityType` may instead
   be `escalation.entry.entityType` or similar.

3. **`originalRetained` variable**: The compiled output shows a boolean flag distinguishing
   whether the operator kept the original or the challenger value. The name `originalRetained`
   is a placeholder — use the actual boolean variable from the TypeScript source.

4. **`summary` variable**: The compiled output shows a summary string describing the
   resolution choice. The variable name may be `resolutionSummary`, `note`, or `description`.

5. **`resolved` counter**: The `resolved += 1` increment is part of the existing code. The
   `emit()` call should appear between the `fs.writeFile()` and the `console.log()` —
   after confirmation of success, before the side-effect counter increment.

---

## Injection Point 2 — `escalation_deferred`

**Function**: `resolveInteractive()` (top-level export)
**Trigger**: The operator answers the resolution prompt with a "skip" choice. The escalation file is left unchanged and the conflict remains pending.
**Event level**: `audit`

```typescript
// BEFORE
if (userChoice === 'skip' || userChoice === 's') {
  skipped += 1;
  continue;
}

// AFTER
if (userChoice === 'skip' || userChoice === 's') {
  // CP-T025: emit escalation_deferred before incrementing skip counter
  getStaffEventEmitter().emit({
    staffComponent: 'Resolutionist',
    actionType: 'escalation_deferred',
    agentId: 'operator',
    source: 'cli',
    entityType: escalation.entityType ?? null,
    entityId: escalation.entityId ?? null,
    key: escalation.key ?? null,
    reason: 'Operator skipped this escalation.',
    level: 'audit',
    metadata: {
      escalationId: path.basename(filePath),
      deferralReason: 'operator_skip',
    },
  });
  skipped += 1;
  continue;
}
```

**Ambiguity notes**:

1. **Skip detection logic**: The compiled output shows the operator's input is read via
   readline and matched against skip keywords. The exact condition (`userChoice === 'skip'`,
   `answer === 's'`, `input.trim().toLowerCase() === 'skip'`, etc.) must be confirmed from
   the TypeScript source. The injection point is inside whichever branch handles the skip
   decision, immediately before the skip counter increment.

2. **Variable naming**: `userChoice`, `skipped`, and `filePath` are placeholder names inferred
   from the compiled output. The actual names must match the TypeScript source.

3. **Loop structure**: The compiled output shows `resolveInteractive()` iterates over a list
   of escalation files in a `for` loop with `continue` used to advance to the next file on
   skip. The `escalation_deferred` emit is inside this loop.

---

## Out-of-Scope: `escalation_expired`

**Status**: Not implemented in this PR.

As documented in cp-t025-emitter-design.md §3.4 and cp-t025-upstream-pr.md §Notes:

The `escalation_expired` action type has no natural implementation path in `resolveInteractive()`,
which only runs when the operator explicitly executes `iranti resolve`. TTL expiry detection
requires a scheduled pass that can inspect escalation files when no operator is present.

**Recommended path**: Implement `escalation_expired` in the Archivist's `processEscalations`
path during a follow-up PR. The Archivist already runs on a schedule and processes escalation
files — it can detect files past a configurable TTL and emit `escalation_expired` before
skipping them.

This limitation is flagged to PM in cp-t025-emitter-design.md §14, Open Question 2.

---

## Summary of Changes to `src/resolutionist/index.ts`

| Change | Location |
|---|---|
| Add import for `getStaffEventEmitter` | Top of file |
| Insert `resolution_filed` emit | In `resolveInteractive()`, after `fs.writeFile(filePath, resolvedContent)` succeeds, before `resolved += 1` |
| Insert `escalation_deferred` emit | In `resolveInteractive()`, inside the skip branch, before `skipped += 1` |
