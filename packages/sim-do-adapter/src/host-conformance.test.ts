import type { BridgeServerEnvelope, CoreHost } from '@city/core-bridge';
import type {
  IntegrationBroadcaster,
  IntegrationClientCommandEnvelope,
  IntegrationMultiplayerRuntime,
  IntegrationReplayBootstrap,
  IntegrationServerSnapshotEnvelope,
} from '@city/sim-integration';
import { describe, expect, it } from 'vitest';

import { DoHost } from './do-host.ts';
import { createInMemoryDoHostTransport } from './in-memory-do-host-transport.ts';
import { LocalHost } from './local-host.ts';
import {
  DEFAULT_DO_HELLO_PAYLOAD,
  type DoWebSocketOutboundMessage,
  RoomDoAdapter,
} from './room-do-adapter.ts';

interface TestCommandPayload {
  action: 'apply' | 'reject';
}

interface TestPatchPayload {
  appliedCommandId: string;
  applyIndex: number;
}

interface TestSnapshotPayload {
  snapshotToken: string;
  appliedCommandIds: string[];
}

type TestServerEnvelope = BridgeServerEnvelope<TestPatchPayload, TestSnapshotPayload>;
type TestCoreHost = CoreHost<TestCommandPayload, TestPatchPayload, TestSnapshotPayload>;

interface HostConformanceHarness {
  createHost(
    clientId: string,
    options?: {
      dropOutboundMessage?: (message: DoWebSocketOutboundMessage) => boolean;
    },
  ): TestCoreHost;
  tick(nowMs?: number): Promise<void>;
}

type HostKind = 'do' | 'local';

describe('host conformance suite', () => {
  runHostConformanceSuite('DoHost', 'do');
  runHostConformanceSuite('LocalHost', 'local');
});

