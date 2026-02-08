import type {
  BridgeClientCommandEnvelope,
  BridgeServerEnvelope,
  BridgeServerSnapshotEnvelope,
} from '@city/core-bridge';
import { describe, expect, it } from 'vitest';

import { type AuthoritativeCommandDecision, createAuthoritativeRoomRuntime } from './runtime.ts';
import type { IntegrationBroadcaster } from './types.ts';

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
