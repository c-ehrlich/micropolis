import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';

/**
 * Integer division helper to match C truncation toward zero.
 * Mirrors how divisions are used in `ClearCensus`/`TakeCensus`/`Take2Census`
 * in `ref/micropolis/src/sim/s_sim.c` (1:1 behavior, JS uses Math.trunc).
 */
const divToZero = (value: number, divisor: number) => Math.trunc(value / divisor);

/**
 * Clamp helper for the 0..255 graph scaling in census history updates.
 * Matches the explicit bounds checks in `TakeCensus` in
 * `ref/micropolis/src/sim/s_sim.c` (1:1 behavior).
 */
const clamp = (value: number, min: number, max: number) => {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

/**
 * Reset per-tick census counters and clear fire/police coverage maps.
 * Mirrors `ClearCensus` in `ref/micropolis/src/sim/s_sim.c` (1:1 port).
 */
export function clearCensus(state: SimState, context: SimContext): void {
  state.PwrdZCnt = 0;
  state.unPwrdZCnt = 0;
  state.FirePop = 0;
  state.RoadTotal = 0;
  state.RailTotal = 0;
  state.ResPop = 0;
  state.ComPop = 0;
  state.IndPop = 0;
  state.ResZPop = 0;
  state.ComZPop = 0;
  state.IndZPop = 0;
  state.HospPop = 0;
  state.ChurchPop = 0;
  state.PolicePop = 0;
  state.FireStPop = 0;
  state.StadiumPop = 0;
  state.CoalPop = 0;
  state.NuclearPop = 0;
  state.PortPop = 0;
  state.APortPop = 0;
  state.PowerStackNum = 0;

  const fireStMap = context.store.getLayer('fireStMap') as Int16Array;
  const policeMap = context.store.getLayer('policeMap') as Int16Array;

  for (let i = 0; i < fireStMap.length; i += 1) {
    if (fireStMap[i] !== 0) {
      context.store.write('fireStMap', i, 0);
    }
    if (policeMap[i] !== 0) {
      context.store.write('policeMap', i, 0);
    }
  }
}

/**
 * Shift the 10-year history buffers and update ramps and need flags.
 * Mirrors `TakeCensus` in `ref/micropolis/src/sim/s_sim.c` (1:1 port).
 */
export function takeCensus(state: SimState, context: SimContext): void {
  state.ResHisMax = 0;
  state.ComHisMax = 0;
  state.IndHisMax = 0;

  for (let x = 118; x >= 0; x -= 1) {
    const res = state.ResHis[x] ?? 0;
    const com = state.ComHis[x] ?? 0;
    const ind = state.IndHis[x] ?? 0;

    state.ResHis[x + 1] = res;
    state.ComHis[x + 1] = com;
    state.IndHis[x + 1] = ind;

    if (res > state.ResHisMax) {
      state.ResHisMax = res;
    }
    if (com > state.ComHisMax) {
      state.ComHisMax = com;
    }
    if (ind > state.IndHisMax) {
      state.IndHisMax = ind;
    }

    state.CrimeHis[x + 1] = state.CrimeHis[x] ?? 0;
    state.PollutionHis[x + 1] = state.PollutionHis[x] ?? 0;
    state.MoneyHis[x + 1] = state.MoneyHis[x] ?? 0;
  }

  state.Graph10Max = state.ResHisMax;
  if (state.ComHisMax > state.Graph10Max) {
    state.Graph10Max = state.ComHisMax;
  }
  if (state.IndHisMax > state.Graph10Max) {
    state.Graph10Max = state.IndHisMax;
  }

  state.ResHis[0] = divToZero(state.ResPop, 8);
  state.ComHis[0] = state.ComPop;
  state.IndHis[0] = state.IndPop;

  state.CrimeRamp += divToZero(state.CrimeAverage - state.CrimeRamp, 4);
  state.CrimeHis[0] = state.CrimeRamp;

  state.PolluteRamp += divToZero(state.PolluteAverage - state.PolluteRamp, 4);
  state.PollutionHis[0] = state.PolluteRamp;

  const cashFlowScaled = clamp(divToZero(state.CashFlow, 20) + 128, 0, 255);
  state.MoneyHis[0] = cashFlowScaled;

  if (state.CrimeHis[0] > 255) {
    state.CrimeHis[0] = 255;
  }
  if (state.PollutionHis[0] > 255) {
    state.PollutionHis[0] = 255;
  }

  context.hooks.changeCensus();

  const resUnits = divToZero(state.ResPop, 256);
  if (state.HospPop < resUnits) {
    state.NeedHosp = 1;
  }
  if (state.HospPop > resUnits) {
    state.NeedHosp = -1;
  }
  if (state.HospPop === resUnits) {
    state.NeedHosp = 0;
  }

  if (state.ChurchPop < resUnits) {
    state.NeedChurch = 1;
  }
  if (state.ChurchPop > resUnits) {
    state.NeedChurch = -1;
  }
  if (state.ChurchPop === resUnits) {
    state.NeedChurch = 0;
  }
}

/**
 * Shift the 120-year history buffers for long-term graphs.
 * Mirrors `Take2Census` in `ref/micropolis/src/sim/s_sim.c` (1:1 port).
 */
export function take2Census(state: SimState, context: SimContext): void {
  state.Res2HisMax = 0;
  state.Com2HisMax = 0;
  state.Ind2HisMax = 0;

  for (let x = 238; x >= 120; x -= 1) {
    const res = state.ResHis[x] ?? 0;
    const com = state.ComHis[x] ?? 0;
    const ind = state.IndHis[x] ?? 0;

    state.ResHis[x + 1] = res;
    state.ComHis[x + 1] = com;
    state.IndHis[x + 1] = ind;

    if (res > state.Res2HisMax) {
      state.Res2HisMax = res;
    }
    if (com > state.Com2HisMax) {
      state.Com2HisMax = com;
    }
    if (ind > state.Ind2HisMax) {
      state.Ind2HisMax = ind;
    }

    state.CrimeHis[x + 1] = state.CrimeHis[x] ?? 0;
    state.PollutionHis[x + 1] = state.PollutionHis[x] ?? 0;
    state.MoneyHis[x + 1] = state.MoneyHis[x] ?? 0;
  }

  state.Graph120Max = state.Res2HisMax;
  if (state.Com2HisMax > state.Graph120Max) {
    state.Graph120Max = state.Com2HisMax;
  }
  if (state.Ind2HisMax > state.Graph120Max) {
    state.Graph120Max = state.Ind2HisMax;
  }

  state.ResHis[120] = divToZero(state.ResPop, 8);
  state.ComHis[120] = state.ComPop;
  state.IndHis[120] = state.IndPop;
  state.CrimeHis[120] = state.CrimeHis[0] ?? 0;
  state.PollutionHis[120] = state.PollutionHis[0] ?? 0;
  state.MoneyHis[120] = state.MoneyHis[0] ?? 0;

  context.hooks.changeCensus();
}
