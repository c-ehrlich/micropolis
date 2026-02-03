import { describe, expect, it } from 'vitest';

import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { dispatchSimPhase } from '../sim/simulate.ts';
import { collectTax } from '../systems/budget.ts';

describe('Budget E2E', () => {
  it('collects taxes during phase 9 and applies autobudget', () => {
    const calls: string[] = [];
    const context = createSimContext({
      hooks: {
        doUpdateHeads: () => calls.push('doUpdateHeads'),
      },
    });
    const state = createSimState();

    state.CityTime = 48;
    state.TotalFunds = 1000;
    state.TotalPop = 100;
    state.LVAverage = 10;
    state.CityTax = 7;
    state.GameLevel = 1;
    state.PolicePop = 5;
    state.FireStPop = 2;
    state.RoadTotal = 10;
    state.RailTotal = 3;

    dispatchSimPhase(9, state, context, { collectTax });

    expect(state.TotalFunds).toBe(353);
    expect(state.FireSpend).toBe(200);
    expect(state.PoliceSpend).toBe(500);
    expect(state.RoadSpend).toBe(14);
    expect(calls).toEqual(['doUpdateHeads']);
  });
});
