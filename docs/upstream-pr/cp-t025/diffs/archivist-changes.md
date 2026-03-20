# CP-T025 — Archivist Injection Point Diffs

**File**: `src/archivist/index.ts`
**Spec reference**: cp-t025-emitter-design.md §3.3 and cp-t025-upstream-pr.md (injection point table)

These are prose-format unified diffs. The Archivist is a scheduled batch function (`runArchivist`).
All injection points are inside its internal helper functions. No changes to `runArchivist`'s
public signature.

**New import to add** (at the top of `src/archivist/index.ts`):

```typescript
// BEFORE
import { prisma } from '../db';
import * as fs from 'fs/promises';
import * as path from 'path';
// ... other existing imports

// AFTER
import { prisma } from '../db';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getStaffEventEmitter } from '../lib/staffEventRegistry'; // CP-T025
// ... other existing imports
```

---

## Injection Point 1 — `entry_archived`

**Function**: `archiveExpired()` (internal, called from `runArchivist`)
**Trigger**: Per-entry, after each `archiveEntry()` call succeeds for an entry whose `validUntil` is in the past.
**Event level**: `audit`

```typescript
// BEFORE
for (const entry of expiredEntries) {
  await archiveEntry(tx, entry.id, {
    reason: 'expired',
    archivedBy: 'archivist',
  });
  report.expiredArchived += 1;
}

// AFTER
for (const entry of expiredEntries) {
  await archiveEntry(tx, entry.id, {
    reason: 'expired',
    archivedBy: 'archivist',
  });
  // CP-T025: emit entry_archived after each successful archiveEntry call
  getStaffEventEmitter().emit({
    staffComponent: 'Archivist',
    actionType: 'entry_archived',
    agentId: 'archivist',
    source: 'internal',
    entityType: entry.entityType,
    entityId: entry.entityId,
    key: entry.key,
    reason: 'Entry expired (validUntil in past)',
    level: 'audit',
    metadata: {
      archivedReason: 'expired',
      archivedFactId: String(entry.id),
    },
  });
  report.expiredArchived += 1;
}
```

**Ambiguity note**: The compiled output shows `archiveExpired()` iterates over a list of
expired entries. The exact property names on each entry (`entry.entityType`, `entry.entityId`,
`entry.key`, `entry.id`) must match the TypeScript source. These names are inferred from
the compiled output and the `knowledge_entry` Prisma model. The `report` object (or whatever
the ArchivistReport accumulator is named) collects counts — `expiredArchived` is inferred
from the dist output.

---

## Injection Point 2 — `entry_decayed`

**Function**: `applyMemoryDecay()` (internal, called from `runArchivist`)
**Trigger**: Per-entry, after each `archiveEntry()` call succeeds for an entry whose confidence has decayed below the configured threshold.
**Event level**: `audit`

```typescript
// BEFORE
for (const entry of lowConfidenceEntries) {
  await archiveEntry(tx, entry.id, {
    reason: 'decay',
    archivedBy: 'archivist',
  });
  report.lowConfidenceArchived += 1;
}

// AFTER
for (const entry of lowConfidenceEntries) {
  await archiveEntry(tx, entry.id, {
    reason: 'decay',
    archivedBy: 'archivist',
  });
  // CP-T025: emit entry_decayed after each successful archiveEntry call
  getStaffEventEmitter().emit({
    staffComponent: 'Archivist',
    actionType: 'entry_decayed',
    agentId: 'archivist',
    source: 'internal',
    entityType: entry.entityType,
    entityId: entry.entityId,
    key: entry.key,
    reason: `Confidence below decay threshold.`,
    level: 'audit',
    metadata: {
      archivedReason: 'decay',
      archivedFactId: String(entry.id),
      confidence: entry.confidence,
      decayPolicy: 'confidence_threshold',
    },
  });
  report.lowConfidenceArchived += 1;
}
```

**Ambiguity note**: The spec mentions `applyMemoryDecay()` but the compiled output may use
`archiveLowConfidence()` or `archiveDecayed()` as the function name. The spec cross-references
both names. The injection pattern is the same regardless of function name. The `entry.confidence`
field is the current confidence value before archival — include it in metadata so consumers
can see what confidence triggered the decay.

---

## Injection Point 3 — `escalation_processed`

**Function**: `processEscalationFile()` (internal)
**Trigger**: After an escalation file has been read and the resolution decision parsed from its content. The Archivist has consumed the Resolutionist's resolution.
**Event level**: `audit`

```typescript
// BEFORE
const resolution = await parseResolutionFromFile(filePath);
if (!resolution) {
  report.errors.push(`Failed to parse resolution from ${filePath}`);
  continue;
}
// Apply resolution to knowledge_base...
await applyResolution(tx, resolution);

// AFTER
const resolution = await parseResolutionFromFile(filePath);
if (!resolution) {
  report.errors.push(`Failed to parse resolution from ${filePath}`);
  continue;
}
// CP-T025: emit escalation_processed after resolution is successfully parsed
getStaffEventEmitter().emit({
  staffComponent: 'Archivist',
  actionType: 'escalation_processed',
  agentId: 'archivist',
  source: 'internal',
  entityType: resolution.entityType ?? null,
  entityId: resolution.entityId ?? null,
  key: resolution.key ?? null,
  reason: `Resolution parsed from escalation file: ${path.basename(filePath)}`,
  level: 'audit',
  metadata: {
    escalationId: path.basename(filePath),
    winnerSource: resolution.winnerSource ?? null,
  },
});
// Apply resolution to knowledge_base...
await applyResolution(tx, resolution);
```

