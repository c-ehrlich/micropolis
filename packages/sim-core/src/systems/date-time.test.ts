import { describe, expect, it, vi } from 'vitest';

import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { currentMonthIndex, currentYear, runUiUpdate, setYear, updateDate } from './date-time.ts';

describe('Date/time mapping', () => {
  it('maps CityTime to year and month index', () => {
    const state = createSimState();
    state.StartingYear = 1900;

    // SPEC Date and Time + w_update.c updateDate: 48 ticks per year, month=(CityTime % 48)/4.
    state.CityTime = 0;
    expect(currentYear(state)).toBe(1900);
    expect(currentMonthIndex(state)).toBe(0);

    state.CityTime = 47;
    expect(currentYear(state)).toBe(1900);
    expect(currentMonthIndex(state)).toBe(11);

    state.CityTime = 48;
    expect(currentYear(state)).toBe(1901);
    expect(currentMonthIndex(state)).toBe(0);
  });

  it('adjusts CityTime when setting the year', () => {
    const state = createSimState();
    const context = createSimContext();

    state.StartingYear = 1900;
    state.CityTime = 10;

    // w_util.c SetYear keeps the intra-year offset and shifts by 48 ticks per year.
    setYear(state, context, 1901);

    expect(state.CityTime).toBe(58);
    expect(currentYear(state)).toBe(1901);
    expect(currentMonthIndex(state)).toBe(2);
  });

  it('clamps SetYear to the starting year', () => {
    const state = createSimState();
    const context = createSimContext();

    state.StartingYear = 1900;
    state.CityTime = 60;

    // w_util.c SetYear clamps to StartingYear and preserves the intra-year offset.
    setYear(state, context, 1800);

    expect(state.CityTime).toBe(12);
    expect(currentYear(state)).toBe(1900);
    expect(currentMonthIndex(state)).toBe(3);
  });

  it('rolls over megalinium year and sends message -40', () => {
    const sendMes = vi.fn();
    const uiSet = vi.fn();
    const context = createSimContext({
      hooks: {
        sendMes,
        uiSet,
      },
    });
    const state = createSimState();

    state.StartingYear = 1900;

    // SPEC Date and Time + w_update.c updateDate: >= 1,000,000 triggers SetYear + SendMes(-40).
    const remainder = 8;
    state.CityTime = (1_000_000 - state.StartingYear) * 48 + remainder;

    updateDate(state, context);

    expect(state.CityTime).toBe(remainder);
    expect(state.LastCityYear).toBe(state.StartingYear);
    expect(state.LastCityMonth).toBe(2);
    expect(state.LastCityTime).toBe(2);
    expect(sendMes).toHaveBeenCalledWith(-40);
    expect(uiSet).toHaveBeenCalledWith('date', 'Mar 1900');
  });

  it('invokes the UI heads hook after updating the date', () => {
    const hooks = { doUpdateHeads: vi.fn(), uiSet: vi.fn() };
    const context = createSimContext({ hooks });
    const state = createSimState();

    state.StartingYear = 1900;
    state.CityTime = 0;

    runUiUpdate(state, context);

    expect(hooks.doUpdateHeads).toHaveBeenCalledOnce();
    expect(state.LastCityYear).toBe(1900);
    expect(state.LastCityMonth).toBe(0);
  });
});
