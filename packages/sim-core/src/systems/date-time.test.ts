import { describe, expect, it, vi } from 'vitest';

import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import {
  currentMonthIndex,
  currentYear,
  doUpdateHeads,
  markFundsDirty,
  runUiUpdate,
  setYear,
  updateDate,
} from './date-time.ts';

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

  it('consumes the message port during date updates', () => {
    const context = createSimContext();
    const state = createSimState();

    state.MessagePort = 12;
    state.MesX = 4;
    state.MesY = 9;

    updateDate(state, context);

    // w_update.c updateDate -> doMessage consumes MessagePort.
    expect(state.MessagePort).toBe(0);
  });

  it('updates demand, funds, and options during heads update', () => {
    const uiSet = vi.fn();
    const context = createSimContext({ hooks: { uiSet } });
    const state = createSimState();

    state.StartingYear = 1900;
    state.CityTime = 0;
    state.LastCityYear = 1900;
    state.LastCityMonth = 0;

    state.ValveFlag = 1;
    state.RValve = 100;
    state.CValve = -200;
    state.IValve = 300;
    state.TotalFunds = 1234;
    state.LastFunds = -1;
    state.MustUpdateOptions = 1;
    state.autoBudget = false;
    state.autoGo = true;
    state.autoBulldoze = true;
    state.NoDisasters = true;
    state.userSoundOn = false;
    state.doAnimation = true;
    state.doMessages = false;
    state.doNotices = true;
    markFundsDirty(state);

    doUpdateHeads(state, context);

    // w_update.c drawValve divides by 100 and clamps to +/-1500.
    expect(uiSet).toHaveBeenCalledWith('demandR', 1);
    expect(uiSet).toHaveBeenCalledWith('demandC', -2);
    expect(uiSet).toHaveBeenCalledWith('demandI', 3);
    // w_update.c ReallyUpdateFunds formats "Funds: $1,234".
    expect(uiSet).toHaveBeenCalledWith('funds', 'Funds: $1,234');
    // w_update.c updateOptions uses option flags (limited to sim-core fields).
    expect(uiSet).toHaveBeenCalledWith('optionAutoBudget', false);
    // w_update.c updateOptions packs these flags into bits (1..128) and forwards them to
    // UpdateOptionsMenu(), which emits 8 booleans via UISetOptions.
    // sim-core models this as discrete `uiSet` keys.
    expect(uiSet).toHaveBeenCalledWith('optionAutoGo', true);
    expect(uiSet).toHaveBeenCalledWith('optionAutoBulldoze', true);
    expect(uiSet).toHaveBeenCalledWith('optionDisasters', false);
    expect(uiSet).toHaveBeenCalledWith('optionUserSoundOn', false);
    expect(uiSet).toHaveBeenCalledWith('optionDoAnimation', true);
    expect(uiSet).toHaveBeenCalledWith('optionDoMessages', false);
    expect(uiSet).toHaveBeenCalledWith('optionDoNotices', true);
  });

  it('forces a funds refresh on the first heads run', () => {
    const uiSet = vi.fn();
    const context = createSimContext({ hooks: { uiSet } });
    const state = createSimState();

    state.StartingYear = 1900;
    state.CityTime = 0;
    state.LastCityYear = 1900;
    state.LastCityMonth = 0;

    state.ValveFlag = 0;
    state.MustUpdateOptions = 0;
    state.TotalFunds = 1234;
    state.LastFunds = -1;

    doUpdateHeads(state, context);

    // C: UpdateHeads() in w_update.c sets MustUpdateFunds=1 and LastFunds=-999999
    // before calling DoUpdateHeads(), forcing ReallyUpdateFunds() to emit the funds head.
    // This test asserts the sim-core equivalent: the first doUpdateHeads() run emits funds
    // even if callers haven't yet called markFundsDirty()/UpdateFunds().
    expect(uiSet).toHaveBeenCalledWith('funds', 'Funds: $1,234');
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
