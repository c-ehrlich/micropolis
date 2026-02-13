import {
  runCoreOracleDoAllGraphs,
  runCoreOracleInitNewCity,
} from '@city/micropolis-c-harness/core-parity';
import { describe, expect, it } from 'vitest';

import { createSimState } from '../core/sim-state.ts';
import { buildCensusGraphData } from './graphs.ts';

/**
 * Deterministic unsigned LCG used to generate parity cases.
 *
 * Mirrors deterministic integer-seed generation style used in other C-harness
 * parity tests (reproducible CI fixtures).
 */
function nextSeed(seed: number): number {
  return (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
}

/**
 * Deterministically maps an unsigned word to C `short` domain.
 *
 * Mirrors signed 16-bit wrapping used by Micropolis history buffers in
 * `ref/micropolis/src/sim/s_sim.c`.
 */
function toSigned16(word: number): number {
  const wrapped = word & 0xffff;
  return wrapped >= 0x8000 ? wrapped - 0x10000 : wrapped;
}

/**
 * Finds the first mismatch between two rendered graph byte series.
 *
 * Mirrors `drawMonth` output domain (`unsigned char`) from
 * `ref/micropolis/src/sim/w_graph.c`.
 */
function findGraphMismatch(
  actual: Uint8Array,
  expected: Uint8Array,
): {
  actual: number;
  expected: number;
  index: number;
} | null {
  if (actual.length !== expected.length) {
    throw new Error(`graph length mismatch: actual=${actual.length} expected=${expected.length}`);
  }

  for (let index = 0; index < expected.length; index += 1) {
    const actualValue = actual[index];
    const expectedValue = expected[index];
    if (actualValue === undefined || expectedValue === undefined) {
      throw new Error(`expected graph value at index ${index}`);
    }
    if (actualValue !== expectedValue) {
      return {
        index,
        expected: expectedValue,
        actual: actualValue,
      };
    }
  }

  return null;
}

/**
 * Asserts one TS graph series exactly matches C-oracle bytes.
 *
 * Mirrors `drawMonth` output bytes in `ref/micropolis/src/sim/w_graph.c`.
 */
function expectGraphSeriesEqual(label: string, actual: Uint8Array, expected: Uint8Array): void {
  const mismatch = findGraphMismatch(actual, expected);
  if (mismatch !== null) {
    throw new Error(
      `${label} mismatch at index=${mismatch.index}: expected=${mismatch.expected} actual=${mismatch.actual}`,
    );
  }
}

describe('Graph history projection', () => {
  it('mirrors drawMonth reverse-index and clamp behavior for both ranges', () => {
    const state = createSimState();

    // Magic-number source: `drawMonth` in `ref/micropolis/src/sim/w_graph.c`:
    // - writes to `s[119 - x]`
    // - clamps to `0..255`
    // - uses 10-year scale from `AllMax` (`Res/Com/Ind max`, threshold `<= 128`).
    state.ResHis[0] = 5;
    state.ResHis[1] = 300;
    state.ResHis[2] = -4;
    state.ResHisMax = 64;
    state.ComHisMax = 0;
    state.IndHisMax = 0;

    // Magic-number source: 120-year range uses `Res2/Com2/Ind2` maxes and
    // `scaleValue = 128.0 / AllMax` when `AllMax > 128` in `doAllGraphs`.
    state.ResHis[120] = 300;
    state.ResHis[121] = -20;
    state.Res2HisMax = 300;
    state.Com2HisMax = 0;
    state.Ind2HisMax = 0;

    const graph = buildCensusGraphData(state);

    expect(graph.history10.res[119]).toBe(5);
    expect(graph.history10.res[118]).toBe(255);
    expect(graph.history10.res[117]).toBe(0);

    // `300 * (128 / 300)` truncates to 128 in C/TS parity path.
    expect(graph.history120.res[119]).toBe(128);
    expect(graph.history120.res[118]).toBe(0);
  });
});

describe('Graph parity against C oracle (env-gated)', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm test-parity` to enable C parity tests', () => {});
    return;
  }

  it('matches C doAllGraphs for all six series in both ranges', () => {
    const oracleBefore = runCoreOracleInitNewCity({ seed: 0x0f00d123 });
    let seed = 0x1a2b_3c4d;

    for (let i = 0; i < 240; i += 1) {
      seed = nextSeed(seed);
      oracleBefore.resHis[i] = toSigned16(seed);
      seed = nextSeed(seed);
      oracleBefore.comHis[i] = toSigned16(seed);
      seed = nextSeed(seed);
      oracleBefore.indHis[i] = toSigned16(seed);
      seed = nextSeed(seed);
      oracleBefore.moneyHis[i] = toSigned16(seed);
      seed = nextSeed(seed);
      oracleBefore.crimeHis[i] = toSigned16(seed);
      seed = nextSeed(seed);
      oracleBefore.pollutionHis[i] = toSigned16(seed);
    }

    // Magic-number source: `doAllGraphs` in `ref/micropolis/src/sim/w_graph.c`.
    // Uses these max fields directly for scale selection with threshold `<= 128`.
    oracleBefore.ResHisMax = 999;
    oracleBefore.ComHisMax = 500;
    oracleBefore.IndHisMax = 700;
    oracleBefore.Res2HisMax = 333;
    oracleBefore.Com2HisMax = 888;
    oracleBefore.Ind2HisMax = 222;

    const oracleGraph = runCoreOracleDoAllGraphs(oracleBefore);

    const state = createSimState();
    state.ResHis.set(oracleBefore.resHis);
    state.ComHis.set(oracleBefore.comHis);
    state.IndHis.set(oracleBefore.indHis);
    state.MoneyHis.set(oracleBefore.moneyHis);
    state.CrimeHis.set(oracleBefore.crimeHis);
    state.PollutionHis.set(oracleBefore.pollutionHis);
    state.ResHisMax = oracleBefore.ResHisMax;
    state.ComHisMax = oracleBefore.ComHisMax;
    state.IndHisMax = oracleBefore.IndHisMax;
    state.Res2HisMax = oracleBefore.Res2HisMax;
    state.Com2HisMax = oracleBefore.Com2HisMax;
    state.Ind2HisMax = oracleBefore.Ind2HisMax;

    const tsGraph = buildCensusGraphData(state);

    expectGraphSeriesEqual('history10.res', tsGraph.history10.res, oracleGraph.history10.res);
    expectGraphSeriesEqual('history10.com', tsGraph.history10.com, oracleGraph.history10.com);
    expectGraphSeriesEqual('history10.ind', tsGraph.history10.ind, oracleGraph.history10.ind);
    expectGraphSeriesEqual('history10.money', tsGraph.history10.money, oracleGraph.history10.money);
    expectGraphSeriesEqual('history10.crime', tsGraph.history10.crime, oracleGraph.history10.crime);
    expectGraphSeriesEqual(
      'history10.pollution',
      tsGraph.history10.pollution,
      oracleGraph.history10.pollution,
    );

    expectGraphSeriesEqual('history120.res', tsGraph.history120.res, oracleGraph.history120.res);
    expectGraphSeriesEqual('history120.com', tsGraph.history120.com, oracleGraph.history120.com);
    expectGraphSeriesEqual('history120.ind', tsGraph.history120.ind, oracleGraph.history120.ind);
    expectGraphSeriesEqual(
      'history120.money',
      tsGraph.history120.money,
      oracleGraph.history120.money,
    );
    expectGraphSeriesEqual(
      'history120.crime',
      tsGraph.history120.crime,
      oracleGraph.history120.crime,
    );
    expectGraphSeriesEqual(
      'history120.pollution',
      tsGraph.history120.pollution,
      oracleGraph.history120.pollution,
    );
  });
});
