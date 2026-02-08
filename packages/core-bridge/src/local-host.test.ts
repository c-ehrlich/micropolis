import { describe, expect, it } from 'vitest';

import type { CoreHost } from './core-host.ts';
import {
  LOCAL_HOST_DEFAULT_CLIENT_ID,
  LOCAL_HOST_DEFAULT_CORE_VERSION,
  LOCAL_HOST_DEFAULT_PROTOCOL_VERSION,
  LOCAL_HOST_DEFAULT_ROOM_ID,
  LocalHost,
  type LocalHostTickScheduler,
} from './local-host.ts';
import type {
  ClientCommandEnvelope,
  ClientHelloEnvelope,
  ClientRequestSnapshotEnvelope,
  CoreHostEnvelope,
  HostErrorEnvelope,
  HostHelloEnvelope,
} from './types.ts';

const coreHostConformanceCheck: CoreHost = new LocalHost();
void coreHostConformanceCheck;

const makeHello = (overrides: Partial<ClientHelloEnvelope> = {}): ClientHelloEnvelope => ({
  kind: 'hello',
  roomId: LOCAL_HOST_DEFAULT_ROOM_ID,
  clientId: LOCAL_HOST_DEFAULT_CLIENT_ID,
  protocolVersion: LOCAL_HOST_DEFAULT_PROTOCOL_VERSION,
  coreVersion: LOCAL_HOST_DEFAULT_CORE_VERSION,
  ...overrides,
});

const makeCommand = (
  commandId: string,
  overrides: Partial<ClientCommandEnvelope> = {},
): ClientCommandEnvelope => ({
  kind: 'command',
  roomId: 'ignored-room',
  clientId: 'ignored-client',
  commandId,
  command: {
    type: 'tool.place',
    payload: {
      // Tool-result parity codes mirror `DoTool` style outcomes in
      // `ref/micropolis/src/sim/w_tool.c` (1 = success).
      mockToolResultCode: 1,
    },
  },
  ...overrides,
});

const makeSnapshotRequest = (
  overrides: Partial<ClientRequestSnapshotEnvelope> = {},
): ClientRequestSnapshotEnvelope => ({
  kind: 'request_snapshot',
  roomId: 'ignored-room',
  clientId: 'ignored-client',
  ...overrides,
});

