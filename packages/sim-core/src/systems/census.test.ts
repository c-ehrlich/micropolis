import {
  runCoreOracleInitNewCity,
  runCoreOracleTake2Census,
  runCoreOracleTakeCensus,
} from '@city/micropolis-c-harness/core-parity';
import { describe, expect, it, vi } from 'vitest';

import { createClassicMapStore } from '../core/map-store.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { clearCensus, take2Census, takeCensus } from './census.ts';

describe('Census system', () => {
  it('clears per-tick counters and resets fire/police maps', () => {
    const store = createClassicMapStore();
    const state = createSimState();
    const context = createSimContext({ store });

    state.PwrdZCnt = 4;
    state.unPwrdZCnt = 3;
    state.FirePop = 7;
    state.RoadTotal = 11;
    state.RailTotal = 12;
    state.ResPop = 13;
    state.ComPop = 14;
    state.IndPop = 15;
    state.ResZPop = 16;
    state.ComZPop = 17;
    state.IndZPop = 18;
    state.HospPop = 19;
    state.ChurchPop = 20;
    state.PolicePop = 21;
    state.FireStPop = 22;
    state.StadiumPop = 23;
    state.CoalPop = 24;
    state.NuclearPop = 25;
    state.PortPop = 26;
    state.APortPop = 27;
    state.PowerStackNum = 6;

    store.beginTick();
    store.write('fireStMap', 0, 5);
    store.write('policeMap', 0, 9);

    clearCensus(state, context);

    expect(state.PwrdZCnt).toBe(0);
    expect(state.unPwrdZCnt).toBe(0);
    expect(state.FirePop).toBe(0);
    expect(state.RoadTotal).toBe(0);
    expect(state.RailTotal).toBe(0);
    expect(state.ResPop).toBe(0);
    expect(state.ComPop).toBe(0);
    expect(state.IndPop).toBe(0);
    expect(state.ResZPop).toBe(0);
    expect(state.ComZPop).toBe(0);
    expect(state.IndZPop).toBe(0);
    expect(state.HospPop).toBe(0);
    expect(state.ChurchPop).toBe(0);
    expect(state.PolicePop).toBe(0);
    expect(state.FireStPop).toBe(0);
    expect(state.StadiumPop).toBe(0);
    expect(state.CoalPop).toBe(0);
    expect(state.NuclearPop).toBe(0);
    expect(state.PortPop).toBe(0);
    expect(state.APortPop).toBe(0);
    expect(state.PowerStackNum).toBe(0);

    const fireStMap = store.getLayer('fireStMap') as Int16Array;
    const policeMap = store.getLayer('policeMap') as Int16Array;
    expect(fireStMap[0]).toBe(0);
    expect(policeMap[0]).toBe(0);
    store.commitTick();
  });

  it('shifts 10-year histories, updates ramps, graphs, and needs', () => {
    const store = createClassicMapStore();
    const changeCensus = vi.fn();
    const context = createSimContext({ store, hooks: { changeCensus } });
    const state = createSimState();

    // 10-year history range is 0..119 in Micropolis `TakeCensus`.
    const SHORT_HISTORY_MAX = 119;
    const SHORT_HISTORY_SHIFT_START = 118;

    state.ResHis[0] = 10;
    state.ResHis[SHORT_HISTORY_SHIFT_START] = 70;
    state.ResHis[SHORT_HISTORY_MAX] = 200;
    state.ComHis[0] = 20;
    state.ComHis[SHORT_HISTORY_SHIFT_START] = 90;
    state.ComHis[SHORT_HISTORY_MAX] = 150;
    state.IndHis[0] = 30;
    state.IndHis[SHORT_HISTORY_SHIFT_START] = 80;
    state.IndHis[SHORT_HISTORY_MAX] = 160;
    // Non-zero sentinels to verify history shifts copy prior values.
    state.CrimeHis[0] = 33;
    state.PollutionHis[0] = 44;
    state.MoneyHis[0] = 77;

    // ResPop/8 becomes 128 for history graph (1024 / 8).
    state.ResPop = 1024;
    state.ComPop = 12;
    state.IndPop = 7;
    // Crime ramp uses (CrimeAverage - CrimeRamp) / 4; equal values keep 300.
    state.CrimeRamp = 300;
    state.CrimeAverage = 300;
    // Pollute ramp uses (PolluteAverage - PolluteRamp) / 4: (18-10)/4 = 2.
    state.PolluteRamp = 10;
    state.PolluteAverage = 18;
    // CashFlow scales as (CashFlow/20) + 128 and clamps to 255: 5000/20 = 250.
    state.CashFlow = 5000;
    // ResPop >> 8 = 4, so HospPop 3 => NeedHosp=1, ChurchPop 5 => NeedChurch=-1.
    state.HospPop = 3;
    state.ChurchPop = 5;

    takeCensus(state, context);

    expect(state.ResHis[1]).toBe(10);
    expect(state.ResHis[SHORT_HISTORY_MAX]).toBe(70);
    expect(state.ComHis[1]).toBe(20);
    expect(state.ComHis[SHORT_HISTORY_MAX]).toBe(90);
    expect(state.IndHis[1]).toBe(30);
    expect(state.IndHis[SHORT_HISTORY_MAX]).toBe(80);
    expect(state.CrimeHis[1]).toBe(33);
    expect(state.PollutionHis[1]).toBe(44);
    expect(state.MoneyHis[1]).toBe(77);

    expect(state.ResHisMax).toBe(70);
    expect(state.ComHisMax).toBe(90);
    expect(state.IndHisMax).toBe(80);
    expect(state.Graph10Max).toBe(90);

    expect(state.ResHis[0]).toBe(128);
    expect(state.ComHis[0]).toBe(12);
    expect(state.IndHis[0]).toBe(7);
    expect(state.CrimeRamp).toBe(300);
    expect(state.CrimeHis[0]).toBe(255);
    expect(state.PolluteRamp).toBe(12);
    expect(state.PollutionHis[0]).toBe(12);
    expect(state.MoneyHis[0]).toBe(255);

    expect(state.NeedHosp).toBe(1);
    expect(state.NeedChurch).toBe(-1);
    expect(changeCensus).toHaveBeenCalledTimes(1);
  });

  it('shifts 120-year histories and copies current census values', () => {
    const store = createClassicMapStore();
    const changeCensus = vi.fn();
    const context = createSimContext({ store, hooks: { changeCensus } });
    const state = createSimState();

    // 120-year history range is 120..239 in Micropolis `Take2Census`.
    const LONG_HISTORY_START = 120;
    const LONG_HISTORY_SHIFT_START = 238;
    const LONG_HISTORY_MAX = 239;

    state.ResHis[LONG_HISTORY_START] = 5;
    state.ResHis[LONG_HISTORY_SHIFT_START] = 70;
    state.ResHis[LONG_HISTORY_MAX] = 200;
    state.ComHis[LONG_HISTORY_START] = 6;
    state.ComHis[LONG_HISTORY_SHIFT_START] = 90;
    state.ComHis[LONG_HISTORY_MAX] = 150;
    state.IndHis[LONG_HISTORY_START] = 7;
    state.IndHis[LONG_HISTORY_SHIFT_START] = 80;
    state.IndHis[LONG_HISTORY_MAX] = 160;
    // Non-zero sentinels to verify index-0 values copy into index 120.
    state.CrimeHis[0] = 11;
    state.PollutionHis[0] = 22;
    state.MoneyHis[0] = 33;

    // ResPop/8 becomes 10 for long-term graph (80 / 8).
    state.ResPop = 80;
    state.ComPop = 12;
    state.IndPop = 7;

    take2Census(state, context);

    expect(state.ResHis[LONG_HISTORY_START + 1]).toBe(5);
    expect(state.ResHis[LONG_HISTORY_MAX]).toBe(70);
    expect(state.ComHis[LONG_HISTORY_START + 1]).toBe(6);
    expect(state.ComHis[LONG_HISTORY_MAX]).toBe(90);
    expect(state.IndHis[LONG_HISTORY_START + 1]).toBe(7);
    expect(state.IndHis[LONG_HISTORY_MAX]).toBe(80);

    expect(state.Res2HisMax).toBe(70);
    expect(state.Com2HisMax).toBe(90);
    expect(state.Ind2HisMax).toBe(80);
    expect(state.Graph120Max).toBe(90);

    expect(state.ResHis[LONG_HISTORY_START]).toBe(10);
    expect(state.ComHis[LONG_HISTORY_START]).toBe(12);
    expect(state.IndHis[LONG_HISTORY_START]).toBe(7);
    expect(state.CrimeHis[LONG_HISTORY_START]).toBe(11);
    expect(state.PollutionHis[LONG_HISTORY_START]).toBe(22);
    expect(state.MoneyHis[LONG_HISTORY_START]).toBe(33);

    expect(changeCensus).toHaveBeenCalledTimes(1);
  });

  it('clamps money at zero and clears need flags when counts match', () => {
    const store = createClassicMapStore();
    const changeCensus = vi.fn();
    const context = createSimContext({ store, hooks: { changeCensus } });
    const state = createSimState();

    // ResPop >> 8 = 1, so matching HospPop/ChurchPop clears needs.
    state.ResPop = 256;
    state.HospPop = 1;
    state.ChurchPop = 1;
    // CashFlow scales to negative -> clamp to 0.
    state.CashFlow = -10000;

    takeCensus(state, context);

    expect(state.MoneyHis[0]).toBe(0);
    expect(state.NeedHosp).toBe(0);
    expect(state.NeedChurch).toBe(0);
    expect(changeCensus).toHaveBeenCalledTimes(1);
  });
});

