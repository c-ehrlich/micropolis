import { describe, expect, it } from 'vitest';

import { createSimState } from '../core/sim-state.ts';
import { createCityFile, readCityMeta, writeCityMeta } from './cty.ts';
import { applyLoadedCityMetaToState, cityMetaFromState } from './cty-state.ts';

describe('cty-state', () => {
  it('applies loaded .cty metadata to SimState with C-style load normalization', () => {
    // Micropolis load path:
    // - s_fileio.c loadFile() reads these values from MiscHis[8..] and MiscHis[50..]
    // - then clamps CityTime/CityTax/SimSpeed and calls InitFundingLevel() (resets percents to 1)
    // - and sets MustUpdateOptions=1 so w_update.c updateOptions emits the options head on the next update
    const city = createCityFile({ width: 120, height: 100 });
    writeCityMeta(city.misc, {
      cityTime: -5,
      totalFunds: 1234,
      autoBulldoze: false,
      autoBudget: true,
      autoGo: true,
      userSoundOn: false,
      // s_fileio.c loadFile clamps invalid tax/speed to defaults.
      // Magic numbers: CityTax valid range is 0..20, default is 7; SimSpeed valid range is 0..3, default is 3.
      cityTax: 99,
      simSpeed: -1,
      policePercent: 0.5,
      firePercent: 0.25,
      roadPercent: 0,
    });
    const meta = readCityMeta(city.misc);

    const state = createSimState();
    state.CityTime = 999;
    state.TotalFunds = 0;
    state.autoBudget = false;
    state.autoBulldoze = true;
    state.autoGo = false;
    state.userSoundOn = true;
    state.CityTax = 7;
    state.SimSpeed = 3;
    state.policePercent = 0;
    state.firePercent = 0;
    state.roadPercent = 0;
    state.MustUpdateOptions = 0;

    applyLoadedCityMetaToState(state, meta);

    expect(state.CityTime).toBe(0);
    expect(state.TotalFunds).toBe(1234);
    expect(state.autoBulldoze).toBe(false);
    expect(state.autoBudget).toBe(true);
    expect(state.autoGo).toBe(true);
    expect(state.userSoundOn).toBe(false);
    expect(state.CityTax).toBe(7);
    expect(state.SimSpeed).toBe(3);
    // s_fileio.c loadFile calls InitFundingLevel(), which resets these to 1 on load.
    expect(state.policePercent).toBe(1);
    expect(state.firePercent).toBe(1);
    expect(state.roadPercent).toBe(1);
    expect(state.MustUpdateOptions).toBe(1);
  });

  it('round-trips option flags through cityMetaFromState', () => {
    const state = createSimState();
    state.autoBulldoze = false;
    state.autoBudget = true;
    state.autoGo = false;
    state.userSoundOn = false;

    const meta = cityMetaFromState(state);
    expect(meta.autoBulldoze).toBe(false);
    expect(meta.autoBudget).toBe(true);
    expect(meta.autoGo).toBe(false);
    expect(meta.userSoundOn).toBe(false);
  });
});
