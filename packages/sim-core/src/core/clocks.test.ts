import { describe, expect, it } from 'vitest';

import { advanceRealtimeTicks, advanceSimStep, createClocks } from './clocks.ts';

describe('Sim clocks', () => {
  it('advances sim steps and weeks deterministically', () => {
    const clocks = createClocks();

    for (let i = 0; i < 15; i += 1) {
      advanceSimStep(clocks);
    }

    expect(clocks.simStep).toBe(15);
    expect(clocks.simWeeks).toBe(0);

    advanceSimStep(clocks);

    expect(clocks.simStep).toBe(0);
    expect(clocks.simWeeks).toBe(1);
  });

  it('increments realtime ticks by the requested amount', () => {
    const clocks = createClocks();

    advanceRealtimeTicks(clocks, 5);
    advanceRealtimeTicks(clocks, 3);

    expect(clocks.realtimeTick).toBe(8);
  });
});