/**
 * Find the first mismatch in two signed history arrays.
 *
 * C references:
 * - `ResHis` / `ComHis` / `IndHis` / `CrimeHis` / `PollutionHis` / `MoneyHis`
 *   are `short[240]` in `ref/micropolis/src/sim/s_sim.c`.
 */
function findHistoryMismatch(
  actual: Int16Array,
  expected: Int16Array,
): {
  actual: number;
  expected: number;
  index: number;
} | null {
  if (actual.length !== expected.length) {
    throw new Error(`history length mismatch: actual=${actual.length} expected=${expected.length}`);
  }

  for (let i = 0; i < expected.length; i += 1) {
    const actualValue = actual[i];
    const expectedValue = expected[i];
    if (actualValue === undefined || expectedValue === undefined) {
      throw new Error(`expected history value at index ${i}`);
    }
    if (actualValue !== expectedValue) {
      return { index: i, expected: expectedValue, actual: actualValue };
    }
  }

  return null;
}

/**
 * Asserts a TS history buffer matches C-oracle output exactly.
 *
 * C references:
 * - `TakeCensus` / `Take2Census` shifts in `ref/micropolis/src/sim/s_sim.c`.
 */
function expectHistoryEqual(label: string, actual: Int16Array, expected: Int16Array): void {
  const mismatch = findHistoryMismatch(actual, expected);
  if (mismatch !== null) {
    throw new Error(
      `${label} mismatch at index=${mismatch.index}: expected=${mismatch.expected} actual=${mismatch.actual}`,
    );
  }
}

