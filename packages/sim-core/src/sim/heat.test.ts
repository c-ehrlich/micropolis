import { describe, expect, it } from 'vitest';

import { TileFlag, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { simHeat } from './heat.ts';

const { WORLD_Y } = World;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;
const HEAT_FLAGS = TileFlag.ANIMBIT | TileFlag.BURNBIT | TileFlag.BULLBIT;

describe('simHeat', () => {
  it('applies heat_rule 0 with the expected accumulator pattern', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.HeatFlow = 0;
    state.HeatRule = 0;
    state.HeatWrap = 1;

    const context = createSimContext({ store });
    const map = store.getLayer('map') as Uint16Array;

    map[indexFor(1, 0)] = 8;
    map[indexFor(0, 1)] = 16;
    map[indexFor(1, 1)] = 24;

    simHeat(state, context);

    // From sim_heat HEAT rule in sim.c:
    // a = sum(neighbors) + heat_flow; dst = ((a >> 3) & LOMASK) | flags.
    // (0,0) sum = 8 + 16 + 24 = 48 => (48 >> 3) = 6.
    // (0,1) sum = 8 + 24 = 32 => (32 >> 3) = 4.
    // (0,2) sum = 16 + 24 = 40 => (40 >> 3) = 5.
    expect(map[indexFor(0, 0)]).toBe(HEAT_FLAGS | 6);
    expect(map[indexFor(0, 1)]).toBe(HEAT_FLAGS | 4);
    expect(map[indexFor(0, 2)]).toBe(HEAT_FLAGS | 5);
  });

  it('applies heat_rule 1 brian-brain branch for a controlled neighborhood', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.HeatFlow = 0;
    state.HeatRule = 1;
    state.HeatWrap = 1;

    const context = createSimContext({ store });
    const map = store.getLayer('map') as Uint16Array;

    map[indexFor(5, 5)] = 1;
    map[indexFor(5, 4)] = 1;
    map[indexFor(5, 6)] = 1;
    map[indexFor(6, 5)] = 1;

    simHeat(state, context);

    // From sim_heat ECO rule in sim.c:
    // sum of low bits = 4 (brian's brain path), cell = ((c << 1) & 0x3fc) | 1.
    expect(map[indexFor(5, 5)]).toBe(HEAT_FLAGS | 3);
  });
});
