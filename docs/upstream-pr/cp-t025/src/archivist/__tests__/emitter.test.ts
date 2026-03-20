// src/archivist/__tests__/emitter.test.ts
// CP-T025 — upstream PR test file
//
// Unit tests confirming that the Archivist emits the correct StaffEvents
// at each of its 5 injection points.
//
// Test strategy:
//   - Uses RecordingEmitter to capture emit() calls.
//   - Mocks the DB layer and file system so no live database or filesystem is required.
//   - Calls setStaffEventEmitter(recorder) before each test.
//   - Calls resetStaffEventEmitter() in afterEach to isolate tests.
//
// The Archivist is a scheduled batch function (runArchivist). Tests construct
// controlled DB mock responses that drive each code path.

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

  callsOfType(actionType: string): StaffEventInput[] {
    return this.calls.filter((c) => c.actionType === actionType);
  }

  callOfType(actionType: string): StaffEventInput | undefined {
    return this.calls.find((c) => c.actionType === actionType);
  }
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockExpiredEntry = {
  id: 10,
  entityType: 'agent',
  entityId: 'agent_a',
  key: 'session/goal',
  value: 'Complete the task',
  confidence: 0.75,
  createdBy: 'agent_a',
  source: 'mcp',
  validUntil: new Date('2025-01-01T00:00:00.000Z'), // in the past
  isProtected: false,
  createdAt: new Date('2024-12-01T00:00:00.000Z'),
};

const mockDecayEntry = {
  id: 20,
  entityType: 'project',
  entityId: 'proj_x',
  key: 'status/health',
  value: 'good',
  confidence: 0.15, // below decay threshold
  createdBy: 'agent_b',
  source: 'api',
  validUntil: null,
  isProtected: false,
  createdAt: new Date('2024-11-01T00:00:00.000Z'),
};

const mockEscalationFile = {
  filename: 'escalation-2026-01-15T10-00-00-000Z-abcdef.md',
  filePath: '/home/user/.iranti/escalations/escalation-2026-01-15T10-00-00-000Z-abcdef.md',
  entityType: 'agent',
  entityId: 'agent_a',
  key: 'preference/tool',
  existingValue: 'bash',
  challengerValue: 'python',
  winnerSource: 'existing',
  resolvedContent: `---
ESCALATION STATUS: RESOLVED
AUTHORITATIVE_JSON: "bash"
---`,
};

const mockArchivedRow = {
  id: 30,
  entityType: mockEscalationFile.entityType,
  entityId: mockEscalationFile.entityId,
  key: mockEscalationFile.key,
  resolutionState: null,
  archivedAt: new Date('2026-01-10T00:00:00.000Z'),
};

jest.mock('../../db', () => ({
  prisma: {
    knowledgeEntry: {
      findMany: jest.fn(),
    },
    archiveEntry: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn(),
    },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        knowledgeEntry: {
          findMany: jest.fn(),
          delete: jest.fn().mockResolvedValue({}),
        },
        archiveEntry: {
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
          findFirst: jest.fn(),
        },
      })
    ),
  },
}));

