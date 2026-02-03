import { assertDefined } from '../core/assert.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';

const TICKS_PER_YEAR = 48;
const TICKS_PER_MONTH = 4;
const MEGALINIUM_YEAR = 1_000_000;

const DATE_STRINGS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Compute the in-game year from CityTime.
 * Mirrors the `y = (CityTime / 48) + StartingYear` mapping in
 * `ref/micropolis/src/sim/w_update.c` (`updateDate`), 1:1 port.
 */
export function currentYear(state: SimState): number {
  return Math.trunc(state.CityTime / TICKS_PER_YEAR) + state.StartingYear;
}

/**
 * Compute the 0-based month index from CityTime.
 * Mirrors the `(CityTime % 48) >> 2` mapping in
 * `ref/micropolis/src/sim/w_update.c` (`updateDate`), 1:1 port.
 */
export function currentMonthIndex(state: SimState): number {
  return Math.trunc((state.CityTime % TICKS_PER_YEAR) / TICKS_PER_MONTH);
}

/**
 * Update CityTime so the current year becomes `year`, clamping to StartingYear.
 * Mirrors `SetYear` in `ref/micropolis/src/sim/w_util.c` (including calling
 * `doTimeStuff` via `updateDate`), 1:1 port.
 */
export function setYear(state: SimState, context: SimContext, year: number): void {
  if (year < state.StartingYear) {
    year = state.StartingYear;
  }

  const delta = year - state.StartingYear - Math.trunc(state.CityTime / TICKS_PER_YEAR);
  state.CityTime += delta * TICKS_PER_YEAR;

  updateDate(state, context);
}

/**
 * Map CityTime into year/month, track LastCity* fields, and emit date updates.
 * Mirrors `updateDate` in `ref/micropolis/src/sim/w_update.c` (including the
 * megalinium rollover + SendMes(-40)), with UI calls routed through `uiSet`.
 */
export function updateDate(state: SimState, context: SimContext): void {
  state.LastCityTime = Math.trunc(state.CityTime / TICKS_PER_MONTH);

  let year = currentYear(state);
  const month = currentMonthIndex(state);

  if (year >= MEGALINIUM_YEAR) {
    setYear(state, context, state.StartingYear);
    year = state.StartingYear;
    context.hooks.sendMes(-40);
  }

  if (state.LastCityYear !== year || state.LastCityMonth !== month) {
    state.LastCityYear = year;
    state.LastCityMonth = month;

    const monthName = DATE_STRINGS[month];
    assertDefined(monthName);

    context.hooks.uiSet('date', `${monthName} ${year}`);
    context.hooks.uiSet('dateMonth', month);
    context.hooks.uiSet('dateYear', year);
  }
}

/**
 * UI heads update entry point.
 * Partial port of `DoUpdateHeads` in `ref/micropolis/src/sim/w_update.c`:
 * this only updates the date mapping and then delegates to the UI hook.
 */
export function doUpdateHeads(state: SimState, context: SimContext): void {
  updateDate(state, context);
  context.hooks.doUpdateHeads();
}

/**
 * Canonical UI update entry point for integrations.
 * Mirrors the `DoUpdateHeads` path in `ref/micropolis/src/sim/w_update.c`, 1:1.
 */
export function runUiUpdate(state: SimState, context: SimContext): void {
  doUpdateHeads(state, context);
}
