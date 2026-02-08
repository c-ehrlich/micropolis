import type {
  BridgeClientCommandEnvelope,
  BridgeServerEnvelope,
  BridgeServerSnapshotEnvelope,
} from '@city/core-bridge';
import { describe, expect, it } from 'vitest';

import {
  type AuthoritativeCommandDecision,
  createAuthoritativeRoomRuntime,
  DEFAULT_SNAPSHOT_CADENCE_TICKS,
} from './runtime.ts';
import type {
  IntegrationBroadcaster,
  IntegrationPatchTailEvent,
  IntegrationPersistedSnapshot,
  IntegrationSnapshotPatchTailPersistence,
} from './types.ts';

interface TestCommandPayload {
  type: string;
}

interface TestPatchPayload {
  patchId: string;
}

interface TestSnapshotPayload {
  snapshotId: string;
}

interface SentClientEvent<TPatchPayload, TSnapshotPayload> {
  target: string;
  event: BridgeServerEnvelope<TPatchPayload, TSnapshotPayload>;
}

interface SentRoomEvent<TPatchPayload, TSnapshotPayload> {
  target: string;
  event: BridgeServerEnvelope<TPatchPayload, TSnapshotPayload>;
}

describe('authoritative room runtime', () => {
  it('emits ack then downstream patch/snapshot events with ordered serverSeq values', async () => {
    const captured = createCapturedBroadcaster<TestPatchPayload, TestSnapshotPayload>();
    const command: BridgeClientCommandEnvelope<TestCommandPayload> = {
      kind: 'command',
      roomId: 'room-a',
      clientId: 'client-a',
      commandId: 'cmd-1',
      sentAtMs: 10,
      payload: { type: 'build-road' },
    };

    const receivedTicks: number[] = [];
    const runtime = createAuthoritativeRoomRuntime<
      TestCommandPayload,
      TestPatchPayload,
      TestSnapshotPayload
    >({
      broadcaster: captured.broadcaster,
      applyCommand(
        _receivedCommand,
        context,
      ): AuthoritativeCommandDecision<TestPatchPayload, TestSnapshotPayload> {
        receivedTicks.push(context.tick);
        return {
          kind: 'ack',
          patches: [{ patchId: 'patch-1' }, { patchId: 'patch-2' }],
          snapshot: { snapshotId: 'snapshot-1' },
        };
      },
    });

    await runtime.connectClient(command.roomId, command.clientId);
    await runtime.receiveCommand(command);
    await runtime.tick(100);

    // First tick is 1 because room ticks advance per authority step, mirroring
    // `SimFrame`/`Simulate` progression from `ref/micropolis/src/sim/s_sim.c`.
    expect(receivedTicks).toEqual([1]);
    expect(captured.clientEvents).toEqual([
      {
        target: 'client-a',
        event: {
          kind: 'ack',
          roomId: 'room-a',
          tick: 1,
          serverSeq: 1,
          payload: { commandId: 'cmd-1' },
        },
      },
    ]);
    expect(captured.roomEvents).toEqual([
      {
        target: 'room-a',
        event: {
          kind: 'patch',
          roomId: 'room-a',
          tick: 1,
          serverSeq: 2,
          payload: { patchId: 'patch-1' },
        },
      },
      {
        target: 'room-a',
        event: {
          kind: 'patch',
          roomId: 'room-a',
          tick: 1,
          serverSeq: 3,
          payload: { patchId: 'patch-2' },
        },
      },
      {
        target: 'room-a',
        event: {
          kind: 'snapshot',
          roomId: 'room-a',
          tick: 1,
          serverSeq: 4,
          payload: { snapshotId: 'snapshot-1' },
        },
      },
    ]);
  });

  it('emits reject for denied commands', async () => {
    const captured = createCapturedBroadcaster<TestPatchPayload, TestSnapshotPayload>();
    const command = createCommand({
      roomId: 'room-reject',
      clientId: 'client-reject',
      commandId: 'cmd-reject',
      sentAtMs: 10,
      type: 'place-zone',
    });

    const runtime = createAuthoritativeRoomRuntime<
      TestCommandPayload,
      TestPatchPayload,
      TestSnapshotPayload
    >({
      broadcaster: captured.broadcaster,
      applyCommand() {
        return {
          kind: 'reject',
          reason: 'insufficient funds',
          code: 'NO_FUNDS',
        };
      },
    });

    await runtime.connectClient(command.roomId, command.clientId);
    await runtime.receiveCommand(command);
    await runtime.tick(100);

    expect(captured.clientEvents).toEqual([
      {
        target: 'client-reject',
        event: {
          kind: 'reject',
          roomId: 'room-reject',
          tick: 1,
          serverSeq: 1,
          payload: {
            commandId: 'cmd-reject',
            reason: 'insufficient funds',
            code: 'NO_FUNDS',
          },
        },
      },
    ]);
    expect(captured.roomEvents).toEqual([]);
  });

  it('deduplicates duplicate commandId per room and re-emits ack without re-applying', async () => {
    const captured = createCapturedBroadcaster<TestPatchPayload, TestSnapshotPayload>();
    const command = createCommand({
      roomId: 'room-dedupe',
      clientId: 'client-dedupe',
      commandId: 'cmd-dedupe',
      sentAtMs: 10,
      type: 'tool',
    });

    let applyCount = 0;
    const runtime = createAuthoritativeRoomRuntime<
      TestCommandPayload,
      TestPatchPayload,
      TestSnapshotPayload
    >({
      broadcaster: captured.broadcaster,
      applyCommand() {
        applyCount += 1;
        return {
          kind: 'ack',
          patches: [{ patchId: `patch-${applyCount}` }],
        };
      },
    });

    await runtime.connectClient(command.roomId, command.clientId);
    await runtime.receiveCommand(command);
    await runtime.receiveCommand(command);
    await runtime.tick(100);

    expect(applyCount).toBe(1);
    expect(captured.clientEvents).toEqual([
      {
        target: 'client-dedupe',
        event: {
          kind: 'ack',
          roomId: 'room-dedupe',
          tick: 1,
          serverSeq: 1,
          payload: { commandId: 'cmd-dedupe' },
        },
      },
      {
        target: 'client-dedupe',
        event: {
          kind: 'ack',
          roomId: 'room-dedupe',
          tick: 1,
          serverSeq: 3,
          payload: { commandId: 'cmd-dedupe' },
        },
      },
    ]);
    expect(captured.roomEvents).toEqual([
      {
        target: 'room-dedupe',
        event: {
          kind: 'patch',
          roomId: 'room-dedupe',
          tick: 1,
          serverSeq: 2,
          payload: { patchId: 'patch-1' },
        },
      },
    ]);
  });

  it('processes room command queues deterministically by sentAtMs/clientId/commandId', async () => {
    const orderOne = await runDeterministicOrderingScenario([
      createCommand({
        roomId: 'room-order',
        clientId: 'b',
        commandId: 'cmd-2',
        sentAtMs: 20,
        type: 'cmd',
      }),
      createCommand({
        roomId: 'room-order',
        clientId: 'a',
        commandId: 'cmd-2',
        sentAtMs: 20,
        type: 'cmd',
      }),
      createCommand({
        roomId: 'room-order',
        clientId: 'a',
        commandId: 'cmd-1',
        sentAtMs: 20,
        type: 'cmd',
      }),
      createCommand({
        roomId: 'room-order',
        clientId: 'c',
        commandId: 'cmd-0',
        sentAtMs: 10,
        type: 'cmd',
      }),
    ]);
    const orderTwo = await runDeterministicOrderingScenario([
      createCommand({
        roomId: 'room-order',
        clientId: 'a',
        commandId: 'cmd-1',
        sentAtMs: 20,
        type: 'cmd',
      }),
      createCommand({
        roomId: 'room-order',
        clientId: 'c',
        commandId: 'cmd-0',
        sentAtMs: 10,
        type: 'cmd',
      }),
      createCommand({
        roomId: 'room-order',
        clientId: 'a',
        commandId: 'cmd-2',
        sentAtMs: 20,
        type: 'cmd',
      }),
      createCommand({
        roomId: 'room-order',
        clientId: 'b',
        commandId: 'cmd-2',
        sentAtMs: 20,
        type: 'cmd',
      }),
    ]);

    expect(orderOne).toEqual(['cmd-0', 'cmd-1', 'cmd-2', 'cmd-2']);
    expect(orderTwo).toEqual(['cmd-0', 'cmd-1', 'cmd-2', 'cmd-2']);
    expect(orderOne).toEqual(orderTwo);
  });

  it('emits error envelopes on unexpected command handler failures', async () => {
    const captured = createCapturedBroadcaster<TestPatchPayload, TestSnapshotPayload>();
    const command = createCommand({
      roomId: 'room-error',
      clientId: 'client-error',
      commandId: 'cmd-error',
      sentAtMs: 10,
      type: 'explode',
    });

    const runtime = createAuthoritativeRoomRuntime<
      TestCommandPayload,
      TestPatchPayload,
      TestSnapshotPayload
    >({
      broadcaster: captured.broadcaster,
      applyCommand() {
        throw new Error('unexpected failure');
      },
    });

    await runtime.connectClient(command.roomId, command.clientId);
    await runtime.receiveCommand(command);
    await runtime.tick(100);

    expect(captured.clientEvents).toEqual([
      {
        target: 'client-error',
        event: {
          kind: 'error',
          roomId: 'room-error',
          tick: 1,
          serverSeq: 1,
          payload: {
            message: 'unexpected failure',
            code: 'AUTHORITATIVE_RUNTIME_ERROR',
            commandId: 'cmd-error',
          },
        },
      },
    ]);
    expect(captured.roomEvents).toEqual([]);
  });

  it('returns snapshots with room tick and next serverSeq', async () => {
    const captured = createCapturedBroadcaster<TestPatchPayload, TestSnapshotPayload>();
    const runtime = createAuthoritativeRoomRuntime<
      TestCommandPayload,
      TestPatchPayload,
      TestSnapshotPayload
    >({
      broadcaster: captured.broadcaster,
      applyCommand() {
        return { kind: 'ack' };
      },
      createSnapshotPayload(roomId, tick): TestSnapshotPayload {
        return { snapshotId: `${roomId}@${tick}` };
      },
    });

    await runtime.connectClient('room-snapshot', 'client-snapshot');
    await runtime.tick(100);
    const snapshot = await runtime.getSnapshot('room-snapshot');

    expect(snapshot).toEqual<BridgeServerSnapshotEnvelope<TestSnapshotPayload>>({
      kind: 'snapshot',
      roomId: 'room-snapshot',
      tick: 1,
      serverSeq: 1,
      payload: { snapshotId: 'room-snapshot@1' },
    });
    expect(captured.clientEvents).toEqual([]);
    expect(captured.roomEvents).toEqual([]);
  });

  it('bootstraps replay from persisted snapshot plus patch tail filtered by serverSeq', async () => {
    const captured = createCapturedBroadcaster<TestPatchPayload, TestSnapshotPayload>();
    const persistence = createInMemorySnapshotPatchTailPersistence();
    const persistedSnapshot: IntegrationPersistedSnapshot<TestSnapshotPayload> = {
      roomId: 'room-bootstrap',
      tick: 64,
      serverSeq: 10,
      payload: { snapshotId: 'snapshot-persisted' },
    };
    const persistedTail: ReadonlyArray<
      IntegrationPatchTailEvent<TestPatchPayload, TestSnapshotPayload>
    > = [
      {
        kind: 'patch',
        roomId: 'room-bootstrap',
        tick: 65,
        serverSeq: 12,
        payload: { patchId: 'patch-after-12' },
      },
      {
        kind: 'snapshot',
        roomId: 'room-bootstrap',
        tick: 66,
        serverSeq: 15,
        payload: { snapshotId: 'snapshot-after-15' },
      },
    ];
    persistence.seed('room-bootstrap', persistedSnapshot, persistedTail);

    const runtime = createAuthoritativeRoomRuntime<
      TestCommandPayload,
      TestPatchPayload,
      TestSnapshotPayload
    >({
      broadcaster: captured.broadcaster,
      persistence: persistence.adapter,
      applyCommand() {
        return { kind: 'ack' };
      },
      createSnapshotPayload() {
        return { snapshotId: 'snapshot-factory' };
      },
    });

    const bootstrap = await runtime.bootstrapReplay('room-bootstrap', 11);

    expect(bootstrap.snapshot).toEqual<BridgeServerSnapshotEnvelope<TestSnapshotPayload>>({
      kind: 'snapshot',
      roomId: 'room-bootstrap',
      tick: 64,
      serverSeq: 10,
      payload: { snapshotId: 'snapshot-persisted' },
    });
    expect(bootstrap.replayTail).toEqual(persistedTail);
    expect(persistence.calls.loadSnapshot).toEqual([{ roomId: 'room-bootstrap' }]);
    expect(persistence.calls.loadPatchTail).toEqual([
      { roomId: 'room-bootstrap', afterServerSeq: 10 },
    ]);
  });

  it('truncates patch tail at snapshot cadence and preserves serverSeq continuity for replay', async () => {
    const captured = createCapturedBroadcaster<TestPatchPayload, TestSnapshotPayload>();
    const persistence = createInMemorySnapshotPatchTailPersistence();
    let appliedPatchNumber = 0;

    const runtime = createAuthoritativeRoomRuntime<
      TestCommandPayload,
      TestPatchPayload,
      TestSnapshotPayload
    >({
      broadcaster: captured.broadcaster,
      persistence: persistence.adapter,
      snapshotCadenceTicks: 2,
      applyCommand() {
        appliedPatchNumber += 1;
        return {
          kind: 'ack',
          patches: [{ patchId: `patch-${appliedPatchNumber}` }],
        };
      },
      createSnapshotPayload(roomId, tick) {
        return { snapshotId: `${roomId}@${tick}` };
      },
    });

    await runtime.connectClient('room-tail', 'client-tail');
    await runtime.receiveCommand(
      createCommand({
        roomId: 'room-tail',
        clientId: 'client-tail',
        commandId: 'cmd-1',
        sentAtMs: 10,
        type: 'first',
      }),
    );
    await runtime.tick(100);
    await runtime.tick(101);
    await runtime.receiveCommand(
      createCommand({
        roomId: 'room-tail',
        clientId: 'client-tail',
        commandId: 'cmd-2',
        sentAtMs: 20,
        type: 'second',
      }),
    );
    await runtime.tick(102);

    const restarted = createAuthoritativeRoomRuntime<
      TestCommandPayload,
      TestPatchPayload,
      TestSnapshotPayload
    >({
      broadcaster: captured.broadcaster,
      persistence: persistence.adapter,
      snapshotCadenceTicks: 2,
      applyCommand() {
        return { kind: 'ack' };
      },
      createSnapshotPayload(roomId, tick) {
        return { snapshotId: `${roomId}@${tick}` };
      },
    });
    const bootstrap = await restarted.bootstrapReplay('room-tail', 0);

    expect(bootstrap.snapshot).toEqual<BridgeServerSnapshotEnvelope<TestSnapshotPayload>>({
      kind: 'snapshot',
      roomId: 'room-tail',
      tick: 2,
      // Sequence value `2` is the first command's room patch (`serverSeq=2`)
      // after its client ack (`serverSeq=1`) in the deterministic room stream.
      serverSeq: 2,
      payload: { snapshotId: 'room-tail@2' },
    });
    expect(bootstrap.replayTail).toEqual([
      {
        kind: 'patch',
        roomId: 'room-tail',
        tick: 3,
        // Sequence value `4` preserves monotonic room stream continuity
        // after the second command ack consumes `serverSeq=3`.
        serverSeq: 4,
        payload: { patchId: 'patch-2' },
      },
    ]);
    expect(persistence.calls.truncatePatchTail).toEqual([
      { roomId: 'room-tail', throughServerSeq: 2 },
    ]);
    expect(persistence.calls.loadPatchTail).toContainEqual({
      roomId: 'room-tail',
      afterServerSeq: 2,
    });
  });

  it('uses the stage default snapshot cadence of 64 ticks when not configured', async () => {
    const captured = createCapturedBroadcaster<TestPatchPayload, TestSnapshotPayload>();
    const persistence = createInMemorySnapshotPatchTailPersistence();
    const runtime = createAuthoritativeRoomRuntime<
      TestCommandPayload,
      TestPatchPayload,
      TestSnapshotPayload
    >({
      broadcaster: captured.broadcaster,
      persistence: persistence.adapter,
      applyCommand() {
        return { kind: 'ack' };
      },
      createSnapshotPayload(roomId, tick) {
        return { snapshotId: `${roomId}@${tick}` };
      },
    });

    await runtime.connectClient('room-cadence', 'client-cadence');
    for (let tick = 1; tick < DEFAULT_SNAPSHOT_CADENCE_TICKS; tick += 1) {
      await runtime.tick(100 + tick);
    }
    expect(persistence.calls.saveSnapshot).toEqual([]);

    await runtime.tick(100 + DEFAULT_SNAPSHOT_CADENCE_TICKS);
    expect(persistence.calls.saveSnapshot).toEqual([
      {
        roomId: 'room-cadence',
        snapshot: {
          roomId: 'room-cadence',
          tick: DEFAULT_SNAPSHOT_CADENCE_TICKS,
          serverSeq: 0,
          payload: { snapshotId: `room-cadence@${DEFAULT_SNAPSHOT_CADENCE_TICKS}` },
        },
      },
    ]);
  });
});

