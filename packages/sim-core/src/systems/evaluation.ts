import { World } from '../core/constants.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';
import { PROBLEM_COUNT, PROBLEM_ORDER_COUNT } from '../core/sim-state.ts';

const { HWLDX, HWLDY } = World;

/**
 * Integer truncation helper to mirror C assignment behavior in `s_eval.c`.
 * Matches the implicit float-to-int casts used throughout `ref/micropolis/src/sim/s_eval.c` (1:1 behavior).
 */
const toInt = (value: number): number => Math.trunc(value);

/**
 * Half-resolution memory index for traffic/land value layers.
 * Mirrors the `(x * HWLDY + y)` indexing used for `LandValueMem` and `TrfDensity`
 * in `ref/micropolis/src/sim/s_eval.c` (1:1 behavior).
 */
const halfIndex = (x: number, y: number): number => x * HWLDY + y;

/**
 * Core entry for the city evaluation flow.
 * Mirrors `CityEvaluation` in `ref/micropolis/src/sim/s_eval.c` (1:1 port).
 */
export function cityEvaluation(state: SimState, context: SimContext): void {
  if (state.TotalPop) {
    getAssValue(state);
    doPopNum(state);
    doProblems(state, context);
    getScore(state);
    doVotes(state, context);
    context.hooks.changeEval();
  } else {
    evalInit(state);
    context.hooks.changeEval();
  }
}

/**
 * Reset evaluation fields when there is no population.
 * Mirrors `EvalInit` in `ref/micropolis/src/sim/s_eval.c` (1:1 port).
 */
export function evalInit(state: SimState): void {
  const zero = 0;
  state.CityYes = zero;
  state.CityNo = zero;
  state.CityPop = zero;
  state.deltaCityPop = zero;
  state.CityAssValue = zero;
  state.CityClass = zero;
  state.CityScore = 500;
  state.deltaCityScore = zero;

  state.ProblemVotes.fill(zero);
  state.ProblemOrder.fill(zero);
}

/**
 * Compute the assessed city value from infrastructure totals.
 * Mirrors `GetAssValue` in `ref/micropolis/src/sim/s_eval.c` (1:1 port).
 */
export function getAssValue(state: SimState): void {
  let value = state.RoadTotal * 5;
  value += state.RailTotal * 10;
  value += state.PolicePop * 1000;
  value += state.FireStPop * 1000;
  value += state.HospPop * 400;
  value += state.StadiumPop * 3000;
  value += state.PortPop * 5000;
  value += state.APortPop * 10000;
  value += state.CoalPop * 3000;
  value += state.NuclearPop * 6000;
  state.CityAssValue = value * 1000;
}

/**
 * Derive city population, delta, and class thresholds.
 * Mirrors `DoPopNum` in `ref/micropolis/src/sim/s_eval.c` (1:1 port).
 */
export function doPopNum(state: SimState): void {
  const oldCityPop = state.CityPop;
  state.OldCityPop = oldCityPop;

  state.CityPop = (state.ResPop + state.ComPop * 8 + state.IndPop * 8) * 20;

  let previous = oldCityPop;
  if (previous === -1) {
    previous = state.CityPop;
  }
  state.deltaCityPop = state.CityPop - previous;

  let cityClass = 0;
  if (state.CityPop > 2000) {
    cityClass += 1;
  }
  if (state.CityPop > 10000) {
    cityClass += 1;
  }
  if (state.CityPop > 50000) {
    cityClass += 1;
  }
  if (state.CityPop > 100000) {
    cityClass += 1;
  }
  if (state.CityPop > 500000) {
    cityClass += 1;
  }
  state.CityClass = cityClass;
}

/**
 * Populate problem table entries and compute the top four issues.
 * Mirrors `DoProblems` in `ref/micropolis/src/sim/s_eval.c` (1:1 port).
 */
export function doProblems(state: SimState, context: SimContext): void {
  state.ProblemTable.fill(0);
  state.ProblemTable[0] = state.CrimeAverage;
  state.ProblemTable[1] = state.PolluteAverage;
  state.ProblemTable[2] = toInt(state.LVAverage * 0.7);
  state.ProblemTable[3] = state.CityTax * 10;
  state.ProblemTable[4] = averageTrf(state, context);
  state.ProblemTable[5] = getUnemployment(state);
  state.ProblemTable[6] = getFire(state);

  voteProblems(state, context);

  const problemTaken = new Uint8Array(PROBLEM_COUNT);

  for (let z = 0; z < PROBLEM_ORDER_COUNT; z += 1) {
    let max = 0;
    let thisProb = 0;
    for (let x = 0; x < 7; x += 1) {
      const votes = state.ProblemVotes[x] ?? 0;
      if (votes > max && (problemTaken[x] ?? 0) === 0) {
        thisProb = x;
        max = votes;
      }
    }

    if (max) {
      problemTaken[thisProb] = 1;
      state.ProblemOrder[z] = thisProb;
    } else {
      state.ProblemOrder[z] = 7;
      state.ProblemTable[7] = 0;
    }
  }
}

/**
 * Monte Carlo voting over problem table entries.
 * Mirrors `VoteProblems` in `ref/micropolis/src/sim/s_eval.c`, including the
 * `x > PROBNUM` loop bound bug (see `ref/micropolis/src/sim/headers/sim.h`).
 */
