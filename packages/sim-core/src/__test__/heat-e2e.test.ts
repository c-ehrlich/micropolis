import { describe, expect, it } from 'vitest';

import { TileFlag, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { runSimLoop } from '../sim/simulate.ts';

const { WORLD_Y } = World;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;
const HEAT_FLAGS = TileFlag.ANIMBIT | TileFlag.BURNBIT | TileFlag.BULLBIT;

describe('Heat E2E', () => {
  it('runs heat steps instead of SimFrame when HeatSteps is enabled', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.SimSpeed = 3;
    state.Fcycle = 10;
    state.Spdcycle = 7;
    state.HeatSteps = 1;
    state.HeatFlow = 0;
    state.HeatRule = 0;
    state.HeatWrap = 1;

    const moveCalls: number[] = [];
    const context = createSimContext({
      store,
      hooks: {
        moveObjects: () => moveCalls.push(1),
      },
    });

    const map = store.getLayer('map') as Uint16Array;
    map[indexFor(1, 0)] = 8;
    map[indexFor(0, 1)] = 16;
    map[indexFor(1, 1)] = 24;

    const ran = runSimLoop(state, context);

    expect(ran).toBe(true);
    expect(state.Fcycle).toBe(10);
    expect(state.Spdcycle).toBe(7);
    expect(state.NewMap).toBe(1);
    expect(moveCalls).toHaveLength(1);

    // From sim_heat HEAT rule in sim.c:
    // a = sum(neighbors) + heat_flow; dst = ((a >> 3) & LOMASK) | flags.
    expect(map[indexFor(0, 0)]).toBe(HEAT_FLAGS | 6);
  });
});
