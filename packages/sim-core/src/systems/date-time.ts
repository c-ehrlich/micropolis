import { assertDefined } from '../core/assert.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';
import { doMessage, sendMes } from './messages.ts';

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

type HeadsCache = { lastR: number | null; lastC: number | null; lastI: number | null };
type FundsCache = { mustUpdate: boolean; forceNextEmit: boolean };

const HEADS_CACHE = new WeakMap<SimState, HeadsCache>();
// Tracks w_update.c `MustUpdateFunds` without adding new core state fields.
const FUNDS_CACHE = new WeakMap<SimState, FundsCache>();

/**
 * Cache for the `LastR/LastC/LastI` values tracked in `ref/micropolis/src/sim/w_update.c`.
 * This keeps parity without adding new core state fields (intentional divergence).
 */
function getHeadsCache(state: SimState): HeadsCache {
  const cached = HEADS_CACHE.get(state);
  if (cached) {
    return cached;
  }
  const next = { lastR: null, lastC: null, lastI: null };
  HEADS_CACHE.set(state, next);
  return next;
}

/**
 * Cache for the `MustUpdateFunds` flag from `ref/micropolis/src/sim/w_update.c`.
 * This tracks the update intent without adding new core state fields; callers
 * must use `markFundsDirty` when they mutate `TotalFunds` and expect a heads update.
 */
function getFundsCache(state: SimState): FundsCache {
  const cached = FUNDS_CACHE.get(state);
  if (cached) {
    return cached;
  }
  // C parity: UpdateHeads() in w_update.c forces an initial funds refresh by setting
  // MustUpdateFunds=1 before the first DoUpdateHeads() call. Since sim-core doesn't
  // have an explicit UpdateHeads() entry point, treat the first cache creation as
  // "dirty" so the first doUpdateHeads() run emits the funds head by default.
  //
  // Additionally, C UpdateHeads() resets `LastFunds` to `-999999`, ensuring the first
  // `ReallyUpdateFunds()` call emits even if a loaded state had `LastFunds == TotalFunds`.
  // sim-core models that behavior with `forceNextEmit` instead of mutating `LastFunds`.
  const next = { mustUpdate: true, forceNextEmit: true };
  FUNDS_CACHE.set(state, next);
  return next;
}

/**
 * Mark the funds head as dirty.
 * Mirrors `UpdateFunds` in `ref/micropolis/src/sim/w_update.c` (sets MustUpdateFunds).
 * Required when callers change `TotalFunds` outside of budget helpers.
 */
export function markFundsDirty(state: SimState): void {
  getFundsCache(state).mustUpdate = true;
}

/**
 * Dollar formatter used by the funds head.
 * Mirrors `makeDollarDecimalStr` in `ref/micropolis/src/sim/w_util.c` (1:1 output).
 */
function formatDollarDecimal(value: number): string {
  const raw = Math.trunc(value).toString();
  const len = raw.length;
  if (len <= 3) {
    return `$${raw}`;
  }

  let head = len % 3;
  if (head === 0) {
    head = 3;
  }
  let out = `$${raw.slice(0, head)}`;
  for (let i = head; i < len; i += 3) {
    out += `,${raw.slice(i, i + 3)}`;
  }
  return out;
}

/**
 * Funds head update.
 * Mirrors `ReallyUpdateFunds` in `ref/micropolis/src/sim/w_update.c` (1:1, minus MustUpdateFunds).
 */
/**
 * Conditionally update the funds head, honoring the `MustUpdateFunds` gate.
 * Mirrors `ReallyUpdateFunds` in `ref/micropolis/src/sim/w_update.c`.
 */