function runHostConformanceSuite(name: string, hostKind: HostKind): void {
  describe(name, () => {
    it('enforces hello before mutating commands', async () => {
      const harness = createHostConformanceHarness(hostKind);
      const host = harness.createHost('client-a');
      const events: TestServerEnvelope[] = [];
      host.subscribe((event) => {
        events.push(event);
      });

      await host.connect();
      await host.sendCommand({
        commandId: 'cmd-before-hello',
        payload: { action: 'apply' },
        sentAtMs: 100,
      });
      await host.sendHello();

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        kind: 'reject',
        roomId: 'room-a',
        payload: {
          commandId: 'cmd-before-hello',
          code: 'HELLO_REQUIRED',
        },
      });
      expect(events[1]).toMatchObject({
        kind: 'hello',
        roomId: 'room-a',
        clientId: 'client-a',
        payload: DEFAULT_DO_HELLO_PAYLOAD,
      });
    });

    it('emits ack/patch/snapshot with monotonic sequencing after hello', async () => {
      const harness = createHostConformanceHarness(hostKind);
      const host = harness.createHost('client-a');
      const events: TestServerEnvelope[] = [];
      host.subscribe((event) => {
        events.push(event);
      });

      await host.connect();
      await host.sendHello();
      await host.sendCommand({
        commandId: 'cmd-1',
        payload: { action: 'apply' },
        sentAtMs: 100,
      });
      await harness.tick(500);
      await host.requestSnapshot();

      const ackEvent = events.find(
        (event): event is Extract<TestServerEnvelope, { kind: 'ack' }> =>
          event.kind === 'ack' && event.payload.commandId === 'cmd-1',
      );
      const patchEvent = events.find(
        (event): event is Extract<TestServerEnvelope, { kind: 'patch' }> =>
          event.kind === 'patch' && event.payload.appliedCommandId === 'cmd-1',
      );
      const snapshotEvent = events.find(
        (event): event is Extract<TestServerEnvelope, { kind: 'snapshot' }> =>
          event.kind === 'snapshot',
      );

      expect(ackEvent).toBeDefined();
      expect(patchEvent).toBeDefined();
      expect(snapshotEvent).toBeDefined();
      expect(patchEvent?.payload.applyIndex).toBe(1);
      expect(snapshotEvent?.payload.appliedCommandIds).toContain('cmd-1');
      assertStrictlyIncreasingServerSeq(events);
    });

    it('keeps commandId idempotency by acking duplicates without reapplying patches', async () => {
      const harness = createHostConformanceHarness(hostKind);
      const host = harness.createHost('client-a');
      const events: TestServerEnvelope[] = [];
      host.subscribe((event) => {
        events.push(event);
      });

      await host.connect();
      await host.sendHello();
      await host.sendCommand({
        commandId: 'cmd-dupe',
        payload: { action: 'apply' },
        sentAtMs: 200,
      });
      await host.sendCommand({
        commandId: 'cmd-dupe',
        payload: { action: 'apply' },
        sentAtMs: 201,
      });
      await harness.tick(600);

      const commandAcks = events.filter(
        (event): event is Extract<TestServerEnvelope, { kind: 'ack' }> =>
          event.kind === 'ack' && event.payload.commandId === 'cmd-dupe',
      );
      const commandPatches = events.filter(
        (event): event is Extract<TestServerEnvelope, { kind: 'patch' }> =>
          event.kind === 'patch' && event.payload.appliedCommandId === 'cmd-dupe',
      );

      expect(commandAcks).toHaveLength(2);
      expect(commandPatches).toHaveLength(1);
    });

    it('preserves multi-client ordering and per-room idempotency', async () => {
      const harness = createHostConformanceHarness(hostKind);
      const hostA = harness.createHost('client-a');
      const hostB = harness.createHost('client-b');
      const eventsA: TestServerEnvelope[] = [];
      const eventsB: TestServerEnvelope[] = [];
      hostA.subscribe((event) => {
        eventsA.push(event);
      });
      hostB.subscribe((event) => {
        eventsB.push(event);
      });

      await hostA.connect();
      await hostB.connect();
      await hostA.sendHello();
      await hostB.sendHello();

      await hostB.sendCommand({
        commandId: 'cmd-2',
        payload: { action: 'apply' },
        sentAtMs: 20,
      });
      await hostA.sendCommand({
        commandId: 'cmd-1',
        payload: { action: 'apply' },
        sentAtMs: 20,
      });
      await hostA.sendCommand({
        commandId: 'cmd-1',
        payload: { action: 'apply' },
        sentAtMs: 21,
      });
      await hostB.sendCommand({
        commandId: 'cmd-0',
        payload: { action: 'apply' },
        sentAtMs: 10,
      });
      await harness.tick(1000);

      const patchesA = eventsA.filter(
        (event): event is Extract<TestServerEnvelope, { kind: 'patch' }> => event.kind === 'patch',
      );
      const patchesB = eventsB.filter(
        (event): event is Extract<TestServerEnvelope, { kind: 'patch' }> => event.kind === 'patch',
      );
      expect(patchesA.map((event) => event.payload.appliedCommandId)).toEqual([
        'cmd-0',
        'cmd-1',
        'cmd-2',
      ]);
      expect(patchesB.map((event) => event.payload.appliedCommandId)).toEqual([
        'cmd-0',
        'cmd-1',
        'cmd-2',
      ]);

      const duplicateAcksFromA = eventsA.filter(
        (event): event is Extract<TestServerEnvelope, { kind: 'ack' }> =>
          event.kind === 'ack' && event.payload.commandId === 'cmd-1',
      );
      expect(duplicateAcksFromA).toHaveLength(2);
    });

    it('recovers via server-initiated resync after a dropped patch and reconnect', async () => {
      const harness = createHostConformanceHarness(hostKind);
      let hasDroppedPatch = false;
      const host = harness.createHost('client-a', {
        dropOutboundMessage(message) {
          const envelope = parseServerEnvelopeMessage(message);
          if (envelope.kind === 'patch' && !hasDroppedPatch) {
            hasDroppedPatch = true;
            return true;
          }
          return false;
        },
      });
      const events: TestServerEnvelope[] = [];
      host.subscribe((event) => {
        events.push(event);
      });

      await host.connect();
      await host.sendHello();
      await host.sendCommand({
        commandId: 'cmd-drop',
        payload: { action: 'apply' },
        sentAtMs: 100,
      });
      await harness.tick(500);
      await host.disconnect();

      await host.connect();
      await host.sendHello();
      await host.requestSnapshot();

      expect(hasDroppedPatch).toBe(true);
      const resyncEvent = events.find(
        (event): event is Extract<TestServerEnvelope, { kind: 'resync' }> =>
          event.kind === 'resync' && event.payload.reason === 'reconnect requires snapshot replay',
      );
      expect(resyncEvent).toBeDefined();
      const latestSnapshot = [...events]
        .reverse()
        .find(
          (event): event is Extract<TestServerEnvelope, { kind: 'snapshot' }> =>
            event.kind === 'snapshot',
        );
      expect(latestSnapshot).toBeDefined();
      expect(latestSnapshot?.payload.appliedCommandIds).toContain('cmd-drop');
    });
  });
}