/**
 * Deterministic unsigned LCG used to generate parity cases.
 *
 * Constants mirror ANSI-C LCG style and keep cases reproducible in CI.
 */
function nextSeed(seed: number): number {
  return (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
}

/**
 * Deterministically maps an unsigned seed to a signed 16-bit integer.
 *
 * Mirrors C `short` storage behavior for history buffers.
 */
function toSigned16(word: number): number {
  const wrapped = word & 0xffff;
  return wrapped >= 0x8000 ? wrapped - 0x10000 : wrapped;
}

describe('Census parity against C oracle (env-gated)', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm test-parity` to enable C parity tests', () => {});
    return;
  }

  it('matches C TakeCensus for history shifts, ramps, and graph maxima', () => {
    const oracleBefore = runCoreOracleInitNewCity({ seed: 0x00a11ce5 });
    let seed = 0x1357_9bdf;

    for (let i = 0; i < 240; i += 1) {
      seed = nextSeed(seed);
      oracleBefore.resHis[i] = toSigned16(seed);
      seed = nextSeed(seed);
      oracleBefore.comHis[i] = toSigned16(seed);
      seed = nextSeed(seed);
      oracleBefore.indHis[i] = toSigned16(seed);
      seed = nextSeed(seed);
      oracleBefore.crimeHis[i] = toSigned16(seed);
      seed = nextSeed(seed);
      oracleBefore.pollutionHis[i] = toSigned16(seed);
      seed = nextSeed(seed);
      oracleBefore.moneyHis[i] = toSigned16(seed);
    }

    // Magic numbers source:
    // - `ResHis[0] = ResPop / 8`
    // - `CrimeRamp += (CrimeAverage - CrimeRamp) / 4`
    // - `PolluteRamp += (PolluteAverage - PolluteRamp) / 4`
    // - `x = (CashFlow / 20) + 128` then clamp 0..255
    // in `TakeCensus` (`ref/micropolis/src/sim/s_sim.c`).
    oracleBefore.ResPop = 8192;
    oracleBefore.ComPop = 432;
    oracleBefore.IndPop = 321;
    oracleBefore.CrimeAverage = 220;
    oracleBefore.PolluteAverage = 140;
    oracleBefore.CrimeRamp = 60;
    oracleBefore.PolluteRamp = 20;
    oracleBefore.CashFlow = -3000;
    oracleBefore.HospPop = 20;
    oracleBefore.ChurchPop = 40;

    const oracleAfter = runCoreOracleTakeCensus(oracleBefore);

    const store = createClassicMapStore();
    const changeCensus = vi.fn();
    const context = createSimContext({ store, hooks: { changeCensus } });
    const state = createSimState();
    state.ResHis.set(oracleBefore.resHis);
    state.ComHis.set(oracleBefore.comHis);
    state.IndHis.set(oracleBefore.indHis);
    state.CrimeHis.set(oracleBefore.crimeHis);
    state.PollutionHis.set(oracleBefore.pollutionHis);
    state.MoneyHis.set(oracleBefore.moneyHis);
    state.ResPop = oracleBefore.ResPop;
    state.ComPop = oracleBefore.ComPop;
    state.IndPop = oracleBefore.IndPop;
    state.CrimeAverage = oracleBefore.CrimeAverage;
    state.PolluteAverage = oracleBefore.PolluteAverage;
    state.CrimeRamp = oracleBefore.CrimeRamp;
    state.PolluteRamp = oracleBefore.PolluteRamp;
    state.CashFlow = oracleBefore.CashFlow;
    state.HospPop = oracleBefore.HospPop;
    state.ChurchPop = oracleBefore.ChurchPop;

    takeCensus(state, context);

    expectHistoryEqual('ResHis', state.ResHis, oracleAfter.resHis);
    expectHistoryEqual('ComHis', state.ComHis, oracleAfter.comHis);
    expectHistoryEqual('IndHis', state.IndHis, oracleAfter.indHis);
    expectHistoryEqual('CrimeHis', state.CrimeHis, oracleAfter.crimeHis);
    expectHistoryEqual('PollutionHis', state.PollutionHis, oracleAfter.pollutionHis);
    expectHistoryEqual('MoneyHis', state.MoneyHis, oracleAfter.moneyHis);

    expect(state.ResHisMax).toBe(oracleAfter.ResHisMax);
    expect(state.ComHisMax).toBe(oracleAfter.ComHisMax);
    expect(state.IndHisMax).toBe(oracleAfter.IndHisMax);
    expect(state.Graph10Max).toBe(oracleAfter.Graph10Max);
    expect(state.CrimeRamp).toBe(oracleAfter.CrimeRamp);
    expect(state.PolluteRamp).toBe(oracleAfter.PolluteRamp);
    expect(state.NeedHosp).toBe(oracleAfter.NeedHosp);
    expect(state.NeedChurch).toBe(oracleAfter.NeedChurch);
    expect(changeCensus).toHaveBeenCalledTimes(1);
  });

  it('matches C Take2Census for long-term history shifts and graph maxima', () => {
    const oracleBefore = runCoreOracleInitNewCity({ seed: 0x00b16b00 });
    let seed = 0x2468_ace0;

    for (let i = 0; i < 240; i += 1) {
      seed = nextSeed(seed);
      oracleBefore.resHis[i] = toSigned16(seed);
      seed = nextSeed(seed);
      oracleBefore.comHis[i] = toSigned16(seed);
      seed = nextSeed(seed);
      oracleBefore.indHis[i] = toSigned16(seed);
      seed = nextSeed(seed);
      oracleBefore.crimeHis[i] = toSigned16(seed);
      seed = nextSeed(seed);
      oracleBefore.pollutionHis[i] = toSigned16(seed);
      seed = nextSeed(seed);
      oracleBefore.moneyHis[i] = toSigned16(seed);
    }

    // Magic numbers source:
    // - loop bounds `for (x = 238; x >= 120; x--)`
    // - writes at index 120 from current pop/history
    // in `Take2Census` (`ref/micropolis/src/sim/s_sim.c`).
    oracleBefore.ResPop = 4096;
    oracleBefore.ComPop = 246;
    oracleBefore.IndPop = 135;

    const oracleAfter = runCoreOracleTake2Census(oracleBefore);

    const store = createClassicMapStore();
    const changeCensus = vi.fn();
    const context = createSimContext({ store, hooks: { changeCensus } });
    const state = createSimState();
    state.ResHis.set(oracleBefore.resHis);
    state.ComHis.set(oracleBefore.comHis);
    state.IndHis.set(oracleBefore.indHis);
    state.CrimeHis.set(oracleBefore.crimeHis);
    state.PollutionHis.set(oracleBefore.pollutionHis);
    state.MoneyHis.set(oracleBefore.moneyHis);
    state.ResPop = oracleBefore.ResPop;
    state.ComPop = oracleBefore.ComPop;
    state.IndPop = oracleBefore.IndPop;

    take2Census(state, context);

    expectHistoryEqual('ResHis', state.ResHis, oracleAfter.resHis);
    expectHistoryEqual('ComHis', state.ComHis, oracleAfter.comHis);
    expectHistoryEqual('IndHis', state.IndHis, oracleAfter.indHis);
    expectHistoryEqual('CrimeHis', state.CrimeHis, oracleAfter.crimeHis);
    expectHistoryEqual('PollutionHis', state.PollutionHis, oracleAfter.pollutionHis);
    expectHistoryEqual('MoneyHis', state.MoneyHis, oracleAfter.moneyHis);

    expect(state.Res2HisMax).toBe(oracleAfter.Res2HisMax);
    expect(state.Com2HisMax).toBe(oracleAfter.Com2HisMax);
    expect(state.Ind2HisMax).toBe(oracleAfter.Ind2HisMax);
    expect(state.Graph120Max).toBe(oracleAfter.Graph120Max);
    expect(changeCensus).toHaveBeenCalledTimes(1);
  });
});
