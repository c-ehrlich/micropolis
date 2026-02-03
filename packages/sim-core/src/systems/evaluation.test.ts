import { describe, expect, it } from 'vitest';

import { World } from '../core/constants.ts';
import { MicropolisRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState, PROBLEM_COUNT } from '../core/sim-state.ts';
import {
  cityEvaluation,
  doPopNum,
  doProblems,
  evalInit,
  getAssValue,
  getScore,
} from './evaluation.ts';

const { HWLDY } = World;

/**
 * Test RNG to exercise the `VoteProblems` sampling loop from `s_eval.c`.
 * Used to create deterministic votes for the evaluation ordering (test-only helper).
 */
class ProblemOrderRng extends MicropolisRng {
  private cursor = 0;

  override rand(range: number): number {
    const step = this.cursor % (PROBLEM_COUNT + 1);
    this.cursor += 1;
    if (range === 300 && step < 3) {
      return 0;
    }
    return range;
  }
}

/**
 * Test RNG that always returns 0, mirroring deterministic `Rand` calls in `s_eval.c`-based tests.
 */
class ZeroRng extends MicropolisRng {
  override rand(_range: number): number {
    return 0;
  }
}

/**
 * Half-resolution index helper for traffic/land value data in `s_eval.c` tests.
 */
const halfIndex = (x: number, y: number): number => x * HWLDY + y;

describe('Evaluation system', () => {
  it('resets evaluation fields when there is no population', () => {
    const state = createSimState();
    state.CityScore = 123;
    state.CityPop = 456;
    state.deltaCityScore = 789;
    state.ProblemVotes[0] = 5;
    state.ProblemOrder[0] = 2;

    evalInit(state);

    expect(state.CityScore).toBe(500);
    expect(state.CityPop).toBe(0);
    expect(state.deltaCityScore).toBe(0);
    expect(state.CityYes).toBe(0);
    expect(state.CityNo).toBe(0);
    expect(Array.from(state.ProblemVotes)).toEqual(new Array(PROBLEM_COUNT).fill(0));
    expect(Array.from(state.ProblemOrder)).toEqual([0, 0, 0, 0]);
  });

  it('computes assessed value from infrastructure totals', () => {
    const state = createSimState();
    state.RoadTotal = 2;
    state.RailTotal = 3;
    state.PolicePop = 1;
    state.FireStPop = 2;
    state.HospPop = 1;
    state.StadiumPop = 1;
    state.PortPop = 1;
    state.APortPop = 1;
    state.CoalPop = 1;
    state.NuclearPop = 1;

    // s_eval.c GetAssValue weights:
    // (2*5 + 3*10 + 1*1000 + 2*1000 + 1*400 + 1*3000 + 1*5000 + 1*10000 + 1*3000 + 1*6000) * 1000
    getAssValue(state);

    // s_eval.c GetAssValue: sum(weights) * 1000 => 30_440_000.
    expect(state.CityAssValue).toBe(30_440_000);
  });

  it('derives city population and class from zone populations', () => {
    const state = createSimState();
    state.CityPop = -1;
    state.ResPop = 10;
    state.ComPop = 1;
    state.IndPop = 1;

    // s_eval.c DoPopNum: CityPop = (Res + Com*8 + Ind*8) * 20.
    doPopNum(state);

    // s_eval.c DoPopNum: (Res + Com*8 + Ind*8) * 20 => (10 + 8 + 8) * 20 = 520.
    expect(state.CityPop).toBe(520);
    expect(state.deltaCityPop).toBe(0);
    expect(state.CityClass).toBe(0);
  });

  it('orders problems by vote counts from the problem table', () => {
    const state = createSimState();
    const context = createSimContext({ rng: new ProblemOrderRng() });

    state.CrimeAverage = 30;
    state.PolluteAverage = 20;
    state.LVAverage = 10;
    state.CityTax = 0;
    state.ResPop = 80;
    state.ComPop = 10;
    state.IndPop = 0;
    state.FirePop = 0;

    // s_eval.c DoProblems: LVAverage * 0.7 => 7 (truncated).
    context.store.beginTick();
    try {
      doProblems(state, context);
    } finally {
      context.store.commitTick();
    }

    expect(state.ProblemTable[2]).toBe(7);
    // s_eval.c DoProblems: top problems come from ProblemVotes; this RNG yields 0,1,2 then no max => 7.
    expect(Array.from(state.ProblemOrder)).toEqual([0, 1, 2, 7]);
  });

  it('computes city score using problem sums and modifiers', () => {
    const state = createSimState();
    state.CityScore = 500;
    state.CityPop = 0;
    state.deltaCityPop = 0;
    state.CityTax = 0;
    state.FirePop = 0;
    state.RoadEffect = 32;
    state.PoliceEffect = 1000;
    state.FireEffect = 1000;
    state.RValve = 0;
    state.CValve = 0;
    state.IValve = 0;
    state.unPwrdZCnt = 0;
    state.PwrdZCnt = 0;

    for (let i = 0; i < 7; i += 1) {
      state.ProblemTable[i] = 30;
    }

    // s_eval.c GetScore: sum=210, x=70, z=(256-70)*4=744, CityScore=(500+744)/2=622.
    getScore(state);

    expect(state.CityScore).toBe(622);
    expect(state.deltaCityScore).toBe(122);
  });

  it('runs eval init and UI hook when total population is zero', () => {
    const calls: string[] = [];
    const state = createSimState();
    const context = createSimContext({
      rng: new ZeroRng(),
      hooks: {
        changeEval: () => calls.push('changeEval'),
      },
    });

    state.TotalPop = 0;
    state.CityScore = 321;
    state.CityPop = 99;

    cityEvaluation(state, context);

    expect(state.CityScore).toBe(500);
    expect(state.CityPop).toBe(0);
    expect(calls).toEqual(['changeEval']);
  });

  it('captures traffic averages from non-zero land value tiles', () => {
    const state = createSimState();
    const context = createSimContext();
    context.store.beginTick();
    try {
      const landValueMem = context.store.getLayer('landValueMem') as Uint8Array;
      const trfDensity = context.store.getLayer('trfDensity') as Uint8Array;

      landValueMem[halfIndex(1, 1)] = 10;
      trfDensity[halfIndex(1, 1)] = 12;
      landValueMem[halfIndex(2, 1)] = 5;
      trfDensity[halfIndex(2, 1)] = 18;

      doProblems(state, context);
    } finally {
      context.store.commitTick();
    }

    // s_eval.c AverageTrf: (12+18)/(count=3) => 10; 10*2.4 => 24 (trunc).
    expect(state.TrafficAverage).toBe(24);
  });
});
