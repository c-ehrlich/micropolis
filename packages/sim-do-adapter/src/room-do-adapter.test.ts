import type { BridgeClientCommandEnvelope, BridgeServerSnapshotEnvelope } from '@city/core-bridge';
import type {
  IntegrationBroadcaster,
  IntegrationMultiplayerRuntime,
  IntegrationServerEnvelope,
} from '@city/sim-integration';
import { describe, expect, it } from 'vitest';

import {
  createDoRoomAuthorityBinding,
  type DoWebSocketLike,
  type DoWebSocketOutboundMessage,
  mapRoomToDurableObjectName,
  RoomDoAdapter,
} from './room-do-adapter.ts';

interface TestCommandPayload {
  action: string;
}

interface TestPatchPayload {
  patchId: string;
}

interface TestSnapshotPayload {
  snapshotId: string;
}

interface TestRuntimeHarness {
  adapter: RoomDoAdapter<TestCommandPayload, TestPatchPayload, TestSnapshotPayload>;
  connectCalls: Array<{ roomId: string; clientId: string }>;
  disconnectCalls: Array<{ roomId: string; clientId: string }>;
  receiveCommandCalls: BridgeClientCommandEnvelope<TestCommandPayload>[];
  tickCalls: number[];
  getSnapshotCalls: string[];
  requireBroadcaster: () => IntegrationBroadcaster<TestPatchPayload, TestSnapshotPayload>;
  snapshotToReturn: BridgeServerSnapshotEnvelope<TestSnapshotPayload>;
}

describe('room do adapter', () => {
  it('maps room ids to deterministic durable object names', () => {
    expect(mapRoomToDurableObjectName('city-room')).toBe('room:city-room');
    expect(createDoRoomAuthorityBinding('city-room')).toEqual({
      roomId: 'city-room',
      durableObjectName: 'room:city-room',
    });
  });

  it('routes websocket open/close to connect/disconnect runtime methods', async () => {
    const harness = createRuntimeHarness();
    const socket = createFakeSocket();

    await harness.adapter.handleWebSocketOpen('client-a', socket);
    await harness.adapter.handleWebSocketClose('client-a');

    expect(harness.connectCalls).toEqual([{ roomId: 'room-a', clientId: 'client-a' }]);
    expect(harness.disconnectCalls).toEqual([{ roomId: 'room-a', clientId: 'client-a' }]);
  });

  it('routes websocket command messages to runtime receiveCommand', async () => {
    const harness = createRuntimeHarness();
    const command: BridgeClientCommandEnvelope<TestCommandPayload> = {
      kind: 'command',
      roomId: 'room-a',
      clientId: 'client-a',
      commandId: 'cmd-1',
      sentAtMs: 100,
      payload: { action: 'build-road' },
    };

    await harness.adapter.handleWebSocketMessage('client-a', JSON.stringify(command));

    expect(harness.receiveCommandCalls).toEqual([command]);
  });

  it('routes websocket snapshot requests to runtime getSnapshot and socket send', async () => {
    const harness = createRuntimeHarness();
    const socket = createFakeSocket();
    await harness.adapter.handleWebSocketOpen('client-a', socket);

    await harness.adapter.handleWebSocketMessage(
      'client-a',
      JSON.stringify({
        kind: 'request_snapshot',
        roomId: 'room-a',
        clientId: 'client-a',
      }),
    );

    expect(harness.getSnapshotCalls).toEqual(['room-a']);
    expect(socket.messages).toHaveLength(1);
    expect(JSON.parse(requireStringMessage(requireMessageAt(socket.messages, 0)))).toEqual(
      harness.snapshotToReturn,
    );
  });

  it('routes alarm callbacks to runtime tick using injected nowMs', async () => {
    const harness = createRuntimeHarness({
      nowMs: () => 4321,
    });

    await harness.adapter.handleAlarm();
    await harness.adapter.handleAlarm(9000);

    expect(harness.tickCalls).toEqual([4321, 9000]);
  });

  it('fans runtime broadcaster events to mapped room sockets', async () => {
    const harness = createRuntimeHarness();
    const clientASocket = createFakeSocket();
    const clientBSocket = createFakeSocket();
    await harness.adapter.handleWebSocketOpen('client-a', clientASocket);
    await harness.adapter.handleWebSocketOpen('client-b', clientBSocket);

    const broadcaster = harness.requireBroadcaster();
    const ackEvent: IntegrationServerEnvelope<TestPatchPayload, TestSnapshotPayload> = {
      kind: 'ack',
      roomId: 'room-a',
      tick: 1,
      serverSeq: 1,
      payload: {
        commandId: 'cmd-1',
      },
    };
    const patchEvent: IntegrationServerEnvelope<TestPatchPayload, TestSnapshotPayload> = {
      kind: 'patch',
      roomId: 'room-a',
      tick: 1,
      serverSeq: 2,
      payload: {
        patchId: 'patch-1',
      },
    };

    broadcaster.sendToClient('client-a', ackEvent);
    broadcaster.sendToRoom('room-a', patchEvent);

    expect(clientASocket.messages).toHaveLength(2);
    expect(clientBSocket.messages).toHaveLength(1);
    expect(JSON.parse(requireStringMessage(requireMessageAt(clientASocket.messages, 0)))).toEqual(
      ackEvent,
    );
    expect(JSON.parse(requireStringMessage(requireMessageAt(clientASocket.messages, 1)))).toEqual(
      patchEvent,
    );
    expect(JSON.parse(requireStringMessage(requireMessageAt(clientBSocket.messages, 0)))).toEqual(
      patchEvent,
    );
  });

  it('rejects websocket messages that target a different room authority', async () => {
    const harness = createRuntimeHarness();

    await expect(
      harness.adapter.handleWebSocketMessage(
        'client-a',
        JSON.stringify({
          kind: 'ping',
          roomId: 'room-b',
          clientId: 'client-a',
          sentAtMs: 1,
        }),
      ),
    ).rejects.toThrow('room authority mismatch');
  });

  it('rejects websocket messages that target a different client identity', async () => {
    const harness = createRuntimeHarness();

    await expect(
      harness.adapter.handleWebSocketMessage(
        'client-a',
        JSON.stringify({
          kind: 'ping',
          roomId: 'room-a',
          clientId: 'client-b',
          sentAtMs: 1,
        }),
      ),
    ).rejects.toThrow('client authority mismatch');
  });

  it('rejects runtime broadcaster room fanout for a non-owned room id', () => {
    const harness = createRuntimeHarness();
    const broadcaster = harness.requireBroadcaster();
    const patchEvent: IntegrationServerEnvelope<TestPatchPayload, TestSnapshotPayload> = {
      kind: 'patch',
      roomId: 'room-a',
      tick: 1,
      serverSeq: 1,
      payload: {
        patchId: 'patch-1',
      },
    };

    expect(() => broadcaster.sendToRoom('room-b', patchEvent)).toThrow('room authority mismatch');
  });
});

