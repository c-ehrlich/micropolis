import {
  runCoreOracleInitNewCity,
  runCoreOracleStepPhase,
} from '@city/micropolis-c-harness/core-parity';
import { describe, expect, it } from 'vitest';

import { Tile, TileFlag, World } from '../core/constants.ts';
import { MAP_FLAGS } from '../core/map-flags.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { createRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState, type SimState } from '../core/sim-state.ts';
import { crimeScan } from '../systems/crime.ts';
import { fireAnalysis } from '../systems/fire-coverage.ts';
import { popDenScan } from '../systems/pop-density.ts';
import { ptlScan } from '../systems/ptl.ts';
import { decTrafficMem as decTrafficMemSystem } from '../systems/traffic.ts';
import { decROGMem as decROGMemSystem } from '../systems/zones.ts';
import {
  dispatchSimPhase,
  MAP_DIRTY_PHASE_10,
  MAP_DIRTY_PHASE_11,
  runSimFrame,
  type SimPhaseSystems,
} from './simulate.ts';

const { WORLD_Y, HWLDY, QWY, SmY } = World;

const mapIndex = (x: number, y: number): number => x * WORLD_Y + y;
const halfIndex = (x: number, y: number): number => x * HWLDY + y;
const quarterIndex = (x: number, y: number): number => x * QWY + y;
const smallIndex = (x: number, y: number): number => x * SmY + y;

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

  it('resets out-of-range Scycle to 0 in phase 0', () => {
    const context = createSimContext();
    const calls: string[] = [];
    const state = makeState({
      Scycle: 2000,
      CityTime: 9,
      CityTax: 7,
      AvCityTax: 0,
    });

    dispatchSimPhase(0, state, context, makeSystems(calls));

    // In `Simulate` (`ref/micropolis/src/sim/s_sim.c`):
    // `if (++Scycle > 1023) Scycle = 0;`
    expect(state.Scycle).toBe(0);
    expect(state.CityTime).toBe(10);
    expect(calls).toEqual(['setValves', 'clearCensus']);
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

  it('resets out-of-range Spdcycle/Fcycle to 0 instead of bitmasking', () => {
    const context = createSimContext();
    const calls: string[] = [];
    const state = makeState({
      SimSpeed: 3,
      Spdcycle: 2000,
      Fcycle: 2000,
      Scycle: 1023,
      CityTime: 0,
    });

    const ran = runSimFrame(state, context, makeSystems(calls));

    // In `SimFrame` (`ref/micropolis/src/sim/s_sim.c`):
    // `if (++Spdcycle > 1023) Spdcycle = 0;`
    // `if (++Fcycle > 1023) Fcycle = 0;`
    expect(ran).toBe(true);
    expect(state.Spdcycle).toBe(0);
    expect(state.Fcycle).toBe(0);
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

  it('matches phase 12..15 scan-derived snapshots and map flags', () => {
    const seed = 0x2468ace0;
    const zoneFlags = TileFlag.ZONEBIT | TileFlag.BURNBIT;
    const oracleBefore = runCoreOracleInitNewCity({ seed, simSpeed: 0 });
    oracleBefore.Scycle = 0;
    oracleBefore.DonDither = 0;
    oracleBefore.CCx = 40;
    oracleBefore.CCy = 28;
    oracleBefore.CCx2 = oracleBefore.CCx >> 1;
    oracleBefore.CCy2 = oracleBefore.CCy >> 1;

    oracleBefore.map[mapIndex(20, 20)] = Tile.RZB | zoneFlags;
    oracleBefore.map[mapIndex(24, 20)] = Tile.CZB | zoneFlags;
    oracleBefore.map[mapIndex(28, 20)] = Tile.IZB | zoneFlags;
    oracleBefore.map[mapIndex(32, 24)] = Tile.FREEZ | zoneFlags;
    oracleBefore.map[mapIndex(31, 23)] = Tile.LHTHR;
    oracleBefore.map[mapIndex(32, 23)] = Tile.HHTHR;
    oracleBefore.map[mapIndex(33, 23)] = Tile.LHTHR;
    oracleBefore.map[mapIndex(18, 18)] = Tile.HTRFBASE;
    oracleBefore.map[mapIndex(18, 19)] = Tile.ROADS;
    oracleBefore.map[mapIndex(19, 18)] = Tile.RADTILE;
    oracleBefore.map[mapIndex(30, 22)] = Tile.POWERPLANT;

    oracleBefore.terrainMem[quarterIndex(4, 4)] = 40;
    oracleBefore.terrainMem[quarterIndex(5, 5)] = 80;
    oracleBefore.pollutionMem[halfIndex(10, 10)] = 55;
    oracleBefore.crimeMem[halfIndex(10, 10)] = 200;
    oracleBefore.popDensity[halfIndex(10, 10)] = 90;
    oracleBefore.popDensity[halfIndex(16, 12)] = 120;
    oracleBefore.popDensity[halfIndex(18, 12)] = 100;
    oracleBefore.policeMap[smallIndex(2, 2)] = 64;
    oracleBefore.policeMap[smallIndex(3, 2)] = 32;
    oracleBefore.fireStMap[smallIndex(2, 2)] = 120;
    oracleBefore.fireStMap[smallIndex(3, 3)] = 80;

    const store = createClassicMapStore();
    const state = createSimState();
    const context = createSimContext({ store, rng: createRng(seed) });
    state.CityTime = oracleBefore.CityTime;
    state.CityTax = oracleBefore.CityTax;
    state.AvCityTax = oracleBefore.AvCityTax;
    state.Scycle = oracleBefore.Scycle;
    state.Fcycle = oracleBefore.Fcycle;
    state.SimSpeed = oracleBefore.SimSpeed;
    state.DoInitialEval = oracleBefore.DoInitialEval;
    state.NewPower = oracleBefore.NewPower;
    state.CChr9 = oracleBefore.CChr9;
    state.CoalPop = oracleBefore.CoalPop;
    state.NuclearPop = oracleBefore.NuclearPop;
    state.PwrdZCnt = oracleBefore.PwrdZCnt;
    state.unPwrdZCnt = oracleBefore.unPwrdZCnt;
    state.LVAverage = oracleBefore.LVAverage;
    state.CrimeAverage = oracleBefore.CrimeAverage;
    state.PolluteAverage = oracleBefore.PolluteAverage;
    state.CCx = oracleBefore.CCx;
    state.CCy = oracleBefore.CCy;
    state.CCx2 = oracleBefore.CCx2;
    state.CCy2 = oracleBefore.CCy2;
    state.PolMaxX = oracleBefore.PolMaxX;
    state.PolMaxY = oracleBefore.PolMaxY;
    state.CrimeMaxX = oracleBefore.CrimeMaxX;
    state.CrimeMaxY = oracleBefore.CrimeMaxY;
    state.DonDither = oracleBefore.DonDither;
    state.NewMapFlags.fill(0);

    store.beginTick();
    (store.getLayer('map') as Uint16Array).set(oracleBefore.map);
    (store.getLayer('popDensity') as Uint8Array).set(oracleBefore.popDensity);
    (store.getLayer('pollutionMem') as Uint8Array).set(oracleBefore.pollutionMem);
    (store.getLayer('landValueMem') as Uint8Array).set(oracleBefore.landValueMem);
    (store.getLayer('crimeMem') as Uint8Array).set(oracleBefore.crimeMem);
    (store.getLayer('terrainMem') as Uint8Array).set(oracleBefore.terrainMem);
    (store.getLayer('fireStMap') as Int16Array).set(oracleBefore.fireStMap);
    (store.getLayer('policeMap') as Int16Array).set(oracleBefore.policeMap);
    (store.getLayer('policeMapEffect') as Int16Array).set(oracleBefore.policeMapEffect);
    (store.getLayer('fireRate') as Int16Array).set(oracleBefore.fireRate);
    (store.getLayer('comRate') as Int16Array).set(oracleBefore.comRate);

    const oracleMapFlags = (oracleFlags: typeof oracleBefore.NewMapFlags) => [
      oracleFlags.ALMAP,
      oracleFlags.REMAP,
      oracleFlags.COMAP,
      oracleFlags.INMAP,
      oracleFlags.PRMAP,
      oracleFlags.RDMAP,
      oracleFlags.PDMAP,
      oracleFlags.RGMAP,
      oracleFlags.TDMAP,
      oracleFlags.PLMAP,
      oracleFlags.CRMAP,
      oracleFlags.LVMAP,
      oracleFlags.FIMAP,
      oracleFlags.POMAP,
      oracleFlags.DYMAP,
    ];

    let oracleAfter = oracleBefore;
    for (const phase of [12, 13, 14, 15]) {
      oracleAfter = runCoreOracleStepPhase(oracleAfter, phase);
      dispatchSimPhase(phase, state, context, { ptlScan, crimeScan, popDenScan, fireAnalysis });

      expect(Array.from(state.NewMapFlags)).toEqual(oracleMapFlags(oracleAfter.NewMapFlags));

      if (phase === 12) {
        expect(Array.from(store.getLayer('pollutionMem') as Uint8Array)).toEqual(
          Array.from(oracleAfter.pollutionMem),
        );
        expect(Array.from(store.getLayer('landValueMem') as Uint8Array)).toEqual(
          Array.from(oracleAfter.landValueMem),
        );
        expect(Array.from(store.getLayer('terrainMem') as Uint8Array)).toEqual(
          Array.from(oracleAfter.terrainMem),
        );
        expect(state.LVAverage).toBe(oracleAfter.LVAverage);
        expect(state.PolluteAverage).toBe(oracleAfter.PolluteAverage);
        expect(state.PolMaxX).toBe(oracleAfter.PolMaxX);
        expect(state.PolMaxY).toBe(oracleAfter.PolMaxY);
      }

      if (phase === 13) {
        expect(Array.from(store.getLayer('crimeMem') as Uint8Array)).toEqual(
          Array.from(oracleAfter.crimeMem),
        );
        expect(Array.from(store.getLayer('policeMap') as Int16Array)).toEqual(
          Array.from(oracleAfter.policeMap),
        );
        expect(Array.from(store.getLayer('policeMapEffect') as Int16Array)).toEqual(
          Array.from(oracleAfter.policeMapEffect),
        );
        expect(state.CrimeAverage).toBe(oracleAfter.CrimeAverage);
        expect(state.CrimeMaxX).toBe(oracleAfter.CrimeMaxX);
        expect(state.CrimeMaxY).toBe(oracleAfter.CrimeMaxY);
      }

      if (phase === 14) {
        expect(Array.from(store.getLayer('popDensity') as Uint8Array)).toEqual(
          Array.from(oracleAfter.popDensity),
        );
        expect(Array.from(store.getLayer('comRate') as Int16Array)).toEqual(
          Array.from(oracleAfter.comRate),
        );
        expect(state.CCx).toBe(oracleAfter.CCx);
        expect(state.CCy).toBe(oracleAfter.CCy);
        expect(state.CCx2).toBe(oracleAfter.CCx2);
        expect(state.CCy2).toBe(oracleAfter.CCy2);
      }

      if (phase === 15) {
        expect(Array.from(store.getLayer('fireStMap') as Int16Array)).toEqual(
          Array.from(oracleAfter.fireStMap),
        );
        expect(Array.from(store.getLayer('fireRate') as Int16Array)).toEqual(
          Array.from(oracleAfter.fireRate),
        );
      }
    }

    store.commitTick();
  });
});