jest.mock('fs/promises', () => ({
  readdir: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('path', () => ({
  ...jest.requireActual('path'),
  join: jest.fn((...args: string[]) => args.join('/')),
  basename: jest.fn((p: string) => p.split('/').pop() ?? p),
}));

// Import the module under test AFTER mocks are set up.
import { runArchivist } from '../index';
import { prisma } from '../../db';
import * as fsMock from 'fs/promises';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Archivist — emitter injection', () => {
  let recorder: RecordingEmitter;

  beforeEach(() => {
    recorder = new RecordingEmitter();
    setStaffEventEmitter(recorder);
    jest.clearAllMocks();
  });

  afterEach(() => {
    resetStaffEventEmitter();
  });

  // ── entry_archived ─────────────────────────────────────────────────────────

  it('emits entry_archived for each expired entry that is archived', async () => {
    // Two expired entries
    (prisma.knowledgeEntry.findMany as jest.Mock)
      .mockResolvedValueOnce([mockExpiredEntry, { ...mockExpiredEntry, id: 11, entityId: 'agent_b' }]) // expired
      .mockResolvedValueOnce([]) // low confidence (none)
      .mockResolvedValueOnce([]); // any additional queries
    (fsMock.readdir as jest.Mock).mockResolvedValue([]); // no escalation files

    await runArchivist();

    const archivedEvents = recorder.callsOfType('entry_archived');
    expect(archivedEvents).toHaveLength(2);

    const firstEvent = archivedEvents[0];
    expect(firstEvent.staffComponent).toBe('Archivist');
    expect(firstEvent.actionType).toBe('entry_archived');
    expect(firstEvent.agentId).toBe('archivist');
    expect(firstEvent.source).toBe('internal');
    expect(firstEvent.level).toBe('audit');
    expect(firstEvent.entityType).toBe(mockExpiredEntry.entityType);
    expect(firstEvent.entityId).toBe(mockExpiredEntry.entityId);
    expect(firstEvent.key).toBe(mockExpiredEntry.key);
    expect(firstEvent.metadata).toMatchObject({
      archivedReason: 'expired',
      archivedFactId: String(mockExpiredEntry.id),
    });
  });

  // ── entry_decayed ──────────────────────────────────────────────────────────

  it('emits entry_decayed for each low-confidence entry archived by decay', async () => {
    (prisma.knowledgeEntry.findMany as jest.Mock)
      .mockResolvedValueOnce([]) // no expired entries
      .mockResolvedValueOnce([mockDecayEntry]); // one decayed entry
    (fsMock.readdir as jest.Mock).mockResolvedValue([]);

    await runArchivist();

    const decayedEvents = recorder.callsOfType('entry_decayed');
    expect(decayedEvents).toHaveLength(1);

    const event = decayedEvents[0];
    expect(event.staffComponent).toBe('Archivist');
    expect(event.actionType).toBe('entry_decayed');
    expect(event.agentId).toBe('archivist');
    expect(event.source).toBe('internal');
    expect(event.level).toBe('audit');
    expect(event.entityType).toBe(mockDecayEntry.entityType);
    expect(event.entityId).toBe(mockDecayEntry.entityId);
    expect(event.key).toBe(mockDecayEntry.key);
    expect(event.metadata).toMatchObject({
      archivedReason: 'decay',
      archivedFactId: String(mockDecayEntry.id),
    });
  });

  // ── escalation_processed ───────────────────────────────────────────────────

  it('emits escalation_processed when an escalation file is consumed', async () => {
    (prisma.knowledgeEntry.findMany as jest.Mock)
      .mockResolvedValue([]); // no expired or decayed entries
    (fsMock.readdir as jest.Mock).mockResolvedValue([mockEscalationFile.filename]);
    (fsMock.readFile as jest.Mock).mockResolvedValue(mockEscalationFile.resolvedContent);
    (prisma.archiveEntry.findFirst as jest.Mock).mockResolvedValue(mockArchivedRow);

    await runArchivist();

    const event = recorder.callOfType('escalation_processed');
    expect(event).toBeDefined();
    expect(event!.staffComponent).toBe('Archivist');
    expect(event!.actionType).toBe('escalation_processed');
    expect(event!.agentId).toBe('archivist');
    expect(event!.source).toBe('internal');
    expect(event!.level).toBe('audit');
    expect(event!.metadata).toMatchObject({
      escalationId: mockEscalationFile.filename,
    });
  });

  // ── resolution_consumed ────────────────────────────────────────────────────

  it('emits resolution_consumed after the archive row is marked resolved', async () => {
    (prisma.knowledgeEntry.findMany as jest.Mock).mockResolvedValue([]);
    (fsMock.readdir as jest.Mock).mockResolvedValue([mockEscalationFile.filename]);
    (fsMock.readFile as jest.Mock).mockResolvedValue(mockEscalationFile.resolvedContent);
    (prisma.archiveEntry.findFirst as jest.Mock).mockResolvedValue(mockArchivedRow);
    (prisma.archiveEntry.update as jest.Mock).mockResolvedValue({
      ...mockArchivedRow,
      resolutionState: 'resolved',
    });

    await runArchivist();

    const event = recorder.callOfType('resolution_consumed');
    expect(event).toBeDefined();
    expect(event!.staffComponent).toBe('Archivist');
    expect(event!.actionType).toBe('resolution_consumed');
    expect(event!.agentId).toBe('archivist');
    expect(event!.source).toBe('internal');
    expect(event!.level).toBe('audit');
    expect(event!.metadata).toMatchObject({
      archivedFactId: String(mockArchivedRow.id),
      resolutionState: 'resolved',
    });
  });

  // ── archive_scan_completed ─────────────────────────────────────────────────

  it('emits archive_scan_completed exactly once after the full cycle', async () => {
    // Two expired, one decayed, one escalation processed
    (prisma.knowledgeEntry.findMany as jest.Mock)
      .mockResolvedValueOnce([mockExpiredEntry, { ...mockExpiredEntry, id: 11 }]) // expired
      .mockResolvedValueOnce([mockDecayEntry]); // decayed
    (fsMock.readdir as jest.Mock).mockResolvedValue([mockEscalationFile.filename]);
    (fsMock.readFile as jest.Mock).mockResolvedValue(mockEscalationFile.resolvedContent);
    (prisma.archiveEntry.findFirst as jest.Mock).mockResolvedValue(mockArchivedRow);

    await runArchivist();

    const completedEvents = recorder.callsOfType('archive_scan_completed');
    expect(completedEvents).toHaveLength(1);

    const event = completedEvents[0];
    expect(event.staffComponent).toBe('Archivist');
    expect(event.actionType).toBe('archive_scan_completed');
    expect(event.agentId).toBe('archivist');
    expect(event.source).toBe('internal');
    expect(event.level).toBe('debug');
    expect(event.metadata).toMatchObject({
      expiredArchived: 2,
      lowConfidenceArchived: 1,
      escalationsProcessed: 1,
      errors: expect.any(Number),
    });
  });

  it('archive_scan_completed reports zero counts when nothing to archive', async () => {
    (prisma.knowledgeEntry.findMany as jest.Mock).mockResolvedValue([]);
    (fsMock.readdir as jest.Mock).mockResolvedValue([]);

    await runArchivist();

    const event = recorder.callOfType('archive_scan_completed');
    expect(event).toBeDefined();
    expect(event!.metadata).toMatchObject({
      expiredArchived: 0,
      lowConfidenceArchived: 0,
      escalationsProcessed: 0,
    });
  });

  // ── per-entry metadata fields ──────────────────────────────────────────────

  it('entry_archived metadata includes archivedReason and archivedFactId', async () => {
    (prisma.knowledgeEntry.findMany as jest.Mock)
      .mockResolvedValueOnce([mockExpiredEntry])
      .mockResolvedValueOnce([]);
    (fsMock.readdir as jest.Mock).mockResolvedValue([]);

    await runArchivist();

    const event = recorder.callOfType('entry_archived');
    expect(event!.metadata!.archivedReason).toBe('expired');
    expect(event!.metadata!.archivedFactId).toBe(String(mockExpiredEntry.id));
  });

  it('entry_decayed metadata includes archivedReason, archivedFactId, and decayPolicy', async () => {
    (prisma.knowledgeEntry.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([mockDecayEntry]);
    (fsMock.readdir as jest.Mock).mockResolvedValue([]);

    await runArchivist();

    const event = recorder.callOfType('entry_decayed');
    expect(event!.metadata!.archivedReason).toBe('decay');
    expect(event!.metadata!.archivedFactId).toBe(String(mockDecayEntry.id));
    expect(event!.metadata!.decayPolicy).toBe('confidence_threshold');
  });
});
