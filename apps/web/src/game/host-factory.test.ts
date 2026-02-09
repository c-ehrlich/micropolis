import { describe, expect, test } from 'vitest';

import type { HostMode } from './core-host';
import {
  createCoreHost,
  DEFAULT_HOST_MODE,
  DEFAULT_STAGE4_AUTHORITY_MODE,
  resolveHostMode,
  resolveStage4AuthorityMode,
} from './host-factory';
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
    if (event.type === 'connected' || event.type === 'disconnected') {
      eventTypes.push(event.type);
    }
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

describe('resolveStage4AuthorityMode', () => {
  test('treats the real-authority opt-in flag as sim-core mode', () => {
    expect(resolveStage4AuthorityMode({ env: { VITE_STAGE4_REAL_AUTHORITY: '1' } })).toBe(
      'sim-core',
    );
  });

  test('defaults to sim-core authority when no config is provided', () => {
    expect(resolveStage4AuthorityMode({ env: {} })).toBe(DEFAULT_STAGE4_AUTHORITY_MODE);
  });

  test('reads deterministic authority mode from env config', () => {
    expect(
      resolveStage4AuthorityMode({ env: { VITE_STAGE4_AUTHORITY_MODE: 'deterministic' } }),
    ).toBe('deterministic');
  });

  test('throws on unsupported authority mode strings', () => {
    expect(() =>
      resolveStage4AuthorityMode({ env: { VITE_STAGE4_AUTHORITY_MODE: 'invalid-authority-mode' } }),
    ).toThrow('Unsupported stage4 authority mode: invalid-authority-mode');
  });

  test('lets explicit authority mode override real-authority env wiring', () => {
    expect(
      resolveStage4AuthorityMode({
        authorityMode: 'deterministic',
        env: { VITE_STAGE4_REAL_AUTHORITY: '1' },
      }),
    ).toBe('deterministic');
  });

  test('throws on unsupported real-authority opt-in values', () => {
    expect(() =>
      resolveStage4AuthorityMode({ env: { VITE_STAGE4_REAL_AUTHORITY: 'maybe' } }),
    ).toThrow('Unsupported stage4 real authority flag: maybe');
  });
});

describe('createCoreHost', () => {
  test('creates local host for local mode', () => {
    const host = createCoreHost({ mode: 'local' });
    expect(host.mode).toBe('local');
    expect(typeof host.connect).toBe('function');
    expect(typeof host.disconnect).toBe('function');
    expect(typeof host.sendCommand).toBe('function');
    expect(typeof host.requestSnapshot).toBe('function');
    expect(typeof host.subscribe).toBe('function');
  });

  test('creates do host for do mode', () => {
    const host = createCoreHost({ mode: 'do' });
    expect(host.mode).toBe('do');
    expect(typeof host.connect).toBe('function');
    expect(typeof host.disconnect).toBe('function');
    expect(typeof host.sendCommand).toBe('function');
    expect(typeof host.requestSnapshot).toBe('function');
    expect(typeof host.subscribe).toBe('function');
  });

  test('rejects deterministic authority for normal runtime wiring', () => {
    expect(() =>
      createCoreHost({
        mode: 'local',
        authorityMode: 'deterministic',
      }),
    ).toThrow(
      'Deterministic authority mode is restricted to isolated tests/fallback; set allowDeterministicFallback to true.',
    );
  });

  test('keeps deterministic authority available for isolated fallback wiring', () => {
    const host = createCoreHost({
      mode: 'local',
      authorityMode: 'deterministic',
      allowDeterministicFallback: true,
    });
    expect(host.mode).toBe('local');
  });

  test('uses sim-core authority when real-authority env opt-in is enabled', () => {
    const host = createCoreHost({
      mode: 'local',
      env: {
        VITE_STAGE4_AUTHORITY_MODE: 'deterministic',
        VITE_STAGE4_REAL_AUTHORITY: '1',
      },
    });
    expect(host.mode).toBe('local');
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
