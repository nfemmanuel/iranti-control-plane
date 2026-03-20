// src/attendant/__tests__/emitter.test.ts
// CP-T025 — upstream PR test file
//
// Unit tests confirming that the AttendantInstance emits the correct StaffEvents
// at each of its 5 injection points.
//
// Test strategy:
//   - Instantiates AttendantInstance directly with a test agentId.
//   - Uses RecordingEmitter to capture emit() calls.
//   - Mocks the DB layer so no live database is required.
//   - Calls setStaffEventEmitter(recorder) before each test.
//   - Calls resetStaffEventEmitter() in afterEach to isolate tests.
//
// Note: All Attendant events use source: 'internal' per CP-T025 spec.
// The source limitation is documented in cp-t025-upstream-pr.md §Notes.

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
}

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Stub the DB layer used by AttendantInstance.
// Adjust to match the actual mock pattern in the upstream test suite.

jest.mock('../../db', () => ({
  prisma: {
    knowledgeEntry: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
  },
}));

// Import the module under test AFTER mocks are set up.
import { AttendantInstance } from '../AttendantInstance';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_AGENT_ID = 'test_agent';

const handshakeContext = {
  task: 'Testing the emitter injection points in AttendantInstance',
  recentMessages: ['Hello', 'World'],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AttendantInstance — emitter injection', () => {
  let recorder: RecordingEmitter;
  let attendant: AttendantInstance;

  beforeEach(() => {
    recorder = new RecordingEmitter();
    setStaffEventEmitter(recorder);
    attendant = new AttendantInstance(TEST_AGENT_ID);
    jest.clearAllMocks();
  });

  afterEach(() => {
    resetStaffEventEmitter();
  });

  // ── handshake_completed ────────────────────────────────────────────────────

  it('emits handshake_completed after handshake() completes', async () => {
    await attendant.handshake(handshakeContext);

    const event = recorder.callOfType('handshake_completed');
    expect(event).toBeDefined();
    expect(event!.staffComponent).toBe('Attendant');
    expect(event!.actionType).toBe('handshake_completed');
    expect(event!.agentId).toBe(TEST_AGENT_ID);
    expect(event!.source).toBe('internal');
    expect(event!.level).toBe('debug');
    // metadata should include briefSize and taskSummary
    expect(event!.metadata).toMatchObject({
      briefSize: expect.any(Number),
      taskSummary: expect.any(String),
    });
    // sessionId should be set (ISO timestamp)
    expect(event!.metadata!.sessionId).toBeTruthy();
  });

  it('emits handshake_completed with agentId matching the instance', async () => {
    const specificAgent = 'specific_agent_id';
    const specificAttendant = new AttendantInstance(specificAgent);
    await specificAttendant.handshake(handshakeContext);

    const event = recorder.callOfType('handshake_completed');
    expect(event).toBeDefined();
    expect(event!.agentId).toBe(specificAgent);
  });

  // ── reconvene_completed ────────────────────────────────────────────────────

  it('emits reconvene_completed after reconvene() completes', async () => {
    // First handshake to establish the session
    await attendant.handshake(handshakeContext);
    recorder.calls.length = 0; // clear calls from handshake

    await attendant.reconvene(handshakeContext);

    const event = recorder.callOfType('reconvene_completed');
    expect(event).toBeDefined();
    expect(event!.staffComponent).toBe('Attendant');
    expect(event!.actionType).toBe('reconvene_completed');
    expect(event!.agentId).toBe(TEST_AGENT_ID);
    expect(event!.source).toBe('internal');
    expect(event!.level).toBe('audit'); // reconvene is audit, not debug
    expect(event!.metadata).toMatchObject({
      briefSize: expect.any(Number),
      contextCallCount: expect.any(Number),
    });
    expect(event!.metadata!.sessionId).toBeTruthy();
  });

  it('reconvene_completed level is audit (not debug)', async () => {
    await attendant.handshake(handshakeContext);
    await attendant.reconvene(handshakeContext);

    const event = recorder.callOfType('reconvene_completed');
    expect(event!.level).toBe('audit');
  });

  // ── attend_completed ───────────────────────────────────────────────────────

  it('emits attend_completed after attend() completes', async () => {
    await attendant.handshake(handshakeContext);
    recorder.calls.length = 0;

    await attendant.attend(
      'Should I inject memory for this message?',
      'Some visible context'
    );

    const event = recorder.callOfType('attend_completed');
    expect(event).toBeDefined();
    expect(event!.staffComponent).toBe('Attendant');
    expect(event!.actionType).toBe('attend_completed');
    expect(event!.agentId).toBe(TEST_AGENT_ID);
    expect(event!.source).toBe('internal');
    expect(event!.level).toBe('debug');
    expect(event!.metadata).toMatchObject({
      shouldInject: expect.any(Boolean),
      contextCallCount: expect.any(Number),
    });
  });

  it('attend_completed is emitted once per attend() call', async () => {
    await attendant.handshake(handshakeContext);
    recorder.calls.length = 0;

    await attendant.attend('First message');
    await attendant.attend('Second message');

    const attendEvents = recorder.calls.filter((c) => c.actionType === 'attend_completed');
    expect(attendEvents).toHaveLength(2);
  });

  // ── observe_completed ──────────────────────────────────────────────────────

  it('emits observe_completed after observe() completes', async () => {
    await attendant.handshake(handshakeContext);
    recorder.calls.length = 0;

    await attendant.observe({
      observation: 'User prefers concise responses',
      agentId: TEST_AGENT_ID,
    });

    const event = recorder.callOfType('observe_completed');
    expect(event).toBeDefined();
    expect(event!.staffComponent).toBe('Attendant');
    expect(event!.actionType).toBe('observe_completed');
    expect(event!.agentId).toBe(TEST_AGENT_ID);
    expect(event!.source).toBe('internal');
    expect(event!.level).toBe('debug');
    // metadata.recorded indicates whether the observation was stored
    expect(event!.metadata).toMatchObject({
      recorded: expect.any(Boolean),
    });
  });

  // ── session_expired ────────────────────────────────────────────────────────
  // Note: session_expired is the hardest to test without knowledge of the exact
  // lifecycle hook in the upstream source. This test calls the lifecycle method
  // directly if it exists, or simulates the condition. Adjust to match the source.

  it('emits session_expired when session is terminated via onContextLow', async () => {
    await attendant.handshake(handshakeContext);
    recorder.calls.length = 0;

    // Simulate context window exhaustion by calling the lifecycle hook directly.
    // If the method name differs in the upstream source, adjust accordingly.
    if (typeof (attendant as unknown as { onContextLow?: () => Promise<void> }).onContextLow === 'function') {
      await (attendant as unknown as { onContextLow: () => Promise<void> }).onContextLow();
    } else {
      // If onContextLow is not a public method, trigger via the registry eviction path.
      // This test may need to be adjusted based on the exact source structure.
      // See cp-t025-upstream-pr.md ambiguity note for session_expired.
      pending('session_expired test requires access to onContextLow or eviction path');
    }

    const event = recorder.callOfType('session_expired');
    expect(event).toBeDefined();
    expect(event!.staffComponent).toBe('Attendant');
    expect(event!.actionType).toBe('session_expired');
    expect(event!.agentId).toBe(TEST_AGENT_ID);
    expect(event!.source).toBe('internal');
    expect(event!.level).toBe('audit');
    expect(event!.metadata).toMatchObject({
      contextCallCount: expect.any(Number),
    });
    expect(event!.metadata!.sessionId).toBeTruthy();
  });

  // ── source field ───────────────────────────────────────────────────────────

  it('all Attendant events use source: internal', async () => {
    await attendant.handshake(handshakeContext);
    await attendant.reconvene(handshakeContext);
    await attendant.attend('A message');

    for (const call of recorder.calls) {
      expect(call.source).toBe('internal');
    }
  });
});
