import { describe, expect, test } from 'vitest';

import type { HostMode } from './core-host';
import { createCoreHost, DEFAULT_HOST_MODE, resolveHostMode } from './host-factory';
import { createGameRuntime } from './runtime';

/**
 * Collect lifecycle event types for one runtime mode.
 * Mirrors the transport-independent runtime lifecycle expected from
 * `ref/micropolis/src/sim/w_sim.c` command orchestration, regardless of NET path.
 */
function collectLifecycle(mode: HostMode): Array<'connected' | 'disconnected'> {
  const runtime = createGameRuntime(createCoreHost({ mode }));
  const eventTypes: Array<'connected' | 'disconnected'> = [];
  runtime.subscribe((event) => {
    eventTypes.push(event.type);
  });
  runtime.start();
  runtime.stop();
  return eventTypes;
}

describe('resolveHostMode', () => {
  test('defaults to local mode when no config is provided', () => {
    expect(resolveHostMode({ env: {} })).toBe(DEFAULT_HOST_MODE);
  });

  test('reads do mode from env config', () => {
    expect(resolveHostMode({ env: { VITE_CORE_HOST_MODE: 'do' } })).toBe('do');
  });

  test('throws on unsupported mode strings', () => {
    expect(() => resolveHostMode({ env: { VITE_CORE_HOST_MODE: 'invalid-mode' } })).toThrow(
      'Unsupported host mode: invalid-mode',
    );
  });
});

describe('createCoreHost', () => {
  test('creates local host for local mode', () => {
    const host = createCoreHost({ mode: 'local' });
    expect(host.mode).toBe('local');
    expect(typeof host.connect).toBe('function');
    expect(typeof host.disconnect).toBe('function');
    expect(typeof host.subscribe).toBe('function');
  });

  test('creates do host for do mode', () => {
    const host = createCoreHost({ mode: 'do' });
    expect(host.mode).toBe('do');
    expect(typeof host.connect).toBe('function');
    expect(typeof host.disconnect).toBe('function');
    expect(typeof host.subscribe).toBe('function');
  });
});

describe('runtime wiring parity across host modes', () => {
  test('emits the same lifecycle sequence for local and do modes', () => {
    const localEvents = collectLifecycle('local');
    const doEvents = collectLifecycle('do');
    expect(localEvents).toEqual(['connected', 'disconnected']);
    expect(doEvents).toEqual(localEvents);
  });
});
