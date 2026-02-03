import { describe, expect, it } from 'vitest';

import { Tile, TileFlag, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { getPDen, popDenScan } from './pop-density.ts';

const { WORLD_Y, HWLDY, SmY } = World;

const mapIndex = (x: number, y: number) => x * WORLD_Y + y;
const halfIndex = (x: number, y: number) => x * HWLDY + y;
const smallIndex = (x: number, y: number) => x * SmY + y;

describe('PopDenScan', () => {
  it('computes population density and commercial rate on a tiny map', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.CCx2 = 0;
    state.CCy2 = 0;

    const context = createSimContext({ store });

    const x = 10;
    const y = 10;
    store.write('map', mapIndex(x, y), Tile.RZB | TileFlag.ZONEBIT);

    popDenScan(state, context);

    const popDensity = store.getLayer('popDensity') as Uint8Array;
    // These values follow the C `PopDenScan` smoothing chain:
    // RZB => RZPop = 16, shifted << 3 = 128 at tem[5,5], then DoSmooth -> DoSmooth2 -> DoSmooth.
    // The final PopDensity is tem2 << 1, yielding 52/48/24 at these neighbors.
    expect(popDensity[halfIndex(5, 5)]).toBe(52);
    expect(popDensity[halfIndex(6, 5)]).toBe(48);
    expect(popDensity[halfIndex(6, 6)]).toBe(24);

    const comRate = store.getLayer('comRate') as Int16Array;
    // `DistIntMarket` uses z = 64 - (GetDisCC(x<<2, y<<2) << 2).
    // With CCx2/CCy2 = 0,0: (0,0) => 64; (1,0) => 64 - 16 = 48.
    expect(comRate[smallIndex(0, 0)]).toBe(64);
    expect(comRate[smallIndex(1, 0)]).toBe(48);

    expect(state.CCx).toBe(x);
    expect(state.CCy).toBe(y);
    expect(state.CCx2).toBe(x >> 1);
    expect(state.CCy2).toBe(y >> 1);

    store.commitTick();
  });

  it('falls back to the map center when no zones exist', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.CCx2 = 7;
    state.CCy2 = 9;

    const context = createSimContext({ store });

    popDenScan(state, context);

    expect(state.CCx).toBe(World.HWLDX);
    expect(state.CCy).toBe(World.HWLDY);
    expect(state.CCx2).toBe(World.HWLDX >> 1);
    expect(state.CCy2).toBe(World.HWLDY >> 1);

    store.commitTick();
  });
});

describe('GetPDen', () => {
  it('returns population values for zone classes', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const map = store.getLayer('map') as Uint16Array;
    map[mapIndex(5, 5)] = Tile.LHTHR;
    map[mapIndex(4, 4)] = Tile.HHTHR;

    expect(getPDen(Tile.FREEZ, map, 5, 5)).toBe(2);
    expect(getPDen(Tile.RZB, map, 0, 0)).toBe(16);
    expect(getPDen(Tile.CZB, map, 0, 0)).toBe(8);
    expect(getPDen(Tile.IZB, map, 0, 0)).toBe(8);

    store.commitTick();
  });
});