describe('LocalHost', () => {
  it('satisfies CoreHost flow with deterministic local identity defaults', () => {
    const events: CoreHostEnvelope[] = [];
    const host = new LocalHost();
    host.subscribe((event) => {
      events.push(event);
    });

    host.connect();
    host.hello(makeHello());
    host.sendCommand(makeCommand('cmd-1'));
    host.requestSnapshot(makeSnapshotRequest());

    expect(events.map((event) => event.kind)).toEqual(['hello', 'ack', 'patch', 'snapshot']);

    events.forEach((event) => {
      expect(event.roomId).toBe(LOCAL_HOST_DEFAULT_ROOM_ID);
      expect(event.clientId).toBe(LOCAL_HOST_DEFAULT_CLIENT_ID);
    });

    const helloEvent = events[0];
    if (helloEvent === undefined || helloEvent.kind !== 'hello') {
      throw new Error('expected hello event at index 0');
    }

    expect(helloEvent).toEqual({
      kind: 'hello',
      roomId: LOCAL_HOST_DEFAULT_ROOM_ID,
      clientId: LOCAL_HOST_DEFAULT_CLIENT_ID,
      protocolVersion: LOCAL_HOST_DEFAULT_PROTOCOL_VERSION,
      coreVersion: LOCAL_HOST_DEFAULT_CORE_VERSION,
      accepted: true,
    } satisfies HostHelloEnvelope);
  });

  it('refuses hello mismatches deterministically and blocks command intake', () => {
    const events: CoreHostEnvelope[] = [];
    const host = new LocalHost();
    host.subscribe((event) => {
      events.push(event);
    });

    host.connect();
    host.hello(
      makeHello({
        protocolVersion: 'bridge-v2',
      }),
    );
    host.sendCommand(makeCommand('cmd-refused'));

    expect(events.map((event) => event.kind)).toEqual(['hello', 'error']);

    const helloEvent = events[0];
    if (helloEvent === undefined || helloEvent.kind !== 'hello') {
      throw new Error('expected hello event at index 0');
    }

    expect(helloEvent).toEqual({
      kind: 'hello',
      roomId: LOCAL_HOST_DEFAULT_ROOM_ID,
      clientId: LOCAL_HOST_DEFAULT_CLIENT_ID,
      protocolVersion: LOCAL_HOST_DEFAULT_PROTOCOL_VERSION,
      coreVersion: LOCAL_HOST_DEFAULT_CORE_VERSION,
      accepted: false,
      message: 'hello refused: protocolVersion expected bridge-v1 but received bridge-v2',
    } satisfies HostHelloEnvelope);

    const errorEvent = events[1];
    if (errorEvent === undefined || errorEvent.kind !== 'error') {
      throw new Error('expected error event at index 1');
    }

    expect(errorEvent).toEqual({
      kind: 'error',
      roomId: LOCAL_HOST_DEFAULT_ROOM_ID,
      clientId: LOCAL_HOST_DEFAULT_CLIENT_ID,
      tick: 0,
      serverSeq: 0,
      code: 'host/handshake-required',
      message: 'hello must be accepted before sendCommand()',
      commandId: 'cmd-refused',
    } satisfies HostErrorEnvelope);
  });

  it('supports reconnect bootstrap, patch-tail replay, and gap-triggered resync', () => {
    const events: CoreHostEnvelope[] = [];
    const host = new LocalHost({
      snapshotCadenceTicks: 2,
    });
    host.subscribe((event) => {
      events.push(event);
    });

    host.connect();
    host.hello(makeHello());
    host.sendCommand(makeCommand('cmd-1'));
    host.sendCommand(
      makeCommand('cmd-2', {
        command: {
          type: 'tool.place',
          payload: {
            // Micropolis tool handlers in `ref/micropolis/src/sim/w_tool.c` use
            // -2 for "insufficient funds" style rejection paths.
            mockToolResultCode: -2,
          },
        },
      }),
    );
    host.sendCommand(makeCommand('cmd-3'));
    host.sendCommand(makeCommand('cmd-4'));

    const sameTickEvents = events
      .filter(
        (event): event is Exclude<CoreHostEnvelope, HostHelloEnvelope> => event.kind !== 'hello',
      )
      .filter((event) => event.tick === 1);
    expect(sameTickEvents.map((event) => event.serverSeq)).toEqual([0, 1, 2]);

    const bootstrapStart = events.length;
    host.requestSnapshot(makeSnapshotRequest());
    const bootstrapEvents = events.slice(bootstrapStart);
    expect(bootstrapEvents.map((event) => event.kind)).toEqual(['snapshot']);

    const replayStart = events.length;
    host.requestSnapshot(makeSnapshotRequest({ afterServerSeq: 4 }));
    const replayEvents = events.slice(replayStart);
    expect(replayEvents.map((event) => event.kind)).toEqual(['patch']);
    expect(replayEvents[0]).toMatchObject({
      kind: 'patch',
      serverSeq: 6,
      tick: 3,
    });

    const resyncStart = events.length;
    host.requestSnapshot(makeSnapshotRequest({ afterServerSeq: 1 }));
    const resyncEvents = events.slice(resyncStart);
    expect(resyncEvents).toHaveLength(1);
    expect(resyncEvents[0]).toMatchObject({
      kind: 'resync',
      reason: 'server-seq-gap',
    });
  });

  it('supports explicit identity overrides and local tick scheduler hooks', () => {
    const startedIntervals: number[] = [];
    const intervalCallbacks: Array<() => void> = [];
    const intervalHandles: unknown[] = [];
    const clearedHandles: unknown[] = [];

    const tickScheduler: LocalHostTickScheduler = {
      setInterval(callback, intervalMs) {
        startedIntervals.push(intervalMs);
        intervalCallbacks.push(callback);
        const handle = { id: intervalHandles.length + 1 };
        intervalHandles.push(handle);
        return handle;
      },
      clearInterval(handle) {
        clearedHandles.push(handle);
      },
    };

    const ticks: number[] = [];
    const events: CoreHostEnvelope[] = [];
    const host = new LocalHost({
      roomId: 'custom-room',
      clientId: 'custom-client',
      tickIntervalMs: 64,
      tickScheduler,
      onTick(tick) {
        ticks.push(tick);
      },
    });

    host.subscribe((event) => {
      events.push(event);
    });

    host.connect();
    host.hello(
      makeHello({
        roomId: 'custom-room',
        clientId: 'custom-client',
      }),
    );
    host.sendCommand(makeCommand('cmd-custom'));

    expect(startedIntervals).toEqual([64]);

    const intervalCallback = intervalCallbacks[0];
    if (intervalCallback === undefined) {
      throw new Error('expected an interval callback');
    }

    intervalCallback();
    intervalCallback();

    expect(ticks).toEqual([1, 2]);

    host.disconnect();

    expect(clearedHandles).toEqual([intervalHandles[0]]);
    events.forEach((event) => {
      expect(event.roomId).toBe('custom-room');
      expect(event.clientId).toBe('custom-client');
    });
  });
});
