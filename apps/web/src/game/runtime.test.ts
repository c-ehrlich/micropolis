import { describe, expect, test } from 'vitest';

import type { HostMode } from './core-host';
import { DoHost } from './do-host';
import {
  BRIDGE_CORE_VERSION,
  BRIDGE_PROTOCOL_VERSION,
  HELLO_VERSION_MISMATCH_CODE,
} from './handshake';
import { createCoreHost } from './host-factory';
import { LocalHost } from './local-host';
import { createGameRuntime, describeRuntimeStatus } from './runtime';

/**
 * Build a runtime for one host mode with optional hello version overrides.
 * Mirrors host-agnostic runtime bootstrap coverage mapped to
 * `ref/micropolis/spec/integration/SPEC.md`.
 */
function createRuntimeForMode(
  mode: HostMode,
  helloVersions?: { protocolVersion?: string; coreVersion?: string },
) {
  const host = createCoreHost({
    mode,
    createLocalHost: () => new LocalHost({ helloVersions }),
    createDoHost: () => new DoHost({ helloVersions }),
  });
  return createGameRuntime(host);
}

describe('createGameRuntime handshake bootstrap', () => {
  test.each(['local', 'do'] as const)(
    'preserves connected->hello bootstrap event ordering in %s mode',
    (mode) => {
      const runtime = createRuntimeForMode(mode);
      const events: Array<{
        readonly type: string;
        readonly payload?: {
          readonly roomId: string;
          readonly clientId: string;
          readonly protocolVersion: string;
          readonly coreVersion: string;
        };
      }> = [];

      runtime.subscribe((event) => {
        if (event.type === 'connected') {
          events.push({ type: event.type });
          return;
        }

        if (event.type === 'hello') {
          events.push({ type: event.type, payload: event.payload });
        }
      });

      runtime.start();

      expect(events.map((event) => event.type)).toEqual(['connected', 'hello']);
      const helloEvent = events[1];
      expect(helloEvent?.payload).toEqual({
        roomId: mode === 'local' ? 'local-room' : 'do-room',
        clientId: mode === 'local' ? 'local-client' : 'do-client',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        coreVersion: BRIDGE_CORE_VERSION,
      });
      expect(runtime.getState().status).toBe('ready');

      runtime.stop();
    },
  );

  test.each(['local', 'do'] as const)(
    'reaches ready state after successful hello in %s mode',
    (mode) => {
      const runtime = createRuntimeForMode(mode);
      runtime.start();

      const state = runtime.getState();
      expect(state.status).toBe('ready');

      const status = describeRuntimeStatus(state);
      expect(status.headline).toBe(`Connected (${mode})`);
      expect(status.isError).toBe(false);
    },
  );

  test.each(['local', 'do'] as const)(
    'surfaces handshake mismatch diagnostics in %s mode',
    (mode) => {
      const runtime = createRuntimeForMode(mode, { protocolVersion: 'bridge-v2' });
      const eventTypes: string[] = [];
      runtime.subscribe((event) => {
        eventTypes.push(event.type);
      });

      runtime.start();

      const state = runtime.getState();
      expect(state.status).toBe('handshake-error');
      expect(state.diagnostic?.code).toBe(HELLO_VERSION_MISMATCH_CODE);
      expect(state.diagnostic?.message).toContain('expected bridge-v1/core-v1');
      expect(state.diagnostic?.message).toContain('received bridge-v2/core-v1');
      expect(eventTypes).toEqual(['connected', 'hello', 'disconnected']);

      const status = describeRuntimeStatus(state);
      expect(status.headline).toBe('Handshake failed');
      expect(status.detail).toContain(HELLO_VERSION_MISMATCH_CODE);
      expect(status.isError).toBe(true);
    },
  );
});
