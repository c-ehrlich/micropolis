import { describe, expect, it } from 'vitest';

import { createSimContext } from '../core/sim-context.ts';
import { createSimState, type SimState } from '../core/sim-state.ts';
import {
  dispatchSimPhase,
  MAP_DIRTY_PHASE_10,
  MAP_DIRTY_PHASE_11,
  runSimFrame,
  type SimPhaseSystems,
} from './simulate.ts';

const makeState = (overrides: Partial<SimState> = {}) => {
  const state = createSimState();
  Object.assign(state, overrides);
  return state;
};

const makeSystems = (calls: string[]): SimPhaseSystems => ({
  mapScan: (phase) => calls.push(`mapScan:${phase}`),
  setValves: () => calls.push('setValves'),
  clearCensus: () => calls.push('clearCensus'),
  takeCensus: () => calls.push('takeCensus'),
  take2Census: () => calls.push('take2Census'),
  collectTax: () => calls.push('collectTax'),
  cityEvaluation: () => calls.push('cityEvaluation'),
  decROGMem: () => calls.push('decROGMem'),
  decTrafficMem: () => calls.push('decTrafficMem'),
  markMapDirty: (flags) => calls.push(`markMapDirty:${flags.join(',')}`),
  sendMessages: () => calls.push('sendMessages'),
  doPowerScan: () => calls.push('doPowerScan'),
  ptlScan: () => calls.push('ptlScan'),
  crimeScan: () => calls.push('crimeScan'),
  popDenScan: () => calls.push('popDenScan'),
  fireAnalysis: () => calls.push('fireAnalysis'),
  doDisasters: () => calls.push('doDisasters'),
});

describe('Simulate dispatcher phases', () => {
  it('runs phase 0 updates and calls with correct order', () => {
    const context = createSimContext();
    const calls: string[] = [];
    const state = makeState({
      CityTime: 9,
      CityTax: 7,
      AvCityTax: 0,
      Scycle: 1,
      DoInitialEval: 1,
    });

    dispatchSimPhase(0, state, context, makeSystems(calls));

    expect(state.Scycle).toBe(2);
    expect(state.CityTime).toBe(10);
    expect(state.AvCityTax).toBe(7);
    expect(state.DoInitialEval).toBe(0);
    expect(calls).toEqual(['cityEvaluation', 'setValves', 'clearCensus']);
  });

  it('dispatches map scan across phases 1..8', () => {
    const context = createSimContext();

    for (let phase = 1; phase <= 8; phase += 1) {
      const calls: string[] = [];
      const state = makeState();
      dispatchSimPhase(phase, state, context, makeSystems(calls));
      expect(calls).toEqual([`mapScan:${phase}`]);
    }
  });

  it('runs census and tax actions on phase 9 boundaries', () => {
    const context = createSimContext();
    const calls: string[] = [];
    const state = makeState({ CityTime: 48 });

    dispatchSimPhase(9, state, context, makeSystems(calls));

    expect(calls).toEqual(['takeCensus', 'take2Census', 'collectTax', 'cityEvaluation']);
  });

  it('runs phase 10 decay + dirty map flags', () => {
    const context = createSimContext();
    const calls: string[] = [];
    const state = makeState({ Scycle: 10 });

    dispatchSimPhase(10, state, context, makeSystems(calls));

    expect(calls).toEqual([
      'decROGMem',
      'decTrafficMem',
      `markMapDirty:${MAP_DIRTY_PHASE_10.join(',')}`,
      'sendMessages',
    ]);
  });

  it('runs phase 11 power scan and marks power dirty flag', () => {
    const context = createSimContext();
    const calls: string[] = [];
    const state = makeState({ Scycle: 5, SimSpeed: 3, NewPower: 0 });

    dispatchSimPhase(11, state, context, makeSystems(calls));

    expect(calls).toEqual(['doPowerScan', `markMapDirty:${MAP_DIRTY_PHASE_11.join(',')}`]);
    expect(state.NewPower).toBe(1);
  });

  it('gates phase 12..15 work using the speed tables', () => {
    const context = createSimContext();
    const calls: string[] = [];
    const systems = makeSystems(calls);

    const state = makeState({ SimSpeed: 3 });

    state.Scycle = 17;
    dispatchSimPhase(12, state, context, systems);
    state.Scycle = 18;
    dispatchSimPhase(13, state, context, systems);
    state.Scycle = 19;
    dispatchSimPhase(14, state, context, systems);
    state.Scycle = 20;
    dispatchSimPhase(15, state, context, systems);

    expect(calls).toEqual(['ptlScan', 'crimeScan', 'popDenScan', 'fireAnalysis', 'doDisasters']);
  });

  it('skips gated scans when Scycle is not divisible', () => {
    const context = createSimContext();
    const calls: string[] = [];
    const systems = makeSystems(calls);
    const state = makeState({ SimSpeed: 3, NewPower: 0 });

    state.Scycle = 6;
    dispatchSimPhase(11, state, context, systems);
    state.Scycle = 16;
    dispatchSimPhase(12, state, context, systems);
    state.Scycle = 17;
    dispatchSimPhase(13, state, context, systems);
    state.Scycle = 18;
    dispatchSimPhase(14, state, context, systems);
    state.Scycle = 19;
    dispatchSimPhase(15, state, context, systems);

    expect(calls).toEqual(['doDisasters']);
    expect(state.NewPower).toBe(0);
  });

  it('always runs disasters even when fire analysis is gated off', () => {
    const context = createSimContext();
    const calls: string[] = [];
    const systems = makeSystems(calls);
    const state = makeState({ SimSpeed: 3 });

    state.Scycle = 19;
    dispatchSimPhase(15, state, context, systems);

    expect(calls).toEqual(['doDisasters']);
  });
});