function createHostConformanceHarness(hostKind: HostKind): HostConformanceHarness {
  const roomId = 'room-a';
  const adapter = new RoomDoAdapter<TestCommandPayload, TestPatchPayload, TestSnapshotPayload>({
    roomId,
    createRuntime(broadcaster) {
      return createConformanceRuntime(roomId, broadcaster);
    },
  });

  return {
    createHost(clientId, options) {
      const transport = createInMemoryDoHostTransport({
        adapter,
        clientId,
        dropOutboundMessage: options?.dropOutboundMessage,
      });
      if (hostKind === 'local') {
        return new LocalHost<TestCommandPayload, TestPatchPayload, TestSnapshotPayload>({
          roomId,
          clientId,
          transport,
        });
      }
      return new DoHost<TestCommandPayload, TestPatchPayload, TestSnapshotPayload>({
        roomId,
        clientId,
        transport,
      });
    },
    tick(nowMs = 0) {
      return adapter.handleAlarm(nowMs);
    },
  };
}

function createConformanceRuntime(
  roomId: string,
  broadcaster: IntegrationBroadcaster<TestPatchPayload, TestSnapshotPayload>,
): IntegrationMultiplayerRuntime<TestCommandPayload, TestPatchPayload, TestSnapshotPayload> {
  interface QueuedCommand {
    command: IntegrationClientCommandEnvelope<TestCommandPayload>;
    receivedOrder: number;
  }

  const connectedClients = new Set<string>();
  const queuedCommands: QueuedCommand[] = [];
  const processedCommandIds = new Set<string>();
  const appliedCommandIds: string[] = [];
  let nextReceiveOrder = 0;
  let tick = 0;
  let serverSeq = 0;

  return {
    async connectClient(receivedRoomId, clientId) {
      assertRoom(roomId, receivedRoomId);
      connectedClients.add(clientId);
    },
    async disconnectClient(receivedRoomId, clientId) {
      assertRoom(roomId, receivedRoomId);
      connectedClients.delete(clientId);
    },
    async receiveCommand(command) {
      assertRoom(roomId, command.roomId);
      queuedCommands.push({
        command,
        receivedOrder: nextReceiveOrder,
      });
      nextReceiveOrder += 1;
    },
    async tick() {
      tick += 1;
      queuedCommands.sort(compareQueuedCommands);
      const toProcess = queuedCommands.splice(0, queuedCommands.length);
      for (const queued of toProcess) {
        const command = queued.command;
        if (!connectedClients.has(command.clientId)) {
          broadcaster.sendToClient(command.clientId, {
            kind: 'reject',
            roomId,
            tick,
            serverSeq: nextServerSeq(),
            payload: {
              commandId: command.commandId,
              reason: 'client must connect before sending commands',
              code: 'NOT_CONNECTED',
            },
          });
          continue;
        }

        if (processedCommandIds.has(command.commandId)) {
          broadcaster.sendToClient(command.clientId, {
            kind: 'ack',
            roomId,
            tick,
            serverSeq: nextServerSeq(),
            payload: {
              commandId: command.commandId,
            },
          });
          continue;
        }

        if (command.payload.action === 'reject') {
          broadcaster.sendToClient(command.clientId, {
            kind: 'reject',
            roomId,
            tick,
            serverSeq: nextServerSeq(),
            payload: {
              commandId: command.commandId,
              reason: 'rejected by test runtime',
              code: 'TEST_REJECT',
            },
          });
          processedCommandIds.add(command.commandId);
          continue;
        }

        processedCommandIds.add(command.commandId);
        broadcaster.sendToClient(command.clientId, {
          kind: 'ack',
          roomId,
          tick,
          serverSeq: nextServerSeq(),
          payload: {
            commandId: command.commandId,
          },
        });
        appliedCommandIds.push(command.commandId);
        broadcaster.sendToRoom(roomId, {
          kind: 'patch',
          roomId,
          tick,
          serverSeq: nextServerSeq(),
          payload: {
            appliedCommandId: command.commandId,
            applyIndex: appliedCommandIds.length,
          },
        });
      }
    },
    async getSnapshot(
      receivedRoomId,
    ): Promise<IntegrationServerSnapshotEnvelope<TestSnapshotPayload>> {
      assertRoom(roomId, receivedRoomId);
      return {
        kind: 'snapshot',
        roomId,
        tick,
        serverSeq: nextServerSeq(),
        payload: {
          snapshotToken: `${roomId}:${tick}`,
          appliedCommandIds: [...appliedCommandIds],
        },
      };
    },
    async bootstrapReplay(
      receivedRoomId,
      _afterServerSeq,
    ): Promise<IntegrationReplayBootstrap<TestPatchPayload, TestSnapshotPayload>> {
      assertRoom(roomId, receivedRoomId);
      return {
        snapshot: {
          kind: 'snapshot',
          roomId,
          tick,
          serverSeq: nextServerSeq(),
          payload: {
            snapshotToken: `${roomId}:${tick}`,
            appliedCommandIds: [...appliedCommandIds],
          },
        },
        replayTail: [],
      };
    },
  };

  function nextServerSeq(): number {
    serverSeq += 1;
    return serverSeq;
  }
}

