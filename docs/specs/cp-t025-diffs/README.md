# CP-T025 Upstream Diff Artifacts

**Produced by**: system_architect
**Date**: 2026-03-21
**Target repository**: iranti (upstream core package)
**Base branch**: main

---

## PR Title

```
feat: add IStaffEventEmitter injection for observability integrations
```

---

## PR Description (abridged)

This PR introduces a structured, opt-in event emitter interface (`IStaffEventEmitter`) into the Iranti core package. It instruments all four Staff components — Librarian, Attendant, Archivist, and Resolutionist — to emit discrete, typed events at every meaningful decision point. The default implementation is a zero-overhead no-op, so the change is fully backward-compatible with all existing deployments.

Operators who have built, or intend to build, an observability layer (such as the Iranti Control Plane) can supply a concrete emitter implementation by passing it through the `IrantiConfig` object at SDK construction time:

```typescript
new Iranti({ staffEventEmitter: new DbStaffEventEmitter(pool) })
```

No Staff component behavior changes. No new return values. No new error paths. The emitter is a pure, non-blocking side-channel.

**Design principles:**
- Non-invasive: emit() is fire-and-forget; the Staff component never awaits it.
- Synchronous interface, async delivery: implementations handle DB writes and NOTIFY internally.
- Backward-compatible: omit `staffEventEmitter` and the no-op is used automatically.
- No upstream package dependency on the `staff_events` table — that is a consumer (control plane) concern.

For the full PR description, see `docs/specs/cp-t025-upstream-pr.md`.

---

## Diff Files

### New files (2)

| Diff file | Upstream path | Description |
|---|---|---|
| `src-lib-staffEventEmitter.ts.diff` | `src/lib/staffEventEmitter.ts` | Defines `IStaffEventEmitter`, `NoopEventEmitter`, `StaffEvent`, `StaffEventInput`, `buildStaffEvent` |
| `src-lib-staffEventRegistry.ts.diff` | `src/lib/staffEventRegistry.ts` | Module-level singleton: `setStaffEventEmitter`, `getStaffEventEmitter`, `resetStaffEventEmitter` |

### Modified files (5)

| Diff file | Upstream path | Staff component | Events added |
|---|---|---|---|
| `src-librarian-index.ts.diff` | `src/librarian/index.ts` | Librarian | `write_created`, `write_replaced`, `write_escalated`, `write_rejected` (×2 sites), `write_deduplicated`, `conflict_detected` |
| `src-attendant-AttendantInstance.ts.diff` | `src/attendant/AttendantInstance.ts` | Attendant | `handshake_completed`, `reconvene_completed`, `attend_completed`, `observe_completed`, `session_expired` |
| `src-archivist-index.ts.diff` | `src/archivist/index.ts` | Archivist | `entry_archived`, `entry_decayed`, `escalation_processed`, `resolution_consumed`, `archive_scan_completed` |
| `src-resolutionist-index.ts.diff` | `src/resolutionist/index.ts` | Resolutionist | `resolution_filed`, `escalation_deferred` |
| `src-sdk-index.ts.diff` | `src/sdk/index.ts` | SDK | Adds `staffEventEmitter?` to `IrantiConfig`; calls `setStaffEventEmitter` in constructor; re-exports public types |

---

## Event Inventory by Component

### Librarian — `src/librarian/index.ts`

| Action type | Level | Injection site | Payload highlights |
|---|---|---|---|
| `write_deduplicated` | debug | Receipt check path — before early return | `requestId` in metadata |
| `write_created` | audit | After `createEntry()` succeeds for new entry | `confidence`, `valuePreview` |
| `conflict_detected` | debug | Before `resolveConflict()` is called | `existingConfidence`, `incomingConfidence` |
| `write_replaced` | audit | In `resolveConflict()`, after `replaceEntry()` succeeds | `confidence`, `priorConfidence`, `valuePreview` |
| `write_rejected` | audit | In `resolveConflict()`, confidence-based rejection | `rejectionReason` |
| `write_escalated` | audit | In `escalateConflict()`, after file write succeeds | `escalationId`, `conflictReason` |
| `write_rejected` | audit | In `resolveConflict()`, protected entry rejection | `rejectionReason` |

**Total Librarian emit() calls: 7** (across 6 action types — `write_rejected` fires from 2 sites)

### Attendant — `src/attendant/AttendantInstance.ts`

| Action type | Level | Injection site |
|---|---|---|
| `handshake_completed` | debug | End of `handshake()`, after brief built |
| `reconvene_completed` | audit | End of `reconvene()`, after brief rebuilt |
| `attend_completed` | debug | End of `attend()`, after result returned |
| `observe_completed` | debug | End of `observe()`, after result returned |
| `session_expired` | audit | In `onContextLow()`, after `archiveSession()` |

**Total Attendant emit() calls: 5**

### Archivist — `src/archivist/index.ts`

| Action type | Level | Injection site |
|---|---|---|
| `entry_archived` | audit | In `archiveExpired()` loop, after each `archiveEntry()` |
| `entry_decayed` | audit | In `applyMemoryDecay()` loop, after each decay `archiveEntry()` |
| `escalation_processed` | audit | In `processEscalationFile()`, after resolution parsed from file |
| `resolution_consumed` | audit | In `processEscalationFile()`, after `archive.update({ resolutionState: 'resolved' })` |
| `archive_scan_completed` | debug | After `runArchivist()` full cycle completes |

