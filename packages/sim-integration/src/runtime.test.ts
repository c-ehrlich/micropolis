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

describe('integration runtime Sugar stdout handling', () => {
  it('surfaces strict-mode malformed PlaySound parity failure', () => {
    // Mirrors micropolisactivity.py `_stdout_thread_function` behavior where
    // `play_sound(words[1])` on "PlaySound" raises IndexError and aborts loop.
    const runtime = createIntegrationRuntime({
      mode: 'strict',
      features: {
        sugar: true,
      },
    });

    expect(() => runtime.handleOutputLine('PlaySound')).toThrowError(
      new RangeError('list index out of range'),
    );
  });

  it('passes through valid PlaySound token to the sound hook', () => {
    const soundTokens: string[] = [];
    const runtime = createIntegrationRuntime({
      features: {
        sugar: true,
      },
      hooks: {
        onSoundToken(soundName) {
          soundTokens.push(soundName);
        },
      },
    });

    runtime.handleOutputLine('PlaySound Bulldozer');
    expect(soundTokens).toEqual(['Bulldozer']);
  });

  it('keeps processing after malformed PlaySound in safe mode', () => {
    const soundTokens: string[] = [];
    const runtime = createIntegrationRuntime({
      mode: 'safe',
      features: {
        sugar: true,
      },
      hooks: {
        onSoundToken(soundName) {
          soundTokens.push(soundName);
        },
      },
    });

    expect(() => runtime.handleOutputLine('PlaySound')).not.toThrow();
    runtime.handleOutputLine('PlaySound Siren');
    expect(soundTokens).toEqual(['Siren']);
  });
});