describe('SimFrame gating and cycles', () => {
  it('gates SimSpeed 1 and only advances Fcycle on allowed frames', () => {
    const context = createSimContext();
    const state = makeState({ SimSpeed: 1, Fcycle: 0, Spdcycle: 0 });
    const calls: string[] = [];
    const systems = makeSystems(calls);

    const results: boolean[] = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(runSimFrame(state, context, systems));
    }

    expect(results).toEqual([false, false, false, false, true]);
    expect(state.Spdcycle).toBe(5);
    expect(state.Fcycle).toBe(1);
    expect(calls).toEqual(['mapScan:1']);
  });

  it('gates SimSpeed 2 to every 3rd spdCycle', () => {
    const context = createSimContext();
    const state = makeState({ SimSpeed: 2, Fcycle: 0, Spdcycle: 0 });
    const calls: string[] = [];
    const systems = makeSystems(calls);

    const results: boolean[] = [];
    for (let i = 0; i < 6; i += 1) {
      results.push(runSimFrame(state, context, systems));
    }

    expect(results).toEqual([false, false, true, false, false, true]);
    expect(state.Spdcycle).toBe(6);
    expect(state.Fcycle).toBe(2);
    expect(calls).toEqual(['mapScan:1', 'mapScan:2']);
  });

  it('wraps Spdcycle and Fcycle at 1023', () => {
    const context = createSimContext();
    const calls: string[] = [];
    const state = makeState({
      SimSpeed: 3,
      Spdcycle: 1023,
      Fcycle: 1023,
      Scycle: 1023,
      CityTime: 0,
    });

    const ran = runSimFrame(state, context, makeSystems(calls));

    expect(ran).toBe(true);
    expect(state.Spdcycle).toBe(0);
    expect(state.Fcycle).toBe(0);
    expect(state.Scycle).toBe(0);
    expect(state.CityTime).toBe(1);
    expect(calls).toEqual(['setValves', 'clearCensus']);
  });
});