export function voteProblems(state: SimState, context: SimContext): void {
  state.ProblemVotes.fill(0);

  let x = 0;
  let z = 0;
  let count = 0;
  while (z < 100 && count < 600) {
    // C bug: `x` is allowed to reach PROBNUM before the wrap, producing a
    // one-past-the-end read/write. We discard any out-of-bounds vote but keep
    // the extra iteration to preserve the observable sampling cadence.
    const value = x === PROBLEM_COUNT ? 0 : (state.ProblemTable[x] ?? 0);
    if (context.rng.rand(300) < value) {
      if (x < state.ProblemVotes.length) {
        state.ProblemVotes[x] = (state.ProblemVotes[x] ?? 0) + 1;
      }
      z += 1;
    }
    x += 1;
    if (x > PROBLEM_COUNT) {
      x = 0;
    }
    count += 1;
  }
}

/**
 * Average traffic density over non-zero land value cells.
 * Mirrors `AverageTrf` in `ref/micropolis/src/sim/s_eval.c` (1:1 port).
 */
export function averageTrf(state: SimState, context: SimContext): number {
  const landValueMem = context.store.getLayer('landValueMem') as Uint8Array;
  const trfDensity = context.store.getLayer('trfDensity') as Uint8Array;

  let trfTotal = 0;
  let count = 1;

  for (let x = 0; x < HWLDX; x += 1) {
    for (let y = 0; y < HWLDY; y += 1) {
      const idx = halfIndex(x, y);
      if (landValueMem[idx]) {
        trfTotal += trfDensity[idx] ?? 0;
        count += 1;
      }
    }
  }

  state.TrafficAverage = toInt(toInt(trfTotal / count) * 2.4);
  return state.TrafficAverage;
}

/**
 * Unemployment score derived from population ratios.
 * Mirrors `GetUnemployment` in `ref/micropolis/src/sim/s_eval.c` (1:1 port).
 */
export function getUnemployment(state: SimState): number {
  const jobs = (state.ComPop + state.IndPop) << 3;
  if (!jobs) {
    return 0;
  }

  const ratio = state.ResPop / jobs;
  let value = toInt((ratio - 1) * 255);
  if (value > 255) {
    value = 255;
  }
  return value;
}

/**
 * Fire severity contribution to evaluation.
 * Mirrors `GetFire` in `ref/micropolis/src/sim/s_eval.c` (1:1 port).
 */
export function getFire(state: SimState): number {
  const value = state.FirePop * 5;
  return value > 255 ? 255 : value;
}

/**
 * Compute the composite city score with all modifiers.
 * Mirrors `GetScore` in `ref/micropolis/src/sim/s_eval.c` (1:1 port).
 */
export function getScore(state: SimState): void {
  const oldCityScore = state.CityScore;
  state.OldCityScore = oldCityScore;

  let sum = 0;
  for (let z = 0; z < 7; z += 1) {
    sum += state.ProblemTable[z] ?? 0;
  }

  let x = toInt(sum / 3);
  if (x > 256) {
    x = 256;
  }

  let z = (256 - x) * 4;
  if (z > 1000) {
    z = 1000;
  }
  if (z < 0) {
    z = 0;
  }

  if (state.ResCap) {
    z = toInt(z * 0.85);
  }
  if (state.ComCap) {
    z = toInt(z * 0.85);
  }
  if (state.IndCap) {
    z = toInt(z * 0.85);
  }
  if (state.RoadEffect < 32) {
    z = z - (32 - state.RoadEffect);
  }
  if (state.PoliceEffect < 1000) {
    z = toInt(z * (0.9 + state.PoliceEffect / 10000.1));
  }
  if (state.FireEffect < 1000) {
    z = toInt(z * (0.9 + state.FireEffect / 10000.1));
  }
  if (state.RValve < -1000) {
    z = toInt(z * 0.85);
  }
  if (state.CValve < -1000) {
    z = toInt(z * 0.85);
  }
  if (state.IValve < -1000) {
    z = toInt(z * 0.85);
  }

  let sm = 1.0;
  if (state.CityPop === 0 || state.deltaCityPop === 0) {
    sm = 1.0;
  } else if (state.deltaCityPop === state.CityPop) {
    sm = 1.0;
  } else if (state.deltaCityPop > 0) {
    sm = state.deltaCityPop / state.CityPop + 1.0;
  } else {
    sm = 0.95 + state.deltaCityPop / (state.CityPop - state.deltaCityPop);
  }

  z = toInt(z * sm);
  z = z - getFire(state);
  z = z - state.CityTax;

  const tm = state.unPwrdZCnt + state.PwrdZCnt;
  if (tm) {
    sm = state.PwrdZCnt / tm;
  } else {
    sm = 1.0;
  }
  z = toInt(z * sm);

  if (z > 1000) {
    z = 1000;
  }
  if (z < 0) {
    z = 0;
  }

  state.CityScore = toInt((state.CityScore + z) / 2);
  state.deltaCityScore = state.CityScore - oldCityScore;
}

/**
 * Sample voter approval based on the current city score.
 * Mirrors `DoVotes` in `ref/micropolis/src/sim/s_eval.c` (1:1 port).
 */
export function doVotes(state: SimState, context: SimContext): void {
  state.CityYes = 0;
  state.CityNo = 0;

  for (let z = 0; z < 100; z += 1) {
    if (context.rng.rand(1000) < state.CityScore) {
      state.CityYes += 1;
    } else {
      state.CityNo += 1;
    }
  }
}
