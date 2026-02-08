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
import type { ClientCommandEnvelope, ClientHelloEnvelope, CoreHostEnvelope } from './types.ts';

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

const makeCommand = (commandId: string): ClientCommandEnvelope => ({
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
});

describe('LocalHost', () => {
  it('emits accepted hello with deterministic local default identity', () => {
    const events: CoreHostEnvelope[] = [];
    const host = new LocalHost();
    host.subscribe((event) => {
      events.push(event);
    });

    host.connect();
    host.hello(makeHello());

    const helloEvent = events[0];
    if (helloEvent === undefined || helloEvent.kind !== 'hello') {
      throw new Error('expected hello event at index 0');
    }

    expect(helloEvent).toMatchObject({
      kind: 'hello',
      roomId: LOCAL_HOST_DEFAULT_ROOM_ID,
      clientId: LOCAL_HOST_DEFAULT_CLIENT_ID,
      protocolVersion: LOCAL_HOST_DEFAULT_PROTOCOL_VERSION,
      coreVersion: LOCAL_HOST_DEFAULT_CORE_VERSION,
      accepted: true,
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
