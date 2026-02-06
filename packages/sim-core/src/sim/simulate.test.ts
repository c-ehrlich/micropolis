import {
  runCoreOracleInitNewCity,
  runCoreOracleStepPhase,
} from '@city/micropolis-c-harness/core-parity';
import { describe, expect, it } from 'vitest';

import { MAP_FLAGS } from '../core/map-flags.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState, type SimState } from '../core/sim-state.ts';
import { decTrafficMem as decTrafficMemSystem } from '../systems/traffic.ts';
import { decROGMem as decROGMemSystem } from '../systems/zones.ts';
import {
  dispatchSimPhase,
  MAP_DIRTY_PHASE_10,
  MAP_DIRTY_PHASE_11,
  runSimFrame,
  type SimPhaseSystems,
} from './simulate.ts';

const makeState = (overrides: Partial<SimState> = {}) => {
  const state = createSimState();
  Object.assign(state, overrides);
  return state;
};

const makeSystems = (calls: string[]): SimPhaseSystems => ({
  mapScan: (phase) => calls.push(`mapScan:${phase}`),
  setValves: () => calls.push('setValves'),
  clearCensus: () => calls.push('clearCensus'),
  takeCensus: () => calls.push('takeCensus'),
  take2Census: () => calls.push('take2Census'),
  collectTax: () => calls.push('collectTax'),
  cityEvaluation: () => calls.push('cityEvaluation'),
  decROGMem: () => calls.push('decROGMem'),
  decTrafficMem: () => calls.push('decTrafficMem'),
  markMapDirty: (flags) => calls.push(`markMapDirty:${flags.join(',')}`),
  sendMessages: () => calls.push('sendMessages'),
  doPowerScan: () => calls.push('doPowerScan'),
  ptlScan: () => calls.push('ptlScan'),
  crimeScan: () => calls.push('crimeScan'),
  popDenScan: () => calls.push('popDenScan'),
  fireAnalysis: () => calls.push('fireAnalysis'),
  doDisasters: () => calls.push('doDisasters'),
});

