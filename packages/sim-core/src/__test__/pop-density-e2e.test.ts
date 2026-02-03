import { describe, expect, it } from 'vitest';

import { Tile, TileFlag, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { dispatchSimPhase } from '../sim/simulate.ts';
import { popDenScan } from '../systems/pop-density.ts';

const { WORLD_Y, HWLDY } = World;

const mapIndex = (x: number, y: number) => x * WORLD_Y + y;
const halfIndex = (x: number, y: number) => x * HWLDY + y;

describe('PopDensity E2E', () => {
  it('runs in phase 14 and updates the population density map', () => {
    const store = createClassicMapStore();
    const context = createSimContext({ store });
    const state = createSimState();
    state.SimSpeed = 3;
    state.Scycle = 0;
    state.CCx2 = 0;
    state.CCy2 = 0;

    const x = 10;
    const y = 10;

    store.beginTick();
    store.write('map', mapIndex(x, y), Tile.RZB | TileFlag.ZONEBIT);

    dispatchSimPhase(14, state, context, { popDenScan });

    const popDensity = store.getLayer('popDensity') as Uint8Array;
    expect(popDensity[halfIndex(5, 5)]).toBe(52);

    store.commitTick();
  });
});
