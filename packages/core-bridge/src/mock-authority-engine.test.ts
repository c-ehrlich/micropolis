import { describe, expect, it } from 'vitest';

import { MockAuthorityEngine } from './mock-authority-engine.ts';
import type {
  ClientCommandEnvelope,
  ClientRequestSnapshotEnvelope,
  HostAckEnvelope,
  HostErrorEnvelope,
  HostPatchEnvelope,
  HostRejectEnvelope,
  HostResyncEnvelope,
  HostSnapshotEnvelope,
} from './types.ts';
import { HOST_REJECT_CODE, HOST_REJECT_REASON } from './types.ts';

type SequencedMockEvent =
  | HostAckEnvelope
  | HostRejectEnvelope
  | HostPatchEnvelope
  | HostSnapshotEnvelope
  | HostResyncEnvelope
  | HostErrorEnvelope;

const makeCommand = (
  commandId: string,
  toolResultCode: number,
  commandType = 'tool.place',
): ClientCommandEnvelope => ({
  kind: 'command',
  roomId: 'room-a',
  clientId: 'client-a',
  commandId,
  command: {
    type: commandType,
    payload: {
      // Micropolis tool handlers in `ref/micropolis/src/sim/w_tool.c` use:
      //  1 => success, -1 => reject/out-of-bounds style failure, -2 => no funds.
      mockToolResultCode: toolResultCode,
    },
  },
});

const makeSnapshotRequest = (
  overrides: Partial<ClientRequestSnapshotEnvelope> = {},
): ClientRequestSnapshotEnvelope => ({
  kind: 'request_snapshot',
  roomId: 'room-a',
  clientId: 'client-a',
  ...overrides,
});

const recordScenario = (): SequencedMockEvent[] => {
  const engine = new MockAuthorityEngine({
    roomId: 'room-a',
    clientId: 'client-a',
  });

  const first = engine.processCommand(makeCommand('cmd-1', 1));
  const second = engine.processCommand(makeCommand('cmd-2', -2));
  const snapshot = engine.createSnapshot(makeSnapshotRequest());
  const resync = engine.requestResync('server-seq-gap');
  const error = engine.reportError('mock/internal', 'deterministic injected fault');

  return [...first.events, ...second.events, snapshot, resync, error];
};

describe('MockAuthorityEngine', () => {
  it('emits deterministic ordered events for fixed command inputs', () => {
    const firstRun = recordScenario();
    const secondRun = recordScenario();

    expect(firstRun).toEqual(secondRun);

    expect(firstRun.map((event) => event.kind)).toEqual([
      'ack',
      'patch',
      'reject',
      'snapshot',
      'resync',
      'error',
    ]);
    expect(firstRun.map((event) => event.serverSeq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(firstRun.map((event) => event.tick)).toEqual([1, 1, 1, 1, 1, 1]);

    const rejectEvent = firstRun[2];
    if (rejectEvent === undefined || rejectEvent.kind !== 'reject') {
      throw new Error('expected reject event at index 2');
    }

    expect(rejectEvent).toMatchObject({
      kind: 'reject',
      commandId: 'cmd-2',
      code: HOST_REJECT_CODE.TOOL_NO_FUNDS,
      reject: {
        reason: HOST_REJECT_REASON.INSUFFICIENT_FUNDS,
        pendingVisual: {
          action: 'rollback',
          commandId: 'cmd-2',
        },
      },
    });
  });

  it('keeps duplicate commandId handling idempotent (ack/reject replay without reapply)', () => {
    const engine = new MockAuthorityEngine({
      roomId: 'room-a',
      clientId: 'client-a',
    });

    const applied = engine.processCommand(makeCommand('dup-apply', 1));
    const duplicateApplied = engine.processCommand(makeCommand('dup-apply', 1));
    const rejected = engine.processCommand(makeCommand('dup-reject', -1));
    const duplicateRejected = engine.processCommand(makeCommand('dup-reject', -1));
    const snapshot = engine.createSnapshot(makeSnapshotRequest());

    expect(applied.duplicate).toBe(false);
    expect(applied.events.map((event) => event.kind)).toEqual(['ack', 'patch']);

    expect(duplicateApplied.duplicate).toBe(true);
    expect(duplicateApplied.events.map((event) => event.kind)).toEqual(['ack']);

    expect(rejected.duplicate).toBe(false);
    expect(rejected.events.map((event) => event.kind)).toEqual(['reject']);

    expect(duplicateRejected.duplicate).toBe(true);
    expect(duplicateRejected.events.map((event) => event.kind)).toEqual(['reject']);

    expect(
      [
        ...applied.events,
        ...duplicateApplied.events,
        ...rejected.events,
        ...duplicateRejected.events,
      ].map((event) => event.serverSeq),
    ).toEqual([0, 1, 2, 3, 4]);

    expect(snapshot.serverSeq).toBe(5);
    expect(snapshot.tick).toBe(1);
    expect(snapshot.snapshot).toEqual({
      type: 'mock.snapshot',
      payload: {
        appliedCommandCount: 1,
        lastAppliedCommandId: 'dup-apply',
      },
    });
  });

  it('replays patch tail by serverSeq and boots with snapshot when no replay cursor is provided', () => {
    const engine = new MockAuthorityEngine({
      roomId: 'room-a',
      clientId: 'client-a',
      snapshotCadenceTicks: 64,
    });

    engine.processCommand(makeCommand('cmd-1', 1));
    engine.processCommand(makeCommand('cmd-2', 1));
    engine.processCommand(makeCommand('cmd-3', 1));
    engine.processCommand(makeCommand('cmd-4', 1));

    const bootstrap = engine.handleSnapshotRequest(makeSnapshotRequest());
    expect(bootstrap.mode).toBe('snapshot');
    expect(bootstrap.events).toHaveLength(1);
    expect(bootstrap.events[0]?.kind).toBe('snapshot');

    const replay = engine.handleSnapshotRequest(makeSnapshotRequest({ afterServerSeq: 3 }));
    expect(replay.mode).toBe('patch-tail');
    expect(replay.events.map((event) => event.kind)).toEqual(['patch', 'patch']);
    expect(replay.events.map((event) => event.serverSeq)).toEqual([5, 7]);
  });

  it('emits resync when replay cursor is ahead or falls behind the retained patch tail', () => {
    const engine = new MockAuthorityEngine({
      roomId: 'room-a',
      clientId: 'client-a',
      snapshotCadenceTicks: 2,
    });

    engine.processCommand(makeCommand('cmd-1', 1));
    engine.processCommand(makeCommand('cmd-2', 1));
    engine.processCommand(makeCommand('cmd-3', 1));

    const gap = engine.handleSnapshotRequest(makeSnapshotRequest({ afterServerSeq: 1 }));
    expect(gap.mode).toBe('resync');
    expect(gap.events).toHaveLength(1);
    expect(gap.events[0]).toMatchObject({
      kind: 'resync',
      reason: 'server-seq-gap',
    });

    const ahead = engine.handleSnapshotRequest(makeSnapshotRequest({ afterServerSeq: 99 }));
    expect(ahead.mode).toBe('resync');
    expect(ahead.events).toHaveLength(1);
    expect(ahead.events[0]).toMatchObject({
      kind: 'resync',
      reason: 'server-seq-ahead',
    });
  });
});
