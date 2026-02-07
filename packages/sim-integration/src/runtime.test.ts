import { describe, expect, it } from 'vitest';

import {
  DEFAULT_INTEGRATION_FEATURE_FLAGS,
  DEFAULT_PARITY_MODE,
  createIntegrationRuntime,
} from './runtime.ts';

describe('integration runtime scaffold defaults', () => {
  it('creates a runtime with strict parity mode and all integration features disabled by default', () => {
    // Parity baseline mirrors `sim.c` startup where optional integration paths
    // (Sugar/TTY/NET) are not enabled unless explicitly configured.
    const runtime = createIntegrationRuntime();

    expect(runtime.mode).toBe(DEFAULT_PARITY_MODE);
    expect(runtime.features).toEqual(DEFAULT_INTEGRATION_FEATURE_FLAGS);
    expect(runtime.features).not.toBe(DEFAULT_INTEGRATION_FEATURE_FLAGS);
  });

  it('applies partial feature overrides while preserving default values for unspecified flags', () => {
    const runtime = createIntegrationRuntime({
      features: {
        tty: true,
      },
    });

    expect(runtime.features).toEqual({
      sugar: false,
      tty: true,
      net: false,
    });
  });
});
