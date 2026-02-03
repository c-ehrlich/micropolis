import { describe, expect, it, vi } from 'vitest';

import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { dispatchSimPhase } from '../sim/simulate.ts';
import { runUiUpdate } from '../systems/date-time.ts';

describe('Date/time E2E', () => {
  it('updates year/month after phase 0 increments CityTime', () => {
    const uiSet = vi.fn();
    const context = createSimContext({ hooks: { uiSet } });
    const state = createSimState();

    state.StartingYear = 1900;
    state.CityTime = 47;

    // SPEC Date and Time: CityTime increments in phase 0, date update happens via DoUpdateHeads.
    dispatchSimPhase(0, state, context);
    runUiUpdate(state, context);

    expect(state.CityTime).toBe(48);
    expect(state.LastCityYear).toBe(1901);
    expect(state.LastCityMonth).toBe(0);
    expect(uiSet).toHaveBeenCalledWith('date', 'Jan 1901');
  });
});