describe('Simulate dispatcher phases', () => {
  it('runs phase 0 updates and calls with correct order', () => {
    const context = createSimContext();
    const calls: string[] = [];
    const state = makeState({
      CityTime: 9,
      CityTax: 7,
      AvCityTax: 0,
      Scycle: 1,
      DoInitialEval: 1,
    });

    dispatchSimPhase(0, state, context, makeSystems(calls));

    expect(state.Scycle).toBe(2);
    expect(state.CityTime).toBe(10);
    expect(state.AvCityTax).toBe(7);
    expect(state.DoInitialEval).toBe(0);
    expect(calls).toEqual(['cityEvaluation', 'setValves', 'clearCensus']);
  });

  it('dispatches map scan across phases 1..8', () => {
    const context = createSimContext();

    for (let phase = 1; phase <= 8; phase += 1) {
      const calls: string[] = [];
      const state = makeState();
      dispatchSimPhase(phase, state, context, makeSystems(calls));
      expect(calls).toEqual([`mapScan:${phase}`]);
    }
  });

  it('runs census and tax actions on phase 9 boundaries', () => {
    const context = createSimContext();
    const calls: string[] = [];
    const state = makeState({ CityTime: 48 });

    dispatchSimPhase(9, state, context, makeSystems(calls));

    expect(calls).toEqual(['takeCensus', 'take2Census', 'collectTax', 'cityEvaluation']);
  });

  it('runs phase 10 decay + dirty map flags', () => {
    const context = createSimContext();
    const calls: string[] = [];
    const state = makeState({ Scycle: 10 });

    dispatchSimPhase(10, state, context, makeSystems(calls));

    expect(calls).toEqual([
      'decROGMem',
      'decTrafficMem',
      `markMapDirty:${MAP_DIRTY_PHASE_10.join(',')}`,
      'sendMessages',
    ]);
  });

  it('runs phase 11 power scan and marks power dirty flag', () => {
    const context = createSimContext();
    const calls: string[] = [];
    const state = makeState({ Scycle: 5, SimSpeed: 3, NewPower: 0 });

    dispatchSimPhase(11, state, context, makeSystems(calls));

    expect(calls).toEqual(['doPowerScan', `markMapDirty:${MAP_DIRTY_PHASE_11.join(',')}`]);
    expect(state.NewPower).toBe(1);
  });

  it('gates phase 12..15 work using the speed tables', () => {
    const context = createSimContext();
    const calls: string[] = [];
    const systems = makeSystems(calls);

    const state = makeState({ SimSpeed: 3 });

    state.Scycle = 17;
    dispatchSimPhase(12, state, context, systems);
    state.Scycle = 18;
    dispatchSimPhase(13, state, context, systems);
    state.Scycle = 19;
    dispatchSimPhase(14, state, context, systems);
    state.Scycle = 20;
    dispatchSimPhase(15, state, context, systems);

    expect(calls).toEqual(['ptlScan', 'crimeScan', 'popDenScan', 'fireAnalysis', 'doDisasters']);
  });

  it('skips gated scans when Scycle is not divisible', () => {
    const context = createSimContext();
    const calls: string[] = [];
    const systems = makeSystems(calls);
    const state = makeState({ SimSpeed: 3, NewPower: 0 });

    state.Scycle = 6;
    dispatchSimPhase(11, state, context, systems);
    state.Scycle = 16;
    dispatchSimPhase(12, state, context, systems);
    state.Scycle = 17;
    dispatchSimPhase(13, state, context, systems);
    state.Scycle = 18;
    dispatchSimPhase(14, state, context, systems);
    state.Scycle = 19;
    dispatchSimPhase(15, state, context, systems);

    expect(calls).toEqual(['doDisasters']);
    expect(state.NewPower).toBe(0);
  });

  it('always runs disasters even when fire analysis is gated off', () => {
    const context = createSimContext();
    const calls: string[] = [];
    const systems = makeSystems(calls);
    const state = makeState({ SimSpeed: 3 });

    state.Scycle = 19;
    dispatchSimPhase(15, state, context, systems);

    expect(calls).toEqual(['doDisasters']);
  });
});

describe('SimFrame gating and cycles', () => {
  it('gates SimSpeed 1 and only advances Fcycle on allowed frames', () => {
    const context = createSimContext();
    const state = makeState({ SimSpeed: 1, Fcycle: 0, Spdcycle: 0 });
    const calls: string[] = [];
    const systems = makeSystems(calls);

    const results: boolean[] = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(runSimFrame(state, context, systems));
    }

    expect(results).toEqual([false, false, false, false, true]);
    expect(state.Spdcycle).toBe(5);
    expect(state.Fcycle).toBe(1);
    expect(calls).toEqual(['mapScan:1']);
  });

  it('gates SimSpeed 2 to every 3rd spdCycle', () => {
    const context = createSimContext();
    const state = makeState({ SimSpeed: 2, Fcycle: 0, Spdcycle: 0 });
    const calls: string[] = [];
    const systems = makeSystems(calls);

    const results: boolean[] = [];
    for (let i = 0; i < 6; i += 1) {
      results.push(runSimFrame(state, context, systems));
    }

    expect(results).toEqual([false, false, true, false, false, true]);
    expect(state.Spdcycle).toBe(6);
    expect(state.Fcycle).toBe(2);
    expect(calls).toEqual(['mapScan:1', 'mapScan:2']);
  });

  it('wraps Spdcycle and Fcycle at 1023', () => {
    const context = createSimContext();
    const calls: string[] = [];
    const state = makeState({
      SimSpeed: 3,
      Spdcycle: 1023,
      Fcycle: 1023,
      Scycle: 1023,
      CityTime: 0,
    });

    const ran = runSimFrame(state, context, makeSystems(calls));

    expect(ran).toBe(true);
    expect(state.Spdcycle).toBe(0);
    expect(state.Fcycle).toBe(0);
    expect(state.Scycle).toBe(0);
    expect(state.CityTime).toBe(1);
    expect(calls).toEqual(['setValves', 'clearCensus']);
  });
});

