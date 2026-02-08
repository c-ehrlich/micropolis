import { describe, expect, test } from 'vitest';

import type { HostMode } from './core-host';
import { DoHost } from './do-host';
import { HELLO_VERSION_MISMATCH_CODE } from './handshake';
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
