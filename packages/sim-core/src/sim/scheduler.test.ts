import { describe, expect, it } from 'vitest';

import { createClocks } from '../core/clocks.ts';
import {
  createSimFrameState,
  simFrame,
  stepPhase,
  stepRealtimeTicks,
  stepTick,
} from './scheduler.ts';

describe('Scheduler phase stepping', () => {
  it('runs the current phase before advancing', () => {
    const clocks = createClocks();
    clocks.simStep = 7;

    const phases: number[] = [];
    stepPhase(clocks, (phase) => phases.push(phase));

    expect(phases).toEqual([7]);
    expect(clocks.simStep).toBe(8);
    expect(clocks.simWeeks).toBe(0);
  });

  it('wraps simStep and increments simWeeks at phase 15 -> 0', () => {
    const clocks = createClocks();
    clocks.simStep = 15;
    clocks.simWeeks = 2;

    stepPhase(clocks);

    expect(clocks.simStep).toBe(0);
    expect(clocks.simWeeks).toBe(3);
  });

  it('advances simWeeks based on total steps', () => {
    for (let startStep = 0; startStep < 16; startStep += 1) {
      for (let steps = 0; steps <= 40; steps += 1) {
        const clocks = createClocks();
        clocks.simStep = startStep;
        clocks.simWeeks = 0;

        for (let i = 0; i < steps; i += 1) {
          stepPhase(clocks);
        }

        const expectedStep = (startStep + steps) & 15;
        const expectedWeeks = Math.floor((startStep + steps) / 16);
        expect(clocks.simStep).toBe(expectedStep);
        expect(clocks.simWeeks).toBe(expectedWeeks);
      }
    }
  });

  it('stepTick matches 16 stepPhase calls', () => {
    const clocksTick = createClocks();
    const clocksPhase = createClocks();

    stepTick(clocksTick);

    for (let i = 0; i < 16; i += 1) {
      stepPhase(clocksPhase);
    }

    expect(clocksTick).toEqual(clocksPhase);
  });

  it('stepTick emits phases in cyclic order from the current simStep', () => {
    const clocks = createClocks();
    clocks.simStep = 9;

    const phases: number[] = [];
    stepTick(clocks, (phase) => phases.push(phase));

    const expected = [...Array(16).keys()].map((offset) => (9 + offset) & 15);
    expect(phases).toEqual(expected);
  });
});

describe('Realtime tick stepping', () => {
  it('increments realtime ticks deterministically', () => {
    const clocks = createClocks();

    stepRealtimeTicks(clocks, 4);
    stepRealtimeTicks(clocks, 9);

    expect(clocks.realtimeTick).toBe(13);
  });

  it('treats zero ticks as a no-op', () => {
    const clocks = createClocks();
    clocks.realtimeTick = 11;

    stepRealtimeTicks(clocks, 0);

    expect(clocks.realtimeTick).toBe(11);
  });

  it('throws on negative ticks', () => {
    const clocks = createClocks();

    expect(() => stepRealtimeTicks(clocks, -1)).toThrow(
      'stepRealtimeTicks ticks must be non-negative',
    );
  });

  it('throws when viewRect is provided', () => {
    const clocks = createClocks();

    expect(() =>
      stepRealtimeTicks(clocks, 1, {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      }),
    ).toThrow('stepRealtimeTicks viewRect not implemented');
  });
});

describe('SimFrame gating', () => {
  it('does nothing when SimSpeed is 0', () => {
    const clocks = createClocks();
    const state = createSimFrameState(0);

    const ran = simFrame(state, clocks);

    expect(ran).toBe(false);
    expect(state.spdCycle).toBe(0);
    expect(clocks.simStep).toBe(0);
  });

  it('runs every call at SimSpeed 3+', () => {
    const clocks = createClocks();
    const state = createSimFrameState(3);
    const phases: number[] = [];

    for (let i = 0; i < 4; i += 1) {
      simFrame(state, clocks, (phase) => phases.push(phase));
    }

    expect(phases).toEqual([0, 1, 2, 3]);
    expect(clocks.simStep).toBe(4);
  });

  it('gates SimSpeed 1 to every 5th spdCycle', () => {
    const clocks = createClocks();
    const state = createSimFrameState(1);
    const phases: number[] = [];

    for (let i = 0; i < 10; i += 1) {
      simFrame(state, clocks, (phase) => phases.push(phase));
    }

    expect(phases).toEqual([0, 1]);
    expect(clocks.simStep).toBe(2);
  });

  it('gates SimSpeed 2 to every 3rd spdCycle', () => {
    const clocks = createClocks();
    const state = createSimFrameState(2);
    const phases: number[] = [];

    for (let i = 0; i < 7; i += 1) {
      simFrame(state, clocks, (phase) => phases.push(phase));
    }

    expect(phases).toEqual([0, 1]);
    expect(clocks.simStep).toBe(2);
  });

  it('wraps spdCycle at 1023', () => {
    const clocks = createClocks();
    const state = createSimFrameState(3);
    state.spdCycle = 1023;

    const ran = simFrame(state, clocks);

    expect(ran).toBe(true);
    expect(state.spdCycle).toBe(0);
  });

  it('does not advance simStep when a frame is skipped', () => {
    const clocks = createClocks();
    const state = createSimFrameState(1);

    for (let i = 0; i < 4; i += 1) {
      simFrame(state, clocks);
    }

    expect(clocks.simStep).toBe(0);

    simFrame(state, clocks);

    expect(clocks.simStep).toBe(1);
  });
});