describe('Simulate parity against C oracle (env-gated)', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm test-parity` to enable C parity tests', () => {});
    return;
  }

  it('matches phase 10 traffic/ROG decay and map dirty flags', () => {
    const oracleBefore = runCoreOracleInitNewCity({
      seed: 0x1234abcd,
      cityTime: 48,
      cityTax: 7,
      simSpeed: 3,
    });
    oracleBefore.Scycle = 10;
    oracleBefore.trfDensity[0] = 24;
    oracleBefore.trfDensity[1] = 25;
    oracleBefore.trfDensity[2] = 200;
    oracleBefore.trfDensity[3] = 201;
    oracleBefore.rateOGMem[0] = 201;
    oracleBefore.rateOGMem[1] = -201;

    const oracleAfter = runCoreOracleStepPhase(oracleBefore, 10);

    const store = createClassicMapStore();
    const context = createSimContext({ store });
    const state = createSimState();
    state.CityTime = oracleBefore.CityTime;
    state.CityTax = oracleBefore.CityTax;
    state.AvCityTax = oracleBefore.AvCityTax;
    state.Scycle = oracleBefore.Scycle;
    state.Fcycle = oracleBefore.Fcycle;
    state.SimSpeed = oracleBefore.SimSpeed;
    state.DoInitialEval = oracleBefore.DoInitialEval;
    state.NewPower = oracleBefore.NewPower;
    state.NewMapFlags.fill(0);

    store.beginTick();
    (store.getLayer('trfDensity') as Uint8Array).set(oracleBefore.trfDensity);
    (store.getLayer('rateOGMem') as Int16Array).set(oracleBefore.rateOGMem);
    dispatchSimPhase(10, state, context, {
      decROGMem: decROGMemSystem,
      decTrafficMem: decTrafficMemSystem,
      markMapDirty: (flags) => {
        for (const flag of flags) {
          state.NewMapFlags[MAP_FLAGS[flag]] = 1;
        }
      },
    });

    const tsTrfDensity = store.getLayer('trfDensity') as Uint8Array;
    const tsRateOGMem = store.getLayer('rateOGMem') as Int16Array;

    // Magic threshold values come directly from `DecTrafficMem` and `DecROGMem`
    // in `ref/micropolis/src/sim/s_sim.c`:
    // - traffic decay uses 24/200 cutoffs and decrements 24 or 34
    // - ROG decay clamps overflowed values to +/-200
    expect(Array.from(tsTrfDensity)).toEqual(Array.from(oracleAfter.trfDensity));
    expect(Array.from(tsRateOGMem)).toEqual(Array.from(oracleAfter.rateOGMem));

    expect(state.NewMapFlags[MAP_FLAGS.ALMAP]).toBe(oracleAfter.NewMapFlags.ALMAP);
    expect(state.NewMapFlags[MAP_FLAGS.REMAP]).toBe(oracleAfter.NewMapFlags.REMAP);
    expect(state.NewMapFlags[MAP_FLAGS.COMAP]).toBe(oracleAfter.NewMapFlags.COMAP);
    expect(state.NewMapFlags[MAP_FLAGS.INMAP]).toBe(oracleAfter.NewMapFlags.INMAP);
    expect(state.NewMapFlags[MAP_FLAGS.RDMAP]).toBe(oracleAfter.NewMapFlags.RDMAP);
    expect(state.NewMapFlags[MAP_FLAGS.TDMAP]).toBe(oracleAfter.NewMapFlags.TDMAP);
    expect(state.NewMapFlags[MAP_FLAGS.DYMAP]).toBe(oracleAfter.NewMapFlags.DYMAP);
    store.commitTick();
  });
});
