// src/resolutionist/__tests__/emitter.test.ts
// CP-T025 — upstream PR test file
//
// Unit tests confirming that the Resolutionist emits the correct StaffEvents
// at each of its 2 injection points.
//
// Test strategy:
//   - Uses RecordingEmitter to capture emit() calls.
//   - Mocks the filesystem and readline interface (resolveInteractive is CLI-driven).
//   - Calls setStaffEventEmitter(recorder) before each test.
//   - Calls resetStaffEventEmitter() in afterEach to isolate tests.
//
// Testing resolveInteractive() requires simulating readline user input. The
// approach here uses jest.mock for readline and a helper that drives the
// question/answer cycle. Adjust to match the upstream readline usage pattern.

import {
  IStaffEventEmitter,
  StaffEventInput,
} from '../../lib/staffEventEmitter';
import {
  setStaffEventEmitter,
  resetStaffEventEmitter,
} from '../../lib/staffEventRegistry';

// ─── RecordingEmitter ─────────────────────────────────────────────────────────

class RecordingEmitter implements IStaffEventEmitter {
  readonly calls: StaffEventInput[] = [];

  emit(event: StaffEventInput): void {
    this.calls.push(event);
  }

  callOfType(actionType: string): StaffEventInput | undefined {
    return this.calls.find((c) => c.actionType === actionType);
  }

