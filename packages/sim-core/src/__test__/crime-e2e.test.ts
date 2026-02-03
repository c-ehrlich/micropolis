import { describe, expect, it } from 'vitest';

import { World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { MicropolisRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { dispatchSimPhase } from '../sim/simulate.ts';
import { crimeScan } from '../systems/crime.ts';

const { HWLDY } = World;

const hwIndex = (x: number, y: number): number => x * HWLDY + y;

describe('Crime E2E', () => {
  it('runs CrimeScan during phase 13 when the speed gate allows', () => {
    const store = createClassicMapStore();
    const rng = new MicropolisRng(1);
    const context = createSimContext({ store, rng });
    const state = createSimState();

    state.SimSpeed = 3;
    state.Scycle = 0;

    store.beginTick();

    const landValue = store.getLayer('landValueMem') as Uint8Array;
    const popDensity = store.getLayer('popDensity') as Uint8Array;

    const idx = hwIndex(2, 2);
    landValue[idx] = 80;
    popDensity[idx] = 10;

    dispatchSimPhase(13, state, context, { crimeScan });

    const crimeMem = store.getLayer('crimeMem') as Uint8Array;
    expect(crimeMem[idx]).toBeGreaterThan(0);

    store.commitTick();
  });
});
