import { assertDefined } from '../core/assert.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';

const TAX_TABLE = [
  200, 150, 120, 100, 80, 50, 30, 0, -10, -40, -100, -150, -200, -250, -300, -350, -400, -450, -500,
  -550, -600,
] as const;

/**
 * Demand valve recalculation (R/C/I) used by the city simulation.
 * 1:1 port of `SetValves` in `ref/micropolis/src/sim/s_sim.c`.
 */
export function setValves(state: SimState, _context: SimContext): void {
  state.MiscHis[1] = state.EMarket;
  state.MiscHis[2] = state.ResPop;
  state.MiscHis[3] = state.ComPop;
  state.MiscHis[4] = state.IndPop;
  state.MiscHis[5] = state.RValve;
  state.MiscHis[6] = state.CValve;
  state.MiscHis[7] = state.IValve;
  state.MiscHis[10] = state.CrimeRamp;
  state.MiscHis[11] = state.PolluteRamp;
  state.MiscHis[12] = state.LVAverage;
  state.MiscHis[13] = state.CrimeAverage;
  state.MiscHis[14] = state.PolluteAverage;
  state.MiscHis[15] = state.GameLevel;
  state.MiscHis[16] = state.CityClass;
  state.MiscHis[17] = state.CityScore;

  const resHis1 = state.ResHis[1];
  const comHis1 = state.ComHis[1];
  const indHis1 = state.IndHis[1];
  assertDefined(resHis1);
  assertDefined(comHis1);
  assertDefined(indHis1);

  const normResPop = Math.trunc(state.ResPop / 8);
  state.LastTotalPop = state.TotalPop;
  state.TotalPop = normResPop + state.ComPop + state.IndPop;

  const employment = normResPop > 0 ? (comHis1 + indHis1) / normResPop : 1;
  const migration = normResPop * (employment - 1);
  const births = normResPop * 0.02;
  const pjResPop = normResPop + migration + births;

  const laborDenom = comHis1 + indHis1;
  let laborBase = laborDenom > 0 ? resHis1 / laborDenom : 1;
  if (laborBase > 1.3) {
    laborBase = 1.3;
  }
  if (laborBase < 0) {
    laborBase = 0;
  }

  const intMarket = (normResPop + state.ComPop + state.IndPop) / 3.7;
  const pjComPop = intMarket * laborBase;

  let extMarket = 1;
  switch (state.GameLevel) {
    case 0:
      extMarket = 1.2;
      break;
    case 1:
      extMarket = 1.1;
      break;
    case 2:
      extMarket = 0.98;
      break;
  }

  let pjIndPop = state.IndPop * laborBase * extMarket;
  if (pjIndPop < 5) {
    pjIndPop = 5;
  }

  let rratio = normResPop > 0 ? pjResPop / normResPop : 1.3;
  let cratio = state.ComPop > 0 ? pjComPop / state.ComPop : pjComPop;
  let iratio = state.IndPop > 0 ? pjIndPop / state.IndPop : pjIndPop;

  if (rratio > 2) {
    rratio = 2;
  }
  if (cratio > 2) {
    cratio = 2;
  }
  if (iratio > 2) {
    iratio = 2;
  }

  let taxIndex = state.CityTax + state.GameLevel;
  if (taxIndex > 20) {
    taxIndex = 20;
  }
  const taxValue = TAX_TABLE[taxIndex];
  assertDefined(taxValue);

  rratio = (rratio - 1) * 600 + taxValue;
  cratio = (cratio - 1) * 600 + taxValue;
  iratio = (iratio - 1) * 600 + taxValue;

  // C assigns float deltas into short valves, so we explicitly trunc toward zero.
  // This avoids off-by-one mismatches caused by float precision (e.g. 247.999...).
  if (rratio > 0) {
    if (state.RValve < 2000) {
      state.RValve = Math.trunc(state.RValve + rratio);
    }
  }
  if (rratio < 0) {
    if (state.RValve > -2000) {
      state.RValve = Math.trunc(state.RValve + rratio);
    }
  }
  if (cratio > 0) {
    if (state.CValve < 1500) {
      state.CValve = Math.trunc(state.CValve + cratio);
    }
  }
  if (cratio < 0) {
    if (state.CValve > -1500) {
      state.CValve = Math.trunc(state.CValve + cratio);
    }
  }
  if (iratio > 0) {
    if (state.IValve < 1500) {
      state.IValve = Math.trunc(state.IValve + iratio);
    }
  }
  if (iratio < 0) {
    if (state.IValve > -1500) {
      state.IValve = Math.trunc(state.IValve + iratio);
    }
  }

  if (state.RValve > 2000) {
    state.RValve = 2000;
  }
  if (state.RValve < -2000) {
    state.RValve = -2000;
  }
  if (state.CValve > 1500) {
    state.CValve = 1500;
  }
  if (state.CValve < -1500) {
    state.CValve = -1500;
  }
  if (state.IValve > 1500) {
    state.IValve = 1500;
  }
  if (state.IValve < -1500) {
    state.IValve = -1500;
  }

  if (state.ResCap && state.RValve > 0) {
    state.RValve = 0;
  }
  if (state.ComCap && state.CValve > 0) {
    state.CValve = 0;
  }
  if (state.IndCap && state.IValve > 0) {
    state.IValve = 0;
  }
  state.ValveFlag = 1;
}