function createCapturedBroadcaster<TPatchPayload, TSnapshotPayload>(): {
  broadcaster: IntegrationBroadcaster<TPatchPayload, TSnapshotPayload>;
  clientEvents: SentClientEvent<TPatchPayload, TSnapshotPayload>[];
  roomEvents: SentRoomEvent<TPatchPayload, TSnapshotPayload>[];
} {
  const clientEvents: SentClientEvent<TPatchPayload, TSnapshotPayload>[] = [];
  const roomEvents: SentRoomEvent<TPatchPayload, TSnapshotPayload>[] = [];

  return {
    broadcaster: {
      sendToClient(clientId, event) {
        clientEvents.push({ target: clientId, event });
      },
      sendToRoom(roomId, event) {
        roomEvents.push({ target: roomId, event });
      },
    },
    clientEvents,
    roomEvents,
  };
}

function createCommand(options: {
  roomId: string;
  clientId: string;
  commandId: string;
  sentAtMs: number;
  type: string;
}): BridgeClientCommandEnvelope<TestCommandPayload> {
  return {
    kind: 'command',
    roomId: options.roomId,
    clientId: options.clientId,
    commandId: options.commandId,
    sentAtMs: options.sentAtMs,
    payload: { type: options.type },
  };
}

async function runDeterministicOrderingScenario(
  commands: ReadonlyArray<BridgeClientCommandEnvelope<TestCommandPayload>>,
): Promise<string[]> {
  const captured = createCapturedBroadcaster<TestPatchPayload, TestSnapshotPayload>();
  const runtime = createAuthoritativeRoomRuntime<
    TestCommandPayload,
    TestPatchPayload,
    TestSnapshotPayload
  >({
    broadcaster: captured.broadcaster,
    applyCommand() {
      return { kind: 'ack' };
    },
  });

  await runtime.connectClient('room-order', 'a');
  await runtime.connectClient('room-order', 'b');
  await runtime.connectClient('room-order', 'c');

  for (const command of commands) {
    await runtime.receiveCommand(command);
  }
  await runtime.tick(100);

  return captured.clientEvents
    .map((sent) => sent.event)
    .filter(
      (event): event is Extract<BridgeServerEnvelope, { kind: 'ack' }> => event.kind === 'ack',
    )
    .map((event) => event.payload.commandId);
}

