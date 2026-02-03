import { describe, expect, it } from 'vitest';

import { createSimState } from './sim-state.ts';

describe('SimState defaults', () => {
  it('are deterministic', () => {
    const stateA = createSimState();
    const stateB = createSimState();

    expect(stateA).toEqual(stateB);
  });

  it('match key spec defaults', () => {
    const state = createSimState();

    expect(state.CityScore).toBe(500);
    expect(state.CityPop).toBe(-1);
    expect(state.RoadEffect).toBe(32);
    expect(state.PoliceEffect).toBe(1000);
    expect(state.FireEffect).toBe(1000);
    expect(state.CityTax).toBe(7);
    expect(state.StartingYear).toBe(1900);
    expect(state.CityTime).toBe(50);
    expect(state.SimSpeed).toBe(3);
    expect(state.ValveFlag).toBe(1);
  });
});
