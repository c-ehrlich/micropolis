import { describe, expect, it } from 'vitest';

import { World } from '../core/constants.ts';
import { MicropolisRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { dispatchSimPhase } from '../sim/simulate.ts';
import { cityEvaluation } from '../systems/evaluation.ts';

const { HWLDY } = World;

/**
 * Deterministic RNG for evaluation E2E runs; mirrors `Rand` usage in `s_eval.c`.
 */
class ZeroRng extends MicropolisRng {
  override rand(_range: number): number {
    return 0;
  }
}

/**
 * Half-resolution index helper for traffic/land value layers in `s_eval.c`-based tests.
 */
const halfIndex = (x: number, y: number): number => x * HWLDY + y;

describe('Evaluation E2E', () => {
  it('evaluates the city on phase 9 with deterministic traffic and votes', () => {
    const calls: string[] = [];
    const context = createSimContext({
      rng: new ZeroRng(),
      hooks: {
        changeEval: () => calls.push('changeEval'),
      },
    });
    const state = createSimState();

    state.CityTime = 48;
    state.TotalPop = 10;
    state.ResPop = 10;
    state.ComPop = 0;
    state.IndPop = 0;
    state.CrimeAverage = 0;
    state.PolluteAverage = 0;
    state.LVAverage = 0;
    state.CityTax = 0;
    state.FirePop = 0;

    context.store.beginTick();
    try {
      const landValueMem = context.store.getLayer('landValueMem') as Uint8Array;
      const trfDensity = context.store.getLayer('trfDensity') as Uint8Array;
      landValueMem[halfIndex(1, 1)] = 1;
      trfDensity[halfIndex(1, 1)] = 12;
      landValueMem[halfIndex(2, 1)] = 1;
      trfDensity[halfIndex(2, 1)] = 18;

      dispatchSimPhase(9, state, context, { cityEvaluation });
    } finally {
      context.store.commitTick();
    }

    // s_eval.c AverageTrf: (12+18)/(count=3) => 10; 10*2.4 => 24.
    // s_eval.c GetScore: sum=24, x=8, z=(256-8)*4=992, CityScore=(500+992)/2=746.
    expect(state.TrafficAverage).toBe(24);
    expect(state.CityScore).toBe(746);
    expect(Array.from(state.ProblemOrder)).toEqual([4, 7, 7, 7]);
    expect(state.CityYes).toBe(100);
    expect(state.CityNo).toBe(0);
    expect(calls).toEqual(['changeEval']);
  });
});
