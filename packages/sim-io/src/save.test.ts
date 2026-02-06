import { describe, expect, it } from 'vitest';

import type { SimContext } from '../../sim-core/src/core/sim-context.ts';
import type { SimState } from '../../sim-core/src/core/sim-state.ts';
import {
  CITY_FILE_HEADER_BYTES,
  CITY_HISTORY_LENGTH,
  createClassicMapStore,
  createSimContext,
  createSimState,
  getOrThrow,
} from '../../sim-core/src/index.ts';
import { saveCityAsLikeC, saveCityLikeC, saveFileLikeC } from './save.ts';

/**
 * Fill history buffers with deterministic values for save parity checks.
 */
function seedHistories(state: SimState): void {
  for (let i = 0; i < CITY_HISTORY_LENGTH; i += 1) {
    const value = i % 2 === 0 ? i : -i;
    state.ResHis[i] = value;
    state.ComHis[i] = value + 3;
    state.IndHis[i] = value - 4;
    state.CrimeHis[i] = value + 5;
    state.PollutionHis[i] = value - 6;
    state.MoneyHis[i] = value + 7;
  }
}

/**
 * Fill the map layer with deterministic values for save parity checks.
 */
function seedMap(context: SimContext): void {
  context.store.beginTick();
  try {
    const map = context.store.getLayer('map') as Uint16Array;
    for (let i = 0; i < map.length; i += 1) {
      map[i] = (i * 37) & 0xffff;
    }
    map[0] = 0x8001;
    map[1] = 0xabcd;
  } finally {
    context.store.commitTick();
  }
}

describe('save orchestration', () => {
  it('packs MiscHis values and writes big-endian city bytes like C saveFile', () => {
    const store = createClassicMapStore();
    const context = createSimContext({ store });
    const state = createSimState();

    seedHistories(state);
    seedMap(context);

    state.CityTime = 0x12345678;
    state.TotalFunds = -200;
    state.autoBulldoze = true;
    state.autoBudget = false;
    state.autoGo = true;
    state.userSoundOn = false;
    state.CityTax = 12;
    state.SimSpeed = 1;
    state.policePercent = 1.5;
    state.firePercent = 0.25;
    state.roadPercent = -0.5;

    const result = saveFileLikeC(state, context);
    const view = new DataView(
      result.cityBytes.buffer,
      result.cityBytes.byteOffset,
      result.cityBytes.byteLength,
    );

    // Magic number from `_load_file` size switch in `ref/micropolis/src/sim/s_fileio.c`:
    // a normal city file is exactly 27120 bytes.
    expect(result.cityBytes.byteLength).toBe(27120);

    // These packed words are from `saveFile` in `ref/micropolis/src/sim/s_fileio.c`:
    // `MiscHis[8..9]` CityTime, `MiscHis[50..51]` TotalFunds, and fixed-point 16.16
    // funding percents in `MiscHis[58..63]` using `value * 65536`.
    expect(getOrThrow(state.MiscHis[8]) & 0xffff).toBe(0x1234);
    expect(getOrThrow(state.MiscHis[9]) & 0xffff).toBe(0x5678);
    expect(getOrThrow(state.MiscHis[50]) & 0xffff).toBe(0xffff);
    expect(getOrThrow(state.MiscHis[51]) & 0xffff).toBe(0xff38);
    expect(getOrThrow(state.MiscHis[58]) & 0xffff).toBe(0x0001);
    expect(getOrThrow(state.MiscHis[59]) & 0xffff).toBe(0x8000);
    expect(getOrThrow(state.MiscHis[60]) & 0xffff).toBe(0x0000);
    expect(getOrThrow(state.MiscHis[61]) & 0xffff).toBe(0x4000);
    expect(getOrThrow(state.MiscHis[62]) & 0xffff).toBe(0xffff);
    expect(getOrThrow(state.MiscHis[63]) & 0xffff).toBe(0x8000);

    // Magic number from `HISTLEN` in C (`240 shorts = 480 bytes`):
    // `MiscHis` starts after six history arrays at offset `6 * 480 = 2880` (`0x0B40`).
    const miscOffset = CITY_HISTORY_LENGTH * 6 * 2;
    expect(view.getUint16(miscOffset + 8 * 2, false)).toBe(0x1234);
    expect(view.getUint16(miscOffset + 9 * 2, false)).toBe(0x5678);
    expect(view.getUint16(miscOffset + 50 * 2, false)).toBe(0xffff);
    expect(view.getUint16(miscOffset + 51 * 2, false)).toBe(0xff38);
    expect(view.getUint16(miscOffset + 58 * 2, false)).toBe(0x0001);
    expect(view.getUint16(miscOffset + 59 * 2, false)).toBe(0x8000);

    // `CITY_FILE_HEADER_BYTES` matches the C layout where map data follows histories + misc.
    expect(view.getUint16(CITY_FILE_HEADER_BYTES, false)).toBe(0x8001);
    expect(view.getUint16(CITY_FILE_HEADER_BYTES + 2, false)).toBe(0xabcd);
  });

  it('mirrors SaveCity control flow with and without a known filename', () => {
    const store = createClassicMapStore();
    const context = createSimContext({ store });
    const state = createSimState();

    seedHistories(state);
    seedMap(context);

    const needsSaveAs = saveCityLikeC(state, context, null);
    expect(needsSaveAs.action).toBe('save-as-required');

    const saved = saveCityLikeC(state, context, '/tmp/example.cty');
    expect(saved.action).toBe('saved');
    if (saved.action === 'saved') {
      expect(saved.cityFileName).toBe('/tmp/example.cty');
      expect(saved.cityBytes.byteLength).toBe(27120);
    }
  });

  it('mirrors SaveCityAs city-name derivation quirks', () => {
    const store = createClassicMapStore();
    const context = createSimContext({ store });
    const state = createSimState();

    seedHistories(state);
    seedMap(context);

    const normal = saveCityAsLikeC(state, context, '/tmp/city.with.dots/alpha.beta.cty');
    expect(normal.cityName).toBe('alpha.beta');

    // C `SaveCityAs` truncates at the last dot before basename extraction, so
    // `/tmp/a.b/city` becomes `/tmp/a` and then basename `a`.
    const dottedDirOnly = saveCityAsLikeC(state, context, '/tmp/a.b/city');
    expect(dottedDirOnly.cityName).toBe('a');
  });
});
