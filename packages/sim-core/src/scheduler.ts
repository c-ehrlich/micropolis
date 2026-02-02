import { advanceRealtimeTicks, advanceSimStep, type SimClocks } from './clocks.ts';

export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PhaseRunner = (phase: number, clocks: SimClocks) => void;

export interface SimFrameState {
  simSpeed: number;
  spdCycle: number;
}

export type RealtimeRunner = (tick: number, clocks: SimClocks) => void;

/**
 * Create the mutable SimFrame state used for speed gating and cycle tracking.
 */
export function createSimFrameState(simSpeed = 3): SimFrameState {
  return {
    simSpeed,
    spdCycle: 0,
  };
}

/**
 * Execute the current simulation phase and advance the sim clock by one phase.
 */
export function stepPhase(clocks: SimClocks, runPhase?: PhaseRunner): number {
  const phase = clocks.simStep;
  if (runPhase) {
    runPhase(phase, clocks);
  }
  advanceSimStep(clocks);
  return phase;
}

/**
 * Run a full 16-phase simulation tick (one simulated week).
 */
export function stepTick(clocks: SimClocks, runPhase?: PhaseRunner): void {
  for (let i = 0; i < 16; i += 1) {
    stepPhase(clocks, runPhase);
  }
}

/**
 * Advance the realtime clock for object/animation updates; viewRect is unimplemented.
 */
export function stepRealtimeTicks(
  clocks: SimClocks,
  ticks: number,
  viewRect?: ViewRect,
  runRealtime?: RealtimeRunner,
): void {
  if (viewRect !== undefined) {
    throw new Error('stepRealtimeTicks viewRect not implemented');
  }
  if (ticks < 0) {
    throw new Error('stepRealtimeTicks ticks must be non-negative');
  }
  if (runRealtime) {
    for (let i = 0; i < ticks; i += 1) {
      runRealtime(clocks.realtimeTick + i, clocks);
    }
  }
  advanceRealtimeTicks(clocks, ticks);
}

/**
 * SimCity-style frame gate: advances at most one phase per call based on simSpeed,
 * matching the C SimFrame rules (speed 0 pauses, speed 1 runs every 5th cycle,
 * speed 2 runs every 3rd cycle, speed 3+ runs every call) while wrapping spdCycle
 * at 1023 and returning whether a phase actually ran.
 */
export function simFrame(state: SimFrameState, clocks: SimClocks, runPhase?: PhaseRunner): boolean {
  if (state.simSpeed === 0) {
    return false;
  }

  state.spdCycle = (state.spdCycle + 1) & 1023;

  if (state.simSpeed === 1 && state.spdCycle % 5 !== 0) {
    return false;
  }
  if (state.simSpeed === 2 && state.spdCycle % 3 !== 0) {
    return false;
  }

  stepPhase(clocks, runPhase);
  return true;
}
