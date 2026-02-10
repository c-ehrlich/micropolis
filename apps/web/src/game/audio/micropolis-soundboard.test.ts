import { describe, expect, it } from 'vitest';

import {
  normalizeMicropolisSoundTokenForWav,
  SOUND_PREVIEW_SPECS,
  toMicropolisSoundPreviewWavPath,
} from './micropolis-soundboard.ts';

describe('micropolis soundboard helper parity', () => {
  it('uses first-token lowercase normalization for wav lookup', () => {
    // Tcl `EchoPlaySound` forwards first list element, and Sugar lowercases it
    // before opening `<name>.wav` (`ref/micropolis/res/micropolis.tcl`,
    // `ref/micropolis/micropolisactivity.py`).
    expect(normalizeMicropolisSoundTokenForWav('Monster -speed 120')).toBe('monster');
    expect(normalizeMicropolisSoundTokenForWav('  HonkHonk-Low   -speed 80 ')).toBe('honkhonk-low');
  });

  it('builds public wav paths from normalized token names', () => {
    expect(toMicropolisSoundPreviewWavPath('Explosion-High')).toBe('/sounds/explosion-high.wav');
    expect(toMicropolisSoundPreviewWavPath('Siren')).toBe('/sounds/siren.wav');
  });

  it('keeps runtime preview specs mapped to valid wav stems', () => {
    expect(SOUND_PREVIEW_SPECS.length).toBeGreaterThanOrEqual(3);
    for (const spec of SOUND_PREVIEW_SPECS) {
      expect(spec.label.length).toBeGreaterThan(0);
      expect(toMicropolisSoundPreviewWavPath(spec.token).endsWith('.wav')).toBe(true);
    }
  });
});
