import { describe, expect, test } from 'vitest';

import type { CoreHostEvent } from './core-host';
import { LocalHost } from './local-host';

/**
 * Flush one microtask turn used by LocalHost command/snapshot dispatch.
 * Mirrors host-side queued command handling intent around `SimCmd` dispatch in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: queueMicrotask flushing is a TypeScript test harness detail.
 */
function flushMicrotasks(): Promise<void> {
  return Promise.resolve();
}

describe('LocalHost lifecycle', () => {
  test('treats duplicate connect/disconnect calls as no-op boundaries', () => {
    const host = new LocalHost({ authorityMode: 'deterministic' });
    const eventTypes: Array<CoreHostEvent['type']> = [];

    host.subscribe((event) => {
      eventTypes.push(event.type);
    });

    host.connect();
    host.connect();
    host.disconnect();
    host.disconnect();

    expect(eventTypes).toEqual(['connected', 'hello', 'disconnected']);
  });

  test('supports requestSnapshot after connect', async () => {
    const host = new LocalHost({ authorityMode: 'deterministic' });
    const events: CoreHostEvent[] = [];

    host.subscribe((event) => {
      events.push(event);
    });
    host.connect();

    host.sendCommand({
      type: 'tool-command',
      commandId: 'cmd-local-snapshot',
      tool: 'road',
      x: 10,
      y: 10,
    });
    await flushMicrotasks();

    host.requestSnapshot();
    await flushMicrotasks();

    const snapshot = events.find((event): event is Extract<CoreHostEvent, { type: 'snapshot' }> => {
      return event.type === 'snapshot';
    });
    expect(snapshot).toBeDefined();

    host.disconnect();
  });
});