function compareQueuedCommands(
  left: { command: IntegrationClientCommandEnvelope; receivedOrder: number },
  right: { command: IntegrationClientCommandEnvelope; receivedOrder: number },
): number {
  if (left.command.sentAtMs !== right.command.sentAtMs) {
    return left.command.sentAtMs - right.command.sentAtMs;
  }
  if (left.command.clientId !== right.command.clientId) {
    return left.command.clientId < right.command.clientId ? -1 : 1;
  }
  if (left.command.commandId !== right.command.commandId) {
    return left.command.commandId < right.command.commandId ? -1 : 1;
  }
  return left.receivedOrder - right.receivedOrder;
}

function assertRoom(expectedRoomId: string, receivedRoomId: string): void {
  if (receivedRoomId !== expectedRoomId) {
    throw new Error(`room mismatch: expected ${expectedRoomId}, received ${receivedRoomId}`);
  }
}

function assertStrictlyIncreasingServerSeq(events: ReadonlyArray<TestServerEnvelope>): void {
  let previous: number | undefined;
  for (const event of events) {
    if (previous !== undefined) {
      expect(event.serverSeq).toBeGreaterThan(previous);
    }
    previous = event.serverSeq;
  }
}

function parseServerEnvelopeMessage(message: DoWebSocketOutboundMessage): TestServerEnvelope {
  if (typeof message !== 'string') {
    throw new Error('expected JSON string payload');
  }
  return JSON.parse(message) as TestServerEnvelope;
}
