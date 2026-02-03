import { describe, expect, it } from 'vitest';

import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { dispatchSimPhase } from '../sim/simulate.ts';
import { setValves } from '../systems/valves.ts';

describe('Demand valves E2E', () => {
  it('updates valves during phase 0 on even Scycle ticks', () => {
    const state = createSimState();
    const context = createSimContext();

    state.Scycle = 1;
    state.ResPop = 800;
    state.ComPop = 50;
    state.IndPop = 25;
    state.ResHis[1] = 120;
    state.ComHis[1] = 40;
    state.IndHis[1] = 20;
    state.CityTax = 7;
    state.GameLevel = 1;
    state.RValve = 100;
    state.CValve = 200;
    state.IValve = -100;
    state.ValveFlag = 0;

    // C ref: SetValves in ref/micropolis/src/sim/s_sim.c (same arithmetic as unit test).
    dispatchSimPhase(0, state, context, { setValves });

    expect(state.RValve).toBe(-138);
    expect(state.CValve).toBe(327);
    expect(state.IValve).toBe(147);
    expect(state.ValveFlag).toBe(1);
  });
});
