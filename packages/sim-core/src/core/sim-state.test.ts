import { describe, expect, it } from 'vitest';

import { CITY_HISTORY_LENGTH, CITY_MISC_LENGTH } from '../io/cty.ts';
import { createSimState, PROBLEM_COUNT, PROBLEM_ORDER_COUNT } from './sim-state.ts';

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
    expect(state.HeatSteps).toBe(0);
    expect(state.HeatFlow).toBe(-7);
    expect(state.HeatRule).toBe(0);
    expect(state.HeatWrap).toBe(3);
    expect(state.ValveFlag).toBe(1);
    expect(state.LastCityTime).toBe(-1);
    expect(state.LastCityYear).toBe(-1);
    expect(state.LastCityMonth).toBe(-1);
    expect(state.LastFunds).toBe(-1);
    expect(state.InitSimLoad).toBe(2);
    expect(state.autoBudget).toBe(true);
    expect(state.autoBulldoze).toBe(true);
  });

  it('allocates history and problem arrays with expected lengths', () => {
    const state = createSimState();

    expect(state.ResHis).toHaveLength(CITY_HISTORY_LENGTH);
    expect(state.ComHis).toHaveLength(CITY_HISTORY_LENGTH);
    expect(state.IndHis).toHaveLength(CITY_HISTORY_LENGTH);
    expect(state.CrimeHis).toHaveLength(CITY_HISTORY_LENGTH);
    expect(state.PollutionHis).toHaveLength(CITY_HISTORY_LENGTH);
    expect(state.MoneyHis).toHaveLength(CITY_HISTORY_LENGTH);
    expect(state.MiscHis).toHaveLength(CITY_MISC_LENGTH);

    expect(state.ProblemTable).toHaveLength(PROBLEM_COUNT);
    expect(state.ProblemVotes).toHaveLength(PROBLEM_COUNT);
    expect(state.ProblemOrder).toHaveLength(PROBLEM_ORDER_COUNT);
  });

  it('creates distinct history arrays per instance', () => {
    const stateA = createSimState();
    const stateB = createSimState();

    stateA.ResHis[0] = 42;
    stateA.MiscHis[0] = 7;
    stateA.ProblemTable[0] = 3;

    expect(stateB.ResHis[0]).toBe(0);
    expect(stateB.MiscHis[0]).toBe(0);
    expect(stateB.ProblemTable[0]).toBe(0);
  });

  it('initializes history arrays to zero', () => {
    const state = createSimState();
    const allZero = (values: Int16Array) => Array.from(values).every((value) => value === 0);

    expect(allZero(state.ResHis)).toBe(true);
    expect(allZero(state.ComHis)).toBe(true);
    expect(allZero(state.IndHis)).toBe(true);
    expect(allZero(state.CrimeHis)).toBe(true);
    expect(allZero(state.PollutionHis)).toBe(true);
    expect(allZero(state.MoneyHis)).toBe(true);
    expect(allZero(state.MiscHis)).toBe(true);
  });
});