function updateFunds(state: SimState, context: SimContext): void {
  const fundsCache = getFundsCache(state);
  if (!fundsCache.mustUpdate) {
    return;
  }
  fundsCache.mustUpdate = false;
  const forceNextEmit = fundsCache.forceNextEmit;
  fundsCache.forceNextEmit = false;

  if (state.TotalFunds < 0) {
    state.TotalFunds = 0;
  }

  if (forceNextEmit || state.TotalFunds !== state.LastFunds) {
    state.LastFunds = state.TotalFunds;
    const label = `Funds: ${formatDollarDecimal(state.TotalFunds)}`;
    context.hooks.uiSet('funds', label);
  }
}

/**
 * Demand valve head update.
 * Mirrors `showValves`/`drawValve` in `ref/micropolis/src/sim/w_update.c` (1:1).
 */
function showValves(state: SimState, context: SimContext): void {
  if (!state.ValveFlag) {
    return;
  }

  const clamp = (value: number) => {
    if (value < -1500) return -1500;
    if (value > 1500) return 1500;
    return value;
  };

  const r = clamp(state.RValve);
  const c = clamp(state.CValve);
  const i = clamp(state.IValve);
  const cache = getHeadsCache(state);

  if (cache.lastR !== r || cache.lastC !== c || cache.lastI !== i) {
    cache.lastR = r;
    cache.lastC = c;
    cache.lastI = i;
    context.hooks.uiSet('demandR', Math.trunc(r / 100));
    context.hooks.uiSet('demandC', Math.trunc(c / 100));
    context.hooks.uiSet('demandI', Math.trunc(i / 100));
  }

  state.ValveFlag = 0;
}

/**
 * Options head update.
 * Mirrors `updateOptions` / `UpdateOptionsMenu` in `ref/micropolis/src/sim/w_update.c`.
 *
 * C packs options into a bitfield and emits 8 booleans via `UISetOptions`.
 * sim-core emits the same 8 booleans as discrete `uiSet` keys.
 */
function updateOptions(state: SimState, context: SimContext): void {
  if (!state.MustUpdateOptions) {
    return;
  }

  context.hooks.uiSet('optionAutoBudget', state.autoBudget);
  context.hooks.uiSet('optionAutoGo', state.autoGo);
  context.hooks.uiSet('optionAutoBulldoze', state.autoBulldoze);
  context.hooks.uiSet('optionDisasters', !state.NoDisasters);
  context.hooks.uiSet('optionUserSoundOn', state.userSoundOn);
  context.hooks.uiSet('optionDoAnimation', state.doAnimation);
  context.hooks.uiSet('optionDoMessages', state.doMessages);
  context.hooks.uiSet('optionDoNotices', state.doNotices);
  state.MustUpdateOptions = 0;
}

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
 * megalinium rollover + SendMes(-40) and message-port consumption), with UI
 * calls routed through `uiSet`.
 */
export function updateDate(state: SimState, context: SimContext): void {
  state.LastCityTime = Math.trunc(state.CityTime / TICKS_PER_MONTH);

  let year = currentYear(state);
  const month = currentMonthIndex(state);

  if (year >= MEGALINIUM_YEAR) {
    setYear(state, context, state.StartingYear);
    year = state.StartingYear;
    // w_update.c updateDate: rollover uses SendMes(-40), i.e. MessagePort-gated.
    sendMes(state, context, -40);
  }

  // w_update.c updateDate always calls doMessage() (s_msg.c), which consumes/requeues
  // MessagePort and manages expiry based on TickCount().
  doMessage(state, context);

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
 * Mirrors `DoUpdateHeads` in `ref/micropolis/src/sim/w_update.c`, including
 * demand valves, date/message handling, funds, and options updates.
 */
export function doUpdateHeads(state: SimState, context: SimContext): void {
  showValves(state, context);
  updateDate(state, context);
  updateFunds(state, context);
  updateOptions(state, context);
  context.hooks.doUpdateHeads();
}

/**
 * Canonical UI update entry point for integrations.
 * Mirrors the `DoUpdateHeads` path in `ref/micropolis/src/sim/w_update.c`, 1:1.
 */
export function runUiUpdate(state: SimState, context: SimContext): void {
  doUpdateHeads(state, context);
}