**Ambiguity note**: The compiled output shows `processEscalationFile()` reads escalation
files from `~/.iranti/escalations/` using `fs.readFile`. The parsed resolution object shape
(named `resolution` above) is inferred — field names like `resolution.entityType`,
`resolution.winnerSource` must be confirmed against the TypeScript source. The
`escalation_processed` event fires after the file is read and parsed successfully, before
the resolved value is written back to the knowledge base.

---

## Injection Point 4 — `resolution_consumed`

**Function**: `processEscalationFile()` (internal — second injection in same function)
**Trigger**: After the archive row's `resolutionState` is set to `'resolved'`. The Archivist has marked the archived entry as resolved in the database.
**Event level**: `audit`

```typescript
// BEFORE
await prisma.archiveEntry.update({
  where: { id: archivedEntry.id },
  data: { resolutionState: 'resolved', resolvedAt: new Date() },
});
report.escalationsProcessed += 1;

// AFTER
await prisma.archiveEntry.update({
  where: { id: archivedEntry.id },
  data: { resolutionState: 'resolved', resolvedAt: new Date() },
});
// CP-T025: emit resolution_consumed after archive row is updated to resolved
getStaffEventEmitter().emit({
  staffComponent: 'Archivist',
  actionType: 'resolution_consumed',
  agentId: 'archivist',
  source: 'internal',
  entityType: archivedEntry.entityType ?? null,
  entityId: archivedEntry.entityId ?? null,
  key: archivedEntry.key ?? null,
  reason: `Archive row ${archivedEntry.id} marked resolved.`,
  level: 'audit',
  metadata: {
    escalationId: path.basename(filePath),
    archivedFactId: String(archivedEntry.id),
    resolutionState: 'resolved',
  },
});
report.escalationsProcessed += 1;
```

**Ambiguity note**: In the compiled output, `processEscalationFile()` queries the archive
table to find the row corresponding to the escalation and then updates it. The variable name
`archivedEntry` is a placeholder — the actual query and variable names must be confirmed.
The Prisma model for the archive table may be `prisma.archive` rather than
`prisma.archiveEntry`. This injection is the second in `processEscalationFile()` — both
`escalation_processed` and `resolution_consumed` are emitted from this function.

---

## Injection Point 5 — `archive_scan_completed`

**Function**: `runArchivist()` (top-level export)
**Trigger**: After the full maintenance cycle completes — all expired entries processed, all decay entries processed, all escalation files processed.
**Event level**: `debug`

```typescript
// BEFORE
await archiveExpired(tx, report);
await applyMemoryDecay(tx, report);
await processEscalationFiles(tx, report);
return report;

// AFTER
await archiveExpired(tx, report);
await applyMemoryDecay(tx, report);
await processEscalationFiles(tx, report);
// CP-T025: emit archive_scan_completed after full cycle
getStaffEventEmitter().emit({
  staffComponent: 'Archivist',
  actionType: 'archive_scan_completed',
  agentId: 'archivist',
  source: 'internal',
  reason: null,
  level: 'debug',
  metadata: {
    expiredArchived: report.expiredArchived,
    lowConfidenceArchived: report.lowConfidenceArchived,
    escalationsProcessed: report.escalationsProcessed,
    errors: report.errors.length,
    entriesScanned: report.expiredArchived + report.lowConfidenceArchived,
  },
});
return report;
```

**Ambiguity note**: The compiled output shows `runArchivist()` returns an `ArchivistReport`
object. The field names (`expiredArchived`, `lowConfidenceArchived`, `escalationsProcessed`,
`errors`) are inferred from the compiled output. The actual names in the TypeScript source
may differ (e.g. `archivedCount`, `decayedCount`). The `archive_scan_completed` event is a
cycle-level summary — it fires once per `runArchivist()` call regardless of how many entries
were processed.

---

## Summary of Changes to `src/archivist/index.ts`

| Change | Location |
|---|---|
| Add import for `getStaffEventEmitter` | Top of file |
| Insert `entry_archived` emit | Inside `archiveExpired()` loop, after each `archiveEntry()` call |
| Insert `entry_decayed` emit | Inside `applyMemoryDecay()` loop, after each `archiveEntry()` call |
| Insert `escalation_processed` emit | Inside `processEscalationFile()`, after resolution is parsed |
| Insert `resolution_consumed` emit | Inside `processEscalationFile()`, after archive row `resolutionState` update |
| Insert `archive_scan_completed` emit | In `runArchivist()`, after all maintenance functions complete, before `return report` |