**Total Archivist emit() calls: 5** (note: `entry_archived` and `entry_decayed` fire once per entry per cycle — the count above is per loop iteration, not total per run)

### Resolutionist — `src/resolutionist/index.ts`

| Action type | Level | Injection site |
|---|---|---|
| `escalation_deferred` | audit | Before `skipped++` when operator skips an escalation |
| `resolution_filed` | audit | After `writeFile(filePath, resolvedContent)` succeeds |

**Total Resolutionist emit() calls: 2**

---

## Total emit() Call Sites Across All Components

| Component | Call sites |
|---|---|
| Librarian | 7 |
| Attendant | 5 |
| Archivist | 5 (×N per maintenance cycle) |
| Resolutionist | 2 |
| **Total** | **19** |

---

## Ambiguities and Resolutions

### 1. `write_rejected` fires from multiple sites

**Ambiguity**: The spec notes "5+ rejection sites" in the Librarian, but does not enumerate all of them explicitly. The compiled output was not directly inspectable for an exact count.

**Resolution**: This diff shows two representative rejection sites — the confidence-based rejection path and the protected-entry rejection path — as the canonical examples. Both emit identical payloads with `rejectionReason` populated from the local reason string. The same pattern should be applied to any additional rejection return sites the upstream maintainer identifies when applying the diff. The diff is annotated to make this clear.

### 2. `source` field in Attendant events

**Ambiguity**: `AttendantInstance` does not receive the originating call surface (MCP vs CLI vs API) as a constructor or method parameter in the current implementation.

**Resolution**: All Attendant events use `source: 'internal'` with an inline comment: `// Source not threaded to AttendantInstance in this PR; follow-up required`. This matches the spec's explicit guidance and is documented as a known limitation in `cp-t025-upstream-pr.md` (Note 1).

### 3. `conflict_detected` inclusion

**Ambiguity**: The injection point table in `cp-t025-upstream-pr.md` lists 18 rows covering 18 event types. The emitter design spec (§3.1) lists `conflict_detected` as a 6th Librarian event type (level: `debug`). The upstream PR description's "Changes" section lists only 5 Librarian events (`write_created`, `write_replaced`, `write_escalated`, `write_rejected`, `write_deduplicated`), omitting `conflict_detected`.

**Resolution**: `conflict_detected` is included in the Librarian diff because it appears explicitly in the spec's injection point table (§3.1) with a clear injection site ("before `resolveConflict()` call"). It costs one additional emit() call and has no behavioral side effects. If the upstream maintainer disagrees, it can be removed without affecting any other injection point.

### 4. `brief_empty` Attendant event

**Ambiguity**: The spec's Attendant table (§3.2) includes a `brief_empty` event ("When `buildWorkingMemory` returns zero facts") at level `debug`. The upstream PR description's "Changes" section omits it from the listed events.

**Resolution**: `brief_empty` is not included in the diff for `AttendantInstance.ts`. The injection point requires detecting an empty result from `buildWorkingMemory` — this is a conditional check that would need to be added inside `handshake()` or `attend()`. Including it would make the diff more invasive without a clear spec mandate (it was not in the PR description's event list). This is documented here so the upstream maintainer can add it if desired. It can be a follow-up.

### 5. Ordering of `escalation_deferred` vs `skipped++`

**Ambiguity**: The spec says "before `skipped++`". This means the emit() call fires even if the emit() itself somehow threw — but since implementations must not throw, ordering is consistent.

**Resolution**: The diff places the `emit()` call immediately before `skipped++` and `continue`, matching the spec exactly.

---

## Notes on Test Files

The upstream PR should also include test files for each component. These are specified in `cp-t025-upstream-pr.md` (Testing section) and `cp-t025-emitter-design.md` (§4). The test file diffs are not produced here because they depend on the upstream Iranti test infrastructure (Jest configuration, DB mock setup). The spec fully describes the test pattern; the upstream maintainer or system_architect can produce the test files once the source changes are confirmed.

Test files to add upstream:
- `src/librarian/__tests__/emitter.test.ts`
- `src/attendant/__tests__/emitter.test.ts`
- `src/archivist/__tests__/emitter.test.ts`
- `src/resolutionist/__tests__/emitter.test.ts`

---

## Diff Naming Convention

Diff file names use `src-` prefix with path separators replaced by `-` and `.ts` extension preserved before `.diff`. This avoids filesystem issues with deeply nested paths while remaining unambiguous about the upstream target.

| Diff filename | Upstream target path |
|---|---|
| `src-lib-staffEventEmitter.ts.diff` | `src/lib/staffEventEmitter.ts` |
| `src-lib-staffEventRegistry.ts.diff` | `src/lib/staffEventRegistry.ts` |
| `src-librarian-index.ts.diff` | `src/librarian/index.ts` |
| `src-attendant-AttendantInstance.ts.diff` | `src/attendant/AttendantInstance.ts` |
| `src-archivist-index.ts.diff` | `src/archivist/index.ts` |
| `src-resolutionist-index.ts.diff` | `src/resolutionist/index.ts` |
| `src-sdk-index.ts.diff` | `src/sdk/index.ts` |
