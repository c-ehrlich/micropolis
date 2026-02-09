import { assertDefined } from '../core/assert.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';
import { simHeat } from './heat.ts';

export type SimMapFlag =
  | 'ALMAP'
  | 'REMAP'
  | 'COMAP'
  | 'INMAP'
  | 'PRMAP'
  | 'RDMAP'
  | 'TDMAP'
  | 'DYMAP';

export const MAP_DIRTY_PHASE_10: ReadonlyArray<SimMapFlag> = Object.freeze([
  'TDMAP',
  'RDMAP',
  'ALMAP',
  'REMAP',
  'COMAP',
  'INMAP',
  'DYMAP',
]);

export const MAP_DIRTY_PHASE_11: ReadonlyArray<SimMapFlag> = Object.freeze(['PRMAP']);

export const SPEED_TABLES = {
  SpdPwr: [1, 2, 4, 5],
  SpdPtl: [1, 2, 7, 17],
  SpdCri: [1, 1, 8, 18],
  SpdPop: [1, 1, 9, 19],
  SpdFir: [1, 1, 10, 20],
} as const;

export interface SimPhaseSystems {
  mapScan?: (phase: number, state: SimState, context: SimContext) => void;
  setValves?: (state: SimState, context: SimContext) => void;
  clearCensus?: (state: SimState, context: SimContext) => void;
  takeCensus?: (state: SimState, context: SimContext) => void;
  take2Census?: (state: SimState, context: SimContext) => void;
  collectTax?: (state: SimState, context: SimContext) => void;
  cityEvaluation?: (state: SimState, context: SimContext) => void;
  decROGMem?: (state: SimState, context: SimContext) => void;
  decTrafficMem?: (state: SimState, context: SimContext) => void;
  markMapDirty?: (flags: ReadonlyArray<SimMapFlag>, state: SimState, context: SimContext) => void;
  sendMessages?: (state: SimState, context: SimContext) => void;
  doPowerScan?: (state: SimState, context: SimContext) => void;
  ptlScan?: (state: SimState, context: SimContext) => void;
  crimeScan?: (state: SimState, context: SimContext) => void;
  popDenScan?: (state: SimState, context: SimContext) => void;
  fireAnalysis?: (state: SimState, context: SimContext) => void;
  doDisasters?: (state: SimState, context: SimContext) => void;
}

export interface SimLoopOptions {
  doSim?: boolean;
}

const CENSUS_RATE = 4;
const TAX_FREQUENCY = 48;

/**
 * Advance one simulation cycle counter using Micropolis "cosmic" wrap rules.
 * Mirrors `if (++cycle > 1023) cycle = 0` from `ref/micropolis/src/sim/s_sim.c`.
 */
const advanceSimCycle = (value: number): number => {
  const next = value + 1;
  return next > 1023 ? 0 : next;
};

const clampSpeedIndex = (simSpeed: number) => {
  if (simSpeed <= 0) {
    return 0;
  }
  if (simSpeed >= 3) {
    return 3;
  }
  return simSpeed;
};

/**
 * Dispatch one simulation phase.
 * Mirrors `Simulate(mod16)` in `ref/micropolis/src/sim/s_sim.c`.
 */
export function dispatchSimPhase(
  phase: number,
  state: SimState,
  context: SimContext,
  systems: SimPhaseSystems = {},
): void {
  const mod16 = phase & 15;
  const speedIndex = clampSpeedIndex(state.SimSpeed);

  switch (mod16) {
    case 0: {
      state.Scycle = advanceSimCycle(state.Scycle);
      if (state.DoInitialEval) {
        state.DoInitialEval = 0;
        systems.cityEvaluation?.(state, context);
      }
      state.CityTime += 1;
      state.AvCityTax += state.CityTax;
      if ((state.Scycle & 1) === 0) {
        systems.setValves?.(state, context);
      }
      systems.clearCensus?.(state, context);
      return;
    }
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
    case 7:
    case 8:
      systems.mapScan?.(mod16, state, context);
      return;
    case 9: {
      if (state.CityTime % CENSUS_RATE === 0) {
        systems.takeCensus?.(state, context);
      }
      if (state.CityTime % (CENSUS_RATE * 12) === 0) {
        systems.take2Census?.(state, context);
      }
      if (state.CityTime % TAX_FREQUENCY === 0) {
        systems.collectTax?.(state, context);
        systems.cityEvaluation?.(state, context);
      }
      return;
    }
    case 10:
      if (state.Scycle % 5 === 0) {
        systems.decROGMem?.(state, context);
      }
      systems.decTrafficMem?.(state, context);
      systems.markMapDirty?.(MAP_DIRTY_PHASE_10, state, context);
      systems.sendMessages?.(state, context);
      return;
    case 11:
      const spdPwr = SPEED_TABLES.SpdPwr[speedIndex];
      assertDefined(spdPwr);
      if (state.Scycle % spdPwr === 0) {
        systems.doPowerScan?.(state, context);
        systems.markMapDirty?.(MAP_DIRTY_PHASE_11, state, context);
        state.NewPower = 1;
      }
      return;
    case 12:
      const spdPtl = SPEED_TABLES.SpdPtl[speedIndex];
      assertDefined(spdPtl);
      if (state.Scycle % spdPtl === 0) {
        systems.ptlScan?.(state, context);
      }
      return;
    case 13:
      const spdCri = SPEED_TABLES.SpdCri[speedIndex];
      assertDefined(spdCri);
      if (state.Scycle % spdCri === 0) {
        systems.crimeScan?.(state, context);
      }
      return;
    case 14:
      const spdPop = SPEED_TABLES.SpdPop[speedIndex];
      assertDefined(spdPop);
      if (state.Scycle % spdPop === 0) {
        systems.popDenScan?.(state, context);
      }
      return;
    case 15:
      const spdFir = SPEED_TABLES.SpdFir[speedIndex];
      assertDefined(spdFir);
      if (state.Scycle % spdFir === 0) {
        systems.fireAnalysis?.(state, context);
      }
      systems.doDisasters?.(state, context);
  }
}

/**
 * Execute one simulation frame gate.
 * Mirrors `SimFrame` in `ref/micropolis/src/sim/s_sim.c`.
 */
export function runSimFrame(
  state: SimState,
  context: SimContext,
  systems: SimPhaseSystems = {},
): boolean {
  if (state.SimSpeed === 0) {
    return false;
  }

  state.Spdcycle = advanceSimCycle(state.Spdcycle);

  if (state.SimSpeed === 1 && state.Spdcycle % 5 !== 0) {
    return false;
  }
  if (state.SimSpeed === 2 && state.Spdcycle % 3 !== 0) {
    return false;
  }

  state.Fcycle = advanceSimCycle(state.Fcycle);
  dispatchSimPhase(state.Fcycle & 15, state, context, systems);
  return true;
}

/**
 * Run one simulation loop, optionally swapping in heat simulation steps.
 * Mirrors `sim_loop` in `ref/micropolis/src/sim/sim.c` (1:1 port), minus UI updates.
 */
export function runSimLoop(
  state: SimState,
  context: SimContext,
  systems: SimPhaseSystems = {},
  options: SimLoopOptions = {},
): boolean {
  if (state.SimSpeed === 0) {
    return false;
  }

  if (state.HeatSteps > 0) {
    for (let j = 0; j < state.HeatSteps; j += 1) {
      simHeat(state, context);
    }
    context.hooks.moveObjects();
    state.NewMap = 1;
    return true;
  }

  const ran = options.doSim !== false ? runSimFrame(state, context, systems) : false;
  context.hooks.moveObjects();
  return ran;
}
