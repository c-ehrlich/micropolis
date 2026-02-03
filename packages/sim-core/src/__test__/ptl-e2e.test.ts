import { describe, expect, it } from 'vitest';

import { Tile, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { runSimFrame } from '../sim/simulate.ts';
import { ptlScan } from '../systems/ptl.ts';

const { WORLD_Y, HWLDY } = World;

const mapIndex = (x: number, y: number): number => x * WORLD_Y + y;
const halfIndex = (x: number, y: number): number => x * HWLDY + y;

describe('PTL E2E', () => {
  it('runs via the simulation phase gate and updates pollution maps', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.SimSpeed = 3;
    state.Fcycle = 11;
    state.CCx2 = 0;
    state.CCy2 = 0;

    const context = createSimContext({ store });

    const map = store.getLayer('map') as Uint16Array;

    const cellX = 2;
    const cellY = 3;
    const baseX = cellX << 1;
    const baseY = cellY << 1;

    map[mapIndex(baseX, baseY)] = Tile.IND1;
    map[mapIndex(baseX + 1, baseY)] = Tile.IND1;
    map[mapIndex(baseX, baseY + 1)] = Tile.IND1;
    map[mapIndex(baseX + 1, baseY + 1)] = Tile.IND1;

    const ran = runSimFrame(state, context, {
      ptlScan: (scanState, scanContext) => ptlScan(scanState, scanContext),
    });

    expect(ran).toBe(true);

    const pollutionMem = store.getLayer('pollutionMem') as Uint8Array;
    const landValueMem = store.getLayer('landValueMem') as Uint8Array;

    expect(pollutionMem[halfIndex(cellX, cellY)]).toBeGreaterThan(0);
    expect(landValueMem[halfIndex(cellX, cellY)]).toBeGreaterThan(0);
    expect(state.PolMaxX).toBe(cellX << 1);
    expect(state.PolMaxY).toBe(cellY << 1);
  });
});
