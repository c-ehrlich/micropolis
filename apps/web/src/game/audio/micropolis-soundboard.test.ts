import { describe, expect, it } from 'vitest';

import {
  normalizeMicropolisSoundTokenForWav,
  resolveMicropolisSoundTokenForToolAck,
  resolveMicropolisSoundTokenForToolRejectReason,
  resolveMicropolisSoundTokensForMessageId,
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

  it('maps tool-reject reasons to Micropolis error sounds', () => {
    // Mirrors `DoTool` / `ToolDown` in `ref/micropolis/src/sim/w_tool.c`:
    // `-1` -> `UhUh`, `-2` -> `Sorry`.
    expect(resolveMicropolisSoundTokenForToolRejectReason('out-of-bounds')).toBe('UhUh');
    expect(resolveMicropolisSoundTokenForToolRejectReason('no-funds')).toBe('Sorry');
    expect(resolveMicropolisSoundTokenForToolRejectReason('invalid-placement')).toBe('UhUh');
    expect(resolveMicropolisSoundTokenForToolRejectReason('unknown-reason')).toBeNull();
  });

  it('maps playable tool acknowledgements to shipped sound tokens', () => {
    // Mirrors `UIDidToolDozr` -> `UIMakeSoundOn ... Rumble` intent in
    // `ref/micropolis/res/micropolis.tcl`, adapted to shipped browser assets.
    expect(resolveMicropolisSoundTokenForToolAck('bulldoze')).toBe('Bulldozer');
    expect(resolveMicropolisSoundTokenForToolAck('road')).toBeNull();
  });

  it('maps message ids to first-display sound tokens', () => {
    // `doMessage` in `ref/micropolis/src/sim/s_msg.c` triggers first-time sounds:
    // 11 -> Siren, 21 -> Monster, 43 -> Explosion-High + Explosion-Low + Siren.
    expect(resolveMicropolisSoundTokensForMessageId(11)).toEqual(['Siren']);
    expect(resolveMicropolisSoundTokensForMessageId(-21)).toEqual([
      'Monster -speed [MonsterSpeed]',
    ]);
    expect(resolveMicropolisSoundTokensForMessageId(43)).toEqual(['Explosion-High', 'Siren']);
    expect(resolveMicropolisSoundTokensForMessageId(9)).toEqual([]);
  });
});
