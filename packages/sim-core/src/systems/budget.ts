import { assertDefined } from '../core/assert.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';
import { runUiUpdate } from './date-time.ts';

const R_LEVELS = [0.7, 0.9, 1.2] as const;
const F_LEVELS = [1.4, 1.2, 0.8] as const;

const toInt = (value: number): number => Math.trunc(value);

const spend = (state: SimState, dollars: number): void => {
  state.TotalFunds = state.TotalFunds - dollars;
};

export function doBudget(state: SimState, context: SimContext): void {
  doBudgetNow(state, context, false);
}

export function doBudgetFromMenu(state: SimState, context: SimContext): void {
  doBudgetNow(state, context, true);
}

export function doBudgetNow(state: SimState, context: SimContext, fromMenu: boolean): void {
  const fireInt = toInt(state.FireFund * state.firePercent);
  const policeInt = toInt(state.PoliceFund * state.policePercent);
  const roadInt = toInt(state.RoadFund * state.roadPercent);

  const total = fireInt + policeInt + roadInt;
  const yumDuckets = state.TaxFund + state.TotalFunds;

  let fireValue = 0;
  let policeValue = 0;
  let roadValue = 0;

  if (yumDuckets > total) {
    fireValue = fireInt;
    policeValue = policeInt;
    roadValue = roadInt;
  } else if (total > 0) {
    let remaining = yumDuckets;
    if (remaining > roadInt) {
      roadValue = roadInt;
      remaining -= roadInt;

      if (remaining > fireInt) {
        fireValue = fireInt;
        remaining -= fireInt;

        if (remaining > policeInt) {
          policeValue = policeInt;
        } else {
          policeValue = remaining;
          state.policePercent = remaining > 0 ? remaining / state.PoliceFund : 0;
        }
      } else {
        fireValue = remaining;
        policeValue = 0;
        state.policePercent = 0;
        state.firePercent = remaining > 0 ? remaining / state.FireFund : 0;
      }
    } else {
      roadValue = remaining;
      state.roadPercent = remaining > 0 ? remaining / state.RoadFund : 0;
      fireValue = 0;
      policeValue = 0;
      state.firePercent = 0;
      state.policePercent = 0;
    }
  } else {
    fireValue = 0;
    policeValue = 0;
    roadValue = 0;
    state.firePercent = 1;
    state.policePercent = 1;
    state.roadPercent = 1;
  }

  context.hooks.drawCurrPercents();

  const applyManualSpend = () => {
    state.FireSpend = fireValue;
    state.PoliceSpend = policeValue;
    state.RoadSpend = roadValue;

    const totalSpend = state.FireSpend + state.PoliceSpend + state.RoadSpend;
    const moreDough = state.TaxFund - totalSpend;
    spend(state, -moreDough);
  };

  if (!state.autoBudget || fromMenu) {
    context.hooks.showBudgetWindowAndStartWaiting();
    if (!fromMenu) {
      applyManualSpend();
    }
    context.hooks.drawBudgetWindow();
    context.hooks.drawCurrPercents();
    runUiUpdate(state, context);
    return;
  }

  if (yumDuckets > total) {
    const moreDough = state.TaxFund - total;
    spend(state, -moreDough);
    state.FireSpend = state.FireFund;
    state.PoliceSpend = state.PoliceFund;
    state.RoadSpend = state.RoadFund;
    context.hooks.drawBudgetWindow();
    context.hooks.drawCurrPercents();
    runUiUpdate(state, context);
    return;
  }

  state.autoBudget = false;
  state.MustUpdateOptions = 1;
  context.hooks.sendMes(29);

  context.hooks.showBudgetWindowAndStartWaiting();
  applyManualSpend();
  context.hooks.drawBudgetWindow();
  context.hooks.drawCurrPercents();
  runUiUpdate(state, context);
}

export function collectTax(state: SimState, context: SimContext): void {
  const rLevel = R_LEVELS[state.GameLevel];
  const fLevel = F_LEVELS[state.GameLevel];
  assertDefined(rLevel);
  assertDefined(fLevel);

  state.CashFlow = 0;

  if (state.TaxFlag) {
    return;
  }

  const avgCityTax = toInt(state.AvCityTax / 48);
  void avgCityTax;
  state.AvCityTax = 0;

  state.PoliceFund = state.PolicePop * 100;
  state.FireFund = state.FireStPop * 100;
  state.RoadFund = toInt((state.RoadTotal + state.RailTotal * 2) * rLevel);

  const taxBase = toInt((state.TotalPop * state.LVAverage) / 120);
  state.TaxFund = toInt(taxBase * state.CityTax * fLevel);

  if (state.TotalPop) {
    state.CashFlow = state.TaxFund - (state.PoliceFund + state.FireFund + state.RoadFund);
    doBudget(state, context);
  } else {
    state.RoadEffect = 32;
    state.PoliceEffect = 1000;
    state.FireEffect = 1000;
  }
}

export function updateFundEffects(state: SimState, context: SimContext): void {
  if (state.RoadFund) {
    state.RoadEffect = toInt((state.RoadSpend / state.RoadFund) * 32);
  } else {
    state.RoadEffect = 32;
  }

  if (state.PoliceFund) {
    state.PoliceEffect = toInt((state.PoliceSpend / state.PoliceFund) * 1000);
  } else {
    state.PoliceEffect = 1000;
  }

  if (state.FireFund) {
    state.FireEffect = toInt((state.FireSpend / state.FireFund) * 1000);
  } else {
    state.FireEffect = 1000;
  }

  context.hooks.drawCurrPercents();
}
