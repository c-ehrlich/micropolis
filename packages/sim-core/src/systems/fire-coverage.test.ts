import { describe, expect, it } from 'vitest';

import { World } from '../core/constants.ts';
import { MAP_FLAGS } from '../core/map-flags.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { fireAnalysis, smoothFSMap } from './fire-coverage.ts';

const { SmY } = World;

const smallIndex = (x: number, y: number) => x * SmY + y;

describe('fire coverage', () => {
  it('smoothFSMap averages neighbors with edge handling', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const fireStMap = store.getLayer('fireStMap') as Int16Array;
    const sTem = store.getLayer('sTem') as Int16Array;

    store.write('fireStMap', smallIndex(0, 0), 100);

    smoothFSMap(store, fireStMap, sTem);

    // s_scan.c SmoothFSMap: edge = (neighbors >> 2) + center; value = edge >> 1.
    // For (0,0): neighbors sum = 0 => edge = 0 + 100 => 100 >> 1 = 50.
    // For (1,0): neighbors sum includes (0,0)=100 => edge = (100 >> 2) + 0 = 25 => 25 >> 1 = 12.
    expect(fireStMap[smallIndex(0, 0)]).toBe(50);
    expect(fireStMap[smallIndex(1, 0)]).toBe(12);
    expect(fireStMap[smallIndex(0, 1)]).toBe(12);
    expect(fireStMap[smallIndex(1, 1)]).toBe(0);

    store.commitTick();
  });

  it('fireAnalysis smooths thrice, copies to fireRate, and sets map flags', () => {
    const store = createClassicMapStore();
    const context = createSimContext({ store });
    const state = createSimState();

    store.beginTick();
    store.write('fireStMap', smallIndex(1, 1), 100);

    fireAnalysis(state, context);

    const fireStMap = store.getLayer('fireStMap') as Int16Array;
    const fireRate = store.getLayer('fireRate') as Int16Array;

    // s_scan.c FireAnalysis runs SmoothFSMap 3x, then copies FireStMap to FireRate.
    // These values are the deterministic results after three passes starting from 100 at (1,1).
    expect(fireRate[smallIndex(1, 1)]).toBe(21);
    expect(fireRate[smallIndex(1, 0)]).toBe(10);
    expect(fireRate[smallIndex(0, 0)]).toBe(4);

    expect(fireRate[smallIndex(1, 1)]).toBe(fireStMap[smallIndex(1, 1)]);
    expect(fireRate[smallIndex(1, 0)]).toBe(fireStMap[smallIndex(1, 0)]);

    expect(state.NewMapFlags[MAP_FLAGS.DYMAP]).toBe(1);
    expect(state.NewMapFlags[MAP_FLAGS.FIMAP]).toBe(1);

    store.commitTick();
  });
});