function createInMemorySnapshotPatchTailPersistence(): {
  adapter: IntegrationSnapshotPatchTailPersistence<TestPatchPayload, TestSnapshotPayload>;
  seed: (
    roomId: string,
    snapshot: IntegrationPersistedSnapshot<TestSnapshotPayload> | null,
    tail: ReadonlyArray<IntegrationPatchTailEvent<TestPatchPayload, TestSnapshotPayload>>,
  ) => void;
  calls: {
    loadSnapshot: Array<{ roomId: string }>;
    loadPatchTail: Array<{ roomId: string; afterServerSeq: number }>;
    saveSnapshot: Array<{
      roomId: string;
      snapshot: IntegrationPersistedSnapshot<TestSnapshotPayload>;
    }>;
    appendPatchTail: Array<{
      roomId: string;
      events: ReadonlyArray<IntegrationPatchTailEvent<TestPatchPayload, TestSnapshotPayload>>;
    }>;
    truncatePatchTail: Array<{ roomId: string; throughServerSeq: number }>;
  };
} {
  const snapshots = new Map<string, IntegrationPersistedSnapshot<TestSnapshotPayload>>();
  const tails = new Map<
    string,
    IntegrationPatchTailEvent<TestPatchPayload, TestSnapshotPayload>[]
  >();
  const calls = {
    loadSnapshot: [] as Array<{ roomId: string }>,
    loadPatchTail: [] as Array<{ roomId: string; afterServerSeq: number }>,
    saveSnapshot: [] as Array<{
      roomId: string;
      snapshot: IntegrationPersistedSnapshot<TestSnapshotPayload>;
    }>,
    appendPatchTail: [] as Array<{
      roomId: string;
      events: ReadonlyArray<IntegrationPatchTailEvent<TestPatchPayload, TestSnapshotPayload>>;
    }>,
    truncatePatchTail: [] as Array<{ roomId: string; throughServerSeq: number }>,
  };

  return {
    adapter: {
      async loadSnapshot(roomId) {
        calls.loadSnapshot.push({ roomId });
        return snapshots.get(roomId) ?? null;
      },
      async loadPatchTail(roomId, afterServerSeq) {
        calls.loadPatchTail.push({ roomId, afterServerSeq });
        return (tails.get(roomId) ?? []).filter((event) => event.serverSeq > afterServerSeq);
      },
      async saveSnapshot(roomId, snapshot) {
        calls.saveSnapshot.push({ roomId, snapshot });
        snapshots.set(roomId, snapshot);
      },
      async appendPatchTail(roomId, events) {
        calls.appendPatchTail.push({ roomId, events });
        const existing = tails.get(roomId) ?? [];
        existing.push(...events);
        tails.set(roomId, existing);
      },
      async truncatePatchTail(roomId, throughServerSeq) {
        calls.truncatePatchTail.push({ roomId, throughServerSeq });
        const existing = tails.get(roomId) ?? [];
        tails.set(
          roomId,
          existing.filter((event) => event.serverSeq > throughServerSeq),
        );
      },
    },
    seed(roomId, snapshot, tail) {
      if (snapshot === null) {
        snapshots.delete(roomId);
      } else {
        snapshots.set(roomId, snapshot);
      }
      tails.set(roomId, [...tail]);
    },
    calls,
  };
}