  callsOfType(actionType: string): StaffEventInput[] {
    return this.calls.filter((c) => c.actionType === actionType);
  }
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Escalation file content with a pending resolution (not yet resolved)
const PENDING_ESCALATION_CONTENT = `---
escalation_id: escalation-2026-01-20-abc123
entity_type: agent
entity_id: agent_a
key: preference/output_format
---

## Conflict

**Existing value** (confidence: 0.80, source: mcp):
markdown

**Challenger value** (confidence: 0.78, source: api):
plain_text

## Instructions

Choose the authoritative value:
1. Keep existing: markdown
2. Use challenger: plain_text
3. Skip for now

---
ESCALATION STATUS: PENDING
`;

// Resolved content written by resolveInteractive after operator chooses option 1
const RESOLVED_ESCALATION_CONTENT = `---
escalation_id: escalation-2026-01-20-abc123
entity_type: agent
entity_id: agent_a
key: preference/output_format
---

## Conflict

**Existing value** (confidence: 0.80, source: mcp):
markdown

**Challenger value** (confidence: 0.78, source: api):
plain_text

---
ESCALATION STATUS: RESOLVED
AUTHORITATIVE_JSON: "markdown"
RESOLUTION_NOTE: Operator kept existing value.
`;

const ESCALATION_FILENAME = 'escalation-2026-01-20-abc123.md';
const ESCALATIONS_DIR = '/home/user/.iranti/escalations';

// Track readline answer sequences for different test scenarios
let readlineAnswerQueue: string[] = [];

jest.mock('readline', () => ({
  createInterface: jest.fn(() => ({
    question: jest.fn((_prompt: string, callback: (answer: string) => void) => {
      const answer = readlineAnswerQueue.shift() ?? 'skip';
      callback(answer);
    }),
    close: jest.fn(),
  })),
}));

jest.mock('fs/promises', () => ({
  readdir: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  access: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('path', () => ({
  ...jest.requireActual('path'),
  join: jest.fn((...args: string[]) => args.join('/')),
  basename: jest.fn((p: string) => p.split('/').pop() ?? p),
}));

// Import the module under test AFTER mocks are set up.
import { resolveInteractive } from '../index';
import * as fsMock from 'fs/promises';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Resolutionist — emitter injection', () => {
  let recorder: RecordingEmitter;

  beforeEach(() => {
    recorder = new RecordingEmitter();
    setStaffEventEmitter(recorder);
    jest.clearAllMocks();
    readlineAnswerQueue = [];
  });

  afterEach(() => {
    resetStaffEventEmitter();
  });

  // ── resolution_filed ───────────────────────────────────────────────────────

  it('emits resolution_filed after the operator files a resolution', async () => {
    // One escalation file; operator chooses option 1 (keep existing)
    (fsMock.readdir as jest.Mock).mockResolvedValue([ESCALATION_FILENAME]);
    (fsMock.readFile as jest.Mock).mockResolvedValue(PENDING_ESCALATION_CONTENT);
    (fsMock.writeFile as jest.Mock).mockResolvedValue(undefined);

    // Simulate operator typing "1" to select the first option (keep existing)
    readlineAnswerQueue = ['1'];

    await resolveInteractive({ escalationsDir: ESCALATIONS_DIR });

    const event = recorder.callOfType('resolution_filed');
    expect(event).toBeDefined();
    expect(event!.staffComponent).toBe('Resolutionist');
    expect(event!.actionType).toBe('resolution_filed');
    expect(event!.agentId).toBe('operator');
    expect(event!.source).toBe('cli');
    expect(event!.level).toBe('audit');
    // entityType, entityId, key should come from the escalation file
    expect(event!.entityType).toBe('agent');
    expect(event!.entityId).toBe('agent_a');
    expect(event!.key).toBe('preference/output_format');
    // reason should be non-empty
    expect(typeof event!.reason).toBe('string');
    expect(event!.reason!.length).toBeGreaterThan(0);
    // metadata must include escalationId
    expect(event!.metadata).toMatchObject({
      escalationId: ESCALATION_FILENAME,
    });
  });

  it('resolution_filed includes winnerSource in metadata', async () => {
    (fsMock.readdir as jest.Mock).mockResolvedValue([ESCALATION_FILENAME]);
    (fsMock.readFile as jest.Mock).mockResolvedValue(PENDING_ESCALATION_CONTENT);
    (fsMock.writeFile as jest.Mock).mockResolvedValue(undefined);

    readlineAnswerQueue = ['1']; // keep existing

    await resolveInteractive({ escalationsDir: ESCALATIONS_DIR });

    const event = recorder.callOfType('resolution_filed');
    expect(event).toBeDefined();
    // winnerSource should be 'existing' when operator chose option 1
    expect(event!.metadata!.winnerSource).toBe('existing');
  });

  it('resolution_filed is emitted for each resolved escalation in a batch', async () => {
    const file1 = 'escalation-2026-01-20-file1.md';
    const file2 = 'escalation-2026-01-20-file2.md';
    (fsMock.readdir as jest.Mock).mockResolvedValue([file1, file2]);
    (fsMock.readFile as jest.Mock).mockResolvedValue(PENDING_ESCALATION_CONTENT);
    (fsMock.writeFile as jest.Mock).mockResolvedValue(undefined);

    // Operator resolves both
    readlineAnswerQueue = ['1', '1'];

    await resolveInteractive({ escalationsDir: ESCALATIONS_DIR });

    const filedEvents = recorder.callsOfType('resolution_filed');
    expect(filedEvents).toHaveLength(2);
  });

  it('resolution_filed is NOT emitted if writeFile fails', async () => {
    (fsMock.readdir as jest.Mock).mockResolvedValue([ESCALATION_FILENAME]);
    (fsMock.readFile as jest.Mock).mockResolvedValue(PENDING_ESCALATION_CONTENT);
    // Simulate a writeFile failure
    (fsMock.writeFile as jest.Mock).mockRejectedValue(new Error('Disk full'));

    readlineAnswerQueue = ['1'];

    // resolveInteractive should handle the error gracefully (catch it and continue)
    await resolveInteractive({ escalationsDir: ESCALATIONS_DIR });

    // The event must NOT be emitted if the file write failed
    const event = recorder.callOfType('resolution_filed');
    expect(event).toBeUndefined();
  });

  // ── escalation_deferred ────────────────────────────────────────────────────

  it('emits escalation_deferred when operator skips an escalation', async () => {
    (fsMock.readdir as jest.Mock).mockResolvedValue([ESCALATION_FILENAME]);
    (fsMock.readFile as jest.Mock).mockResolvedValue(PENDING_ESCALATION_CONTENT);

    // Operator types "s" or "skip"
    readlineAnswerQueue = ['skip'];

    await resolveInteractive({ escalationsDir: ESCALATIONS_DIR });

    const event = recorder.callOfType('escalation_deferred');
    expect(event).toBeDefined();
    expect(event!.staffComponent).toBe('Resolutionist');
    expect(event!.actionType).toBe('escalation_deferred');
    expect(event!.agentId).toBe('operator');
    expect(event!.source).toBe('cli');
    expect(event!.level).toBe('audit');
    expect(event!.reason).toContain('skip');
    expect(event!.metadata).toMatchObject({
      escalationId: ESCALATION_FILENAME,
      deferralReason: 'operator_skip',
    });
  });

  it('emits escalation_deferred but NOT resolution_filed when operator skips', async () => {
    (fsMock.readdir as jest.Mock).mockResolvedValue([ESCALATION_FILENAME]);
    (fsMock.readFile as jest.Mock).mockResolvedValue(PENDING_ESCALATION_CONTENT);

    readlineAnswerQueue = ['skip'];

    await resolveInteractive({ escalationsDir: ESCALATIONS_DIR });

    expect(recorder.callOfType('escalation_deferred')).toBeDefined();
    expect(recorder.callOfType('resolution_filed')).toBeUndefined();
  });

  it('emits escalation_deferred once per skipped escalation', async () => {
    const file1 = 'escalation-2026-01-20-file1.md';
    const file2 = 'escalation-2026-01-20-file2.md';
    (fsMock.readdir as jest.Mock).mockResolvedValue([file1, file2]);
    (fsMock.readFile as jest.Mock).mockResolvedValue(PENDING_ESCALATION_CONTENT);

    // Skip both
    readlineAnswerQueue = ['skip', 'skip'];

    await resolveInteractive({ escalationsDir: ESCALATIONS_DIR });

    const deferredEvents = recorder.callsOfType('escalation_deferred');
    expect(deferredEvents).toHaveLength(2);
  });

  // ── mixed batch ────────────────────────────────────────────────────────────

  it('handles a batch with one resolved and one skipped escalation', async () => {
    const file1 = 'escalation-2026-01-20-file1.md';
    const file2 = 'escalation-2026-01-20-file2.md';
    (fsMock.readdir as jest.Mock).mockResolvedValue([file1, file2]);
    (fsMock.readFile as jest.Mock).mockResolvedValue(PENDING_ESCALATION_CONTENT);
    (fsMock.writeFile as jest.Mock).mockResolvedValue(undefined);

    // First: resolve. Second: skip.
    readlineAnswerQueue = ['1', 'skip'];

    await resolveInteractive({ escalationsDir: ESCALATIONS_DIR });

    expect(recorder.callsOfType('resolution_filed')).toHaveLength(1);
    expect(recorder.callsOfType('escalation_deferred')).toHaveLength(1);
  });

  // ── source and agentId fields ──────────────────────────────────────────────

  it('all Resolutionist events use agentId: operator and source: cli', async () => {
    (fsMock.readdir as jest.Mock).mockResolvedValue([ESCALATION_FILENAME]);
    (fsMock.readFile as jest.Mock).mockResolvedValue(PENDING_ESCALATION_CONTENT);
    (fsMock.writeFile as jest.Mock).mockResolvedValue(undefined);

    readlineAnswerQueue = ['1'];

    await resolveInteractive({ escalationsDir: ESCALATIONS_DIR });

    for (const call of recorder.calls) {
      expect(call.agentId).toBe('operator');
      expect(call.source).toBe('cli');
    }
  });

  // ── empty escalations directory ────────────────────────────────────────────

  it('emits no events when the escalations directory is empty', async () => {
    (fsMock.readdir as jest.Mock).mockResolvedValue([]);

    await resolveInteractive({ escalationsDir: ESCALATIONS_DIR });

    expect(recorder.calls).toHaveLength(0);
  });
});