/**
 * Create a room adapter harness with a fully controllable runtime stub.
 * Mirrors deterministic command routing test intent from Micropolis `SimCmd`
 * dispatch in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this harness is intentionally adapter-level and transport-free.
 */
function createRuntimeHarness(options: { nowMs?: () => number } = {}): TestRuntimeHarness {
  const connectCalls: Array<{ roomId: string; clientId: string }> = [];
  const disconnectCalls: Array<{ roomId: string; clientId: string }> = [];
  const receiveCommandCalls: BridgeClientCommandEnvelope<TestCommandPayload>[] = [];
  const tickCalls: number[] = [];
  const getSnapshotCalls: string[] = [];
  const snapshotToReturn: BridgeServerSnapshotEnvelope<TestSnapshotPayload> = {
    kind: 'snapshot',
    roomId: 'room-a',
    tick: 3,
    serverSeq: 12,
    payload: {
      snapshotId: 'snapshot-3',
    },
  };

  let capturedBroadcaster:
    | IntegrationBroadcaster<TestPatchPayload, TestSnapshotPayload>
    | undefined;
  const runtime: IntegrationMultiplayerRuntime<
    TestCommandPayload,
    TestPatchPayload,
    TestSnapshotPayload
  > = {
    async connectClient(roomId, clientId) {
      connectCalls.push({ roomId, clientId });
    },
    async disconnectClient(roomId, clientId) {
      disconnectCalls.push({ roomId, clientId });
    },
    async receiveCommand(command) {
      receiveCommandCalls.push(command);
    },
    async tick(nowMs) {
      tickCalls.push(nowMs);
    },
    async getSnapshot(roomId) {
      getSnapshotCalls.push(roomId);
      return snapshotToReturn;
    },
    async bootstrapReplay() {
      throw new Error('bootstrapReplay is not used in this adapter-routing test harness');
    },
  };

  const adapter = new RoomDoAdapter<TestCommandPayload, TestPatchPayload, TestSnapshotPayload>({
    roomId: 'room-a',
    nowMs: options.nowMs,
    createRuntime(broadcaster) {
      capturedBroadcaster = broadcaster;
      return runtime;
    },
  });

  return {
    adapter,
    connectCalls,
    disconnectCalls,
    receiveCommandCalls,
    tickCalls,
    getSnapshotCalls,
    requireBroadcaster() {
      if (capturedBroadcaster === undefined) {
        throw new Error('runtime broadcaster was not captured');
      }
      return capturedBroadcaster;
    },
    snapshotToReturn,
  };
}

/**
 * Create a fake websocket sink used by adapter routing tests.
 * Mirrors transport-output capture intent from packet output in
 * `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this is a test-only in-memory socket substitute.
 */
function createFakeSocket(): DoWebSocketLike & { messages: DoWebSocketOutboundMessage[] } {
  const messages: DoWebSocketOutboundMessage[] = [];
  return {
    messages,
    send(message) {
      messages.push(message);
    },
  };
}

/**
 * Require websocket outbound test payloads to be string JSON messages.
 * Mirrors textual transport expectations from `HandlePacket` command strings
 * in `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this helper intentionally rejects binary payloads in tests.
 */
function requireStringMessage(message: DoWebSocketOutboundMessage): string {
  if (typeof message !== 'string') {
    throw new Error('expected JSON string payload');
  }
  return message;
}

/**
 * Retrieve one outbound socket message by index with an explicit bounds check.
 * Mirrors explicit bounds-safety expectations while iterating packet buffers in
 * `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this helper exists for strict TypeScript index-safety.
 */
function requireMessageAt(
  messages: ReadonlyArray<DoWebSocketOutboundMessage>,
  index: number,
): DoWebSocketOutboundMessage {
  const message = messages[index];
  if (message === undefined) {
    throw new Error(`expected outbound message at index ${index}`);
  }
  return message;
}
